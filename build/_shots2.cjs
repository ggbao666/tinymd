// 第二批截图：亮色主题 / 右键菜单 / 斜杠菜单 / 代码块 / 空态
const fs = require('fs')
const os = require('os')
const path = require('path')
const { app, BrowserWindow } = require('electron')
const ROOT = path.resolve(__dirname, '..')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tinymd_shots2_'))
const OUT = path.join(__dirname, '_shots')
fs.mkdirSync(OUT, { recursive: true })
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu')
app.disableHardwareAcceleration()
app.setPath('userData', path.join(TMP, 'user-data'))

const WS = path.join(TMP, 'ws')
fs.mkdirSync(WS, { recursive: true })
const A = path.join(WS, '长文档.md')
fs.writeFileSync(A, [
  '# 长文档', '', '开头段落。', '', '## 第一节', '', '```python',
  'def hello(name: str) -> str:',
  '    """打招呼。"""',
  '    return f"你好, {name}!"', '```', '',
  '> 引用块第二例，检查亮色主题下的边框与文字对比度。', '',
  '## 第二节', '',
  '| 列甲 | 列乙 | 列丙 |', '|---|---|---|', '| 1 | 2 | 3 |', '| 4 | 5 | 6 |', '',
  '中间段落，用来把代码块推到首屏之外。', '',
].join('\n'))
const B = path.join(WS, '笔记乙.md')
fs.writeFileSync(B, '# 笔记乙\n\n乙的内容。\n')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const js = (w, code) => w.webContents.executeJavaScript(code)
const log = (m) => { fs.appendFileSync(path.join(OUT, 'shots2.log'), m + '\n') }
fs.writeFileSync(path.join(OUT, 'shots2.log'), 'start\n')

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

  // 1) 树行右键菜单
  await js(W, `(() => { const r = document.querySelector(${JSON.stringify(rowSel(B))}); const rc = r.getBoundingClientRect(); r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rc.left + 40, clientY: rc.top + 6 })); return true })()`)
  await sleep(500)
  await shot(W, '13-tree-contextmenu')
  await js(W, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`)
  await sleep(300)

  // 2) 斜杠菜单（正文空行输入 /）
  await js(W, `(() => { const pm = document.querySelector('#editor .ProseMirror'); pm.focus(); const sel = getSelection(); const last = pm.lastElementChild; const r = document.createRange(); r.selectNodeContents(last); r.collapse(false); sel.removeAllRanges(); sel.addRange(r); document.execCommand('insertText', false, '/'); return true })()`)
  await sleep(600)
  await shot(W, '14-slash-menu')
  await js(W, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`)
  await sleep(300)

  // 3) 代码块特写（滚到代码块）
  await js(W, `(() => { const pre = document.querySelector('#editor pre'); if (pre) pre.scrollIntoView({ block: 'center' }); return true })()`)
  await sleep(500)
  await shot(W, '15-codeblock-neutral')

  // 4) 亮色主题（渲染层是事实源：写 localStorage + reload）
  await js(W, `localStorage.setItem('jianmo.theme', 'light'); location.reload(); true`)
  await new Promise((r) => W.webContents.once('did-finish-load', r))
  await sleep(900)
  await js(W, `(() => { const pm = document.querySelector('#editor .ProseMirror'); if (pm) pm.focus(); return true })()`)
  await sleep(300)
  await js(W, `(() => { const pre = document.querySelector('#editor pre'); if (pre) pre.scrollIntoView({ block: 'center' }); return true })()`)
  await sleep(500)
  await shot(W, '16-codeblock-light')
  await js(W, `(() => { const w = document.querySelector('#editor-wrap'); if (w) w.scrollTop = 0; return true })()`)
  await sleep(500)
  await shot(W, '17-workspace-light-top')

  // 5) 编辑区空态（关掉当前文档没法直接做；改用新建目录看空态）
  await js(W, `localStorage.setItem('jianmo.theme', 'neutral'); localStorage.setItem('jianmo.recents', ${JSON.stringify(JSON.stringify([{ path: path.join(TMP, 'empty-ws'), name: 'empty', time: Date.now(), kind: 'dir' }]))}); location.reload(); true`)
  await new Promise((r) => W.webContents.once('did-finish-load', r))
  await sleep(700)
  fs.mkdirSync(path.join(TMP, 'empty-ws'), { recursive: true })
  await js(W, `document.querySelector('.recent-row').click(); true`)
  await sleep(1200)
  await shot(W, '18-editor-empty')

  console.log('DONE2')
  app.exit(0)
})
