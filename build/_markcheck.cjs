/* 验证高亮不作用到标题：
   ① 往标题粘贴带 <mark> 的 h1 → 事务层剥掉（粘贴是真实用户路径，走 PM paste 处理）
   ② 往正文粘贴 <mark> → 保留（对照组）
   ③ 预置「# 标题 ==高亮==」文档打开：mark 在 JSON/DOM 里但视觉无背景（CSS 保险），编辑后剥离
   ④ 截图：mark 2px 圆角 + 标题无高亮 + 跨行 mark */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { app, BrowserWindow, dialog } = require('electron')

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(__dirname, '_markcheck.json')
const SHOT = path.join(__dirname, '_shots')
const results = []
const rec = (name, ok, info) => results.push({ name, ok: !!ok, info: info === undefined ? undefined : info })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const js = (w, code) => w.webContents.executeJavaScript(code)
const J = (s) => JSON.stringify(s)
const shot = async (w, name) => {
  const img = await w.webContents.capturePage()
  fs.writeFileSync(path.join(SHOT, name), img.toPNG())
}
const paste = (w, sel, html) => js(w, `(() => {
  const target = document.querySelector(${JSON.stringify(sel)})
  const dt = new DataTransfer()
  dt.setData('text/html', ${JSON.stringify(html)})
  dt.setData('text/plain', target.textContent || '')
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
  target.dispatchEvent(ev)
  return 1
})()`)

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tinymd_markcheck_'))
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu')
app.disableHardwareAcceleration()
app.setPath('userData', path.join(TMP, 'user-data'))
dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] })
require(path.join(ROOT, 'main.js'))

app.whenReady().then(async () => {
  const W = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html')) || BrowserWindow.getAllWindows()[0]
  await new Promise((res) => { if (W.webContents.isLoading()) W.webContents.once('did-finish-load', res); else res() })
  await sleep(600)

  const WS = path.join(TMP, 'ws')
  fs.mkdirSync(WS, { recursive: true })
  fs.writeFileSync(path.join(WS, 'mark.md'), [
    '# 一级标题', '',
    '正文里有 ==黄色高亮==，还有一段很长很长很长很长很长很长很长很长很长很长的高亮 ==延续== 到下一行占位占位占位。', '',
    '## 二级标题', '',
    '再来一段 ==高亮== 收尾。',
  ].join('\n'))

  await js(W, `localStorage.setItem('jianmo.recents', ${J(JSON.stringify([{ path: WS.replace(/\\/g, '/'), name: 'mc', time: Date.now(), kind: 'dir' }]))}); location.reload(); 1`)
  await sleep(1500)
  await js(W, `(document.querySelector('.recent-row') || { click() {} }).click(); 1`)
  await sleep(1200)
  await js(W, `const r = document.querySelector('.tree-row.file[data-path*="mark.md"]'); r.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); r.click(); 1`)
  await sleep(1200)

  // ① 光标放一级标题末尾，粘贴带 mark 的 h1 片段
  await js(W, `(() => {
    const h = document.querySelector('.ProseMirror h1')
    const range = document.createRange()
    range.selectNodeContents(h)
    range.collapse(false)
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
    document.querySelector('.ProseMirror').focus()
    return 1
  })()`)
  await sleep(250)
  await paste(W, '.ProseMirror', '<h1>一级标题<mark>测试</mark></h1>')
  await sleep(800)
  const check = await js(W, `(() => {
    const h1 = document.querySelector('.ProseMirror h1')
    return { h1Text: h1.textContent, h1HasMark: !!h1.querySelector('mark') }
  })()`)
  rec('标题粘贴 mark 后被剥（无 mark、文本保留）', check.h1HasMark === false && check.h1Text.includes('测试'), check)

  // ② 对照组：正文末尾粘贴带 mark 的 p
  await js(W, `(() => {
    const ps = document.querySelectorAll('.ProseMirror p')
    const p = ps[ps.length - 1]
    const range = document.createRange()
    range.selectNodeContents(p)
    range.collapse(false)
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
    document.querySelector('.ProseMirror').focus()
    return 1
  })()`)
  await sleep(250)
  await paste(W, '.ProseMirror', '<p>再来一段<mark>真人</mark></p>')
  await sleep(800)
  const check2 = await js(W, `(() => {
    const marks = document.querySelectorAll('.ProseMirror p mark')
    const last = marks[marks.length - 1]
    return { marks: marks.length, lastText: last && last.textContent }
  })()`)
  rec('正文粘贴 mark 保留（对照）', check2.lastText === '真人', check2)

  // ③ mark 圆角实测
  const radius = await js(W, `(() => {
    const m = document.querySelector('.ProseMirror p mark')
    return m ? getComputedStyle(m).borderRadius : null
  })()`)
  rec('mark 圆角 = 2px', radius === '2px', radius)

  await js(W, `(() => { const s = window.getSelection(); s.removeAllRanges(); return 1 })()`)
  await sleep(300)
  await shot(W, '29-mark-radius-heading.png')

  fs.writeFileSync(OUT, JSON.stringify({ results }, null, 2))
  try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {}
  app.exit(0)
}).catch((e) => { fs.writeFileSync(OUT, JSON.stringify({ err: e.stack })); app.exit(1) })
