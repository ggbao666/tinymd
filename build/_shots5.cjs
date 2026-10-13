/* 截图：查找命中（紫）与 ==高亮== mark（黄）同屏对比，两套主题 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { app, BrowserWindow, dialog } = require('electron')

const ROOT = path.resolve(__dirname, '..')
const SHOT = path.join(__dirname, '_shots')
fs.mkdirSync(SHOT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const js = (w, code) => w.webContents.executeJavaScript(code)
const J = (s) => JSON.stringify(s)
const shot = async (w, name) => {
  const img = await w.webContents.capturePage()
  fs.writeFileSync(path.join(SHOT, name), img.toPNG())
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tinymd_shots5_'))
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
  fs.writeFileSync(path.join(WS, 'doc.md'), [
    '# 高亮对比样张', '',
    '这是 ==黄色高亮== 的效果，它来自 ==高亮== 语法。', '',
    'apple 是查找命中，apple 会以紫色底出现；再一个 apple 在本段。', '',
    '## 第二节', '',
    '更多内容：apple 与 ==高亮== 混排，apple 紧挨着 ==高亮== 一起看区分度。', '',
    '最后一行 apple 收尾。',
  ].join('\n'))

  await js(W, `localStorage.setItem('jianmo.recents', ${J(JSON.stringify([{ path: WS.replace(/\\/g, '/'), name: 's5', time: Date.now(), kind: 'dir' }]))}); location.reload(); 1`)
  await sleep(1500)
  await js(W, `(document.querySelector('.recent-row') || { click() {} }).click(); 1`)
  await sleep(1200)
  await js(W, `const r = document.querySelector('.tree-row.file[data-path*="doc.md"]'); r.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); r.click(); 1`)
  await sleep(1200)

  await js(W, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true })); 1`)
  await sleep(400)
  await js(W, `(() => { const i = document.querySelector('#find-input'); i.value = 'apple'; i.dispatchEvent(new Event('input', { bubbles: true })); return 1 })()`)
  await sleep(700)
  await shot(W, '26-findcolor-neutral.png')

  // 当前命中走到第 3 条（第二节附近），看看滚动定位后的效果
  for (let i = 0; i < 2; i++) { await js(W, `document.querySelector('#find-next').click(); 1`); await sleep(400) }
  await sleep(400)
  await shot(W, '27-findcolor-current3.png')

  // 切亮色主题
  await js(W, `localStorage.setItem('jianmo.theme', 'light'); location.reload(); 1`)
  await sleep(1500)
  await js(W, `(document.querySelector('.recent-row') || { click() {} }).click(); 1`)
  await sleep(1200)
  await js(W, `const r = document.querySelector('.tree-row.file[data-path*="doc.md"]'); r.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); r.click(); 1`)
  await sleep(1200)
  await js(W, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true })); 1`)
  await sleep(400)
  await js(W, `(() => { const i = document.querySelector('#find-input'); i.value = 'apple'; i.dispatchEvent(new Event('input', { bubbles: true })); return 1 })()`)
  await sleep(700)
  await shot(W, '28-findcolor-light.png')

  try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {}
  app.exit(0)
}).catch((e) => { console.error(e); try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {}; app.exit(1) })
