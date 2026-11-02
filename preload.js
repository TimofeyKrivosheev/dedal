const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  openProject: () => ipcRenderer.invoke('openProject'),
  saveProject: (path, data) => ipcRenderer.invoke('saveProject', { path, data }),
  saveProjectAs: (data, name) => ipcRenderer.invoke('saveProjectAs', { data, suggestedName: name }),
  pickImage: () => ipcRenderer.invoke('pickImage'),
  savePNG: (dataURL, suggestedName) => ipcRenderer.invoke('savePNG', { dataURL, suggestedName }),
  pickDirectory: () => ipcRenderer.invoke('pickDirectory'),
  savePNGToDir: (dir, filename, dataURL) => ipcRenderer.invoke('savePNGToDir', { dir, filename, dataURL }),
});