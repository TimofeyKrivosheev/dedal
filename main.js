const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs/promises');
const path = require('path');

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile('index.html');
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('openProject', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    filters: [{ name: 'Dedal Project', extensions: ['DDproj'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths[0]) return null;
  const data = await fs.readFile(filePaths[0], 'utf8');
  return { path: filePaths[0], data };
});

ipcMain.handle('saveProject', async (_e, { path: p, data }) => {
  await fs.writeFile(p, data, 'utf8');
  return p;
});

ipcMain.handle('saveProjectAs', async (_e, { data, suggestedName }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: suggestedName || 'project.DDproj',
    filters: [{ name: 'Dedal Project', extensions: ['DDproj'] }],
  });
  if (canceled || !filePath) return null;
  await fs.writeFile(filePath, data, 'utf8');
  return filePath;
});

ipcMain.handle('pickImage', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    filters: [{ name: 'Images', extensions: ['png','jpg','jpeg','gif','webp','bmp'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths[0]) return null;
  const buf = await fs.readFile(filePaths[0]);
  const ext = path.extname(filePaths[0]).slice(1).toLowerCase();
  const mime = ext === 'jpg' ? 'jpeg' : ext;
  return `data:image/${mime};base64,${buf.toString('base64')}`;
});

// ---- PNG export ----
ipcMain.handle('savePNG', async (_e, { dataURL, suggestedName }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: suggestedName || 'page.png',
    filters: [{ name: 'PNG image', extensions: ['png'] }],
  });
  if (canceled || !filePath) return null;
  const base64 = dataURL.replace(/^data:image\/png;base64,/, '');
  await fs.writeFile(filePath, Buffer.from(base64, 'base64'));
  return filePath;
});

ipcMain.handle('pickDirectory', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openDirectory', 'createDirectory'],
  });
  if (canceled || !filePaths[0]) return null;
  return filePaths[0];
});

ipcMain.handle('savePNGToDir', async (_e, { dir, filename, dataURL }) => {
  const base64 = dataURL.replace(/^data:image\/png;base64,/, '');
  const fullPath = path.join(dir, filename);
  await fs.writeFile(fullPath, Buffer.from(base64, 'base64'));
  return fullPath;
});