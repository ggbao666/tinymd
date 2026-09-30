import './style.css'
// 导出 PDF 时把样式以字符串形式交给主进程，在隐藏窗口里原样复现编辑器的排版。
// 与上面的副作用导入指向同一个文件、只是查询串不同，两者互不冲突。
import editorCss from './style.css?inline'
import printCss from './print.css?inline'
import { createEditor, markdownToDoc, markdownToHtml, type EditorCtl } from './editor'
import type { JSONContent } from '@tiptap/core'
import { createTree } from './tree'
import { showContextMenu } from './contextmenu'
import { openImageViewer } from './imageviewer'
import { basename, dirname, encodeMarkdownPath, imageFileName, relativeFrom, resolveRel, type ImageStorageMode, type ImageStorageSettings, type PopupItem } from './util'

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!

const MD_RE = /\.(md|markdown|mdown|mkd)$/i

// 独立窗口（文件树右键「在新窗口中打开」）：与主窗口**共用同一套页面**，
// 只有启动参数不同 —— 它只编辑一个文件，不要工作空间侧栏。
// 形态差异统一用 body.standalone 表达，样式在 style.css 里，逻辑在这里分流。
const STANDALONE = new URLSearchParams(location.search).get('mode') === 'standalone'

const els = {
  welcome: $('#view-welcome'),
  btnOpenFolder: $('#btn-open-folder'),
  btnOpenFile: $('#btn-open-file'),
  recents: $('#recents'),
  workspace: $('#view-workspace'),
  topbar: $('#topbar'),
  btnSidebar: $('#btn-sidebar'),
  btnToc: $('#btn-toc') as HTMLButtonElement,
  tocFloat: $('#toc-float'),
  tocList: $('#toc-float-list'),
  breadcrumb: $('#breadcrumb'),
  status: $('#status'),
  sidebar: $('#sidebar'),
  tree: $('#tree'),
  wsPath: $('#ws-path'),
  content: $('#content'),
  editorEmpty: $('#editor-empty'),
  editorWrap: $('#editor-wrap'),
  editor: $('#editor'),
  sourceWrap: $('#source-wrap'),
  sourceEditor: $('#source-editor') as HTMLTextAreaElement,
  sourceModeButton: $('#btn-source-mode') as HTMLButtonElement,
  count: $('#count'),
  statusPill: $('#status-pill'),
  linkPopover: $('#link-popover'),
  linkInput: $('#link-input') as HTMLInputElement,
  fileInput: $('#file-input') as HTMLInputElement,
  welcomeToast: $('#welcome-toast'),
  settingsBackdrop: $('#settings-backdrop'),
  imageSettingsButton: $('#btn-image-settings') as HTMLButtonElement,
  imageCustomPath: $('#image-custom-path'),
  imageMaxDownloadSize: $('#image-max-download-size') as HTMLInputElement,
}

if (window.api.platform === 'darwin') document.body.classList.add('mac')
if (window.api.platform === 'win32') document.body.classList.add('win')

/**
 * 右侧留白的滚动条补偿。
 *
 * 正文的左右内边距是同一个数（--content-pad），但 #editor-wrap 的滚动条会贴着
 * 窗口右缘再占掉一条（Windows 经典滚动条 10px、macOS overlay 滚动条 0px），
 * 于是右边看起来总比左边宽一点。这里实测一次滚动条宽度交给 CSS，
 * 由 CSS 从右侧内边距里扣掉它 —— 屏幕上的左右留白就对等了。
 *
 * ⚠️ 必须同步执行（模块求值时立刻跑）：晚一步会先按 0 画一帧，正文横向抖一下。
 * ⚠️ 用离屏探针而不是直接量 #editor-wrap —— 没打开文件时它是 display:none，
 * offsetWidth / clientWidth 都是 0，量出来永远是 0。
 */
let scrollbarWidth = 0

function syncScrollbarWidth() {
  const probe = document.createElement('div')
  probe.style.cssText = 'position:absolute;top:-9999px;left:-9999px;width:100px;height:100px;overflow:scroll'
  document.body.appendChild(probe)
  const width = probe.offsetWidth - probe.clientWidth
  probe.remove()
  document.documentElement.style.setProperty('--sb-w', `${width}px`)
  scrollbarWidth = width
}
syncScrollbarWidth()

if (STANDALONE) {
  document.body.classList.add('standalone')
  // 独立窗口一定带着目标文件启动，直接进工作区视图，省掉欢迎页闪一下
  els.welcome.classList.add('hidden')
  els.workspace.classList.remove('hidden')
}

const state = {
  root: null as string | null,
  openPath: null as string | null,
  dirty: false,
}
// 单文件模式：通过「打开文件」/拖拽/双击打开单个 md，只看大纲，不显示文件树
let fileMode = false
type EditorMode = 'visual' | 'source'
let editorMode: EditorMode = 'visual'
let lastSaved = ''
let saveTimer: number | undefined

// ---------- editor ----------

const editorCtl: EditorCtl = createEditor(els.editor, {
  onChange() {
    state.dirty = true
    setStatus('编辑中…')
    updateBreadcrumb()
    updateCount()
    scheduleOutline()
    scheduleSave()
  },
  onImageFiles(files) {
    void saveImageFiles(files)
  },
  onRemoteImages(urls) {
    void localizeRemoteImages(urls)
  },
  onOpenLink(url) {
    if (!url) return
    if (/^https?:\/\//i.test(url)) {
      void window.api.openExternal(url)
      return
    }
    // 相对 .md 链接：目录模式以工作空间为界，单文件模式以文件所在目录为界
    if (/\.md$/i.test(url) && state.openPath) {
      const abs = resolveInside(state.openPath, url)
      if (abs) void openFile(abs)
    }
  },
  onPickImage() {
    els.fileInput.click()
  },
  onViewImage(src: string, displaySrc: string) {
    openImageViewer(displaySrc, src ? basename(src) : '图片')
  },
  async onImageContext(x: number, y: number, src: string, displaySrc: string) {
    const abs = state.openPath && src ? resolveInside(state.openPath, src) : null
    const id = await showContextMenu(
      [
        { id: 'view', label: '查看图片', enabled: !!displaySrc },
        { id: 'reveal', label: '打开所在位置', enabled: !!abs },
        '-',
        { id: 'delete', label: '删除图片' },
      ],
      x,
      y,
    )
    if (id === 'view' && displaySrc) {
      openImageViewer(displaySrc, src ? basename(src) : '图片')
    } else if (id === 'reveal' && abs) {
      void window.api.reveal(abs)
    } else if (id === 'delete') {
      editorCtl.deleteSelectedImage()
      setStatus('已删除图片')
    }
  },
  async onTextContext(x: number, y: number) {
    const active = new Set(editorCtl.activeMarks())
    const mark = (id: string, label: string, hint: string) => ({
      id,
      label: (active.has(id) ? '✓ ' : '') + label,
      hint,
    })
    const mod = window.api.platform === 'darwin' ? '⌘' : 'Ctrl+'
    const id = await showContextMenu(
      [
        { id: 'cut', label: '剪切', hint: mod + 'X' },
        { id: 'copy', label: '复制', hint: mod + 'C' },
        { id: 'paste', label: '粘贴', hint: mod + 'V' },
        '-',
        mark('bold', '加粗', '**粗体**'),
        mark('italic', '斜体', '*斜体*'),
        mark('code', '行内代码', '`代码`'),
        mark('strike', '删除线', '~~删除~~'),
        mark('highlight', '高亮', '==高亮=='),
      ],
      x,
      y,
    )
    if (id === 'cut' || id === 'copy' || id === 'paste') {
      // 确保焦点在编辑器内（保持当前选区），webContents 原生动作才能作用于选中文本
      editorCtl.focus()
      void window.api.clipboard(id)
    } else if (id) {
      editorCtl.textMark(id)
    }
  },
  async onTableContext(x: number, y: number) {
    const id = await showContextMenu(
      [
        { id: 'row-before', label: '在上方插入行' },
        { id: 'row-after', label: '在下方插入行' },
        { id: 'col-before', label: '在左侧插入列' },
        { id: 'col-after', label: '在右侧插入列' },
        '-',
        { id: 'row-delete', label: '删除行' },
        { id: 'col-delete', label: '删除列' },
        '-',
        { id: 'table-delete', label: '删除表格' },
      ],
      x,
      y,
    )
    if (id) editorCtl.tableAction(id)
  },
  onRequestLink() {
    openLinkPopover()
  },
})

function resolveInside(fromFile: string, rel: string): string | null {
  const abs = resolveRel(dirname(fromFile), rel)
  // 单文件模式下没有工作空间，以当前文件所在目录为边界
  const boundary = (state.root ?? dirname(fromFile)).replace(/\\/g, '/')
  return abs.startsWith(boundary + '/') ? abs : null
}

// ---------- tree ----------

const treeCtl = createTree(els.tree, {
  onOpenFile(p) { return openFile(p) },
  onContext(kind, path, x, y) { void showTreeMenu(kind, path, x, y) },
  onNewFile(dir) { void createEntry(dir, 'file') },
  onRename(oldPath, newName) { void doRename(oldPath, newName) },
  onRenameSettled(oldPath, committed) {
    // 新建文件后的重命名：Escape 取消则保持默认名不打开；名字没改直接提交则按默认名打开
    if (pendingOpenPath !== oldPath) return
    const p = pendingOpenPath
    pendingOpenPath = null
    if (committed) void openFile(p)
  },
})

/** 新建文件后等待重命名完成再打开的路径（非新建流程为 null） */
let pendingOpenPath: string | null = null

async function refreshTree() {
  if (!state.root) return
  treeCtl.setData(await window.api.tree(state.root))
}

// ---------- status ----------

let statusTimer: number | undefined
let persistentStatus = ''   // 保存状态：左侧常驻显示，不自动消失

// 欢迎页没有状态栏，同样的提示用页面内的浮条兜底，避免拖入不支持的文件时毫无反馈
let welcomeToastTimer: number | undefined
function flashWelcomeToast(text: string, isError = false) {
  if (els.welcome.classList.contains('hidden')) return
  els.welcomeToast.textContent = text
  els.welcomeToast.classList.toggle('error', isError)
  els.welcomeToast.classList.remove('hidden')
  clearTimeout(welcomeToastTimer)
  welcomeToastTimer = window.setTimeout(() => els.welcomeToast.classList.add('hidden'), 2600)
}

function setStatus(text: string, isError = false) {
  // 保存状态（已保存 / 编辑中…）常驻在左侧；其余为临时提示，2.4s 后回落到保存状态
  if (text === '已保存' || text === '编辑中…') {
    persistentStatus = text
    clearTimeout(statusTimer)
    els.statusPill.classList.remove('hidden')
    els.status.textContent = text
    els.status.classList.remove('error')
    return
  }
  flashWelcomeToast(text, isError)
  els.statusPill.classList.remove('hidden')
  els.status.textContent = text
  els.status.classList.toggle('error', isError)
  clearTimeout(statusTimer)
  statusTimer = window.setTimeout(() => {
    els.status.textContent = persistentStatus
    els.status.classList.toggle('error', false)
  }, 2400)
}

// ---------- save ----------

function currentDocumentText(): string {
  return editorMode === 'source' ? els.sourceEditor.value : editorCtl.getMarkdown()
}

function scheduleSave() {
  clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => void doSave(), 600)
}

async function doSave() {
  clearTimeout(saveTimer)
  if (!state.openPath || !state.dirty) return
  const md = currentDocumentText()
  if (md === lastSaved) { state.dirty = false; updateBreadcrumb(); return }
  try {
    await window.api.write(state.openPath, md)
    lastSaved = md
    state.dirty = false
    setStatus('已保存')
    updateBreadcrumb()
  } catch (e) {
    setStatus('保存失败：' + (e as Error).message, true)
  }
}

async function flushSave() {
  clearTimeout(saveTimer)
  if (state.dirty && state.openPath) await doSave()
}

window.addEventListener('beforeunload', () => {
  if (state.dirty && state.openPath) window.api.flush(state.openPath, currentDocumentText())
})

// ---------- open file / workspace ----------

/**
 * 打开一篇文档。**这是「一个文件只在一个窗口里编辑」的唯一关口** ——
 * 无论从文件树、最近打开、拖拽、双击、命令行还是相对链接进来，最后都走这里。
 * 返回是否真的打开了（被别的窗口占着时为 false，调用方据此决定要不要清空当前视图）。
 */
async function openFile(path: string): Promise<boolean> {
  if (path === state.openPath) return true
  await flushSave()
  // 先认领编辑权：被别的窗口占着就原地不动（主进程会把那个窗口抬到前面）。
  // 两处各自 0.6s 自动保存同一篇，必然后写覆盖先写，而且界面上完全看不出来。
  const claim = await window.api.claimDocument(path)
  if (!claim.ok) {
    setStatus(`「${basename(path)}」已在另一个窗口中打开`, true)
    return false
  }
  try {
    const md = await window.api.read(path)
    editorCtl.open(md, dirname(path))
    els.sourceEditor.value = md
    // 文本模式只作用于当前查看；切换到任意文档时恢复所见即所得。
    editorMode = 'visual'
    state.openPath = path
    lastSaved = md
    state.dirty = false
    treeCtl.select(path)
    showEditor()
    updateBreadcrumb()
    updateCount()
    // 独立窗口的标题是「文档 — tinymd」：它不属于任何工作空间，没有目录名可挂
    const dr = displayRoot()
    document.title = STANDALONE
      ? `${basename(path)} — tinymd`
      : dr ? `${basename(path)} — ${basename(dr)}` : basename(path)
    els.editorWrap.scrollTop = 0
    els.sourceEditor.scrollTop = 0
    void localizeRemoteImages(editorCtl.remoteImageSources())
    return true
  } catch (e) {
    // 没读进来就把归属还给上一篇：上面的认领已经把它让出去了，
    // 不还回来现在屏幕上这一篇就成了「无人认领」，别的窗口能再打开它
    if (state.openPath) void window.api.claimDocument(state.openPath)
    setStatus('无法打开文件', true)
    return false
  }
}

async function openWorkspace(root: string, selectFile?: string) {
  await flushSave()
  await window.api.setRoot(root)
  state.root = root
  // 从单文件模式切回目录模式：把文件树（和整个侧栏）恢复出来
  fileMode = false
  document.body.classList.remove('file-mode')
  treeCtl.setData(await window.api.tree(root))
  els.wsPath.textContent = root
  els.wsPath.title = root
  els.welcome.classList.add('hidden')
  els.workspace.classList.remove('hidden')
  if (!STANDALONE) void window.api.resizeWindow('workspace')
  addRecent(root)
  document.title = basename(root)
  // 打开不了（比如那一篇正在别的窗口里）就退回空文档，而不是继续显示上一个工作空间的文档
  if (selectFile) { if (!await openFile(selectFile)) showEditorEmpty() }
  else showEditorEmpty()
}

// 单文件打开（打开文件 / 拖拽 / 双击 md / 右键打开）：
// 不把所在文件夹当工作空间，整个侧栏收起 —— 形态与独立窗口一致，只有正文和右侧的目录。
async function openSingleFile(path: string) {
  await flushSave()
  // 单文件模式没有工作空间，先把它登记为主进程可读写的文件，否则 fs:read / fs:write 会被拒绝
  if (!await window.api.allowFile(path)) {
    setStatus('无法打开该文件：文件不存在或不是 Markdown', true)
    return
  }
  // 已在别的窗口打开就到此为止：**不要**先切模式再打开 —— 那样被拒后会留下
  // 「侧栏已经变单文件模式、编辑器里却还是上一篇」的错位状态。
  if (!(await window.api.claimDocument(path)).ok) {
    setStatus(`「${basename(path)}」已在另一个窗口中打开`, true)
    return
  }
  state.root = null
  fileMode = true
  document.body.classList.add('file-mode')
  treeCtl.clear()
  els.welcome.classList.add('hidden')
  els.workspace.classList.remove('hidden')
  // 单文件模式整个侧栏收起 → 那 264px 直接还给编辑区（窗口尺寸不变，
  // 工作区与单文件模式共用同一套窗口尺寸）
  if (!STANDALONE) void window.api.resizeWindow('workspace')
  // 与目录模式一致：底部路径条显示的是目录路径，不是文件路径
  const dir = dirname(path)
  els.wsPath.textContent = dir
  els.wsPath.title = dir
  addRecent(path, 'file')
  await openFile(path)
}

async function closeWorkspace() {
  await flushSave()
  // 回欢迎页先把目录收掉：欢迎页没有编辑区，留着没有意义。
  // （窗口尺寸的账主进程在 ui:resize 里先抹平了，这里不必操心先后）
  setTocOpen(false)
  state.root = null
  fileMode = false
  document.body.classList.remove('file-mode')
  state.openPath = null
  void window.api.releaseDocument()
  state.dirty = false
  lastSaved = ''
  treeCtl.clear()
  els.workspace.classList.add('hidden')
  els.welcome.classList.remove('hidden')
  if (!STANDALONE) void window.api.resizeWindow('welcome')
  document.title = 'tinymd'
  renderRecents()
  syncExportAvailability()
}

function showEditor() {
  els.editorEmpty.classList.add('hidden')
  els.editorWrap.classList.toggle('hidden', editorMode !== 'visual')
  els.sourceWrap.classList.toggle('hidden', editorMode !== 'source')
  updateEditorModeButton()
  syncTocButton()
  refreshToc()
  syncExportAvailability()
}

function showEditorEmpty() {
  state.openPath = null
  // 没有文档了就把编辑权放出去，否则这一篇在别的窗口里会一直打不开
  void window.api.releaseDocument()
  els.editorWrap.classList.add('hidden')
  els.sourceWrap.classList.add('hidden')
  // 状态栏常驻：没有打开文档时只清空内容，不隐藏整条栏
  clearTimeout(statusTimer)
  persistentStatus = ''
  els.status.textContent = ''
  els.status.classList.remove('error')
  els.count.textContent = ''
  updateEditorModeButton()
  els.editorEmpty.classList.remove('hidden')
  syncTocButton()
  refreshToc()
  updateBreadcrumb()
  document.title = STANDALONE ? 'tinymd' : basename(displayRoot())
  syncExportAvailability()
}

// 单文件模式下没有挂工作空间（state.root 为 null），但文件所在目录是已知的。
// 目录名一类的展示要与目录模式保持一致，区别只是不能对工作目录做新建/删除/重命名。
function displayRoot(): string {
  return state.root || (state.openPath ? dirname(state.openPath) : '')
}

function updateBreadcrumb() {
  const root = displayRoot() ? basename(displayRoot()) : ''
  const file = state.openPath ? basename(state.openPath) : ''
  els.breadcrumb.innerHTML = ''
  if (root) {
    const f = document.createElement('span')
    f.className = 'crumb-folder'
    f.textContent = root
    els.breadcrumb.append(f)
  }
  if (file) {
    if (root) {
      const sep = document.createElement('span')
      sep.className = 'crumb-sep'
      sep.textContent = '›'
      els.breadcrumb.append(sep)
    }
    const d = document.createElement('span')
    d.className = 'crumb-doc'
    d.textContent = file
    if (state.dirty) d.classList.add('dirty')
    els.breadcrumb.append(d)
  }
}

function updateCount() {
  if (editorMode === 'visual') {
    els.count.textContent = editorCtl.wordCountText()
  } else {
    const count = els.sourceEditor.value.length
    els.count.textContent = count ? `${count.toLocaleString('zh-Hans-CN')} 字符` : ''
  }
}

// ---------- visual / source mode ----------

function updateEditorModeButton() {
  const source = editorMode === 'source'
  els.sourceModeButton.disabled = !state.openPath
  els.sourceModeButton.classList.toggle('active', source)
  els.sourceModeButton.setAttribute('aria-pressed', String(source))
  els.sourceModeButton.title = source ? '切换到编辑模式' : '切换到纯文本模式'
  els.sourceModeButton.setAttribute('aria-label', els.sourceModeButton.title)
}

function setEditorMode(mode: EditorMode) {
  if (!state.openPath || mode === editorMode) return
  if (mode === 'source') {
    els.sourceEditor.value = state.dirty ? editorCtl.getMarkdown() : lastSaved
    state.dirty = els.sourceEditor.value !== lastSaved
  } else {
    const markdown = els.sourceEditor.value
    // 纯文本是切回后的唯一数据源，整篇重新解析，避免两种编辑状态不一致。
    editorCtl.open(markdown, dirname(state.openPath))
    state.dirty = markdown !== lastSaved
  }
  editorMode = mode
  // 切进纯文本后大纲取不到标题（Tiptap 视图不参与渲染），空壳面板没意义 ——
  // 收起并把按钮置灰，由 showEditor 里的 syncTocButton 统一处理
  showEditor()
  updateBreadcrumb()
  updateCount()
  if (mode === 'source') void localizeRemoteImages(remoteImageUrlsInMarkdown(els.sourceEditor.value))
  requestAnimationFrame(() => {
    if (mode === 'source') els.sourceEditor.focus()
    else editorCtl.focus()
  })
}

els.sourceModeButton.addEventListener('click', () => {
  setEditorMode(editorMode === 'visual' ? 'source' : 'visual')
})

els.sourceEditor.addEventListener('input', () => {
  state.dirty = els.sourceEditor.value !== lastSaved
  setStatus(state.dirty ? '编辑中…' : '已保存')
  updateBreadcrumb()
  updateCount()
  if (state.dirty) scheduleSave()
  else clearTimeout(saveTimer)
  void localizeRemoteImages(remoteImageUrlsInMarkdown(els.sourceEditor.value))
})

els.sourceEditor.addEventListener('keydown', (event) => {
  if (event.key !== 'Tab') return
  event.preventDefault()
  const start = els.sourceEditor.selectionStart
  els.sourceEditor.setRangeText('  ', start, els.sourceEditor.selectionEnd, 'end')
  els.sourceEditor.dispatchEvent(new Event('input', { bubbles: true }))
})

// ---------- 文档目录（右侧那块固定区域用的数据层） ----------

let outlineTimer: number | undefined
/** 文档改动后延迟刷新。目录关着就不必重渲染 —— 展开时 setTocOpen 会渲染一次 */
function scheduleOutline() {
  clearTimeout(outlineTimer)
  outlineTimer = window.setTimeout(refreshToc, 250)
}

// 纯文本模式下 Tiptap 视图不参与渲染，取不到标题 —— 此时目录按「空」处理
function outlineItems(): { level: number; text: string; pos: number }[] {
  return state.openPath && editorMode === 'visual' ? editorCtl.getOutline() : []
}

/** 生成一组目录行 */
function outlineRows(items: { level: number; text: string; pos: number }[], onPick: (pos: number) => void) {
  const frag = document.createDocumentFragment()
  for (const it of items) {
    const row = document.createElement('div')
    row.className = `outline-item lv-${it.level}`
    row.textContent = it.text || '（空标题）'
    row.title = it.text
    row.addEventListener('click', () => onPick(it.pos))
    frag.append(row)
  }
  return frag
}

/** 换了文档 / 改了内容后同步目录内容（关着就不用管，展开时会渲染） */
function refreshToc() {
  if (tocOpen) renderToc()
}

// ---------- 两侧面板：向内收，给编辑区留底线 ----------
//
// 侧栏（左）与目录（右）都**从编辑区里切空间**，窗口尺寸一动不动。
//
// 早先那套「面板往外长、窗口跟着伸缩」的做法已经废弃，原因是它有个消不掉的时序问题：
// 窗口几何只能**瞬时**变（setBounds 没有动画可放），而侧栏宽度是带动画的，两者必然错帧 ——
// 收起时窗口先跳到窄尺寸、侧栏还要 180ms 才缩完，正文被挤窄再弹回；展开时窗口先长出去、
// 侧栏才慢慢长出来，正文先撑宽再收回来（「先把编辑区拓展过去，把文件区显示出来，
// 把编辑区缩回去」）。窗口不动就没有这一类问题：面板收放退化成一次普通的页内重排，
// 动画想怎么做就怎么做。
//
// **谁跟谁冲突，由窗口宽度一条线说了算**（`PANELS_EXCLUSIVE_W`）：
//   窗口 < 800 → 左右两块互斥：开一块就把另一块收起来，点哪块留哪块
//     （窄窗口里两块一起摊开，正文剩不下多少，不如只留刚点的那块）
//   窗口 ≥ 800 → 两块可以同时开着；正文被挤窄那是用户自己的选择，不拦
//
// 编辑区那条底线 EDITOR_MIN 于是只剩一个职责：给**侧栏宽度**定上限
// （拖宽时挡住、空间不够时把它夹窄），跟「能不能同时开」不再是同一件事。
// ⚠️ 改 style.css 里侧栏 / 目录的宽度时，下面几个常量要一起改。

const SIDEBAR_W = 264   // 与 style.css 里 `#sidebar { width: 264px }` 一致
const SIDEBAR_MIN = 180 // 侧栏拖拽下限（与 style.css / 拖拽处一致）
const SIDEBAR_MAX = 520 // 侧栏拖拽上限
const SIDEBAR_W_KEY = 'jianmo.sidebarWidth'  // 拖过的宽度记在这儿
const TOC_PAD = 246     // 与 style.css 里 `body.toc-open … margin-right: 246px` 一致

/**
 * 左右两块面板互斥的窗口宽度线：窄于它时只能开一块。
 * ⚠️ 别看错对象：main.js 的 `WORKSPACE_MIN_W = 600` 说的是「窗口能被拖到多窄」，
 * 这条 800 说的是「窄到多少开始要互相让路」—— 两件事，没有先后关系。
 * 800 对应的画面是「两块同开时正文还剩 800 − 264 − 246 − 滚动条 10 = 280」。
 */
const PANELS_EXCLUSIVE_W = 800

/**
 * 编辑区保底宽度 —— 如今只用来给**侧栏宽度**定上限（拖拽 + 夹取两处），
 * 不再是「两块面板能不能同时开」的判据（那件事归 PANELS_EXCLUSIVE_W 管）。
 * 口径是「正文**真正能用到的**宽度」，所以算账时要一起扣掉滚动条
 * （`sidebarMaxWidth` 里减了 `scrollbarWidth`）—— 不扣的话屏幕上会莫名其妙少 10px。
 *
 * 于是存在「两块同开、但侧栏得让一让」的状态：默认窗口 1000 下两块同开正好抵在
 * 264（= 1000 − 246 − 10 − 480），侧栏不用让；窗口再窄一点、或用户把侧栏拖得更宽，
 * 就得让。让的只是**渲染宽度**（`applySidebarWidth`），用户拖出来的偏好宽度记在
 * `sidebarPref` 里，空间回来了会自动还给他。
 * ⚠️ 窗口本身的最小宽度是 main.js 的 `WORKSPACE_MIN_W = 600`，所以极窄窗口下
 * 「正文 ≥ 480」是够不着的（面板已经收无可收，不是漏判）。
 */
const EDITOR_MIN = 480

/** 用户拖出来的偏好宽度：拖拽时更新并持久化。它只是「想要多宽」，
    实际渲染出来的宽度还得过一遍 sidebarMaxWidth（空间不够就先让）—— 见 applySidebarWidth */
let sidebarPref = SIDEBAR_W
const savedSidebarW = Number(localStorage.getItem(SIDEBAR_W_KEY))
if (savedSidebarW >= SIDEBAR_MIN && savedSidebarW <= SIDEBAR_MAX) sidebarPref = savedSidebarW

/** 这个窗口的宽度里含不含一条侧栏 —— 独立窗口、单文件模式本来就不含 */
function hasSidebar(): boolean {
  if (STANDALONE) return false
  const cls = document.body.classList
  return !cls.contains('no-sidebar') && !cls.contains('file-mode')
}

/** 窗口窄到互斥线以下 → 左右两块面板只能开一块 */
function panelsExclusive(): boolean {
  return window.innerWidth < PANELS_EXCLUSIVE_W
}

/** 侧栏宽度的上限：不能让正文被挤到 EDITOR_MIN 以下（拖拽与空间变化两处共用） */
function sidebarMaxWidth(): number {
  const limit = window.innerWidth - (tocOpen ? TOC_PAD : 0) - scrollbarWidth - EDITOR_MIN
  return Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, limit))
}

/**
 * 侧栏宽度的**唯一出口**：渲染宽度 = 偏好宽度 ∩ 此刻的上限。
 * ⚠️ 夹窄**不写 localStorage** —— 那是空间不够时的临时妥协，不是用户的选择。
 * 早先的写法是把夹取值写回 DOM 并持久化，于是在窄窗口里开一次目录，侧栏就被
 * 永久记住了那个窄值（900 宽下夹到 180，窗口拉回来还是 180）。现在 DOM 只是渲染
 * 结果、偏好另有其处，空间一回来就自动还给他。
 */
function applySidebarWidth(): void {
  els.sidebar.style.width = `${Math.max(SIDEBAR_MIN, Math.min(sidebarPref, sidebarMaxWidth()))}px`
}

// 用户把窗口拖窄时重新核对一遍：
//   ① 拖到互斥线以下 → 两块只能留一块（侧栏是主面板，收起目录）
//   ② 侧栏自己太宽 → 按新的空间算一遍渲染宽度（空间回来时也会自动还原）
// ⚠️ ①要判 hasSidebar()：单文件模式、或侧栏本来就收着时，目录没跟谁抢位置，不该被收掉。
window.addEventListener('resize', () => {
  if (els.workspace.classList.contains('hidden')) return
  if (tocOpen && hasSidebar() && panelsExclusive()) {
    setTocOpen(false)
    setStatus('窗口变窄，已收起目录')
  }
  applySidebarWidth()
})


// ---------- 编辑区右侧的文档目录 ----------
//
// 主窗口、单文件模式、独立窗口都一样：标题只在这块区域里看。
// 只有一个开关：**标题栏上的那个按钮**（Ctrl/Cmd + Shift + O 同效）——
// 点一下展开、再点一下收起、Esc 也能收起。没有鼠标热区、也没有「钉住」这回事。
// （按钮以前挂在 #content 上、落在正文右侧那条留白里，现在归顶层按钮组，位置由 CSS 排，
//  JS 这边只管它的可用性与 active 态。）
// 展开时目录从右边**摊进编辑区**（正文让出 246px），窗口本身一动不动。

let tocOpen = false

function renderToc() {
  els.tocList.replaceChildren(outlineRows(outlineItems(), (pos) => editorCtl.revealPos(pos)))
}

function setTocOpen(open: boolean) {
  if (open === tocOpen) return
  // 目录是往编辑区里摊开的。窗口已经窄到两块只能留一块时，把侧栏收掉 ——
  // 刚点的那块优先，另一块让路（用户定的规矩：「打开一个，另一个自动隐藏」）。
  if (open && hasSidebar() && panelsExclusive()) {
    document.body.classList.add('no-sidebar')
    setStatus('窗口较窄，已收起文件栏')
  }
  tocOpen = open
  document.body.classList.toggle('toc-open', open)
  els.tocFloat.setAttribute('aria-hidden', String(!open))
  els.btnToc.classList.toggle('active', open)
  els.btnToc.setAttribute('aria-pressed', String(open))
  if (open) renderToc()
  // 目录让出的那份空间会改变侧栏的上限：它收起来时侧栏能更宽，展开时侧栏可能得让一点
  applySidebarWidth()
}

function toggleToc() {
  // 开着的时候随时能关；要开就得有标题 —— 空面板弹出来只会让人以为点坏了
  if (!tocOpen && !outlineItems().length) {
    setStatus(editorMode === 'source' ? '纯文本模式下没有目录' : '这篇文档还没有标题')
    return
  }
  setTocOpen(!tocOpen)
}

/** 目录按钮只在「有一篇文档、且不是纯文本模式」时给用 —— 那两种状态下取不到标题 */
function syncTocButton() {
  const usable = !!state.openPath && editorMode === 'visual'
  els.btnToc.classList.toggle('hidden', !state.openPath)
  els.btnToc.disabled = !usable
  if (!usable) setTocOpen(false)
}

els.btnToc.addEventListener('click', toggleToc)

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (tocOpen) setTocOpen(false)
    return
  }
  const mod = window.api.platform === 'darwin' ? event.metaKey : event.ctrlKey
  if (mod && event.shiftKey && (event.key === 'o' || event.key === 'O')) {
    event.preventDefault()
    toggleToc()
  }
})

// ---------- theme（主题：暗色（中性）/ 亮色，共两套灰调） ----------

const THEME_KEY = 'jianmo.theme'
type ThemeMode = 'neutral' | 'light'

// 历史版本存过 system / dark / qq / wb-* 等模式，统一迁移：暗色系 → neutral，亮色系 → light
const LEGACY_THEME_MAP: Record<string, ThemeMode> = {
  system: 'neutral', dark: 'neutral', 'wb-dark': 'neutral',
  light: 'light', qq: 'light', 'wb-light': 'light',
}
const storedTheme = localStorage.getItem(THEME_KEY)
const VALID_THEMES: ThemeMode[] = ['neutral', 'light']
let themeMode: ThemeMode = VALID_THEMES.includes(storedTheme as ThemeMode)
  ? (storedTheme as ThemeMode)
  : LEGACY_THEME_MAP[storedTheme || ''] ?? 'neutral'

/** 只把主题落到当前窗口的 DOM 上（被广播同步时用，不再回传主进程） */
function applyThemeDom() {
  const root = document.documentElement
  root.classList.toggle('theme-neutral', themeMode === 'neutral')
  root.classList.toggle('theme-light', themeMode === 'light')
  const settingsRadio = document.querySelector<HTMLInputElement>(`input[name="settings-theme"][value="${themeMode}"]`)
  if (settingsRadio) settingsRadio.checked = true
}

function applyTheme() {
  applyThemeDom()
  void window.api.setTheme(themeMode) // 原生右键菜单 + Windows 标题栏按钮跟随
}

applyTheme()

// 主题是应用级设置：主窗口改了，独立窗口也要跟着换，否则两个窗口配色不一致
window.api.onThemeChanged((mode) => {
  if (mode !== 'neutral' && mode !== 'light') return
  if (mode === themeMode) return
  themeMode = mode
  applyThemeDom()
})

// ---------- images ----------

const IMAGE_STORAGE_KEY = 'tinymd.imageStorage'
const IMAGE_STORAGE_MODES = new Set<ImageStorageMode>(['file-assets', 'custom', 'document-assets'])
const DEFAULT_IMAGE_DOWNLOAD_LIMIT_MB = 30

function normalizeImageDownloadLimit(value: unknown): number {
  const number = Math.round(Number(value))
  return Number.isFinite(number) && number >= 1 ? Math.min(1024, number) : DEFAULT_IMAGE_DOWNLOAD_LIMIT_MB
}

function loadImageStorage(): ImageStorageSettings {
  try {
    const value = JSON.parse(localStorage.getItem(IMAGE_STORAGE_KEY) || '{}') as Partial<ImageStorageSettings>
    if (value.mode && IMAGE_STORAGE_MODES.has(value.mode)) {
      return {
        mode: value.mode,
        ...(typeof value.directory === 'string' ? { directory: value.directory } : {}),
        maxDownloadSizeMB: normalizeImageDownloadLimit(value.maxDownloadSizeMB),
      }
    }
  } catch { /* 使用默认值 */ }
  return { mode: 'file-assets', maxDownloadSizeMB: DEFAULT_IMAGE_DOWNLOAD_LIMIT_MB }
}

let imageStorage = loadImageStorage()
if (imageStorage.directory) await window.api.allowImageDirectory(imageStorage.directory)

function saveImageStorage() {
  localStorage.setItem(IMAGE_STORAGE_KEY, JSON.stringify(imageStorage))
}

function renderImageStorageSettings() {
  const radio = document.querySelector<HTMLInputElement>(`input[name="image-storage"][value="${imageStorage.mode}"]`)
  if (radio) radio.checked = true
  els.imageCustomPath.textContent = imageStorage.directory || '尚未选择目录'
  els.imageCustomPath.title = imageStorage.directory || ''
  els.imageMaxDownloadSize.value = String(imageStorage.maxDownloadSizeMB)
}

function closeImageSettings() {
  els.settingsBackdrop.classList.add('hidden')
  els.imageSettingsButton.setAttribute('aria-expanded', 'false')
}

function openImageSettings() {
  renderImageStorageSettings()
  els.settingsBackdrop.classList.remove('hidden')
  els.imageSettingsButton.setAttribute('aria-expanded', 'true')
}

async function chooseImageStorageDirectory(): Promise<boolean> {
  const selected = await window.api.chooseImageDirectory(imageStorage.directory)
  if (!selected) return false
  imageStorage = { ...imageStorage, mode: 'custom', directory: selected }
  saveImageStorage()
  renderImageStorageSettings()
  return true
}

els.imageSettingsButton.addEventListener('click', (event) => {
  event.stopPropagation()
  if (els.settingsBackdrop.classList.contains('hidden')) openImageSettings()
  else closeImageSettings()
})

els.settingsBackdrop.addEventListener('click', (event) => {
  if (event.target === els.settingsBackdrop) closeImageSettings()
})
$('#btn-settings-close').addEventListener('click', closeImageSettings)
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeImageSettings()
})

document.querySelectorAll<HTMLButtonElement>('[data-settings-page]').forEach((button) => {
  button.addEventListener('click', () => {
    const page = button.dataset.settingsPage
    document.querySelectorAll<HTMLElement>('[data-settings-panel]').forEach((panel) => {
      panel.classList.toggle('hidden', panel.dataset.settingsPanel !== page)
    })
    document.querySelectorAll<HTMLButtonElement>('[data-settings-page]').forEach((item) => {
      item.classList.toggle('active', item === button)
    })
  })
})

document.querySelectorAll<HTMLInputElement>('input[name="settings-theme"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    themeMode = radio.value as ThemeMode
    localStorage.setItem(THEME_KEY, themeMode)
    applyTheme()
  })
})

document.querySelectorAll<HTMLInputElement>('input[name="image-storage"]').forEach((radio) => {
  radio.addEventListener('change', async () => {
    const mode = radio.value as ImageStorageMode
    if (mode === 'custom' && !imageStorage.directory) {
      if (!await chooseImageStorageDirectory()) renderImageStorageSettings()
      return
    }
    imageStorage = { ...imageStorage, mode }
    saveImageStorage()
    renderImageStorageSettings()
  })
})

$('#btn-image-directory').addEventListener('click', (event) => {
  event.preventDefault()
  event.stopPropagation()
  void chooseImageStorageDirectory()
})
els.imageMaxDownloadSize.addEventListener('change', () => {
  imageStorage = { ...imageStorage, maxDownloadSizeMB: normalizeImageDownloadLimit(els.imageMaxDownloadSize.value) }
  saveImageStorage()
  renderImageStorageSettings()
})
renderImageStorageSettings()

const localizingRemoteImages = new Set<string>()

function remoteImageUrlsInMarkdown(markdown: string): string[] {
  const urls: string[] = []
  const pattern = /!\[[^\]\r\n]*\]\(\s*<?(https?:\/\/[^)\s>]+)>?(?:\s+["'][^)]*)?\)/gi
  for (const match of markdown.matchAll(pattern)) urls.push(match[1])
  return [...new Set(urls)]
}

function replaceRemoteImageUrl(markdown: string, remoteUrl: string, localPath: string): string {
  const pattern = /(!\[[^\]\r\n]*\]\(\s*<?)(https?:\/\/[^)\s>]+)(>?\s*(?:["'][^)]*)?\))/gi
  return markdown.replace(pattern, (whole, prefix: string, url: string, suffix: string) => (
    url === remoteUrl ? `${prefix}${localPath}${suffix}` : whole
  ))
}

async function localizeRemoteImages(urls: string[]) {
  if (!state.openPath || !urls.length) return
  const documentPath = state.openPath
  const storage = { ...imageStorage }
  for (const url of [...new Set(urls)]) {
    const key = `${documentPath}\n${url}`
    if (localizingRemoteImages.has(key)) continue
    localizingRemoteImages.add(key)
    try {
      const res = await window.api.downloadImage(url, documentPath, storage)
      if (state.openPath !== documentPath) continue
      const localPath = encodeMarkdownPath(relativeFrom(dirname(documentPath), res.abs))
      if (editorMode === 'source') {
        const next = replaceRemoteImageUrl(els.sourceEditor.value, url, localPath)
        if (next !== els.sourceEditor.value) {
          els.sourceEditor.value = next
          els.sourceEditor.dispatchEvent(new Event('input', { bubbles: true }))
        }
      } else {
        editorCtl.replaceImageSource(url, localPath)
      }
      setStatus(`已本地化图片 ${res.displayPath}`)
    } catch (error) {
      setStatus(`图片本地化失败：${error instanceof Error ? error.message : String(error)}`, true)
    } finally {
      localizingRemoteImages.delete(key)
    }
  }
}

async function saveImageFiles(files: File[]) {
  if (!state.root || !state.openPath) return
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue
    try {
      const buf = new Uint8Array(await file.arrayBuffer())
      const name = imageFileName(file.type)
      const res = await window.api.saveImage(name, buf, state.openPath, imageStorage)
      const rel = encodeMarkdownPath(relativeFrom(dirname(state.openPath), res.abs))
      editorCtl.insertImage(rel, '')
      setStatus(`已存储图片 ${res.displayPath}`)
    } catch (e) {
      setStatus('图片保存失败', true)
    }
  }
}

els.fileInput.addEventListener('change', () => {
  const files = Array.from(els.fileInput.files || [])
  els.fileInput.value = ''
  if (files.length) void saveImageFiles(files)
})

// ---------- context menu ----------

async function showTreeMenu(kind: 'file' | 'dir' | 'root', path: string, x: number, y: number) {
  const target = kind === 'root' ? state.root! : path
  const items: (PopupItem | '-')[] = []
  if (kind === 'file') {
    // 两种格式的可用性规则相同：都是「导出被右键的那一篇」，都要先读文本再离线渲染
    items.push({ id: 'open', label: '打开' })
    // 同一个文件只能有一个窗口：正开在当前窗口里就没必要再开（开出来是同一篇），
    // 已被别的窗口开着则把菜单项改成「前往」，点了是切过去而不是再开一个。
    const owner = await window.api.documentOwner(path)
    items.push(owner.other
      ? { id: 'open-window', label: '前往已打开的窗口' }
      : { id: 'open-window', label: '在新窗口中打开', enabled: !owner.self, ...(owner.self ? { hint: '已在此窗口' } : {}) })
    items.push('-')
    items.push({ id: 'export-pdf', label: '导出为 PDF…' }, { id: 'export-docx', label: '导出为 Word…' }, '-')
    items.push({ id: 'rename', label: '重命名' }, { id: 'reveal', label: '在文件管理器中显示' }, '-')
    items.push({ id: 'delete', label: '移到废纸篓' })
  } else if (kind === 'dir') {
    items.push({ id: 'new-file', label: '新建文件' }, { id: 'new-folder', label: '新建文件夹' }, '-')
    items.push({ id: 'rename', label: '重命名' }, { id: 'reveal', label: '在文件管理器中显示' }, '-')
    items.push({ id: 'delete', label: '移到废纸篓' })
  } else {
    items.push({ id: 'new-file', label: '新建文件' }, { id: 'new-folder', label: '新建文件夹' }, '-')
    items.push({ id: 'open-dir', label: '在文件夹中打开' })
  }
  const id = await showContextMenu(items, x, y)
  if (!id) return
  switch (id) {
    case 'open': void openFile(path); break
    case 'open-window': await openInNewWindow(path); break
    case 'export-pdf': await exportPath(path, 'pdf'); break
    case 'export-docx': await exportPath(path, 'docx'); break
    case 'reveal': void window.api.reveal(target); break
    case 'open-dir': void window.api.openDir(target); break
    case 'new-file': await createEntry(target, 'file'); break
    case 'new-folder': await createEntry(target, 'dir'); break
    case 'rename': startTreeRename(path); break
    case 'delete': await doDelete(path); break
  }
}

function startTreeRename(path: string) {
  treeCtl.startRename(path)
}

/**
 * 文件树右键「在新窗口中打开」/「前往已打开的窗口」。
 * 主进程会拒绝为已在某个窗口里打开的文档再开一个：「focus」表示它只是把那个窗口
 * 抬到了前面，这里如实说一声；否则用户看到窗口「闪了一下什么都没发生」会以为坏了。
 */
async function openInNewWindow(path: string) {
  const result = await window.api.openInNewWindow(path)
  if (result === 'invalid') setStatus('无法打开该文件：文件不存在或不是 Markdown', true)
  else if (result === 'focus') setStatus(`「${basename(path)}」已在另一个窗口中打开，已切换到那个窗口`)
}

async function createEntry(parent: string, type: 'file' | 'dir') {
  try {
    const p = await window.api.create(parent, type === 'file' ? '未命名' : '新建文件夹', type)
    treeCtl.ensureExpanded(parent)
    if (type === 'dir') treeCtl.ensureExpanded(p)
    await refreshTree()
    // 新建后先进入重命名态（光标落在文件名上），文件在重命名提交后才打开
    pendingOpenPath = type === 'file' ? p : null
    treeCtl.startRename(p)
  } catch (e) {
    setStatus(e instanceof Error ? e.message : '新建失败', true)
  }
}

async function doRename(oldPath: string, newName: string) {
  let name = newName
  if (/\.(md|markdown|mdown|mkd)$/i.test(oldPath) && !/\.[a-z0-9]+$/i.test(name)) name += '.md'
  const error = await window.api.validateName(name)
  if (error) {
    if (pendingOpenPath === oldPath) pendingOpenPath = null
    await refreshTree()
    setStatus(error, true)
    return
  }
  const newPath = await window.api.rename(oldPath, name)
  await refreshTree()
  if (!newPath) {
    if (pendingOpenPath === oldPath) pendingOpenPath = null
    setStatus('已存在同名文件或文件夹', true)
    return
  }
  if (pendingOpenPath === oldPath) {
    pendingOpenPath = null
    void openFile(newPath)
  }
  if (state.openPath === oldPath) {
    state.openPath = newPath
    // 归属是认路径的：改名后要按新路径重新认领，否则这篇会变成「无人认领」，
    // 别的窗口就能再打开它（同一个文件、两个窗口，正是要避免的情况）
    const claim = await window.api.claimDocument(newPath)
    if (!claim.ok) setStatus(`「${basename(newPath)}」已在另一个窗口中打开`, true)
    treeCtl.select(newPath)
    updateBreadcrumb()
    document.title = `${basename(newPath)} — ${basename(displayRoot())}`
  }
}

async function doDelete(path: string) {
  await window.api.trash(path)
  if (state.openPath && (state.openPath === path || state.openPath.startsWith(path.replace(/\\/g, '/') + '/'))) {
    lastSaved = ''
    state.dirty = false
    showEditorEmpty()
  }
  await refreshTree()
}

// ---------- recents ----------

const RECENTS_KEY = 'jianmo.recents'
/** 最近打开只保留这么多条（读取时一并修剪历史遗留的超长列表） */
const RECENTS_MAX = 5

function loadRecents(): { path: string; name: string; time: number; kind?: 'dir' | 'file' }[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]')
    return Array.isArray(list) ? list.slice(0, RECENTS_MAX) : []
  } catch { return [] }
}
function addRecent(path: string, kind: 'dir' | 'file' = 'dir') {
  const list = loadRecents().filter((r) => r.path !== path)
  list.unshift({ path, name: basename(path), time: Date.now(), kind })
  localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, RECENTS_MAX)))
}
function renderRecents() {
  const list = loadRecents()
  els.recents.innerHTML = ''
  if (!list.length) return
  const label = document.createElement('div')
  label.className = 'recents-label'
  label.textContent = '最近打开'
  els.recents.append(label)
  // 标题留在滚动区外（见 style.css 注释），只有条目这一层滚动
  const listEl = document.createElement('div')
  listEl.className = 'recents-list'
  els.recents.append(listEl)
  for (const r of list) {
    const isFile = r.kind === 'file'
    const row = document.createElement('div')
    row.className = 'recent-row'
    const icon = document.createElement('span')
    icon.className = 'recent-icon'
    icon.innerHTML = isFile
      ? '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M2.5 1.8h6L12 5.3v8.2c0 .4-.3.7-.7.7H2.5c-.4 0-.7-.3-.7-.7V2.5c0-.4.3-.7.7-.7Z"/><path d="M8.5 1.8v3.5H12" stroke-linecap="round"/></svg>'
      : '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M1.8 4.2c0-.4.3-.7.7-.7h3.4l1.3 1.5h6.3c.4 0 .7.3.7.7v6.8c0 .4-.3.7-.7.7H2.5c-.4 0-.7-.3-.7-.7V4.2Z"/></svg>'
    const box = document.createElement('div')
    box.className = 'recent-text'
    const name = document.createElement('span')
    name.className = 'recent-name'
    name.textContent = r.name
    const pathEl = document.createElement('span')
    pathEl.className = 'recent-path'
    pathEl.textContent = r.path
    box.append(name, pathEl)
    const remove = document.createElement('button')
    remove.className = 'recent-remove'
    remove.title = '从列表移除'
    remove.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="m4.5 4.5 7 7m0-7-7 7"/></svg>'
    remove.addEventListener('click', (e) => {
      e.stopPropagation()
      localStorage.setItem(RECENTS_KEY, JSON.stringify(loadRecents().filter((x) => x.path !== r.path)))
      renderRecents()
    })
    row.addEventListener('click', () => void (r.kind === 'file' ? openSingleFile(r.path) : openWorkspace(r.path)))
    row.append(icon, box, remove)
    listEl.append(row)
  }
}

// ---------- link popover ----------

function openLinkPopover() {
  if (!state.openPath || editorMode === 'source') return
  els.linkInput.value = editorCtl.currentLink() || ''
  els.linkPopover.classList.remove('hidden')
  els.linkInput.focus()
  els.linkInput.select()
}

function closeLinkPopover() {
  els.linkPopover.classList.add('hidden')
  editorCtl.focus()
}

$('#link-apply').addEventListener('click', () => {
  const v = els.linkInput.value.trim()
  editorCtl.setLink(v || null)
  closeLinkPopover()
})
$('#link-remove').addEventListener('click', () => {
  editorCtl.setLink(null)
  closeLinkPopover()
})
$('#link-cancel').addEventListener('click', closeLinkPopover)
els.linkInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#link-apply').click()
  if (e.key === 'Escape') closeLinkPopover()
})

// ---------- sidebar / misc buttons ----------

function toggleSidebar() {
  // 独立窗口没有侧栏，切换无从谈起（顶栏按钮也已隐藏，只有菜单 / 快捷键会走到这）
  if (STANDALONE) return
  const show = document.body.classList.contains('no-sidebar')
  // 展开侧栏前先看右侧目录：窗口窄到两块只能留一块时把目录收掉（刚点的这块优先）
  if (show && tocOpen && panelsExclusive()) {
    setTocOpen(false)
    setStatus('窗口较窄，已收起目录')
  }
  document.body.classList.toggle('no-sidebar')
  // 侧栏重新露出来之后，按此刻的空间算一遍渲染宽度
  applySidebarWidth()
}
els.btnSidebar.addEventListener('click', toggleSidebar)

// ---------- sidebar resize（拖拽调宽） ----------
//
// 窗口不动，所以拖宽侧栏就是直接吃掉编辑区 —— 这是「编辑区保底宽度」这条规矩的另一面：
// 上限跟着窗口与目录的开合走（sidebarMaxWidth），拖到头就停住，不会把正文挤没。
// 侧栏左缘贴着窗口左缘，所以鼠标的 clientX 就是它应有的宽度（再按上下限夹一下）。

let resizing = false

// 首帧就把侧栏宽度定下来（偏好宽度 ∩ 当时的上限）。放在这儿是因为
// sidebarMaxWidth 要读 tocOpen，那个变量在文件稍后才声明。
applySidebarWidth()

$('#sidebar-resize').addEventListener('mousedown', (e) => {
  e.preventDefault()
  resizing = true
  document.body.classList.add('resizing')
})
document.addEventListener('mousemove', (e) => {
  if (!resizing) return
  sidebarPref = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, e.clientX))
  applySidebarWidth()
})
document.addEventListener('mouseup', () => {
  if (!resizing) return
  resizing = false
  document.body.classList.remove('resizing')
  // 记的是**偏好宽度**，不是这一帧渲染出来的宽度 —— 被空间夹窄时别把妥协值当成用户的选择
  localStorage.setItem(SIDEBAR_W_KEY, String(sidebarPref))
})
els.btnOpenFolder.addEventListener('click', chooseAndOpen)
els.btnOpenFile.addEventListener('click', chooseAndOpenFile)
$('#btn-add-file').addEventListener('click', () => { if (state.root) void createEntry(state.root, 'file') })
$('#btn-add-folder').addEventListener('click', () => { if (state.root) void createEntry(state.root, 'dir') })
els.editorEmpty.querySelector('#btn-new-file')!.addEventListener('click', () => {
  if (state.root) void createEntry(state.root, 'file')
})

async function chooseAndOpen() {
  const p = await window.api.chooseFolder()
  if (p) void openWorkspace(p)
}

async function chooseAndOpenFile() {
  const p = await window.api.chooseFile()
  if (p) void openSingleFile(p)
}

// ---------- export pdf ----------

/**
 * 「导出为 PDF…」菜单项的可用性：只要打开了文档就可以，与编辑模式无关。
 * 导出不再读编辑器的 DOM —— 一律把 Markdown 交给编辑器同一套扩展离线渲染，
 * 所以纯文本模式下同样可用（取的就是那个 textarea 里的文本）。
 */
function syncExportAvailability() {
  void window.api.setExportEnabled(!!state.openPath)
}

/** 导出格式。两条路共用前面「取文本 → 离线渲染」那一半，只有出口不同。 */
type ExportFormat = 'pdf' | 'docx'

/** 把一份 HTML 交给主进程打印成 PDF —— 导出 PDF 的唯一出口 */
async function renderPdf(html: string, name: string) {
  try {
    // 样式在隐藏窗口里原样重放，正文配色固定走浅色主题（深色底印在纸上费墨且难读）
    const saved = await window.api.exportPdf({
      html,
      css: `${editorCss}\n${printCss}`,
      name,
    })
    if (saved) setStatus(`已导出 ${basename(saved)}`)
  } catch (e) {
    setStatus('导出失败：' + (e as Error).message, true)
  }
}

/**
 * 把文档模型交给主进程组装成 .docx —— 导出 Word 的唯一出口。
 *
 * 与 PDF 最大的不同：Word 不吃 CSS，那边「重放 style.css」的招数用不上。
 * 样式是在主进程里**照 style.css 抄一份** Word 的排版元素（见 docx-export.cjs），
 * 所以 docx 是「结构正确、可在 Word 里继续编辑」，观感接近但不保证与编辑器一致。
 */
async function renderDocx(doc: JSONContent, baseDir: string, name: string) {
  try {
    const result = await window.api.exportDocx({ doc, baseDir, name })
    if (!result) return
    // 读不到或格式不支持的图片（webp/avif 之类）会被跳过，如实说而不是假装成功
    setStatus(result.skipped
      ? `已导出 ${basename(result.path)}（${result.skipped} 张图片未能嵌入）`
      : `已导出 ${basename(result.path)}`)
  } catch (e) {
    setStatus('导出失败：' + (e as Error).message, true)
  }
}

/**
 * 导出任意一个 .md —— 菜单项 / 快捷键 / 文件树右键都走这里。
 *
 * 无论导出的是不是当前文档，路径都相同：拿到 Markdown 文本 → 离线渲染
 * （editor.ts 的 markdownToHtml / markdownToDoc，与编辑器同一批扩展）→ 交给主进程出文件。
 * 因此
 *   - 不依赖编辑模式：纯文本模式下取 textarea 里的文本，同样能导出；
 *   - 不切换文档：当前文档的滚动位置、选区和撤销栈都原样保留；
 *   - 不写盘：磁盘上的 .md 保持原样，未保存的编辑也如实导出。
 */
async function exportPath(path: string, format: ExportFormat) {
  let md: string
  if (path === state.openPath) {
    // 当前文档直接取编辑器里的文本，未落盘的改动一并导出
    md = currentDocumentText()
  } else {
    try {
      md = await window.api.read(path)
    } catch {
      setStatus('无法读取该文件', true)
      return
    }
  }
  // 离线的图片路径要按**目标文档自己的目录**解析，所以这里传 dirname(path)
  const dir = dirname(path)
  const name = basename(path).replace(MD_RE, '')
  if (format === 'docx') await renderDocx(markdownToDoc(md, dir), dir, name)
  else await renderPdf(markdownToHtml(md, dir), name)
}

/** 导出当前打开的文档（菜单项 / 快捷键） */
async function exportCurrent(format: ExportFormat) {
  if (!state.openPath) {
    setStatus('请先打开一个文档', true)
    return
  }
  await exportPath(state.openPath, format)
}

// ---------- menu events ----------

window.api.onMenu(async (action) => {
  switch (action) {
    case 'open-folder': await chooseAndOpen(); break
    case 'new-file': if (state.root) await createEntry(state.root, 'file'); break
    case 'save': await doSave(); break
    // 独立窗口没有工作空间可关；它也没有欢迎页可回（见 style.css 的 body.standalone）
    case 'close-workspace': if (!STANDALONE) await closeWorkspace(); break
    case 'undo':
      if (editorMode === 'source') { els.sourceEditor.focus(); document.execCommand('undo') }
      else editorCtl.undo()
      break
    case 'redo':
      if (editorMode === 'source') { els.sourceEditor.focus(); document.execCommand('redo') }
      else editorCtl.redo()
      break
    case 'link': openLinkPopover(); break
    case 'export-pdf': await exportCurrent('pdf'); break
    case 'export-docx': await exportCurrent('docx'); break
    case 'toggle-sidebar': toggleSidebar(); break
  }
})

// ---------- fs watch ----------

let fsTimer: number | undefined
window.api.onFsChanged(() => {
  clearTimeout(fsTimer)
  fsTimer = window.setTimeout(async () => {
    if (!state.root) return
    await refreshTree()
    if (state.openPath && !state.dirty) {
      try {
        const md = await window.api.read(state.openPath)
        if (md !== lastSaved) {
          editorCtl.open(md, dirname(state.openPath))
          els.sourceEditor.value = md
          lastSaved = md
          updateCount()
          void localizeRemoteImages(editorCtl.remoteImageSources())
        }
      } catch { /* 文件可能刚被删除 */ }
    }
  }, 300)
})

// ---------- open-file (argv / 右键打开 / 二次启动) ----------

window.api.onOpenFile((p) => {
  if (p) void openSingleFile(p)
})

// ---------- drag & drop（拖入 Markdown 文件直接打开） ----------

// 窗口层兜底 preventDefault：否则从资源管理器拖入文件会触发浏览器默认行为（整页导航）
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => {
  e.preventDefault()
  const files = Array.from(e.dataTransfer?.files || [])
  if (!files.length) return
  // 多选拖入时以第一个 Markdown 为准
  const target = files
    .map((f) => window.api.pathForFile(f) || '')
    .find((p) => MD_RE.test(p))
  if (target) {
    void openSingleFile(target)
    return
  }
  // 图片由编辑区的 handleDrop 处理；其余类型明确告知不支持
  if (files.some((f) => !f.type.startsWith('image/'))) {
    setStatus('只能拖入 Markdown 文件（.md）打开', true)
  }
})

// ---------- boot ----------

renderRecents()
// 先同步一次导出可用性：菜单项是应用级的，谁聚焦就显示谁的状态，
// 空窗口也要明确登记一次，否则会残留上一个聚焦窗口的判定
syncExportAvailability()
const initial = await window.api.initialFile()
if (initial) void openSingleFile(initial)
