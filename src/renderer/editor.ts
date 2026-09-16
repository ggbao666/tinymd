import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'
import { Placeholder } from '@tiptap/extensions'
import { Markdown } from '@tiptap/markdown'
import type { Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, Selection } from '@tiptap/pm/state'
import { resolveRel, toMediaUrl } from './util'
import { createSlashMenu, slashGlyph, slashIcons } from './slash'

export interface EditorCallbacks {
  onChange(): void
  onImageFiles(files: File[]): void
  onOpenLink(url: string): void
  onPickImage(): void
  onImageContext(x: number, y: number, src: string, displaySrc: string): void
  onTextContext(x: number, y: number): void
  onTableContext(x: number, y: number): void
}

/** 方向键遇到块级图片（两段式）：第一次选中图片（高亮可见），第二次跳到图片上/下方的文本 */
function moveCaretOverImage(editor: Editor, dir: 'up' | 'down'): boolean {
  const { state, view } = editor
  const { selection } = state

  // 已选中图片：第二次按方向键 → 跳到图片上/下方的文本
  if (selection instanceof NodeSelection && selection.node.type.name === 'image') {
    const pos = dir === 'up' ? selection.from : selection.to
    let target: Selection
    try {
      target = Selection.near(state.doc.resolve(pos), dir === 'up' ? -1 : 1)
    } catch {
      return false
    }
    if (!target || target.eq(selection)) return false
    if (target instanceof NodeSelection && target.node.type.name === 'image') return false
    view.dispatch(state.tr.setSelection(target).scrollIntoView())
    return true
  }

  if (!selection.empty) return false
  const { $from } = selection
  if ($from.depth < 1) return false
  if (dir === 'up' && $from.parentOffset !== 0) return false
  if (dir === 'down' && $from.parentOffset !== $from.parent.content.size) return false
  const edge = $from.before(1) // 深度 1 块级节点的边缘
  const $edge = state.doc.resolve(edge)
  const adj = dir === 'up' ? $edge.nodeBefore : $edge.nodeAfter
  if (!adj || adj.type.name !== 'image') return false

  // 第一次按：选中图片（.ProseMirror-selectednode 高亮可见）
  const imgPos = dir === 'up' ? edge - adj.nodeSize : edge
  view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, imgPos)).scrollIntoView())
  return true
}

/** 图片：文档内保留 Markdown 里的相对路径，渲染时解析为本地媒体 URL */
const ResolvedImage = Image.extend({
  renderHTML({ node, HTMLAttributes }) {
    const src = String(node.attrs.src || '')
    const attrs = { ...HTMLAttributes }
    if (src && !/^(https?:|app-file:|data:)/i.test(src)) attrs.src = toMediaUrl(resolveRel(currentDir, src))
    return ['img', attrs]
  },
})

let currentDir = ''
let slash: ReturnType<typeof createSlashMenu> | null = null

export function createEditor(host: HTMLElement, cb: EditorCallbacks) {
  const editor = new Editor({
    element: host,
    extensions: [
      StarterKit.configure({
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
        heading: { levels: [1, 2, 3, 4, 5, 6] },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      ResolvedImage.configure({ inline: false, allowBase64: false }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Placeholder.configure({ placeholder: '开始写点什么…' }),
      Markdown.configure({ indentation: { style: 'space', size: 2 } }),
    ],
    content: '',
    editorProps: {
      attributes: { class: 'pm-doc', spellcheck: 'false' },
      handleTextInput(view, from, _to, text) {
        if (text !== '/' || !slash) return false
        const $from = view.state.doc.resolve(from)
        if ($from.parent.type.name === 'codeBlock') return false
        const before = $from.parentOffset === 0 ? '' : $from.parent.textBetween(0, $from.parentOffset, '\n', '\ufffc')
        if ($from.parentOffset === 0 || /\s$/.test(before)) slash.openAt(from + 1)
        return false
      },
      handleKeyDown(view, event) {
        if (event.key === 'ArrowUp' && moveCaretOverImage(editor, 'up')) return true
        if (event.key === 'ArrowDown' && moveCaretOverImage(editor, 'down')) return true
        return slash ? slash.handleKeyDown(event) : false
      },
      handlePaste(_view, event) {
        const files = Array.from(event.clipboardData?.files || [])
        if (files.some((f) => f.type.startsWith('image/'))) {
          cb.onImageFiles(files)
          return true
        }
        return false
      },
      handleDrop(_view, event) {
        const files = Array.from(event.dataTransfer?.files || [])
        if (files.some((f) => f.type.startsWith('image/'))) {
          event.preventDefault()
          cb.onImageFiles(files)
          return true
        }
        return false
      },
    },
    onUpdate: () => cb.onChange(),
  })

  slash = createSlashMenu(editor, [
    { icon: slashGlyph('H1'), title: '标题 1', hint: '大节标题', keywords: ['h1', 'heading', 'biaoti', 'bt'], run: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
    { icon: slashGlyph('H2'), title: '标题 2', hint: '小节标题', keywords: ['h2', 'heading', 'biaoti', 'bt'], run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { icon: slashGlyph('H3'), title: '标题 3', hint: '次级小标题', keywords: ['h3', 'heading', 'biaoti', 'bt'], run: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
    { icon: slashIcons.ul, title: '无序列表', hint: '简单的项目符号列表', keywords: ['ul', 'bullet', 'list', 'liebiao', 'lb'], run: () => editor.chain().focus().toggleBulletList().run() },
    { icon: slashIcons.ol, title: '有序列表', hint: '带编号的列表', keywords: ['ol', 'ordered', 'number', 'list', 'liebiao'], run: () => editor.chain().focus().toggleOrderedList().run() },
    { icon: slashIcons.task, title: '任务列表', hint: '带复选框的待办事项', keywords: ['task', 'todo', 'check', 'daiban', 'rw'], run: () => editor.chain().focus().toggleTaskList().run() },
    { icon: slashIcons.quote, title: '引用', hint: '摘录或引言', keywords: ['quote', 'blockquote', 'yinyong', 'yy'], run: () => editor.chain().focus().toggleBlockquote().run() },
    { icon: slashIcons.code, title: '代码块', hint: '带语言标记的代码', keywords: ['code', 'daima', 'dm', 'fence'], run: () => editor.chain().focus().toggleCodeBlock().run() },
    { icon: slashIcons.table, title: '表格', hint: '插入 3×3 表格', keywords: ['table', 'biaoge', 'bg'], run: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { icon: slashIcons.hr, title: '分割线', hint: '视觉分隔', keywords: ['hr', 'divider', 'fengex', 'fgx'], run: () => editor.chain().focus().setHorizontalRule().run() },
    { icon: slashIcons.image, title: '图片', hint: '插入本地图片（原样存入 assets）', keywords: ['image', 'img', 'photo', 'tupian', 'tp'], run: () => cb.onPickImage() },
  ])

  editor.on('transaction', () => slash?.sync())

  // ⌘/Ctrl + 单击打开链接
  host.addEventListener('click', (e) => {
    if (!(e.metaKey || e.ctrlKey)) return
    const a = (e.target as HTMLElement).closest('a')
    if (a) {
      e.preventDefault()
      cb.onOpenLink(a.getAttribute('href') || '')
    }
  })

  // 右键图片 → 选中图片并弹出图片菜单；右键表格 → 先定位单元格再弹出编辑菜单
  host.addEventListener('contextmenu', (e) => {
    const img = (e.target as HTMLElement).closest('img')
    if (img) {
      e.preventDefault()
      // 用 DOM 元素反查文档里的图片节点，避免 posAtCoords 落到相邻段落上
      let imgPos: number | null = null
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name !== 'image') return true
        const dom = editor.view.nodeDOM(pos)
        if (dom === img || (dom instanceof HTMLElement && dom.contains(img))) {
          imgPos = pos
          return false
        }
        return true
      })
      let src = ''
      if (imgPos != null) {
        try {
          editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, imgPos)))
          const node = editor.state.doc.nodeAt(imgPos)
          if (node && node.type.name === 'image') src = String(node.attrs.src || '')
        } catch { /* 忽略定位失败 */ }
      }
      if (!src) src = img.getAttribute('src') || ''
      cb.onImageContext(e.clientX, e.clientY, src, img.getAttribute('src') || '')
      return
    }
    // 选中文本右键 → 行内格式菜单（代码块内除外，行内格式对代码块无意义）
    if (!editor.state.selection.empty) {
      const { $from } = editor.state.selection
      if ($from.parent.type.name !== 'codeBlock') {
        e.preventDefault()
        cb.onTextContext(e.clientX, e.clientY)
        return
      }
    }
    if (!editor.isActive('table')) return
    e.preventDefault()
    const coords = editor.view.posAtCoords({ left: e.clientX, top: e.clientY })
    if (coords) {
      try {
        const sel = Selection.near(editor.state.doc.resolve(coords.pos))
        editor.view.dispatch(editor.state.tr.setSelection(sel))
      } catch { /* 忽略定位失败 */ }
    }
    editor.commands.focus()
    cb.onTableContext(e.clientX, e.clientY)
  })

  return {
    el: editor.view.dom,
    open(markdown: string, fileDir: string) {
      currentDir = fileDir
      slash?.close()
      editor.commands.setContent(markdown, { contentType: 'markdown', emitUpdate: false })
      editor.view.dom.scrollTop = 0
    },
    getMarkdown(): string {
      return (editor.storage.markdown as { manager: { serialize(doc: unknown): string } }).manager.serialize(editor.state.doc.toJSON())
    },
    focus() { editor.commands.focus() },
    undo() { editor.chain().focus().undo().run() },
    redo() { editor.chain().focus().redo().run() },
    insertImage(src: string, alt: string) {
      editor.chain().focus().setImage({ src, alt }).run()
    },
    /** 删除当前选中的图片节点（右键菜单用） */
    deleteSelectedImage(): boolean {
      const sel = editor.state.selection
      if (!(sel instanceof NodeSelection) || sel.node.type.name !== 'image') return false
      editor.view.dispatch(editor.state.tr.deleteSelection().scrollIntoView())
      return true
    },
    /** 切换选中文本的行内格式（右键菜单用） */
    textMark(action: string): boolean {
      const c = editor.chain().focus()
      switch (action) {
        case 'bold': return c.toggleBold().run()
        case 'italic': return c.toggleItalic().run()
        case 'code': return c.toggleCode().run()
        case 'strike': return c.toggleStrike().run()
      }
      return false
    },
    /** 当前选中文本已激活的行内格式（用于菜单勾选态） */
    activeMarks(): string[] {
      const out: string[] = []
      if (editor.isActive('bold')) out.push('bold')
      if (editor.isActive('italic')) out.push('italic')
      if (editor.isActive('code')) out.push('code')
      if (editor.isActive('strike')) out.push('strike')
      return out
    },
    currentLink(): string | null {
      const attrs = editor.getAttributes('link') as { href?: string }
      return attrs.href ?? null
    },
    tableAction(action: string): boolean {
      const c = editor.chain().focus()
      switch (action) {
        case 'row-before': return c.addRowBefore().run()
        case 'row-after': return c.addRowAfter().run()
        case 'col-before': return c.addColumnBefore().run()
        case 'col-after': return c.addColumnAfter().run()
        case 'row-delete': return c.deleteRow().run()
        case 'col-delete': return c.deleteColumn().run()
        case 'header': return c.toggleHeaderRow().run()
        case 'table-delete': return c.deleteTable().run()
      }
      return false
    },
    setLink(href: string | null) {
      const c = editor.chain().focus().extendMarkRange('link')
      if (href) c.setLink({ href }).run()
      else c.unsetLink().run()
    },
    wordCountText(): string {
      const text = editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n', ' ')
      let cjk = 0
      const rest = text.replace(/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, () => { cjk++; return ' ' })
      const words = rest.split(/\s+/).filter(Boolean).length
      const n = cjk + words
      return n === 0 ? '' : `${n.toLocaleString('zh-Hans-CN')} 字`
    },
    isEmptyDoc(): boolean {
      return editor.isEmpty
    },
    getOutline(): { level: number; text: string; pos: number }[] {
      const out: { level: number; text: string; pos: number }[] = []
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'heading') {
          out.push({ level: node.attrs.level as number, text: node.textContent, pos })
        }
        return true
      })
      return out
    },
    revealPos(pos: number) {
      try {
        const sel = Selection.near(editor.state.doc.resolve(pos), 1)
        editor.view.dispatch(editor.state.tr.setSelection(sel).scrollIntoView())
        editor.commands.focus()
      } catch { /* 位置可能已失效 */ }
    },
    doc(): PMNode {
      return editor.state.doc
    },
    destroy() { editor.destroy() },
  }
}

export type EditorCtl = ReturnType<typeof createEditor>
