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

/** 绝对路径 + 相对路径（支持 .. 与 .）合并为绝对 posix 路径 */
export function resolveRel(dir: string, rel: string): string {
  const r = posixify(rel)
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
}

export interface Api {
  platform: string
  chooseFolder(): Promise<string | null>
  setRoot(root: string): Promise<boolean>
  tree(root: string): Promise<TreeNode[]>
  read(p: string): Promise<string>
  write(p: string, content: string): Promise<boolean>
  flush(p: string, content: string): boolean
  create(parent: string, base: string, type: 'file' | 'dir'): Promise<string>
  rename(p: string, newName: string): Promise<string | null>
  trash(p: string): Promise<boolean>
  reveal(p: string): Promise<boolean>
  chooseImageDirectory(defaultPath?: string): Promise<string | null>
  allowImageDirectory(directory: string): Promise<boolean>
  saveImage(fileName: string, data: Uint8Array, documentPath: string, storage: ImageStorageSettings): Promise<{ abs: string; displayPath: string }>
  openExternal(url: string): Promise<boolean>
  popupMenu(items: (PopupItem | '-')[], x: number, y: number): Promise<string | null>
  setTheme(mode: 'system' | 'light' | 'dark'): Promise<boolean>
  openImageViewer(src: string, title: string): Promise<boolean>
  imageViewerData(): Promise<{ src: string; title: string } | null>
  initialFile(): Promise<string | null>
  onFsChanged(cb: () => void): () => void
  onMenu(cb: (action: string) => void): () => void
  onOpenFile(cb: (p: string) => void): () => void
}

declare global {
  interface Window {
    api: Api
  }
}
