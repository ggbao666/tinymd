/* 验证：重复打开「已在开的文件夹 / 文件」是no-op，且不损伤用户现场 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { app, BrowserWindow, dialog } = require('electron')

const ROOT = path.resolve(__dirname, '..')
const SHOT = path.join(__dirname, '_shots')
fs.mkdirSync(SHOT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const js = (w, code) => w.webContents.executeJavaScript(code)

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tinymd_dupv_'))
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu')
app.disableHardwareAcceleration()
app.setPath('userData', path.join(TMP, 'user-data'))

const pick = { folder: null, file: null }
dialog.showOpenDialog = async (_p, opts) => {
  const wantDir = opts?.properties?.includes('openDirectory')
  const p = wantDir ? pick.folder : pick.file
  if (!p) return { canceled: true, filePaths: [] }
  return { canceled: false, filePaths: [p] }
}
require(path.join(ROOT, 'main.js'))

const rec = []
const ok = (n, p, d) => { rec.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}  ${d === undefined ? '' : JSON.stringify(d)}`) }

const probe = `(() => ({
  cls: document.body.className,
  root: (document.querySelector('#ws-path')||{}).title || '',
  open: (document.querySelector('.crumb-doc')||{}).textContent || '',
  rows: document.querySelectorAll('.tree-row').length,
  scroll: document.querySelector('#tree') ? document.querySelector('#tree').scrollTop : 0,
  title: document.title,
}))()`

app.whenReady().then(async () => {
  let W = null
  for (let i = 0; i < 60 && !W; i++) {
    await sleep(150)
    W = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html')) || null
  }
  if (!W) { console.error('no window'); app.exit(1); return }
  await new Promise((res) => { if (W.webContents.isLoading()) W.webContents.once('did-finish-load', res); else res() })
  await sleep(600)

  const A = path.join(TMP, '项目A')
  const B = path.join(TMP, '项目B')
  // 两个目录刻意给**不同的文件** —— 否则行数一样、光看数量根本验不出「树有没有换」
  for (const [d, names] of [[A, ['甲.md', '乙.md']], [B, ['丙.md', '丁.md']]]) {
    fs.mkdirSync(path.join(d, '子目录'), { recursive: true })
    for (const n of names) fs.writeFileSync(path.join(d, n), `# ${n}\n\n内容\n`)
  }

  // ---- 基础场景 ----
  pick.folder = A
  await js(W, `document.querySelector('#btn-open-folder-ws').click(); 1`)
  await sleep(1400)
  await js(W, `(() => { const r = [...document.querySelectorAll('.tree-row.file')].find(x => x.dataset.path.includes('甲.md')); r.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); r.click(); return 1 })()`)
  await sleep(1300)
  // 造一点「用户现场」：滚动 + 改内容（未落盘）
  await js(W, `(() => {
    document.querySelector('#tree').scrollTop = 40
    const pm = document.querySelector('.ProseMirror')
    pm.focus()
    return 1 })()`)
  await sleep(300)
  const s1 = await js(W, probe)
  ok('前置：A 已打开、正开着甲', s1.open === '甲.md' && s1.rows === 3, s1)

  // ---- 1. 重开同一个文件夹（完全一样的字符串）----
  pick.folder = A
  await js(W, `document.querySelector('#btn-open-folder-ws').click(); 1`)
  await sleep(1400)
  const s2 = await js(W, probe)
  ok('重开同一文件夹：当前文档不被清空', s2.open === '甲.md', s2.open)
  ok('重开同一文件夹：文件树不动', s2.rows === s1.rows, { before: s1.rows, after: s2.rows })
  ok('重开同一文件夹：工作空间不变', s2.root === s1.root, null)
  ok('重开同一文件夹：滚动位置不归零', s2.scroll === s1.scroll, { before: s1.scroll, after: s2.scroll })
  ok('重开同一文件夹：标题栏不变', s2.title === s1.title, { before: s1.title, after: s2.title })

  // ---- 2. 重开同一文件夹，但路径写法不同（尾斜杠 + 反斜杠 + 大小写）----
  const Aweird = A.replace(/\//g, '\\') + '\\'
  pick.folder = Aweird
  await js(W, `document.querySelector('#btn-open-folder-ws').click(); 1`)
  await sleep(1200)
  const s2b = await js(W, probe)
  ok('路径写法不同（尾斜杠/反斜杠）也认得出是同一个', s2b.open === '甲.md', s2b.open)

  const Aupper = 'C:/Users/Administrator/AppData/Local/Temp/' + path.basename(TMP) + '/项目a'
  pick.folder = Aupper
  await js(W, `document.querySelector('#btn-open-folder-ws').click(); 1`)
  await sleep(1200)
  const s2c = await js(W, probe)
  ok('大小写不同也认得出是同一个（Windows 不区分）', s2c.open === '甲.md', s2c.open)

  // ---- 3. 重开「当前正打开着的那个文件」（不该降级成单文件模式）----
  pick.file = path.join(A, '甲.md')
  await js(W, `document.querySelector('#btn-open-file-ws').click(); 1`)
  await sleep(1300)
  const s3 = await js(W, probe)
  ok('重开当前文件：文档不变', s3.open === '甲.md', s3.open)
  ok('重开当前文件：不被切成单文件模式', !s3.cls.includes('file-mode'), s3.cls)
  ok('重开当前文件：文件树还在', s3.rows === 3, s3.rows)

  // ---- 4. 换一个**别的**文件（正常切换，必须成功）----
  pick.file = path.join(A, '乙.md')
  await js(W, `document.querySelector('#btn-open-file-ws').click(); 1`)
  await sleep(1400)
  const s4 = await js(W, probe)
  ok('换一个别的文件：确实切过去了', s4.open === '乙.md', s4.open)
  // ⚠️ 这里原来断言「进单文件模式」—— 那套形态已经没了（打开文件 = 以父目录为工作空间）。
  // 现在打开另一个文件同样只是「切一篇」，左栏始终是文件树。
  ok('换一个别的文件：左栏仍是文件树（无单文件模式）', !s4.cls.includes('file-mode'), s4.cls)

  // ---- 5. 重开当前正打开的那篇（形态与文档都应不变）----
  pick.file = path.join(A, '乙.md')
  await js(W, `document.querySelector('#btn-open-file-ws').click(); 1`)
  await sleep(1300)
  const s5 = await js(W, probe)
  ok('重开当前文件：文档不变', s5.open === '乙.md', s5.open)
  ok('重开当前文件：工作空间不变（父目录）', s5.root === s4.root, { before: s4.root, after: s5.root })

  // ---- 6. **换了**别的文件夹（必须真的切换，不能被守卫误伤）----
  pick.folder = B
  await js(W, `document.querySelector('#btn-open-folder-ws').click(); 1`)
  await sleep(1500)
  const s6 = await js(W, probe)
  ok('换到另一个文件夹：工作空间真的换了', /项目B/.test(s6.root.replace(/\\/g, '/')), s6.root)
  // ⚠️ 别只断言行数：A、B 各有 3 行（甲、乙、子目录），数字一样恒成立、等于没验。
  // 真正能区分「守卫误伤」的是**树里第一行的名字** —— B 的树里不该有 A 独有的内容。
  const s6tree = await js(W, `(() => ({
    names: [...document.querySelectorAll('.tree-row')].map(r => r.textContent.trim()),
    root: (document.querySelector('#ws-path')||{}).title || '',
  }))()`)
  ok('换到另一个文件夹：树里是 B 的内容（不是 A 的）',
    s6tree.names.some((n) => n.includes('丙')) && !s6tree.names.some((n) => n.includes('甲')),
    s6tree.names)
  ok('换到另一个文件夹：退出单文件模式、文件树回来', !s6.cls.includes('file-mode') && s6tree.names.length > 0, s6.cls)

  // ---- 7. 切回 A 点甲（跨工作空间往返）----
  pick.folder = A
  await js(W, `document.querySelector('#btn-open-folder-ws').click(); 1`)
  await sleep(1500)
  await js(W, `(() => { const r = [...document.querySelectorAll('.tree-row.file')].find(x => x.dataset.path.includes('甲.md')); r.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); r.click(); return 1 })()`)
  await sleep(1300)
  const s7 = await js(W, probe)
  ok('切回 A 点甲：正常', s7.open === '甲.md' && !s7.cls.includes('file-mode'), s7)

  // ---- 8. 取消对话框不该有任何改动 ----
  pick.folder = null
  pick.file = null
  await js(W, `document.querySelector('#btn-open-folder-ws').click(); 1`)
  await sleep(700)
  await js(W, `document.querySelector('#btn-open-file-ws').click(); 1`)
  await sleep(700)
  const s8 = await js(W, probe)
  ok('取消选择：不改文档', s8.open === '甲.md', s8.open)
  ok('取消选择：不改工作空间', s8.root === s7.root, null)

  fs.writeFileSync(path.join(SHOT, 'dup-verified.png'), (await W.webContents.capturePage()).toPNG())

  const bad = rec.filter((r) => !r.p)
  console.log(`\n${rec.length - bad.length}/${rec.length} passed`)
  app.exit(bad.length ? 1 : 0)
}).catch((e) => { console.error(e); app.exit(1) })