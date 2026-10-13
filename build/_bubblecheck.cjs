/* 验证气泡菜单不在标题（及代码块、跨块选区）弹出：
   ① 选中 h1 内文字 → 气泡隐藏（本次需求）
   ② 选中正文 p 内文字 → 气泡可见（对照，证明不是把气泡弄没了）
   ③ 从正文划到二级标题的跨块选区 → 隐藏
   ④ 选中代码块内文字 → 隐藏（原有行为，回归确认）
   Tiptap v3 bubble-menu 的隐藏实现是 element.style.visibility = 'hidden'，据此断言。 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { app, BrowserWindow, dialog } = require('electron')

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(__dirname, '_bubblecheck.json')
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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tinymd_bubblecheck_'))
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
  fs.writeFileSync(path.join(WS, 'bubble.md'), [
    '# 一级标题在这里', '',
    '这是一个普通段落，用来做对照实验的正文文本。', '',
    '```js', 'const a = 1', '```', '',
    '## 二级标题', '',
    '结尾段落。',
  ].join('\n'))

  await js(W, `localStorage.setItem('jianmo.recents', ${J(JSON.stringify([{ path: WS.replace(/\\/g, '/'), name: 'bc', time: Date.now(), kind: 'dir' }]))}); location.reload(); 1`)
  await sleep(1500)
  await js(W, `(document.querySelector('.recent-row') || { click() {} }).click(); 1`)
  await sleep(1200)
  await js(W, `const r = document.querySelector('.tree-row.file[data-path*="bubble.md"]'); r.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); r.click(); 1`)
  await sleep(1200)

  // 选中一段文字的通用函数：先清选区 → 设新选区 → 焦点交给编辑器 → 等 PM 同步
  const select = async (code) => {
    await js(W, `(() => {
      const sel = window.getSelection(); sel.removeAllRanges()
      ${code}
      document.querySelector('.ProseMirror').focus()
      return 1
    })()`)
    await sleep(500)
    return js(W, `(() => { const el = document.getElementById('bubble-menu')
      const ed = window.__tinymdEditor
      const st = ed ? ed.state.selection : null
      const log = (window.__bubbleLog || []).splice(0)
      return JSON.stringify({ v: el ? getComputedStyle(el).visibility : 'missing(detached=hidden)', parent: st ? [st.$from.parent.type.name, st.$to.parent.type.name].join('>') : 'no-editor', log }) })()`)
  }

  // ① 标题内选区
  const v1j = await select(`const h = document.querySelector('.ProseMirror h1')
    const r = document.createRange(); r.selectNodeContents(h); sel.addRange(r)`)
  const v1 = JSON.parse(v1j); rec('选中标题文字：气泡隐藏', v1.v === 'hidden' && v1.parent === 'heading>heading', v1)
  await shot(W, '30-bubble-heading.png')

  // ② 正文内选区（对照）
  const v2j = await select(`const p = document.querySelector('.ProseMirror p')
    const r = document.createRange(); r.selectNodeContents(p); sel.addRange(r)`)
  const v2 = JSON.parse(v2j); rec('选中正文文字：气泡可见（对照）', v2.v === 'visible' && v2.parent === 'paragraph>paragraph', v2)
  await shot(W, '31-bubble-para.png')

  // ③ 跨块选区：段落中段 → 二级标题内
  const v3j = await select(`const p = document.querySelector('.ProseMirror p')
    const h2 = document.querySelector('.ProseMirror h2')
    const r = document.createRange()
    r.setStart(p.firstChild, 5); r.setEnd(h2.firstChild, 2); sel.addRange(r)`)
  const v3 = JSON.parse(v3j); rec('从正文划到标题的跨块选区：气泡隐藏', (v3.v === 'hidden' || v3.v.startsWith('missing')) && v3.parent === 'paragraph>heading', v3)

  // ④ 代码块内选区（原有行为回归）
  const v4j = await select(`const pre = document.querySelector('.ProseMirror pre code')
    const r = document.createRange(); r.selectNodeContents(pre); sel.addRange(r)`)
  const v4 = JSON.parse(v4j); rec('选中代码块文字：气泡隐藏（回归）', (v4.v === 'hidden' || v4.v.startsWith('missing')) && v4.parent === 'codeBlock>codeBlock', v4)

  fs.writeFileSync(OUT, JSON.stringify({ results }, null, 2))
  try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {}
  app.exit(0)
}).catch((e) => { fs.writeFileSync(OUT, JSON.stringify({ err: e.stack })); app.exit(1) })
