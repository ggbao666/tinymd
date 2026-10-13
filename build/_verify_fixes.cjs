// 第二轮修复（D1–D4 / E1–E7）的端到端验证：真实 require main.js、真实 IPC、真实 UI 事件。
// 跑法：unset ELECTRON_RUN_AS_NODE && ./node_modules/.bin/electron build/_verify_fixes.cjs
const fs = require('fs')
const os = require('os')
const path = require('path')
const { app, BrowserWindow, dialog, ipcMain } = require('electron')

const ROOT = path.resolve(__dirname, '..')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tinymd_verify_fixes_'))
const RESULT = path.join(__dirname, '_verify_fixes.json')
const STAGE = path.join(__dirname, '_verify_fixes.stage.json')
const stage = (s) => { try { fs.writeFileSync(STAGE, JSON.stringify({ stage: s, at: Date.now() })) } catch {} }
stage('init')

// ---------- 沙箱与隔离（必须在 require main.js 之前） ----------
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu')
app.disableHardwareAcceleration()
app.setPath('userData', path.join(TMP, 'user-data'))

// ---------- 截获 ui:menu 载荷（E2 断言点）+ 拦截打开对话框（E1 断言点） ----------
const menuPayloads = []
const origHandle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, fn) => origHandle(channel, (e, ...args) => {
  if (channel === 'ui:menu') menuPayloads.push(args[0])
  return fn(e, ...args)
})
const dialogCalls = []
dialog.showOpenDialog = async (parent, opts) => { dialogCalls.push(opts); return { canceled: true, filePaths: [] } }

// ---------- 测试素材 ----------
const WS = path.join(TMP, 'ws')
const OUTER = path.join(TMP, 'outer')
const JUNKDIR = path.join(TMP, 'junk')
for (const d of [WS, OUTER, JUNKDIR]) fs.mkdirSync(d, { recursive: true })
const A = path.join(WS, 'a.md')
const B = path.join(WS, 'b.md')
const C = path.join(OUTER, 'c.md')
const D = path.join(OUTER, 'd.md')
const E = path.join(OUTER, 'e.md')

fs.writeFileSync(A, [
  '# 主文档 A', '', '## 第一节', '', '正文内容 alpha。', '',
  '| LongHeaderColumn001 | LongHeaderColumn002 | LongHeaderColumn003 | LongHeaderColumn004 | LongHeaderColumn005 | LongHeaderColumn006 | LongHeaderColumn007 | LongHeaderColumn008 | LongHeaderColumn009 | LongHeaderColumn010 | LongHeaderColumn011 | LongHeaderColumn012 |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|',
  '| 数据一 | 数据二 | 数据三 | 数据四 | 数据五 | 数据六 | 数据七 | 数据八 | 数据九 | 数据十 | 数据十一 | 数据十二 |',
  '| 数据一 | 数据二 | 数据三 | 数据四 | 数据五 | 数据六 | 数据七 | 数据八 | 数据九 | 数据十 | 数据十一 | 数据十二 |',
  '', '## 第二节', '', '结尾内容 omega。', '',
].join('\n'))
fs.writeFileSync(B, '# B 文档\n\nb 的内容 bravo。\n')
fs.writeFileSync(C, '# C\n\nc 的内容 charlie。\n')
fs.writeFileSync(D, '# D\n\nd 的内容 delta。\n')
fs.writeFileSync(E, '# E\n\ne 的内容 echo。\n')
const junk = []
for (let i = 0; i < 210; i++) { const p = path.join(JUNKDIR, `j${i}.md`); fs.writeFileSync(p, 'x'); junk.push(p) }

// ---------- 启动真实应用 ----------
stage('require main')
require(path.join(ROOT, 'main.js'))

const results = []
let failed = 0
function rec(name, ok, info) {
  results.push({ name, ok: !!ok, info: info === undefined ? undefined : info })
  if (!ok) failed++
}
function finish(tag, err) {
  rec('崩溃兜底: ' + tag, false, err && err.message)
  try { fs.writeFileSync(RESULT, JSON.stringify({ failed, results }, null, 2)) } catch {}
  app.exit(1)
}
process.on('uncaughtException', (e) => finish('uncaughtException', e))
process.on('unhandledRejection', (e) => finish('unhandledRejection', e))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const js = (w, code) => w.webContents.executeJavaScript(code)
async function awaitJs(w, code, timeout = 9000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    try { if (await js(w, code)) return true } catch { /* keep polling */ }
    await sleep(150)
  }
  return false
}
const J = (v) => JSON.stringify(v)

app.whenReady().then(async () => {
  stage('wait window')
  let W = null
  for (let i = 0; i < 60 && !W; i++) {
    W = BrowserWindow.getAllWindows()[0] || null
    if (!W) await sleep(200)
  }
  if (!W) { finish('no window', new Error('主窗口未出现')); return }
  if (W.webContents.isLoading()) await new Promise((r) => W.webContents.once('did-finish-load', r))
  await sleep(600)

  // ========== 阶段一：工作空间模式（主窗口） ==========
  stage('phase1 workspace')
  await js(W, `localStorage.setItem('jianmo.recents', ${J(JSON.stringify([{ path: WS, name: 'ws', time: Date.now(), kind: 'dir' }]))}); location.reload(); true`)
  await new Promise((r) => W.webContents.once('did-finish-load', r))
  await sleep(600)
  await js(W, `document.querySelector('.recent-row').click(); true`)
  const rowSel = (p) => `.tree-row.file[data-path=${J(p)}]`
  if (!await awaitJs(W, `!!document.querySelector(${J(rowSel(A))})`)) { finish('phase1', new Error('文件树未出现')); return }
  await js(W, `document.querySelector(${J(rowSel(A))}).click(); true`)
  if (!await awaitJs(W, `!!(document.querySelector('#editor .ProseMirror') && document.querySelector('#editor .ProseMirror').innerText.includes('alpha'))`)) {
    finish('phase1', new Error('a.md 未打开'))
    return
  }
  rec('前置：工作空间 + a.md 打开', true)

  // ---- E7：宽表格横向滚动 ----
  const e7 = await js(W, `(() => { const w = document.querySelector('.ProseMirror .tableWrapper'); return w ? { sw: w.scrollWidth, cw: w.clientWidth, ox: getComputedStyle(w).overflowX } : null })()`)
  rec('E7 宽表格包在 tableWrapper 里', !!e7, e7)
  rec('E7 表格超宽（scrollWidth > clientWidth）', e7 && e7.sw > e7.cw, e7)
  rec('E7 wrapper overflow-x = auto', e7 && e7.ox === 'auto', e7)

  // ---- E4：Enter 打开被别的窗口占用的文件，高亮回退 ----
  const opened = await js(W, `window.api.openInNewWindow(${J(B)})`)
  rec('E4 前置：b.md 开到独立窗口', opened === 'opened', opened)
  await sleep(1800)
  await js(W, `(() => { const r = document.querySelector(${J(rowSel(B))}); r.focus(); r.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); return true })()`)
  await sleep(900)
  const e4 = await js(W, `(() => ({ sel: (document.querySelector('.tree-row.selected') || {}).dataset?.path || '', ed: !!(document.querySelector('#editor .ProseMirror') || {}).innerText && document.querySelector('#editor .ProseMirror').innerText.includes('alpha'), st: document.querySelector('#status')?.textContent || '' }))()`)
  rec('E4 Enter 失败后高亮回退 a.md', e4.sel === A, e4)
  rec('E4 编辑器仍是 a.md', e4.ed, e4)
  rec('E4 状态栏提示被占用', e4.st.includes('已在另一个窗口中打开'), e4)
  // 关掉 b.md 的独立窗口
  const stB = BrowserWindow.getAllWindows().find((w) => w !== W)
  await new Promise((r) => { stB.once('closed', r); stB.close() })
  await sleep(400)

  // ---- E6：浮层开着时 Esc 只关浮层，不连带关目录 ----
  await js(W, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, shiftKey: true, bubbles: true })); true`)
  await sleep(350)
  rec('E6 前置：目录展开', await js(W, `document.body.classList.contains('toc-open')`) === true)
  W.webContents.send('menu', 'link')
  await sleep(300)
  rec('E6 前置：链接浮层打开', await js(W, `!document.querySelector('#link-popover').classList.contains('hidden')`) === true)
  // Esc 打在浮层输入框上（真实路径：焦点在输入框、事件先过 input 再冒泡到 document）
  await js(W, `document.querySelector('#link-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); true`)
  await sleep(250)
  const e6 = await js(W, `({ popHidden: document.querySelector('#link-popover').classList.contains('hidden'), toc: document.body.classList.contains('toc-open') })`)
  rec('E6 Esc 只关浮层、目录仍在', e6.popHidden === true && e6.toc === true, e6)
  await js(W, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`)
  await sleep(250)
  rec('E6 再按 Esc 才关目录', await js(W, `document.body.classList.contains('toc-open')`) === false)

  // ---- E5：目录开着 + 窄窗口下浮层左缘不出窗 ----
  const bounds0 = W.getBounds()
  W.setBounds({ x: bounds0.x, y: bounds0.y, width: 810, height: bounds0.height })
  await sleep(450)
  await js(W, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, shiftKey: true, bubbles: true })); true`)
  await sleep(350)
  W.webContents.send('menu', 'link')
  await sleep(300)
  const e5 = await js(W, `(() => { const r = document.querySelector('#link-popover').getBoundingClientRect(); return { l: Math.round(r.left), w: Math.round(r.width), vw: innerWidth } })()`)
  rec('E5 目录+窄窗下浮层左缘不出窗', e5.l >= 0, e5)
  await js(W, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`)
  await sleep(250)
  await js(W, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`)
  await sleep(250)
  W.setBounds({ x: bounds0.x, y: bounds0.y, width: bounds0.width, height: bounds0.height })
  await sleep(300)

  // ---- D1（catch 路径回归）：点一个刚被外部删除的文件，归属还给屏幕上的 a.md ----
  fs.unlinkSync(B)
  const clicked = await js(W, `(() => { const r = document.querySelector(${J(rowSel(B))}); if (!r) return false; r.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true })()`)
  await sleep(1300)
  const d1 = await js(W, `(() => ({ st: document.querySelector('#status')?.textContent || '', ed: document.querySelector('#editor .ProseMirror').innerText.includes('alpha'), sel: (document.querySelector('.tree-row.selected') || {}).dataset?.path || '' }))()`)
  rec('D1 点击已删除文件后仍提示读失败', clicked && d1.st.includes('无法打开文件'), d1)
  rec('D1 编辑器保持 a.md', d1.ed, d1)
  rec('D1 树高亮回退 a.md', d1.sel === A, d1)
  const back = await js(W, `window.api.openInNewWindow(${J(A)})`)
  rec('D1 归属已还给主窗口（a.md 再开 = focus）', back === 'focus', back)

  // ---- E2：树行右键弹对应菜单；空白右键弹根菜单（菜单是自绘 DOM，看 .ctx-menu） ----
  const closeCtx = () => js(W, `document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); true`)
  await js(W, `(() => { const r = document.querySelector(${J(rowSel(A))}); const rc = r.getBoundingClientRect(); r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rc.left + 30, clientY: rc.top + 5 })); return true })()`)
  let okFile = false
  for (let i = 0; i < 30 && !okFile; i++) { await sleep(100); okFile = await js(W, `!!document.querySelector('.ctx-menu') && [...document.querySelectorAll('.ctx-menu .ctx-item')].some((el) => el.textContent.includes('重命名'))`) }
  rec('E2 文件行右键弹文件菜单（含重命名）', okFile)
  await closeCtx(); await sleep(200)
  await js(W, `(() => { const t = document.querySelector('#tree'); const rc = t.getBoundingClientRect(); t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rc.left + 5, clientY: rc.bottom - 5 })); return true })()`)
  let okRoot = false
  for (let i = 0; i < 30 && !okRoot; i++) { await sleep(100); okRoot = await js(W, `!!document.querySelector('.ctx-menu') && [...document.querySelectorAll('.ctx-menu .ctx-item')].some((el) => el.textContent.includes('新建文件'))`) }
  rec('E2 空白右键弹根菜单（含新建文件）', okRoot)
  await closeCtx(); await sleep(200)

  // ========== 阶段二：独立窗口（单文件形态） ==========
  stage('phase2 standalone')
  const r2 = await js(W, `window.api.openInNewWindow(${J(D)})`)
  rec('阶段二前置：d.md 开到独立窗口', r2 === 'opened', r2)
  await sleep(1800)
  const SA = BrowserWindow.getAllWindows().find((w) => w !== W)

  // ---- E1：独立窗口里 Ctrl+O（打开文件夹）被拦，不弹对话框不进错位状态 ----
  SA.webContents.send('menu', 'open-folder')
  await sleep(700)
  rec('E1 独立窗口 open-folder 被拦（零对话框）', dialogCalls.length === 0, dialogCalls)

  // ---- 在独立窗口里切到单文件 c.md（走最近打开） ----
  await js(SA, `localStorage.setItem('jianmo.recents', ${J(JSON.stringify([{ path: C, name: 'c.md', time: Date.now(), kind: 'file' }]))}); location.reload(); true`)
  await new Promise((r) => SA.webContents.once('did-finish-load', r))
  await sleep(1500)
  await js(SA, `document.querySelector('.recent-row').click(); true`)
  await sleep(1200)
  rec('阶段二前置：独立窗口切到 c.md', await js(SA, `!!(document.querySelector('#editor .ProseMirror') || {}).innerText && document.querySelector('#editor .ProseMirror').innerText.includes('charlie')`) === true)

  // ---- D4：单文件模式的外部修改检测（干净 → 回读） ----
  fs.writeFileSync(C, '# C\n\n外部修改 victor 两遍。\n')
  await sleep(2600)
  rec('D4 单文件模式外部修改被回读', await js(SA, `document.querySelector('#editor .ProseMirror').innerText.includes('victor')`) === true)

  // ---- D3：allowedFiles 超额按 LRU 淘汰，占用中的文档权限保留 ----
  await js(SA, `(async () => { for (const p of ${J(junk)}) await window.api.allowFile(p); return true })()`)
  const rc1 = await js(SA, `window.api.read(${J(C)}).then((t) => t.slice(0, 20), (e) => 'ERR:' + e.message)`)
  rec('D3 占用中的 c.md 读权限保留', !String(rc1).startsWith('ERR'), rc1)
  const rc2 = await js(SA, `window.api.write(${J(junk[0])}, 'x').then(() => 'ok', (e) => 'ERR:' + e.message)`)
  rec('D3 超额后最旧的非占用条目被淘汰', String(rc2).startsWith('ERR') && String(rc2).includes('不在当前工作空间'), rc2)

  // ========== 阶段三：主窗口关闭后，双击 .md 派发到独立窗口（D2） ==========
  stage('phase3 sendOpenFile')
  await new Promise((r) => { W.once('closed', r); W.close() })
  await sleep(600)
  app.emit('second-instance', {}, [process.execPath, E])
  await sleep(2200)
  const d2 = await js(SA, `(() => ({ title: document.title, crumb: document.querySelector('#breadcrumb')?.textContent || '', ed: document.querySelector('#editor .ProseMirror').innerText.includes('echo') }))()`)
  rec('D2 双击 .md 派发到独立窗口（标题含 e.md）', d2.title.includes('e.md'), d2)
  rec('D2 编辑器显示 e.md 内容', d2.ed, d2)

  stage('done')
  fs.writeFileSync(RESULT, JSON.stringify({ failed, results, tmp: TMP }, null, 2))
  console.log(`\n${failed ? 'FAILED' : 'ALL PASS'}: ${results.length - failed}/${results.length}`)
  app.exit(failed ? 1 : 0)
}).catch((e) => finish('whenReady', e))
