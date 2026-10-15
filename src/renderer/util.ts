export const posixify = (p: string) => p.replace(/\\/g, '/')

export function basename(p: string): string {
  const s = posixify(p)
  return s.slice(s.lastIndexOf('/') + 1)
}

export function dirname(p: string): string {
  const s = posixify(p)
  const i = s.lastIndexOf('/')
  if (i < 0) return '.'
  if (i === 0) return '/'
  return s.slice(0, i)
}

/**
 * 两个绝对路径是不是同一个位置。
 *
 * 统一三件事，否则同一个位置会被判成不同：
 *  1. 分隔符：Windows 上同一目录可能是 `C:\a\b` 也可能是 `C:/a/b`
 *  2. 大小写：Windows / macOS 文件系统不区分大小写，`C:\A` 与 `c:\a` 是同一个目录；
 *     Linux 区分，所以**只在 win32 与 darwin 上忽略大小写**
 *  3. 末尾斜杠：`C:\a\` 与 `C:\a` 是同一个目录
 *
 * 用于「重复打开同一个文件夹 / 文件」的判据 —— 那条路上判错一次就会把用户
 * 正在编辑的内容清掉（重开工作空间会走showEditorEmpty()），宁可宽松一点。
 */
export function samePath(a: string | null, b: string | null): boolean {
  if (!a || !b) return a === b
  const norm = (p: string) => {
    const s = posixify(p).replace(/\/+$/, '')
    return typeof window !== 'undefined' && window.api?.platform === 'linux' ? s : s.toLowerCase()
  }
  return norm(a) === norm(b)
}

/** 绝对路径 + 相对路径（支持 .. 与 .）合并为绝对 posix 路径 */
export function resolveRel(dir: string, rel: string): string {
  const r = posixify(rel).split('/').map((seg) => {
    try { return decodeURIComponent(seg) } catch { return seg }
  }).join('/')
  if (/^[a-zA-Z]:\//.test(r) || r.startsWith('/')) return r
  const segs = posixify(dir).split('/')
  for (const seg of r.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') segs.pop()
    else segs.push(seg)
  }
  return segs.join('/')
}

/** 计算从 fromDir 到 target 的相对路径；跨盘符时退回绝对路径 */
export function relativeFrom(fromDir: string, target: string): string {
  const from = posixify(fromDir).split('/')
  const to = posixify(target).split('/')
  if (from[0].toLowerCase() !== to[0].toLowerCase()) return posixify(target)
  let i = 0
  while (i < from.length && i < to.length && from[i] === to[i]) i++
  const up = from.length - i
  return [...Array(up).fill('..'), ...to.slice(i)].join('/') || '.'
}

/** 文件系统路径 → 可安全写入 Markdown 图片目标的路径。 */
export function encodeMarkdownPath(p: string): string {
  return posixify(p).split('/').map((seg) => {
    if (!seg || seg === '.' || seg === '..' || /^[a-zA-Z]:$/.test(seg)) return seg
    return encodeURIComponent(seg).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)
  }).join('/')
}

/** 兼容旧版本写出的含未转义空格的本地图片链接。 */
export function normalizeMarkdownImagePaths(markdown: string): string {
  return markdown.replace(/!\[([^\]\r\n]*)\]\(([^)\r\n]+)\)/g, (whole, alt: string, destination: string) => {
    const value = destination.trim()
    if (!value.includes(' ') || (value.startsWith('<') && value.endsWith('>'))) return whole
    // 保留标准 Markdown 的可选标题语法：![alt](path "title")
    if (/^\S+\s+["']/.test(value)) return whole
    return `![${alt}](${value.replace(/ /g, '%20')})`
  })
}

/** 本地文件 → app-file:// 媒体 URL（先解码再编码，避免 %xx 被二次编码） */
export function toMediaUrl(absPath: string): string {
  const segs = posixify(absPath).split('/').map((seg) => {
    try { return encodeURIComponent(decodeURIComponent(seg)) } catch { return encodeURIComponent(seg) }
  })
  return 'app-file://localhost/' + segs.join('/')
}

export function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function imageFileName(mime: string): string {
  const d = new Date()
  const ext = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/avif': 'avif', 'image/bmp': 'bmp' } as Record<string, string>)[mime] || 'png'
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `image${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${ms}.${ext}`
}

export interface TreeNode {
  name: string
  path: string
  type: 'dir' | 'file'
  children?: TreeNode[]
}

export interface PopupItem {
  id?: string
  label?: string
  enabled?: boolean
  hint?: string
}

export type ImageStorageMode = 'file-assets' | 'custom' | 'document-assets'

export interface ImageStorageSettings {
  mode: ImageStorageMode
  directory?: string
  maxDownloadSizeMB: number
}

export interface Api {
  platform: string
  chooseFolder(): Promise<string | null>
  chooseFile(): Promise<string | null>
  setRoot(root: string): Promise<boolean>
  /** 单文件模式：把拖拽 / 双击得到的路径登记为主进程可读写的文件 */
  allowFile(p: string): Promise<boolean>
  /** 读取工作空间根目录那一层（目录节点不带 children） */
  tree(root: string): Promise<TreeNode[]>
  /** 懒加载：展开某个目录时才读它那一层 */
  children(dir: string): Promise<TreeNode[]>
  read(p: string): Promise<string>
  /** 文件状态（mtime / size）：用来发现「磁盘上的文件被别的程序改过了」 */
  stat(p: string): Promise<{ mtimeMs: number; size: number } | null>
  write(p: string, content: string): Promise<boolean>
  flush(p: string, content: string): boolean
  create(parent: string, base: string, type: 'file' | 'dir'): Promise<string>
  validateName(name: string): Promise<string | null>
  rename(p: string, newName: string): Promise<string | null>
  trash(p: string): Promise<boolean>
  reveal(p: string): Promise<boolean>
  openDir(p: string): Promise<boolean>
  chooseImageDirectory(defaultPath?: string): Promise<string | null>
  allowImageDirectory(directory: string): Promise<boolean>
  saveImage(fileName: string, data: Uint8Array, documentPath: string, storage: ImageStorageSettings): Promise<{ abs: string; displayPath: string }>
  downloadImage(url: string, documentPath: string, storage: ImageStorageSettings): Promise<{ abs: string; displayPath: string }>
  /** 导出 PDF：把编辑器 HTML 与样式字符串交给主进程在隐藏窗口里打印；返回落盘路径，用户取消为 null */
  exportPdf(payload: { html: string; css: string; name: string }): Promise<string | null>
  /**
   * 导出 Word：把文档模型与**目标文档所在的目录**交给主进程组装 .docx
   * （相对图片路径按 baseDir 解析）。返回值带上 skipped = 读不到或格式不支持的图片数，
   * 用户取消保存对话框时为 null。
   *
   * doc 用 unknown 而不是 JSONContent：util 是零依赖的工具模块，
   * 调用方（main.ts）那边本来就有确切类型，没必要为传输边界把 tiptap 引进来。
   */
  exportDocx(payload: { doc: unknown; baseDir: string; name: string }): Promise<{ path: string; skipped: number } | null>
  /** 同步「导出为 PDF…」「导出为 Word…」两个菜单项的可用性 */
  setExportEnabled(enabled: boolean): Promise<boolean>
  openExternal(url: string): Promise<boolean>
  clipboard(action: 'cut' | 'copy' | 'paste'): Promise<boolean>
  pathForFile(file: File): string
  popupMenu(items: (PopupItem | '-')[], x: number, y: number): Promise<string | null>
  setTheme(mode: 'system' | 'light' | 'neutral' | 'dark' | 'qq' | 'wb-light' | 'wb-dark'): Promise<boolean>
  openImageViewer(src: string, title: string): Promise<boolean>
  imageViewerData(): Promise<{ src: string; title: string } | null>
  /**
   * 在独立窗口中打开某个 Markdown：不带工作空间侧栏，只编辑这一篇。
   * `'focus'` = 这篇已经在一个窗口里开着（同一个文件不允许两处编辑，主进程已把那个窗口抬到前面，
   * 没有再开新窗口）；`'invalid'` = 路径不合法或文件不存在。
   */
  openInNewWindow(p: string): Promise<'opened' | 'focus' | 'invalid'>
  /**
   * 认领一篇文档的编辑权。同一个 Markdown 同时只允许一个窗口打开 ——
   * 两处各自自动保存会互相覆盖，且界面上看不出来。
   * 被别的窗口占着时返回 `{ ok: false }`（主进程已把那个窗口抬到前面）；
   * 传 null 表示当前文档已关闭，清空本窗口的认领。
   */
  claimDocument(p: string | null): Promise<{ ok: boolean; self: boolean }>
  /** 释放本窗口认领的文档（关闭工作空间、文档被删除后调用） */
  releaseDocument(): Promise<boolean>
  /**
   * 查 p 自己或其子孙路径里有没有被占用的文档（重命名 / 删除**目录**前用）。
   * 目录里的文件正在别的窗口开着时，那个窗口的自动保存会把旧路径连目录一起写回来。
   */
  ownerPrefix(p: string): Promise<{ self: boolean; other: boolean }>
  initialFile(): Promise<string | null>
  /** 取走上一次退出时保存失败的原因（没有则为 null） */
  takeSaveError(): Promise<string | null>
  /**
   * 单文件 / 独立窗口模式：让主进程监听当前文档所在目录（fs:changed 由此而来）。
   * 工作空间模式不用调 —— 根目录已有递归监听（D4）。
   */
  watchFile(p: string): Promise<boolean>
  resizeWindow(mode: 'welcome' | 'workspace'): Promise<boolean>
  onFsChanged(cb: () => void): () => void
  /** 主题是应用级设置，别的窗口改了主题时收到广播（只更新界面，不再回传） */
  onThemeChanged(cb: (mode: 'neutral' | 'light') => void): () => void
  onMenu(cb: (action: string) => void): () => void
  onOpenFile(cb: (p: string) => void): () => void
}

declare global {
  interface Window {
    api: Api
  }
}
