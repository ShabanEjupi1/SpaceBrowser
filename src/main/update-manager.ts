/**
 * Space Browser – Update Manager
 * --------------------------------
 * Handles automatic update checking, downloading, and installation
 * via electron-updater. Supports a phased rollout schedule:
 *
 *   Channel "stable"  → normal releases for all users
 *   Channel "slow"    → 3–6 month lag (conservative users)
 *   Channel "lts"     → 6–12 month lag (enterprise users)
 *
 * Update behaviour (per channel):
 *   - Check for updates silently on startup (after a 10 s delay so the
 *     app finishes loading first).
 *   - Re-check every CHECK_INTERVAL_MS.
 *   - Download automatically in the background.
 *   - Notify the renderer via IPC: 'update:status'.
 *   - The user decides when to install (never auto-restart).
 */

import { ipcMain, BrowserWindow, app } from 'electron';
import { autoUpdater, UpdateInfo, ProgressInfo } from 'electron-updater';
import path from 'path';
import fs from 'fs';
import Store from 'electron-store';

// ── Update channel types ──────────────────────────────────────────────────────

export type UpdateChannel = 'stable' | 'slow' | 'lts';

export interface UpdatePrefs {
  channel: UpdateChannel;
  /** Timestamp (ms) of the last successful check */
  lastChecked: number;
  /** Whether the user has been prompted about the pending update already */
  notifiedVersion: string | null;
}

// ── Persistent prefs ──────────────────────────────────────────────────────────

const updatePrefsStore = new Store<UpdatePrefs>({
  name: 'update-prefs',
  defaults: {
    channel: 'stable',
    lastChecked: 0,
    notifiedVersion: null,
  },
});

// ── Check intervals (ms) ─────────────────────────────────────────────────────

const CHECK_INTERVALS: Record<UpdateChannel, number> = {
  stable: 6  * 60 * 60 * 1000,   // every 6 h
  slow:   24 * 60 * 60 * 1000,   // every 24 h
  lts:    7  * 24 * 60 * 60 * 1000, // every 7 days
};

// ── Minimum age before a channel shows an update ─────────────────────────────
// "slow" users only see a release after it has been out for ≥ 90 days.
// "lts"  users only see a release after it has been out for ≥ 180 days.
// "stable" users see new releases immediately.
export const MIN_AGE_DAYS: Record<UpdateChannel, number> = {
  stable:  0,
  slow:   90,   // ~3 months
  lts:   180,   // ~6 months
};

// ── autoUpdater configuration ─────────────────────────────────────────────────

autoUpdater.autoDownload    = false;  // let user confirm before downloading
autoUpdater.autoInstallOnAppQuit = true;  // install on next quit once downloaded
autoUpdater.logger = null;            // suppress noisy default logs

let _mainWindow: BrowserWindow | null = null;
let _checkTimer: ReturnType<typeof setInterval> | null = null;
let _initialized = false;

// ── Helpers ───────────────────────────────────────────────────────────────────

function sendStatus(event: string, payload?: unknown) {
  if (!_mainWindow || _mainWindow.isDestroyed()) return;
  _mainWindow.webContents.send('update:status', { event, payload });
}

function getChannel(): UpdateChannel {
  return updatePrefsStore.get('channel', 'stable');
}

// ── Core logic ────────────────────────────────────────────────────────────────

/**
 * Configures autoUpdater for the current channel and kicks off periodic checks.
 * Safe to call multiple times (idempotent).
 */
export function initUpdateManager(mainWindow: BrowserWindow): void {
  if (_initialized) {
    _mainWindow = mainWindow;
    return;
  }
  _initialized = true;
  _mainWindow  = mainWindow;

  // ── Wire up events ────────────────────────────────────────────────────────

  autoUpdater.on('checking-for-update', () => {
    sendStatus('checking');
  });

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    const channel = getChannel();
    const minAge  = MIN_AGE_DAYS[channel];

    if (minAge > 0 && info.releaseDate) {
      const releaseMs  = new Date(info.releaseDate).getTime();
      const ageMs      = Date.now() - releaseMs;
      const ageDays    = ageMs / (1000 * 60 * 60 * 24);

      if (ageDays < minAge) {
        // Release is too fresh for this channel — treat as no update
        sendStatus('channel-hold', {
          version: info.version,
          channel,
          minAgeDays: minAge,
          ageDays: Math.floor(ageDays),
          availableIn: Math.ceil(minAge - ageDays),
        });
        return;
      }
    }

    const alreadyNotified = updatePrefsStore.get('notifiedVersion') === info.version;
    sendStatus('available', { info, alreadyNotified });
    updatePrefsStore.set('notifiedVersion', info.version);
  });

  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    updatePrefsStore.set('lastChecked', Date.now());
    sendStatus('up-to-date', { version: info.version });
  });

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    sendStatus('download-progress', {
      percent:          Math.round(progress.percent),
      transferred:      progress.transferred,
      total:            progress.total,
      bytesPerSecond:   progress.bytesPerSecond,
    });
  });

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    updatePrefsStore.set('lastChecked', Date.now());
    sendStatus('downloaded', { info });
  });

  autoUpdater.on('error', (err: Error) => {
    // Only log; never crash the app because of an update failure
    console.error('[UpdateManager] Error:', err?.message ?? err);
    sendStatus('error', { message: err?.message ?? String(err) });
  });

  // ── IPC handlers ──────────────────────────────────────────────────────────

  ipcMain.handle('update:check', async () => {
    try {
      await autoUpdater.checkForUpdates();
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  });

  ipcMain.handle('update:download', async () => {
    try {
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  });

  ipcMain.handle('update:install', () => {
    // Gracefully quit & install the downloaded update
    autoUpdater.quitAndInstall(false, true);
  });

  ipcMain.handle('update:get-prefs', () => updatePrefsStore.store);

  ipcMain.handle('update:set-channel', (_e, channel: UpdateChannel) => {
    if (!['stable', 'slow', 'lts'].includes(channel)) {
      throw new Error(`Invalid update channel: ${channel}`);
    }
    updatePrefsStore.set('channel', channel);
    return updatePrefsStore.store;
  });

  ipcMain.handle('update:get-version', () => app.getVersion());

  // ── Schedule periodic checks ──────────────────────────────────────────────

  const scheduleCheck = () => {
    const channel  = getChannel();
    const interval = CHECK_INTERVALS[channel];

    if (_checkTimer) clearInterval(_checkTimer);
    _checkTimer = setInterval(() => {
      autoUpdater.checkForUpdates().catch(err =>
        console.warn('[UpdateManager] Periodic check failed:', err?.message),
      );
    }, interval);
  };

  // First check: 12 s after launch (let the window finish rendering)
  const startupTimer = setTimeout(() => {
    autoUpdater.checkForUpdates().catch(err =>
      console.warn('[UpdateManager] Startup check failed:', err?.message),
    );
    scheduleCheck();
  }, 12_000);

  // Clean up timers when window is destroyed
  mainWindow.once('closed', () => {
    clearTimeout(startupTimer);
    if (_checkTimer) clearInterval(_checkTimer);
    _checkTimer  = null;
    _initialized = false;
    _mainWindow  = null;
  });
}
