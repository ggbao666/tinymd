import './style.css'
import { createEditor, type EditorCtl } from './editor'
import { createTree } from './tree'
import { showContextMenu } from './contextmenu'
import { openImageViewer } from './imageviewer'
import { basename, dirname, encodeMarkdownPath, imageFileName, relativeFrom, resolveRel, type ImageStorageMode, type ImageStorageSettings } from './util'

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
  breadcrumb: $('#breadcrumb'),
  status: $('#status'),
  sidebar: $('#sidebar'),
  tree: $('#tree'),
  outline: $('#outline'),
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
  settingsBackdrop: $('#settings-backdrop'),
  imageSettingsButton: $('#btn-image-settings') as HTMLButtonElement,
  imageCustomPath: $('#image-custom-path'),
  imageMaxDownloadSize: $('#image-max-download-size') as HTMLInputElement,
}

if (window.api.platform === 'darwin') document.body.classList.add('mac')
if (window.api.platform === 'win32') document.body.classList.add('win')

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
  onOpenFile(p) { void openFile(p) },
  onContext(kind, path, x, y) { void showTreeMenu(kind, path, x, y) },
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

async function openFile(path: string) {
  if (path === state.openPath) return
  await flushSave()
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
    const dr = displayRoot()
    document.title = dr ? `${basename(path)} — ${basename(dr)}` : basename(path)
    els.editorWrap.scrollTop = 0
    els.sourceEditor.scrollTop = 0
    void localizeRemoteImages(editorCtl.remoteImageSources())
  } catch (e) {
    setStatus('无法打开文件', true)
  }
}

async function openWorkspace(root: string, selectFile?: string) {
  await flushSave()
  await window.api.setRoot(root)
  state.root = root
  // 从单文件模式切回目录模式：恢复文件树与标签头
  fileMode = false
  document.body.classList.remove('file-mode')
  setSideTab('files')
  treeCtl.setData(await window.api.tree(root))
  els.wsPath.textContent = root
  els.wsPath.title = root
  els.welcome.classList.add('hidden')
  els.workspace.classList.remove('hidden')
  void window.api.resizeWindow('workspace')
  addRecent(root)
  document.title = basename(root)
  if (selectFile) await openFile(selectFile)
  else showEditorEmpty()
}

// 单文件打开（打开文件 / 拖拽 / 双击 md / 右键打开）：
// 不把所在文件夹当工作空间，侧栏只保留大纲，底部路径条显示当前文件。
async function openSingleFile(path: string) {
  await flushSave()
  state.root = null
  fileMode = true
  document.body.classList.add('file-mode')
  treeCtl.clear()
  setSideTab('outline')
  els.welcome.classList.add('hidden')
  els.workspace.classList.remove('hidden')
  void window.api.resizeWindow('workspace')
  // 与目录模式一致：底部路径条显示的是目录路径，不是文件路径
  const dir = dirname(path)
  els.wsPath.textContent = dir
  els.wsPath.title = dir
  addRecent(path, 'file')
  state.openPath = null
  await openFile(path)
}

async function closeWorkspace() {
  await flushSave()
  state.root = null
  fileMode = false
  document.body.classList.remove('file-mode')
  state.openPath = null
  state.dirty = false
  lastSaved = ''
  treeCtl.clear()
  els.workspace.classList.add('hidden')
  els.welcome.classList.remove('hidden')
  void window.api.resizeWindow('welcome')
  document.title = 'tinymd'
  renderRecents()
}

function showEditor() {
  els.editorEmpty.classList.add('hidden')
  els.editorWrap.classList.toggle('hidden', editorMode !== 'visual')
  els.sourceWrap.classList.toggle('hidden', editorMode !== 'source')
  updateEditorModeButton()
  renderOutline()
}

function showEditorEmpty() {
  state.openPath = null
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
  renderOutline()
  updateBreadcrumb()
  document.title = basename(displayRoot())
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

// ---------- outline（文档大纲） ----------

let outlineTimer: number | undefined
function scheduleOutline() {
  clearTimeout(outlineTimer)
  outlineTimer = window.setTimeout(renderOutline, 250)
}

function renderOutline() {
  const items = state.openPath && editorMode === 'visual' ? editorCtl.getOutline() : []
  els.outline.innerHTML = ''
  if (!items.length) return
  for (const it of items) {
    const row = document.createElement('div')
    row.className = `outline-item lv-${it.level}`
    row.textContent = it.text || '（空标题）'
    row.title = it.text
    row.addEventListener('click', () => editorCtl.revealPos(it.pos))
    els.outline.append(row)
  }
}

// ---------- sidebar tabs（文件 / 大纲切换，滚动位置各自记忆） ----------

const TAB_KEY = 'jianmo.sideTab'
const sideScroll = { files: 0, outline: 0 }
els.tree.addEventListener('scroll', () => { sideScroll.files = els.tree.scrollTop })
els.outline.addEventListener('scroll', () => { sideScroll.outline = els.outline.scrollTop })

function setSideTab(tab: 'files' | 'outline') {
  localStorage.setItem(TAB_KEY, tab)
  document.body.classList.toggle('side-outline', tab === 'outline')
  $('#tab-files').classList.toggle('active', tab === 'files')
  $('#tab-outline').classList.toggle('active', tab === 'outline')
  if (tab === 'outline') renderOutline()
  // 恢复该面板上次的滚动位置
  const pane = tab === 'outline' ? els.outline : els.tree
  pane.scrollTop = sideScroll[tab]
}
$('#tab-files').addEventListener('click', () => setSideTab('files'))
$('#tab-outline').addEventListener('click', () => setSideTab('outline'))
setSideTab(localStorage.getItem(TAB_KEY) === 'outline' ? 'outline' : 'files')

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

function applyTheme() {
  const root = document.documentElement
  root.classList.toggle('theme-neutral', themeMode === 'neutral')
  root.classList.toggle('theme-light', themeMode === 'light')
  void window.api.setTheme(themeMode) // 原生右键菜单 + Windows 标题栏按钮跟随
  const settingsRadio = document.querySelector<HTMLInputElement>(`input[name="settings-theme"][value="${themeMode}"]`)
  if (settingsRadio) settingsRadio.checked = true
}

applyTheme()

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
  const items: (string | { id: string; label: string })[] = []
  if (kind === 'file') {
    items.push({ id: 'open', label: '打开' }, '-')
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
  const id = await showContextMenu(items as never, x, y)
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
function loadRecents(): { path: string; name: string; time: number; kind?: 'dir' | 'file' }[] {
  try { return JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]') } catch { return [] }
}
function addRecent(path: string, kind: 'dir' | 'file' = 'dir') {
  const list = loadRecents().filter((r) => r.path !== path)
  list.unshift({ path, name: basename(path), time: Date.now(), kind })
  localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, 8)))
}
function renderRecents() {
  const list = loadRecents()
  els.recents.innerHTML = ''
  if (!list.length) return
  const label = document.createElement('div')
  label.className = 'recents-label'
  label.textContent = '最近打开'
  els.recents.append(label)
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
    els.recents.append(row)
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
  document.body.classList.toggle('no-sidebar')
}
els.btnSidebar.addEventListener('click', toggleSidebar)

// ---------- 编辑区宽度（窄 / 中 / 宽） ----------

const WIDTH_KEY = 'tinymd.editorWidth'
type WidthMode = 'narrow' | 'medium' | 'wide'

let editorWidth: WidthMode = (['narrow', 'medium', 'wide'] as const).includes(localStorage.getItem(WIDTH_KEY) as WidthMode)
  ? (localStorage.getItem(WIDTH_KEY) as WidthMode)
  : 'medium'

function applyEditorWidth() {
  document.body.classList.toggle('width-narrow', editorWidth === 'narrow')
  document.body.classList.toggle('width-wide', editorWidth === 'wide')
  const radio = document.querySelector<HTMLInputElement>(`input[name="settings-width"][value="${editorWidth}"]`)
  if (radio) radio.checked = true
}

document.querySelectorAll<HTMLInputElement>('input[name="settings-width"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    editorWidth = radio.value as WidthMode
    localStorage.setItem(WIDTH_KEY, editorWidth)
    applyEditorWidth()
  })
})
applyEditorWidth()

// ---------- sidebar resize（拖拽调宽） ----------

const SIDEBAR_W_KEY = 'jianmo.sidebarWidth'
let resizing = false

const savedW = Number(localStorage.getItem(SIDEBAR_W_KEY))
if (savedW >= 180 && savedW <= 520) els.sidebar.style.width = `${savedW}px`

$('#sidebar-resize').addEventListener('mousedown', (e) => {
  e.preventDefault()
  resizing = true
  document.body.classList.add('resizing')
})
document.addEventListener('mousemove', (e) => {
  if (!resizing) return
  els.sidebar.style.width = `${Math.min(520, Math.max(180, e.clientX))}px`
})
document.addEventListener('mouseup', () => {
  if (!resizing) return
  resizing = false
  document.body.classList.remove('resizing')
  localStorage.setItem(SIDEBAR_W_KEY, els.sidebar.style.width)
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
  const first = Array.from(e.dataTransfer?.files || [])[0]
  if (!first) return
  const path = window.api.pathForFile(first)
  if (!path) return
  if (MD_RE.test(path)) {
    void openSingleFile(path)
  } else if (!first.type.startsWith('image/')) {
    // 图片由编辑区的 handleDrop 处理；其余类型明确告知不支持
    setStatus('只能拖入 Markdown 文件（.md）打开', true)
  }
})

// ---------- boot ----------

renderRecents()
const initial = await window.api.initialFile()
if (initial) void openSingleFile(initial)
