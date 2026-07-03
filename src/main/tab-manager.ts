/**
 * Space Browser – Tab Manager
 * ----------------------------
 * Manages web content tabs via BrowserView.
 * Each tab is an independent BrowserView attached to the main window.
 */

import { BrowserWindow, BrowserView, ipcMain, shell, session, Menu, MenuItem, clipboard, webFrameMain } from 'electron';
import path from 'path';
import Store from 'electron-store';
import { extensionManager } from './extension-manager';

// ── Search engine registry ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────��

export const SEARCH_ENGINES: Record<string, { name: string; url: string }> = {
  space:       { name: 'Space AI Search', url: 'space://search?q=%s' },
  spaceship:   { name: 'Spaceship',       url: 'space://search?q=%s&engine=spaceship' },
  duckduckgo:  { name: 'DuckDuckGo',      url: 'https://duckduckgo.com/?q=%s' },
  google:      { name: 'Google',          url: 'https://www.google.com/search?q=%s' },
  bing:        { name: 'Bing',            url: 'https://www.bing.com/search?q=%s' },
  brave:       { name: 'Brave Search',    url: 'https://search.brave.com/search?q=%s' },
  ecosia:      { name: 'Ecosia',          url: 'https://www.ecosia.org/search?q=%s' },
  startpage:   { name: 'Startpage',       url: 'https://www.startpage.com/search?query=%s' },
};

// "Space Search" routes queries through our built-in AI search page that shows
// a local-LLM answer alongside scraped web results.

const DEFAULT_SEARCH_ENGINE = 'space';

interface BrowserSettings {
  searchEngine: string;
}

interface Tab {
  id: string;
  view: BrowserView;
  url: string;
  title: string;
  favicon: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  lastActivityAt: number;   // ms timestamp — updated on user interaction
  isSuspended: boolean;     // true when the tab has been suspended by Tab Suspender
  suspendedUrl: string;     // original URL before suspension
  isPinned: boolean;        // true when the tab is pinned
  isMuted: boolean;         // true when the tab's audio is muted
}

export class TabManager {
  private win: BrowserWindow;
  private tabs: Map<string, Tab> = new Map();
  private activeTabId: string | null = null;
  private browserSettings: Store<BrowserSettings>;

  // Browser chrome height: titlebar(32) + tab bar(34) + address bar(44) = 110px
  private readonly CHROME_HEIGHT = 110;
  private readonly SIDEBAR_WIDTH = 360; // AI sidebar, when open
  private sidebarOpen = false;

  // ── Tab Suspender ─────────────────────────────────────────────────────────
  // Idle suspension: tabs inactive for longer than SUSPEND_AFTER_MS are
  // suspended by navigating them to a lightweight placeholder page.
  // Activity is reported from content scripts via the 'tabs:report-activity' IPC.
  private readonly SUSPEND_AFTER_MS = 15 * 60 * 1000; // 15 minutes default
  private suspendInterval: ReturnType<typeof setInterval> | null = null;

  constructor(win: BrowserWindow) {
    this.win = win;
    this.browserSettings = new Store<BrowserSettings>({
      name: 'browser-settings',
      defaults: { searchEngine: DEFAULT_SEARCH_ENGINE },
    });
    this.registerIpc();

    // ── Resize / maximize fix ──────────────────────────────────────────────
    // When the window is maximized, restored, or resized, Electron does NOT
    // automatically re-layout BrowserViews.  We listen for the 'resize' event
    // (fired on all size changes including maximize/restore/snap) and force
    // the active tab's BrowserView to fill the correct bounds.
    // Using a debounce avoids hammering setBounds during a live resize drag.
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const onWindowResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resizeTimer = null;
        // Re-apply bounds to all tabs: active tab gets full area, others get 0x0.
        for (const tab of this.tabs.values()) {
          this.resizeView(tab.view, tab.id !== this.activeTabId);
        }
      }, 50); // 50 ms debounce — fast enough to be seamless, avoids thrashing
    };

    this.win.on('resize',    onWindowResize);
    this.win.on('maximize',  onWindowResize);
    this.win.on('unmaximize', onWindowResize);
    this.win.on('enter-full-screen', onWindowResize);
    this.win.on('leave-full-screen', onWindowResize);
  }

  // ── Search helpers ──────────────────────────────────────────────────────────

  getSearchEngine(): string {
    return this.browserSettings.get('searchEngine') ?? DEFAULT_SEARCH_ENGINE;
  }

  setSearchEngine(key: string): void {
    if (SEARCH_ENGINES[key]) {
      this.browserSettings.set('searchEngine', key);
      // Also sync with the browser-prefs store used by ipc-handlers.ts
      // so both stores stay consistent and the settings page reads correctly.
      try {
        const Store = require('electron-store');
        const prefsStore = new Store({ name: 'browser-prefs' });
        prefsStore.set('searchEngine', key);
      } catch (_) { /* non-critical */ }
    }
  }

  buildSearchUrl(query: string): string {
    const engineKey = this.getSearchEngine();
    const engine = SEARCH_ENGINES[engineKey] ?? SEARCH_ENGINES[DEFAULT_SEARCH_ENGINE];
    return engine.url.replace('%s', encodeURIComponent(query));
  }

  // ── Public API ────────────────────────────────────────────────────────────

  createTab(url: string = 'space://newtab'): string {
    const id = `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Use a dedicated persistent partition for all browser tabs.
    // This keeps them completely isolated from the shell renderer's session
    // so no restrictive CSP from the shell ever blocks YouTube, Instagram, etc.
    const tabSession = session.fromPartition('persist:tabs', { cache: true });

    const view = new BrowserView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,   // preload requires sandbox:false
        webviewTag: false,
        allowRunningInsecureContent: false,
        webSecurity: true,
        javascript: true,
        images: true,
        session: tabSession,
        // Needed for modern sites (YouTube, GitHub, etc.)
        enableBlinkFeatures: '',
        preload: path.join(__dirname, '../preload/preload.js'),
        // Do NOT throttle background tabs — Cloudflare JS challenge timers must run
        backgroundThrottling: false,
        // Ensure spellcheck is off to avoid Chromium adding UI hints Cloudflare can detect
        spellcheck: false,
      },
    });

    this.win.addBrowserView(view);

    // ── User-Agent ─────────────────────────────────────────────────────────
    // Use a real, up-to-date Chrome UA so Cloudflare TLS + JS challenges succeed.
    // The version here MUST match the sec-ch-ua headers applied on the shared
    // persist:tabs session in main.ts, otherwise Cloudflare detects the mismatch.
    const CHROME_VERSION = process.versions.chrome;
    const chromeUA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION} Safari/537.36`;
    view.webContents.setUserAgent(chromeUA);

    this.resizeView(view);

    // Navigation events → update UI
    view.webContents.on('did-start-loading', () => this.syncTabState(id));
    view.webContents.on('did-stop-loading',  () => {
      this.syncTabState(id);
      // Inject enabled extension content scripts into every page load,
      // but skip built-in space:// pages and non-scriptable pages (PDFs,
      // data: URLs, about: pages, Electron's internal PDF viewer, etc.).
      const currentUrl = view.webContents.getURL();
      if (this.isScriptableUrl(currentUrl)) {
        this.injectExtensionScripts(view);
      }
    });
    view.webContents.on('did-navigate',      () => this.syncTabState(id));
    view.webContents.on('did-navigate-in-page', () => this.syncTabState(id));
    view.webContents.on('page-title-updated', (_e, title) => {
      const tab = this.tabs.get(id);
      if (tab) { tab.title = title; this.syncTabState(id); }
    });
    view.webContents.on('page-favicon-updated', (_e, favicons) => {
      const tab = this.tabs.get(id);
      if (tab && favicons.length > 0) { tab.favicon = favicons[0]; this.syncTabState(id); }
    });

    // Intercept new window requests
    view.webContents.setWindowOpenHandler(({ url: newUrl }) => {
      this.createTab(newUrl);
      return { action: 'deny' };
    });

    // ── Native context menu ────────────────────────────────────────────────
    // Provides right-click actions: copy, translate selection, search, open link,
    // back/forward/reload, and save image — matching a full-featured browser.
    view.webContents.on('context-menu', (_e, params) => {
      const menuItems: Electron.MenuItemConstructorOptions[] = [];

      // ── Link actions ─────────────────────────────────────────────────────
      if (params.linkURL) {
        menuItems.push(
          { label: 'Open Link in New Tab',  click: () => this.createTab(params.linkURL) },
          { label: 'Open Link in Browser',  click: () => shell.openExternal(params.linkURL) },
          { label: 'Copy Link Address',     click: () => clipboard.writeText(params.linkURL) },
          { type: 'separator' },
        );
      }

      // ── Image actions ────────────────────────────────────────────────────
      if (params.hasImageContents && params.srcURL) {
        menuItems.push(
          { label: 'Open Image in New Tab', click: () => this.createTab(params.srcURL) },
          { label: 'Copy Image Address',    click: () => clipboard.writeText(params.srcURL) },
          { label: 'Save Image As…',        click: () => view.webContents.downloadURL(params.srcURL) },
          { type: 'separator' },
        );
      }

      // ── Text selection actions ─────────────────────────────────────────
      if (params.selectionText && params.selectionText.trim().length > 0) {
        const sel = params.selectionText.trim();
        const shortSel = sel.length > 40 ? sel.slice(0, 40) + '…' : sel;

        // Helper: inject the inline translation popup for a given target language
        const doTranslate = (targetLang: string) => {
          const systemPrompt = `Translate the following text to ${targetLang}. Output ONLY the translation, no explanations or notes.`;
          view.webContents.executeJavaScript(`
            (function() {
              var api = window.spaceAPI;
              var targetLang = ${JSON.stringify(targetLang)};
              var sel = ${JSON.stringify(sel)};
              if (window.__spaceTranslator && typeof window.doTranslateTextDirect === 'function') {
                window.doTranslateTextDirect(sel, targetLang);
                return;
              }
              var existing = document.getElementById('__space_ctxmenu_translate');
              if (existing) existing.remove();
              var el = document.createElement('div');
              el.id = '__space_ctxmenu_translate';
              el.style.cssText = [
                'position:fixed','bottom:24px','left:50%','transform:translateX(-50%)',
                'z-index:2147483647','background:#13131c',
                'border:1px solid rgba(37,99,235,0.5)','border-radius:12px',
                'padding:14px 18px','min-width:280px','max-width:480px',
                'font-family:system-ui,sans-serif',
                'box-shadow:0 8px 32px rgba(0,0,0,0.6)',
                'transition:opacity 0.15s ease'
              ].join(';');
              
              var header = document.createElement('div');
              header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;';
              
              var title = document.createElement('span');
              title.style.cssText = 'font-size:13px;font-weight:700;color:#e0e0ec;';
              title.textContent = '🌐 Translate → ' + targetLang;
              
              var closeBtn = document.createElement('button');
              closeBtn.style.cssText = 'background:none;border:none;color:#666680;cursor:pointer;font-size:15px;padding:0 4px;line-height:1;transition:color 0.1s;';
              closeBtn.textContent = '✕';
              closeBtn.addEventListener('click', function() { el.remove(); });
              
              header.appendChild(title);
              header.appendChild(closeBtn);
              el.appendChild(header);
              
              var origText = document.createElement('div');
              origText.style.cssText = 'font-size:12px;color:#8888aa;margin-bottom:8px;padding:5px 8px;background:#1a1a28;border-radius:6px;line-height:1.5;max-height:72px;overflow:hidden;text-overflow:ellipsis;';
              origText.textContent = sel.slice(0, 200) + (sel.length > 200 ? '…' : '');
              el.appendChild(origText);
              
              var outDiv = document.createElement('div');
              outDiv.id = '__space_ctx_out';
              outDiv.style.cssText = 'font-size:13px;color:#c0c0d8;line-height:1.65;min-height:32px;margin-top:4px;';
              outDiv.innerHTML = '<span style="color:#444460;">Translating…</span>';
              el.appendChild(outDiv);
              
              document.body.appendChild(el);
              if (api && api.ai && api.ai.chat) {
                var msgs = [
                  {role:'system', content:${JSON.stringify(systemPrompt)}},
                  {role:'user', content:sel}
                ];
                var rid = 'ctx-translate-' + Date.now();
                var out = document.getElementById('__space_ctx_out');
                if (out) out.textContent = '';
                var unsub = api.ai.onToken(function(d) {
                  if (d.requestId !== rid) return;
                  var o = document.getElementById('__space_ctx_out');
                  if (!o) { if (unsub) unsub(); return; }
                  if (d.token) o.textContent += d.token;
                  if (d.isFinal || d.error) { if (unsub) unsub(); }
                });
                api.ai.chat(msgs, {maxTokens:768, temperature:0.15}, rid).catch(function() {
                  var o = document.getElementById('__space_ctx_out');
                  if (o) o.innerHTML = '<span style="color:#f87171;">Translation failed – is a model loaded?</span>';
                });
              } else {
                var o = document.getElementById('__space_ctx_out');
                if (o) o.innerHTML = '<span style="color:#f87171;">Load an AI model in the Spaceship sidebar first.</span>';
              }
              setTimeout(function(){ var e2 = document.getElementById('__space_ctxmenu_translate'); if(e2) e2.remove(); }, 30000);
            })()
          `).catch(() => {});
        };

        // Build "Translate to…" submenu with the most common languages
        const translateSubmenu: Electron.MenuItemConstructorOptions[] = [
          { label: '🇬🇧 English',    click: () => doTranslate('English') },
          { label: '🇩🇪 German',     click: () => doTranslate('German') },
          { label: '🇫🇷 French',     click: () => doTranslate('French') },
          { label: '🇪🇸 Spanish',    click: () => doTranslate('Spanish') },
          { label: '🇮🇹 Italian',    click: () => doTranslate('Italian') },
          { label: '🇵🇹 Portuguese', click: () => doTranslate('Portuguese') },
          { label: '🇷🇺 Russian',    click: () => doTranslate('Russian') },
          { label: '🇨🇳 Chinese (Simplified)', click: () => doTranslate('Chinese (Simplified)') },
          { label: '🇯🇵 Japanese',   click: () => doTranslate('Japanese') },
          { label: '🇰🇷 Korean',     click: () => doTranslate('Korean') },
          { label: '🇸🇦 Arabic',     click: () => doTranslate('Arabic') },
          { label: '🇹🇷 Turkish',    click: () => doTranslate('Turkish') },
          { label: '🇳🇱 Dutch',      click: () => doTranslate('Dutch') },
          { label: '🇵🇱 Polish',     click: () => doTranslate('Polish') },
          { label: '🇺🇦 Ukrainian',  click: () => doTranslate('Ukrainian') },
          { label: '🇸🇰 Albanian',   click: () => doTranslate('Albanian') },
          { label: '🇽🇰 Serbian',    click: () => doTranslate('Serbian') },
          { label: '🇲🇰 Macedonian', click: () => doTranslate('Macedonian') },
          { label: '🇭🇷 Croatian',   click: () => doTranslate('Croatian') },
          { label: '🇸🇮 Slovenian',  click: () => doTranslate('Slovenian') },
          { label: '🇧🇦 Bosnian',    click: () => doTranslate('Bosnian') },
          { label: '🇬🇷 Greek',      click: () => doTranslate('Greek') },
          { label: '🇮🇳 Hindi',      click: () => doTranslate('Hindi') },
          { label: '🇮🇩 Indonesian', click: () => doTranslate('Indonesian') },
          { label: '🇻🇳 Vietnamese', click: () => doTranslate('Vietnamese') },
          { label: '🇹🇭 Thai',       click: () => doTranslate('Thai') },
          { label: '🇮🇱 Hebrew',     click: () => doTranslate('Hebrew') },
          { label: '🇸🇪 Swedish',    click: () => doTranslate('Swedish') },
          { label: '🇩🇰 Danish',     click: () => doTranslate('Danish') },
          { label: '🇫🇮 Finnish',    click: () => doTranslate('Finnish') },
          { label: '🇳🇴 Norwegian',  click: () => doTranslate('Norwegian') },
          { label: '🇷🇴 Romanian',   click: () => doTranslate('Romanian') },
          { label: '🇭🇺 Hungarian',  click: () => doTranslate('Hungarian') },
          { label: '🇨🇿 Czech',      click: () => doTranslate('Czech') },
          { label: '🇸🇰 Slovak',     click: () => doTranslate('Slovak') },
          { label: '🇧🇬 Bulgarian',  click: () => doTranslate('Bulgarian') },
        ];

        menuItems.push(
          { label: `Copy "${shortSel}"`, click: () => clipboard.writeText(sel) },
          { type: 'separator' },
          {
            label: '🌐 Translate Selection',
            submenu: translateSubmenu,
          },
          {
            label: `🔍 Search for "${shortSel}"`,
            click: () => this.createTab(this.buildSearchUrl(sel)),
          },
          { type: 'separator' },
        );
      }

      // ── Editing actions ───────────────────────────────────────────────────
      if (params.isEditable) {
        menuItems.push(
          { label: 'Cut',          role: 'cut'   as const },
          { label: 'Copy',         role: 'copy'  as const },
          { label: 'Paste',        role: 'paste' as const },
          { label: 'Select All',   role: 'selectAll' as const },
          { type: 'separator' },
          // Undo/Redo in editable fields
          { label: 'Undo',         role: 'undo'  as const, enabled: params.editFlags.canUndo },
          { label: 'Redo',         role: 'redo'  as const, enabled: params.editFlags.canRedo },
          { type: 'separator' },
        );
      } else if (!params.selectionText && !params.linkURL && !params.hasImageContents) {
        // General page actions when nothing is selected / right-clicking blank area
        menuItems.push(
          {
            label: 'Back',
            enabled: view.webContents.canGoBack(),
            click: () => view.webContents.goBack(),
          },
          {
            label: 'Forward',
            enabled: view.webContents.canGoForward(),
            click: () => view.webContents.goForward(),
          },
          {
            label: 'Reload',
            click: () => view.webContents.reload(),
          },
          {
            label: 'Force Reload',
            click: () => view.webContents.reloadIgnoringCache(),
          },
          { type: 'separator' },
          {
            label: 'Zoom',
            submenu: [
              { label: 'Zoom In',    accelerator: 'CmdOrCtrl+=', click: () => view.webContents.setZoomFactor(Math.min(view.webContents.getZoomFactor() + 0.1, 3)) },
              { label: 'Zoom Out',   accelerator: 'CmdOrCtrl+-', click: () => view.webContents.setZoomFactor(Math.max(view.webContents.getZoomFactor() - 0.1, 0.25)) },
              { label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0', click: () => view.webContents.setZoomFactor(1) },
            ],
          },
          { type: 'separator' },
          {
            label: 'Save Page As…',
            click: () => view.webContents.savePage(`${view.webContents.getTitle()}.html`, 'HTMLComplete').catch(() => {}),
          },
          { label: 'Print…', click: () => view.webContents.print() },
          {
            label: 'Export to PDF\u2026',
            click: async () => {
              try {
                const { dialog } = require('electron');
                const fs = require('fs');
                const title = view.webContents.getTitle() || 'Page';
                const result = await dialog.showSaveDialog({
                  title: 'Export to PDF',
                  defaultPath: title.replace(/[^a-z0-9]/gi, '_') + '.pdf',
                  filters: [{ name: 'PDF Document', extensions: ['pdf'] }]
                });
                if (result.canceled || !result.filePath) return;
                const pdfData = await view.webContents.printToPDF({});
                fs.writeFileSync(result.filePath, pdfData);
              } catch (e) {
                console.error('Failed to export PDF:', e);
              }
            }
          },
          { type: 'separator' },
        );
      }

      // ── View source ──────────────────────────────────────────────────────
      menuItems.push(
        { label: 'View Page Source', click: () => this.createTab(`view-source:${view.webContents.getURL()}`) },
        { label: 'Inspect Element',  click: () => view.webContents.inspectElement(params.x, params.y) },
      );

      if (menuItems.length > 0) {
        const ctxMenu = Menu.buildFromTemplate(menuItems);
        ctxMenu.popup({ window: this.win });
      }
    });

    const tab: Tab = {
      id,
      view,
      url,
      title: 'New Tab',
      favicon: '',
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      lastActivityAt: Date.now(),
      isSuspended: false,
      suspendedUrl: '',
      isPinned: false,
      isMuted: false,
    };

    this.tabs.set(id, tab);
    this.activateTab(id);

    // Load URL (handle special space:// protocol)
    this.navigate(id, url);

    // Notify renderer
    this.sendTabListUpdate();
    return id;
  }

  closeTab(id: string): void {
    const tab = this.tabs.get(id);
    if (!tab) return;

    this.win.removeBrowserView(tab.view);
    (tab.view.webContents as any).destroy?.();
    this.tabs.delete(id);

    if (this.activeTabId === id) {
      const remaining = [...this.tabs.keys()];
      if (remaining.length > 0) {
        this.activateTab(remaining[remaining.length - 1]);
      } else {
        this.activeTabId = null;
        this.createTab();
      }
    }

    this.sendTabListUpdate();
  }

  activateTab(id: string): void {
    // Hide all views
    for (const [tid, tab] of this.tabs) {
      if (tid !== id) {
        tab.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      }
    }
    const tab = this.tabs.get(id);
    if (!tab) return;
    this.activeTabId = id;
    tab.lastActivityAt = Date.now();
    // Auto-resume if suspended when user clicks the tab
    if (tab.isSuspended) {
      this.resumeTab(id);
      return; // resumeTab calls loadURL which triggers syncTabState
    }
    this.resizeView(tab.view);
    this.win.webContents.send('tab:activated', id);
    this.syncTabState(id);
  }

  navigate(id: string, url: string): void {
    const tab = this.tabs.get(id);
    if (!tab) return;

    let resolved = url;
    if (url === '' || url === 'space://newtab') {
      // space://newtab is handled by the custom protocol registered in main.ts.
      // It serves dist/renderer/newtab.html with a permissive CSP that allows
      // inline scripts and WASM — needed for the chess engine, etc.
      resolved = 'space://newtab';
    } else if (url.startsWith('space://')) {
      // ── Built-in pages ──────────────────────────────────────────────────────
      // The space:// protocol handler in main.ts resolves any space://<name>
      // (or space://<name>?query) to dist/renderer/<name>.html automatically.
      // Adding a new game page therefore requires NO changes here — just drop
      // the HTML file in src/renderer/ and register it in games.html.
      resolved = url;
    } else if (!url.startsWith('http') && !url.startsWith('file:')) {
      // ── Smart address bar ────────────────────────────────────────────────────
      // Bare hostname (e.g. "github.com") → prefix https://
      // Everything else (e.g. "what is rust") → route through search engine
      if (url.includes('.') && !url.includes(' ')) {
        resolved = `https://${url}`;
      } else {
        resolved = this.buildSearchUrl(url);
      }
    }

    tab.url = resolved;
    tab.view.webContents.loadURL(resolved);
  }

  setSidebarState(open: boolean): void {
    this.sidebarOpen = open;
    for (const tab of this.tabs.values()) {
      this.resizeView(tab.view, tab.id !== this.activeTabId);
    }
  }

  // ── Tab Suspender public API ────────────────────────────────────────────────

  /** Enable the idle tab suspension timer. Called when space-tab-suspender is toggled on. */
  startTabSuspender(idleMs?: number): void {
    if (idleMs && idleMs > 0) (this as any).SUSPEND_AFTER_MS = idleMs;
    if (this.suspendInterval) return; // already running
    this.suspendInterval = setInterval(() => this.checkIdleTabs(), 60_000); // check every minute
    console.log('[TabManager] Tab Suspender started — idle threshold:', (this as any).SUSPEND_AFTER_MS / 60000, 'min');
  }

  /** Disable the idle tab suspension timer. Called when space-tab-suspender is toggled off. */
  stopTabSuspender(): void {
    if (this.suspendInterval) {
      clearInterval(this.suspendInterval);
      this.suspendInterval = null;
      console.log('[TabManager] Tab Suspender stopped');
    }
  }

  /** Called by content script IPC when the user interacts with a tab. */
  reportTabActivity(webContentsId: number): void {
    for (const tab of this.tabs.values()) {
      if (tab.view.webContents.id === webContentsId) {
        tab.lastActivityAt = Date.now();
        if (tab.isSuspended) {
          // Resume the tab automatically when the user touches it
          this.resumeTab(tab.id);
        }
        break;
      }
    }
  }

  suspendTab(id: string): void {
    const tab = this.tabs.get(id);
    if (!tab || tab.isSuspended || tab.id === this.activeTabId) return;
    if (tab.url.startsWith('space://')) return; // never suspend built-in pages
    tab.suspendedUrl = tab.url;
    tab.isSuspended = true;
    // Navigate to a blank data-URL placeholder — the content script will detect
    // the title "Suspended Tab" and render a friendly restore UI.
    const html = `<!DOCTYPE html><html><head><title>Suspended Tab</title><style>body{background:#0d0d15;margin:0;}</style></head><body></body></html>`;
    tab.view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    console.log(`[TabManager] Suspended idle tab: ${id} (${tab.title})`);
    this.sendTabListUpdate();
  }

  resumeTab(id: string): void {
    const tab = this.tabs.get(id);
    if (!tab || !tab.isSuspended) return;
    tab.isSuspended = false;
    tab.lastActivityAt = Date.now();
    const url = tab.suspendedUrl || 'space://newtab';
    tab.suspendedUrl = '';
    tab.view.webContents.loadURL(url);
    console.log(`[TabManager] Resumed suspended tab: ${id}`);
    this.sendTabListUpdate();
  }

  private checkIdleTabs(): void {
    const now = Date.now();
    for (const tab of this.tabs.values()) {
      if (tab.id === this.activeTabId) continue;
      if (tab.isSuspended) continue;
      if (tab.url.startsWith('space://')) continue;
      const idle = now - tab.lastActivityAt;
      if (idle >= (this as any).SUSPEND_AFTER_MS) {
        this.suspendTab(tab.id);
      }
    }
  }

  // ── Resize ─────────────────────────────────────────────────────────────────

  private resizeView(view: BrowserView, hidden = false): void {
    if (hidden) {
      view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      return;
    }
    const [winW, winH] = this.win.getContentSize();
    const sidebarW = this.sidebarOpen ? this.SIDEBAR_WIDTH : 0;
    view.setBounds({
      x: 0,
      y: this.CHROME_HEIGHT,
      width: winW - sidebarW,
      height: winH - this.CHROME_HEIGHT,
    });
    view.setAutoResize({ width: true, height: true });
  }

  // ── Extension content script injection ─────────────────────────────────────
  // Called after every page load on external tabs. Runs all enabled extension
  // content scripts in the tab's renderer context.

  /**
   * Returns true only for URLs where JavaScript injection is safe and meaningful.
   * PDF pages, internal browser pages, data URLs, and about: pages do not
   * support arbitrary JS execution and must be skipped.
   */
  private isScriptableUrl(url: string): boolean {
    if (!url) return false;
    // Built-in Space pages handle their own scripting
    if (url.startsWith('space://')) return false;
    // Electron's built-in PDF viewer renders as chrome-extension:// or devtools://
    if (url.startsWith('chrome-extension://')) return false;
    if (url.startsWith('chrome://')) return false;
    if (url.startsWith('devtools://')) return false;
    // data: URLs (e.g. suspended tab placeholder) and about: pages
    if (url.startsWith('data:')) return false;
    if (url.startsWith('about:')) return false;
    // Chromium's internal PDF viewer URL for loaded PDFs
    if (url.includes('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai')) return false;
    // file:// PDFs — the webContents.getTitle() ends with .pdf
    // We allow file:// HTML but skip file:// PDFs
    if (url.startsWith('file://') && url.toLowerCase().endsWith('.pdf')) return false;
    // Remote PDFs: content-type is determined by the server, but URLs ending in
    // .pdf are almost always PDFs, and script injection will silently fail there
    if (url.toLowerCase().split('?')[0].endsWith('.pdf')) return false;
    // Empty / placeholder
    if (url === '' || url === 'about:blank') return false;
    return true;
  }

  private async injectExtensionScripts(view: BrowserView): Promise<void> {
    // Extra guard: check that the frame is still alive and scriptable
    if (view.webContents.isDestroyed()) return;
    // Verify the current URL before injection (it may have changed since load)
    const currentUrl = view.webContents.getURL();
    if (!this.isScriptableUrl(currentUrl)) return;

    // Also check that the page isn't a PDF by inspecting MIME type via JS.
    // Electron's PDF viewer hijacks the webContents so document.contentType is 'application/pdf'.
    try {
      const isPdf = await view.webContents.executeJavaScript(
        `document.contentType === 'application/pdf' || (document.body && document.body.children.length === 1 && document.body.children[0] && document.body.children[0].tagName === 'EMBED' && (document.body.children[0].type||'').includes('pdf'))`,
      );
      if (isPdf) return;
    } catch {
      // If the JS check itself fails, the page is not injectable — skip safely
      return;
    }

    try {
      const scripts = extensionManager.getEnabledContentScripts();
      for (const { id, code } of scripts) {
        if (!code.trim()) continue;
        view.webContents.executeJavaScript(code).catch(err => {
          // Suppress common non-critical errors (destroyed frames, cross-origin, etc.)
          const msg = err?.message ?? String(err);
          if (!msg.includes('ERR_ABORTED') && !msg.includes('Object has been destroyed')) {
            console.warn(`[TabManager] Extension "${id}" script error:`, msg);
          }
        });
      }
    } catch (err) {
      console.warn('[TabManager] Extension injection failed:', err);
    }
  }

  /** Inject a single extension's content script into ALL currently open external tabs. */
  injectExtensionIntoAllTabs(id: string): void {
    const ext = extensionManager.getInstalled(id);
    if (!ext || !ext.enabled) return;
    const scripts = extensionManager.getEnabledContentScripts().filter(s => s.id === id);
    if (scripts.length === 0) return;
    const { code } = scripts[0];
    if (!code.trim()) return;
    for (const tab of this.tabs.values()) {
      if (!this.isScriptableUrl(tab.view.webContents.getURL())) continue;
      if (tab.isSuspended) continue;
      
      const doInject = () => {
        if (tab.view.webContents.executeJavaScriptInIsolatedWorld) {
          return tab.view.webContents.executeJavaScriptInIsolatedWorld(999, [{ code }]);
        } else {
          return tab.view.webContents.executeJavaScript(code, true);
        }
      };
      
      doInject().catch(err => {
        const msg = err?.message ?? String(err);
        if (!msg.includes('ERR_ABORTED') && !msg.includes('Object has been destroyed')) {
          console.warn(`[TabManager] Live inject "${id}" failed in tab ${tab.id}:`, msg);
        }
      });
    }
  }

  /** Inject a single extension's content script into the active tab only. */
  injectExtensionIntoActiveTab(id: string): void {
    const ext = extensionManager.getInstalled(id);
    if (!ext || !ext.enabled) return;
    const scripts = extensionManager.getEnabledContentScripts().filter(s => s.id === id);
    if (scripts.length === 0) return;

    if (!this.activeTabId) return;
    const activeTab = this.tabs.get(this.activeTabId);
    if (!activeTab) return;

    const view = activeTab.view;
    if (view.webContents.isDestroyed()) return;
    if (!this.isScriptableUrl(view.webContents.getURL())) return;

    for (const s of scripts) {
      if (view.webContents.executeJavaScriptInIsolatedWorld) {
        view.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: s.code }]).catch(err => {
          console.error(`[TabManager] Failed to live-inject extension ${id} into active tab:`, err);
        });
      } else {
        view.webContents.executeJavaScript(s.code, true).catch(err => {
          console.error(`[TabManager] Failed to live-inject extension ${id} into active tab:`, err);
        });
      }
    }
  }

  /** Capture a viewport screenshot of the active tab. Returns a PNG data URL. */
  async captureActiveTabScreenshot(): Promise<string | null> {
    if (!this.activeTabId) return null;
    const tab = this.tabs.get(this.activeTabId);
    if (!tab) return null;
    try {
      const image = await tab.view.webContents.capturePage();
      return image.toPNG().length > 0
        ? `data:image/png;base64,${image.toPNG().toString('base64')}`
        : null;
    } catch (err) {
      console.warn('[TabManager] Screenshot capture failed:', err);
      return null;
    }
  }

  // ── Tab State ──────────────────────────────────────────────────────────────

  private syncTabState(id: string): void {
    const tab = this.tabs.get(id);
    if (!tab) return;

    tab.url          = tab.view.webContents.getURL();
    tab.title        = tab.view.webContents.getTitle() || 'New Tab';
    tab.isLoading    = tab.view.webContents.isLoading();
    tab.canGoBack    = tab.view.webContents.canGoBack();
    tab.canGoForward = tab.view.webContents.canGoForward();

    this.sendTabListUpdate();
    if (id === this.activeTabId) {
      this.win.webContents.send('tab:state-updated', {
        id,
        url: tab.url,
        title: tab.title,
        favicon: tab.favicon,
        isLoading: tab.isLoading,
        canGoBack: tab.canGoBack,
        canGoForward: tab.canGoForward,
      });
    }
  }

  private sendTabListUpdate(): void {
    const list = [...this.tabs.values()].map(t => ({
      id: t.id,
      title: t.title,
      favicon: t.favicon,
      url: t.url,
      isLoading: t.isLoading,
      isActive: t.id === this.activeTabId,
      isPinned: t.isPinned,
      isMuted: t.isMuted,
      isSuspended: t.isSuspended,
    }));
    this.win.webContents.send('tabs:list-updated', list);
  }

  // ── IPC ────────────────────────────────────────────────────────────────────

  private registerIpc(): void {
    // Remove any previously registered handlers to prevent duplicate-handler
    // errors if a new TabManager is created (e.g. macOS 'activate' event).
    const handles = [
      'tabs:create', 'tabs:close', 'tabs:activate', 'tabs:navigate',
      'tabs:go-back', 'tabs:go-forward', 'tabs:reload', 'tabs:stop', 'tabs:list',
      'tabs:get-page-content', 'tabs:report-activity',
      'tabs:suspend', 'tabs:resume', 'tabs:capture-screenshot',
      'tabs:inject-extension', 'tabs:duplicate', 'tabs:mute', 'tabs:zoom',
      'tabs:show-context-menu', 'tabs:pin', 'tabs:mute-toggle',
      'browser:get-search-engine', 'browser:set-search-engine', 'browser:get-search-engines',
      'browser:open-settings', 'browser:open-extensions',
    ];
    handles.forEach(ch => ipcMain.removeHandler(ch));

    ipcMain.handle('tabs:create',   (_e, url?: string) => this.createTab(url));
    ipcMain.handle('tabs:close',    (_e, id: string)   => this.closeTab(id));
    ipcMain.handle('tabs:activate', (_e, id: string)   => this.activateTab(id));
    ipcMain.handle('tabs:navigate', (_e, id: string, url: string) => this.navigate(id, url));
    ipcMain.handle('tabs:go-back',  (_e, id: string)   => {
      this.tabs.get(id)?.view.webContents.goBack();
    });
    ipcMain.handle('tabs:go-forward', (_e, id: string) => {
      this.tabs.get(id)?.view.webContents.goForward();
    });
    ipcMain.handle('tabs:reload',   (_e, id: string)   => {
      this.tabs.get(id)?.view.webContents.reload();
    });
    ipcMain.handle('tabs:stop',     (_e, id: string)   => {
      this.tabs.get(id)?.view.webContents.stop();
    });

    // ── Duplicate tab ────────────────────────────────────────────────────────
    ipcMain.handle('tabs:duplicate', (_e, id: string) => {
      const tab = this.tabs.get(id);
      if (tab) this.createTab(tab.url);
    });

    // ── Mute / unmute tab audio ──────────────────────────────────────────────
    ipcMain.handle('tabs:mute', (_e, id: string, muted: boolean) => {
      this.tabs.get(id)?.view.webContents.setAudioMuted(muted);
    });

    // ── Zoom a tab ───────────────────────────────────────────────────────────
    

    ipcMain.handle('tabs:show-history-menu', (_e, tabId: string, type: 'back' | 'forward') => {
      const tab = this.tabs.get(tabId);
      if (!tab) return;
      const wc = tab.view.webContents as any;
      if (!wc.navigationHistory) return;
      const historyItems: Electron.MenuItemConstructorOptions[] = [];
      const currentEntryIndex = wc.navigationHistory.getActiveIndex();
      if (type === 'back' && wc.navigationHistory.canGoBack()) {
        const startIndex = Math.max(0, currentEntryIndex - 15);
        for (let i = currentEntryIndex - 1; i >= startIndex; i--) {
          const entry = wc.navigationHistory.getEntryAtIndex(i);
          if (entry && entry.url && entry.url !== 'about:blank') {
            historyItems.push({ label: entry.title ? (entry.title.length > 30 ? entry.title.substring(0, 30) + '...' : entry.title) : entry.url, sublabel: entry.url.length > 30 ? entry.url.substring(0, 30) + '...' : entry.url, click: () => wc.navigationHistory.goToIndex(i) });
          }
        }
      } else if (type === 'forward' && wc.navigationHistory.canGoForward()) {
        const length = wc.navigationHistory.length();
        const endIndex = Math.min(length, currentEntryIndex + 16);
        for (let i = currentEntryIndex + 1; i < endIndex; i++) {
          const entry = wc.navigationHistory.getEntryAtIndex(i);
          if (entry && entry.url && entry.url !== 'about:blank') {
            historyItems.push({ label: entry.title ? (entry.title.length > 30 ? entry.title.substring(0, 30) + '...' : entry.title) : entry.url, sublabel: entry.url.length > 30 ? entry.url.substring(0, 30) + '...' : entry.url, click: () => wc.navigationHistory.goToIndex(i) });
          }
        }
      }
      if (historyItems.length > 0) {
        historyItems.push({ type: 'separator' });
        historyItems.push({ label: 'Show Full History', click: () => this.win.webContents.send('browser:open-settings') });
        const menu = Menu.buildFromTemplate(historyItems);
        menu.popup({ window: this.win });
      }
    });

    // ── Native tab context menu ──────────────────────────────────────────────
    // Using Electron's native Menu.popup() guarantees the menu renders ABOVE
    // the BrowserView native layer — no renderer z-index trick can achieve this.
    ipcMain.handle('tabs:show-context-menu', (_e, tabId: string, hasClosedTabs: boolean) => {
      const tab = this.tabs.get(tabId);
      if (!tab) return;
      const allTabs = [...this.tabs.values()];
      const tabIndex = allTabs.findIndex(t => t.id === tabId);
      const otherTabs = allTabs.filter(t => t.id !== tabId);

      const menuItems: Electron.MenuItemConstructorOptions[] = [
        {
          label: tab.isPinned ? 'Unpin Tab' : 'Pin Tab',
          click: () => {
            tab.isPinned = !tab.isPinned;
            this.sendTabListUpdate();
          },
        },
        {
          label: tab.isMuted ? 'Unmute Tab' : 'Mute Tab',
          enabled: !tab.isSuspended,
          click: () => {
            tab.isMuted = !tab.isMuted;
            tab.view.webContents.setAudioMuted(tab.isMuted);
            this.sendTabListUpdate();
          },
        },
        { type: 'separator' },
        {
          label: 'Reload Tab',
          enabled: !tab.isSuspended,
          click: () => tab.view.webContents.reload(),
        },
        {
          label: 'Duplicate Tab',
          click: () => this.createTab(tab.url),
        },
        { type: 'separator' },
        {
          label: 'Reopen Last Closed Tab',
          enabled: hasClosedTabs,
          click: () => this.win.webContents.send('tabs:reopen-closed'),
        },
        { type: 'separator' },
        {
          label: 'Close Tab',
          enabled: !tab.isPinned,
          click: () => this.closeTab(tabId),
        },
        {
          label: 'Close Other Tabs',
          enabled: otherTabs.filter(t => !t.isPinned).length > 0,
          click: () => {
            otherTabs.filter(t => !t.isPinned).forEach(t => this.closeTab(t.id));
          },
        },
        {
          label: 'Close Tabs to the Right',
          enabled: tabIndex < allTabs.length - 1,
          click: () => {
            allTabs.slice(tabIndex + 1).filter(t => !t.isPinned).forEach(t => this.closeTab(t.id));
          },
        },
      ];

      const ctxMenu = Menu.buildFromTemplate(menuItems);
      ctxMenu.popup({ window: this.win });
    });

    // ── Pin / Mute toggle via IPC ─────────────────────────────────────────────
    ipcMain.handle('tabs:pin', (_e, id: string, pinned: boolean) => {
      const tab = this.tabs.get(id);
      if (tab) {
        tab.isPinned = pinned;
        this.sendTabListUpdate();
      }
    });
    ipcMain.handle('tabs:mute-toggle', (_e, id: string) => {
      const tab = this.tabs.get(id);
      if (tab) {
        tab.isMuted = !tab.isMuted;
        tab.view.webContents.setAudioMuted(tab.isMuted);
        this.sendTabListUpdate();
      }
    });

    ipcMain.handle('tabs:list',     () => {
      return [...this.tabs.values()].map(t => ({
        id: t.id, title: t.title, favicon: t.favicon, url: t.url,
        isLoading: t.isLoading, isActive: t.id === this.activeTabId,
      }));
    });
    // Extract page text content for the Reader Mode page
    ipcMain.handle('tabs:get-page-content', async (_e, tabId: string) => {
      const tab = this.tabs.get(tabId);
      if (!tab) return null;
      try {
        const result = await tab.view.webContents.executeJavaScript(`
          (function() {
            // Extract article / main content
            const article  = document.querySelector('article, main, [role="main"], .article, .post-content, .entry-content');
            const container = article || document.body;
            // Remove script/style/nav nodes
            const clone = container.cloneNode(true);
            clone.querySelectorAll('script,style,nav,header,footer,aside,[aria-hidden="true"],.ads,.ad').forEach(n=>n.remove());
            const text = clone.innerText || clone.textContent || '';
            return {
              title: document.title,
              text: text.trim().slice(0, 60000),
              bodyHtml: clone.innerHTML.slice(0, 120000),
            };
          })()
        `);
        return result;
      } catch (err) {
        return null;
      }
    });
    ipcMain.on('sidebar:toggle', (_e, open: boolean) => {
      this.setSidebarState(open);
    });

    // ── Tab Suspender ────────────────────────────────────────────────────────
    // Content scripts report activity so the idle timer can be reset
    ipcMain.on('tabs:report-activity', (event) => {
      this.reportTabActivity(event.sender.id);
    });
    ipcMain.handle('tabs:suspend', (_e, id: string) => this.suspendTab(id));
    ipcMain.handle('tabs:resume',  (_e, id: string) => this.resumeTab(id));

    // ── Screenshot capture ───────────────────────────────────────────────────
    ipcMain.handle('tabs:capture-screenshot', () => this.captureActiveTabScreenshot());

    // ── Live extension injection ─────────────────────────────────────────────
    // Called after an extension is toggled on to inject it into open tabs immediately
    ipcMain.handle('tabs:inject-extension', (_e, id: string) => {
      this.injectExtensionIntoAllTabs(id);
    });

    // ── Search engine settings ───────────────────────────────────────────────
    ipcMain.handle('browser:get-search-engine', () => this.getSearchEngine());
    ipcMain.handle('browser:set-search-engine', (_e, key: string) => {
      this.setSearchEngine(key);
      return this.getSearchEngine();
    });
    ipcMain.handle('browser:get-search-engines', () => {
      return Object.entries(SEARCH_ENGINES).map(([key, val]) => ({
        key,
        name: val.name,
        url:  val.url,
      }));
    });
    ipcMain.handle('browser:open-settings', () => {
      this.openSettingsPage();
    });
    ipcMain.handle('browser:open-extensions', () => {
      this.openExtensionsPage();
    });
  }

  /** Open Settings in the active tab (or a new tab if settings isn't already open). */
  openSettingsPage(): void {
    for (const tab of this.tabs.values()) {
      if (tab.url === 'space://settings') {
        this.activateTab(tab.id);
        return;
      }
    }
    this.createTab('space://settings');
  }

  /** Open Extensions in the active tab (or a new tab if extensions isn't already open). */
  openExtensionsPage(): void {
    for (const tab of this.tabs.values()) {
      if (tab.url === 'space://extensions') {
        this.activateTab(tab.id);
        return;
      }
    }
    this.createTab('space://extensions');
  }
}


