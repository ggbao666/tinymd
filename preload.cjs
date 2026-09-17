const { contextBridge, ipcRenderer } = require('electron')

const on = (channel, cb) => {
  const handler = (_e, data) => cb(data)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,

  chooseFolder: () => ipcRenderer.invoke('dialog:chooseFolder'),
  setRoot: (root) => ipcRenderer.invoke('workspace:setRoot', root),
  tree: (root) => ipcRenderer.invoke('fs:tree', root),
  read: (p) => ipcRenderer.invoke('fs:read', p),
  write: (p, content) => ipcRenderer.invoke('fs:write', p, content),
  flush: (p, content) => ipcRenderer.sendSync('fs:flush', { p, content }),
  create: (parent, base, type) => ipcRenderer.invoke('fs:create', parent, base, type),
  rename: (p, newName) => ipcRenderer.invoke('fs:rename', p, newName),
  trash: (p) => ipcRenderer.invoke('fs:trash', p),
  reveal: (p) => ipcRenderer.invoke('fs:reveal', p),
  chooseImageDirectory: (defaultPath) => ipcRenderer.invoke('img:chooseDirectory', defaultPath),
  allowImageDirectory: (directory) => ipcRenderer.invoke('img:allowDirectory', directory),
  saveImage: (fileName, data, documentPath, storage) => ipcRenderer.invoke('img:save', fileName, data, documentPath, storage),

  openExternal: (url) => ipcRenderer.invoke('ui:openExternal', url),
  popupMenu: (items, x, y) => ipcRenderer.invoke('ui:menu', { items, x, y }),
  setTheme: (mode) => ipcRenderer.invoke('ui:theme', mode),
  openImageViewer: (src, title) => ipcRenderer.invoke('ui:imageViewer', { src, title }),
  imageViewerData: () => ipcRenderer.invoke('ui:imageViewerData'),

  initialFile: () => ipcRenderer.invoke('app:initialFile'),

  onFsChanged: (cb) => on('fs:changed', cb),
  onMenu: (cb) => on('menu', cb),
  onOpenFile: (cb) => on('open-file', cb),
})
