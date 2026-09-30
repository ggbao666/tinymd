const { app, BrowserWindow, Menu, ipcMain, dialog, shell, protocol, nativeTheme, net, screen } = require('electron')
const path = require('path')
const fs = require('fs')
const fsp = fs.promises
// 导出 Word 的映射器（ProseMirror 文档模型 → docx）。
// 单独一个文件：它是一套「把 style.css 的数值翻译成 Word 排版元素」的翻译表，
// 塞进 main.js 会把这边的窗口/菜单逻辑淹掉。⚠️ 记得同步 electron-builder.yml 的 files。
const { buildDocx } = require('./docx-export.cjs')

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

let win = null                 // 主窗口
// 所有编辑器窗口（主窗口 + 独立窗口）：广播（文件变更、主题）按它遍历，
// 导出用的隐藏打印窗口不在其中。
const editorWindows = new Set()
// webContents.id -> 启动时要打开的文件。独立窗口靠它拿到目标文档，
// 主窗口也占一个（值为待打开文件或 null），这样 app:initialFile 是窗口级的。
const windowInitialFile = new Map()

// 欢迎页与编辑器使用两套窗口尺寸：欢迎页只显示 2 条「最近打开」，
// 更多条目由列表区自己滚动，因此窗口不需要跟着条目变高；进入编辑器再放大。
// ⚠️ 最小宽度也跟着分两套：工作区 600、欢迎页 460（欢迎页本身只有 480 宽，拿 600
// 去卡它连创建都别扭）。两者在 ui:resize 里随尺寸一起切换 —— 换尺寸前必须先松最小宽度，
// 否则从工作区退回欢迎页会被 600 卡住、窗口缩不到 480。
// 面板互不互斥**不归这里管**：渲染层那条 PANELS_EXCLUSIVE_W(800) 说的是
// 「窗口窄到 800 以下，左右两块面板只能开一块」，跟「窗口能被拖到多窄」是两件事。
// ⚠️ WORKSPACE_W 是「侧栏 264 + 编辑区 + 目录 246」一起住的那个宽度：
// 1000 时两块同开，正文可用 = 1000 - 264 - 246 - 滚动条 10 = 480，正好抵在渲染层的
// EDITOR_MIN(480) 上（侧栏一分都不用让）；窗口再窄一点，侧栏才开始让出宽度。
// （历史上是 1020 → 1180 → 1200 → 1000，这次按用户要求收窄到 1000。）
const WELCOME_W = 480
const WELCOME_MIN_W = 460
const WELCOME_H = 400
const WORKSPACE_W = 1000
const WORKSPACE_MIN_W = 600
const WORKSPACE_H = 680
const WINDOW_MIN_H = 380

const imageViewerWindows = new Set()
const imageViewerData = new Map()
let currentRoot = null
let watcher = null
let watchTimer = null
const allowedRoots = new Set()
const allowedFiles = new Set()
let pendingOpenFile = null

// ---------- helpers ----------

function insideRoot(root, p) {
  const rel = path.relative(root, p)
  return !rel.startsWith('..') && !path.isAbsolute(rel)
}

// 单文件模式（拖入 / 双击 / 「打开文件…」/ 命令行参数）没有工作空间，
// 但仍要能读写这一个文件。只放行确实存在的 Markdown 文件，
// 避免渲染层把任意路径交给文件系统接口。
function allowFile(p) {
  try {
    const abs = path.resolve(String(p ?? ''))
    if (!MD_RE.test(abs)) return null
    if (!fs.statSync(abs).isFile()) return null
    if (allowedFiles.size > 200) allowedFiles.clear()
    allowedFiles.add(abs)
    // 文件所在目录同时作为「可读取媒体目录」：单文件模式下文档旁边的
    // assets/ 图片要能经 app-file:// 显示（该集合只用于读图和「在文件夹中打开」）
    allowedRoots.add(path.dirname(abs))
    return abs
  } catch { return null }
}

function assertInside(p) {
  const abs = path.resolve(String(p))
  if (currentRoot && insideRoot(currentRoot, abs)) return abs
  if (allowedFiles.has(abs)) return abs
  throw new Error('路径不在当前工作空间内')
}

// 读取时再放宽一层：单文件模式允许跟随文档里的相对链接跳到同目录的其它 Markdown
function assertReadable(p) {
  try { return assertInside(p) } catch (error) {
    const abs = path.resolve(String(p))
    if (MD_RE.test(abs)) {
      const dir = path.dirname(abs)
      for (const f of allowedFiles) {
        if (path.dirname(f) === dir) { allowedFiles.add(abs); return abs }
      }
    }
    throw error
  }
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
  // 广播而非只发主窗口：独立窗口开着同一工作空间里的文件时也要跟着刷新
  watchTimer = setTimeout(() => broadcast('fs:changed'), 250)
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

// ---------- document ownership ----------

// 同一个 Markdown 同一时刻只允许在一个窗口里打开。
// 每个窗口都是独立的内存副本、各自 0.6s 自动保存，两处同时编辑必然后写覆盖先写，
// 而且界面上看不出来（文件监听只在「本窗口没脏」时才回读磁盘）。
// 所以一篇文档被打开前先在这里登记归属，重复打开只把已有的那个窗口抬到前面。
// 归属随窗口走：一个窗口一次只登记当前这一篇（切文档时旧的自动让出，见 claimDocument）。
const documentOwners = new Map()

/** 路径 → 占用表的键。Windows 大小写不敏感，同一个文件不能因大小写被开两次 */
function docKey(p) {
  const abs = path.resolve(String(p ?? ''))
  return process.platform === 'win32' ? abs.toLowerCase() : abs
}

function ownerOf(p) {
  if (!p) return null
  const owner = documentOwners.get(docKey(p))
  return owner && !owner.isDestroyed() ? owner : null
}

function focusWindow(w) {
  if (!w || w.isDestroyed()) return
  if (w.isMinimized()) w.restore()
  w.focus()
}

function releaseDocument(w) {
  for (const [key, held] of [...documentOwners]) {
    if (held === w) documentOwners.delete(key)
  }
}

/**
 * 把 p 的归属交给窗口 w。已被别的窗口占用时**不转移**：只把那个窗口抬到前面并返回
 * { ok: false }，w 原有的归属保持不变（先判后清，不会顺手把当前这篇让出去）。
 * p 传 null 表示这一篇关掉了，w 的归属一并清空。
 * 返回的 self = 「本来就是你占着」，渲染层据此区分「自己已打开」与「刚认领成功」。
 */
function claimDocument(w, p) {
  const owner = ownerOf(p)
  if (owner && owner !== w) {
    focusWindow(owner)
    return { ok: false, self: false }
  }
  releaseDocument(w)
  if (p) documentOwners.set(docKey(p), w)
  return { ok: true, self: owner === w }
}

// ---------- window ----------

/**
 * 把目标几何夹回它所在显示器的工作区 —— **只挪位置，不改尺寸**。
 * 换基准尺寸时窗口会一下宽出去几百像素（欢迎页 480 → 工作区 1180），若它原本贴在
 * 屏幕右侧、或者在小屏 / 分屏 / 接了外接屏的场景里，右边界会整条跑到屏幕外 ——
 * 「窗口变宽了却看不全」比不加宽更糟，所以每次换尺寸都过一道这个。
 * 窗口本身比工作区还大时贴到左上角（不缩尺寸：把窗口拖多大是用户自己的选择）。
 */
function fitToWorkArea(bounds) {
  const area = screen.getDisplayMatching(bounds).workArea
  const clamp = (v, min, size) => Math.round(Math.min(Math.max(v, min), Math.max(min, min + size)))
  return {
    ...bounds,
    x: clamp(bounds.x, area.x, area.width - bounds.width),
    y: clamp(bounds.y, area.y, area.height - bounds.height),
  }
}

/** 编辑器窗口（主窗口 / 独立窗口）共用的创建参数：外观、标题栏、底色。
    `minWidth` 由调用方按窗口形态给：工作区 600、欢迎页与独立窗口 460。 */
function editorWindowOptions({ width, height, title, minWidth = WELCOME_MIN_W }) {
  return {
    width,
    height,
    minWidth,
    minHeight: WINDOW_MIN_H,
    show: false,
    title,
    icon: APP_ICON,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#383a3d' : '#f4f4f2',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    // Windows WCO 不支持透明底色（#00000000 会回退成系统白），
    // 初始给中性主题底色，渲染层启动后会经 ui:theme 校正
    titleBarOverlay: process.platform === 'win32'
      ? { height: 38, color: '#383a3d', symbolColor: '#eaeaeb' }
      : undefined,
    trafficLightPosition: { x: 16, y: 15 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  }
}

/**
 * 编辑器窗口的收尾：登记到窗口集合、图标与菜单栏策略、缩放复位、开发日志。
 * 主窗口与独立窗口都要这一套，两者只在创建参数和加载方式上不同。
 */
function attachEditorWindow(w, initialFile) {
  const wcId = w.webContents.id
  editorWindows.add(w)
  windowInitialFile.set(wcId, initialFile ?? null)

  if (process.platform === 'win32') {
    w.setIcon(APP_ICON)
    w.setAutoHideMenuBar(true)
    w.setMenuBarVisibility(false)
  }
  w.once('ready-to-show', () => w.show())
  // 菜单是应用级的（全局唯一），聚焦窗口变了就要按它的状态重算导出项可用性
  w.on('focus', refreshExportMenu)
  w.on('closed', () => {
    editorWindows.delete(w)
    windowInitialFile.delete(wcId)
    exportEnabled.delete(wcId)
    // 窗口没了，它占着的文档要放出来，否则那篇从此谁都打不开
    releaseDocument(w)
    refreshExportMenu()
  })

  // Chromium 会把 file:// 页面的缩放级别持久化（误触 Ctrl+滚轮 / Ctrl+= 后重启依旧放大）。
  // 每次加载页面后强制回到 100%，缩放只作为会话内临时操作（Ctrl+0 可随时复位）。
  w.webContents.on('did-finish-load', () => {
    if (!w.isDestroyed() && Math.abs(w.webContents.getZoomFactor() - 1) > 0.001) {
      w.webContents.zoomFactor = 1
    }
  })
  if (isDev) w.webContents.on('console-message', (_e, _level, message) => console.log('[renderer]', message))
  return w
}

function createWindow() {
  win = attachEditorWindow(new BrowserWindow(editorWindowOptions({
    width: pendingOpenFile ? WORKSPACE_W : WELCOME_W,
    height: pendingOpenFile ? WORKSPACE_H : WELCOME_H,
    minWidth: pendingOpenFile ? WORKSPACE_MIN_W : WELCOME_MIN_W,
    title: 'tinymd',
  })), pendingOpenFile)

  if (DEV_URL) win.loadURL(DEV_URL)
  else win.loadFile(path.join(__dirname, 'dist/renderer/index.html'))

  win.on('closed', () => { win = null })
}

/**
 * 独立窗口：只编辑一个 Markdown，不带工作空间侧栏。
 * 与主窗口**共用同一套页面和样式**，差异只有启动参数 `?mode=standalone`
 * （渲染层据此加 body.standalone），所以不存在第二套 UI 要维护。
 * 目标文件在这里就登记进 allowedFiles / allowedRoots，窗口一打开就能读它和它的图片。
 */
function createStandaloneWindow(file) {
  const target = allowFile(file)
  if (!target) return 'invalid'

  // 这篇已经在别的窗口（主窗口或另一个独立窗口）里开着就别开了，
  // 把那个窗口抬到前面 —— 两处编辑同一篇必然互相覆盖
  const existing = ownerOf(target)
  if (existing) { focusWindow(existing); return 'focus' }

  const w = attachEditorWindow(new BrowserWindow(editorWindowOptions({
    width: WORKSPACE_W,
    height: WORKSPACE_H,
    minWidth: WORKSPACE_MIN_W,
    title: path.basename(target).replace(MD_RE, ''),
  })), target)

  // 先替它占上：从这里到渲染层认领之间还有几百毫秒（建窗口 + 加载页面 + 读文件），
  // 中间如果没有归属，另一个窗口能趁这个空隙打开同一篇。
  // 渲染层启动后会用同一路径再认领一次（归属是它自己，直接通过）。
  documentOwners.set(docKey(target), w)

  if (DEV_URL) {
    const url = new URL(DEV_URL)
    url.searchParams.set('mode', 'standalone')
    w.loadURL(url.toString())
  } else {
    w.loadFile(path.join(__dirname, 'dist/renderer/index.html'), { query: { mode: 'standalone' } })
  }
  return 'opened'
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

// 菜单动作发给**当前聚焦**的编辑器窗口。多窗口下固定发主窗口会让独立窗口里的
// Ctrl+P / Ctrl+S 作用到错误的文档上。隐藏的打印窗口不聚焦、也不在 editorWindows 里。
function send(channel, ...args) {
  const focused = BrowserWindow.getFocusedWindow()
  const target = focused && editorWindows.has(focused) ? focused : win
  if (target && !target.isDestroyed()) target.webContents.send(channel, ...args)
}

/** 广播给所有编辑器窗口（导出用的隐藏打印窗口不在集合内，不会被波及） */
function broadcast(channel, ...args) {
  for (const w of editorWindows) {
    if (!w.isDestroyed()) w.webContents.send(channel, ...args)
  }
}

// 导出菜单项是应用级的（菜单全局唯一），可用性只能取「当前聚焦窗口」的判定：
// 主窗口和独立窗口可能开着不同的文档，不能都往同一个菜单项上写。
const exportEnabled = new Map() // webContents.id -> 是否可导出
function refreshExportMenu() {
  const focused = BrowserWindow.getFocusedWindow()
  const target = focused && exportEnabled.has(focused.webContents.id) ? focused : win
  const enabled = !!(target && !target.isDestroyed() && exportEnabled.get(target.webContents.id))
  for (const id of ['export-pdf', 'export-docx']) {
    const item = Menu.getApplicationMenu()?.getMenuItemById(id)
    if (item) item.enabled = enabled
  }
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
        // 初始置灰：没有打开文档时导出没有意义。可用性由渲染层经 ui:exportState 同步
        // （只要打开了文档就可导出，与编辑模式无关 —— 渲染走的是离线渲染，不读编辑器 DOM）
        { id: 'export-pdf', label: '导出为 PDF…', accelerator: 'CmdOrCtrl+P', enabled: false, click: () => send('menu', 'export-pdf') },
        { id: 'export-docx', label: '导出为 Word…', accelerator: 'CmdOrCtrl+Shift+P', enabled: false, click: () => send('menu', 'export-docx') },
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

/**
 * 对话框挂到发起请求的那个窗口上。多窗口下不能固定用主窗口 ——
 * 在独立窗口里点导出，保存对话框却被主窗口盖住会让人以为没反应。
 */
function dialogParent(e) {
  const w = BrowserWindow.fromWebContents(e.sender)
  return w && !w.isDestroyed() ? w : win
}

function registerIpc() {
  ipcMain.handle('dialog:chooseFolder', async (e) => {
    const r = await dialog.showOpenDialog(dialogParent(e), {
      title: '选择要打开的文件夹',
      buttonLabel: '打开',
      properties: ['openDirectory', 'createDirectory'],
    })
    return r.canceled ? null : r.filePaths[0]
  })

  ipcMain.handle('dialog:chooseFile', async (e) => {
    const r = await dialog.showOpenDialog(dialogParent(e), {
      title: '选择要打开的 Markdown 文件',
      buttonLabel: '打开',
      properties: ['openFile'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] }],
    })
    if (r.canceled || !r.filePaths[0]) return null
    return allowFile(r.filePaths[0])
  })

  ipcMain.handle('workspace:setRoot', (_e, root) => { setWorkspaceRoot(root); return true })
  ipcMain.handle('fs:tree', (_e, root) => listTree(root, 0))
  // 渲染层拿到的是拖拽/双击等来源的路径，交回主进程登记为可读写文件
  ipcMain.handle('workspace:allowFile', (_e, p) => !!allowFile(p))

  ipcMain.handle('fs:read', async (_e, p) => {
    assertReadable(p)
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
  // 用系统文件管理器打开目录（区别于 reveal 的“定位并选中”）；限定在已授权根目录内
  ipcMain.handle('fs:openDir', (_e, p) => {
    const dir = path.resolve(String(p))
    if (![...allowedRoots].some((r) => insideRoot(r, dir))) return false
    void shell.openPath(dir)
    return true
  })

  ipcMain.handle('img:chooseDirectory', async (e, defaultPath) => {
    const options = {
      title: '选择图片存储目录',
      buttonLabel: '选择',
      properties: ['openDirectory', 'createDirectory'],
    }
    if (defaultPath && path.isAbsolute(defaultPath)) options.defaultPath = defaultPath
    const r = await dialog.showOpenDialog(dialogParent(e), options)
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

  ipcMain.handle('img:save', async (_e, fileName, data, documentPath, storage) => (
    // 图片落在文档所在目录，权限由 writeImage → imageStorageDirectory → assertInside 把关：
    // 目录模式落在工作空间内，单文件模式落在该文件所在目录内
    writeImage(fileName, data, documentPath, storage)
  ))

  ipcMain.handle('img:download', async (_e, url, documentPath, storage) => {
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

  // 导出 PDF：在隐藏窗口里重放一份「纯文档」页面再打印。直接对编辑器窗口调用
  // printToPDF 不行——编辑区是 overflow:auto 的滚动容器，分页会被切坏。
  //
  // 串行化：同时发起两次 printToPDF 时 Chromium 会直接报 "Printing failed"。
  // 保存对话框关掉后打印还要约一秒，这期间窗口已能再次响应（右键再导一次），
  // 所以用一条队列把真正的打印串起来，后一次等前一次结束再跑。
  let exportQueue = Promise.resolve()
  ipcMain.handle('export:pdf', (e, payload) => {
    const parent = dialogParent(e)
    const run = exportQueue.then(() => printPdf(payload, parent), () => printPdf(payload, parent))
    exportQueue = run.then(() => {}, () => {})
    return run
  })

  async function printPdf({ html, css, name }, parent) {
    const r = await dialog.showSaveDialog(parent, {
      title: '导出为 PDF',
      defaultPath: `${String(name || 'document')}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    // ⚠️ 保存对话框返回的是 filePath（单数，取消时为 ''），
    // 不是上面 showOpenDialog 那种 filePaths 数组。
    if (r.canceled || !r.filePath) return null

    const printer = new BrowserWindow({
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
    })
    try {
      // 从 about:blank 起步：页面里没有任何应用外壳，只有下面注入的文档内容与样式
      await printer.loadURL('about:blank')
      await printer.webContents.executeJavaScript(`(() => {
        document.documentElement.className = 'theme-light'
        const style = document.createElement('style')
        style.textContent = ${JSON.stringify(String(css || ''))}
        document.head.appendChild(style)
        const root = document.createElement('div')
        root.className = 'ProseMirror'
        root.innerHTML = ${JSON.stringify(String(html || ''))}
        document.body.appendChild(root)
        return Promise.all([
          document.fonts.ready,
          ...[...document.images].map((img) => img.decode().catch(() => {})),
        ])
      })()`)
      const pdf = await printer.webContents.printToPDF({
        pageSize: 'A4',
        // 必须开：否则代码块底色、==高亮==、表头底色会被打印样式一并剥离
        printBackground: true,
        margins: { top: 0.7, bottom: 0.7, left: 0.71, right: 0.71 }, // 单位英寸
        displayHeaderFooter: true,
        headerTemplate: '<div></div>',
        // 页眉页脚模板不继承页面样式，字号/颜色/字体都得内联写死
        footerTemplate: '<div style="width:100%;font-size:9px;text-align:center;color:#a5a5ac;font-family:sans-serif">'
          + '<span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      })
      await fsp.writeFile(r.filePath, pdf)
      return r.filePath
    } finally {
      if (!printer.isDestroyed()) printer.destroy()
    }
  }

  // 导出 Word：渲染层给的是**文档模型**（editor.getJSON()）与目标文档所在目录，
  // 图片相对路径按那个目录解析 —— 所以导出任意一篇都不需要切换当前文档。
  // 与 PDF 不同，这里没有隐藏窗口，全程在 Node 里组装，不需要排队。
  ipcMain.handle('export:docx', async (e, { doc, baseDir, name }) => {
    const r = await dialog.showSaveDialog(dialogParent(e), {
      title: '导出为 Word',
      defaultPath: `${String(name || 'document')}.docx`,
      filters: [{ name: 'Word 文档', extensions: ['docx'] }],
    })
    // 与上面一样：保存对话框返回的是 filePath（单数）
    if (r.canceled || !r.filePath) return null
    const { buffer, skippedImages } = await buildDocx(doc, path.resolve(String(baseDir || '')), {
      title: String(name || 'document'),
      // 图片必须落在已授权目录内（与 app-file:// 同一套判定）；越界或读不到的按「跳过」计数
      allowPath: (abs) => [...allowedRoots].some((root) => insideRoot(root, abs)),
    })
    await fsp.writeFile(r.filePath, buffer)
    return { path: r.filePath, skipped: skippedImages }
  })

  // 导出菜单项的可用性：由渲染层按「是否打开了文档」同步（与编辑模式无关）。
  // 按窗口分别记录，菜单项上显示的是当前聚焦窗口的判定（见 refreshExportMenu）。
  ipcMain.handle('ui:exportState', (e, enabled) => {
    exportEnabled.set(e.sender.id, !!enabled)
    refreshExportMenu()
    return true
  })

  ipcMain.handle('ui:openExternal', (_e, url) => {
    if (/^https?:\/\//i.test(url)) return shell.openExternal(url)
    return false
  })

  // 右键菜单里的剪切 / 复制 / 粘贴：走 webContents 原生实现，比 execCommand 可靠
  ipcMain.handle('ui:clipboard', (e, action) => {
    const wc = e.sender
    if (wc.isDestroyed()) return false
    if (action === 'cut') wc.cut()
    else if (action === 'copy') wc.copy()
    else if (action === 'paste') wc.paste()
    else return false
    return true
  })

  ipcMain.handle('ui:imageViewer', (e, { src, title }) => (
    createImageViewer(BrowserWindow.fromWebContents(e.sender), src, title)
  ))
  ipcMain.handle('ui:imageViewerData', (e) => imageViewerData.get(e.sender.id) || null)

  // 文件树右键「在新窗口中打开」：独立窗口只编辑这一篇，不带工作空间侧栏。
  // 返回值让渲染层能把话说准：'opened' 开了新窗口，'focus' 这篇已经在某个窗口里
  // （已把它抬到前面，没有再开），'invalid' 路径不合法或文件不存在。
  ipcMain.handle('window:standalone', (_e, p) => createStandaloneWindow(p))

  // 文档归属：渲染层每次切换文档前先认领（claim），被别的窗口占着就原地不动；
  // 关闭工作空间 / 文档被删时释放（release）；右键菜单先查归属（owner），
  // 才能把「在新窗口中打开」写成灰显或「前往已打开的窗口」。见文件头的归属表。
  ipcMain.handle('doc:claim', (e, p) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (!w || w.isDestroyed()) return { ok: false, self: false }
    return claimDocument(w, p ? path.resolve(String(p)) : null)
  })

  ipcMain.handle('doc:release', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (w) releaseDocument(w)
    return true
  })

  ipcMain.handle('doc:owner', (e, p) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    const owner = ownerOf(p)
    return { self: !!owner && owner === w, other: !!owner && owner !== w }
  })

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

  // 启动时要打开的文件是**窗口级**的：独立窗口各自带着自己的目标文档，
  // 只有主窗口才对应 argv / 双击传入的那一个。
  ipcMain.handle('app:initialFile', (e) => windowInitialFile.get(e.sender.id) ?? null)

  // 渲染层在进入/退出编辑器时调用，让窗口在两套尺寸间切换。
  // 面板（侧栏 / 目录）的收放**不归这里管**：它们是从编辑区里切空间的，窗口一动不动 ——
  // 所以这里就是纯粹的「换成哪一套基准尺寸」，没有任何增量要抹平。
  // ⚠️ 最小宽度也是两套的（工作区 600 / 欢迎页 460），且必须**先松再换** ——
  // 反过来的话，从工作区退回欢迎页时窗口被 600 卡着，缩不到 480。
  // ⚠️ 换完尺寸要夹回工作区：两套尺寸差了 500 多 px 宽，贴右站着的窗口会一下跑出屏幕。
  ipcMain.handle('ui:resize', (e, mode) => {
    // 只有主窗口在欢迎页 / 工作区两套尺寸之间切换；独立窗口尺寸固定，直接忽略
    if (!win || win.isDestroyed() || e.sender !== win.webContents) return false
    const workspace = mode === 'workspace'
    win.setMinimumSize(workspace ? WORKSPACE_MIN_W : WELCOME_MIN_W, WINDOW_MIN_H)
    const w = workspace ? WORKSPACE_W : WELCOME_W
    const h = workspace ? WORKSPACE_H : WELCOME_H
    const b = win.getBounds()
    win.setBounds(fitToWorkArea({ x: b.x, y: b.y, width: w, height: h }))
    return true
  })

  ipcMain.handle('ui:theme', (e, mode) => {
    currentThemeMode = mode
    nativeTheme.themeSource = mode === 'neutral' ? 'dark' : 'light'
    // 主题是应用级设置：所有窗口的标题栏一起换，并通知**其它**窗口同步界面配色
    // （只做 DOM 更新、不再回传 setTheme，否则两个窗口会互相触发形成回环）
    for (const w of editorWindows) {
      if (w.isDestroyed()) continue
      if (process.platform === 'win32') {
        try { w.setTitleBarOverlay(overlayFor(mode)) } catch { /* 窗口类型不支持时忽略 */ }
      }
      if (w.webContents.id !== e.sender.id) w.webContents.send('theme:changed', mode)
    }
    return true
  })
}

// ---------- custom protocol for local images ----------

// Windows 标题栏按钮（WCO）主题同步：透明底色在 Windows 上不生效（会回退成白），
// 必须给与渲染层 --bg 一致的真实底色；currentThemeMode 由 ui:theme 维护
let currentThemeMode = 'neutral'
function overlayFor(mode) {
  const resolved = mode === 'neutral' ? 'dark' : 'light'
  const bg = { light: '#f4f4f2', neutral: '#383a3d' }[resolved] || '#383a3d'
  const dark = resolved === 'dark'
  return { color: bg, symbolColor: dark ? '#eaeaeb' : '#1d1d1f', height: 38 }
}

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
  const abs = allowFile(p)
  if (!abs) return
  if (win && !win.isDestroyed()) win.webContents.send('open-file', abs)
  else pendingOpenFile = abs
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
    pendingOpenFile = allowFile(findFileArg(process.argv))
    registerProtocol()
    registerIpc()
    buildMenu()
    if (process.platform === 'darwin') {
      app.setAboutPanelOptions({ applicationName: 'tinymd', applicationVersion: app.getVersion() })
    }
    createWindow()
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
    nativeTheme.on('updated', () => {
      const bg = currentThemeMode === 'neutral' ? '#383a3d' : '#f4f4f2'
      for (const w of editorWindows) {
        if (w.isDestroyed()) continue
        try {
          w.setBackgroundColor(bg)
          if (process.platform === 'win32') w.setTitleBarOverlay(overlayFor(currentThemeMode))
        } catch { /* ignore */ }
      }
    })
  })

  app.on('window-all-closed', () => app.quit())
}
