// 查找条视觉截图（中性 + 亮色，含替换展开）
const fs = require('fs')
const os = require('os')
const path = require('path')
const { app, BrowserWindow, dialog } = require('electron')
const ROOT = path.resolve(__dirname, '..')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tinymd_shots4_'))
const OUT = path.join(__dirname, '_shots')
fs.mkdirSync(OUT, { recursive: true })
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu')
app.disableHardwareAcceleration()
app.setPath('userData', path.join(TMP, 'user-data'))
dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] })

const WS = path.join(TMP, 'ws')
fs.mkdirSync(WS, { recursive: true })
const A = path.join(WS, '样张.md')
fs.writeFileSync(A, '# 产品需求文档\n\n第一段：这里有一只 apple。\n\n第二段：另一只 Apple。\n\n第三段：还有 apple pie。\n')

require(path.join(ROOT, 'main.js'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const js = (w, c) => w.webContents.executeJavaScript(c)
const J = (v) => JSON.stringify(v)
async function shot(w, name) {
  const img = await w.webContents.capturePage()
  fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG())
}
process.on('uncaughtException', () => app.exit(1))
process.on('unhandledRejection', () => app.exit(1))

app.whenReady().then(async () => {
  let W = null
  for (let i = 0; i < 60 && !W; i++) { W = BrowserWindow.getAllWindows()[0] || null; if (!W) await sleep(200) }
  if (W.webContents.isLoading()) await new Promise((r) => W.webContents.once('did-finish-load', r))
  await sleep(700)
  await js(W, `localStorage.setItem('jianmo.recents', ${J(JSON.stringify([{ path: WS, name: 'ws', time: Date.now(), kind: 'dir' }]))}); location.reload(); true`)
  await new Promise((r) => W.webContents.once('did-finish-load', r))
  await sleep(700)
  await js(W, `document.querySelector('.recent-row').click(); true`)
  await sleep(900)
  const rowSel = (p) => `.tree-row.file[data-path=${JSON.stringify(p)}]`
  for (let i = 0; i < 40; i++) { if (await js(W, `!!document.querySelector(${J(rowSel(A))})`)) break; await sleep(150) }
  await js(W, `document.querySelector(${J(rowSel(A))}).click(); true`)
  await sleep(1300)

  // 中性主题：查找 + 替换展开，有命中
  await js(W, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', ctrlKey: true, bubbles: true, cancelable: true })); true`)
  await sleep(500)
  await js(W, `(() => { const el = document.querySelector('#find-input'); el.value = 'apple'; el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  await sleep(700)
  await shot(W, '23-findbar-neutral')

  // 无结果态（输入框描红）
  await js(W, `(() => { const el = document.querySelector('#find-input'); el.value = 'qqqq'; el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  await sleep(700)
  await shot(W, '24-findbar-nohit')

  // 亮色主题
  await js(W, `localStorage.setItem('jianmo.theme', 'light'); location.reload(); true`)
  await new Promise((r) => W.webContents.once('did-finish-load', r))
  await sleep(800)
  await js(W, `document.querySelector('.recent-row').click(); true`)
  await sleep(900)
  for (let i = 0; i < 40; i++) { if (await js(W, `!!document.querySelector(${J(rowSel(A))})`)) break; await sleep(150) }
  await js(W, `document.querySelector(${J(rowSel(A))}).click(); true`)
  await sleep(1300)
  await js(W, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', ctrlKey: true, bubbles: true, cancelable: true })); true`)
  await sleep(500)
  await js(W, `(() => { const el = document.querySelector('#find-input'); el.value = 'apple'; el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  await sleep(700)
  await shot(W, '25-findbar-light')
  app.exit(0)
})
