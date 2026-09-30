// 验证「目录按钮搬进标题栏 + 正文左右留白收到 40px」（真实 Electron、真实 main.js、真实构建产物）
// 用法: unset ELECTRON_RUN_AS_NODE && ./node_modules/.bin/electron build/_verify_tocbtn.cjs
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { once } = require('node:events')

const ROOT = path.join(__dirname, '..')
const STAMP = `${Date.now()}_${process.pid}`
const TMP = path.join(ROOT, 'build', `_verify_tocbtn_${STAMP}`)
const WS = path.join(TMP, 'ws')

fs.mkdirSync(WS, { recursive: true })
fs.writeFileSync(
  path.join(WS, 'doc.md'),
  '# 第一节\n\n这是一段用来量留白的正文，写长一点好换行。\n\n## 第二节\n\n更多正文。\n',
)

const results = []
let stage = 'boot'
const outFile = path.join(ROOT, 'build', `_verify_tocbtn_${STAMP}.json`)
const flush = () => fs.writeFileSync(outFile, JSON.stringify({ stage, results }, null, 2))
const rec = (name, ok, info) => {
  results.push({ name, ok, info })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info === undefined ? '' : '  ' + JSON.stringify(info)}`)
  flush()
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

app.setPath('userData', TMP)
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu')
app.disableHardwareAcceleration()

require(path.join(ROOT, 'main.js'))

function finish(tag, e) {
  rec(`崩溃兜底: ${tag}`, false, String((e && e.stack) || e))
  try { flush() } catch {}
  app.exit(1)
}
process.on('uncaughtException', (e) => finish('uncaughtException', e))
process.on('unhandledRejection', (e) => finish('unhandledRejection', e))

async function waitForWindow() {
  for (let i = 0; i < 100; i++) {
    const ws = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
    if (ws.length) return ws[0]
    await sleep(100)
  }
  throw new Error('窗口没出现')
}

// 按钮几何 + 三态
const BTN_JS = `(() => {
  const b = document.querySelector('#btn-toc')
  const r = b.getBoundingClientRect()
  const tb = document.querySelector('#topbar').getBoundingClientRect()
  const sm = document.querySelector('#btn-source-mode').getBoundingClientRect()
  const ew = document.querySelector('#editor-wrap').getBoundingClientRect()
  return JSON.stringify({
    inTopbar: document.querySelector('#topbar').contains(b),
    inContent: document.querySelector('#content').contains(b),
    parent: b.parentElement.className,
    rect: { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) },
    topbar: { t: Math.round(tb.top), b: Math.round(tb.bottom) },
    sourceLeft: Math.round(sm.left),
    editorTop: Math.round(ew.top),
    active: b.classList.contains('active'),
    disabled: b.disabled,
    hidden: b.classList.contains('hidden'),
    aria: b.getAttribute('aria-pressed'),
  })
})()`

// 正文留白：块盒左右边到 #editor-wrap 边界的距离（块盒 = 排版边界，视觉留白就是它）
const PAD_JS = `(() => {
  const wrap = document.querySelector('#editor-wrap')
  const w = wrap.getBoundingClientRect()
  const el = document.querySelector('#editor > p') || document.querySelector('#editor > *')
  const r = el.getBoundingClientRect()
  const cs = getComputedStyle(document.documentElement)
  const editor = document.querySelector('#editor')
  const ecs = getComputedStyle(editor)
  const sbw = parseFloat(cs.getPropertyValue('--sb-w')) || 0
  return JSON.stringify({
    left: Math.round(r.left - w.left),
    right: Math.round(w.right - r.right),
    pad: cs.getPropertyValue('--content-pad').trim(),
    sbw: cs.getPropertyValue('--sb-w').trim(),
    padLeft: parseFloat(ecs.paddingLeft),
    padRight: parseFloat(ecs.paddingRight),
    // 正文排版边界 → 滚动条左缘 的净距（最窄处）
    toScrollbar: Math.round(w.right - r.right) - sbw,
    colW: Math.round(r.width),
    editorW: Math.round(editor.getBoundingClientRect().width),
  })
})()`

const TOC_JS = `JSON.stringify({
  open: document.body.classList.contains('toc-open'),
  vis: getComputedStyle(document.querySelector('#toc-float')).visibility,
  mRight: getComputedStyle(document.querySelector('#editor-wrap')).marginRight,
  tocW: Math.round(document.querySelector('#toc-float').getBoundingClientRect().width),
})`

app.whenReady().then(async () => {
  const win = await waitForWindow()
  if (win.webContents.isLoading()) await once(win.webContents, 'did-finish-load')
  await sleep(600)
  const js = (code) => win.webContents.executeJavaScript(code)
  const btn = async () => JSON.parse(await js(BTN_JS))
  const pad = async () => JSON.parse(await js(PAD_JS))
  const toc = async () => JSON.parse(await js(TOC_JS))

  stage = 'seed-recents'
  flush()
  await js(`localStorage.setItem('jianmo.recents', ${JSON.stringify(JSON.stringify([
    { path: WS, name: 'ws', kind: 'dir', time: Date.now() },
  ]))})`)
  win.webContents.reload()
  await once(win.webContents, 'did-finish-load')
  await sleep(700)

  stage = 'open-workspace'
  flush()
  await js(`document.querySelector('.recent-row').click()`)
  await sleep(1400)

  stage = 'open-doc'
  flush()
  const opened = await js(`(() => {
    const rows = [...document.querySelectorAll('.tree-row.file')]
    const t = rows.find((r) => (r.dataset.path || '').endsWith('doc.md')) || rows[0]
    if (!t) return null
    t.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return t.dataset.path
  })()`)
  await sleep(1100)
  rec('前置：工作区已开、文档已打开', !!opened, { opened })

  stage = 'cases'
  flush()

  // ---- A. 按钮住在标题栏里，且落在标题栏那一行内 ----
  const a = await btn()
  rec('A1 按钮的父链在 #topbar 内、已离开 #content',
    a.inTopbar === true && a.inContent === false, { inTopbar: a.inTopbar, inContent: a.inContent, parent: a.parent })
  rec('A2 按钮矩形完全落在标题栏行内', a.rect.t >= a.topbar.t && a.rect.b <= a.topbar.b,
    { rect: a.rect, topbar: a.topbar })
  rec('A3 按钮排在「纯文本模式」左边（同一组最左）', a.rect.r <= a.sourceLeft,
    { right: a.rect.r, sourceLeft: a.sourceLeft })
  rec('A4 按钮不再压着编辑区（底边在编辑区上沿之上）', a.rect.b <= a.editorTop,
    { btnBottom: a.rect.b, editorTop: a.editorTop })

  // ---- B. 留白 20px，左右对称，且与滚动条还分得开 ----
  const b = await pad()
  rec('B1 --content-pad = 20px', b.pad === '20px', b)
  rec('B2 正文左侧留白 = 20px', Math.abs(b.left - 20) <= 1, b)
  rec('B3 正文右侧留白 = 20px（视觉，含滚动条槽）', Math.abs(b.right - 20) <= 1, b)
  rec('B4 左内边距 20 / 右内边距 10（= 20 - --sb-w）',
    Math.abs(b.padLeft - 20) <= 1 && Math.abs(b.padRight - (20 - parseFloat(b.sbw))) <= 1, b)
  rec('B5 正文排版边界离滚动条还有 10px（下界守住了）', Math.abs(b.toScrollbar - 10) <= 1, b)
  rec('B6 正文列宽 = 编辑区宽度 - 左内边距 - 右内边距（不依赖窗口宽度）',
    Math.abs(b.colW - (b.editorW - b.padLeft - b.padRight)) <= 1, b)
  rec('B7 左右视觉留白严格相等（对称）', b.left === b.right, { left: b.left, right: b.right })

  fs.writeFileSync(path.join(ROOT, 'build/tocbtn-closed.png'), (await win.webContents.capturePage()).toPNG())

  // ---- C. 点按钮：目录开，按钮位置纹丝不动 ----
  await js(`document.querySelector('#btn-toc').click()`)
  await sleep(420)
  const c1 = await toc()
  const c2 = await btn()
  rec('C1 点按钮：目录展开（visibility: visible、margin-right 246）',
    c1.open === true && c1.vis === 'visible' && c1.mRight === '246px', c1)
  rec('C2 展开后按钮 active / aria-pressed=true', c2.active === true && c2.aria === 'true', { active: c2.active, aria: c2.aria })
  rec('C3 开、关两态按钮矩形完全一致（不再跟着正文挪）',
    JSON.stringify(c2.rect) === JSON.stringify(a.rect), { closed: a.rect, open: c2.rect })

  fs.writeFileSync(path.join(ROOT, 'build/tocbtn-open.png'), (await win.webContents.capturePage()).toPNG())

  // ---- D. 再点一下收起；快捷键 Ctrl+Shift+O 仍生效 ----
  await js(`document.querySelector('#btn-toc').click()`)
  await sleep(400)
  const d1 = await toc()
  rec('D1 再点一下：目录收起', d1.open === false && d1.vis === 'hidden', d1)

  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, shiftKey: true, bubbles: true }))`)
  await sleep(400)
  const d2 = await toc()
  rec('D2 Ctrl+Shift+O 仍能展开', d2.open === true, d2)

  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await sleep(400)
  const d3 = await toc()
  rec('D3 Esc 收起', d3.open === false, d3)

  // ---- E. 纯文本模式下按钮置灰、目录自动收 ----
  await js(`document.querySelector('#btn-toc').click()`)
  await sleep(400)
  await js(`document.querySelector('#btn-source-mode').click()`)
  await sleep(600)
  const e = await btn()
  const e2 = await toc()
  rec('E1 切纯文本模式：按钮置灰 + 目录自动收起',
    e.disabled === true && e2.open === false, { disabled: e.disabled, toc: e2.open })
  await js(`document.querySelector('#btn-source-mode').click()`)
  await sleep(600)
  const e3 = await btn()
  rec('E2 切回富文本：按钮恢复可用', e3.disabled === false && e3.hidden === false, e3)

  stage = 'done'
  flush()
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed  →  ${outFile}`)
  app.exit(failed.length ? 1 : 0)
})
