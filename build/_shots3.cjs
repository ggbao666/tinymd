// 第三批截图：代码块复制按钮 + 自绘复选框（中性/亮色两套主题）
const fs = require('fs')
const os = require('os')
const path = require('path')
const { app, BrowserWindow } = require('electron')
const ROOT = path.resolve(__dirname, '..')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tinymd_shots3_'))
const OUT = path.join(__dirname, '_shots')
fs.mkdirSync(OUT, { recursive: true })
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu')
app.disableHardwareAcceleration()
app.setPath('userData', path.join(TMP, 'user-data'))

const WS = path.join(TMP, 'ws')
fs.mkdirSync(WS, { recursive: true })
const A = path.join(WS, '样张.md')
fs.writeFileSync(A, [
  '# 样张', '',
  '- [x] 已完成任务', '- [ ] 未完成任务', '- [ ] 另一个未完成', '',
  '```ts', 'interface User {', '  id: number', '  name: string', '}', '```', '',
  '再一段文字。', '',
].join('\n'))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const js = (w, code) => w.webContents.executeJavaScript(code)
const log = (m) => { fs.appendFileSync(path.join(OUT, 'shots3.log'), m + '\n') }
fs.writeFileSync(path.join(OUT, 'shots3.log'), 'start\n')

async function shot(w, name) {
  const img = await w.webContents.capturePage()
  fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG())
  log('shot: ' + name)
}

process.on('uncaughtException', (e) => { log('uncaught: ' + e.message); app.exit(1) })
process.on('unhandledRejection', (e) => { log('unhandled: ' + (e && e.message)); app.exit(1) })

require(path.join(ROOT, 'main.js'))

app.whenReady().then(async () => {
  let W = null
  for (let i = 0; i < 60 && !W; i++) { W = BrowserWindow.getAllWindows()[0] || null; if (!W) await sleep(200) }
  if (W.webContents.isLoading()) await new Promise((r) => W.webContents.once('did-finish-load', r))
  await sleep(700)

  await js(W, `localStorage.setItem('jianmo.recents', ${JSON.stringify(JSON.stringify([{ path: WS, name: 'ws', time: Date.now(), kind: 'dir' }]))}); location.reload(); true`)
  await new Promise((r) => W.webContents.once('did-finish-load', r))
  await sleep(700)
  await js(W, `document.querySelector('.recent-row').click(); true`)
  await sleep(900)
  const rowSel = (p) => `.tree-row.file[data-path=${JSON.stringify(p)}]`
  for (let i = 0; i < 40; i++) { if (await js(W, `!!document.querySelector(${JSON.stringify(rowSel(A))})`)) break; await sleep(150) }
  await js(W, `document.querySelector(${JSON.stringify(rowSel(A))}).click(); true`)
  await sleep(1200)

  // 1) 中性主题：悬停代码块 → 复制按钮出现
  const hov = await js(W, `(() => {
    const pre = document.querySelector('#editor pre');
    const r = pre.getBoundingClientRect();
    pre.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: r.left + 40, clientY: r.top + 10 }));
    return true
  })()`)
  await sleep(400)
  const st1 = await js(W, `(() => { const b = document.querySelector('#code-copy'); const r = b.getBoundingClientRect(); const pr = document.querySelector('#editor pre').getBoundingClientRect(); return { hidden: b.classList.contains('hidden'), left: Math.round(r.left), top: Math.round(r.top), preRight: Math.round(pr.right), preBottom: Math.round(pr.bottom) } })()`)
  log('copybtn neutral: ' + JSON.stringify(st1))
  await shot(W, '19-copybtn-neutral')

  // 2) 点击复制（验证剪贴板）
  const cp = await js(W, `(() => { document.querySelector('#code-copy').click(); return true })()`)
  await sleep(300)
  const st2 = await js(W, `document.querySelector('#code-copy').classList.contains('copied')`)
  log('clicked: ' + cp + ' copied-class: ' + st2)
  await shot(W, '20-copybtn-copied')

  // 3) 亮色主题同款（渲染层为事实源：写 localStorage + reload 后重新进工作空间）
  await js(W, `localStorage.setItem('jianmo.theme', 'light'); location.reload(); true`)
  await new Promise((r) => W.webContents.once('did-finish-load', r))
  await sleep(800)
  await js(W, `document.querySelector('.recent-row').click(); true`)
  await sleep(900)
  for (let i = 0; i < 40; i++) { if (await js(W, `!!document.querySelector(${JSON.stringify(rowSel(A))})`)) break; await sleep(150) }
  await js(W, `document.querySelector(${JSON.stringify(rowSel(A))}).click(); true`)
  await sleep(1200)
  await js(W, `(() => { const pre = document.querySelector('#editor pre'); const r = pre.getBoundingClientRect(); pre.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: r.left + 40, clientY: r.top + 10 })); return true })()`)
  await sleep(400)
  await shot(W, '21-copybtn-light')

  // 4) 亮色主题的任务列表 + 复选框特写（顶部）
  await js(W, `(() => { const w = document.querySelector('#editor-wrap'); if (w) w.scrollTop = 0; return true })()`)
  await sleep(400)
  await shot(W, '22-light-checkbox')
  console.log('DONE3')
  app.exit(0)
})
