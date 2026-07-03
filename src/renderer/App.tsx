/**
 * Space Browser – Root App Component
 * Orchestrates the browser shell layout:
 *   TitleBar → TabBar → AddressBar → [ContentArea | AISidebar]
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { TitleBar }    from './components/TitleBar';
import { TabBar }      from './components/TabBar';
import { AddressBar }  from './components/AddressBar';
import { AISidebar }   from './components/AISidebar';
import styles          from './styles/App.module.scss';

// Maximum number of recently-closed tabs we remember so Ctrl+Shift+T can restore them.
const MAX_CLOSED_HISTORY = 50;

interface TabState {
  id: string;
  title: string;
  favicon: string;
  url: string;
  isLoading: boolean;
  isActive: boolean;
}

interface ActiveTabState {
  id: string;
  url: string;
  title: string;
  favicon: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

// Safe API accessor – gracefully handles missing spaceAPI (e.g. plain browser dev server preview)
const api = (window as any).spaceAPI ?? null;

// ── Error Boundary ──────────────────────────────────────────────────────────

interface ErrorBoundaryState { hasError: boolean; error: Error | null; }
class AppErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  constructor(props: React.PropsWithChildren) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100vh', background: '#0d0d0f',
          color: '#e8e8f0', fontFamily: 'system-ui, sans-serif', gap: 12, padding: 32,
        }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>
            <circle cx="12" cy="16" r="0.5" fill="#f87171"/>
          </svg>
          <h2 style={{ margin: 0, fontSize: 18, color: '#f87171' }}>Renderer Error</h2>
          <pre style={{
            background: '#16161a', padding: '12px 16px', borderRadius: 8,
            color: '#9898b8', fontSize: 12, maxWidth: 600, overflowX: 'auto',
            border: '1px solid rgba(248,113,113,0.2)',
          }}>
            {this.state.error?.message}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: '#2563eb', border: 'none', borderRadius: 8, color: '#fff',
              padding: '8px 20px', cursor: 'pointer', fontSize: 14,
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Main App ────────────────────────────────────────────────────────────────

const AppInner: React.FC = () => {
  const [tabs, setTabs]               = useState<TabState[]>([]);
  const [activeTab, setActiveTab]     = useState<ActiveTabState | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [readerActive, setReaderActive] = useState(false);
  const [windowState, setWindowState] = useState<string>('normal');
  const [ready, setReady]             = useState(false);
  const chromeRef                     = useRef<HTMLDivElement>(null);

  // ── Closed-tab history (for Ctrl+Shift+T reopen) ─────────────────────────
  // We track { url, title } of each tab as it is closed so the user can restore
  // them in LIFO order — the same behaviour as Chrome / Firefox.
  const closedTabsRef = useRef<Array<{ url: string; title: string }>>([]);
  const tabsRef = useRef<TabState[]>([]);  // mirror of tabs state for event closures

  // Keep tabsRef in sync so the 'tabs:close-active' handler can read current tabs.
  useEffect(() => { tabsRef.current = tabs; }, [tabs]);

  // ── Bootstrap ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!api) {
      // Running in plain browser (dev preview without Electron)
      setReady(true);
      return;
    }

    // Create initial tab and mark ready
    api.tabs.create()   // opens space://newtab (custom new-tab page)
      .then(() => api.tabs.list())
      .then((list: TabState[]) => {
        setTabs(list);
        setReady(true);
      })
      .catch((err: unknown) => {
        console.error('[App] Failed to initialize tabs:', err);
        setReady(true); // still render the chrome even if tabs fail
      });

    // Subscribe to tab updates — also track closed tabs for reopen
    const cleanupList = api.tabs.onListUpdated((newList: TabState[]) => {
      const prev = tabsRef.current; console.log('tabs:list-updated', prev.length, newList.length, prev.map(t=>t.url)); console.log('tabs:list-updated', prev.length, newList.length);
      // Any tab that existed before but is not in the new list was closed
      for (const old of prev) {
        if (!newList.find(t => t.id === old.id) && old.url && !old.url.startsWith('space://newtab')) {
          closedTabsRef.current.unshift({ url: old.url, title: old.title });
          if (closedTabsRef.current.length > MAX_CLOSED_HISTORY) {
            closedTabsRef.current.length = MAX_CLOSED_HISTORY;
          }
        }
      }
      tabsRef.current = newList;
      setTabs(newList);
    });
    const cleanupState = api.tabs.onStateUpdated((s: ActiveTabState) => { setActiveTab(s); setTabs(prev => prev.map(t => t.id === s.id ? { ...t, title: s.title, url: s.url, favicon: s.favicon, isLoading: s.isLoading } : t)); });
    const cleanupActivated = api.tabs.onActivated((_id: string) => {
      api.tabs.list().then(setTabs);
      setReaderActive(false); // reset reader mode on tab switch
    });
    const cleanupWinState  = api.window.onStateChanged(setWindowState);

    // App-level events (IPC → renderer, allowed channels in preload)
    const cleanupSidebarToggle = api.on('sidebar:toggle',   () => setSidebarOpen(prev => !prev));
    const cleanupOpenAI      = api.on('ai:open-chat',      () => setSidebarOpen(true));
    const cleanupCloseActive = api.on('tabs:close-active', () => {
      const active = tabsRef.current.find(t => t.isActive);
      if (active) api.tabs.close(active.id);
    });

    const cleanupReopenClosed = api.on('tabs:reopen-closed', () => {
      const last = closedTabsRef.current.shift();
      if (last?.url) api.tabs.create(last.url);
    });

    // ── Global keyboard shortcuts ──────────────────────────────────────────
    const handleKeyDown = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;

      // Ctrl+Shift+T — reopen last closed tab
      if (ctrl && e.shiftKey && e.key === 'T') {
        e.preventDefault();
        const last = closedTabsRef.current.shift();
        if (last?.url) {
          api.tabs.create(last.url);
        }
        return;
      }

      // Ctrl+T — new tab
      if (ctrl && !e.shiftKey && e.key === 't') {
        e.preventDefault();
        api.tabs.create();
        return;
      }

      // Ctrl+W — close active tab
      if (ctrl && !e.shiftKey && e.key === 'w') {
        e.preventDefault();
        const active = tabsRef.current.find(t => t.isActive);
        if (active) api.tabs.close(active.id);
        return;
      }

      // Ctrl+Tab / Ctrl+PageDown — next tab
      if (ctrl && (e.key === 'Tab' || e.key === 'PageDown') && !e.shiftKey) {
        e.preventDefault();
        const cur = tabsRef.current;
        const idx = cur.findIndex(t => t.isActive);
        const next = cur[(idx + 1) % cur.length];
        if (next) api.tabs.activate(next.id);
        return;
      }

      // Ctrl+Shift+Tab / Ctrl+PageUp — previous tab
      if (ctrl && (e.key === 'Tab' || e.key === 'PageUp') && e.shiftKey) {
        e.preventDefault();
        const cur = tabsRef.current;
        const idx = cur.findIndex(t => t.isActive);
        const prev = cur[(idx - 1 + cur.length) % cur.length];
        if (prev) api.tabs.activate(prev.id);
        return;
      }

      // Ctrl+1…8 — jump to tab by position
      if (ctrl && e.key >= '1' && e.key <= '8') {
        e.preventDefault();
        const pos = parseInt(e.key) - 1;
        const cur = tabsRef.current;
        if (cur[pos]) api.tabs.activate(cur[pos].id);
        return;
      }

      // Ctrl+9 — jump to last tab
      if (ctrl && e.key === '9') {
        e.preventDefault();
        const cur = tabsRef.current;
        if (cur.length > 0) api.tabs.activate(cur[cur.length - 1].id);
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);

    return () => {
      cleanupList();
      cleanupState();
      cleanupActivated();
      cleanupWinState();
      cleanupSidebarToggle?.();
      cleanupOpenAI?.();
      cleanupCloseActive?.();
      cleanupReopenClosed?.();
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Theme application ─────────────────────────────────────────────────────
  // Read the persisted theme preference on startup and apply it to <html>.
  // Also listens for a 'theme:changed' IPC broadcast so all pages stay in sync.
  useEffect(() => {
    const applyTheme = (theme: string) => {
      let resolved = theme || 'dark';
      if (resolved === 'system') {
        resolved = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
      }
      document.documentElement.setAttribute('data-theme', resolved);
    };

    // Apply on mount
    if (api?.prefs) {
      api.prefs.get().then((p: any) => applyTheme(p?.theme ?? 'dark')).catch(() => {});
    } else {
      applyTheme('dark');
    }

    // System preference change (only relevant when theme === 'system')
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onSysPref = () => {
      if (api?.prefs) {
        api.prefs.get().then((p: any) => { if (p?.theme === 'system') applyTheme('system'); }).catch(() => {});
      }
    };
    mq.addEventListener('change', onSysPref);

    // IPC broadcast from main process (when another page saves a new theme)
    const cleanupTheme = api?.on?.('theme:changed', (theme: string) => applyTheme(theme));

    return () => {
      mq.removeEventListener('change', onSysPref);
      cleanupTheme?.();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep sidebar state in sync with tab manager (for BrowserView resize)
  useEffect(() => {
    if (api) api.sidebar.toggle(sidebarOpen);
  }, [sidebarOpen]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleNewTab = useCallback(() => {
    api?.tabs.create();
  }, []);

  const handleCloseTab = useCallback((id: string) => {
    api?.tabs.close(id);
  }, []);

  const handleActivateTab = useCallback((id: string) => {
    api?.tabs.activate(id);
  }, []);

  const handleNavigate = useCallback((url: string) => {
    if (activeTab) api?.tabs.navigate(activeTab.id, url);
  }, [activeTab]);

  const handleGoBack = useCallback(() => {
    if (activeTab) api?.tabs.goBack(activeTab.id);
  }, [activeTab]);

  const handleGoForward = useCallback(() => {
    if (activeTab) api?.tabs.goForward(activeTab.id);
  }, [activeTab]);

  const handleReload = useCallback(() => {
    if (activeTab) api?.tabs.reload(activeTab.id);
  }, [activeTab]);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen(prev => !prev);
  }, []);

  const handleToggleReader = useCallback(() => {
    if (!activeTab) return;
    if (!readerActive) {
      // Navigate to reader page with current URL encoded
      const readerUrl = `space://reader?url=${encodeURIComponent(activeTab.url)}`;
      api?.tabs.navigate(activeTab.id, readerUrl);
      setReaderActive(true);
    } else {
      // Navigate back to the original page
      const params = new URLSearchParams(activeTab.url.replace('space://reader?', ''));
      const origUrl = params.get('url') ?? activeTab.url;
      api?.tabs.navigate(activeTab.id, origUrl);
      setReaderActive(false);
    }
  }, [activeTab, readerActive]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={styles.appRoot}>
      {/* ── Browser chrome: titlebar + tabbar + addressbar ──────────────────
          Wrapped in a single stacking-context container so that all popups
          (extension popups, dropdown menus, etc.) always render above the
          native BrowserView layer that Electron embeds below this window. */}
      <div className={styles.browserChrome}>
        {/* Draggable titlebar with window controls */}
        <TitleBar
          windowState={windowState}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={toggleSidebar}
          onMinimize={() => api?.window.minimize()}
          onMaximize={() => api?.window.maximizeToggle()}
          onClose={() => api?.window.close()}
        />

        {/* Tab strip */}
        <TabBar
          tabs={tabs}
          onNewTab={handleNewTab}
          onCloseTab={handleCloseTab}
          onActivateTab={handleActivateTab}
          closedTabCount={closedTabsRef.current.length}
          onReopenClosedTab={() => {
            const last = closedTabsRef.current.shift();
            if (last?.url) api?.tabs.create(last.url);
          }}
          onDuplicateTab={(id) => {
            const tab = tabs.find(t => t.id === id);
            if (tab) api?.tabs.create(tab.url);
          }}
        />

        {/* Address / navigation bar */}
        <AddressBar
          url={activeTab?.url ?? ''}
          isLoading={activeTab?.isLoading ?? false}
          canGoBack={activeTab?.canGoBack ?? false}
          canGoForward={activeTab?.canGoForward ?? false}
          onNavigate={handleNavigate}
          onGoBack={handleGoBack}
          onGoForward={handleGoForward}
          onReload={handleReload}
          onToggleSidebar={toggleSidebar}
          sidebarOpen={sidebarOpen}
          onToggleReader={handleToggleReader}
          readerActive={readerActive}
        />
      </div>

      {/* Content area + optional AI sidebar */}
      <div className={`${styles.contentRow} ${sidebarOpen ? styles.sidebarVisible : ''}`}>
        {/* BrowserView content placeholder – the actual web content is rendered
            by Electron's BrowserView layer (native, sits below this renderer window).
            This div reserves the correct space so the chrome layout is accurate. */}
        <div className={styles.contentArea} aria-hidden="true">
          {/* Show a loading / no-tab state when there are no tabs yet */}
          {!ready && (
            <div className={styles.loadingState}>
              <SpaceSpinner />
              <span>Starting Space…</span>
            </div>
          )}
          {ready && tabs.length === 0 && (
            <div className={styles.loadingState}>
              <SpaceSpinner />
              <span>Opening new tab…</span>
            </div>
          )}
        </div>

        {/* AI Sidebar panel */}
        {sidebarOpen && (
          <div className={styles.sidebarWrapper}>
            <AISidebar
              pageUrl={activeTab?.url}
              pageTitle={activeTab?.title}
              onClose={() => setSidebarOpen(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export const App: React.FC = () => (
  <AppErrorBoundary>
    <AppInner />
  </AppErrorBoundary>
);

// ── Loading spinner ──────────────────────────────────────────────────────────

const SpaceSpinner: React.FC = () => (
  <svg
    width="36" height="36" viewBox="0 0 36 36" fill="none"
    style={{ animation: 'spin 1.2s linear infinite' }}
    aria-hidden="true"
  >
    <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    {/* Track ring — cobalt blue at low opacity */}
    <circle cx="18" cy="18" r="14" stroke="rgba(37,99,235,0.15)" strokeWidth="3" />
    {/* Spinning arc — Space cobalt blue */}
    <path d="M18 4 A14 14 0 0 1 32 18" stroke="#2563eb" strokeWidth="3" strokeLinecap="round" />
  </svg>
);





