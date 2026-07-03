/**
 * Space Browser – Address Bar Component
 * Supports URL input, search queries, navigation controls,
 * bookmark toggle, settings, AI sidebar toggle, and pinned extensions.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import styles from '../styles/AddressBar.module.scss';

// ── Helpers ────────────────────────────────────────────────────────────────────

function displayUrl(url: string): string {
  if (!url) return '';
  try {
    new URL(url);
    return url.replace(/^https?:\/\//, '').replace(/^www\./, '');
  } catch {
    return url;
  }
}

function isSecure(url: string): boolean {
  return url.startsWith('https://') || url.startsWith('file://') || url.startsWith('space://');
}

// ── Sub-components ─────────────────────────────────────────────────────────────

interface NavButtonProps {
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  disabled: boolean;
  title: string;
  ariaLabel: string;
  children: React.ReactNode;
}

const NavButton: React.FC<NavButtonProps> = ({ onClick, onContextMenu, disabled, title, ariaLabel, children }) => (
  <button
    className={styles.navBtn}
    onClick={onClick}
    onContextMenu={onContextMenu}
    disabled={disabled}
    title={title}
    aria-label={ariaLabel}
  >
    {children}
  </button>
);

// ── Icons ──────────────────────────────────────────────────────────────────────

const ArrowLeftIcon  = () => <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6"><polyline points="10,3 5,8 10,13" /></svg>;
const ArrowRightIcon = () => <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6"><polyline points="6,3 11,8 6,13" /></svg>;
const ReloadIcon     = () => <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M13 8A5 5 0 1 1 8 3h3m0 0V1m0 2H9" /></svg>;
const StopIcon       = () => <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor"><rect x="4" y="4" width="8" height="8" rx="1" /></svg>;
const LockIcon       = () => <svg viewBox="0 0 14 16" width="12" height="14" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2" y="7" width="10" height="8" rx="1.5" /><path d="M4.5 7V5a2.5 2.5 0 0 1 5 0v2" /></svg>;
const GlobeIcon      = () => <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.3"><circle cx="8" cy="8" r="6.5" /><ellipse cx="8" cy="8" rx="2.5" ry="6.5" /><line x1="1.5" y1="8" x2="14.5" y2="8" /></svg>;
const ClearIcon      = () => <svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="1.5" y1="1.5" x2="10.5" y2="10.5" /><line x1="10.5" y1="1.5" x2="1.5" y2="10.5" /></svg>;

const SettingsIcon = () => (
  <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.3">
    <circle cx="8" cy="8" r="2.3"/>
    <path d="M8 1.5v1M8 13.5v1M1.5 8h1M13.5 8h1M3.2 3.2l.7.7M12.1 12.1l.7.7M12.8 3.2l-.7.7M3.9 12.1l-.7.7"/>
  </svg>
);

const BookmarkIcon: React.FC<{ filled: boolean }> = ({ filled }) => (
  <svg viewBox="0 0 16 16" width="15" height="15" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.4">
    <path d="M3 2h10v13l-5-3-5 3V2z" />
  </svg>
);

const AISparkIcon = () => (
  <svg viewBox="0 0 18 18" width="15" height="15" fill="none" aria-hidden="true">
    <path d="M9 1 L10.8 6.8 L17 9 L10.8 11.2 L9 17 L7.2 11.2 L1 9 L7.2 6.8 Z"
          fill="url(#aiShipGrad)" stroke="none" />
    <defs>
      {/* Amber → teal – matches Spaceship sidebar identity */}
      <linearGradient id="aiShipGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%"   stopColor="#fcd34d" />
        <stop offset="55%"  stopColor="#d97706" />
        <stop offset="100%" stopColor="#0d9488" />
      </linearGradient>
    </defs>
  </svg>
);

const ReaderIcon = () => (
  <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
    <rect x="2" y="2" width="12" height="12" rx="2" />
    <line x1="5" y1="6" x2="11" y2="6" />
    <line x1="5" y1="8.5" x2="11" y2="8.5" />
    <line x1="5" y1="11" x2="9" y2="11" />
  </svg>
);

const ExtensionsIcon = () => (
  <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
    <path d="M7 2H4a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h.5a1.5 1.5 0 0 1 0 3H4a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-.5a1.5 1.5 0 0 1 3 0V14a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-.5a1.5 1.5 0 0 1 0-3H15a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1h-3a1 1 0 0 0-1 1v.5a1.5 1.5 0 0 1-3 0V3a1 1 0 0 0-1-1z" strokeLinejoin="round" />
  </svg>
);

// ── Component ──────────────────────────────────────────────────────────────────

const api = (window as any).spaceAPI ?? null;

// ── Pinned Extensions types ────────────────────────────────────────────────────

interface PinnedExt {
  id: string;
  name: string;
  icon: string;
  description: string;
  enabled: boolean;
  category: string;
}

// ── Extension action descriptions ─────────────────────────────────────────────
// Maps extension IDs to a short "what this button does" message shown in the popup.
const EXT_ACTION_LABELS: Record<string, string> = {
  'space-dark-reader':    'Toggle dark mode on the current page',
  'space-ad-blocker':     'Removes ads & trackers on the current page',
  'space-reader-mode':    'Enter distraction-free reading mode (Alt+Shift+R)',
  'space-tab-suspender':  'Suspend inactive tabs to save memory',
  'space-password-gen':   'Activates password generator in password fields',
  'space-screenshot':     'Capture a full-page screenshot (Alt+Shift+P)',
  'space-json-formatter': 'Format raw JSON on the current page',
  'space-translator':     'Open page translator panel (Alt+Shift+T)',
  'space-summariser':     'Summarise this page with AI (Alt+Shift+S)',
  'space-color-picker':   'Pick colours from any element (Alt+Shift+C)',
};

// ── Extension Popup ────────────────────────────────────────────────────────────
// A small dropdown popup that appears when the user clicks a pinned extension button.
// Shows the extension name, description, a quick-activate button, an enable/disable toggle,
// and a link to open the full extensions page.

interface ExtPopupProps {
  ext: PinnedExt;
  anchorRef: React.RefObject<HTMLButtonElement>;
  onClose: () => void;
  onToggle: (id: string, enabled: boolean) => Promise<void>;
  onActivate: (id: string) => Promise<void>;
}

const ExtensionPopup: React.FC<ExtPopupProps> = ({ ext, anchorRef, onClose, onToggle, onActivate }) => {
  const popupRef = useRef<HTMLDivElement>(null);
  const [toggling, setToggling] = useState(false);
  const [activating, setActivating] = useState(false);
  const [enabled, setEnabled] = useState(ext.enabled);

  // Position the popup below the anchor button
  const [pos, setPos] = useState({ top: 0, right: 0 });

  useEffect(() => {
    if (anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      setPos({
        top: rect.bottom + 6,
        right: window.innerWidth - rect.right,
      });
    }
  }, [anchorRef]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        popupRef.current && !popupRef.current.contains(e.target as Node) &&
        anchorRef.current && !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    const escHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', escHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', escHandler);
    };
  }, [onClose, anchorRef]);

  const handleToggle = async () => {
    setToggling(true);
    const next = !enabled;
    setEnabled(next);
    await onToggle(ext.id, next);
    setToggling(false);
  };

  const handleActivate = async () => {
    setActivating(true);
    await onActivate(ext.id);
    setTimeout(() => setActivating(false), 800);
  };

  const actionLabel = EXT_ACTION_LABELS[ext.id] ?? 'Activate extension on the current page';

  // Render via a portal to document.body so the popup escapes any
  // stacking context created by will-change:transform on parent elements.
  // This ensures the popup is always visible above the BrowserView layer.
  const popupContent = (
    <div
      ref={popupRef}
      className={styles.extPopup}
      style={{ top: pos.top, right: pos.right }}
      role="dialog"
      aria-label={`${ext.name} extension popup`}
    >
      {/* Header */}
      <div className={styles.extPopupHeader}>
        <span className={styles.extPopupIcon}>{ext.icon}</span>
        <div className={styles.extPopupMeta}>
          <span className={styles.extPopupName}>{ext.name}</span>
          <span className={styles.extPopupCat}>{ext.category}</span>
        </div>
        <button className={styles.extPopupClose} onClick={onClose} aria-label="Close">✕</button>
      </div>

      {/* Description */}
      <p className={styles.extPopupDesc}>{ext.description}</p>

      {/* Action hint */}
      <p className={styles.extPopupAction}>{actionLabel}</p>

      {/* Controls */}
      <div className={styles.extPopupControls}>
        <button
          className={`${styles.extPopupActivate} ${activating ? styles.extPopupActivating : ''}`}
          onClick={handleActivate}
          disabled={!enabled || activating}
          title="Run extension on the current page"
        >
          {activating ? '✓ Activated!' : '▶ Run on this page'}
        </button>

        <label className={styles.extPopupToggle} title={enabled ? 'Disable extension' : 'Enable extension'}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={handleToggle}
            disabled={toggling}
          />
          <span className={styles.extPopupTrack} />
          <span className={styles.extPopupToggleLabel}>{enabled ? 'On' : 'Off'}</span>
        </label>
      </div>

      {/* Footer link */}
      <button
        className={styles.extPopupFooter}
        onClick={() => { api?.browser?.openExtensions?.(); onClose(); }}
      >
        Manage extensions →
      </button>
    </div>
  );

  return ReactDOM.createPortal(popupContent, document.body);
};

// ── Pinned Extensions toolbar component ───────────────────────────────────────
// Shows each pinned extension as a compact icon button. Clicking it opens a
// popup with details and quick controls. The popup also has an "activate" button
// that re-injects the content script into the active tab.

const PinnedExtensions: React.FC = () => {
  const [pinned, setPinned] = useState<PinnedExt[]>([]);
  const [openPopupId, setOpenPopupId] = useState<string | null>(null);
  const btnRefs = useRef<Record<string, React.RefObject<HTMLButtonElement>>>({});

  const loadPinned = useCallback(async () => {
    if (!api?.extensions) return;
    try {
      const installed: any[] = await api.extensions.list();
      const p = installed
        .filter((e: any) => e.pinned && e.enabled)
        .map((e: any) => ({
          id: e.id,
          name: e.name,
          icon: e.icon,
          description: e.description,
          enabled: e.enabled,
          category: e.category,
        }));
      setPinned(p);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    loadPinned();
    const onFocus = () => loadPinned();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [loadPinned]);

  // Ensure we have a ref for each pinned extension
  pinned.forEach(ext => {
    if (!btnRefs.current[ext.id]) {
      btnRefs.current[ext.id] = React.createRef<HTMLButtonElement>();
    }
  });

  if (pinned.length === 0) return null;

  const handleBtnClick = async (extId: string) => {
    if (!api?.extensions?.showMenu) return;
    await api.extensions.showMenu(extId);
    await loadPinned(); // Refresh pin list after menu closes
  };

  return (
    <>
      <div className={styles.pinnedExts} role="group" aria-label="Pinned extensions">
        {pinned.map(ext => (
          <button
            key={ext.id}
            ref={btnRefs.current[ext.id]}
            className={styles.pinnedExtBtn}
            onClick={() => handleBtnClick(ext.id)}
            title={ext.name}
            aria-label={ext.name}
          >
            <span className={styles.pinnedExtIcon}>{ext.icon}</span>
          </button>
        ))}
      </div>
    </>
  );
};

interface Props {
  url: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  sidebarOpen: boolean;
  activeTabId?: string;
  onNavigate: (url: string) => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onReload: () => void;
  onToggleSidebar: () => void;
  onToggleReader?: () => void;
  readerActive?: boolean;
}

export const AddressBar: React.FC<Props> = ({
  url, isLoading, canGoBack, canGoForward, sidebarOpen,
  onNavigate, onGoBack, onGoForward, onReload, onToggleSidebar,
  onToggleReader, readerActive,
}) => {
  const [inputValue, setInputValue] = useState(url);
  const [isFocused, setIsFocused]   = useState(false);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Check if current URL is bookmarked
  useEffect(() => {
    if (!url || !api?.bookmarks) { setIsBookmarked(false); return; }
    api.bookmarks.isBookmarked(url).then((bm: any) => setIsBookmarked(!!bm)).catch(() => setIsBookmarked(false));
  }, [url]);

  useEffect(() => {
    if (!isFocused) {
      setInputValue(displayUrl(url));
    }
  }, [url, isFocused]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputValue.trim();
    if (trimmed) {
      onNavigate(trimmed);
      inputRef.current?.blur();
    }
  }, [inputValue, onNavigate]);

  const handleFocus = useCallback(() => {
    setIsFocused(true);
    setInputValue(url);
    setTimeout(() => inputRef.current?.select(), 0);
  }, [url]);

  const handleBlur = useCallback(() => {
    setIsFocused(false);
    setInputValue(displayUrl(url));
  }, [url]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setInputValue(displayUrl(url));
      inputRef.current?.blur();
    }
  }, [url]);

  const handleToggleBookmark = useCallback(async () => {
    if (!api?.bookmarks || !url || url.startsWith('space://')) return;
    if (isBookmarked) {
      const bm = await api.bookmarks.isBookmarked(url);
      if (bm) await api.bookmarks.remove(bm.id);
      setIsBookmarked(false);
    } else {
      const title = document.title || url;
      await api.bookmarks.add({ url, title, favicon: '', tags: [] });
      setIsBookmarked(true);
    }
  }, [url, isBookmarked]);

  const handleOpenSettings = useCallback(() => {
    api?.browser?.openSettings?.();
  }, []);

  const handleOpenExtensions = useCallback(() => {
    api?.browser?.openExtensions?.();
  }, []);

  const isSpecialPage = url.startsWith('space://') || !url;

  return (
    <div className={styles.addressBar}>
      {/* Navigation controls */}
      <div className={styles.navControls}>
        <NavButton onClick={onGoBack}    disabled={!canGoBack}    title="Back (Alt+←)"    ariaLabel="Go back">
          <ArrowLeftIcon />
        </NavButton>
        <NavButton onClick={onGoForward} disabled={!canGoForward} title="Forward (Alt+→)"  ariaLabel="Go forward">
          <ArrowRightIcon />
        </NavButton>
        <NavButton onClick={onReload}    disabled={false}         title="Reload (Ctrl+R)"  ariaLabel={isLoading ? 'Stop' : 'Reload'}>
          {isLoading ? <StopIcon /> : <ReloadIcon />}
        </NavButton>
      </div>

      {/* Address input */}
      <form className={`${styles.addressForm} ${isFocused ? styles.focused : ''}`} onSubmit={handleSubmit}>
        <div className={styles.securityIcon} aria-hidden="true">
          {isSecure(url) ? <LockIcon /> : <GlobeIcon />}
        </div>
        <input
          ref={inputRef}
          className={styles.addressInput}
          type="text"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          aria-label="Address bar"
          placeholder="Search or enter address…"
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
        />
        {inputValue && isFocused && (
          <button
            type="button"
            className={styles.clearBtn}
            onMouseDown={e => { e.preventDefault(); setInputValue(''); }}
            aria-label="Clear address"
          >
            <ClearIcon />
          </button>
        )}
      </form>

      {/* Right-side controls */}
      <div className={styles.rightControls}>
        {/* Pinned extensions toolbar */}
        <PinnedExtensions />

        {/* Bookmark toggle */}
        {!isSpecialPage && (
          <button
            className={`${styles.iconBtn} ${isBookmarked ? styles.bookmarked : ''}`}
            onClick={handleToggleBookmark}
            title={isBookmarked ? 'Remove bookmark' : 'Bookmark this page (Ctrl+D)'}
            aria-label={isBookmarked ? 'Remove bookmark' : 'Bookmark this page'}
          >
            <BookmarkIcon filled={isBookmarked} />
          </button>
        )}

        {/* Extensions */}
        <button
          className={styles.iconBtn}
          onClick={handleOpenExtensions}
          title="Extensions"
          aria-label="Open extensions"
        >
          <ExtensionsIcon />
        </button>

        {/* Settings */}
        <button
          className={styles.iconBtn}
          onClick={handleOpenSettings}
          title="Settings"
          aria-label="Open settings"
        >
          <SettingsIcon />
        </button>

        {/* Reading Mode toggle — only shown on http/https pages */}
        {!isSpecialPage && onToggleReader && (
          <button
            className={`${styles.iconBtn} ${readerActive ? styles.readerActive : ''}`}
            onClick={onToggleReader}
            title={readerActive ? 'Exit Reading Mode' : 'Reading Mode'}
            aria-label={readerActive ? 'Exit Reading Mode' : 'Enter Reading Mode'}
            aria-pressed={readerActive}
          >
            <ReaderIcon />
          </button>
        )}

        {/* AI sidebar toggle */}
        <button
          className={`${styles.aiToggleBtn} ${sidebarOpen ? styles.active : ''}`}
          onClick={onToggleSidebar}
          title="Toggle AI Sidebar (Ctrl+Shift+A)"
          aria-label={sidebarOpen ? 'Close AI sidebar' : 'Open AI sidebar'}
          aria-pressed={sidebarOpen}
        >
          <AISparkIcon />
          <span className={styles.aiLabel}>AI</span>
        </button>
      </div>
    </div>
  );
};




