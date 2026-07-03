/**
 * Space Browser â€“ IPC Handlers
 * -----------------------------------------------
 * All main-process IPC handlers for AI engine and browser features.
 * Renderer communicates via the preload bridge.
 */

import { ipcMain, dialog, BrowserWindow, net, app, shell } from 'electron';
import { AIEngine, ChatMessage, GenerationParams } from '../ai-engine/AIEngine';
import { extensionManager } from './extension-manager';
import Store from 'electron-store';
import path from 'path';
import fs from 'fs';

// â”€â”€ Shared reference to TabManager (set after it is created) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// We use a late-bound setter instead of passing the instance in the constructor
// so the module remains importable before TabManager is instantiated.
let _tabManagerRef: import('./tab-manager').TabManager | null = null;

export function setTabManagerRef(tm: import('./tab-manager').TabManager): void {
  _tabManagerRef = tm;
}

// â”€â”€ Shared persistent stores â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface Bookmark {
  id: string;
  url: string;
  title: string;
  favicon: string;
  createdAt: number;
  tags: string[];
}

interface SavedPassword {
  id: string;
  url: string;
  username: string;
  password: string; // stored encrypted via electron-store's built-in encryption
  createdAt: number;
}

interface BrowserPrefs {
  searchEngine: string;
  homepage: string;
  theme: 'dark' | 'light' | 'system';
  showBookmarksBar: boolean;
  blockAds: boolean;
  savePasswords: boolean;
  defaultZoom: number;
  language: string;
}

const bookmarksStore = new Store<{ bookmarks: Bookmark[] }>({
  name: 'bookmarks',
  defaults: { bookmarks: [] },
});

const passwordStore = new Store<{ passwords: SavedPassword[] }>({
  name: 'passwords',
  defaults: { passwords: [] },
  encryptionKey: 'space-browser-key-v1',
});

const prefsStore = new Store<BrowserPrefs>({
  name: 'browser-prefs',
  defaults: {
    searchEngine: 'space',
    homepage: 'space://newtab',
    theme: 'dark',
    showBookmarksBar: false,
    blockAds: false,
    savePasswords: true,
    defaultZoom: 1.0,
    language: 'en-US',
  },
});

export function registerIpcHandlers(engine: AIEngine): void {

  // â”€â”€ Chess Game History â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const chessStore = new Store<{ games: any[] }>({
    name: 'chess-history',
    defaults: { games: [] },
  });

  ipcMain.handle('chess:load-games', () => {
    return chessStore.get('games', []);
  });

  ipcMain.handle('chess:save-games', (_event, games: any[]) => {
    chessStore.set('games', games);
  });

  // â”€â”€ Model Management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  ipcMain.handle('ai:scan-models', async () => {
    return engine.scanModels();
  });

  ipcMain.handle('ai:list-models', () => {
    return engine.listModels();
  });

  ipcMain.handle('ai:add-model', async (_event, sourcePath: string, modelId?: string) => {
    return engine.addModel(sourcePath, modelId);
  });

  ipcMain.handle('ai:remove-model', async (_event, modelId: string) => {
    return engine.removeModel(modelId);
  });

  ipcMain.handle('ai:load-model', async (_event, modelId: string, params?: Partial<GenerationParams>) => {
    return engine.loadModel(modelId, params);
  });

  ipcMain.handle('ai:unload-model', () => {
    engine.unloadModel();
  });

  ipcMain.handle('ai:is-loaded', () => {
    return engine.isLoaded();
  });

  ipcMain.handle('ai:get-active-model-id', () => {
    return engine.getActiveModelId();
  });

  ipcMain.handle('ai:get-model-metadata', () => {
    return engine.getModelMetadata();
  });

  ipcMain.handle('ai:count-tokens', (_event, text: string) => {
    return engine.countTokens(text);
  });

  // â”€â”€ Inference (streaming) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Chat inference with streaming.
   * Tokens are sent back via IPC event: 'ai:token' with { token, isFinal, requestId }
   */
  ipcMain.handle('ai:chat', async (event, messages: ChatMessage[], params: Partial<GenerationParams>, requestId: string) => {

    try {
      await engine.chat(messages, params, (token, isFinal) => {
        event.sender.send('ai:token', { token, isFinal, requestId });
      });
    } catch (err: any) {
      event.sender.send('ai:token', {
        token: '',
        isFinal: true,
        requestId,
        error: err?.message ?? 'Unknown error',
      });
    }
  });

  /**
   * Raw generate (no chat template).
   */
  ipcMain.handle('ai:generate', async (event, prompt: string, params: Partial<GenerationParams>, requestId: string) => {
    try {
      await engine.generate(prompt, params, (token, isFinal) => {
        event.sender.send('ai:token', { token, isFinal, requestId });
      });
    } catch (err: any) {
      event.sender.send('ai:token', {
        token: '',
        isFinal: true,
        requestId,
        error: err?.message ?? 'Unknown error',
      });
    }
  });

  ipcMain.handle('ai:abort', () => {
    engine.abort();
  });

  // â”€â”€ Settings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  ipcMain.handle('ai:get-settings', () => {
    return engine.getSettings();
  });

  ipcMain.handle('ai:update-settings', (_event, patch: any) => {
    engine.updateSettings(patch);
  });

  // â”€â”€ Ollama Integration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /** Returns whether Ollama is installed on this machine */
  ipcMain.handle('ai:ollama-available', () => {
    return engine.hasOllama();
  });

  /** Returns all Ollama models found locally */
  ipcMain.handle('ai:ollama-models', () => {
    return engine.getOllamaModels();
  });

  /** Loads an Ollama model blob directly into the inference engine */
  ipcMain.handle('ai:load-ollama-model', async (_event, ollamaId: string, params?: Partial<GenerationParams>) => {
    return engine.loadOllamaModel(ollamaId, params);
  });

  // â”€â”€ File Dialogs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  ipcMain.handle('dialog:open-gguf', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select GGUF Model File',
      filters: [
        { name: 'GGUF Models', extensions: ['gguf'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('dialog:select-models-dir', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select Models Directory',
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // â”€â”€ Window Controls â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  ipcMain.on('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.on('window:maximize-toggle', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    win.isMaximized() ? win.unmaximize() : win.maximize();
  });

  ipcMain.on('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  // â”€â”€ Bookmarks / Favorites â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  ipcMain.handle('bookmarks:list', () => bookmarksStore.get('bookmarks', []));

  ipcMain.handle('bookmarks:add', (_e, bookmark: Omit<Bookmark, 'id' | 'createdAt'>) => {
    const all = bookmarksStore.get('bookmarks', []);
    // avoid duplicates
    const existing = all.find(b => b.url === bookmark.url);
    if (existing) return existing;
    const entry: Bookmark = {
      id: `bm-${Date.now()}`,
      url: bookmark.url,
      title: bookmark.title || bookmark.url,
      favicon: bookmark.favicon || '',
      tags: bookmark.tags || [],
      createdAt: Date.now(),
    };
    bookmarksStore.set('bookmarks', [entry, ...all]);
    return entry;
  });

  ipcMain.handle('bookmarks:remove', (_e, id: string) => {
    const all = bookmarksStore.get('bookmarks', []);
    bookmarksStore.set('bookmarks', all.filter(b => b.id !== id));
  });

  ipcMain.handle('bookmarks:update', (_e, id: string, patch: Partial<Bookmark>) => {
    const all = bookmarksStore.get('bookmarks', []);
    const idx = all.findIndex(b => b.id === id);
    if (idx !== -1) {
      all[idx] = { ...all[idx], ...patch };
      bookmarksStore.set('bookmarks', all);
    }
  });

  ipcMain.handle('bookmarks:is-bookmarked', (_e, url: string) => {
    const all = bookmarksStore.get('bookmarks', []);
    return all.find(b => b.url === url) ?? null;
  });

  // â”€â”€ Passwords â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  ipcMain.handle('passwords:list', () => {
    return passwordStore.get('passwords', []).map(p => ({
      id: p.id, url: p.url, username: p.username, createdAt: p.createdAt,
      // never expose raw password in list
    }));
  });

  ipcMain.handle('passwords:get-for-url', (_e, url: string) => {
    const host = (() => { try { return new URL(url).hostname; } catch { return url; } })();
    return passwordStore.get('passwords', [])
      .filter(p => { try { return new URL(p.url).hostname === host; } catch { return false; } })
      .map(p => ({ id: p.id, url: p.url, username: p.username, password: p.password }));
  });

  ipcMain.handle('passwords:save', (_e, entry: Omit<SavedPassword, 'id' | 'createdAt'>) => {
    const all = passwordStore.get('passwords', []);
    // update if same url+username exists
    const idx = all.findIndex(p => p.url === entry.url && p.username === entry.username);
    if (idx !== -1) {
      all[idx] = { ...all[idx], password: entry.password };
      passwordStore.set('passwords', all);
      return all[idx];
    }
    const pw: SavedPassword = { id: `pw-${Date.now()}`, ...entry, createdAt: Date.now() };
    passwordStore.set('passwords', [pw, ...all]);
    return pw;
  });

  ipcMain.handle('passwords:remove', (_e, id: string) => {
    const all = passwordStore.get('passwords', []);
    passwordStore.set('passwords', all.filter(p => p.id !== id));
  });

  // â”€â”€ Browser Preferences â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  ipcMain.handle('prefs:get', () => prefsStore.store);

  ipcMain.handle('prefs:set', (_e, patch: Partial<BrowserPrefs>) => {
    const { _broadcastTheme, ...cleanPatch } = patch as any;
    for (const [k, v] of Object.entries(cleanPatch)) {
      (prefsStore as any).set(k, v);
    }
    // Broadcast theme change to the React shell window so it applies data-theme
    if ('theme' in cleanPatch) {
      const theme = (cleanPatch as any).theme as string;
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send('theme:changed', theme);
        }
      });
    }
    return prefsStore.store;
  });

  ipcMain.handle('prefs:reset', () => {
    prefsStore.clear();
    return prefsStore.store;
  });

  // â”€â”€ Extensions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /** List all installed extensions */
  ipcMain.handle('extensions:list', () => extensionManager.listInstalled());

  /** List marketplace catalogue (includes _installed/_enabled flags) */
  ipcMain.handle('extensions:marketplace', () => extensionManager.listMarketplace());

  /** Install an extension by id from the built-in catalogue */
  ipcMain.handle('extensions:install', (_e, id: string) => {
    const result = extensionManager.install(id);
    // Start Tab Suspender immediately when it is first installed
    if (id === 'space-tab-suspender' && result.enabled) {
      _tabManagerRef?.startTabSuspender();
    }
    // Live-inject the content script into all open tabs
    if (result.enabled) {
      _tabManagerRef?.injectExtensionIntoAllTabs(id);
    }
    return result;
  });

  /** Uninstall an extension by id */
  ipcMain.handle('extensions:uninstall', (_e, id: string) => {
    extensionManager.uninstall(id);
  });

  /** Enable or disable an extension. Pass `enabled` to set explicitly. */
  ipcMain.handle('extensions:toggle', (_e, id: string, enabled?: boolean) => {
    const result = extensionManager.toggle(id, enabled);
    if (!result) return result;

    // â”€â”€ Tab Suspender: start/stop the idle timer when toggled â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (id === 'space-tab-suspender') {
      if (result.enabled) {
        _tabManagerRef?.startTabSuspender();
      } else {
        _tabManagerRef?.stopTabSuspender();
      }
    }

    // â”€â”€ Live injection: when any extension is enabled, immediately inject
    //    its content script into all currently open external tabs so the user
    //    doesn't have to reload every page.
    if (result.enabled) {
      _tabManagerRef?.injectExtensionIntoAllTabs(id);
    }

    return result;
  });

  /** Pin or unpin an extension to the browser toolbar */
  ipcMain.handle('extensions:set-pin', (_e, id: string, pinned: boolean) => {
    return extensionManager.setPin(id, pinned);
  });

  /** Get all enabled content scripts (for injection into new tabs) */
  ipcMain.handle('extensions:content-scripts', () =>
    extensionManager.getEnabledContentScripts(),
  );

  /** Show extension context menu (for toolbar buttons) */
  ipcMain.handle('extensions:show-menu', async (e, id: string) => {
    const exts = extensionManager.listInstalled();
    const ext = exts.find(x => x.id === id);
    if (!ext) return null;

    return new Promise((resolve) => {
      const { Menu } = require('electron');
      const template = [
        { label: `Extension: ${(ext as any).name}`, enabled: false },
        { label: (ext as any).description || 'No description', enabled: false },
        { type: 'separator' },
        {
          label: 'Run on this page',
          enabled: ext.enabled,
          click: () => {
            _tabManagerRef?.injectExtensionIntoActiveTab(id);
            resolve('activate');
          }
        },
        {
          label: ext.enabled ? 'Enabled' : 'Disabled',
          type: 'checkbox',
          checked: ext.enabled,
          click: () => {
            const res = extensionManager.toggle(id, !ext.enabled);
            if (res && res.enabled) {
              _tabManagerRef?.injectExtensionIntoAllTabs(id);
            }
            resolve('toggle');
          }
        },
        { type: 'separator' },
        {
          label: 'Unpin from Toolbar',
          click: () => {
            extensionManager.setPin(id, false);
            resolve('unpin');
          }
        },
        { type: 'separator' },
        {
          label: 'Export as Chrome Extension...',
          click: async () => {
            const { dialog } = require('electron');
            const fs = require('fs');
            const path = require('path');
            
            const result = await dialog.showOpenDialog({
              title: 'Select Export Directory',
              properties: ['openDirectory', 'createDirectory']
            });
            
            if (!result.canceled && result.filePaths.length > 0) {
              const exportPath = path.join(result.filePaths[0], ext.id);
              if (!fs.existsSync(exportPath)) {
                fs.mkdirSync(exportPath, { recursive: true });
              }
              
              const fullExt = ext as any;
              
              const manifest = {
                manifest_version: 3,
                name: fullExt.name || ext.id,
                version: fullExt.version || '1.0.0',
                description: fullExt.description || '',
                content_scripts: fullExt.contentScript ? [{
                  matches: ['<all_urls>'],
                  js: ['content.js']
                }] : undefined,
                background: fullExt.backgroundScript ? {
                  service_worker: 'background.js'
                } : undefined,
                permissions: fullExt.permissions || []
              };
              
              fs.writeFileSync(path.join(exportPath, 'manifest.json'), JSON.stringify(manifest, null, 2));
              if (fullExt.contentScript) fs.writeFileSync(path.join(exportPath, 'content.js'), fullExt.contentScript);
              if (fullExt.backgroundScript) fs.writeFileSync(path.join(exportPath, 'background.js'), fullExt.backgroundScript);
            }
            resolve('export');
          }
        },
        {
          label: 'Manage Extensions...',
          click: () => {
            _tabManagerRef?.openExtensionsPage();
            resolve('manage');
          }
        }
      ];
      // @ts-ignore
      const menu = Menu.buildFromTemplate(template);
      menu.once('menu-will-close', () => {
        setTimeout(() => resolve('closed'), 100);
      });
      menu.popup({ window: BrowserWindow.fromWebContents(e.sender)! });
    });
  });

  // â”€â”€ Game Downloader â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Exports a built-in game as a standalone HTML file the user can share.
  // The file is entirely self-contained â€“ no server or Space install needed.

  ipcMain.handle('games:download', async (_e, gameId: string, gameTitle: string) => {
    // Locate the source HTML file
    const isDev = !app.isPackaged || process.env.SPACE_DEV_MODE === '1';
    const rendererRoot = isDev
      ? path.join(__dirname, '../../src/renderer')
      : path.join(__dirname, '../renderer');

    const sourceFile = path.join(rendererRoot, `${gameId}.html`);
    if (!fs.existsSync(sourceFile)) {
      return { ok: false, error: `Game file not found: ${gameId}.html` };
    }

    // Ask the user where to save
    const result = await dialog.showSaveDialog({
      title: `Save "${gameTitle}" as standalone game`,
      defaultPath: path.join(app.getPath('downloads'), `${gameTitle.replace(/[^a-z0-9]/gi, '_')}.html`),
      filters: [
        { name: 'Standalone HTML Game', extensions: ['html'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (result.canceled || !result.filePath) {
      return { ok: false, error: 'cancelled' };
    }

    try {
      let html = fs.readFileSync(sourceFile, 'utf-8');

      // Stamp a banner into the <head> so the recipient knows where it came from
      const banner = `\n  <!-- Exported from Space Browser Â· ${new Date().toISOString().split('T')[0]} -->\n  <!-- Play offline â€” no installation required, just open in any browser. -->\n`;
      html = html.replace('<head>', `<head>${banner}`);

      fs.writeFileSync(result.filePath, html, 'utf-8');

      // Reveal the file in Explorer / Finder
      shell.showItemInFolder(result.filePath);

      return { ok: true, filePath: result.filePath };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'Write failed' };
    }
  });

  // â”€â”€ Game EXE Downloader â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Packages a built-in game as a self-contained Windows .exe launcher.
  // Strategy: compile a tiny C# stub with the game HTML embedded as a resource,
  // using csc.exe (the .NET Framework C# compiler bundled with Windows since XP).
  // Falls back gracefully to HTML if csc.exe is not available.

  ipcMain.handle('games:download-exe', async (_e, gameId: string, gameTitle: string): Promise<{ ok: boolean; filePath?: string; error?: string; fallbackHtml?: boolean }> => {
    const { execFile } = require('child_process') as typeof import('child_process');
    const os = require('os') as typeof import('os');

    const isDev2 = !app.isPackaged || process.env.SPACE_DEV_MODE === '1';
    const rendererRoot = isDev2
      ? path.join(__dirname, '../../src/renderer')
      : path.join(__dirname, '../renderer');

    const sourceFile = path.join(rendererRoot, `${gameId}.html`);
    if (!fs.existsSync(sourceFile)) {
      return { ok: false, error: `Game file not found: ${gameId}.html` };
    }

    // Ask user where to save the .exe
    const saveResult = await dialog.showSaveDialog({
      title: `Save "${gameTitle}" as Windows game (.exe)`,
      defaultPath: path.join(app.getPath('downloads'), `${gameTitle.replace(/[^a-z0-9]/gi, '_')}.exe`),
      filters: [
        { name: 'Windows Executable', extensions: ['exe'] },
        { name: 'Standalone HTML Fallback', extensions: ['html'] },
      ],
    });

    if (saveResult.canceled || !saveResult.filePath) {
      return { ok: false, error: 'cancelled' };
    }

    const outPath = saveResult.filePath;
    const isSavingExe = outPath.toLowerCase().endsWith('.exe');

    // Read the game HTML
    let htmlContent = fs.readFileSync(sourceFile, 'utf-8');
    const banner = `\n  <!-- Exported from Space Browser Â· ${new Date().toISOString().split('T')[0]} -->\n  <!-- Play offline in any browser or run the .exe launcher. -->\n`;
    htmlContent = htmlContent.replace('<head>', `<head>${banner}`);

    if (!isSavingExe) {
      // User chose to save as HTML (fallback)
      fs.writeFileSync(outPath, htmlContent, 'utf-8');
      shell.showItemInFolder(outPath);
      return { ok: true, filePath: outPath, fallbackHtml: true };
    }

    // â”€â”€ Build a real .exe using the .NET C# compiler (csc.exe) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // csc.exe ships with every Windows installation (.NET Framework 3.5+).
    // We write a tiny C# program that:
    //   1. Extracts the embedded HTML to a temp file on first run
    //   2. Opens it with the default browser
    // The HTML is base64-embedded as a string constant so the exe is fully
    // self-contained â€” the user only needs to distribute the single .exe file.

    const htmlB64 = Buffer.from(htmlContent, 'utf-8').toString('base64');
    const safeTitle = gameTitle.replace(/"/g, '');
    const csSource = `
using System;
using System.IO;
using System.Diagnostics;
using System.Text;
using System.Reflection;

[assembly: AssemblyTitle("${safeTitle}")]
[assembly: AssemblyDescription("Space Browser Game â€“ ${safeTitle}")]
[assembly: AssemblyProduct("Space Browser")]
[assembly: AssemblyCopyright("Space Browser")]
[assembly: AssemblyVersion("1.0.0.0")]

class SpaceGameLauncher {
  static string B64 = "${htmlB64}";
  static int Main(string[] args) {
    try {
      string tmp = Path.Combine(Path.GetTempPath(), "space_game_${gameId}_" + Process.GetCurrentProcess().Id + ".html");
      File.WriteAllBytes(tmp, Convert.FromBase64String(B64));
      
      string fileUrl = "file:///" + tmp.Replace("\\\\", "/").Replace(" ", "%20");
      
      // Try to open as a native app window, disabling inspect element
      try {
          ProcessStartInfo psiEdge = new ProcessStartInfo("msedge.exe", "--app=\\"" + fileUrl + "\\" --disable-devtools");
          psiEdge.UseShellExecute = true;
          Process.Start(psiEdge);
          return 0;
      } catch {
          try {
              ProcessStartInfo psiChrome = new ProcessStartInfo("chrome.exe", "--app=\\"" + fileUrl + "\\" --disable-devtools");
              psiChrome.UseShellExecute = true;
              Process.Start(psiChrome);
              return 0;
          } catch {
              // Fallback to default browser
              Process.Start(new ProcessStartInfo(tmp) { UseShellExecute = true });
              return 0;
          }
      }
    } catch (Exception ex) {
      Console.Error.WriteLine("Error: " + ex.Message);
      return 1;
    }
  }
}`;

    // Locate csc.exe â€” try multiple known locations
    const cscCandidates = [
      path.join(process.env['WINDIR'] || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
      path.join(process.env['WINDIR'] || 'C:\\Windows', 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
      path.join(process.env['WINDIR'] || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v3.5', 'csc.exe'),
      path.join(process.env['WINDIR'] || 'C:\\Windows', 'Microsoft.NET', 'Framework', 'v3.5', 'csc.exe'),
    ];
    const cscPath = cscCandidates.find(p => fs.existsSync(p));

    if (!cscPath) {
      // csc not available â€” fall back to saving as HTML with a descriptive message
      const htmlFallbackPath = outPath.replace(/\.exe$/i, '.html');
      fs.writeFileSync(htmlFallbackPath, htmlContent, 'utf-8');
      shell.showItemInFolder(htmlFallbackPath);
      return { ok: true, filePath: htmlFallbackPath, fallbackHtml: true,
               error: '.NET compiler not found â€” saved as HTML instead' };
    }

    const tmpDir  = os.tmpdir();
    const csFile  = path.join(tmpDir, `space_game_${gameId}_${Date.now()}.cs`);
    const exeFile = path.join(tmpDir, `space_game_${gameId}_${Date.now()}.exe`);

    try {
      fs.writeFileSync(csFile, csSource, 'utf-8');

      await new Promise<void>((resolve, reject) => {
        execFile(cscPath, [
          '/nologo',
          '/target:winexe',        // no console window on double-click
          `/out:${exeFile}`,
          csFile,
        ], { timeout: 30000 }, (err, _stdout, stderr) => {
          if (err) reject(new Error((stderr || err.message).trim()));
          else     resolve();
        });
      });

      // Move compiled exe to user's chosen path
      fs.copyFileSync(exeFile, outPath);
      shell.showItemInFolder(outPath);
      return { ok: true, filePath: outPath };
    } catch (buildErr: any) {
      // Compilation failed â€” fall back to HTML
      const htmlFallbackPath = outPath.replace(/\.exe$/i, '.html');
      fs.writeFileSync(htmlFallbackPath, htmlContent, 'utf-8');
      shell.showItemInFolder(htmlFallbackPath);
      return { ok: true, filePath: htmlFallbackPath, fallbackHtml: true,
               error: `EXE build failed (${buildErr?.message}) â€” saved as HTML instead` };
    } finally {
      try { fs.unlinkSync(csFile); } catch(_) {}
      try { fs.unlinkSync(exeFile); } catch(_) {}
    }
  });

  // â”€â”€ Network: JS-rendered page fetch â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Opens a hidden BrowserWindow that fully executes JavaScript (needed for
  // Google AI overviews which are injected by JS after page load), waits for
  // the page to settle, then returns the fully-rendered outerHTML.
  //
  // Key design decisions:
  //   â€¢ Copies ALL google.com + google.co.* cookies from 'persist:tabs' so any
  //     existing sign-in session is forwarded â€” Google AI Mode (udm=50) only
  //     returns AI overviews to signed-in users.
  //   â€¢ Uses a dedicated ephemeral session per call so webRequest filters never
  //     collide with the main tab session.
  //   â€¢ Blocks images / media / fonts to reduce load time.
  //   â€¢ Waits up to 5 s after did-finish-load for JS-injected content to settle.
  //   â€¢ Hard outer timeout of 20 s â€” always destroys the window.
  //   â€¢ Strips X-Requested-With so enterprise proxies don't flag the request.
  ipcMain.handle('browser:fetch-rendered', async (_e, url: string): Promise<string | null> => {
    return new Promise((resolve) => {
      let settled = false;
      // forward-reference â€” assigned below after BrowserWindow is created
      let hidden: BrowserWindow;

      const finish = (html: string | null) => {
        if (settled) return;
        settled = true;
        try { hidden.destroy(); } catch (_) {}
        resolve(html);
      };

      // Use a dedicated ephemeral session per request so webRequest listener
      // registrations don't collide across concurrent calls or with the main
      // 'persist:tabs' session.
      const sessionId = `persist:render-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const { session: electronSession } = require('electron') as typeof import('electron');
      const renderSession = electronSession.fromPartition(sessionId, { cache: false });

      // Copy cookies from the real tab session so Google sees the login state.
      // We copy all google.* domains â€” accounts.google.com, google.com, etc. â€”
      // because the AI overview is only visible to signed-in users.
      const tabSession = electronSession.fromPartition('persist:tabs');
      tabSession.cookies.get({}).then((cookies: Electron.Cookie[]) => {
        const googleCookies = cookies.filter(
          (c) => /(?:^|\.)google\.(com|[a-z]{2}(?:\.[a-z]{2})?)$/.test(c.domain || ''),
        );
        return Promise.all(googleCookies.map((c) =>
          renderSession.cookies.set({
            url: `https://${(c.domain || '').replace(/^\./, '')}`,
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path,
            secure: c.secure,
            httpOnly: c.httpOnly,
            expirationDate: c.expirationDate,
          }).catch(() => {}),
        ));
      }).catch(() => {});

      hidden = new BrowserWindow({
        show: false,
        width: 1280,
        height: 900,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          javascript: true,
          session: renderSession,
        },
      });

      // Hard outer timeout â€” always clean up even if events never fire
      const hardTimer = setTimeout(() => finish(null), 20000);

      hidden.webContents.setAudioMuted(true);

      // Block heavyweight resources â€” Google's SGE content does not depend on
      // images, media or fonts, so blocking them speeds up extraction.
      // Do NOT block stylesheets or XHR/fetch â€” Google lazy-loads AI content
      // via internal API calls after first paint.
      renderSession.webRequest.onBeforeRequest(
        { urls: ['*://*/*'] },
        (details: Electron.OnBeforeRequestListenerDetails, callback: (response: Electron.CallbackResponse) => void) => {
          const type = details.resourceType;
          if (type === 'image' || type === 'media' || type === 'font') {
            callback({ cancel: true });
          } else {
            callback({});
          }
        },
      );

      // Strip X-Requested-With so enterprise proxies/WAFs don't flag the request
      renderSession.webRequest.onBeforeSendHeaders(
        { urls: ['https://www.google.com/*', 'https://google.com/*'] },
        (details: Electron.OnBeforeSendHeadersListenerDetails, callback: (response: Electron.BeforeSendResponse) => void) => {
          const headers = { ...details.requestHeaders };
          delete headers['X-Requested-With'];
          delete headers['x-requested-with'];
          callback({ requestHeaders: headers });
        },
      );

      let extractAttempted = false;
      const tryExtract = () => {
        if (extractAttempted) return;
        extractAttempted = true;
        clearTimeout(hardTimer);
        hidden.webContents
          .executeJavaScript('document.documentElement.outerHTML')
          .then((html: string) => finish(typeof html === 'string' && html.length > 200 ? html : null))
          .catch(() => finish(null));
      };

      // Extract rendered HTML once the page has loaded and JS has had time to run.
      // We wait 5 s after did-finish-load â€” empirically, Google's AI overview JS
      // needs 3â€“5 s after initial load to inject its content into the DOM.
      hidden.webContents.once('did-finish-load', () => {
        setTimeout(tryExtract, 5000);
      });

      // dom-ready fires before did-finish-load; don't extract here but use it
      // as an additional signal to start the clock if did-finish-load is delayed.
      hidden.webContents.once('dom-ready', () => {
        // Start a separate 8 s safety timer from dom-ready in case did-finish-load
        // never fires (redirect loops, offline resources, etc.)
        setTimeout(() => {
          if (!extractAttempted) tryExtract();
        }, 8000);
      });

      hidden.webContents.on('did-fail-load', (_e2, code, _desc) => {
        // ERR_ABORTED (-3) happens on certain Google redirect chains â€” ignore it
        // and let the timers resolve instead of finishing early.
        if (code !== -3) {
          clearTimeout(hardTimer);
          finish(null);
        }
      });

      hidden.loadURL(url, {
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        extraHeaders:
          [
            'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language: en-US,en;q=0.9',
            'Sec-Fetch-Dest: document',
            'Sec-Fetch-Mode: navigate',
            'Sec-Fetch-Site: none',
            'Upgrade-Insecure-Requests: 1',
          ].join('\n'),
      }).catch(() => { clearTimeout(hardTimer); finish(null); });
    });
  });

  // â”€â”€ Network: main-process fetch (bypasses renderer-level firewall filters) â”€â”€
  // Used by space://search to scrape web results via the system network stack
  // instead of the renderer's WebRequest stack which corporate firewalls block.
  ipcMain.handle('browser:fetch-html', async (_e, url: string): Promise<string | null> => {
    // Fetches HTML following up to 5 redirects. Uses Electron's net module
    // so it runs on the main-process network stack (bypasses renderer-level
    // firewalls) and shares the tab session cookies for credentialed sites.
    const doFetch = (targetUrl: string, redirectsLeft: number): Promise<string | null> => {
      return new Promise((resolve) => {
        try {
          const req = net.request({
            url: targetUrl,
            method: 'GET',
            redirect: 'manual',
            session: require('electron').session.fromPartition('persist:tabs'),
          });
          req.setHeader('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8');
          req.setHeader('Accept-Language', 'en-US,en;q=0.9');
          req.setHeader('Accept-Encoding', 'identity');
          req.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
          req.setHeader('Cache-Control', 'no-cache');
          req.setHeader('Sec-Fetch-Dest', 'document');
          req.setHeader('Sec-Fetch-Mode', 'navigate');
          req.setHeader('Sec-Fetch-Site', 'none');
          req.setHeader('Upgrade-Insecure-Requests', '1');
          const chunks: Buffer[] = [];
          const timer = setTimeout(() => { try { req.abort(); } catch(_) {} resolve(null); }, 12000);
          req.on('response', (resp) => {
            clearTimeout(timer);
            const loc = resp.headers['location'];
            if ((resp.statusCode === 301 || resp.statusCode === 302 ||
                 resp.statusCode === 303 || resp.statusCode === 307 ||
                 resp.statusCode === 308) && loc && redirectsLeft > 0) {
              // Follow redirect
              const redirectUrl = typeof loc === 'string' ? loc : loc[0];
              const resolved = redirectUrl.startsWith('http') ? redirectUrl
                : new URL(redirectUrl, targetUrl).toString();
              resolve(doFetch(resolved, redirectsLeft - 1));
              return;
            }
            resp.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
            resp.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
            resp.on('error', () => resolve(null));
          });
          req.on('error', () => { clearTimeout(timer); resolve(null); });
          req.end();
        } catch (_) {
          resolve(null);
        }
      });
    };
    return doFetch(url, 5);
  });
}


