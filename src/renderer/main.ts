import './style.css'
// 导出 PDF 时把样式以字符串形式交给主进程，在隐藏窗口里原样复现编辑器的排版。
// 与上面的副作用导入指向同一个文件、只是查询串不同，两者互不冲突。
import { createEditor, type EditorCtl } from './editor'
import { createTree } from './tree'
import { showContextMenu } from './contextmenu'
import { openImageViewer } from './imageviewer'
import { findRangesInText, nextMatchIndex } from './find'
import { basename, dirname, encodeMarkdownPath, imageFileName, relativeFrom, resolveRel, samePath, type ImageStorageMode, type ImageStorageSettings, type PopupItem } from './util'

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!

const MD_RE = /\.(md|markdown|mdown|mkd)$/i

const els = {
  welcome: $('#view-welcome'),
  btnOpenFolder: $('#btn-open-folder'),
  btnOpenFile: $('#btn-open-file'),
  recents: $('#recents'),
  workspace: $('#view-workspace'),
  topbar: $('#topbar'),
  btnSidebar: $('#btn-sidebar'),
  btnOpenFolderWs: $('#btn-open-folder-ws'),
  btnOpenFileWs: $('#btn-open-file-ws'),
  outline: $('#outline'),
  tabFiles: $('#tab-files') as HTMLButtonElement,
  tabOutline: $('#tab-outline') as HTMLButtonElement,
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
 * 实测经典滚动条的宽度（Windows 10px、macOS overlay 0px）。
 *
 * ⚠️ 它**不再**写进 CSS（`--sb-w` 随「扣滚动条凑视觉对称」那套算法一起删了 ——
 * 正文左右现在都是完整的 `--content-pad`，滚动条槽在 padding 之外，两侧天然对称）。
 * 现在只剩一个用途：`sidebarMaxWidth()` 给侧栏宽度算上限时要扣掉它，
 * 口径是「正文真正能用到的宽度」—— 不扣的话屏幕上会莫名其妙少 10px。
 *
 * ⚠️ 必须同步执行（模块求值时立刻跑）：晚一步会先按 0 算一遍侧栏上限。
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
  scrollbarWidth = width
}
syncScrollbarWidth()

const state = {
  root: null as string | null,
  openPath: null as string | null,
  dirty: false,
}
type EditorMode = 'visual' | 'source'
let editorMode: EditorMode = 'visual'
let lastSaved = ''
let saveTimer: number | undefined

// ---------- editor ----------

/**
 * 文档被改动（用户敲字，或查找替换这类程序化编辑）。
 * 不依赖 Tiptap 的 onUpdate 是否触发 —— 程序化事务那条路不可靠，
 * 统一在这里置脏 + 排自动保存，避免「改了但没存、切换模式后被回读覆盖」。
 */
function onDocumentEdited() {
  state.dirty = true
  setStatus('编辑中…')
  updateBreadcrumb()
  updateCount()
  scheduleOutline()
  scheduleSave()
}

const editorCtl: EditorCtl = createEditor(els.editor, {
  onChange() {
    onDocumentEdited()
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

/**
 * openPath 是否就是 target、或位于 target 里面。
 * ⚠️ 两边都要把斜杠归一成 /：doDelete 早先只替换了 target 一侧，Windows 上
 * `C:\ws\docs\a.md`.startsWith('C:/ws/docs/') 永远为 false —— 祖先分支形同虚设，
 * 只有精确匹配那一半在干活（删父目录时编辑器不退回空状态）。
 */
function isPathOrInside(openPath: string, target: string): boolean {
  const a = openPath.replace(/\\/g, '/')
  const b = target.replace(/\\/g, '/')
  return a === b || a.startsWith(b + '/')
}

// ---------- tree ----------

const treeCtl = createTree(els.tree, {
  // 用户在树上点了某一篇 —— 这一次要跟着高亮那一行
  onOpenFile(p) { selectInTree = true; return openFile(p) },
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
function flashWelcomeToast(text: string, isError = false, duration = 2600) {
  if (els.welcome.classList.contains('hidden')) return
  els.welcomeToast.textContent = text
  els.welcomeToast.classList.toggle('error', isError)
  els.welcomeToast.classList.remove('hidden')
  clearTimeout(welcomeToastTimer)
  welcomeToastTimer = window.setTimeout(() => els.welcomeToast.classList.add('hidden'), duration)
}

function setStatus(text: string, isError = false, duration = 2400) {
  // 保存状态（已保存 / 编辑中…）常驻在中段；其余为临时提示，2.4s 后回落到保存状态。
  // ⚠️ 状态栏（#statusbar）现在常驻整窗一条，不再有「整条栏随提示显隐」的机制
  //    —— 早期版本会hidden 掉 #status-pill，那时这里要 remove('hidden')。
  if (text === '已保存' || text === '编辑中…' || text.startsWith('已保存')) {
    persistentStatus = text
    clearTimeout(statusTimer)
    els.status.textContent = text
    els.status.classList.remove('error')
    return
  }
  flashWelcomeToast(text, isError, duration)
  els.status.textContent = text
  els.status.classList.toggle('error', isError)
  clearTimeout(statusTimer)
  statusTimer = window.setTimeout(() => {
    els.status.textContent = persistentStatus
    els.status.classList.toggle('error', false)
  }, duration)
}

// ---------- save ----------

/** 保存前发现过「磁盘上的文件被别的程序改过」（A4）：保存时如实交代一句 */
let externalChange = false
/**
 * 上一次保存 / 打开时记下的磁盘 mtime。fs:changed 里拿它和磁盘比对，把「自己刚写的」
 * 与「别人改的」区分开。取不到 mtime 时置 Infinity：宁可漏报，也别把自己刚保存的
 * 内容误报成别人的修改（fs:write 成功后 stat 失败是唯一入口）。
 */
let lastSavedMtime = 0
function noteDiskState(st: { mtimeMs: number } | null) {
  lastSavedMtime = st ? st.mtimeMs : Number.POSITIVE_INFINITY
}

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
    // 保存后记下新的 mtime：自己刚写的这次不会触发「外部修改」误报
    noteDiskState(await window.api.stat(state.openPath))
    setStatus(externalChange ? '已保存（覆盖了磁盘上的外部修改）' : '已保存')
    externalChange = false
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
 *
 * ⚠️ openSeq：函数里有三个 await（flushSave / claimDocument / read）。快速连点两个文件时，
 * 先发起的调用可能在「认领了 A、还没读」时被后一次超越 —— 不拦的话归属表记着 A（其实没开
 * A），B 打开着却无人认领，别的窗口就能再开 B，正是归属表要防的那件事（A5）。每个 await
 * 之后核对序号，号变了就中止，并把认领目标交还给最新那一篇（claimDocument 在主进程里是
 * 「先释放再登记」的原子操作，不存在半路松手的瞬间）。
 */
let openSeq = 0
/**
 * 这一次打开要不要在文件树上高亮那一行。只有**从文件树点进来**才是 true；
 * 「打开文件…」、拖拽、双击、命令行这些「用户没在树上指路」的入口是 false
 * —— 树可能整个闭合着（打开动作不替他展开），凭空高亮会让人以为已经展开了。
 * 一次性标志：openFile 里用掉即清。
 */
let selectInTree = false
let openTarget = ''
async function openFile(path: string): Promise<boolean> {
  if (path === state.openPath) return true
  const seq = ++openSeq
  openTarget = path
  await flushSave()
  if (seq !== openSeq) return false
  // 先认领编辑权：被别的窗口占着就原地不动（主进程会把那个窗口抬到前面）。
  // 两处各自 0.6s 自动保存同一篇，必然后写覆盖先写，而且界面上完全看不出来。
  const claim = await window.api.claimDocument(path)
  if (seq !== openSeq) {
    // 被后一次请求超越：把认领交还给最新目标。同一篇的重复请求会再次认领到自己，
    // 那时不能还，否则那篇会变成无人认领
    if (openTarget !== path) void window.api.claimDocument(openTarget)
    return false
  }
  if (!claim.ok) {
    setStatus(`「${basename(path)}」已在另一个窗口中打开`, true)
    return false
  }
  try {
    const md = await window.api.read(path)
    if (seq !== openSeq) {
      if (openTarget !== path) void window.api.claimDocument(openTarget)
      return false
    }
    editorCtl.open(md, dirname(path))
    els.sourceEditor.value = md
    // 文本模式只作用于当前查看；切换到任意文档时恢复所见即所得。
    editorMode = 'visual'
    state.openPath = path
    lastSaved = md
    state.dirty = false
    externalChange = false
    // 从文件树点开 → 高亮那一行（这是「树跟着正文走」，一直如此）。
    // 但**用「打开文件…」/ 拖拽 / 双击进来的**不要高亮：用户没在树上指路，
    // 而树此时可能整个是闭合的（打开动作不替他展开，见 openSingleFile），
    // 凭空多一个高亮反而让人以为树已经展开了。
    if (selectInTree) treeCtl.select(path)
    selectInTree = false
    showEditor()
    updateBreadcrumb()
    updateCount()
    els.editorWrap.scrollTop = 0
    els.sourceEditor.scrollTop = 0
    // 记下打开时的磁盘 mtime：之后 fs:changed 拿它和磁盘比对，区分「自己刚写的」
    // 与「别人改的」（A4）
    void window.api.stat(path).then((st) => {
      if (st && state.openPath === path) lastSavedMtime = st.mtimeMs
    })
    void localizeRemoteImages(editorCtl.remoteImageSources())
    // 单文件模式 / 独立窗口没有工作空间 watcher：让主进程转而监听这一篇所在的目录，
    // 外部修改检测（A4）于是在所有窗口形态下都能工作（D4）。切换文档时会自动换目标。
    if (!state.root) void window.api.watchFile(path)
    return true
  } catch (e) {
    // 读失败且已被更新的请求超越时**不要动归属**（D1）：新请求自己会管它的认领，
    // 这里若照旧把归属「还给」屏幕上的旧文档，会把新请求刚认领的目标释放掉 ——
    // 新文档变成无人认领，另一个窗口就能再开它，两个窗口各自 0.6s 自动保存
    // 互相覆盖，正是归属表要防的那件事
    if (seq !== openSeq) return false
    // 没读进来就把归属还给上一篇：上面的认领已经把它让出去了，
    // 不还回来现在屏幕上这一篇就成了「无人认领」，别的窗口能再打开它
    if (state.openPath) void window.api.claimDocument(state.openPath)
    setStatus('无法打开文件', true)
    return false
  }
}

/**
 * 打开一个工作空间。
 *
 * ⚠️ **同一个文件夹不重复打开**：早先这里无条件往下走，于是「再打开一次当前这个文件夹」
 * 会重新 setRoot + 重拉文件树 + `showEditorEmpty()` —— **正在编辑的那一篇被清空**、
 * 树里的展开状态与滚动位置一起归零。选同一个文件夹时用户没有切换意图，
 * 原地不动才是对的。要切换请直接点文件树里的另一篇。
 *
 * 判据用 `samePath` 而不是字符串相等：Windows 上同一个目录经不同途径拿到的大小写 /
 * 分隔符可能不一样（`C:\a` 与 `c:/a`），直接比较会判成两个文件夹。
 */
async function openWorkspace(root: string, selectFile?: string) {
  if (samePath(root, state.root)) {
    // 已经在开着这个文件夹了。若这一轮还指定了文件（右键菜单「在文件夹中打开」等
    // 入口可能这么调），那就只切那一篇；否则原地不动，什么都不改。
    if (selectFile) {
      if (!await openFile(selectFile)) showEditorEmpty()
    }
    return
  }
  await flushSave()
  await window.api.setRoot(root)
  state.root = root
  treeCtl.setData(await window.api.tree(root))
  document.body.classList.remove('file-mode')
  treeCtl.setData(await window.api.tree(root))
  setSidePane(sidePane === 'outline' ? 'outline' : 'files')
  els.wsPath.textContent = root
  els.wsPath.title = root
  els.welcome.classList.add('hidden')
  els.workspace.classList.remove('hidden')
  void window.api.resizeWindow('workspace')
  addRecent(root)
  // 打开不了（比如那一篇正在别的窗口里）就退回空文档，而不是继续显示上一个工作空间的文档
  if (selectFile) { if (!await openFile(selectFile)) showEditorEmpty() }
  else showEditorEmpty()
}

/**
 * 打开单个文件（打开文件 / 拖拽 / 双击 md / 右键打开 / 命令行）。
 *
 * **没有「单文件模式」了**（2026-10-14）：打开一个文件就等于**把它的父目录当成工作空间**。
 * 于是每个窗口都是「左栏文件树 + 正文」两栏，不再有第三种形态要维护。
 *
 * ⚠️ 文件树保持**默认闭合、不选中那一篇**（用户明确要的）：正文已经换成这一篇了，
 * 树里不额外替他展开一条路径 —— 「默认闭合」这条规矩在任何入口都不破例。
 * 展开状态与选中是用户自己在树上的操作，不该被打开动作替他做。
 */
async function openSingleFile(path: string) {
  // 正在开着这一篇：无操作（不重开、不切形态）
  if (samePath(path, state.openPath)) return
  // 先登记成主进程可读写的文件：父目录还没成为工作空间时，fs:read 会被权限拦下
  if (!await window.api.allowFile(path)) {
    setStatus('无法打开该文件：文件不存在或不是 Markdown', true)
    return
  }
  addRecent(path, 'file')
  // 以父目录为工作空间。若那已经是当前工作空间，openWorkspace 内部会短路成
  // 「只切这一篇」，既不重拉树也不动展开状态。
  await openWorkspace(dirname(path), path)
}

async function closeWorkspace() {
  await flushSave()
  // 回欢迎页：把侧栏恢复成「文件」页（欢迎页没有工作空间，大纲那页没内容可看）
  setSidePane('files')
  state.root = null
  state.openPath = null
  void window.api.releaseDocument()
  state.dirty = false
  lastSaved = ''
  treeCtl.clear()
  els.workspace.classList.add('hidden')
  els.welcome.classList.remove('hidden')
  void window.api.resizeWindow('welcome')
  // 面包屑与标题一起清掉（updateBreadcrumb 顺带驱动 updateTitle）
  updateBreadcrumb()
  renderRecents()
}

function showEditor() {
  els.editorEmpty.classList.add('hidden')
  els.editorWrap.classList.toggle('hidden', editorMode !== 'visual')
  els.sourceWrap.classList.toggle('hidden', editorMode !== 'source')
  updateEditorModeButton()
  // refreshToc 内部会先过一遍 syncOutlineTab（大纲标签的可用性跟着大纲走）
  refreshToc()
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
  refreshToc()
  // 面包屑与标题一并清空（updateBreadcrumb 顺带驱动 updateTitle）
  updateBreadcrumb()
}

// 单文件模式下没有挂工作空间（state.root 为 null），但文件所在目录是已知的。
// 目录名一类的展示要与目录模式保持一致，区别只是不能对工作目录做新建/删除/重命名。
function displayRoot(): string {
  return state.root || (state.openPath ? dirname(state.openPath) : '')
}

/**
 * 窗口标题（C12）：`*文件名 — 文件夹`，* 表示有未保存修改。
 * 虽然 0.6s 就自动保存了，但 Alt-Tab / 任务栏里一眼能看出当前文档还没落盘。
 * 所有 document.title 赋值都收在这里，由 updateBreadcrumb 统一驱动 ——
 * 它是唯一跟着「当前文档 + 脏状态」一起跑的地方（每次 onChange 都会调）。
 */
function updateTitle() {
  const file = state.openPath ? basename(state.openPath) : ''
  const root = displayRoot() ? basename(displayRoot()) : ''
  const dirty = state.dirty ? '*' : ''
  document.title = file ? `${dirty}${file} — ${root}` : (root || 'tinymd')
}

function updateBreadcrumb() {
  updateTitle()
  const root = displayRoot() ? basename(displayRoot()) : ''
  const file = state.openPath ? basename(state.openPath) : ''
  els.breadcrumb.innerHTML = ''
  if (root) {
    const f = document.createElement('span')
    f.className = 'crumb-folder'
    f.textContent = root
    // 文件夹部分可点：在文件树里定位当前文档（C8）。
    // 单文件模式 / 独立窗口没有树，点了没意义，不给交互。
    if (state.root && state.openPath) {
      f.classList.add('clickable')
      f.title = '在文件树中定位'
      f.addEventListener('click', () => {
        // 侧栏被用户收着时先展开，不然定位了也看不见
        if (document.body.classList.contains('no-sidebar')) toggleSidebar()
        treeCtl.reveal(state.openPath!)
      })
    }
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
    // ⚠️ 一律以**实时文档**为准，不看 state.dirty / lastSaved：
    // 程序化编辑（查找替换）不保证把 dirty 置位，而 lastSaved 是「上次成功写入磁盘的内容」——
    // 拿它当切换依据，会在自动保存还没落盘时把刚做的替换整体覆盖回旧文本（丢数据）。
    els.sourceEditor.value = editorCtl.getMarkdown()
    state.dirty = els.sourceEditor.value !== lastSaved
    closeFind() // 换了一套编辑区，查找结果（文档坐标）已经对不上号了
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
/** 文档改动后延迟刷新。不在大纲页就不必重渲染 —— 切过去时会渲染一次 */
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

/** 换了文档 / 改了内容后同步目录内容（不在大纲页就不必重渲染） */
function refreshToc() {
  // 标题可能刚被删光 / 新加上：大纲标签的可用性跟着大纲走
  syncOutlineTab()
  if (sidePane === 'outline') renderToc()
}

// ---------- 侧栏：文件树 / 大纲两页互斥 ----------
//
// 大纲原先是编辑区右侧一块浮层面板（#toc-float），与左侧栏各占一边、正文被夹在中间。
// 现在它搬进侧栏，和文件树**同栏同页互斥**：整屏只剩「左栏 + 正文」两栏。
//
// ⭐ 状态必须用**单一枚举**而不是再加一个布尔。早先的 tocOpen / no-sidebar 是两个
// 独立开关，能组合出「文件树开着 + 大纲也开着」这种非法态；现在只有一个
// sidePane，'files' 与 'outline' 天然互斥，不存在同时为真的可能。
//
// 面板不再与正文抢空间 → 窗口尺寸完全不参与面板开合：
//   TOC_PAD / PANELS_EXCLUSIVE_W / panelsExclusive() / EDITOR_MIN 全部随之删掉，
//   「窗口窄到两块只能留一块」那套判据也没有了 —— 因为压根没有第二块面板。
// 侧栏宽度与目录开合彻底解耦，applySidebarWidth 只在换文档 / 改窗口 / 拖拽时跑。

type SidePane = 'files' | 'outline'

const SIDE_PANE_KEY = 'jianmo.sidebarPane'
// 用户上次选的那页，跨会话记住（默认「文件」）
let sidePane: SidePane = localStorage.getItem(SIDE_PANE_KEY) === 'outline' ? 'outline' : 'files'

/** 侧栏有没有被收起来（no-sidebar 与形态无关，收起时正文拿到完整宽度） */
function paneVisible(): boolean {
  return !document.body.classList.contains('no-sidebar')
}

const SIDEBAR_W = 264   // 与 style.css 里 `#sidebar { width: 264px }` 一致
const SIDEBAR_MIN = 180 // 侧栏拖拽下限（与 style.css / 拖拽处一致）
const SIDEBAR_MAX = 520 // 侧栏拖拽上限
const SIDEBAR_W_KEY = 'jianmo.sidebarWidth'  // 拖过的宽度记在这儿

/**
 * 编辑区保底宽度 —— 如今只用来给**侧栏宽度**定上限（拖宽时挡住、空间不够时夹窄）。
 * 口径是「正文**真正能用到的**宽度」，算账时要一起扣掉滚动条（见 sidebarMaxWidth）。
 * ⚠️ 早先它还兼着「两块面板能不能同时开」的判据（PANELS_EXCLUSIVE_W），那个职责
 * 随着目录并进侧栏一起没了 —— 现在侧栏宽度与目录开合彻底解耦。
 */
const EDITOR_MIN = 480

/** 用户拖出来的偏好宽度：拖拽时更新并持久化。它只是「想要多宽」，
    实际渲染出来的宽度还得过一遍 sidebarMaxWidth（空间不够就先让）—— 见 applySidebarWidth */
let sidebarPref = SIDEBAR_W
const savedSidebarW = Number(localStorage.getItem(SIDEBAR_W_KEY))
if (savedSidebarW >= SIDEBAR_MIN && savedSidebarW <= SIDEBAR_MAX) sidebarPref = savedSidebarW

/** 侧栏宽度的上限：不能让正文被挤到 EDITOR_MIN 以下（拖拽与空间变化两处共用） */
function sidebarMaxWidth(): number {
  // 口径是「正文**真正能用到的**宽度」，所以算账时要一起扣掉滚动条
  // （Windows 10px、macOS 0）—— 不扣的话屏幕上会莫名其妙少 10px。
  const limit = window.innerWidth - scrollbarWidth - EDITOR_MIN
  return Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, limit))
}

/**
 * 侧栏宽度的**唯一出口**：渲染宽度 = 偏好宽度 ∩ 此刻的上限。
 * ⚠️ 夹窄**不写 localStorage** —— 那是空间不够时的临时妥协，不是用户的选择。
 */
function applySidebarWidth(): void {
  els.sidebar.style.width = `${Math.max(SIDEBAR_MIN, Math.min(sidebarPref, sidebarMaxWidth()))}px`
}

// 用户把窗口拖窄时重新核对一遍：侧栏自己太宽就按新的空间夹一下
// （空间回来时自动还原，偏好值一直存在 sidebarPref 里）
window.addEventListener('resize', () => {
  if (els.workspace.classList.contains('hidden')) return
  applySidebarWidth()
})

// ---------- 侧栏的两页：大纲的数据层与渲染 ----------

function renderToc() {
  els.outline.replaceChildren(outlineRows(outlineItems(), (pos) => editorCtl.revealPos(pos)))
  syncTocHighlight()
}

/**
 * 正文滚动时高亮当前所在标题（C9）：取编辑区上沿之下最后一个标题。
 * 大纲条目与 DOM 标题按文档顺序一一对应（getOutline 就是顺序 walk 出来的）。
 */
function syncTocHighlight() {
  if (sidePane !== 'outline') return
  const headings = [...editorCtl.el.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')]
  if (!headings.length) return
  // 64px：标题滚到编辑区上部这么一段算「当前章节」，与 revealPos 的呼吸空间同一量级
  const line = els.editorWrap.getBoundingClientRect().top + 64
  let active = 0
  headings.forEach((h, i) => { if (h.getBoundingClientRect().top <= line) active = i })
  // 滚到底时最后一段可能整段都在「线」以下（文档尾巴没多少内容）：此时高亮最后一个标题，
  // 否则用户拖到最底下，大纲还指着倒数第二段
  const wrap = els.editorWrap
  const last = headings[headings.length - 1]
  if (last.getBoundingClientRect().top > line && wrap.scrollHeight - (wrap.scrollTop + wrap.clientHeight) <= 2) {
    active = headings.length - 1
  }
  els.outline.querySelectorAll<HTMLElement>('.outline-item').forEach((el, i) => {
    el.classList.toggle('active', i === active)
  })
}

let tocSpyRaf = 0
els.editorWrap.addEventListener('scroll', () => {
  if (tocSpyRaf) return
  tocSpyRaf = requestAnimationFrame(() => { tocSpyRaf = 0; syncTocHighlight() })
})

/** 切到某一页。互斥由这个函数独占维护 —— 别在别处直接改 body.side-outline */
function setSidePane(pane: SidePane) {
  sidePane = pane
  localStorage.setItem(SIDE_PANE_KEY, pane)
  document.body.classList.toggle('side-outline', pane === 'outline')
  els.tabFiles.classList.toggle('active', pane === 'files')
  els.tabOutline.classList.toggle('active', pane === 'outline')
  els.tabFiles.setAttribute('aria-selected', String(pane === 'files'))
  els.tabOutline.setAttribute('aria-selected', String(pane === 'outline'))
  if (pane === 'outline') renderToc()
  // 形态可能变了（单文件 ↔ 目录），宽度上限跟着变
  applySidebarWidth()
}

/** 大纲标签的可用性：没有打开文档 / 纯文本模式 / 这篇没标题时置灰，并把原因写进 title。
    没有标题时**不切走**（正在看大纲页就让它留在那儿，只是空），
    但从文件页切过来时要拦住并给一句提示 —— 空面板弹出来只会让人以为点坏了（B4） */
function syncOutlineTab() {
  const hasOutline = outlineItems().length > 0
  const usable = !!state.openPath && editorMode === 'visual' && hasOutline
  els.tabOutline.disabled = !usable
  els.tabOutline.title = !usable
    ? (editorMode === 'source' ? '纯文本模式下没有大纲' : '这篇文档还没有标题')
    : '文档大纲 (Ctrl/Cmd + Shift + O)'
  // 正在看大纲页、却变得没内容了（大标题被删光 / 切纯文本模式）→ 退回文件页
  if (sidePane === 'outline' && !usable) setSidePane('files')
}

function toggleOutline() {
  if (sidePane !== 'outline') {
    // 从文件页切过来：先看有没有得看
    if (!outlineItems().length) {
      setStatus(editorMode === 'source' ? '纯文本模式下没有大纲' : '这篇文档还没有标题')
      return
    }
  }
  setSidePane(sidePane === 'outline' ? 'files' : 'outline')
}

els.tabFiles.addEventListener('click', () => setSidePane('files'))
els.tabOutline.addEventListener('click', toggleOutline)
els.btnOpenFolderWs.addEventListener('click', chooseAndOpen)
// 顶栏的「打开文件」与欢迎页那个同名按钮走同一条路：选中后切到单文件模式
// （侧栏只剩大纲那一页），从哪儿进来形态完全一致。
els.btnOpenFileWs.addEventListener('click', chooseAndOpenFile)

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    // 设置面板开着时只关设置：它在最上层，而这里和设置那个监听都挂在 document 上、
    // 先注册的先跑 —— 不主动让位的话一次 Esc 会把两个浮层一起收掉（B5）
    if (!els.settingsBackdrop.classList.contains('hidden')) return
    // 链接浮层开着时只关浮层（E6，让位法同上）：浮层输入框自己的 Esc 监听
    // 和这个 document 监听会一起触发，不让位的话一次 Esc 把两个浮层一起收掉
    if (!els.linkPopover.classList.contains('hidden')) return
    // 查找条同上：它在最上层，一次 Esc 只收它（它自己的监听也会 stopPropagation，
    // 这里双保险 —— 焦点不在查找框里时（比如刚点过正文）也能只收查找条）
    if (!findBar.classList.contains('hidden')) { closeFind(); return }
    // ⚠️ 这里**不再**管大纲：它已经是侧栏的一页，不是浮层 —— Esc 不该把它收走，
    // 想切回文件页点标签或按 Ctrl/Cmd + Shift + O。
    return
  }
  const mod = window.api.platform === 'darwin' ? event.metaKey : event.ctrlKey
  if (mod && event.shiftKey && (event.key === 'o' || event.key === 'O')) {
    event.preventDefault()
    toggleOutline()
  }
  // 查找 / 替换。⌘/Ctrl + F 与 + H 在 Electron 里没有默认行为（没有菜单项占用），
  // 但仍要 preventDefault —— Windows 上 Ctrl+F 会触发窗口的查找条（如 devtools 未开时不影响），
  // Ctrl+H 在部分系统上是「历史记录」
  if (mod && !event.shiftKey && (event.key === 'f' || event.key === 'F')) {
    event.preventDefault()
    openFind(false)
    return
  }
  if (mod && !event.shiftKey && (event.key === 'h' || event.key === 'H')) {
    event.preventDefault()
    openFind(true)
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
  // ⚠️ 别再要求 state.root：独立窗口和单文件模式下它都是 null（openSingleFile 显式置空，
  // 独立窗口从来不设置 root），而主进程侧本来就支持（assertInside 对 allowedFiles 里的
  // 文档放行，allowFile 还会把文档所在目录加进 allowedRoots，app-file:// 也能显示）——
  // 多了这个条件，那两种形态下粘贴 / 拖入 / 插入图片会静默失败，不报错也没提示（B1）
  if (!state.openPath) return
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
      setStatus('图片保存失败：' + ((e as Error).message || String(e)), true)
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
    items.push({ id: 'open', label: '打开' }, { id: 'rename', label: '重命名' },
      { id: 'reveal', label: '在文件管理器中显示' }, '-')
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
  try {
    let name = newName
    if (/\.(md|markdown|mdown|mkd)$/i.test(oldPath) && !/\.[a-z0-9]+$/i.test(name)) name += '.md'
    const error = await window.api.validateName(name)
    if (error) {
      if (pendingOpenPath === oldPath) pendingOpenPath = null
      await refreshTree()
      setStatus(error, true)
      return
    }
    // Markdown 文件必须保留 Markdown 扩展名：改成 .txt 之类它会从树里消失（MD_RE 过滤），
    // 而文档还开着、还能保存，两边对不上（C13）
    if (/\.(md|markdown|mdown|mkd)$/i.test(oldPath) && !/\.(md|markdown|mdown|mkd)$/i.test(name)) {
      if (pendingOpenPath === oldPath) pendingOpenPath = null
      await refreshTree()
      setStatus('Markdown 文件需要保留 .md 扩展名', true)
      return
    }
    // 这一篇（或它目录下的某一篇）正在别的窗口里开着时不能改：那个窗口的 state.openPath
    // 还是旧路径，0.6s 后自动保存把新内容写回旧路径 —— 改名会让同一篇文档的两份编辑
    // 分裂成两个文件，界面全程无提示（A1）
    const blocked = await window.api.ownerPrefix(oldPath)
    if (blocked.other) {
      if (pendingOpenPath === oldPath) pendingOpenPath = null
      await refreshTree()
      setStatus(`「${basename(oldPath)}」正在其他窗口中打开，请先切换到那个窗口`, true)
      return
    }
    const newPath = await window.api.rename(oldPath, name)
    await refreshTree()
    if (!newPath) {
      if (pendingOpenPath === oldPath) pendingOpenPath = null
      setStatus('已存在同名文件或文件夹', true)
      return
    }
    // 树里的展开态 / 选中行 / 键盘焦点全是按路径记的：先搬到新路径（数据此时已是新的），
    // 不搬的话改一个展开着的目录名它就自己折起来，选中的那行也丢高亮
    treeCtl.renameKeys(oldPath, newPath)
    if (pendingOpenPath === oldPath) {
      pendingOpenPath = null
      void openFile(newPath)
    } else if (state.openPath && isPathOrInside(state.openPath, oldPath)) {
      // 打开的正是被改名的这一篇、或它目录下的某一篇：路径要跟着走。否则下一次自动保存
      // 会把新内容写回已经不存在的旧路径（连同整个目录被 fs:write 的 mkdir -p 重建），
      // 树里看到的旧路径是旧内容、新路径再也收不到编辑（A2）
      const next = newPath + state.openPath.slice(oldPath.length)
      state.openPath = next
      // 父目录变了，图片的相对解析基准也要跟着换（编辑器里还挂着旧目录）
      editorCtl.setDir(dirname(next))
      // 归属是认路径的：改名后要按新路径重新认领，否则这篇会变成「无人认领」，
      // 别的窗口就能再打开它（同一个文件、两个窗口，正是要避免的情况）
      const claim = await window.api.claimDocument(next)
      if (!claim.ok) {
        // 新路径被别的窗口占着（改名前的竞态）：这一篇不能再在本窗口编辑下去，
        // 否则就是两处各自保存互相覆盖。清空编辑器，磁盘上保留已保存的内容。
        state.openPath = null
        state.dirty = false
        lastSaved = ''
        showEditorEmpty()
        setStatus(`「${basename(next)}」已被另一个窗口打开，已在本窗口关闭`, true)
        return
      }
      treeCtl.select(next)
      updateBreadcrumb()
    }
  } catch (e) {
    // fs:rename 在文件被占用（Windows 上另一个程序开着它）时会抛。调用方是
    // void doRename(...)，不接住的话用户侧零反馈：输入框关了、树也没刷新，像点了没反应（B3）
    if (pendingOpenPath === oldPath) pendingOpenPath = null
    await refreshTree()
    setStatus('重命名失败：' + ((e as Error).message || String(e)), true)
  }
}

async function doDelete(path: string) {
  try {
    // 与 doRename 同一个理由：里面的文件正在别的窗口里开着时不能删 ——
    // 那个窗口的自动保存会把文件连目录一起写回来（fs:write 自带 mkdir -p），
    // 就是「删掉的文件又出现了」
    const blocked = await window.api.ownerPrefix(path)
    if (blocked.other) {
      setStatus(`「${basename(path)}」正在其他窗口中打开，请先切换到那个窗口`, true)
      return
    }
    await window.api.trash(path)
  } catch (e) {
    // shell.trashItem 失败（文件被占用等）时同样不能悄无声息（B3）
    setStatus('删除失败：' + ((e as Error).message || String(e)), true)
    return
  }
  // 打开的正是被删的这一篇、或它目录下的某一篇 → 编辑区退回空状态
  // （⚠️ 祖先判断两边都要归一斜杠，见 isPathOrInside 的注释）
  if (state.openPath && isPathOrInside(state.openPath, path)) {
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
  if (e.key === 'Escape') {
    // 这个 Esc 只关浮层，必须拦下冒泡（E6）：document 上目录的 Esc 监听跑在冒泡段、
    // 晚于本监听 —— 不拦的话它执行时浮层已被关掉、让位判据失效，一次 Esc 会把
    // 浮层和目录一起收掉（B5 的让位法对「目标阶段先关掉自己」的场景不适用）
    e.stopPropagation()
    closeLinkPopover()
  }
})


// ---------- 查找 / 替换 ----------

const findBar = $('#find-bar')
const findInput = $('#find-input') as HTMLInputElement
const findCount = $('#find-count')
const findReplaceRow = $('#find-replace-row')
const findReplaceInput = $('#find-replace-input') as HTMLInputElement
const findToggle = $('#find-toggle-replace') as HTMLButtonElement
const findCaseBtn = $('#find-case') as HTMLButtonElement
const findPrevBtn = $('#find-prev') as HTMLButtonElement
const findNextBtn = $('#find-next') as HTMLButtonElement

/**
 * 命中区间。富文本模式是**文档坐标**（随文档结构变化），纯文本模式是
 * textarea 的**字符串下标** —— 两套坐标互不通用，所以每次都按当前模式重算。
 */
let findHits: { from: number; to: number }[] = []
let findIndex = -1
let findCase = false
let findQuery = ''

function refreshHits() {
  findQuery = findInput.value
  findHits = !findQuery
    ? []
    : editorMode === 'source'
      ? findRangesInText(els.sourceEditor.value, findQuery, findCase)
      : editorCtl.findRanges(findQuery, findCase)
}

function paintFind() {
  // 纯文本没有装饰层，藏起富文本那边的旧高亮（切模式时用得上）
  if (editorMode === 'source') editorCtl.clearFindHits()
  else editorCtl.showFindHits(findHits, findIndex)
  findCount.textContent = !findQuery ? '' : findHits.length ? `${findIndex + 1}/${findHits.length}` : '无结果'
  const none = !findHits.length
  findPrevBtn.disabled = none
  findNextBtn.disabled = none
  findInput.classList.toggle('no-hit', !!findQuery && none)
}

function gotoIndex(i: number) {
  if (!findHits.length) return
  findIndex = ((i % findHits.length) + findHits.length) % findHits.length
  const r = findHits[findIndex]
  // 先画高亮（is-current 换到新下标）再滚动：revealRange 的 rAF 里要按
  // .find-hit.is-current 的 DOM 位置算滚动目标，顺序反了会定位到旧的那条
  paintFind()
  if (editorMode === 'source') {
    const ta = els.sourceEditor
    ta.setSelectionRange(r.from, r.to)
    scrollTextareaTo(ta, r.from)
  } else {
    editorCtl.revealRange(r.from, r.to)
  }
}

/**
 * 把 textarea 里的某个字符偏移滚进视野。
 * ⚠️ 不能指望浏览器：实测 setSelectionRange / focus() / blur+focus 都不会让
 * #source-editor 滚动（光标在几十屏外也纹丝不动），只能镜像测量自己算 ——
 * 复制字体 / 行高 / 内边距 / 软换行规则，量「选区之前文本」的总高。
 */
function scrollTextareaTo(ta: HTMLTextAreaElement, offset: number) {
  const cs = getComputedStyle(ta)
  const mirror = document.createElement('div')
  for (const k of ['font', 'lineHeight', 'padding', 'border', 'boxSizing', 'letterSpacing', 'tabSize'] as const) {
    ;(mirror.style as unknown as Record<string, string>)[k] = (cs as unknown as Record<string, string>)[k]
  }
  Object.assign(mirror.style, {
    position: 'absolute',
    visibility: 'hidden',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    width: `${ta.clientWidth}px`,
  })
  mirror.textContent = ta.value.slice(0, offset)
  document.body.appendChild(mirror)
  const y = mirror.scrollHeight
  mirror.remove()
  // 视野内不动（连续命中同屏时不抖）；出了视野就滚到「命中位于视口上三分之一」处
  const lh = parseFloat(cs.lineHeight) || 24
  const top = ta.scrollTop
  if (y < top + lh || y > top + ta.clientHeight - lh * 2) {
    ta.scrollTop = Math.max(0, y - ta.clientHeight / 3)
  }
}

/** 定位到光标所在的（或之后的第一个）命中；回车继续往下走 */
function searchFromCaret() {
  refreshHits()
  if (!findHits.length) { findIndex = -1; paintFind(); return }
  gotoIndex(nextMatchIndex(findHits, currentCaret(), 1))
}

function stepFind(dir: 1 | -1) {
  if (!findHits.length) { searchFromCaret(); return }
  gotoIndex(findIndex + dir)
}

function currentCaret(): number {
  return editorMode === 'source' ? els.sourceEditor.selectionStart : editorCtl.caretPos()
}

/**
 * 替换当前命中，然后停在下一条。
 * 富文本：替换会让文档变更、插件自动撤掉旧高亮，所以替换完**重新搜一遍**；
 * 下标保持不变 —— 原来那条已被换掉，同一个下标自然指向下一条未替换的命中。
 */
function replaceOne(): boolean {
  if (!findHits.length || findIndex < 0) return false
  const r = findHits[findIndex]
  const text = findReplaceInput.value
  if (editorMode === 'source') {
    const ta = els.sourceEditor
    ta.setSelectionRange(r.from, r.to)
    ta.setRangeText(text, r.from, r.to, 'end')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  } else {
    editorCtl.replaceRange(r.from, r.to, text)
    onDocumentEdited() // 置脏 + 排自动保存（程序化事务不保证触发 onUpdate）
  }
  const keep = findIndex
  searchFromCaret()
  if (findHits.length) gotoIndex(Math.min(keep, findHits.length - 1))
  return true
}

function replaceAll(): boolean {
  refreshHits()
  if (!findHits.length) return false
  const text = findReplaceInput.value
  const n = findHits.length
  if (editorMode === 'source') {
    const value = els.sourceEditor.value
    // 一次拼完再整体写回：逐个替换会让后面的下标陆续失效
    let next = ''
    let last = 0
    for (const r of findHits) { next += value.slice(last, r.from) + text; last = r.to }
    next += value.slice(last)
    els.sourceEditor.value = next
    els.sourceEditor.dispatchEvent(new Event('input', { bubbles: true }))
  } else {
    editorCtl.replaceAllRanges(findHits, text)
    onDocumentEdited() // 同上：全部替换也要落盘
  }
  searchFromCaret()
  return true
}

function openFind(withReplace: boolean) {
  if (!state.openPath) { setStatus('还没有打开文档', true); return }
  findBar.classList.remove('hidden')
  // 已经有选中文本时直接拿它当关键词，省得再敲一遍
  if (editorMode === 'source') {
    const ta = els.sourceEditor
    if (ta.selectionEnd > ta.selectionStart) {
      const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd)
      if (!/\n/.test(sel)) findInput.value = sel
    }
  } else {
    const sel = editorCtl.selectionText()
    if (sel && !/\n/.test(sel)) findInput.value = sel
  }
  if (withReplace) {
    findReplaceRow.classList.remove('hidden')
    findToggle.setAttribute('aria-expanded', 'true')
  }
  refreshHits()
  gotoIndex(nextMatchIndex(findHits, currentCaret(), 1))
  paintFind()
  findInput.focus()
  findInput.select()
}

function closeFind() {
  findBar.classList.add('hidden')
  findReplaceRow.classList.add('hidden')
  findToggle.setAttribute('aria-expanded', 'false')
  findHits = []
  findIndex = -1
  findQuery = ''
  editorCtl.clearFindHits()
}

findInput.addEventListener('input', () => {
  refreshHits()
  if (!findHits.length) { findIndex = -1; paintFind(); return }
  gotoIndex(nextMatchIndex(findHits, currentCaret(), 1))
})
findCaseBtn.addEventListener('click', () => {
  findCase = !findCase
  findCaseBtn.setAttribute('aria-pressed', String(findCase))
  findCaseBtn.classList.toggle('active', findCase)
  refreshHits()
  if (findHits.length) gotoIndex(nextMatchIndex(findHits, currentCaret(), 1))
  else { findIndex = -1; paintFind() }
})
findPrevBtn.addEventListener('click', () => stepFind(-1))
findNextBtn.addEventListener('click', () => stepFind(1))
$('#find-replace-one').addEventListener('click', () => {
  if (!replaceOne()) setStatus('没有可替换的内容', true)
  else setStatus('已替换 1 处')
  findInput.focus()
})
$('#find-replace-all').addEventListener('click', () => {
  const n = findHits.length
  if (!n) { setStatus('没有可替换的内容', true); return }
  replaceAll()
  setStatus(`已替换 ${n} 处`)
  findInput.focus()
})
$('#find-close').addEventListener('click', closeFind)
findToggle.addEventListener('click', () => {
  const open = findReplaceRow.classList.toggle('hidden') === false
  findToggle.setAttribute('aria-expanded', String(open))
  if (open) findReplaceInput.focus()
  else findInput.focus()
})

// 查找条内的回车 / Esc 自己消化掉，别冒到 document 上去（Enter 有全局绑定，
// Esc 会把目录也一起收掉 —— 同 E6 的 stopPropagation 理由）
for (const input of [findInput, findReplaceInput]) {
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      stepFind(e.shiftKey ? -1 : 1)
      return
    }
    if (e.key === 'Escape') {
      e.stopPropagation()
      closeFind()
    }
  })
}

// ---------- sidebar / misc buttons ----------

function toggleSidebar() {
  // ⚠️ 独立窗口与单文件模式**也有侧栏**了（大纲搬进来之后），
  // 所以这里不再 early-return —— 它们同样能收，只是宽度是定宽那档。
  // 顶部「切换边栏」按钮在单文件 / 独立窗口下也不再隐藏。
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
// 双击把手恢复默认宽度（资源管理器也有类似行为，C11）
$('#sidebar-resize').addEventListener('dblclick', () => {
  sidebarPref = SIDEBAR_W
  applySidebarWidth()
  localStorage.setItem(SIDEBAR_W_KEY, String(sidebarPref))
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


// ---------- menu events ----------

window.api.onMenu(async (action) => {
  switch (action) {
    case 'open-folder': await chooseAndOpen(); break
    case 'new-file': if (state.root) await createEntry(state.root, 'file'); break
    case 'save': await doSave(); break
    case 'close-workspace': await closeWorkspace(); break
    case 'undo':
      if (editorMode === 'source') { els.sourceEditor.focus(); document.execCommand('undo') }
      else editorCtl.undo()
      break
    case 'redo':
      if (editorMode === 'source') { els.sourceEditor.focus(); document.execCommand('redo') }
      else editorCtl.redo()
      break
    case 'link': openLinkPopover(); break
    case 'toggle-sidebar': toggleSidebar(); break
    case 'toggle-outline': toggleOutline(); break
  }
})

// ---------- fs watch ----------

let fsTimer: number | undefined
window.api.onFsChanged(() => {
  clearTimeout(fsTimer)
  fsTimer = window.setTimeout(async () => {
    // 目录模式刷新文件树；单文件 / 独立窗口没有树，跳过刷新、只做下面这份文件的比对（D4）
    if (state.root) await refreshTree()
    if (!state.openPath) return
    // 磁盘上的这份文件被别的程序改过了吗（A4）？拿打开 / 上次保存时记下的 mtime 比一眼。
    // 自己刚保存的那次不会误报 —— doSave 里已经把 lastSavedMtime 更新成保存后的值了。
    const st = await window.api.stat(state.openPath)
    if (!st || st.mtimeMs <= lastSavedMtime) return
    if (state.dirty) {
      // 脏的时候自动保存会直接覆盖掉外部修改。不拦（用户的编辑优先），但要说话。
      externalChange = true
      setStatus('磁盘上的文件已被其他程序修改，继续保存将覆盖它', true)
      return
    }
    // 干净的时候照旧回读（这条路径早就验证过：不会用磁盘内容覆盖编辑器里的未保存编辑）
    try {
      const md = await window.api.read(state.openPath)
      if (md !== lastSaved) {
        editorCtl.open(md, dirname(state.openPath))
        els.sourceEditor.value = md
        lastSaved = md
        noteDiskState(st)
        updateCount()
        void localizeRemoteImages(editorCtl.remoteImageSources())
      }
    } catch { /* 文件可能刚被删除 */ }
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
    // 拖进来的文件就在当前工作空间里时走普通打开，保住侧栏和文件树（E3）；
    // 空间外的才切单文件模式 —— 否则拖一篇空间内的文档也会把整个工作空间切掉
    if (state.root && isPathOrInside(target, state.root)) void openFile(target)
    else void openSingleFile(target)
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
// 上次退出前的兜底保存（fs:flush）失败过：主进程把原因存在 userData，这里取出来提示。
// 兜底保存本身失败时页面正在卸载、没有任何界面能显示错误，只能靠这一句（A3/A7）
const saveError = await window.api.takeSaveError()
if (saveError) setStatus(saveError, true, 6000)
const initial = await window.api.initialFile()
if (initial) void openSingleFile(initial)
