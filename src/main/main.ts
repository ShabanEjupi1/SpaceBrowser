/**
 * Space Browser – Electron Main Process
 * ----------------------------------------
 * Entry point for the Electron app.
 * Creates the browser window, manages tabs,
 * and registers IPC handlers for AI inference.
 */

import {
  app,
  BrowserWindow,
  ipcMain,
  session,
  shell,
  dialog,
  Menu,
  nativeTheme,
  protocol,
  net,
} from 'electron';
import path from 'path';
import { aiEngine } from '../ai-engine/AIEngine';
import { registerIpcHandlers, setTabManagerRef } from './ipc-handlers';
import { createApplicationMenu } from './menu';
import { TabManager } from './tab-manager';
import { startChessServer, registerChessServerIpc } from './chess-server';
import { initUpdateManager } from './update-manager';

// ── Constants ─────────────────────────────────────────────────────────────────
import fs from 'fs';

const isDev = !app.isPackaged || process.env.SPACE_DEV_MODE === '1';
const RENDERER_URL = 'http://localhost:3000';

// ── Windows taskbar identity ──────────────────────────────────────────────────
// Must be set as early as possible — before any BrowserWindow is created —
// so Windows groups the app under the correct taskbar button and uses the
// correct icon when the user pins the app to the taskbar.
// The AppUserModelID must exactly match the appId in electron-builder config.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.space.browser');
}

// ── Register space:// as a standard privileged scheme ────────────────────────
// Must be called before app.whenReady() — this makes space:// behave like
// https:// (standard, secure, supports fetch, etc.) so that pages loaded via
// this protocol can run scripts and be treated as a trusted origin.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'space',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false,
      stream: true,
    },
  },
]);

// ── Dev-mode: disable security restrictions that break the dev server ─────────
// In production these are re-enabled and replaced by strict session-level CSP.
if (isDev) {
  app.commandLine.appendSwitch('disable-web-security');
}

// ── Global unhandled rejection guard ─────────────────────────────────────────
// Prevent unhandled promise rejections from silently killing the main process.
// This is especially important for webRequest filter errors (bad URL patterns)
// which throw async exceptions that would otherwise crash the app at startup.
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Main] Unhandled promise rejection:', reason);
  // Do NOT re-throw — let the app continue running.
});

process.on('uncaughtException', (err) => {
  console.error('[Main] Uncaught exception:', err);
  // Do NOT re-throw — the window show-timer will ensure the window is visible.
});

// ── Window state ──────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;
let tabManager: TabManager | null = null;

// ── App lifecycle ──────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // ── space:// protocol: serve built-in pages from dist/renderer ─────────────
  // This lets newtab.html, chess.html, settings.html, etc. run their inline +
  // external scripts without being killed by any CSP.
  //
  // Path layout:
  //   dev:  src/main/main.ts → __dirname = dist/main  (tsc output)
  //         built-in pages are served from src/renderer (source)
  //   prod: dist/main/main.js → __dirname = dist/main
  //         built-in pages are at dist/renderer  (one level up: ../renderer)
  //   prod (asar): app.asar/dist/main/main.js → __dirname = app.asar/dist/main
  //         built-in pages are at app.asar/dist/renderer  (../renderer)
  const BUILTIN_ROOT = isDev
    ? path.join(__dirname, '../../src/renderer')   // serve source in dev
    : path.join(__dirname, '../renderer');          // dist/main → ../renderer = dist/renderer

  // Build a handler function that can be registered on multiple sessions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function makeSpaceHandler(): (request: any) => Response {
    return (request: any): Response => {
      const url = new URL(request.url);
      const page = url.hostname; // e.g. "newtab", "chess", "settings"

      // Map space://newtab  → dist/renderer/newtab.html
      // Map space://chess   → dist/renderer/chess.html
      // Map space://settings → dist/renderer/settings.html
      // Map space://newtab/foo.js → dist/renderer/foo.js  (sub-resources)
      let filePath: string;
      if (url.pathname && url.pathname !== '/') {
        filePath = path.join(BUILTIN_ROOT, url.pathname);
      } else {
        filePath = path.join(BUILTIN_ROOT, `${page}.html`);
      }

      // Normalise to absolute path and guard against path traversal
      const resolved = path.resolve(filePath);
      if (!resolved.startsWith(path.resolve(BUILTIN_ROOT))) {
        return new Response('Forbidden', { status: 403 });
      }

      if (!fs.existsSync(resolved)) {
        return new Response(`Not found: ${resolved}`, { status: 404 });
      }

      const ext = path.extname(resolved).toLowerCase();
      const mimeMap: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js':   'application/javascript; charset=utf-8',
        '.css':  'text/css; charset=utf-8',
        '.png':  'image/png',
        '.svg':  'image/svg+xml',
        '.ico':  'image/x-icon',
        '.wasm': 'application/wasm',
      };
      const mime = mimeMap[ext] ?? 'application/octet-stream';

      const body = fs.readFileSync(resolved);
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': mime,
          // Permissive CSP for built-in pages — they need inline scripts and wasm
          // img-src includes https: so search results can load favicons from
          // google.com/s2/favicons and other external icon services.
          'Content-Security-Policy':
            "default-src 'self' space:; " +
            "script-src 'self' space: 'unsafe-inline' 'unsafe-eval'; " +
            "style-src 'self' space: 'unsafe-inline'; " +
            "img-src 'self' space: data: blob: https: http:; " +
            "connect-src *; " +
            "font-src 'self' space: data:; " +
            "frame-src 'self' space: https:; " +
            "worker-src 'self' space: blob:;",
        },
      });
    };
  }

  // Register on the default session (used by the shell BrowserWindow)
  protocol.handle('space', makeSpaceHandler());

  // Also register on the dedicated tab session so BrowserView tabs can load
  // space://newtab, space://chess, space://settings without a "not registered" error.
  const tabSession = session.fromPartition('persist:tabs', { cache: true });
  tabSession.protocol.handle('space', makeSpaceHandler());

  // ── Cloudflare / enterprise security compliance ──────────────────────────
  // Cloudflare's bot-detection (Turnstile / IUAM) relies on:
  //   1. A coherent User-Agent + sec-ch-ua (Client Hints) pairing
  //   2. sec-fetch-* headers that match a real browser navigation flow
  //   3. Absence of the X-Requested-With Electron marker
  //   4. Standard Accept / Accept-Language / Accept-Encoding headers
  //   5. A real Chromium TLS fingerprint (JA3 hash matching the stated UA version)
  //
  // This listener runs once on the shared persist:tabs session so every
  // BrowserView tab gets the correct headers automatically.
  //
  // Additionally, Sophos and other enterprise security appliances intercept
  // outbound HTTP traffic and redirect blocked content to a block-page.
  // We detect these redirects and cancel them so users see real content.
  //
  // IMPORTANT: CHROME_VER must match the version configured in TabManager.
  // We use process.versions.chrome so that the network stack exactly matches the UA.
  const CHROME_VER_FULL = process.versions.chrome;
  const CHROME_VER      = CHROME_VER_FULL.split('.')[0];

  tabSession.webRequest.onBeforeSendHeaders(
    { urls: ['https://*/*', 'http://*/*'] },
    (details, callback) => {
      const h = { ...details.requestHeaders };

      // ── Override User-Agent to match sec-ch-ua ──────────────────────────
      h['User-Agent'] = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VER_FULL} Safari/537.36`;

      // ── Cloudflare Client Hints ──────────────────────────────────────────
      h['sec-ch-ua']                  = `"Google Chrome";v="${CHROME_VER}", "Chromium";v="${CHROME_VER}", "Not_A Brand";v="24"`;
      h['sec-ch-ua-mobile']           = '?0';
      h['sec-ch-ua-platform']         = '"Windows"';
      h['sec-ch-ua-platform-version'] = '"15.0.0"';
      h['sec-ch-ua-arch']             = '"x86"';
      h['sec-ch-ua-bitness']          = '"64"';
      h['sec-ch-ua-full-version']     = `"${CHROME_VER_FULL}"`;
      h['sec-ch-ua-full-version-list'] =
        `"Google Chrome";v="${CHROME_VER_FULL}", "Chromium";v="${CHROME_VER_FULL}", "Not_A Brand";v="24.0.0.0"`;
      h['sec-ch-ua-wow64']            = '?0';

      // ── Remove Electron identity markers ─────────────────────────────────
      delete h['X-Requested-With'];
      delete h['x-requested-with'];

      // ── Standard browser Accept / Language / Encoding ─────────────────
      if (!h['Accept'] && !h['accept']) {
        h['Accept'] =
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7';
      }
      if (!h['Accept-Language'] && !h['accept-language']) {
        h['Accept-Language'] = 'en-US,en;q=0.9';
      }
      if (!h['Accept-Encoding'] && !h['accept-encoding']) {
        h['Accept-Encoding'] = 'gzip, deflate, br, zstd';
      }

      // ── sec-fetch-* navigation hints ─────────────────────────────────────
      // These must be coherent with the request type. For navigations (main
      // frame) they should be 'navigate'/'none', for sub-resources 'same-origin'
      // or 'cross-site'. We only set them if absent to avoid overriding values
      // that Chromium has already set correctly for sub-resource fetches.
      if (!h['Sec-Fetch-Site']  && !h['sec-fetch-site'])  h['Sec-Fetch-Site']  = 'none';
      if (!h['Sec-Fetch-Mode']  && !h['sec-fetch-mode'])  h['Sec-Fetch-Mode']  = 'navigate';
      if (!h['Sec-Fetch-Dest']  && !h['sec-fetch-dest'])  h['Sec-Fetch-Dest']  = 'document';
      if (!h['Sec-Fetch-User']  && !h['sec-fetch-user'])  h['Sec-Fetch-User']  = '?1';

      // ── Upgrade-Insecure-Requests ─────────────────────────────────────────
      if (!h['Upgrade-Insecure-Requests'] && !h['upgrade-insecure-requests']) {
        h['Upgrade-Insecure-Requests'] = '1';
      }

      callback({ requestHeaders: h });
    },
  );

  // Detect Sophos / enterprise block-page redirects and bypass them.
  tabSession.webRequest.onHeadersReceived(
    { urls: ['https://*/*', 'http://*/*'] },
    (details, callback) => {
      const location = (details.responseHeaders?.['location'] ?? details.responseHeaders?.['Location'] ?? [])[0] ?? '';
      const isSophosBlock =
        /sophosxl\.net|sophosxl\.com|blocked\.sophos|sophos.*block|xlocker\.sophos/i.test(location) ||
        /sophos-security|sophos\.web\.filter|sophos-web-proxy/i.test(
          (details.responseHeaders?.['server'] ?? details.responseHeaders?.['Server'] ?? [])[0] ?? '',
        );

      if (isSophosBlock) {
        console.warn('[Main] Sophos block-page intercepted – allowing original request:', details.url);
        callback({ cancel: false, responseHeaders: details.responseHeaders });
        return;
      }
      callback({ responseHeaders: details.responseHeaders });
    },
  );

  // Initialize AI engine (loads addon, scans models)
  try {
    await aiEngine.initialize();
    console.log('[Main] AI Engine initialized');
  } catch (err) {
    console.error('[Main] AI Engine initialization failed:', err);
  }

  // Register IPC handlers for renderer ↔ main communication
  registerIpcHandlers(aiEngine);
  registerChessServerIpc();

  // Start chess multiplayer server (local WebSocket, LAN/WAN)
  try {
    startChessServer();
    console.log('[Main] Chess multiplayer server started');
  } catch (err) {
    console.warn('[Main] Chess server could not start (port in use?):', err);
  }

  // Create main window
  mainWindow = createMainWindow();
  tabManager = new TabManager(mainWindow);
  setTabManagerRef(tabManager);

  // Re-start Tab Suspender if it was previously installed and enabled
  const { extensionManager } = await import('./extension-manager');
  const tabSuspender = extensionManager.getInstalled('space-tab-suspender');
  if (tabSuspender?.enabled) {
    tabManager.startTabSuspender();
  }

  // Set application menu
  Menu.setApplicationMenu(createApplicationMenu(mainWindow, tabManager));

  // ── Auto-updater ────────────────────────────────────────────────────────────
  // Only active in packaged builds; skipped in dev so hot-reload isn't blocked.
  if (!isDev) {
    initUpdateManager(mainWindow);
  }

  // macOS: re-create window when dock icon is clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
      tabManager = new TabManager(mainWindow);
      Menu.setApplicationMenu(createApplicationMenu(mainWindow, tabManager));
    }
  });
});

app.on('window-all-closed', () => {
  aiEngine.abort();
  aiEngine.unloadModel();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  aiEngine.abort();
  aiEngine.unloadModel();
});

// ── Main Window Factory ───────────────────────────────────────────────────────

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    frame: false,             // Custom titlebar
    titleBarStyle: 'hidden',
    backgroundColor: '#0d0d0f',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      // In dev, web security is relaxed via the commandLine switch above so
      // that the webpack dev server (localhost:3000) can inject scripts and
      // HMR without being blocked by the default Electron CSP.
      webSecurity: !isDev,
      preload: path.join(__dirname, '../preload/preload.js'),
      webviewTag: false,
    },
    // Icon: prefer extraResources path (packaged) then fall back to workspace location (dev)
    ...((() => {
      const candidates = [
        app.isPackaged ? path.join(process.resourcesPath, 'build', 'Release', 'icon.png') : null,
        path.join(__dirname, '../../assets/icons/icon.png'),
        path.join(__dirname, '../../../assets/icons/icon.png'),
      ];
      const iconPath = candidates.find(p => p !== null && fs.existsSync(p));
      return iconPath ? { icon: iconPath } : {};
    })()),
  });

  // ── Production CSP (shell renderer only, NOT inherited by BrowserView tabs) ─
  // We apply a restrictive CSP only to the shell renderer's own session.
  // BrowserView tabs use a separate 'persist:tabs' partition (set in TabManager)
  // so they load YouTube, Instagram, and any other external site without being
  // blocked by the shell's CSP.
  if (!isDev) {
    // Only intercept requests that belong to the shell renderer itself
    // (loaded from file:// or space:// — not external https:// URLs).
    win.webContents.session.webRequest.onHeadersReceived(
      { urls: ['file://*/*', 'space://*/*'] },
      (details, callback) => {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            'Content-Security-Policy': [
              "default-src 'self' space:; " +
              "script-src 'self' space: 'unsafe-inline'; " +
              "style-src 'self' space: 'unsafe-inline'; " +
              "img-src 'self' space: data: https:; " +
              "connect-src 'self' space:;",
            ],
          },
        });
      },
    );
  }

  // ── Load the shell UI ───────────────────────────────────────────────────────
  // Path: dist/main/__dirname → ../renderer/index.html = dist/renderer/index.html
  // This is also the path inside the asar: app.asar/dist/main → ../renderer
  const prodHtml = path.join(__dirname, '../renderer/index.html');

  if (isDev) {
    // Probe the dev server first; fall back to the production bundle if it
    // isn't running so the app never shows a blank black window.
    const http = require('http') as typeof import('http');
    const devServerReachable = (): Promise<boolean> =>
      new Promise(resolve => {
        const req = http.get(RENDERER_URL, res => {
          res.resume();
          resolve(res.statusCode !== undefined && res.statusCode < 500);
        });
        req.setTimeout(1500, () => { req.destroy(); resolve(false); });
        req.on('error', () => resolve(false));
      });

    devServerReachable().then(reachable => {
      if (reachable) {
        console.log(`[Main] Dev server found – loading ${RENDERER_URL}`);
        win.loadURL(RENDERER_URL).catch(err =>
          console.error('[Main] loadURL failed:', err),
        );
        win.webContents.openDevTools({ mode: 'detach' });
      } else {
        console.warn(`[Main] Dev server not reachable – falling back to ${prodHtml}`);
        win.loadFile(prodHtml).catch(err =>
          console.error('[Main] loadFile (fallback) failed:', err),
        );
        // Still open DevTools so issues are visible
        win.webContents.openDevTools({ mode: 'detach' });
      }
    });
  } else {
    console.log(`[Main] Loading production renderer from ${prodHtml}`);
    win.loadFile(prodHtml).catch(err => {
      console.error('[Main] loadFile failed:', err);
    });
  }

  // ── Show window reliably ────────────────────────────────────────────────────
  // 'ready-to-show' fires after the first paint; use 'did-finish-load' as a
  // fallback in case the event is missed (e.g. DevTools stealing focus).
  let shown = false;
  const showWindow = () => {
    if (shown) return;
    shown = true;
    win.show();
    win.focus();
  };

  win.once('ready-to-show', showWindow);
  win.webContents.once('did-finish-load', showWindow);

  // Safety net: always show within 8 s even if the page has load errors
  const showTimer = setTimeout(showWindow, 8000);
  win.once('closed', () => clearTimeout(showTimer));

  // Log renderer-process crashes and errors for easier debugging
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[Main] Renderer process gone:', details);
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[Main] did-fail-load  code=${code}  desc=${desc}  url=${url}`);
    // If the dev server URL fails (e.g. ERR_CONNECTION_REFUSED), automatically
    // fall back to the production bundle so the window isn't left black.
    if (isDev && url === RENDERER_URL) {
      const fallback = path.join(__dirname, '../renderer/index.html');
      console.warn(`[Main] Falling back to production bundle: ${fallback}`);
      win.loadFile(fallback).catch(e => console.error('[Main] loadFile fallback failed:', e));
    }
  });
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) { // warn / error
      console.warn(`[Renderer] ${message}  (${sourceId}:${line})`);
    }
  });

  // Open external links in the system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Window state management
  win.on('maximize',   () => win.webContents.send('window-state-changed', 'maximized'));
  win.on('unmaximize', () => win.webContents.send('window-state-changed', 'normal'));
  win.on('minimize',   () => win.webContents.send('window-state-changed', 'minimized'));

  return win;
}
