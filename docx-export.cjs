'use strict'

/**
 * ProseMirror 文档模型 → .docx
 *
 * 与 PDF 导出最大的不同：**Word 不吃 CSS**。那边可以把 style.css 原样重放进隐藏窗口，
 * 所以能做到像素一致；这里只能把文档模型「翻译」成 Word 自己的排版元素（标题样式、
 * 编号列表、表格、底纹）。因此 docx 的目标是**结构正确、能在 Word 里继续编辑**，
 * 观感接近但不保证相同。
 *
 * ⚠️ 下面所有排版数值都是从 src/renderer/style.css 的亮色主题**手抄**过来的
 * （导出与 PDF 一样固定浅色）。这是「抄一份」，不是「重放」——
 * 以后改 style.css，docx 这边**不会自动同步**，要回来改本文件的常量。
 *
 * 本文件是纯 Node 模块（不依赖 Electron），可以脱离应用单独跑测试。
 */

const fsp = require('node:fs/promises')
const path = require('node:path')

const {
  AlignmentType, BorderStyle, Document, ExternalHyperlink, Footer, HeadingLevel,
  ImageRun, LevelFormat, LineRuleType, Packer, PageNumber, Paragraph, ShadingType,
  Table, TableCell, TableRow, TableLayoutType, TextRun, UnderlineType, VerticalAlign, WidthType,
} = require('docx')

// ---------- 页面 ----------

const A4_WIDTH_DXA = 11906
const A4_HEIGHT_DXA = 16838
// 与 printToPDF 的页边距对齐：上下 0.7 英寸、左右 0.71 英寸（1 英寸 = 1440 twips）
const PAGE_MARGIN = { top: 1008, bottom: 1008, left: 1022, right: 1022 }
const CONTENT_WIDTH = A4_WIDTH_DXA - PAGE_MARGIN.left - PAGE_MARGIN.right

// ---------- 字体 ----------
// Word 里没有「字体栈」，只能给具体名字；西文与中日韩可以分开指定，
// 所以照 --font / --mono 两套栈各取两端最通用的名字。
const FONT_LATIN = process.platform === 'darwin' ? 'Helvetica Neue' : 'Segoe UI'
const FONT_CJK = process.platform === 'darwin' ? 'PingFang SC' : 'Microsoft YaHei'
const FONT_MONO = process.platform === 'darwin' ? 'Menlo' : 'Consolas'
const FONT = { ascii: FONT_LATIN, hAnsi: FONT_LATIN, eastAsia: FONT_CJK }
const FONT_CODE = { ascii: FONT_MONO, hAnsi: FONT_MONO, eastAsia: FONT_CJK }

// ---------- 字号 ----------
// docx 的字号单位是**半磅**，换算 = px × 1.5（16px = 12pt = 24）
const SIZE_BODY = 24
const SIZE_CODE = 20            // pre code { font-size: 13px }
const SIZE_INLINE_CODE = 20     // inline code { font-size: .85em } = 13.6px
const SIZE_FOOTER = 18
// h1..h6：1.85 / 1.45 / 1.2 / 1.05 / 1 / 1 em
const SIZE_HEADING = [44, 35, 29, 25, 24, 24]
const HEADING_LEVELS = [
  HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6,
]

// ---------- 颜色 ----------
// 主题里是半透明色，Word 的底纹只能是不透明色，所以这里给的是**叠在白纸上之后**的值。
const COLOR_TEXT = '26262A'
const COLOR_TEXT_2 = '6D6D74'
const COLOR_TEXT_3 = 'A5A5AC'
const COLOR_ACCENT = '0A84FF'
const COLOR_CODE_BG = 'F3F3F3'        // --code-bg      rgba(38,38,42,.055)
const COLOR_INLINE_CODE_BG = 'F1F1F1' // --inline-code-bg rgba(38,38,42,.065)
const COLOR_MARK_BG = 'FFE878'        // --mark-bg      rgba(255,214,10,.55)
const COLOR_HAIRLINE = 'E1E1E1'       // --hairline-strong rgba(38,38,42,.14)
const COLOR_TH_BG = 'ECECEA'          // --bg-sidebar

// ---------- 间距 ----------
// twips：px × 15
const GAP_BLOCK = 216        // .ProseMirror > * + * { margin-top: .9em }
const GAP_LIST = 120         // ul/ol { margin: .5em 0 }
const GAP_LIST_ITEM = 36     // li { margin: .15em 0 }
const GAP_TABLE = 240        // table { margin: 1em 0 }
const LINE_BODY = 420        // line-height 1.75
const LINE_CODE = 384        // pre  { line-height: 1.6 }
const LINE_HEADING = 324     // heading { line-height: 1.35 }
const HEADING_BEFORE = 360   // heading { margin-top: 1.5em }
const HEADING_AFTER = 96     // heading { margin-bottom: .4em }
const LIST_INDENT = 360      // 每级 0.25 英寸
const QUOTE_INDENT = 280     // blockquote { padding-left: 16px + 2.5px 边框 }
const CELL_PAD_CODE = { top: 210, bottom: 210, left: 270, right: 270 } // pre { padding: 14px 18px }
const CELL_PAD_TABLE = { top: 90, bottom: 90, left: 180, right: 180 }  // th/td { padding: 6px 12px }
const MAX_IMAGE_WIDTH = 600  // px：A4 正文宽约 657px，留点余量

const BORDER_NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
const NO_BORDERS = { top: BORDER_NONE, bottom: BORDER_NONE, left: BORDER_NONE, right: BORDER_NONE }
// size 的单位是「1/8 磅」，1px = 0.75pt = 6
const makeBorder = () => ({ style: BorderStyle.SINGLE, size: 6, color: COLOR_HAIRLINE })
const ALL_BORDERS = { top: makeBorder(), bottom: makeBorder(), left: makeBorder(), right: makeBorder() }

const BULLET_GLYPHS = ['\u2022', '\u25cb', '\u25aa'] // • ○ ▪
const CHECKBOX_ON = '\u2611 '   // ☑
const CHECKBOX_OFF = '\u2610 '  // ☐

const SPACING_BODY = { before: 0, after: GAP_BLOCK, line: LINE_BODY, lineRule: LineRuleType.AUTO }
const SPACING_LIST = { before: 0, after: GAP_LIST_ITEM, line: LINE_BODY, lineRule: LineRuleType.AUTO }

/** 列表的编号定义（markdown 的 ul/ol 都映射成 Word 的真编号，不是字面字符） */
const NUMBERING_CONFIG = [
  {
    reference: 'md-bullet',
    levels: Array.from({ length: 9 }, (_, i) => ({
      level: i,
      format: LevelFormat.BULLET,
      text: BULLET_GLYPHS[i % BULLET_GLYPHS.length],
      alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: LIST_INDENT * (i + 1), hanging: LIST_INDENT } } },
    })),
  },
  {
    reference: 'md-ordered',
    levels: Array.from({ length: 9 }, (_, i) => ({
      level: i,
      format: LevelFormat.DECIMAL,
      text: `%${i + 1}.`,
      alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: LIST_INDENT * (i + 1), hanging: LIST_INDENT } } },
    })),
  },
]

/** 段落样式：把 style.css 里的标题字号/间距抄成 Word 的 Heading1..Heading6 */
const PARAGRAPH_STYLES = [
  {
    id: 'Normal',
    name: 'Normal',
    quickFormat: true,
    run: { size: SIZE_BODY, color: COLOR_TEXT, font: FONT },
    paragraph: { spacing: SPACING_BODY },
  },
  ...SIZE_HEADING.map((size, i) => ({
    id: `Heading${i + 1}`,
    name: `Heading ${i + 1}`,
    basedOn: 'Normal',
    next: 'Normal',
    quickFormat: true,
    // outlineLevel 让导航窗格 / 目录认得这是标题
    paragraph: {
      outlineLevel: i,
      spacing: { before: HEADING_BEFORE, after: HEADING_AFTER, line: LINE_HEADING, lineRule: LineRuleType.AUTO },
      // h1 底下还有一条分隔线（style.css 的 .ProseMirror h1 { border-bottom }）
      ...(i === 0 ? { border: { bottom: makeBorder() } } : {}),
    },
    run: { size, bold: true, color: COLOR_TEXT, font: FONT },
  })),
]

// ---------- 图片：尺寸嗅探 ----------
// 不引第三方图片库：几种常见格式的宽高都在文件头里，自己读更省事。
// 顺便决定了 ImageRun.type（它是必填字段）。

function pngSize(buf) {
  return buf.length >= 24 ? { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) } : null
}

function gifSize(buf) {
  return buf.length >= 10 ? { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) } : null
}

function bmpSize(buf) {
  return buf.length >= 26
    ? { width: Math.abs(buf.readInt32LE(18)), height: Math.abs(buf.readInt32LE(22)) }
    : null
}

function jpegSize(buf) {
  // 逐段跳过，直到遇到 SOFn（真帧头），宽高在各段里是「高在前、宽在后」
  const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
  let i = 2
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i += 1; continue }
    const marker = buf[i + 1]
    // 填充字节、无长度段（RSTn / SOI / EOI）直接跳过
    if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue }
    const len = buf.readUInt16BE(i + 2)
    if (SOF.has(marker)) {
      return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) }
    }
    if (len < 2) break
    i += 2 + len
  }
  return null
}

function svgSize(text) {
  const tag = /<svg\b[^>]*>/i.exec(text)
  if (!tag) return null
  const attr = (name) => {
    const m = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tag[0])
    return m ? Number.parseFloat(m[1]) : NaN
  }
  let width = attr('width')
  let height = attr('height')
  if (!(width > 0) || !(height > 0)) {
    const viewBox = attr('viewBox')
    const box = String(viewBox || '').trim().split(/[\s,]+/).map(Number)
    if (box.length === 4 && box[2] > 0 && box[3] > 0) {
      const ratio = box[2] / box[3]
      if (width > 0) height = width / ratio
      else if (height > 0) width = height * ratio
      else { width = box[2]; height = box[3] }
    }
  }
  return width > 0 && height > 0 ? { width: Math.round(width), height: Math.round(height) } : null
}

/** 按文件头判断格式并取出宽高；不认识的格式返回 null */
function sniffImage(buf, ext) {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { type: 'png', ...(pngSize(buf) || {}) }
  }
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { type: 'jpg', ...(jpegSize(buf) || {}) }
  }
  if (buf.length > 10 && buf.subarray(0, 3).toString('latin1') === 'GIF') {
    return { type: 'gif', ...(gifSize(buf) || {}) }
  }
  if (buf.length > 26 && buf.subarray(0, 2).toString('latin1') === 'BM') {
    return { type: 'bmp', ...(bmpSize(buf) || {}) }
  }
  // SVG 是文本，没有魔数，按扩展名认
  if (ext === '.svg') {
    const text = buf.toString('utf8')
    const size = svgSize(text)
    if (size) return { type: 'svg', ...size }
    return { type: 'svg', width: 0, height: 0 }
  }
  return null
}

// ---------- 图片：取字节 ----------

const DATA_URL = /^data:([\w.+-]+\/[\w.+-]+);base64,(.*)$/s
const EXT_BY_MIME = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/bmp': '.bmp', 'image/svg+xml': '.svg' }

async function fetchRemote(url) {
  // 延迟 require：让本模块在没有 Electron 的环境里也能被引用（便于单测）
  const { net } = require('electron')
  const res = await net.fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

/**
 * 把文档里出现的图片统一取成字节。相对路径按 baseDir（文档自己的目录）解析，
 * 目录反过来正是「任意一篇 md 都能导出」的关键 —— 不能取当前打开文档的目录。
 *
 * allowPath 由调用方注入（主进程传 allowedRoots 的判定）：本模块不认识
 * Electron 的目录授权规则，也不该认识 —— 放在调用方才能和 app-file:// 用同一套标准。
 */
async function loadImage(src, baseDir, allowPath) {
  const dataUrl = DATA_URL.exec(src)
  if (dataUrl) {
    return { buf: Buffer.from(dataUrl[2], 'base64'), ext: EXT_BY_MIME[dataUrl[1].toLowerCase()] || '' }
  }
  if (/^https?:/i.test(src)) return { buf: await fetchRemote(src), ext: path.extname(new URL(src).pathname).toLowerCase() }
  // app-file:// 是编辑器渲染时才套上的媒体协议，文档模型里存的仍是相对路径；
  // 真遇到就退化成普通路径处理
  const plain = src.startsWith('app-file:') ? decodeURIComponent(new URL(src).pathname).replace(/^[/\\]/, '') : src
  const abs = path.isAbsolute(plain) ? plain : path.resolve(baseDir, decodeURIComponent(plain))
  // 只能用绝对路径做过界判定，否则 ../ 就能溜出去
  if (allowPath && !allowPath(abs)) throw new Error('图片路径不在已授权目录内')
  return { buf: await fsp.readFile(abs), ext: path.extname(abs).toLowerCase() }
}

/** 遍历文档收集图片引用（去重），逐个取字节并嗅探尺寸；失败的计入 skipped */
async function collectImages(pmDoc, baseDir, allowPath) {
  const srcs = new Set()
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'image' && node.attrs?.src) srcs.add(String(node.attrs.src))
    if (Array.isArray(node.content)) node.content.forEach(walk)
  }
  walk(pmDoc)

  const images = new Map()
  let skipped = 0
  for (const src of srcs) {
    try {
      const { buf, ext } = await loadImage(src, baseDir, allowPath)
      const info = sniffImage(buf, ext)
      // 认不出格式（webp/avif 等）时 ImageRun.type 无从填写，只能跳过
      if (!info || !(info.width > 0) || !(info.height > 0)) { skipped += 1; continue }
      images.set(src, { data: buf, ...info })
    } catch {
      skipped += 1
    }
  }
  return { images, skipped }
}

// ---------- 行内 ----------

/**
 * 行内节点 → TextRun / ExternalHyperlink。
 * 链接是个例外：它是「包住 run」的容器，所以最后要再包一层。
 */
function runsFor(nodes, ctx) {
  const out = []
  for (const node of nodes || []) {
    if (node.type === 'text') {
      out.push(runForText(String(node.text ?? ''), node.marks || [], ctx))
    } else if (node.type === 'hardBreak') {
      out.push(new TextRun({ break: 1 }))
    } else if (node.type === 'image') {
      // 行内图片少见，但 markdown 里合法：直接把图片塞进这一段的 runs
      const img = imageRun(node, ctx)
      if (img) out.push(img)
    } else if (Array.isArray(node.content)) {
      out.push(...runsFor(node.content, ctx))
    }
  }
  return out
}

function runForText(text, marks, ctx) {
  const opts = { text }
  let link = null
  for (const mark of marks) {
    switch (mark.type) {
      case 'bold':
        opts.bold = true
        break
      case 'italic':
        opts.italics = true
        break
      case 'strike':
        opts.strike = true
        break
      case 'underline':
        opts.underline = { type: UnderlineType.SINGLE }
        break
      case 'code':
        opts.font = FONT_CODE
        opts.size = SIZE_INLINE_CODE
        opts.color = COLOR_TEXT
        opts.shading = { type: ShadingType.CLEAR, fill: COLOR_INLINE_CODE_BG }
        break
      case 'highlight':
        // 用 shading 而不是 Word 的 highlight：highlight 只认十来个固定色名，
        // 而主题给的是具体色值，shading 才能照抄过来
        opts.shading = { type: ShadingType.CLEAR, fill: highlightFill(mark.attrs) }
        break
      case 'link':
        link = String(mark.attrs?.href || '')
        break
      default:
        break
    }
  }
  // 引用块里整段是灰斜体（style.css: blockquote { color: var(--text-2) }）
  if (ctx.quote) {
    opts.italics = true
    opts.color = COLOR_TEXT_2
  }
  const run = new TextRun(opts)
  return link ? new ExternalHyperlink({ children: [run], link }) : run
}

/** ==高亮== 的底色：默认用主题色，带色值时把它当十六进制色用 */
function highlightFill(attrs) {
  const raw = String(attrs?.color || '')
  const hex = /^#?([0-9a-f]{6})$/i.exec(raw)
  if (hex) return hex[1].toUpperCase()
  if (/^#?[0-9a-f]{3}$/i.test(raw)) {
    const [r, g, b] = raw.replace('#', '').split('')
    return `${r}${r}${g}${g}${b}${b}`.toUpperCase()
  }
  return COLOR_MARK_BG
}

// ---------- 块级 ----------

function imageRun(node, ctx) {
  const src = String(node.attrs?.src || '')
  const info = ctx.images.get(src)
  if (!info) return null // 取不到字节的图片在 collectImages 里已计数，这里静默跳过
  // 等比缩到正文宽度以内
  const scale = info.width > MAX_IMAGE_WIDTH ? MAX_IMAGE_WIDTH / info.width : 1
  const width = Math.max(1, Math.round(info.width * scale))
  const height = Math.max(1, Math.round(info.height * scale))
  return new ImageRun({
    type: info.type,
    data: info.data,
    transformation: { width, height },
    altText: { title: '图片', description: String(node.attrs?.alt || '文档插图'), name: 'image' },
  })
}

function imageParagraph(node, ctx) {
  const run = imageRun(node, ctx)
  if (!run) return null
  return new Paragraph({ children: [run], spacing: { before: 0, after: GAP_BLOCK } })
}

/** 代码块：用「单元格底纹」而不是段落底纹 —— 段落底纹在多行之间会留缝，拼不成一个整块 */
function codeBlockTable(node, ctx) {
  const text = (node.content || [])
    .map((child) => (child.type === 'text' ? String(child.text ?? '') : ''))
    .join('')
  const lines = text.split('\n')
  if (lines.length === 0) lines.push('')
  // 语言角标不落到 docx：它和 PDF 那边一样属于编辑器 UI，不是文档内容
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [CONTENT_WIDTH],
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: CONTENT_WIDTH, type: WidthType.DXA },
            borders: NO_BORDERS,
            shading: { type: ShadingType.CLEAR, fill: COLOR_CODE_BG },
            margins: CELL_PAD_CODE,
            children: lines.map((line) => new Paragraph({
              spacing: { before: 0, after: 0, line: LINE_CODE, lineRule: LineRuleType.AUTO },
              children: [new TextRun({ text: line, font: FONT_CODE, size: SIZE_CODE, color: COLOR_TEXT })],
            })),
          }),
        ],
      }),
    ],
  })
}

function quoteParagraph(node, ctx) {
  return new Paragraph({
    children: runsFor(node.content, ctx),
    spacing: { before: 0, after: GAP_BLOCK, line: LINE_BODY, lineRule: LineRuleType.AUTO },
    indent: { left: QUOTE_INDENT },
    border: { left: { style: BorderStyle.SINGLE, size: 15, color: COLOR_HAIRLINE, space: 8 } },
  })
}

function mapTable(node, ctx) {
  const rows = node.content || []
  const columnCount = Math.max(1, ...rows.map((r) => (r.content || []).length))
  const base = Math.floor(CONTENT_WIDTH / columnCount)
  const columnWidths = new Array(columnCount).fill(base)
  columnWidths[columnCount - 1] += CONTENT_WIDTH - base * columnCount // 余数补进最后一列

  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths,
    layout: TableLayoutType.FIXED,
    rows: rows.map((row) => new TableRow({
      children: (row.content || []).map((cell, i) => {
        const isHeader = cell.type === 'tableHeader'
        const kids = mapBlocks(cell.content || [], ctx, 0)
        return new TableCell({
          width: { size: columnWidths[i] ?? base, type: WidthType.DXA },
          borders: ALL_BORDERS,
          margins: CELL_PAD_TABLE,
          verticalAlign: VerticalAlign.TOP,
          ...(isHeader ? { shading: { type: ShadingType.CLEAR, fill: COLOR_TH_BG } } : {}),
          // 单元格至少要有 1 个段落，否则 Word 认为文件损坏
          children: kids.length ? kids : [new Paragraph({ children: [] })],
        })
      }),
    })),
  })
}

/** 列表项：第一段挂编号，嵌进项里的子列表递归下去（层级用 level 表示） */
function listItems(listNode, ctx, level, reference) {
  const out = []
  const clamped = Math.min(level, 8)
  for (const item of listNode.content || []) {
    let numbered = false
    for (const child of item.content || []) {
      if (child.type === 'paragraph' && !numbered) {
        out.push(new Paragraph({
          numbering: { reference, level: clamped },
          children: runsFor(child.content, ctx),
          spacing: { ...SPACING_LIST, before: out.length === 0 ? GAP_LIST : 0 },
        }))
        numbered = true
      } else if (child.type === 'bulletList' || child.type === 'orderedList') {
        out.push(...listItems(child, ctx, level + 1, child.type === 'bulletList' ? 'md-bullet' : 'md-ordered'))
      } else if (child.type === 'taskList') {
        out.push(...taskItems(child, ctx, level + 1))
      } else {
        out.push(...mapBlocks([child], ctx, level + 1))
      }
    }
    if (!numbered) {
      out.push(new Paragraph({
        numbering: { reference, level: clamped },
        children: [],
        spacing: { ...SPACING_LIST, before: out.length === 0 ? GAP_LIST : 0 },
      }))
    }
  }
  return out
}

/**
 * 任务项：Word 没有「可勾选但只是标记」的编号，所以用 ☐ / ☑ 前缀。
 * 这是这一版唯一用字面字符代替结构的地方，其余列表都走真编号。
 */
function taskItems(listNode, ctx, level) {
  const indent = { left: LIST_INDENT * (level + 1), hanging: 0 }
  const out = []
  for (const item of listNode.content || []) {
    const box = new TextRun({ text: item.attrs?.checked === true ? CHECKBOX_ON : CHECKBOX_OFF })
    let done = false
    for (const child of item.content || []) {
      if (child.type === 'paragraph' && !done) {
        out.push(new Paragraph({ children: [box, ...runsFor(child.content, ctx)], indent, spacing: SPACING_LIST }))
        done = true
      } else if (child.type === 'taskList') {
        out.push(...taskItems(child, ctx, level + 1))
      } else {
        out.push(...mapBlocks([child], ctx, level + 1))
      }
    }
    if (!done) out.push(new Paragraph({ children: [box], indent, spacing: SPACING_LIST }))
  }
  return out
}

/** 块级分派。每次调用都会 push 到 out，方便列表这种「一个节点出多个块」的情况。 */
function pushBlock(out, node, ctx, level) {
  switch (node.type) {
    case 'paragraph':
      out.push(ctx.quote ? quoteParagraph(node, ctx) : new Paragraph({
        children: runsFor(node.content, ctx),
        spacing: SPACING_BODY,
      }))
      break

    case 'heading': {
      const depth = Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 6)
      out.push(new Paragraph({
        heading: HEADING_LEVELS[depth - 1],
        children: runsFor(node.content, ctx),
      }))
      break
    }

    case 'bulletList':
      out.push(...listItems(node, ctx, level, 'md-bullet'))
      break

    case 'orderedList':
      out.push(...listItems(node, ctx, level, 'md-ordered'))
      break

    case 'taskList':
      out.push(...taskItems(node, ctx, level))
      break

    case 'blockquote':
      out.push(...mapBlocks(node.content || [], { ...ctx, quote: true }, level))
      break

    case 'codeBlock':
      out.push(codeBlockTable(node, ctx))
      break

    case 'horizontalRule':
      out.push(new Paragraph({
        children: [],
        spacing: { before: GAP_BLOCK, after: GAP_BLOCK },
        border: { bottom: makeBorder() },
      }))
      break

    case 'image': {
      const p = imageParagraph(node, ctx)
      if (p) out.push(p)
      break
    }

    case 'table':
      out.push(mapTable(node, ctx))
      break

    case 'hardBreak':
      out.push(new Paragraph({ children: [new TextRun({ break: 1 })] }))
      break

    default:
      // 不认识的节点：有子节点就往下走，避免整块内容凭空消失
      if (Array.isArray(node.content)) out.push(...mapBlocks(node.content, ctx, level))
      break
  }
}

function mapBlocks(nodes, ctx, level) {
  const out = []
  for (const node of nodes || []) pushBlock(out, node, ctx, level)
  return out
}

// ---------- 组装 ----------

function buildStyles() {
  return {
    default: {
      document: {
        run: { size: SIZE_BODY, color: COLOR_TEXT, font: FONT },
        paragraph: { spacing: SPACING_BODY },
      },
    },
    paragraphStyles: PARAGRAPH_STYLES,
  }
}

function buildFooter() {
  const run = (child) => new TextRun({ children: [child], size: SIZE_FOOTER, color: COLOR_TEXT_3, font: FONT })
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          run(PageNumber.CURRENT),
          new TextRun({ text: ' / ', size: SIZE_FOOTER, color: COLOR_TEXT_3, font: FONT }),
          run(PageNumber.TOTAL_PAGES),
        ],
      }),
    ],
  })
}

/**
 * 把 ProseMirror 文档模型转成 docx。
 *
 * @param {object} pmDoc   编辑器模型的 JSON（editor.getJSON()，形如 { type: 'doc', content: [...] }）
 * @param {string} baseDir 文档所在目录 —— 相对图片路径按它解析，必须是**目标文档**的目录
 * @param {object} [options]
 * @param {string} [options.title]     写入 docx 核心属性的标题
 * @param {(abs: string) => boolean} [options.allowPath] 图片绝对路径的准入判定（越界的按跳过计数）
 * @returns {Promise<{ buffer: Buffer, skippedImages: number }>}
 */
async function buildDocx(pmDoc, baseDir, options = {}) {
  const { images, skipped } = await collectImages(pmDoc, baseDir, options.allowPath)
  const ctx = { images, quote: false }
  const children = mapBlocks(pmDoc?.content || [], ctx, 0)

  const doc = new Document({
    title: String(options.title || 'document'),
    creator: 'tinymd',
    description: '由 tinymd 导出',
    numbering: { config: NUMBERING_CONFIG },
    styles: buildStyles(),
    sections: [
      {
        properties: {
          page: { size: { width: A4_WIDTH_DXA, height: A4_HEIGHT_DXA }, margin: PAGE_MARGIN },
        },
        footers: { default: buildFooter() },
        // 空文档也要有一个段落，否则 Word 打开会报内容损坏
        children: children.length ? children : [new Paragraph({ children: [] })],
      },
    ],
  })

  return { buffer: await Packer.toBuffer(doc), skippedImages: skipped }
}

module.exports = { buildDocx }
