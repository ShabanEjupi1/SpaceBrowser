/**
 * Space Browser – Application Menu
 */

import { BrowserWindow, Menu, MenuItemConstructorOptions, shell } from 'electron';
import { TabManager } from './tab-manager';

export function createApplicationMenu(win: BrowserWindow, tabManager: TabManager): Menu {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Space',
      submenu: [
        { label: 'About Space', role: 'about' },
        { type: 'separator' },
        { label: 'Preferences', accelerator: 'CmdOrCtrl+,', click: () => win.webContents.send('open-preferences') },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { label: 'New Tab',             accelerator: 'CmdOrCtrl+T',       click: () => tabManager.createTab() },
        { label: 'Reopen Closed Tab',   accelerator: 'CmdOrCtrl+Shift+T', click: () => win.webContents.send('tabs:reopen-closed') },
        { label: 'Close Tab',           accelerator: 'CmdOrCtrl+W',       click: () => win.webContents.send('tabs:close-active') },
        { type: 'separator' },
        { label: 'Open File…',          accelerator: 'CmdOrCtrl+O',       click: async () => win.webContents.send('open-file') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { label: 'Toggle AI Sidebar', accelerator: 'CmdOrCtrl+Shift+A', click: () => win.webContents.send('sidebar:toggle') },
        { label: 'Toggle Developer Tools', accelerator: 'CmdOrCtrl+Shift+I', role: 'toggleDevTools' },
      ],
    },
    {
      label: 'AI',
      submenu: [
        { label: 'Open AI Chat', accelerator: 'CmdOrCtrl+Shift+A', click: () => win.webContents.send('ai:open-chat') },
        { label: 'Summarize Page', accelerator: 'CmdOrCtrl+Shift+S', click: () => win.webContents.send('ai:summarize-page') },
        { label: 'Ask About Selection', accelerator: 'CmdOrCtrl+Shift+Q', click: () => win.webContents.send('ai:ask-selection') },
        { type: 'separator' },
        { label: 'Manage Models…', click: () => win.webContents.send('ai:open-model-manager') },
      ],
    },
    {
      label: 'Tools',
      submenu: [
        {
          label: 'Extensions',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => tabManager.openExtensionsPage(),
        },
        { type: 'separator' },
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => tabManager.openSettingsPage(),
        },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Documentation', click: () => shell.openExternal('https://github.com/space-browser/space') },
        { label: 'Report Issue', click: () => shell.openExternal('https://github.com/space-browser/space/issues') },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}
