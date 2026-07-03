const { app, BrowserWindow } = require('electron');

app.on('ready', () => {
  const w = new BrowserWindow({ width: 400, height: 300 });
  w.loadURL('data:text/html,<h1>Electron works!</h1>');
  console.log('[test] Window created successfully');
  setTimeout(() => {
    console.log('[test] Quitting');
    app.quit();
  }, 2000);
});

app.on('window-all-closed', () => app.quit());
