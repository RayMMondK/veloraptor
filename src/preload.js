const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  addDownload: (opts) => ipcRenderer.invoke('add-download', opts),
  cancelDownload: (id) => ipcRenderer.invoke('cancel-download', { id }),
  pauseDownload: (id) => ipcRenderer.invoke('pause-download', { id }),
  resumeDownload: (id) => ipcRenderer.invoke('resume-download', { id }),
  removeDownload: (id) => ipcRenderer.invoke('remove-download', { id }),
  openFile: (filePath) => ipcRenderer.invoke('open-file', { filePath }),
  showInFolder: (filePath) => ipcRenderer.invoke('show-in-folder', { filePath }),
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  getDefaultFolder: () => ipcRenderer.invoke('get-default-folder'),
  openDonate: () => ipcRenderer.invoke('open-donate'),
  openUrl: (u) => ipcRenderer.invoke('open-url', { url: u }),

  // Window controls
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),

  // Events
  onDownloadUpdate: (cb) => ipcRenderer.on('download-update', (_, data) => cb(data)),
  offDownloadUpdate: (cb) => ipcRenderer.removeListener('download-update', cb),
});
