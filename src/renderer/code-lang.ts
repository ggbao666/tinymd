import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'

/** 菜单项：[显示名, 语言值]，空串表示「纯文本」（清除语言，不做高亮） */
const LANGS: [string, string][] = [
  ['纯文本', ''],
  ['JavaScript', 'javascript'],
  ['TypeScript', 'typescript'],
  ['Python', 'python'],
  ['Bash / Shell', 'bash'],
  ['JSON', 'json'],
  ['HTML', 'html'],
  ['CSS', 'css'],
  ['Markdown', 'markdown'],
  ['SQL', 'sql'],
  ['YAML', 'yaml'],
  ['Go', 'go'],
  ['Rust', 'rust'],
  ['Java', 'java'],
]

export interface CodeLangMenu {
  /** 在鼠标位置打开；命中不到代码块则什么都不做 */
  openAt(x: number, y: number): void
  close(): void
}

/** 代码块语言选择菜单：点右上角语言角标弹出，选中即写回 node 的 language 属性 */
export function createCodeLangMenu(editor: Editor): CodeLangMenu {
  const el = document.createElement('div')
  el.className = 'lang-menu hidden'
  document.body.appendChild(el)

  let target: { pos: number; node: PMNode } | null = null

  /** 由文档位置向上找到所属代码块 */
  function codeBlockAt(pos: number) {
    const $pos = editor.state.doc.resolve(pos)
    for (let d = $pos.depth; d > 0; d--) {
      const node = $pos.node(d)
      if (node.type.name === 'codeBlock') return { pos: $pos.before(d), node }
    }
    return null
  }

  function close() {
    target = null
    el.classList.add('hidden')
  }

  function apply(value: string) {
    if (!target) return
    const { pos, node } = target
    editor
      .chain()
      .focus()
      .command(({ tr, dispatch }) => {
        if (dispatch) tr.setNodeMarkup(pos, undefined, { ...node.attrs, language: value || null })
        return true
      })
      .run()
    close()
  }

  function render() {
    const current = target ? String(target.node.attrs.language || '') : ''
    el.innerHTML = ''
    for (const [label, value] of LANGS) {
      const row = document.createElement('div')
      row.className = 'lang-item' + (value === current ? ' on' : '')
      row.textContent = label
      row.addEventListener('mousedown', (e) => {
        e.preventDefault()
        apply(value)
      })
      el.append(row)
    }
  }

  function openAt(x: number, y: number) {
    const coords = editor.view.posAtCoords({ left: x, top: y })
    const found = coords ? codeBlockAt(coords.pos) : null
    if (!found) return
    target = found
    render()
    el.classList.remove('hidden')
    const w = el.offsetWidth || 150
    const h = el.offsetHeight || 240
    const margin = 8
    let top = y + 6
    if (top + h > window.innerHeight - margin) top = Math.max(margin, y - h - 6)
    el.style.top = `${top}px`
    el.style.left = `${Math.min(Math.max(margin, x - 24), window.innerWidth - w - margin)}px`
  }

  document.addEventListener('mousedown', (e) => {
    if (target && !el.contains(e.target as Node)) close()
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close()
  })
  document.addEventListener('scroll', (e) => {
    // 菜单自身滚动（条目多出滚动条）不算外部滚动，否则一拖滚动条菜单就消失了
    if (target && !el.contains(e.target as Node)) close()
  }, true)
  window.addEventListener('resize', () => { if (target) close() })

  return { openAt, close }
}
