const { app, BrowserWindow, ipcMain, shell, dialog, Menu, Tray, nativeImage } = require('electron');
const path = require('path');
const downloadEngine = require('./core/DownloadEngine');

let mainWindow;
let tray = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 500,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0f0f0f',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '../assets/icon.png')
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function createTray() {
  const iconPath = path.join(__dirname, '../assets/icon.png');
  tray = new Tray(nativeImage.createFromPath(iconPath));
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Abrir SpeedLoad', click: () => mainWindow.show() },
    { label: 'Sair', click: () => { app.isQuitting = true; app.quit(); } }
  ]);
  tray.setToolTip('SpeedLoad está rodando...');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => mainWindow.show());
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  app.on('activate', () => { if (!mainWindow) createWindow(); });

  // Escuta os updates do DownloadEngine e envia para a UI
  downloadEngine.on('update', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('download-update', data);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── IPC Handlers ──────────────────────────────────────────────────────────

ipcMain.handle('add-download', async (event, { url: fileUrl, threads, savePath, speedLimit }) => {
  return await downloadEngine.addDownload(fileUrl, savePath, threads, speedLimit);
});

ipcMain.handle('cancel-download', async (event, { id }) => {
  downloadEngine.cancelDownload(id);
});

ipcMain.handle('pause-download', async (event, { id }) => {
  downloadEngine.pauseDownload(id);
});

ipcMain.handle('resume-download', async (event, { id }) => {
  downloadEngine.resumeDownload(id);
});

ipcMain.handle('remove-download', async (event, { id }) => {
  downloadEngine.removeDownload(id);
});

ipcMain.handle('open-file', async (event, { filePath }) => {
  shell.openPath(filePath);
});

ipcMain.handle('show-in-folder', async (event, { filePath }) => {
  shell.showItemInFolder(filePath);
});

ipcMain.handle('choose-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Choose download folder'
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('get-default-folder', () => {
  return app.getPath('downloads');
});

ipcMain.handle('window-minimize', () => mainWindow.minimize());
ipcMain.handle('window-maximize', () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.handle('window-close', () => {
  if (mainWindow) mainWindow.hide(); // Ao invés de close, apenas esconde
});
ipcMain.handle('open-donate', () => shell.openExternal('https://buymeacoffee.com/speedload'));
ipcMain.handle('open-url', (event, { url: u }) => shell.openExternal(u));
