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
    // ⚠️ 懒加载的 children 要按路径**搬到新树上**。不搬的话：用户展开的几个目录会在
    // 每次 fs:changed（自动保存就会触发）之后集体退回「载入中」，展开状态看着像失效了。
    // 主进程只给一层，搬不搬是我们自己说了算 —— 搬过来的就是「已经读过」，
    // 所以展开时不会再去读一次。
    if (data.length) {
      const old = new Map<string, TreeNode[]>()
      collect(data, old)
      const carry = (list: TreeNode[]) => {
        for (const n of list) {
          const prev = old.get(n.path)
          if (n.type === 'dir' && prev) n.children = prev
          if (n.children) carry(n.children)
        }
      }
      carry(nodes)
    }
    data = nodes
    render()
  }

  /** 把树里所有已加载的目录 children 收进 map（路径 -> 子级） */
  function collect(nodes: TreeNode[], out: Map<string, TreeNode[]>) {
    for (const n of nodes) {
      if (n.type === 'dir' && n.children) {
        out.set(n.path, n.children)
        collect(n.children, out)
      }
    }
  }
  function flushPendingData() {
    if (!pendingData) return false
    // 走 setData 同一条路，才能把懒加载的 children 搬过来
    const nodes = pendingData
    pendingData = null
    setData(nodes)
    return true
  }
  function select(path: string) { selectedPath = path; if (!renamePath) render() }
  /**
   * 确保某个目录是展开的（新建文件 / 新建文件夹之后用，main.ts 的 createEntry 调）。
   * 懒加载下**不能只加标记** —— 那样目录会停在「载入中」直到用户手动点开，
   * 而新建的东西就在里面，用户当然希望直接看见。所以这里顺带把子级读出来。
   */
  function ensureExpanded(path: string) {
    const node = find(data, path)
    if (!expanded.has(path)) {
      expanded.add(path)
      if (node && !node.children) { render(); void loadChildren(node); return }
    }
    if (!renamePath) render()
  }
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
   *
   * ⚠️ 懒加载下 `children` 只有展开过的目录才有，所以这里只能找到**已加载**的行。
   * 这够用：面包屑点的是「当前打开着的这篇的所在目录」—— 它是用户自己从文件树点进来的，
   * 那一行必然已经展开可见。跨工作空间的路径本来就找不到（那不是同一个工作空间）。
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

  /**
   * 展开 / 折叠一个目录（鼠标点击与键盘 Enter 共用这一条路）。
   *
   * **懒加载**：目录节点的 children 不在数据里（主进程只读一层），
   * 第一次展开时才通过 `loadChildren` 读那一层，读完挂到节点上。
   * 折叠再展开时children 已在节点上，**不重复读**。
   *
   * 读的过程中先摆一行「载入中…」占位，免得用户以为点了没反应。
   * 失败（无权限 / 目录被删）就把这一层记成已加载的空数组，不再无限重试。
   */
  function toggleDir(node: TreeNode) {
    const path = node.path
    // ⚠️ 判断「读过没有」要问**数据树里那个节点**，而不是传进来的 node（可能是旧树的引用）
    const live = find(data, path) || node
    if (expanded.has(path)) {
      expanded.delete(path)
      render()
      return
    }
    expanded.add(path)
    if (live.children) { render(); return }   // 已读过 → 直接渲染，不重复读盘
    render()                                  // 没读过 → 先摆「载入中」占位
    void loadChildren(live)
  }

  async function loadChildren(node: TreeNode) {
    let kids: TreeNode[] = []
    try { kids = (await window.api.children(node.path)) as TreeNode[] } catch { kids = [] }
    // ⚠️ 结果必须挂到**数据树里那个节点**上，不能只挂到传进来的 node。
    // 读盘期间 fs:changed 可能触发 setData 换掉整棵树（对象全换了），那时 node
    // 已经是旧树的引用 —— 挂错地方的表现是「读完、render 也调了，DOM 却始终停在
    // 载入中」，而且只有折叠再展开才恢复（那时走的是 node.children 已存在的快路径）。
    const live = find(data, node.path) || node
    live.children = kids
    if (!expanded.has(node.path)) return   // 读的过程中用户又折叠了，别改 UI
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
        if (n.type === 'dir' && expanded.has(n.path)) {
          if (n.children) walk(n.children, depth + 1)
          // 懒加载的「读盘中」占位：读完了会被 loadChildren 里的 render() 顶掉
          else frag.append(loadingRow(depth + 1))
        }
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

  /** 懒加载的占位行：目录已展开、子级还在读 */
  function loadingRow(depth: number): HTMLElement {
    const el = document.createElement('div')
    el.className = 'tree-loading'
    el.style.setProperty('--depth', String(depth))
    el.textContent = '载入中…'
    return el
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

  /**
   * 打开文件并接住失败回退（click 与 Enter 两条路共用，E4）：先乐观选中，
   * 打开失败（被别的窗口占用 / 读取失败）时把高亮退回上一篇 —— 否则树指着
   * 的那一篇和编辑器里的并不是同一个。
   */
  function openWithFallback(path: string) {
    const previous = selectedPath
    selectedPath = path
    render()
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
      toggleDir(node)
    } else {
      // 打开是异步的（要先认领编辑权），被拒绝时 openWithFallback 负责退回高亮
      openWithFallback(path)
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
        toggleDir(node)
      } else {
        // 与鼠标点行同一条路（含失败回退），不再裸调 onOpenFile ——
        // 被别的窗口占用时乐观高亮没人退回去（E4）
        openWithFallback(path)
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
    // 重命名输入框上右键：不打断输入，什么都不弹
    const rowEl = (e.target as HTMLElement).closest<HTMLElement>('.tree-row')
    if (rowEl?.querySelector('input.tree-rename')) return
    // 右键行 = 行尾 ⋮ 按钮的同一组菜单（E2，文件先选中再弹，行为对齐按钮路径）；
    // 空白处 / 路径已失效的行才是根目录菜单（新建 / 在文件夹中打开）
    const node = rowEl ? find(data, rowEl.dataset.path!) : null
    if (!node) { h.onContext('root', '', e.clientX, e.clientY); return }
    focusPath = node.path
    if (node.type === 'file') { selectedPath = node.path; render() }
    h.onContext(node.type, node.path, e.clientX, e.clientY)
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
