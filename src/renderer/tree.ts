import { basename } from './util'
import type { TreeNode } from './util'

export interface TreeHandlers {
  onOpenFile(path: string): void
  onContext(kind: 'file' | 'dir' | 'root', path: string, x: number, y: number): void
  onRename(oldPath: string, newName: string): void
  /** 重命名输入框关闭但未发起改名（Escape 取消，或名字没改）时回调 */
  onRenameSettled?(oldPath: string, committed: boolean): void
}

const ICONS = {
  chevron: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5 10.5 8 6 12.5"/></svg>',
  doc: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 1.5H4.2c-.4 0-.7.3-.7.7v11.6c0 .4.3.7.7.7h7.6c.4 0 .7-.3.7-.7V4.5L9.5 1.5Z"/><path d="M9.5 1.5v3h3"/><path d="M6 8h4M6 10.5h4"/></svg>',
}

export function createTree(container: HTMLElement, h: TreeHandlers) {
  let data: TreeNode[] = []
  let selectedPath = ''
  let renamePath: string | null = null
  /** 重命名输入框里用户已输入的内容：DOM 被重建时用它恢复，避免打的字被吞 */
  let renameDraft: string | null = null
  /** 重命名进行中收到的树数据：先挂起，等改名结束再应用，避免输入框被重建冲掉 */
  let pendingData: TreeNode[] | null = null
  const expanded = new Set<string>()

  function setData(nodes: TreeNode[]) {
    // 新建文件会触发 fs.watch → 树刷新，若此时重命名输入框在编辑中，重建 DOM 会把它冲掉
    if (renamePath) { pendingData = nodes; return }
    data = nodes
    render()
  }
  function flushPendingData() {
    if (!pendingData) return false
    data = pendingData
    pendingData = null
    return true
  }
  function select(path: string) { selectedPath = path; if (!renamePath) render() }
  function ensureExpanded(path: string) { if (!expanded.has(path)) { expanded.add(path); if (!renamePath) render() } }
  function clear() { data = []; pendingData = null; selectedPath = ''; renamePath = null; renameDraft = null; expanded.clear(); render() }

  /** 让指定行进入重命名态（文件/文件夹均可），输入框聚焦并全选 */
  function startRename(path: string) {
    const node = find(data, path)
    if (!node) return
    renamePath = path
    renameDraft = null
    if (node.type === 'file') selectedPath = path
    render()
  }

  function render() {
    container.innerHTML = ''
    const frag = document.createDocumentFragment()
    const walk = (nodes: TreeNode[], depth: number) => {
      for (const n of nodes) {
        frag.append(row(n, depth))
        if (n.type === 'dir' && expanded.has(n.path) && n.children?.length) walk(n.children, depth + 1)
      }
    }
    walk(data, 0)
    container.append(frag)
    if (!data.length) {
      const empty = document.createElement('div')
      empty.className = 'tree-empty'
      empty.textContent = '空文件夹'
      container.append(empty)
    }
  }

  function row(n: TreeNode, depth: number): HTMLElement {
    const el = document.createElement('div')
    el.className = `tree-row ${n.type}` + (n.path === selectedPath ? ' selected' : '')
    el.dataset.path = n.path
    el.style.setProperty('--depth', String(depth))

    if (renamePath === n.path) {
      const input = document.createElement('input')
      input.className = 'tree-rename'
      // Markdown 文件隐藏后缀，只改名字；提交时由 doRename 补回 .md
      const baseName = n.name.replace(/\.(md|markdown|mdown|mkd)$/i, '')
      input.value = renameDraft ?? baseName
      input.spellcheck = false
      const done = (commit: boolean) => {
        if (!renamePath) return
        const oldPath = renamePath
        const value = input.value
        renamePath = null
        renameDraft = null
        if (commit && value !== baseName) {
          flushPendingData()
          h.onRename(oldPath, value)
        } else {
          flushPendingData()
          render()
          h.onRenameSettled?.(oldPath, commit)
        }
      }
      input.addEventListener('input', () => { renameDraft = input.value })
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') done(true)
        else if (e.key === 'Escape') done(false)
        e.stopPropagation()
      })
      input.addEventListener('blur', () => {
        // 输入框被 render() 重建时也会触发 blur，此时元素已脱离文档，不能当作用户失焦提交
        if (!input.isConnected) return
        done(true)
      })
      input.addEventListener('click', (e) => e.stopPropagation())
      el.append(input)
      queueMicrotask(() => { input.focus(); input.select() })
      return el
    }

    const icon = document.createElement('span')
    icon.className = 'tree-icon' + (n.type === 'dir' && expanded.has(n.path) ? ' open' : '')
    icon.innerHTML = n.type === 'dir' ? ICONS.chevron : ICONS.doc
    el.append(icon)

    const name = document.createElement('span')
    name.className = 'tree-name'
    name.textContent = n.name
    el.append(name)
    return el
  }

  container.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    const input = target.closest<HTMLInputElement>('input.tree-rename')
    if (input) return
    const rowEl = target.closest<HTMLElement>('.tree-row')
    if (!rowEl) return
    const path = rowEl.dataset.path!
    const node = find(data, path)
    if (!node) return
    if (node.type === 'dir') {
      if (expanded.has(path)) expanded.delete(path)
      else expanded.add(path)
      render()
    } else {
      selectedPath = path
      render()
      h.onOpenFile(path)
    }
  })

  container.addEventListener('dblclick', (e) => {
    const rowEl = (e.target as HTMLElement).closest<HTMLElement>('.tree-row')
    if (!rowEl || rowEl.querySelector('input')) return
    const node = find(data, rowEl.dataset.path!)
    if (node?.type === 'file') {
      e.preventDefault()
      startRename(node.path)
    }
  })

  container.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    const rowEl = (e.target as HTMLElement).closest<HTMLElement>('.tree-row')
    if (rowEl && !rowEl.querySelector('input')) {
      const node = find(data, rowEl.dataset.path!)
      if (node) {
        selectedPath = node.type === 'file' ? node.path : selectedPath
        render()
        h.onContext(node.type, node.path, e.clientX, e.clientY)
        return
      }
    }
    if (!rowEl) h.onContext('root', '', e.clientX, e.clientY)
  })

  function find(nodes: TreeNode[], path: string): TreeNode | null {
    for (const n of nodes) {
      if (n.path === path) return n
      if (n.children) {
        const hit = find(n.children, path)
        if (hit) return hit
      }
    }
    return null
  }

  render()
  return {
    setData, select, ensureExpanded, clear, startRename,
    get selected() { return selectedPath },
    get renaming() { return renamePath !== null },
  }
}

export { basename }
