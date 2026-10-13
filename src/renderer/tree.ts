import { basename } from './util'
import type { TreeNode } from './util'

export interface TreeHandlers {
  /**
   * 点击某个文件。返回 `false`（或 resolve 成 false）表示**没打开成功** ——
   * 目前只有一种情况：这一篇正在别的窗口里编辑（同一个文件不允许两处编辑）。
   * 那时把树上刚点上的高亮退回去，否则树指着的那一篇和编辑器里的并不是同一个。
   */
  onOpenFile(path: string): void | boolean | Promise<boolean | void>
  onContext(kind: 'file' | 'dir' | 'root', path: string, x: number, y: number): void
  onRename(oldPath: string, newName: string): void
  /** 重命名输入框关闭但未发起改名（Escape 取消，或名字没改）时回调 */
  onRenameSettled?(oldPath: string, committed: boolean): void
  /** 点击目录行尾的「+」：在该目录下新建文件 */
  onNewFile?(dirPath: string): void
}

const ICONS = {
  chevron: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5 10.5 8 6 12.5"/></svg>',
  doc: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 1.5H4.2c-.4 0-.7.3-.7.7v11.6c0 .4.3.7.7.7h7.6c.4 0 .7-.3.7-.7V4.5L9.5 1.5Z"/><path d="M9.5 1.5v3h3"/><path d="M6 8h4M6 10.5h4"/></svg>',
  dots: '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="3.2" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="8" cy="12.8" r="1.5"/></svg>',
  plus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M8 3.5v9M3.5 8h9"/></svg>',
}

/** 行尾的小图标按钮（⋮ 更多操作 / + 新建文件）：行 hover 或选中时才浮现 */
function actionButton(icon: string, title: string, onClick: (e: MouseEvent) => void) {
  const b = document.createElement('button')
  b.className = 'tree-act'
  b.title = title
  b.tabIndex = -1
  b.innerHTML = icon
  b.addEventListener('click', onClick)
  return b
}

export function createTree(container: HTMLElement, h: TreeHandlers) {
  let data: TreeNode[] = []
  let selectedPath = ''
  let renamePath: string | null = null
  /** 重命名输入框里用户已输入的内容：DOM 被重建时用它恢复，避免打的字被吞 */
  let renameDraft: string | null = null
  /** 重命名进行中收到的树数据：先挂起，等改名结束再应用，避免输入框被重建冲掉 */
  let pendingData: TreeNode[] | null = null
  /**
   * 键盘焦点所在行（C4）：render() 之后按它恢复焦点 —— Enter 折叠目录、F2 重命名
   * 都会重建 DOM，不恢复的话键盘焦点就丢了。鼠标点行也会记一份，这样点击之后
   * 再来一次树刷新（fs:changed），焦点仍然留在用户刚操作的那一行上。
   */
  let focusPath: string | null = null
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
  function clear() { data = []; pendingData = null; selectedPath = ''; renamePath = null; renameDraft = null; focusPath = null; expanded.clear(); render() }

  /** 让指定行进入重命名态（文件/文件夹均可），输入框聚焦并全选 */
  function startRename(path: string) {
    const node = find(data, path)
    if (!node) return
    renamePath = path
    renameDraft = null
    if (node.type === 'file') selectedPath = path
    render()
  }

  /**
   * 在树里定位某一行（面包屑的文件夹部分点击用，C8）：展开它的所有祖先目录、
   * 选中并滚动到可见处。路径不在树里（被删了 / 还没刷新）时返回 false。
   */
  function reveal(path: string): boolean {
    // 自底向上收集「从根到目标」整条链上的目录，找到才算数
    const chain: string[] = []
    const walk = (nodes: TreeNode[]): boolean => {
      for (const n of nodes) {
        if (n.path === path) return true
        if (n.children?.length && walk(n.children)) { chain.push(n.path); return true }
      }
      return false
    }
    if (!walk(data)) return false
    for (const dir of chain) expanded.add(dir)
    selectedPath = path
    render()
    const row = [...container.querySelectorAll<HTMLElement>('.tree-row')].find((el) => el.dataset.path === path)
    row?.scrollIntoView({ block: 'nearest' })
    return true
  }

  /**
   * 路径改名之后，把内部「按路径记的状态」整棵树搬过去（A1/A2 的配套）：
   * 展开态、选中行、键盘焦点。不搬的话：改一个展开着的目录名，它自己折起来；
   * 改一个选中文件的名字，高亮消失；目录里的子孙路径同样要跟着换前缀。
   */
  function renameKeys(oldPath: string, newPath: string) {
    const sep = oldPath.includes('\\') ? '\\' : '/'
    const head = oldPath + sep
    const remap = (p: string) =>
      p === oldPath ? newPath : p.startsWith(head) ? newPath + p.slice(oldPath.length) : p
    const moved = new Set<string>()
    for (const dir of expanded) moved.add(remap(dir))
    expanded.clear()
    for (const dir of moved) expanded.add(dir)
    selectedPath = remap(selectedPath)
    focusPath = focusPath === null ? null : remap(focusPath)
    render()
  }

  function render() {
    // 重建 DOM 会丢焦点：之前还攥着焦点的话，重建之后按 focusPath 还回去
    const hadFocus = container.contains(document.activeElement)
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
    if (hadFocus && focusPath) {
      const back = [...container.querySelectorAll<HTMLElement>('.tree-row')].find((el) => el.dataset.path === focusPath)
      back?.focus()
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

    // 行是可聚焦的（C4）：Tab 能走到，方向键在行间移动。重命名行不含它 ——
    // 那一行的焦点归输入框，Tab 从输入框直接去下一行。
    el.tabIndex = 0

    const icon = document.createElement('span')
    icon.className = 'tree-icon' + (n.type === 'dir' && expanded.has(n.path) ? ' open' : '')
    icon.innerHTML = n.type === 'dir' ? ICONS.chevron : ICONS.doc
    el.append(icon)

    const name = document.createElement('span')
    name.className = 'tree-name'
    name.textContent = n.name
    el.append(name)

    // 行尾操作区：⋮ 打开原来右键菜单的那组动作；目录额外有 + 直接新建文件。
    // hover / 选中时才浮现（CSS），平时不占视觉。
    const actions = document.createElement('span')
    actions.className = 'tree-actions'
    if (n.type === 'dir') {
      actions.append(actionButton(ICONS.plus, '新建文件', (e) => {
        e.stopPropagation()
        h.onNewFile?.(n.path)
      }))
    }
    actions.append(actionButton(ICONS.dots, '更多操作', (e) => {
      e.stopPropagation()
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      // 与原右键行为一致：文件先选中再弹菜单（目录不改变选中）
      if (n.type === 'file') { selectedPath = n.path; render() }
      h.onContext(n.type, n.path, rect.left, rect.bottom + 4)
    }))
    // 点在按钮之间的缝隙上不该被当成「点了这一行」（会开文件 / 折叠目录）
    actions.addEventListener('click', (e) => e.stopPropagation())
    el.append(actions)
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
    focusPath = path
    if (node.type === 'dir') {
      if (expanded.has(path)) expanded.delete(path)
      else expanded.add(path)
      render()
    } else {
      const previous = selectedPath
      selectedPath = path
      render()
      // 打开是异步的（要先认领编辑权），被拒绝时把高亮退回上一篇
      const result = h.onOpenFile(path)
      if (result && typeof (result as Promise<boolean>).then === 'function') {
        void (result as Promise<boolean>).then((ok) => {
          if (ok === false && selectedPath === path) { selectedPath = previous; render() }
        })
      } else if (result === false) {
        selectedPath = previous
        render()
      }
    }
  })

  container.addEventListener('dblclick', (e) => {
    const rowEl = (e.target as HTMLElement).closest<HTMLElement>('.tree-row')
    if (!rowEl || rowEl.querySelector('input')) return
    const node = find(data, rowEl.dataset.path!)
    if (node?.type === 'file') {
      e.preventDefault()
      focusPath = node.path
      startRename(node.path)
    }
  })

  // 键盘导航（C4）：↑/↓ 移动焦点、Enter 打开文件 / 折叠目录、F2 重命名。
  // 与资源管理器的行为一致。Tab / Shift+Tab 的往返不用管 —— 行是可聚焦元素，
  // 浏览器自己会走。重命名输入框里的按键已被输入框自己的监听 stopPropagation 挡下。
  container.addEventListener('keydown', (e) => {
    const rowEl = (e.target as HTMLElement).closest<HTMLElement>('.tree-row')
    if (!rowEl) return
    const path = rowEl.dataset.path!
    const node = find(data, path)
    if (!node) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const rows = [...container.querySelectorAll<HTMLElement>('.tree-row')]
      const next = rows[rows.indexOf(rowEl) + (e.key === 'ArrowDown' ? 1 : -1)]
      if (next) { focusPath = next.dataset.path!; next.focus() }
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      focusPath = path
      if (node.type === 'dir') {
        if (expanded.has(path)) expanded.delete(path)
        else expanded.add(path)
        render()
      } else {
        h.onOpenFile(path)
      }
      return
    }
    if (e.key === 'F2') {
      e.preventDefault()
      focusPath = path
      startRename(path)
    }
  })

  container.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    // 文件 / 目录的菜单已改由行尾「⋮」按钮触发；右键只保留空白处的根目录菜单
    // （新建文件 / 新建文件夹 / 在文件夹中打开）。
    const rowEl = (e.target as HTMLElement).closest<HTMLElement>('.tree-row')
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
    setData, select, ensureExpanded, clear, startRename, reveal, renameKeys,
    get selected() { return selectedPath },
    get renaming() { return renamePath !== null },
  }
}

export { basename }
