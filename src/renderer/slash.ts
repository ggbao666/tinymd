import type { Editor } from '@tiptap/core'

export interface SlashAction {
  icon: string
  title: string
  hint: string
  keywords: string[]
  run(): void
}

export interface SlashMenu {
  /** 在输入 "/" 后调用，pos 为 "/" 之后的文档位置 */
  openAt(pos: number): void
  /** 编辑器 handleKeyDown 前置拦截，返回 true 表示已消费 */
  handleKeyDown(e: KeyboardEvent): boolean
  /** 每次事务后调用：校验 / 查询文本并刷新菜单 */
  sync(): void
  close(): void
}

const GLYPH = (t: string) => `<span class="slash-glyph">${t}</span>`
const SVG = (p: string) =>
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`

const ICONS = {
  ul: SVG('<path d="M5.5 4h8M5.5 8h8M5.5 12h8"/><circle cx="2.6" cy="4" r="1" fill="currentColor" stroke="none"/><circle cx="2.6" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="2.6" cy="12" r="1" fill="currentColor" stroke="none"/>'),
  ol: SVG('<path d="M6 4h7.5M6 8h7.5M6 12h7.5"/><text x="1" y="5.6" font-size="5.4" fill="currentColor" stroke="none" font-family="ui-sans-serif">1</text><text x="1" y="9.9" font-size="5.4" fill="currentColor" stroke="none" font-family="ui-sans-serif">2</text><text x="1" y="14.2" font-size="5.4" fill="currentColor" stroke="none" font-family="ui-sans-serif">3</text>'),
  task: SVG('<rect x="2" y="2" width="5.2" height="5.2" rx="1.3"/><path d="m3.4 4.6 1.2 1.2 2-2.2"/><path d="M10 4.6h4M4.6 10.8h9.4M4.6 13.4h6"/>'),
  quote: SVG('<path fill="currentColor" stroke="none" d="M3.2 4.2c-1 .9-1.6 2-1.6 3.6 0 1.8 1.2 3 2.7 3 1.3 0 2.3-1 2.3-2.3 0-1.2-.9-2.2-2.1-2.2-.2 0-.5 0-.6.1.2-1 1-1.9 1.9-2.4L3.2 4.2Zm6.3 0c-1 .9-1.6 2-1.6 3.6 0 1.8 1.2 3 2.7 3 1.3 0 2.3-1 2.3-2.3 0-1.2-.9-2.2-2.1-2.2-.2 0-.5 0-.6.1.2-1 1-1.9 1.9-2.4L9.5 4.2Z"/>'),
  code: SVG('<rect x="1.8" y="2.5" width="12.4" height="11" rx="2"/><path d="m6.2 6.2-1.8 1.8 1.8 1.8M9.8 6.2l1.8 1.8-1.8 1.8"/>'),
  table: SVG('<rect x="1.8" y="2.5" width="12.4" height="11" rx="1.8"/><path d="M1.8 6.2h12.4M1.8 9.9h12.4M8 2.5v11"/>'),
  hr: SVG('<path d="M2 8h12"/><path d="M4.5 3.5h.01M11.5 3.5h.01M4.5 12.5h.01M11.5 12.5h.01" stroke-width="2"/>'),
  image: SVG('<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="2"/><circle cx="5.6" cy="6.4" r="1.2"/><path d="m2.5 12 3.4-3.2c.4-.4 1-.4 1.4 0L11 12.4M9.6 10.9l1.6-1.5c.4-.4 1-.4 1.4 0l1.8 1.7"/>'),
}

export function createSlashMenu(editor: Editor, actions: SlashAction[]): SlashMenu {
  let open = false
  let slashPos = -1
  let query = ''
  let active = 0

  const el = document.createElement('div')
  el.className = 'slash-menu hidden'
  document.body.appendChild(el)

  function filtered(): SlashAction[] {
    const q = query.trim().toLowerCase()
    if (!q) return actions
    return actions.filter(
      (a) => a.title.toLowerCase().includes(q) || a.keywords.some((k) => k.includes(q)),
    )
  }

  function position() {
    if (!open || slashPos < 1) return
    let coords
    try { coords = editor.view.coordsAtPos(slashPos - 1) } catch { return }
    const h = el.offsetHeight || 200
    const w = el.offsetWidth || 260
    const margin = 8
    let top = coords.bottom + 6
    if (top + h > window.innerHeight - margin) top = Math.max(margin, coords.top - h - 6)
    let left = coords.left
    left = Math.min(Math.max(margin, left), window.innerWidth - w - margin)
    el.style.top = `${top}px`
    el.style.left = `${left}px`
  }

  function render() {
    const items = filtered()
    el.innerHTML = ''
    if (!items.length) {
      const empty = document.createElement('div')
      empty.className = 'slash-empty'
      empty.textContent = '无匹配结果'
      el.append(empty)
    }
    items.forEach((it, i) => {
      const row = document.createElement('div')
      row.className = 'slash-item' + (i === active ? ' active' : '')
      const icon = document.createElement('span')
      icon.className = 'slash-icon'
      icon.innerHTML = it.icon
      const box = document.createElement('div')
      box.className = 'slash-text'
      const title = document.createElement('span')
      title.className = 'slash-title'
      title.textContent = it.title
      const hint = document.createElement('span')
      hint.className = 'slash-hint'
      hint.textContent = it.hint
      box.append(title, hint)
      row.append(icon, box)
      row.addEventListener('mouseenter', () => {
        active = i
        el.querySelectorAll('.slash-item').forEach((n, j) => n.classList.toggle('active', j === i))
      })
      row.addEventListener('mousedown', (e) => {
        e.preventDefault()
        apply(it)
      })
      el.append(row)
    })
    if (open) el.classList.remove('hidden')
    position()
    el.querySelector('.slash-item.active')?.scrollIntoView({ block: 'nearest' })
  }

  function close() {
    open = false
    slashPos = -1
    query = ''
    active = 0
    el.classList.add('hidden')
  }

  function sync() {
    if (!open) return
    const { state } = editor.view
    if (!state.selection.empty) return close()
    const from = state.selection.from
    if (slashPos < 1 || from < slashPos || from > slashPos + 24) return close()
    let ch: string
    try { ch = state.doc.textBetween(slashPos - 1, slashPos, '\n', '\ufffc') } catch { return close() }
    if (ch !== '/') return close()
    let text: string
    try { text = state.doc.textBetween(slashPos, from, '\n', '\ufffc') } catch { return close() }
    if (/\s/.test(text)) return close()
    query = text
    if (active >= filtered().length) active = 0
    render()
  }

  function apply(item: SlashAction) {
    const from = Math.max(0, slashPos - 1)
    const to = editor.state.selection.from
    editor.chain().focus().deleteRange({ from, to }).run()
    close()
    item.run()
  }

  function handleKeyDown(e: KeyboardEvent): boolean {
    if (!open) return false
    const items = filtered()
    switch (e.key) {
      case 'ArrowDown':
        if (items.length) { active = (active + 1) % items.length; render() }
        return true
      case 'ArrowUp':
        if (items.length) { active = (active - 1 + items.length) % items.length; render() }
        return true
      case 'Enter':
      case 'Tab':
        if (items[active]) apply(items[active])
        else close()
        return true
      case 'Escape':
        close()
        return true
    }
    return false
  }

  function openAt(pos: number) {
    open = true
    slashPos = pos
    query = ''
    active = 0
    queueMicrotask(() => { if (open) render() })
  }

  document.addEventListener('mousedown', (e) => {
    if (open && !el.contains(e.target as Node)) close()
  })
  document.addEventListener('scroll', () => { if (open) position() }, true)

  return { openAt, handleKeyDown, sync, close }
}

export { GLYPH as slashGlyph, ICONS as slashIcons }
