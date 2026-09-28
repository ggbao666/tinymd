import { Editor, Extension, mergeAttributes } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { common, createLowlight } from 'lowlight'
import Image from '@tiptap/extension-image'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Highlight } from '@tiptap/extension-highlight'
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'
import { BubbleMenu } from '@tiptap/extension-bubble-menu'
import { Placeholder } from '@tiptap/extensions'
import { Markdown } from '@tiptap/markdown'
import type { Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, Selection } from '@tiptap/pm/state'
import { normalizeMarkdownImagePaths, resolveRel, toMediaUrl } from './util'
import { createSlashMenu, slashGlyph, slashIcons } from './slash'
import { createCodeLangMenu } from './code-lang'

export interface EditorCallbacks {
  onChange(): void
  onImageFiles(files: File[]): void
  onRemoteImages(urls: string[]): void
  onOpenLink(url: string): void
  onPickImage(): void
  onViewImage(src: string, displaySrc: string): void
  onImageContext(x: number, y: number, src: string, displaySrc: string): void
  onTextContext(x: number, y: number): void
  onTableContext(x: number, y: number): void
  /** 气泡菜单点「链接」→ 打开链接编辑浮层 */
  onRequestLink(): void
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

/** lowlight 实例（common 语言子集，约 40 种常用语言） */
const lowlight = createLowlight(common)

// 默认纯文本：没指定语言时 lowlight 会走 highlightAuto 自动猜语言并着色（经常猜错），
// 这里屏蔽掉，未指定 / 未注册语言的代码块一律按纯文本渲染。
Object.defineProperty(lowlight, 'highlightAuto', {
  value: () => ({ type: 'root', children: [] }),
})

/**
 * 语言角标：Tiptap 的 language 属性是 rendered:false，不会输出 data-language，
 * 这里覆盖 renderHTML 补上，右上角角标才能显示（无语言时不输出，由 CSS 出「选择语言」提示）。
 */
const CodeBlockLangBadge = CodeBlockLowlight.extend({
  renderHTML({ node, HTMLAttributes }) {
    const lang = node.attrs.language ? String(node.attrs.language) : ''
    return [
      'pre',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, lang ? { 'data-language': lang } : {}),
      ['code', { class: lang ? this.options.languageClassPrefix + lang : null }, 0],
    ]
  },
})

/**
 * 代码块起始位置的退格规则：
 * - 非空时吞掉 Backspace，避免代码块与前一段合并或在文档开头被转成段落。
 * - 只有代码块完全为空（只剩唯一空行）时，才退出代码块。
 */
const CodeBlockBackspace = Extension.create({
  name: 'codeBlockBackspace',
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const { empty, $anchor } = this.editor.state.selection
        if (!empty || $anchor.parent.type.name !== 'codeBlock' || $anchor.parentOffset !== 0) return false
        if (!$anchor.parent.textContent.length) return this.editor.commands.clearNodes()
        return true
      },
    }
  },
})

export function createEditor(host: HTMLElement, cb: EditorCallbacks) {
  // 气泡菜单元素在 index.html 中静态声明；显隐由插件用 visibility 控制，
  // 必须摘掉 hidden class（display:none 会永久压制插件）
  const bubbleEl = document.getElementById('bubble-menu') as HTMLElement
  bubbleEl.classList.remove('hidden')

  const editor = new Editor({
    element: host,
    extensions: [
      StarterKit.configure({
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        // 换成 lowlight 版代码块（语法高亮），语言角标 data-language 行为不变
        codeBlock: false,
      }),
      // ==高亮==：StarterKit 不含，需单独注册。
      // 该扩展自带 ==文本== 的输入规则、粘贴规则、Mod-Shift-h 快捷键，
      // 以及 markdownTokenizer + parse/renderMarkdown，读写 .md 时能原样往返。
      Highlight,
      CodeBlockLangBadge.configure({ lowlight }),
      CodeBlockBackspace,
      TaskList,
      TaskItem.configure({ nested: true }),
      ResolvedImage.configure({ inline: false, allowBase64: false }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Placeholder.configure({ placeholder: '开始写点什么…' }),
      Markdown.configure({ indentation: { style: 'space', size: 2 } }),
      BubbleMenu.configure({
        element: bubbleEl,
        shouldShow: ({ state, view }) => {
          // 空选区不弹；代码块内行内格式无意义也不弹；
          // 点选图片等产生的是节点选区（NodeSelection），格式按钮无意义，同样不弹
          if (state.selection.empty || !view.hasFocus()) return false
          if (state.selection instanceof NodeSelection) return false
          return state.selection.$from.parent.type.name !== 'codeBlock'
        },
        options: { placement: 'top', offset: 8 },
      }),
    ],
    content: '',
    editorProps: {
      attributes: { class: 'pm-doc', spellcheck: 'false' },
      handleTextInput(view, from, to, text) {
        if (text !== '/' || !slash) return false
        const $from = view.state.doc.resolve(from)
        if ($from.parent.type.name === 'codeBlock') return false
        const before = $from.parentOffset === 0 ? '' : $from.parent.textBetween(0, $from.parentOffset, '\n', '\ufffc')
        if ($from.parentOffset === 0 || /\s$/.test(before)) {
          // 主动提交输入事务，避免鼠标重新定位后原生输入与菜单打开存在时序差异。
          view.dispatch(view.state.tr.insertText(text, from, to).scrollIntoView())
          slash.openAt(from + text.length)
          return true
        }
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
    onUpdate: () => {
      cb.onChange()
      const urls: string[] = []
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'image' && /^https?:\/\//i.test(String(node.attrs.src || ''))) {
          urls.push(String(node.attrs.src))
        }
        return true
      })
      if (urls.length) cb.onRemoteImages([...new Set(urls)])
    },
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

  const langMenu = createCodeLangMenu(editor)

  editor.on('transaction', () => {
    slash?.sync()
    // 气泡菜单按钮勾选态跟随当前选区的格式
    for (const btn of bubbleEl.querySelectorAll<HTMLButtonElement>('button[data-bubble]')) {
      const mark = btn.dataset.bubble!
      btn.classList.toggle('active', mark !== 'link' && editor.isActive(mark))
    }
  })

  bubbleEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-bubble]')
    if (!btn) return
    const action = btn.dataset.bubble!
    if (action === 'link') {
      cb.onRequestLink()
      return
    }
    const c = editor.chain().focus()
    if (action === 'bold') c.toggleBold().run()
    else if (action === 'italic') c.toggleItalic().run()
    else if (action === 'code') c.toggleCode().run()
    else if (action === 'strike') c.toggleStrike().run()
    else if (action === 'highlight') c.toggleHighlight().run()
  })

  // 点代码块右上角语言角标 → 弹出语言菜单（角标是 ::after 伪元素，按命中区域判断）
  host.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return
    const pre = (e.target as HTMLElement).closest('pre')
    if (!pre) return
    const r = pre.getBoundingClientRect()
    if (e.clientX < r.right - 130 || e.clientX > r.right - 4) return
    if (e.clientY < r.top || e.clientY > r.top + 26) return
    e.preventDefault()
    // 阻止冒泡，否则 document 上的关闭监听会立刻把菜单关掉
    e.stopPropagation()
    langMenu.openAt(e.clientX, e.clientY)
  })

  // ⌘/Ctrl + 单击打开链接
  host.addEventListener('click', (e) => {
    if (!(e.metaKey || e.ctrlKey)) return
    const a = (e.target as HTMLElement).closest('a')
    if (a) {
      e.preventDefault()
      cb.onOpenLink(a.getAttribute('href') || '')
    }
  })

  // 悬停链接时浮出完整地址。地址只用于展示，不写入文档属性，
  // 因此不会影响导出 Markdown 时的链接语法。
  const linkTip = document.createElement('div')
  linkTip.className = 'link-tip hidden'
  document.body.appendChild(linkTip)

  const hideLinkTip = () => linkTip.classList.add('hidden')

  const showLinkTip = (a: HTMLAnchorElement) => {
    const href = a.getAttribute('href') || ''
    if (!href) return
    linkTip.textContent = href
    // 先去掉 hidden 再量尺寸，否则量到的是 0
    linkTip.classList.remove('hidden')
    const r = a.getBoundingClientRect()
    const t = linkTip.getBoundingClientRect()
    const gap = 6
    // 默认浮在链接上方：鼠标光标就在链接附近，放下方会被光标/指针挡住
    // 上方空间不足（贴近窗口顶部）时才退回下方
    let top = r.top - t.height - gap
    if (top < 8) top = r.bottom + gap
    // 水平夹取在窗口内，避免超长地址被截到屏幕外
    let left = r.left
    if (left + t.width > window.innerWidth - 8) left = window.innerWidth - t.width - 8
    if (left < 8) left = 8
    linkTip.style.top = `${Math.max(8, top)}px`
    linkTip.style.left = `${left}px`
  }

  host.addEventListener('mouseover', (e) => {
    const a = (e.target as HTMLElement).closest('a')
    if (a) showLinkTip(a as HTMLAnchorElement)
    else hideLinkTip()
  })
  host.addEventListener('mouseleave', hideLinkTip)
  // 捕获阶段监听：任何滚动容器滚动都收起提示，避免浮层与链接脱节
  window.addEventListener('scroll', hideLinkTip, true)

  // 双击图片是右键菜单“查看图片”的快捷方式
  host.addEventListener('dblclick', (e) => {
    const img = (e.target as HTMLElement).closest('img')
    if (!img) return
    e.preventDefault()

    let src = ''
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'image') return true
      const dom = editor.view.nodeDOM(pos)
      if (dom === img || (dom instanceof HTMLElement && dom.contains(img))) {
        src = String(node.attrs.src || '')
        return false
      }
      return true
    })

    const displaySrc = img.getAttribute('src') || ''
    if (displaySrc) cb.onViewImage(src, displaySrc)
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
      langMenu.close()
      editor.commands.setContent(normalizeMarkdownImagePaths(markdown), { contentType: 'markdown', emitUpdate: false })
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
    remoteImageSources(): string[] {
      const urls: string[] = []
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'image' && /^https?:\/\//i.test(String(node.attrs.src || ''))) {
          urls.push(String(node.attrs.src))
        }
        return true
      })
      return [...new Set(urls)]
    },
    replaceImageSource(from: string, to: string): boolean {
      let changed = false
      let tr = editor.state.tr
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name !== 'image' || String(node.attrs.src || '') !== from) return true
        tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: to })
        changed = true
        return true
      })
      if (changed) editor.view.dispatch(tr)
      return changed
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
        case 'highlight': return c.toggleHighlight().run()
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
      if (editor.isActive('highlight')) out.push('highlight')
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
        editor.view.dispatch(editor.state.tr.setSelection(sel))
        editor.commands.focus()
        // 大纲定位：把目标标题滚到编辑区偏上位置(留 ~96px 呼吸空间)，
        // 而不是 scrollIntoView 的最小滚动(会让目标贴到底部)
        requestAnimationFrame(() => {
          const dom = editor.view.domAtPos(sel.from)
          const node = dom.node.nodeType === 1 ? (dom.node as Element) : dom.node.parentElement
          const el = node?.closest('h1,h2,h3,h4,h5,h6,p,li,img') || node
          const wrap = editor.view.dom.closest('#editor-wrap') as HTMLElement | null
          if (el && wrap) {
            const target = el.getBoundingClientRect().top - wrap.getBoundingClientRect().top + wrap.scrollTop - 96
            wrap.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
          }
        })
      } catch { /* 位置可能已失效 */ }
    },
    doc(): PMNode {
      return editor.state.doc
    },
    destroy() { langMenu.close(); slash?.close(); editor.destroy() },
  }
}

export type EditorCtl = ReturnType<typeof createEditor>
