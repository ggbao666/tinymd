const { contextBridge, ipcRenderer, webUtils } = require('electron')

const on = (channel, cb) => {
  const handler = (_e, data) => cb(data)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,

  chooseFolder: () => ipcRenderer.invoke('dialog:chooseFolder'),
  chooseFile: () => ipcRenderer.invoke('dialog:chooseFile'),
  setRoot: (root) => ipcRenderer.invoke('workspace:setRoot', root),
  allowFile: (p) => ipcRenderer.invoke('workspace:allowFile', p),
  tree: (root) => ipcRenderer.invoke('fs:tree', root),
  read: (p) => ipcRenderer.invoke('fs:read', p),
  write: (p, content) => ipcRenderer.invoke('fs:write', p, content),
  flush: (p, content) => ipcRenderer.sendSync('fs:flush', { p, content }),
  create: (parent, base, type) => ipcRenderer.invoke('fs:create', parent, base, type),
  validateName: (name) => ipcRenderer.invoke('fs:validateName', name),
  rename: (p, newName) => ipcRenderer.invoke('fs:rename', p, newName),
  trash: (p) => ipcRenderer.invoke('fs:trash', p),
  reveal: (p) => ipcRenderer.invoke('fs:reveal', p),
  openDir: (p) => ipcRenderer.invoke('fs:openDir', p),
  chooseImageDirectory: (defaultPath) => ipcRenderer.invoke('img:chooseDirectory', defaultPath),
  allowImageDirectory: (directory) => ipcRenderer.invoke('img:allowDirectory', directory),
  saveImage: (fileName, data, documentPath, storage) => ipcRenderer.invoke('img:save', fileName, data, documentPath, storage),
  downloadImage: (url, documentPath, storage) => ipcRenderer.invoke('img:download', url, documentPath, storage),
  exportPdf: (payload) => ipcRenderer.invoke('export:pdf', payload),
  exportDocx: (payload) => ipcRenderer.invoke('export:docx', payload),
  setExportEnabled: (enabled) => ipcRenderer.invoke('ui:exportState', enabled),

  openExternal: (url) => ipcRenderer.invoke('ui:openExternal', url),
  clipboard: (action) => ipcRenderer.invoke('ui:clipboard', action),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file) || '' } catch { return '' } },
  popupMenu: (items, x, y) => ipcRenderer.invoke('ui:menu', { items, x, y }),
  setTheme: (mode) => ipcRenderer.invoke('ui:theme', mode),
  openImageViewer: (src, title) => ipcRenderer.invoke('ui:imageViewer', { src, title }),
  imageViewerData: () => ipcRenderer.invoke('ui:imageViewerData'),
  openInNewWindow: (p) => ipcRenderer.invoke('window:standalone', p),
  claimDocument: (p) => ipcRenderer.invoke('doc:claim', p),
  releaseDocument: () => ipcRenderer.invoke('doc:release'),
  documentOwner: (p) => ipcRenderer.invoke('doc:owner', p),

  initialFile: () => ipcRenderer.invoke('app:initialFile'),
  resizeWindow: (mode) => ipcRenderer.invoke('ui:resize', mode),

  onFsChanged: (cb) => on('fs:changed', cb),
  onThemeChanged: (cb) => on('theme:changed', cb),
  onMenu: (cb) => on('menu', cb),
  onOpenFile: (cb) => on('open-file', cb),
})
