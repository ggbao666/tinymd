/* 验证：正文定宽中轴 + 大纲页隐藏新建按钮 + 顶栏两个打开按钮 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { app, BrowserWindow, dialog } = require('electron')

const ROOT = path.resolve(__dirname, '..')
const SHOT = path.join(__dirname, '_shots')
fs.mkdirSync(SHOT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const js = (w, code) => w.webContents.executeJavaScript(code)

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tinymd_measure2_'))
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu')
app.disableHardwareAcceleration()
app.setPath('userData', path.join(TMP, 'user-data'))
// 记录用户点过哪个「打开文件」入口，用来验证顶栏按钮真的接上了
const picked = { chooseFile: 0, chooseFolder: 0 }
dialog.showOpenDialog = async () => { picked.chooseFile++; return { canceled: true, filePaths: [] } }
dialog.showOpenDialogSync = () => { picked.chooseFile++; return null }
require(path.join(ROOT, 'main.js'))

const rec = []
const ok = (name, pass, detail) => {
  rec.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail === undefined ? '' : JSON.stringify(detail)}`)
}

const probe = `(() => {
  const R = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return {x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), r: Math.round(b.right)} }
  const vis = (s) => { const e = document.querySelector(s); if (!e) return null; return getComputedStyle(e).display !== 'none' }
  const ed = document.querySelector('#editor')
  const pm = document.querySelector('.ProseMirror')
  const emPx = pm ? parseFloat(getComputedStyle(pm).fontSize) : 16
  const edW = ed ? ed.getBoundingClientRect().width : null
  const edX = ed ? ed.getBoundingClientRect().x : null
  const wrap = document.querySelector('#editor-wrap')
  const wrapW = wrap ? Math.round(wrap.getBoundingClientRect().width) : null
  const cs = ed ? getComputedStyle(ed) : null
  // ⚠️ 算左右留白必须用 #editor-wrap 的 **clientWidth**（content box），不能用
  // getBoundingClientRect().right ——后者含 scrollbar-gutter 预留的滚动条槽
  // （Windows 10px、macOS 0）。用它当右边界会凭空多出 10px 差，误报「不对称」。
  const wrapEl = document.querySelector('#editor-wrap')
  const sbw = wrapEl ? Math.round(wrapEl.getBoundingClientRect().width - wrapEl.clientWidth) : 0
  const wrapBox = wrapEl ? wrapEl.getBoundingClientRect() : null
  return {
    win: { w: innerWidth, h: innerHeight },
    editor: R('#editor'), editorWrap: R('#editor-wrap'),
    edW, edX, wrapW,
    maxW: cs ? cs.maxWidth : null,
    padL: cs ? cs.paddingLeft : null, padR: cs ? cs.paddingRight : null,
    padT: cs ? cs.paddingTop : null, padB: cs ? cs.paddingBottom : null,
    emPx, sbw,
    // 折算：正文内容宽 / 字号 ≈ 每行多少个汉字
    charsPerLine: edW && cs ? Math.floor((edW - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) / emPx) : null,
    // 左右留白是否对称（相对 content box，扣掉滚动条槽）
    // ⚠️ 量的是**文字块**（.ProseMirror）到内容区边缘的距离 —— 那才是眼睛看到的留白。
    // 早先这里量的是 #editor 外框，而它带 padding 且占满容器，量出来恒为 0。
    gutterL: pm ? Math.round(pm.getBoundingClientRect().x - wrapBox.x) : null,
    gutterR: pm ? Math.round(wrapBox.x + wrapEl.clientWidth - pm.getBoundingClientRect().right) : null,
    // 顺带量一下外框的（应当 0，证明确实占满）
    boxL: edX !== null && wrapBox ? Math.round(edX - wrapBox.x) : null,
    actions: vis('.sidebar-head-actions'),
    sidebar: R('#sidebar'),
    btnOpenFolderWs: vis('#btn-open-folder-ws'),
    btnOpenFileWs: vis('#btn-open-file-ws'),
    topRight: R('.topbar-right'),
    docTitle: (() => { const h = document.querySelector('.ProseMirror h1'); return h ? Math.round(h.getBoundingClientRect().y) : null })(),
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
    '# 产品需求文档', '', '这是第一段正文。'.repeat(14), '',
    '## 一、背景', '', '第二段。', '',
    '## 二、功能列表', '', '1. 第一项', '',
    '### 2.1 细节', '', '正文。', '',
    '## 三、接口定义', '', '正文。', '',
  ].join('\n'))

  await js(W, `localStorage.setItem('jianmo.recents', ${JSON.stringify(JSON.stringify([{ path: WS.replace(/\\/g, '/'), name: '我的项目', time: Date.now(), kind: 'dir' }]))}); location.reload(); 1`)
  await sleep(1500)
  await js(W, `(document.querySelector('.recent-row') || {click(){}}).click(); 1`)
  await sleep(1300)
  await js(W, `(() => { const r = [...document.querySelectorAll('.tree-row.file')].find(x => x.dataset.path.includes('产品需求')); r.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); r.click(); return 1 })()`)
  await sleep(1500)

  // ---- 1000 宽（默认） ----
  const m1 = await js(W, probe)
  fs.writeFileSync(path.join(SHOT, 'measure-1000.png'), (await W.webContents.capturePage()).toPNG())
  // 正文占满内容区：左右留白恒等于 --content-pad（20），不多给
  ok('1000 宽：文字左留白 = 20（恒定最小）', m1.gutterL === 20, m1.gutterL)
  ok('1000 宽：文字右留白 = 20（滚动条槽在 padding 外，天然对称）', m1.gutterR === 20, m1.gutterR)
  ok('1000 宽：正文占满剩余（外框 = 内容区 - 滚动条槽）', m1.edW === m1.wrapW - m1.sbw, { ed: m1.edW, wrap: m1.wrapW, sbw: m1.sbw })
  ok('1000 宽：无 max-width 上限', m1.maxW === 'none', m1.maxW)
  ok('1000 宽：行宽随窗口放开（不再有38 字天花板）', m1.charsPerLine > 38, m1.charsPerLine)

  // ---- 1600 宽：行宽必须不再增长 ----
  W.setBounds({ x: 60, y: 60, width: 1600, height: 900 })
  await sleep(800)
  const m2 = await js(W, probe)
  fs.writeFileSync(path.join(SHOT, 'measure-1600.png'), (await W.webContents.capturePage()).toPNG())
  // 窗口拉宽：留白**恒定** 20（这是本轮的核心），内容吃掉全部多出来的空间
  ok('1600 宽：文字左留白仍是 20（不随窗口变大）', m2.gutterL === 20, m2.gutterL)
  ok('1600 宽：文字右留白仍是 20', m2.gutterR === 20, m2.gutterR)
  ok('1600 宽：正文吃掉全部剩余空间', m2.edW === m2.wrapW - m2.sbw, { ed: m2.edW, wrap: m2.wrapW, sbw: m2.sbw })
  ok('1600 宽：正文外框贴住内容区两边（无居中留白）', m2.boxL === 0, m2.boxL)
  ok('1600 宽：正文确实比 1000 宽时宽（占满而非定宽）', m2.edW > m1.edW, { at1000: m1.edW, at1600: m2.edW })

  // ---- 760 窄窗：max-width 不该造成横向滚动或溢出 ----
  W.setBounds({ x: 60, y: 60, width: 760, height: 680 })
  await sleep(800)
  const m3 = await js(W, probe)
  fs.writeFileSync(path.join(SHOT, 'measure-760.png'), (await W.webContents.capturePage()).toPNG())
  ok('760 窄窗：正文不溢出容器', m3.edW <= m3.wrapW, { ed: m3.edW, wrap: m3.wrapW })
  ok('760 窄窗：无横向滚动', await js(W, `(() => { const w = document.querySelector('#editor-wrap'); return w.scrollWidth <= w.clientWidth + 1 })()`), null)
  ok('760 窄窗：文字左右留白仍是 20（不随窗口变小而变）', m3.gutterL === 20 && m3.gutterR === 20, { l: m3.gutterL, r: m3.gutterR })

  W.setBounds({ x: 60, y: 60, width: 1000, height: 680 })
  await sleep(700)

  // ---- 新建按钮：文件页显示、大纲页隐藏 ----
  const a1 = await js(W, `getComputedStyle(document.querySelector('.sidebar-head-actions')).display`)
  ok('文件页：新建按钮可见', a1 !== 'none', a1)
  await js(W, `document.querySelector('#tab-outline').click(); 1`)
  await sleep(500)
  const a2 = await js(W, `getComputedStyle(document.querySelector('.sidebar-head-actions')).display`)
  ok('大纲页：新建按钮隐藏', a2 === 'none', a2)
  fs.writeFileSync(path.join(SHOT, 'measure-outline-noactions.png'), (await W.webContents.capturePage()).toPNG())
  await js(W, `document.querySelector('#tab-files').click(); 1`)
  await sleep(400)
  const a3 = await js(W, `getComputedStyle(document.querySelector('.sidebar-head-actions')).display`)
  ok('切回文件页：新建按钮回来', a3 !== 'none', a3)

  // ---- 顶栏两个打开按钮 ----
  const t = await js(W, `(() => {
    const f = document.querySelector('#btn-open-folder-ws').getBoundingClientRect()
    const g = document.querySelector('#btn-open-file-ws').getBoundingClientRect()
    return {
      bothVisible: f.width > 0 && g.width > 0,
      // ⚠️ 阈值要按「按钮宽 30 + gap 8」算 = 38，别写 30 以下 —— 那是量两枚按钮
      // 中心点距离，30 是按钮**自身**的宽度，量错了单位。
      adjacent: Math.abs(f.x - g.x) <= 40,
      gap: Math.round(g.x - f.right),
      folderTitle: document.querySelector('#btn-open-folder-ws').title,
      fileTitle: document.querySelector('#btn-open-file-ws').title,
    }
  })()`)
  ok('顶栏：打开文件夹 / 打开文件 两枚都在', t.bothVisible, t)
  ok('顶栏：两枚紧邻（同排、gap 一个）', t.adjacent && t.gap <= 10, t)

  // 真的点一下「打开文件」，确认接上了（对话框被 cancel，只验证它被调起）
  const before = picked.chooseFile
  await js(W, `document.querySelector('#btn-open-file-ws').click(); 1`)
  await sleep(700)
  ok('顶栏「打开文件」真的调起选择框', picked.chooseFile > before, { before, after: picked.chooseFile })

  // ---- 纯文本模式：中轴与首行位置 ----
  const before1 = await js(W, `(() => { const h = document.querySelector('.ProseMirror h1'); return h ? Math.round(h.getBoundingClientRect().y) : null })()`)
  await js(W, `document.querySelector('#btn-source-mode').click(); 1`)
  await sleep(700)
  const s1 = await js(W, `(() => {
    const t = document.querySelector('#source-editor')
    const r = t.getBoundingClientRect()
    const cs = getComputedStyle(t)
    const wrap = document.querySelector('#source-wrap').getBoundingClientRect()
    return { padT: cs.paddingTop, padL: cs.paddingLeft, w: Math.round(r.width), x: Math.round(r.x), gutterL: Math.round(r.x - wrap.x), gutterR: Math.round(wrap.right - r.right), boxL: Math.round(r.x - wrap.x), firstLineY: Math.round(r.y + parseFloat(cs.paddingTop)) }
  })()`)
  ok('纯文本：内边距与富文本一致（切换不跳行）', s1.padT === '40px' && s1.padL === m1.padL, { source: s1.padT + '/' + s1.padL, rich: m1.padT + '/' + m1.padL })
  ok('纯文本：左右留白对称', Math.abs(s1.gutterL - s1.gutterR) <= 1, { l: s1.gutterL, r: s1.gutterR })
  ok('纯文本：首行位置与富文本一致', Math.abs(s1.firstLineY - before1) <= 1, { source: s1.firstLineY, rich: before1 })
  fs.writeFileSync(path.join(SHOT, 'measure-source.png'), (await W.webContents.capturePage()).toPNG())
  await js(W, `document.querySelector('#btn-source-mode').click(); 1`)
  await sleep(500)

  // ---- 亮色 ----
  await js(W, `document.querySelector('#btn-image-settings').click(); 1`); await sleep(400)
  await js(W, `document.querySelector('[data-settings-page="appearance"]').click(); 1`); await sleep(250)
  await js(W, `document.querySelector('input[name="settings-theme"][value="light"]').click(); 1`); await sleep(500)
  await js(W, `document.querySelector('#btn-settings-close').click(); 1`); await sleep(600)
  fs.writeFileSync(path.join(SHOT, 'measure-light.png'), (await W.webContents.capturePage()).toPNG())

  // ---- 1600 亮色（定宽中轴在亮色下最容易看出留白是否对称） ----
  W.setBounds({ x: 60, y: 60, width: 1600, height: 900 })
  await sleep(800)
  fs.writeFileSync(path.join(SHOT, 'measure-1600-light.png'), (await W.webContents.capturePage()).toPNG())

  const bad = rec.filter((r) => !r.pass)
  console.log(`\n${rec.length - bad.length}/${rec.length} passed`)
  fs.writeFileSync(path.join(__dirname, 'measure2.json'), JSON.stringify({ m1, m2, m3, s1 }, null, 2))
  app.exit(bad.length ? 1 : 0)
}).catch((e) => { console.error(e); app.exit(1) })