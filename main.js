const { app, BrowserWindow, Menu, ipcMain, dialog, shell, protocol, nativeTheme, net } = require('electron')
const path = require('path')
const fs = require('fs')
const fsp = fs.promises

const isDev = !app.isPackaged
const DEV_URL = process.env.VITE_DEV_SERVER_URL || ''
// Use the pixel-perfect small frame on Windows instead of asking Electron to
// choose a frame from the ICO or downscale the 1024px artwork for the taskbar.
// The multi-size ICO remains configured in electron-builder for the exe.
const APP_ICON = process.platform === 'win32'
  ? path.join(__dirname, 'build', 'icon-window.png')
  : path.join(__dirname, 'build', 'icon.png')
const MD_RE = /\.(md|markdown|mdown|mkd)$/i
const IGNORED = new Set(['.git', 'node_modules', '.svn', '.idea', '.vscode', '.DS_Store', 'Thumbs.db', 'desktop.ini'])
const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
}

let win = null
const imageViewerWindows = new Set()
const imageViewerData = new Map()
let currentRoot = null
let watcher = null
let watchTimer = null
const allowedRoots = new Set()
let pendingOpenFile = null

// ---------- helpers ----------

function insideRoot(root, p) {
  const rel = path.relative(root, p)
  return !rel.startsWith('..') && !path.isAbsolute(rel)
}

function assertInside(p) {
  if (!currentRoot || !insideRoot(currentRoot, p)) throw new Error('路径不在当前工作空间内')
}

function entryNameError(value) {
  const name = String(value ?? '')
  if (!name) return '名称不能为空'
  if (/\s/.test(name)) return '名称不能包含空格或其他空白字符'
  if (/[\x00-\x1f\\/:*?"<>|]/.test(name)) return '名称包含不允许的字符 \\ / : * ? " < > |'
  if (name === '.' || name === '..') return '不能使用 . 或 .. 作为名称'
  if (name.startsWith('.')) return '名称不能以点开头'
  if (name.endsWith('.')) return '名称不能以点结尾'
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(name)) return '不能使用系统保留名称'
  if (name.length > 255) return '名称不能超过 255 个字符'
  return null
}

function findFileArg(argv) {
  for (const a of argv.slice(1)) {
    try {
      const p = path.resolve(a)
      if (MD_RE.test(p) && fs.existsSync(p) && fs.statSync(p).isFile()) return p
    } catch { /* ignore */ }
  }
  return null
}

async function uniquePath(parent, base, ext, suffixSeparator = ' ') {
  let i = 1
  let name = base + ext
  for (;;) {
    const p = path.join(parent, name)
    try { await fsp.access(p); i++; name = `${base}${suffixSeparator}${i}${ext}` } catch { return p }
  }
}

async function listTree(dir, depth) {
  let entries
  try { entries = await fsp.readdir(dir, { withFileTypes: true }) } catch { return [] }
  const out = []
  for (const ent of entries) {
    if (ent.name.startsWith('.') || IGNORED.has(ent.name)) continue
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      out.push({ name: ent.name, path: full, type: 'dir', children: depth >= 12 ? [] : await listTree(full, depth + 1) })
    } else if (ent.isFile() && MD_RE.test(ent.name)) {
      out.push({ name: ent.name, path: full, type: 'file' })
    }
  }
  out.sort((a, b) => (a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name, 'zh-Hans-CN')))
  return out
}

function onFsEvent() {
  clearTimeout(watchTimer)
  watchTimer = setTimeout(() => { if (win && !win.isDestroyed()) win.webContents.send('fs:changed') }, 250)
}

function setWorkspaceRoot(root) {
  currentRoot = path.resolve(root)
  allowedRoots.add(currentRoot)
  if (watcher) { try { watcher.close() } catch { /* ignore */ } watcher = null }
  try {
    watcher = fs.watch(root, { recursive: true }, onFsEvent)
    watcher.on('error', () => { /* 目录被移除等，静默 */ })
  } catch { watcher = null } // 平台不支持递归监听时静默降级
}

// ---------- window ----------

function createWindow() {
  win = new BrowserWindow({
    width: 1120,
    height: 740,
    minWidth: 780,
    minHeight: 540,
    show: false,
    title: 'tinymd',
    icon: APP_ICON,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e20' : '#ffffff',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay: process.platform === 'win32'
      ? { height: 44, symbolColor: nativeTheme.shouldUseDarkColors ? '#eaeaeb' : '#1d1d1f' }
      : undefined,
    trafficLightPosition: { x: 16, y: 15 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })

  if (process.platform === 'win32') {
    win.setIcon(APP_ICON)
    win.setAutoHideMenuBar(true)
    win.setMenuBarVisibility(false)
  }
  win.once('ready-to-show', () => win.show())

  if (DEV_URL) win.loadURL(DEV_URL)
  else win.loadFile(path.join(__dirname, 'dist/renderer/index.html'))

  if (isDev) win.webContents.on('console-message', (_e, _level, message) => console.log('[renderer]', message))

  win.on('closed', () => { win = null })
}

function imageStorageDirectory(documentPath, storage) {
  assertInside(documentPath)
  const documentDir = path.dirname(documentPath)
  const mode = storage?.mode
  let dir
  if (mode === 'custom') {
    if (!storage.directory || !path.isAbsolute(storage.directory)) throw new Error('尚未指定图片存储目录')
    dir = path.resolve(storage.directory)
    allowedRoots.add(dir)
  } else if (mode === 'document-assets') {
    const documentName = path.basename(documentPath, path.extname(documentPath)) || 'document'
    dir = path.join(documentDir, `assets.${documentName}`)
  } else {
    dir = path.join(documentDir, 'assets')
  }
  return { dir, documentDir }
}

function downloadedImageName(mime) {
  const ext = ({
    'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp',
    'image/svg+xml': '.svg', 'image/avif': '.avif', 'image/bmp': '.bmp', 'image/x-icon': '.ico',
  })[mime] || '.png'
  const d = new Date()
  const pad = (n, size = 2) => String(n).padStart(size, '0')
  return `image${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${pad(d.getMilliseconds(), 3)}${ext}`
}

async function writeImage(fileName, data, documentPath, storage) {
  const { dir, documentDir } = imageStorageDirectory(documentPath, storage)
  await fsp.mkdir(dir, { recursive: true })
  const ext = (path.extname(fileName || '') || '.png').toLowerCase()
  const base = (path.basename(fileName || '', path.extname(fileName || '')).replace(/[\\/:*?"<>|]/g, '-').slice(0, 60)) || 'image'
  const p = await uniquePath(dir, base, ext, '')
  await fsp.writeFile(p, Buffer.from(data))
  return { abs: p, displayPath: path.relative(documentDir, p).split(path.sep).join('/') }
}

function createImageViewer(parent, src, title) {
  src = String(src || '')
  title = String(title || '图片').slice(0, 200)
  if (!/^(app-file:|https?:|data:image\/)/i.test(src)) return false

  const viewer = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 560,
    minHeight: 400,
    show: false,
    title,
    icon: APP_ICON,
    backgroundColor: '#202124',
    autoHideMenuBar: true,
    ...(parent && !parent.isDestroyed() ? { parent } : {}),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : process.platform === 'win32' ? 'hidden' : 'default',
    titleBarOverlay: process.platform === 'win32'
      ? { color: '#202124', symbolColor: '#d7d7d9', height: 48 }
      : undefined,
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })

  const viewerId = viewer.webContents.id
  if (process.platform === 'win32') viewer.setIcon(APP_ICON)
  imageViewerWindows.add(viewer)
  imageViewerData.set(viewerId, { src, title })
  viewer.setMenuBarVisibility(false)
  viewer.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  viewer.once('ready-to-show', () => viewer.show())
  viewer.on('closed', () => {
    imageViewerData.delete(viewerId)
    imageViewerWindows.delete(viewer)
  })

  if (DEV_URL) viewer.loadURL(`${DEV_URL.replace(/\/$/, '')}/image-viewer.html`)
  else viewer.loadFile(path.join(__dirname, 'dist/renderer/image-viewer.html'))
  return true
}

// ---------- app menu ----------

function send(channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
}

function buildMenu() {
  const template = [
    {
      label: 'tinymd',
      submenu: [
        { role: 'about', label: '关于 tinymd' },
        { type: 'separator' },
        { role: 'hide', label: '隐藏 tinymd' },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        { role: 'quit', label: '退出 tinymd' },
      ].filter(Boolean),
    },
    {
      label: '文件',
      submenu: [
        { label: '打开文件夹…', accelerator: 'CmdOrCtrl+O', click: () => send('menu', 'open-folder') },
        { label: '新建文件', accelerator: 'CmdOrCtrl+N', click: () => send('menu', 'new-file') },
        { label: '保存', accelerator: 'CmdOrCtrl+S', click: () => send('menu', 'save') },
        { type: 'separator' },
        { label: '插入链接…', accelerator: 'CmdOrCtrl+K', click: () => send('menu', 'link') },
        { label: '关闭工作空间', accelerator: 'CmdOrCtrl+Shift+W', click: () => send('menu', 'close-workspace') },
        { type: 'separator' },
        { role: 'close', label: '关闭窗口' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', accelerator: 'CmdOrCtrl+Z', click: () => send('menu', 'undo') },
        { label: '重做', accelerator: 'CmdOrCtrl+Shift+Z', click: () => send('menu', 'redo') },
        { type: 'separator' },
        { label: '剪切', role: 'cut' },
        { label: '拷贝', role: 'copy' },
        { label: '粘贴', role: 'paste' },
        { label: '全选', role: 'selectAll' },
      ],
    },
    {
      label: '显示',
      submenu: [
        { label: '切换边栏', accelerator: 'CmdOrCtrl+\\', click: () => send('menu', 'toggle-sidebar') },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '进入全屏' },
        ...(isDev ? [{ type: 'separator' }, { role: 'toggleDevTools', label: '开发者工具' }] : []),
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ---------- ipc ----------

function registerIpc() {
  ipcMain.handle('dialog:chooseFolder', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: '选择要打开的文件夹',
      buttonLabel: '打开',
      properties: ['openDirectory', 'createDirectory'],
    })
    return r.canceled ? null : r.filePaths[0]
  })

  ipcMain.handle('workspace:setRoot', (_e, root) => { setWorkspaceRoot(root); return true })
  ipcMain.handle('fs:tree', (_e, root) => listTree(root, 0))

  ipcMain.handle('fs:read', async (_e, p) => {
    assertInside(p)
    return (await fsp.readFile(p, 'utf8')).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  })

  ipcMain.handle('fs:write', async (_e, p, content) => {
    assertInside(p)
    await fsp.mkdir(path.dirname(p), { recursive: true })
    await fsp.writeFile(p, content, 'utf8')
    return true
  })

  ipcMain.on('fs:flush', (e, { p, content }) => {
    try { assertInside(p); fs.writeFileSync(p, content, 'utf8') } catch { /* 退出前尽力而为 */ }
    e.returnValue = true
  })

  ipcMain.handle('fs:create', async (_e, parent, base, type) => {
    assertInside(parent)
    const ext = type === 'file' ? '.md' : ''
    const error = entryNameError(String(base) + ext)
    if (error) throw new Error(error)
    const p = await uniquePath(parent, base, ext, '')
    if (type === 'dir') await fsp.mkdir(p)
    else await fsp.writeFile(p, '', 'utf8')
    return p
  })

  ipcMain.handle('fs:validateName', (_e, name) => entryNameError(name))

  ipcMain.handle('fs:rename', async (_e, oldPath, newName) => {
    assertInside(oldPath)
    newName = String(newName)
    if (entryNameError(newName)) return null
    const target = path.join(path.dirname(oldPath), newName)
    if (target === oldPath) return oldPath
    try { await fsp.access(target); return null } catch { /* 不存在即可重命名 */ }
    await fsp.rename(oldPath, target)
    return target
  })

  ipcMain.handle('fs:trash', async (_e, p) => { assertInside(p); await shell.trashItem(p); return true })
  ipcMain.handle('fs:reveal', (_e, p) => { shell.showItemInFolder(p); return true })

  ipcMain.handle('img:chooseDirectory', async (_e, defaultPath) => {
    const options = {
      title: '选择图片存储目录',
      buttonLabel: '选择',
      properties: ['openDirectory', 'createDirectory'],
    }
    if (defaultPath && path.isAbsolute(defaultPath)) options.defaultPath = defaultPath
    const r = await dialog.showOpenDialog(win, options)
    if (r.canceled || !r.filePaths[0]) return null
    const selected = path.resolve(r.filePaths[0])
    allowedRoots.add(selected)
    return selected
  })

  ipcMain.handle('img:allowDirectory', (_e, directory) => {
    if (!directory || !path.isAbsolute(directory)) return false
    allowedRoots.add(path.resolve(directory))
    return true
  })

  ipcMain.handle('img:save', async (_e, fileName, data, documentPath, storage) => {
    if (!currentRoot) throw new Error('尚未打开工作空间')
    return writeImage(fileName, data, documentPath, storage)
  })

  ipcMain.handle('img:download', async (_e, url, documentPath, storage) => {
    if (!currentRoot) throw new Error('尚未打开工作空间')
    if (!/^https?:\/\//i.test(String(url))) throw new Error('只支持下载 HTTP(S) 图片')
    assertInside(documentPath)
    const response = await net.fetch(String(url), { redirect: 'follow' })
    if (!response.ok) throw new Error(`图片下载失败 (${response.status})`)
    const mime = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    if (!mime.startsWith('image/')) throw new Error('网络地址返回的不是图片')
    const requestedLimit = Math.round(Number(storage?.maxDownloadSizeMB))
    const limitMB = Number.isFinite(requestedLimit) && requestedLimit >= 1 ? Math.min(1024, requestedLimit) : 30
    const limitBytes = limitMB * 1024 * 1024
    const declaredSize = Number(response.headers.get('content-length') || 0)
    if (declaredSize > limitBytes) throw new Error(`图片超过 ${limitMB} MB 限制`)
    const data = new Uint8Array(await response.arrayBuffer())
    if (data.byteLength > limitBytes) throw new Error(`图片超过 ${limitMB} MB 限制`)
    return writeImage(downloadedImageName(mime), data, documentPath, storage)
  })

  ipcMain.handle('ui:openExternal', (_e, url) => {
    if (/^https?:\/\//i.test(url)) return shell.openExternal(url)
    return false
  })

  ipcMain.handle('ui:imageViewer', (e, { src, title }) => (
    createImageViewer(BrowserWindow.fromWebContents(e.sender), src, title)
  ))
  ipcMain.handle('ui:imageViewerData', (e) => imageViewerData.get(e.sender.id) || null)

  ipcMain.handle('ui:menu', (e, { items, x, y }) => new Promise((resolve) => {
    const tpl = items.map((it) => it === '-'
      ? { type: 'separator' }
      : {
          label: it.label,
          enabled: it.enabled !== false,
          click: () => resolve(it.id ?? null),
        })
    Menu.buildFromTemplate(tpl).popup({
      window: BrowserWindow.fromWebContents(e.sender),
      x: Math.round(x), y: Math.round(y),
      callback: () => resolve(null),
    })
  }))

  ipcMain.handle('app:initialFile', () => pendingOpenFile)

  // 渲染层主题切换后同步：原生菜单（nativeTheme）+ Windows 标题栏按钮
  ipcMain.handle('ui:theme', (_e, mode) => {
    nativeTheme.themeSource = mode === 'dark' || mode === 'neutral' ? 'dark' : mode === 'system' ? 'system' : 'light'
    if (process.platform === 'win32' && win) {
      win.setTitleBarOverlay({ color: '#00000000', symbolColor: nativeTheme.shouldUseDarkColors ? '#eaeaeb' : '#1d1d1f', height: 44 })
    }
    return true
  })
}

// ---------- custom protocol for local images ----------

protocol.registerSchemesAsPrivileged([
  { scheme: 'app-file', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
])

function registerProtocol() {
  protocol.handle('app-file', async (req) => {
    try {
      const u = new URL(req.url)
      let p = decodeURIComponent(u.pathname).replace(/^\//, '')
      if (process.platform !== 'win32') p = '/' + p
      const norm = path.normalize(p)
      const ok = [...allowedRoots].some((r) => insideRoot(r, norm))
      if (isDev) console.log('[app-file]', req.url, '->', norm, ok ? 'ALLOW' : 'DENY', 'roots:', [...allowedRoots])
      if (!ok) return new Response('forbidden', { status: 403 })
      const data = await fsp.readFile(norm)
      return new Response(data, { headers: { 'content-type': MIME[path.extname(norm).toLowerCase()] || 'application/octet-stream' } })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}

// ---------- app lifecycle ----------

function sendOpenFile(p) {
  if (win && !win.isDestroyed()) win.webContents.send('open-file', p)
  else pendingOpenFile = p
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const f = findFileArg(argv)
    if (f) sendOpenFile(f)
    if (win) { if (win.isMinimized()) win.restore(); win.focus() }
  })

  app.on('open-file', (_e, p) => { if (MD_RE.test(p)) sendOpenFile(p) })

  app.whenReady().then(() => {
    pendingOpenFile = findFileArg(process.argv)
    registerProtocol()
    registerIpc()
    buildMenu()
    if (process.platform === 'darwin') {
      app.setAboutPanelOptions({ applicationName: 'tinymd', applicationVersion: app.getVersion() })
    }
    createWindow()
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
    nativeTheme.on('updated', () => {
      if (!win || win.isDestroyed()) return
      try {
        win.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#1e1e20' : '#ffffff')
        if (process.platform === 'win32') win.setTitleBarOverlay({ symbolColor: nativeTheme.shouldUseDarkColors ? '#eaeaeb' : '#1d1d1f' })
      } catch { /* ignore */ }
    })
  })

  app.on('window-all-closed', () => app.quit())
}
