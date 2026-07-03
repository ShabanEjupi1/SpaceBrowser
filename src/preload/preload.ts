/**
 * Space Browser – Preload Script
 * --------------------------------
 * Exposes a carefully scoped API to the renderer process
 * via contextBridge. No Node.js APIs are directly exposed.
 */

import { contextBridge, ipcRenderer } from 'electron';

// ── Type definitions (duplicated here so renderer can use them without Node) ──

export type TokenEventHandler = (data: {
  token: string;
  isFinal: boolean;
  requestId: string;
  error?: string;
}) => void;

// ────────────────────────────
// Exposed API
// ────────────────────────────

contextBridge.exposeInMainWorld('spaceAPI', {

  // ── AI Engine ────────────────────────────

  ai: {
    scanModels: () =>
      ipcRenderer.invoke('ai:scan-models'),

    listModels: () =>
      ipcRenderer.invoke('ai:list-models'),

    addModel: (sourcePath: string, modelId?: string) =>
      ipcRenderer.invoke('ai:add-model', sourcePath, modelId),

    removeModel: (modelId: string) =>
      ipcRenderer.invoke('ai:remove-model', modelId),

    loadModel: (modelId: string, params?: object) =>
      ipcRenderer.invoke('ai:load-model', modelId, params),

    unloadModel: () =>
      ipcRenderer.invoke('ai:unload-model'),

    isLoaded: () =>
      ipcRenderer.invoke('ai:is-loaded'),

    getActiveModelId: () =>
      ipcRenderer.invoke('ai:get-active-model-id'),

    getModelMetadata: () =>
      ipcRenderer.invoke('ai:get-model-metadata'),

    countTokens: (text: string) =>
      ipcRenderer.invoke('ai:count-tokens', text),

    chat: (messages: object[], params: object, requestId: string) =>
      ipcRenderer.invoke('ai:chat', messages, params, requestId),

    generate: (prompt: string, params: object, requestId: string) =>
      ipcRenderer.invoke('ai:generate', prompt, params, requestId),

    abort: () =>
      ipcRenderer.invoke('ai:abort'),

    getSettings: () =>
      ipcRenderer.invoke('ai:get-settings'),

    updateSettings: (patch: object) =>
      ipcRenderer.invoke('ai:update-settings', patch),

    // ── Ollama ──────────────────────────────────────────────────────────────

    /** Returns true if Ollama is installed on this machine */
    ollamaAvailable: () =>
      ipcRenderer.invoke('ai:ollama-available'),

    /** Returns all Ollama models found in the local blob store */
    ollamaModels: () =>
      ipcRenderer.invoke('ai:ollama-models'),

    /** Loads an Ollama model by its id (e.g. "ollama:llama3.2:3b") */
    loadOllamaModel: (ollamaId: string, params?: object) =>
      ipcRenderer.invoke('ai:load-ollama-model', ollamaId, params),

    /** Subscribe to token stream events */
    onToken: (handler: TokenEventHandler) => {
      const listener = (_event: Electron.IpcRendererEvent, data: any) => handler(data);
      ipcRenderer.on('ai:token', listener);
      return () => ipcRenderer.removeListener('ai:token', listener);
    },
  },

  // ── Tabs ────────────────────────────────────────────────────────────────────

  tabs: {
    create: (url?: string) =>
      ipcRenderer.invoke('tabs:create', url),

    close: (id: string) =>
      ipcRenderer.invoke('tabs:close', id),

    activate: (id: string) =>
      ipcRenderer.invoke('tabs:activate', id),

    navigate: (id: string, url: string) =>
      ipcRenderer.invoke('tabs:navigate', id, url),

    goBack: (id: string) =>
      ipcRenderer.invoke('tabs:go-back', id),

    goForward: (id: string) =>
      ipcRenderer.invoke('tabs:go-forward', id),

    reload: (id: string) =>
      ipcRenderer.invoke('tabs:reload', id),

    stop: (id: string) =>
      ipcRenderer.invoke('tabs:stop', id),

    list: () =>
      ipcRenderer.invoke('tabs:list'),

    getPageContent: (tabId: string) =>
      ipcRenderer.invoke('tabs:get-page-content', tabId),

    /** Report user activity in this tab (used by Tab Suspender to reset idle timer) */
    reportActivity: () =>
      ipcRenderer.send('tabs:report-activity'),

    /** Suspend a tab by id (Tab Suspender) */
    suspend: (id: string) =>
      ipcRenderer.invoke('tabs:suspend', id),

    /** Resume a suspended tab by id */
    resume: (id: string) =>
      ipcRenderer.invoke('tabs:resume', id),

    /** Capture a screenshot of the active tab viewport — returns a PNG data URL */
    captureScreenshot: () =>
      ipcRenderer.invoke('tabs:capture-screenshot'),

    /** Inject an already-installed extension into all open tabs immediately */
    injectExtension: (id: string) =>
      ipcRenderer.invoke('tabs:inject-extension', id),

    /** Duplicate a tab by its id */
    duplicate: (id: string) =>
      ipcRenderer.invoke('tabs:duplicate', id),

    /** Mute or unmute a tab's audio */
    mute: (id: string, muted: boolean) =>
      ipcRenderer.invoke('tabs:mute', id, muted),

    /** Set the zoom factor for a tab (1.0 = 100%) */
    zoom: (id: string, factor: number) =>
      ipcRenderer.invoke('tabs:zoom', id, factor),

    /** Show the native OS tab context menu for a given tab id */
    showHistoryMenu: (tabId: string, type: 'back' | 'forward') =>
      ipcRenderer.invoke('tabs:show-history-menu', tabId, type),

    showContextMenu: (tabId: string, hasClosedTabs: boolean) =>
      ipcRenderer.invoke('tabs:show-context-menu', tabId, hasClosedTabs),

    /** Pin or unpin a tab */
    pin: (id: string, pinned: boolean) =>
      ipcRenderer.invoke('tabs:pin', id, pinned),

    /** Move active tab audio muted state */
    muteToggle: (id: string) =>
      ipcRenderer.invoke('tabs:mute-toggle', id),

    onListUpdated: (handler: (tabs: any[]) => void) => {
      const listener = (_: any, tabs: any[]) => handler(tabs);
      ipcRenderer.on('tabs:list-updated', listener);
      return () => ipcRenderer.removeListener('tabs:list-updated', listener);
    },

    onActivated: (handler: (id: string) => void) => {
      const listener = (_: any, id: string) => handler(id);
      ipcRenderer.on('tab:activated', listener);
      return () => ipcRenderer.removeListener('tab:activated', listener);
    },

    onStateUpdated: (handler: (state: any) => void) => {
      const listener = (_: any, state: any) => handler(state);
      ipcRenderer.on('tab:state-updated', listener);
      return () => ipcRenderer.removeListener('tab:state-updated', listener);
    },
  },

  // ── Window Controls ──────────────────────────────────────────────────────────

  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximizeToggle: () => ipcRenderer.send('window:maximize-toggle'),
    close: () => ipcRenderer.send('window:close'),
    onStateChanged: (handler: (state: string) => void) => {
      const listener = (_: any, state: string) => handler(state);
      ipcRenderer.on('window-state-changed', listener);
      return () => ipcRenderer.removeListener('window-state-changed', listener);
    },
  },

  // ── Sidebar ──────────────────────────────────────────────────────────────────

  sidebar: {
    toggle: (open: boolean) => ipcRenderer.send('sidebar:toggle', open),
    onToggle: (handler: () => void) => {
      const listener = () => handler();
      ipcRenderer.on('sidebar:toggle', listener);
      return () => ipcRenderer.removeListener('sidebar:toggle', listener);
    },
  },

  // ── Dialogs ──────────────────────────────────────────────────────────────────

  dialog: {
    openGGUF: () =>
      ipcRenderer.invoke('dialog:open-gguf'),
    selectModelsDir: () =>
      ipcRenderer.invoke('dialog:select-models-dir'),
  },

  // ── Browser settings ──────────────────────────────────────────────────────────

  browser: {
    getSearchEngine: () =>
      ipcRenderer.invoke('browser:get-search-engine'),
    setSearchEngine: (key: string) =>
      ipcRenderer.invoke('browser:set-search-engine', key),
    getSearchEngines: () =>
      ipcRenderer.invoke('browser:get-search-engines'),
    openSettings: () =>
      ipcRenderer.invoke('browser:open-settings'),
    openExtensions: () =>
      ipcRenderer.invoke('browser:open-extensions'),
    /** Fetch HTML via main-process net module — bypasses renderer-level firewalls */
    fetchHtml: (url: string) =>
      ipcRenderer.invoke('browser:fetch-html', url),
    /**
     * Fetch a fully JS-rendered page via a hidden BrowserWindow.
     * Use this for pages (like Google AI overviews) where the content
     * is injected by JavaScript and is not present in the raw HTML.
     * Slower than fetchHtml (~4–8 s) but returns the live DOM.
     */
    fetchRendered: (url: string) =>
      ipcRenderer.invoke('browser:fetch-rendered', url),
  },

  // ── Chess ────────────────────────────────────────────────────────────────────

  chess: {
    loadGames: () =>
      ipcRenderer.invoke('chess:load-games'),
    saveGames: (games: any[]) =>
      ipcRenderer.invoke('chess:save-games', games),
    serverStart: () =>
      ipcRenderer.invoke('chess:server-start'),
    serverPort: () =>
      ipcRenderer.invoke('chess:server-port'),
  },

  // ── Auto-Updater ─────────────────────────────────────────────────────────────

  updater: {
    /** Manually trigger an update check */
    check: () =>
      ipcRenderer.invoke('update:check'),

    /** Start downloading the available update */
    download: () =>
      ipcRenderer.invoke('update:download'),

    /** Quit the app and install the downloaded update */
    install: () =>
      ipcRenderer.invoke('update:install'),

    /** Get current update prefs (channel, lastChecked, etc.) */
    getPrefs: () =>
      ipcRenderer.invoke('update:get-prefs'),

    /** Switch update channel: 'stable' | 'slow' | 'lts' */
    setChannel: (channel: 'stable' | 'slow' | 'lts') =>
      ipcRenderer.invoke('update:set-channel', channel),

    /** Get the current app version string */
    getVersion: () =>
      ipcRenderer.invoke('update:get-version'),

    /**
     * Subscribe to update lifecycle events.
     * Events: 'checking' | 'available' | 'up-to-date' | 'channel-hold' |
     *         'download-progress' | 'downloaded' | 'error'
     */
    onStatus: (handler: (data: { event: string; payload?: any }) => void) => {
      const listener = (_: any, data: any) => handler(data);
      ipcRenderer.on('update:status', listener);
      return () => ipcRenderer.removeListener('update:status', listener);
    },
  },

  // ── App Events ───────────────────────────────────────────────────────────────

  on: (channel: string, handler: (...args: any[]) => void) => {
    const allowed = [
      'open-preferences',
      'ai:open-chat',
      'ai:summarize-page',
      'ai:ask-selection',
      'ai:open-model-manager',
      'tabs:close-active',
      'tabs:reopen-closed',
      'open-file',
      'sidebar:toggle',
      'open-settings',
      'bookmark:toggle',
      'theme:changed',
    ];
    if (!allowed.includes(channel)) return () => {};
    const listener = (_: any, ...args: any[]) => handler(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },

  // ── Bookmarks / Favorites ─────────────────────────────────────────────────

  bookmarks: {
    list: () => ipcRenderer.invoke('bookmarks:list'),
    add: (bookmark: { url: string; title: string; favicon?: string; tags?: string[] }) =>
      ipcRenderer.invoke('bookmarks:add', bookmark),
    remove: (id: string) => ipcRenderer.invoke('bookmarks:remove', id),
    update: (id: string, patch: object) => ipcRenderer.invoke('bookmarks:update', id, patch),
    isBookmarked: (url: string) => ipcRenderer.invoke('bookmarks:is-bookmarked', url),
  },

  // ── Passwords ─────────────────────────────────────────────────────────────

  passwords: {
    list: () => ipcRenderer.invoke('passwords:list'),
    getForUrl: (url: string) => ipcRenderer.invoke('passwords:get-for-url', url),
    save: (entry: { url: string; username: string; password: string }) =>
      ipcRenderer.invoke('passwords:save', entry),
    remove: (id: string) => ipcRenderer.invoke('passwords:remove', id),
  },

  // ── Browser Preferences ───────────────────────────────────────────────────

  prefs: {
    get: () => ipcRenderer.invoke('prefs:get'),
    set: (patch: object) => ipcRenderer.invoke('prefs:set', patch),
    reset: () => ipcRenderer.invoke('prefs:reset'),
  },

  // ── Games ────────────────────────────────────────────────────────────────────
  // Download a built-in game as a standalone shareable HTML file

  games: {
    /**
     * Download a built-in game as a standalone HTML file.
     * Opens a system save-dialog so the user can choose the destination.
     * Returns { ok: boolean, filePath?: string, error?: string }
     */
    download: (gameId: string, gameTitle: string) =>
      ipcRenderer.invoke('games:download', gameId, gameTitle),

    /**
     * Download a built-in game as a Windows .exe launcher (self-contained).
     * Uses the .NET Framework C# compiler (csc.exe) to compile a tiny launcher
     * that embeds the game HTML as a base64 string.
     * Falls back to an .html file if the compiler is not available.
     * Returns { ok: boolean, filePath?: string, error?: string, fallbackHtml?: boolean }
     */
    downloadExe: (gameId: string, gameTitle: string) =>
      ipcRenderer.invoke('games:download-exe', gameId, gameTitle),
  },

  // ── Extensions ────────────────────────────────────────────────────────────────

  extensions: {
    /** List all installed extensions */
    list: () => ipcRenderer.invoke('extensions:list'),

    /** List marketplace catalogue (includes _installed/_enabled flags) */
    marketplace: () => ipcRenderer.invoke('extensions:marketplace'),

    /** Install an extension from the built-in catalogue */
    install: (id: string) => ipcRenderer.invoke('extensions:install', id),

    /** Uninstall an extension by id */
    uninstall: (id: string) => ipcRenderer.invoke('extensions:uninstall', id),

    /** Toggle or explicitly set enabled state */
    toggle: (id: string, enabled?: boolean) =>
      ipcRenderer.invoke('extensions:toggle', id, enabled),

    /** Pin or unpin an extension to the browser toolbar */
    setPin: (id: string, pinned: boolean) =>
      ipcRenderer.invoke('extensions:set-pin', id, pinned),

    /** Get all enabled content scripts for injection */
    contentScripts: () => ipcRenderer.invoke('extensions:content-scripts'),

    /** Show context menu for a pinned extension dropdown */
    showMenu: (id: string) =>
      ipcRenderer.invoke('extensions:show-menu', id),
  },
});

