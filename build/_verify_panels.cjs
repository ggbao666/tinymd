// 验证「窗口 < 800 时左右两块面板互斥」这条新规矩（真实 Electron、真实 main.js）
// 用法: unset ELECTRON_RUN_AS_NODE && ./node_modules/.bin/electron build/_verify_panels.cjs
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { once } = require('node:events')

const ROOT = path.join(__dirname, '..')
const STAMP = `${Date.now()}_${process.pid}`
const TMP = path.join(ROOT, 'build', `_verify_panels_${STAMP}`)
const WS = path.join(TMP, 'ws')

fs.mkdirSync(WS, { recursive: true })
fs.writeFileSync(path.join(WS, 'doc.md'), '# 第一节\n\n正文文字。\n\n## 第二节\n\n更多正文。\n')
fs.writeFileSync(path.join(WS, 'other.md'), '# 另一篇\n\n内容。\n')

const results = []
let stage = 'boot'
const outFile = path.join(ROOT, 'build', `_verify_panels_${STAMP}.json`)
const flush = () => fs.writeFileSync(outFile, JSON.stringify({ stage, results }, null, 2))
const rec = (name, ok, info) => {
  results.push({ name, ok, info })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info === undefined ? '' : '  ' + JSON.stringify(info)}`)
  flush()
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 沙箱开关与 userData 都必须在 require main.js 之前
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

const PANEL_JS = `JSON.stringify({
  inner: innerWidth,
  sidebar: Math.round(document.querySelector('#sidebar').getBoundingClientRect().width),
  toc: document.body.classList.contains('toc-open'),
  tocVis: getComputedStyle(document.querySelector('#toc-float')).visibility,
  editor: Math.round(document.querySelector('#editor-wrap').clientWidth),
  status: document.querySelector('#status').textContent,
})`

app.whenReady().then(async () => {
  const win = await waitForWindow()
  if (win.webContents.isLoading()) await once(win.webContents, 'did-finish-load')
  await sleep(600)
  const js = (code) => win.webContents.executeJavaScript(code)
  const state = async () => JSON.parse(await js(PANEL_JS))

  // 窗口固定停在同一块屏（主屏 scale 1）内改宽度 —— 跨屏时 setBounds 的宽会被按物理像素解释
  const setWinW = async (w) => {
    win.setBounds({ x: 100, y: 100, width: w, height: 680 })
    await sleep(450)
  }

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
  rec('前置：工作区已开、文档已打开', !!opened && (await state()).inner === 1000, { opened, win: win.getBounds() })

  stage = 'cases'
  flush()

  // ---- A. 默认 1000：两块同开 ----
  const a0 = await state()
  rec('A1 初始：侧栏开、目录关', a0.toc === false && a0.sidebar > 0, a0)
  await js(`document.querySelector('#btn-toc').click()`)
  await sleep(420)
  const a1 = await state()
  rec('A2 1000 宽开目录：侧栏留着（≥800 允许同开）', a1.toc === true && a1.sidebar > 0 && a1.tocVis === 'visible', a1)

  // ---- B. 900 宽：仍同开（旧逻辑在这里就会收掉一块） ----
  await setWinW(900)
  const b = await state()
  rec('B 900 宽：两块仍同开（旧判据会收目录）', b.toc === true && b.sidebar > 0 && b.inner === 900, b)

  // ---- C. 800：边界，仍同开 ----
  await setWinW(800)
  const c = await state()
  rec('C 800 宽（边界值）：仍同开', c.toc === true && c.sidebar > 0 && c.inner === 800, c)
  fs.writeFileSync(path.join(ROOT, 'build/panels-w800-both.png'),
    (await win.webContents.capturePage()).toPNG())

  // ---- D. 799：目录被自动收起 + 状态栏说明 ----
  await setWinW(799)
  const d = await state()
  rec('D 799 宽：目录自动收起 + 提示', d.toc === false && d.sidebar > 0 && d.status.includes('收起目录'), d)

  // ---- E. 窄窗口点目录 → 目录开、侧栏自动收 ----
  await setWinW(700)
  await js(`document.querySelector('#btn-toc').click()`)
  await sleep(460)
  const e = await state()
  rec('E 700 宽点目录：目录开 + 侧栏自动收起', e.toc === true && e.sidebar === 0 && e.status.includes('收起文件栏'), e)
  fs.writeFileSync(path.join(ROOT, 'build/panels-w700-toc-only.png'),
    (await win.webContents.capturePage()).toPNG())

  // ---- F. 窄窗口点侧栏 → 侧栏开、目录自动收 ----
  await js(`document.querySelector('#btn-sidebar').click()`)
  await sleep(460)
  const f = await state()
  rec('F 700 宽点侧栏：侧栏开 + 目录自动收起', f.toc === false && f.sidebar > 0, f)

  // ---- G. 侧栏被夹窄只是临时的，空间回来要还 ----
  await setWinW(1000)
  await js(`(() => {
    const h = document.querySelector('#sidebar-resize')
    const r = h.getBoundingClientRect()
    h.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: r.left + 2, clientY: r.top + 20 }))
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 500, clientY: r.top + 20 }))
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    return true
  })()`)
  await sleep(380)
  const g1 = await state()
  rec('G1 拖拽后侧栏 = 500（目录关着）', Math.abs(g1.sidebar - 500) <= 1, g1)

  await js(`document.querySelector('#btn-toc').click()`)
  await sleep(420)
  const g2 = await state()
  rec('G2 开目录后侧栏让位（渲染宽度被夹窄）', g2.toc === true && g2.sidebar < 300, g2)

  await js(`document.querySelector('#btn-toc').click()`)
  await sleep(420)
  const g3 = await state()
  const stored = await js(`localStorage.getItem('jianmo.sidebarWidth')`)
  rec('G3 关目录后侧栏回到 500（夹窄不吞偏好）', Math.abs(g3.sidebar - 500) <= 1, g3)
  rec('G4 localStorage 记的是 500，不是被夹的窄值', stored === '500', { stored })

  // ---- H. 窗口最小宽度：工作区 600 / 欢迎页 460 ----
  const h1 = win.getMinimumSize()
  rec('H1 工作区窗口最小宽度 = 600', h1[0] === 600, { min: h1 })

  const okBack = await js(`window.api.resizeWindow('welcome')`)
  await sleep(600)
  const h2 = win.getMinimumSize()
  const b2 = win.getBounds()
  rec('H2 回欢迎页：最小宽度松回 460、窗口缩到 480',
    okBack === true && h2[0] === 460 && Math.abs(b2.width - 480) <= 2, { okBack, min: h2, bounds: b2 })

  await js(`window.api.resizeWindow('workspace')`)
  await sleep(700)
  const h3 = win.getMinimumSize()
  const b3 = win.getBounds()
  rec('H3 再回工作区：最小宽度 600、窗口 1000',
    h3[0] === 600 && Math.abs(b3.width - 1000) <= 2, { min: h3, bounds: b3 })

  stage = 'done'
  flush()
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed  →  ${outFile}`)
  app.exit(failed.length ? 1 : 0)
})
