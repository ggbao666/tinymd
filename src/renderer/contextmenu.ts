import type { PopupItem } from './util'

/**
 * 紧凑的 HTML 右键菜单，替代原生菜单：
 * 间距更小，且完全跟随应用主题（原生菜单只认系统主题）。
 */
export function showContextMenu(items: (PopupItem | '-')[], x: number, y: number): Promise<string | null> {
  return new Promise((resolve) => {
    let cleanup = () => {}
    const finish = (id: string | null) => {
      cleanup()
      resolve(id)
    }

    const menu = document.createElement('div')
    menu.className = 'ctx-menu'

    for (const it of items) {
      if (it === '-') {
        const sep = document.createElement('div')
        sep.className = 'ctx-sep'
        menu.append(sep)
        continue
      }
      const row = document.createElement('div')
      row.className = 'ctx-item' + (it.enabled === false ? ' disabled' : '')
      row.textContent = it.label ?? ''
      if (it.hint) {
        const hint = document.createElement('span')
        hint.className = 'ctx-hint'
        hint.textContent = it.hint
        row.append(hint)
      }
      if (it.enabled !== false) {
        row.addEventListener('mousedown', (e) => {
          e.preventDefault()
          e.stopPropagation()
          finish(it.id ?? null)
        })
      }
      menu.append(row)
    }

    const onDown = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) {
        e.preventDefault()
        finish(null)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish(null)
    }
    const onScroll = () => finish(null)
    const onBlur = () => finish(null)
    cleanup = () => {
      menu.remove()
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('blur', onBlur)
    }

    document.body.append(menu)
    // 溢出时向上 / 向左翻转
    const rect = menu.getBoundingClientRect()
    const w = rect.width || 168
    const h = rect.height || 40
    let left = x
    let top = y
    if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8
    if (top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - h - 8)
    menu.style.left = `${Math.max(8, left)}px`
    menu.style.top = `${Math.max(8, top)}px`

    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('blur', onBlur)
  })
}
