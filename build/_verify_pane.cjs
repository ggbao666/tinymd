/* 验证：侧栏两页互斥 + 底栏合并为整窗一条 + 两栏布局
   覆盖主窗口/单文件/空状态/纯文本四种形态，两套主题 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { app, BrowserWindow, dialog } = require('electron')

const ROOT = path.resolve(__dirname, '..')
const SHOT = path.join(__dirname, '_shots')
fs.mkdirSync(SHOT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const js = (w, code) => w.webContents.executeJavaScript(code)

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tinymd_pane_'))
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu')
app.disableHardwareAcceleration()
app.setPath('userData', path.join(TMP, 'user-data'))
dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] })
require(path.join(ROOT, 'main.js'))

const rec = []
const ok = (name, pass, detail) => {
  rec.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail === undefined ? '' : JSON.stringify(detail)}`)
}

const probe = `(() => {
  const R = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return {x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), r: Math.round(b.right), b: Math.round(b.bottom)} }
  const vis = (s) => { const e = document.querySelector(s); if (!e) return null; return getComputedStyle(e).display !== 'none' }
  const sb = document.querySelector('#statusbar')
  const path = document.querySelector('#ws-path')
  return {
    win: { w: innerWidth, h: innerHeight },
    cls: document.body.className,
    topbar: R('#topbar'), sidebar: R('#sidebar'), content: R('#content'), statusbar: R('#statusbar'),
    head: R('.sidebar-head'), tabs: R('.sidebar-head-tabs'), acts: R('.sidebar-head-actions'),
    tree: R('#tree'), outline: R('#outline'),
    treeVis: vis('#tree'), outlineVis: vis('#outline'),
    headVis: vis('.sidebar-head'),
    items: document.querySelectorAll('.outline-item').length,
    active: document.querySelectorAll('.outline-item.active').length,
    tabFiles: (() => { const e = document.querySelector('#tab-files'); return {active: e.classList.contains('active'), sel: e.getAttribute('aria-selected')} })(),
    tabOutline: (() => { const e = document.querySelector('#tab-outline'); return {active: e.classList.contains('active'), sel: e.getAttribute('aria-selected'), disabled: e.disabled} })(),
    pathText: path ? path.textContent : null,
    pathTitle: path ? path.title : null,
    statusText: (document.querySelector('#status')||{}).textContent,
    countText: (document.querySelector('#count')||{}).textContent,
    // 状态栏三段是否真的在同一行、顺序正确。
    // ⚠️ 断言「同一行」不能比 y 的**绝对值** —— 三段各自的行高不同
    // （路径段是块级、有 ellipsis；状态/字数是行内），比的是**中线**是否齐平。
    sbOrder: (() => {
      const mid = (e) => { const r = e.getBoundingClientRect(); return Math.round(r.y + r.height / 2) }
      const a = document.querySelector('.statusbar-path').getBoundingClientRect()
      const b = document.querySelector('.statusbar-status').getBoundingClientRect()
      const c = document.querySelector('.statusbar-count').getBoundingClientRect()
      return {
        midA: mid(document.querySelector('.statusbar-path')),
        midB: mid(document.querySelector('.statusbar-status')),
        midC: mid(document.querySelector('.statusbar-count')),
        left: Math.round(a.x), mid: Math.round(b.x), right: Math.round(c.x),
        sbRight: Math.round(sb.getBoundingClientRect().right), cRight: Math.round(c.right),
      }
    })(),
    // 正文列宽（折算每行汉字，16px 正文字号）
    pmW: (() => { const e = document.querySelector('.ProseMirror'); return e ? Math.round(e.getBoundingClientRect().width) : null })(),
    // 正文宽度 = 内容区 − 滚动条槽（scrollbar-gutter 预留）− 左右留白各 20
    sbw: (() => { const e = document.querySelector('#editor-wrap'); return e ? Math.round(e.getBoundingClientRect().width - e.clientWidth) : 0 })(),
    contentPad: (() => { const e = document.querySelector('#editor'); return e ? parseFloat(getComputedStyle(e).paddingLeft) : null })(),
    pmLeft: (() => { const e = document.querySelector('.ProseMirror'); return e ? Math.round(e.getBoundingClientRect().x) : null })(),
    padL: (() => { const e = document.querySelector('#editor'); return e ? getComputedStyle(e).paddingLeft : null })(),
    tocGone: document.getElementById('toc-float') === null && document.getElementById('toc-float-list') === null && document.getElementById('status-pill') === null,
  }
})()`

app.whenReady().then(async () => {
  let W = null
  for (let i = 0; i < 60 && !W; i++) {
    await sleep(150)
    W = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html')) || null
  }
  if (!W) { console.error('no window'); app.exit(1); return }
  await new Promise((res) => { if (W.webContents.isLoading()) W.webContents.once('did-finish-load', res); else res() })
  await sleep(600)

  const WS = path.join(TMP, '我的项目')
  fs.mkdirSync(WS, { recursive: true })
  fs.writeFileSync(path.join(WS, '产品需求文档.md'), [
    '# 产品需求文档', '', '这是第一段正文。'.repeat(10), '',
    '## 一、背景', '', '第二段。', '',
    '## 二、功能列表', '', '1. 第一项', '',
    '### 2.1 细节', '', '正文。', '',
    '## 三、接口定义', '', '正文。', '',
    '## 四、数据对照', '', '正文。',
  ].join('\n'))
  fs.writeFileSync(path.join(WS, '会议纪要.md'), '# 会议纪要\n\n内容\n')

  await js(W, `localStorage.setItem('jianmo.recents', ${JSON.stringify(JSON.stringify([{ path: WS.replace(/\\/g, '/'), name: '我的项目', time: Date.now(), kind: 'dir' }]))}); location.reload(); 1`)
  await sleep(1500)
  await js(W, `(document.querySelector('.recent-row') || {click(){}}).click(); 1`)
  await sleep(1300)
  await js(W, `(() => { const r = [...document.querySelectorAll('.tree-row.file')].find(x => x.dataset.path.includes('产品需求')); r.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); r.click(); return 1 })()`)
  await sleep(1500)

  // ---- 形态 1：主窗口 · 文件页 ----
  const m1 = await js(W, probe)
  fs.writeFileSync(path.join(SHOT, 'pane-files.png'), (await W.webContents.capturePage()).toPNG())
  ok('旧浮层与旧状态栏已全部移除', m1.tocGone, m1.tocGone)
  ok('文件页：文件树可见', m1.treeVis && !m1.outlineVis, { tree: m1.treeVis, outline: m1.outlineVis })
  ok('文件页：头部（两页切换 + 新建按钮）可见', m1.headVis, m1.headVis)
  ok('文件页：文件标签为激活态', m1.tabFiles.active && m1.tabFiles.sel === 'true', m1.tabFiles)
  ok('主窗口：侧栏头与两页切换同在', !!m1.tabs && !!m1.acts, { tabs: !!m1.tabs, acts: !!m1.acts })
  ok('状态栏：整窗一条（贯穿侧栏+正文）', m1.statusbar.x === 0 && m1.statusbar.w === m1.win.w,
    { sb: m1.statusbar, win: m1.win.w })
  // 比中线（各段行高不同，比绝对 y 必然不等），容差 1px
  const o = m1.sbOrder
  ok('状态栏：三段中线齐平（同一行）', Math.abs(o.midA - o.midB) <= 1 && Math.abs(o.midB - o.midC) <= 1, o)
  ok('状态栏：路径在最左、字数最右', o.left < o.mid && o.mid < o.right, o)
  ok('状态栏：字数贴着右缘', o.sbRight - o.cRight <= 14, o)
  // ⚠️ 比 title 不比 textContent：路径段是 direction:rtl + ellipsis，
  // 视觉上截掉的是**开头**，textContent 里仍然是完整的整条路径。
  ok('状态栏：左段是工作空间路径', /我的项目$/.test((m1.pathTitle || '').replace(/\\/g, '/')), m1.pathTitle)
  ok('两栏布局：正文右缘 = 内容区右缘（右侧无面板）', m1.content.r === m1.win.w, { content: m1.content.r, win: m1.win.w })

  // ---- 形态 2：切到大纲页 ----
  await js(W, `document.querySelector('#tab-outline').click(); 1`)
  await sleep(600)
  const m2 = await js(W, probe)
  fs.writeFileSync(path.join(SHOT, 'pane-outline.png'), (await W.webContents.capturePage()).toPNG())
  ok('大纲页：大纲可见、文件树隐藏', m2.outlineVis && !m2.treeVis, { tree: m2.treeVis, outline: m2.outlineVis })
  ok('大纲页：大纲标签为激活态', m2.tabOutline.active && m2.tabFiles.sel === 'false', m2.tabOutline)
  ok('大纲页：条目已渲染', m2.items > 0, m2.items)
  ok('大纲页：窗口宽度不变（面板不抢空间）', m2.win.w === m1.win.w, { before: m1.win.w, after: m2.win.w })
  ok('大纲页：正文宽度不变', m2.pmW === m1.pmW, { before: m1.pmW, after: m2.pmW })
  ok('切页后有大纲高亮条目', m2.active > 0, m2.active)

  // ---- 形态 3：切回文件页（持久化） ----
  await js(W, `document.querySelector('#tab-files').click(); 1`)
  await sleep(400)
  const m3 = await js(W, probe)
  ok('切回文件页正常', m3.treeVis && !m3.outlineVis, { tree: m3.treeVis, outline: m3.outlineVis })

  // ---- 形态 4：快捷键切页 ----
  await js(W, `document.dispatchEvent(new KeyboardEvent('keydown',{key:'O',ctrlKey:true,shiftKey:true,bubbles:true})); 1`)
  await sleep(500)
  const m4 = await js(W, probe)
  ok('Ctrl+Shift+O 切到大纲页', m4.outlineVis, { outline: m4.outlineVis })
  await js(W, `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); 1`)
  await sleep(400)
  const m4b = await js(W, probe)
  ok('Esc 不再收走大纲（它是侧栏一页，不是浮层）', m4b.outlineVis, { outline: m4b.outlineVis })
  await js(W, `document.dispatchEvent(new KeyboardEvent('keydown',{key:'O',ctrlKey:true,shiftKey:true,bubbles:true})); 1`)
  await sleep(400)

  // ---- 形态 5：亮色 ----
  await js(W, `document.querySelector('#btn-image-settings').click(); 1`); await sleep(400)
  await js(W, `document.querySelector('[data-settings-page="appearance"]').click(); 1`); await sleep(250)
  await js(W, `document.querySelector('input[name="settings-theme"][value="light"]').click(); 1`); await sleep(500)
  await js(W, `document.querySelector('#btn-settings-close').click(); 1`); await sleep(600)
  fs.writeFileSync(path.join(SHOT, 'pane-outline-light.png'), (await W.webContents.capturePage()).toPNG())
  await js(W, `document.querySelector('#btn-image-settings').click(); 1`); await sleep(300)
  await js(W, `document.querySelector('[data-settings-page="appearance"]').click(); 1`); await sleep(250)
  await js(W, `document.querySelector('input[name="settings-theme"][value="neutral"]').click(); 1`); await sleep(400)
  await js(W, `document.querySelector('#btn-settings-close').click(); 1`); await sleep(400)
  await js(W, `document.querySelector('#tab-files').click(); 1`); await sleep(300)
  fs.writeFileSync(path.join(SHOT, 'pane-files-light.png'), (await W.webContents.capturePage()).toPNG())

  // ---- 形态 6：纯文本模式（大纲应置灰并退回文件页） ----
  await js(W, `document.querySelector('#btn-source-mode').click(); 1`)
  await sleep(700)
  const m6 = await js(W, probe)
  ok('纯文本模式：大纲标签置灰', m6.tabOutline.disabled === true, m6.tabOutline)
  ok('纯文本模式：自动退回文件页', m6.treeVis, { tree: m6.treeVis, outline: m6.outlineVis })
  await js(W, `document.querySelector('#btn-source-mode').click(); 1`); await sleep(500)

  // ---- 形态 7：收侧栏 ----
  // 正文**占满**内容区、留白恒定 20，所以收侧栏 → 内容区变宽 → 正文等量变宽。
  // （早先是「定宽中轴」，收侧栏在宽窗口下正文不变 —— 那套已撤销，别写回来。）
  await js(W, `document.querySelector('#btn-sidebar').click(); 1`); await sleep(500)
  const m7 = await js(W, probe)
  ok('收侧栏：宽度归零', m7.sidebar.w === 0, m7.sidebar.w)
  ok('收侧栏：正文等量变宽（占满型布局）', m7.pmW > m1.pmW, { before: m1.pmW, after: m7.pmW })
  ok('收侧栏：正文 = 内容区 − 滚动条槽 − 留白', m7.pmW === m7.content.w - m7.sbw - m7.contentPad * 2,
    { pmW: m7.pmW, content: m7.content.w, sbw: m7.sbw, pad: m7.contentPad })
  await js(W, `document.querySelector('#btn-sidebar').click(); 1`); await sleep(500)

  // ---- 窄窗下同样是占满型：没有「撞上限」这回事 ----
  W.setBounds({ x: 60, y: 60, width: 820, height: 680 })
  await sleep(700)
  const narrow = await js(W, probe)
  await js(W, `document.querySelector('#btn-sidebar').click(); 1`); await sleep(500)
  const narrow2 = await js(W, probe)
  ok('820 窄窗：收侧栏后正文变宽', narrow2.pmW > narrow.pmW, { before: narrow.pmW, after: narrow2.pmW })
  ok('820 窄窗：正文仍 = 内容区 − 滚动条槽 − 留白', narrow2.pmW === narrow2.content.w - narrow2.sbw - narrow2.contentPad * 2,
    { pmW: narrow2.pmW, content: narrow2.content.w, sbw: narrow2.sbw, pad: narrow2.contentPad })
  await js(W, `document.querySelector('#btn-sidebar').click(); 1`); await sleep(400)
  W.setBounds({ x: 60, y: 60, width: 1000, height: 680 })
  await sleep(600)

  // ---- 形态 8：用「打开文件」进一个散落的单文件 ----
  // ⚠️ 这里原来验的是「单文件模式」—— 那套形态已经没了。现在打开一个文件等于
  // 把它的**父目录**当成工作空间，左栏仍是文件树（默认闭合），不切大纲页。
  const one = path.join(TMP, '孤立笔记.md')
  fs.writeFileSync(one, '# 孤立笔记\n\n## 小节\n\n正文\n')
  await js(W, `localStorage.setItem('jianmo.recents', ${JSON.stringify(JSON.stringify([{ path: one.replace(/\\/g, '/'), name: '孤立笔记', time: Date.now(), kind: 'file' }]))}); location.reload(); 1`)
  await sleep(1600)
  await js(W, `(document.querySelector('.recent-row') || {click(){}}).click(); 1`)
  await sleep(1500)
  const m8 = await js(W, probe)
  fs.writeFileSync(path.join(SHOT, 'pane-opened-file.png'), (await W.webContents.capturePage()).toPNG())
  ok('打开单个文件：左栏仍在', m8.sidebar.w > 0, m8.sidebar.w)
  ok('打开单个文件：父目录成了工作空间', /tinymd_pane_/.test((m8.pathTitle || '').replace(/\\/g, '/')), m8.pathTitle)
  ok('打开单个文件：仍是文件页（不切大纲）', m8.treeVis && !m8.outlineVis, { tree: m8.treeVis, outline: m8.outlineVis })
  ok('打开单个文件：两页切换头部仍在（形态唯一了）', m8.headVis === true, m8.headVis)
  ok('打开单个文件：状态栏仍整窗一条', m8.statusbar.w === m8.win.w, { sb: m8.statusbar.w, win: m8.win.w })

  const bad = rec.filter((r) => !r.pass)
  console.log(`\n${rec.length - bad.length}/${rec.length} passed`)
  fs.writeFileSync(path.join(__dirname, 'pane.json'), JSON.stringify({ m1, m2, m8 }, null, 2))
  app.exit(bad.length ? 1 : 0)
}).catch((e) => { console.error(e); app.exit(1) })