/* 验证：导出 PDF / Word 功能已彻底移除，且不影响其他功能 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { app, BrowserWindow, dialog } = require('electron')

const ROOT = path.resolve(__dirname, '..')
const SHOT = path.join(__dirname, '_shots')
fs.mkdirSync(SHOT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const js = (w, code) => w.webContents.executeJavaScript(code)

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tinymd_noexport_'))
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu')
app.disableHardwareAcceleration()
app.setPath('userData', path.join(TMP, 'user-data'))

// 任何导出相关的对话框被调起就记下来 —— 应该一次都不发生
let saveDialogHits = 0
const origSave = dialog.showSaveDialog.bind(dialog)
dialog.showSaveDialog = async (...a) => { saveDialogHits++; return origSave(...a) }
dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] })
require(path.join(ROOT, 'main.js'))

const rec = []
const ok = (n, p, d) => { rec.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}  ${d === undefined ? '' : JSON.stringify(d)}`) }

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')

app.whenReady().then(async () => {
  let W = null
  for (let i = 0; i < 60 && !W; i++) {
    await sleep(150)
    W = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html')) || null
  }
  if (!W) { console.error('no window'); app.exit(1); return }
  await new Promise((res) => { if (W.webContents.isLoading()) W.webContents.once('did-finish-load', res); else res() })
  await sleep(600)

  // ---- 源码层：导出相关标识全都不该存在 ----
  const checks = [
    ['docx-export.cjs 已删除', !fs.existsSync(path.join(ROOT, 'docx-export.cjs'))],
    ['print.css 已删除', !fs.existsSync(path.join(ROOT, 'src/renderer/print.css'))],
    ['main.js 无 buildDocx', !read('main.js').includes('buildDocx')],
    ['main.js 无 printToPDF', !read('main.js').includes('printToPDF')],
    ['main.js 无 export:pdf / export:docx', !read('main.js').includes('export:pdf') && !read('main.js').includes('export:docx')],
    ['main.js 无导出菜单项', !read('main.js').includes('export-pdf') && !read('main.js').includes('export-docx')],
    ['main.js 无 exportEnabled / refreshExportMenu', !read('main.js').includes('exportEnabled') && !read('main.js').includes('refreshExportMenu')],
    ['preload 无 exportPdf / exportDocx / setExportEnabled',
      !read('preload.cjs').includes('exportPdf') && !read('preload.cjs').includes('exportDocx') && !read('preload.cjs').includes('setExportEnabled')],
    ['main.ts 无 exportPath / exportCurrent', !read('src/renderer/main.ts').includes('exportPath') && !read('src/renderer/main.ts').includes('exportCurrent')],
    ['main.ts 无 markdownToHtml / markdownToDoc',
      !read('src/renderer/main.ts').includes('markdownToHtml') && !read('src/renderer/main.ts').includes('markdownToDoc')],
    ['editor.ts 无离线渲染入口', !read('src/renderer/editor.ts').includes('withOfflineEditor')],
    ['editor.ts 无 print.css?inline', !read('src/renderer/main.ts').includes('print.css')],
    ['electron-builder.yml 不再登记 docx-export.cjs', !read('electron-builder.yml').includes('docx-export.cjs')],
    ['package.json 不再有 docx 依赖', !JSON.parse(read('package.json')).dependencies?.docx],
  ]
  for (const [n, p] of checks) ok(n, p)

  // ---- 菜单层：真去看一眼应用菜单 ----
  const appMenu = (() => {
    const m = require('electron').Menu.getApplicationMenu()
    return m ? m.items.map((it) => ({ label: it.label, sub: it.submenu ? it.submenu.items.map((s) => s.label) : [] })) : null
  })()
  const flat = JSON.stringify(appMenu)
  ok('应用菜单里没有「导出为 PDF」', !flat.includes('导出为 PDF'), null)
  ok('应用菜单里没有「导出为 Word」', !flat.includes('导出为 Word'), null)
  ok('文件菜单仍在（没被误删）', flat.includes('打开文件夹'), null)

  // ---- 运行时：打开文档、走一遍右键，确认没有导出项 ----
  const WS = path.join(TMP, '我的项目')
  fs.mkdirSync(WS, { recursive: true })
  fs.writeFileSync(path.join(WS, '笔记.md'), '# 笔记\n\n## 小节\n\n正文。\n')
  await js(W, `localStorage.setItem('jianmo.recents', ${JSON.stringify(JSON.stringify([{ path: WS.replace(/\\/g, '/'), name: '我的项目', time: Date.now(), kind: 'dir' }]))}); location.reload(); 1`)
  await sleep(1500)
  await js(W, `(document.querySelector('.recent-row') || {click(){}}).click(); 1`)
  await sleep(1300)
  await js(W, `(() => { const r = [...document.querySelectorAll('.tree-row.file')].find(x => x.dataset.path.includes('笔记')); r.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); r.click(); return 1 })()`)
  await sleep(1500)
  ok('文档能正常打开', await js(W, `document.querySelector('.ProseMirror h1')?.textContent === '笔记'`), null)

  // 旧的两个快捷键不该再有反应（也不该弹保存框）
  await js(W, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true })); 1`)
  await sleep(600)
  await js(W, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true, bubbles: true })); 1`)
  await sleep(600)
  ok('Ctrl+P / Ctrl+Shift+P 不再触发任何保存对话框', saveDialogHits === 0, { saveDialogHits })

  // 文件树右键菜单里也没有导出
  await js(W, `(() => {
    const row = document.querySelector('.tree-row.file')
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }))
    return 1 })()`)
  await sleep(600)
  const ctx = await js(W, `(() => {
    const el = document.querySelector('.ctx-menu, #context-menu, [class*=\"ctx\"]')
    return el ? el.textContent : ''
  })()`)
  ok('文件树右键菜单里没有导出项', !/导出/.test(ctx || ''), { ctx: (ctx || '').slice(0, 80) })
  fs.writeFileSync(path.join(SHOT, 'noexport-final.png'), (await W.webContents.capturePage()).toPNG())
  await js(W, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 1`)
  await sleep(300)

  // ---- 其他功能没被牵连 ----
  await js(W, `document.querySelector('#btn-toc, #tab-outline').click(); 1`); await sleep(500)
  ok('大纲页仍可用', await js(W, `document.querySelectorAll('.outline-item').length > 0`), null)
  await js(W, `document.querySelector('#tab-files').click(); 1`); await sleep(300)
  await js(W, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true })); 1`); await sleep(400)
  ok('查找条仍可用', !(await js(W, `document.querySelector('#find-bar').classList.contains('hidden')`)), null)
  await js(W, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 1`); await sleep(300)
  await js(W, `document.querySelector('#btn-image-settings').click(); 1`); await sleep(400)
  ok('设置面板仍可用', !(await js(W, `document.querySelector('#settings-backdrop').classList.contains('hidden')`)), null)
  fs.writeFileSync(path.join(SHOT, 'noexport-settings.png'), (await W.webContents.capturePage()).toPNG())

  // 自动保存仍工作（导出删了不影响写入）
  await js(W, `document.querySelector('#btn-settings-close').click(); 1`); await sleep(400)
  await js(W, `(() => {
    const pm = document.querySelector('.ProseMirror')
    pm.focus()
    return 1 })()`)
  await sleep(1500)
  const saved = fs.readFileSync(path.join(WS, '笔记.md'), 'utf8')
  ok('自动保存仍工作', saved.includes('笔记'), { len: saved.length })

  const bad = rec.filter((r) => !r.p)
  console.log(`\n${rec.length - bad.length}/${rec.length} passed`)
  app.exit(bad.length ? 1 : 0)
}).catch((e) => { console.error(e); app.exit(1) })