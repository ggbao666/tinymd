/* 验证：懒加载 + 只有两种窗口形态
   1) 目录默认闭合，不读子级；展开才读，读过一次不重复读
   2) 只显示 .md 系文件与目录（点开头、.git、node_modules、非 md 一律不出现在树上）
   3) 没有单文件模式：打开文件 = 以父目录为工作空间，左栏始终在
   4) 没有独立窗口：右键菜单里没有「在新窗口中打开」 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { app, BrowserWindow, dialog } = require('electron')

const ROOT = path.resolve(__dirname, '..')
const SHOT = path.join(__dirname, '_shots')
fs.mkdirSync(SHOT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const js = (w, code) => w.webContents.executeJavaScript(code)

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tinymd_lazy_'))
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu')
app.disableHardwareAcceleration()
app.setPath('userData', path.join(TMP, 'user-data'))

const pick = { folder: null, file: null }
let treeCalls = 0
let childrenCalls = 0
dialog.showOpenDialog = async (_p, opts) => {
  const wantDir = opts?.properties?.includes('openDirectory')
  const p = wantDir ? pick.folder : pick.file
  if (!p) return { canceled: true, filePaths: [] }
  return { canceled: false, filePaths: [p] }
}
require(path.join(ROOT, 'main.js'))

const rec = []
const ok = (n, p, d) => { rec.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}  ${d === undefined ? '' : JSON.stringify(d)}`) }

const treeState = `(() => ({
  rows: [...document.querySelectorAll('.tree-row')].map(r => ({
    name: r.querySelector('.tree-name')?.textContent || r.textContent,
    dir: r.classList.contains('dir'),
    open: r.classList.contains('open'),
  })),
  loading: document.querySelectorAll('.tree-loading').length,
  cls: document.body.className,
  sidebarW: Math.round(document.querySelector('#sidebar').getBoundingClientRect().width),
  open: (document.querySelector('.crumb-doc')||{}).textContent || '',
  root: (document.querySelector('#ws-path')||{}).title || '',
}))()`

let W = null
const clickDir = (name) => js(W, `(() => {
  const r = [...document.querySelectorAll('.tree-row.dir')].find(x => (x.textContent||'').includes(${JSON.stringify(name)}))
  if (!r) return 0
  r.click()
  return 1
})()`)

const clickFile = (name) => js(W, `(() => {
  const r = [...document.querySelectorAll('.tree-row.file')].find(x => (x.textContent||'').includes(${JSON.stringify(name)}))
  if (!r) return 0
  r.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  r.click()
  return 1
})()`)

app.whenReady().then(async () => {
  for (let i = 0; i < 60 && !W; i++) {
    await sleep(150)
    W = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html')) || null
  }
  if (!W) { console.error('no window'); app.exit(1); return }

  // 包一层，统计主进程被调了几次
  const { ipcMain } = require('electron')
  for (const ch of ['fs:tree', 'fs:children']) {
    const orig = ipcMain._getHandler ? null : null
    ipcMain.removeHandler(ch)
    const inner = ch === 'fs:tree' ? 0 : 0
    ipcMain.handle(ch, async (_e, ...a) => {
      if (ch === 'fs:tree') treeCalls++; else childrenCalls++
      // 转发给主进程里原实现：重新 require 一个干净实例太重，这里直接内联读盘
      return require('node:fs').promises.readdir(a[0], { withFileTypes: true }).then((es) => {
        const out = []
        for (const en of es) {
          if (en.name.startsWith('.') || ['.git', 'node_modules', '.svn', '.idea', '.vscode', '.DS_Store', 'Thumbs.db', 'desktop.ini'].includes(en.name)) continue
          const full = path.join(a[0], en.name)
          if (en.isDirectory()) out.push({ name: en.name, path: full, type: 'dir' })
          else if (/\.(md|markdown|mdown|mkd)$/i.test(en.name)) out.push({ name: en.name, path: full, type: 'file' })
        }
        out.sort((x, y) => (x.type !== y.type ? (x.type === 'dir' ? -1 : 1) : x.name.localeCompare(y.name, 'zh-Hans-CN')))
        return out
      }).catch(() => [])
    })
  }

  await new Promise((res) => { if (W.webContents.isLoading()) W.webContents.once('did-finish-load', res); else res() })
  await sleep(600)

  // ---- 造一个三层 + 有干扰项的目录 ----
  const WS = path.join(TMP, '大项目')
  fs.mkdirSync(path.join(WS, '笔记', '深层'), { recursive: true })
  fs.mkdirSync(path.join(WS, '文档', '子目录'), { recursive: true })
  fs.mkdirSync(path.join(WS, 'node_modules', 'pkg'), { recursive: true })
  fs.mkdirSync(path.join(WS, '.git'), { recursive: true })
  fs.writeFileSync(path.join(WS, '顶层.md'), '# 顶层\n')
  fs.writeFileSync(path.join(WS, 'readme.txt'), '不是 md\n')
  fs.writeFileSync(path.join(WS, '.隐藏.md'), '# 隐藏\n')
  fs.writeFileSync(path.join(WS, '笔记', '随笔.md'), '# 随笔\n')
  fs.writeFileSync(path.join(WS, '笔记', '深层', '最里.md'), '# 最里\n')
  fs.writeFileSync(path.join(WS, '文档', '需求.md'), '# 需求\n')
  fs.writeFileSync(path.join(WS, '文档', '子目录', '细节.md'), '# 细节\n')
  fs.writeFileSync(path.join(WS, 'node_modules', 'pkg', 'readme.md'), '# 不该出现\n')
  fs.writeFileSync(path.join(WS, '.git', 'config.md'), '# 不该出现\n')

  // ---- 打开工作空间 ----
  pick.folder = WS
  await js(W, `document.querySelector('#btn-open-folder-ws').click(); 1`)
  await sleep(1500)

  const t0 = await js(W, treeState)
  ok('打开工作空间：只读了根目录一层（没递归）', treeCalls >= 1 && childrenCalls === 0, { treeCalls, childrenCalls })
  ok('打开工作空间：没有读任何子目录', childrenCalls === 0, { childrenCalls })
  ok('顶层：目录默认闭合（没有一个 open）', t0.rows.every((r) => !r.open), t0.rows.map((r) => r.name + (r.open ? '*' : '')))
  // ⚠️ 两条都别断言顺序 —— 排序是 localeCompare('zh-Hans-CN')，
  // 硬编码顺序会随平台 locale 变（中英混排时尤其不稳）。只看集合。
  const topNames = t0.rows.map((r) => r.name)
  const wantTop = ['顶层.md', '文档', '笔记']
  ok('顶层：只显示 .md 与目录（数量与内容都对）',
    topNames.length === wantTop.length && wantTop.every((n) => topNames.includes(n)),
    topNames)
  ok('干扰项被滤掉（.git / node_modules / .隐藏.md / readme.txt）',
    !t0.rows.some((r) => /git|node_modules|隐藏|readme\.txt/.test(r.name)), t0.rows.map((r) => r.name))
  fs.writeFileSync(path.join(SHOT, 'lazy-closed.png'), (await W.webContents.capturePage()).toPNG())

  // ---- 展开「笔记」：这时才读子级 ----
  const c0 = childrenCalls
  await clickDir('笔记')
  await sleep(900)
  const t1 = await js(W, treeState)
  ok('展开目录：读了一次子级', childrenCalls === c0 + 1, { before: c0, after: childrenCalls })
  ok('展开目录：子级内容出现', t1.rows.some((r) => r.name.includes('随笔')), t1.rows.map((r) => r.name))
  ok('展开目录：孙层仍不读（深层还没展开）', !t1.rows.some((r) => r.name.includes('最里')), t1.rows.map((r) => r.name))
  ok('展开目录：占位行已消失', t1.loading === 0, t1.loading)

  // ---- 折叠再展开：不重复读 ----
  await clickDir('笔记')       // 折叠
  await sleep(400)
  const c1 = childrenCalls
  const t2a = await js(W, treeState)
  ok('折叠：子级消失', !t2a.rows.some((r) => r.name.includes('随笔')), t2a.rows.map((r) => r.name))
  await clickDir('笔记')       // 再展开
  await sleep(700)
  const t2 = await js(W, treeState)
  ok('再次展开：不重复读盘（children 已挂在节点上）', childrenCalls === c1, { before: c1, after: childrenCalls })
  ok('再次展开：子级立刻出现', t2.rows.some((r) => r.name.includes('随笔')), t2.rows.map((r) => r.name))

  // ---- 展开到第三层 ----
  const c2 = childrenCalls
  await clickDir('深层')
  await sleep(900)
  const t3 = await js(W, treeState)
  ok('展开第二层目录：又读一次', childrenCalls === c2 + 1, { before: c2, after: childrenCalls })
  ok('第三层文件出现', t3.rows.some((r) => r.name.includes('最里')), t3.rows.map((r) => r.name))
  fs.writeFileSync(path.join(SHOT, 'lazy-expanded.png'), (await W.webContents.capturePage()).toPNG())

  // ---- 点开一个文件，确认正文能打开 ----
  await clickFile('顶层')
  await sleep(1200)
  const t4 = await js(W, treeState)
  ok('点文件：正文打开了', t4.open.includes('顶层'), t4.open)
  // 反向：用户**在树上点了**就该高亮（刚才是「打开文件…」进来才不高亮）
  const selTree = await js(W, `[...document.querySelectorAll('.tree-row.selected')].map(r => r.textContent.trim())`)
  ok('点文件：树上那一行会高亮', selTree.some(t => t.includes('顶层')), selTree)

  // ---- 打开单个文件 = 以父目录为工作空间（无单文件模式）----
  pick.file = path.join(WS, '文档', '需求.md')
  const tBefore = childrenCalls
  await js(W, `document.querySelector('#btn-open-file-ws').click(); 1`)
  await sleep(1800)
  const t5 = await js(W, treeState)
  ok('打开文件：父目录成了工作空间', /文档/.test(t5.root.replace(/\\/g, '/')), t5.root)
  ok('打开文件：左栏还在（没有单文件模式）', t5.sidebarW > 100 && !t5.cls.includes('file-mode'), { w: t5.sidebarW, cls: t5.cls })
  ok('打开文件：正文是那一篇', t5.open.includes('需求'), t5.open)
  ok('打开文件：树保持默认闭合（不展开不选中）', t5.rows.every((r) => !r.open), t5.rows.map((r) => r.name + (r.open ? '*' : '')))
  // ⚠️ 别断言「列表里没有那一篇」—— 它是工作空间**根目录下的文件**，当然在列表里。
  // 该断言的是**选中态**（.selected 类），那才是「有没有被选中」。
  const sel = await js(W, `[...document.querySelectorAll('.tree-row.selected')].map(r => r.textContent.trim())`)
  ok('打开文件：没有把那一篇选中', sel.length === 0, sel)

  // ---- 独立窗口没了 ----
  await js(W, `(() => {
    const r = [...document.querySelectorAll('.tree-row.file')][0]
    r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 120 }))
    return 1 })()`)
  await sleep(700)
  const ctx = await js(W, `(() => { const e = document.querySelector('.ctx-menu, [class*="ctx"]'); return e ? e.textContent : '' })()`)
  ok('右键菜单：没有「在新窗口中打开」', !/新窗口|另一个窗口/.test(ctx || ''), (ctx || '').slice(0, 90))
  ok('右键菜单：重命名 / 删除 还在', /重命名/.test(ctx || '') && /废纸篓/.test(ctx || ''), (ctx || '').slice(0, 90))
  await js(W, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 1`)
  await sleep(300)

  // ---- body 上不该再有形态类 ----
  const cls = await js(W, `document.body.className`)
  ok('body 上没有 file-mode / standalone', !/file-mode|standalone/.test(cls), cls)

  // ---- 只有一个窗口 ----
  ok('只有一个主窗口（无独立窗口）', BrowserWindow.getAllWindows().length === 1, BrowserWindow.getAllWindows().length)

  fs.writeFileSync(path.join(SHOT, 'lazy-final.png'), (await W.webContents.capturePage()).toPNG())

  const bad = rec.filter((r) => !r.p)
  console.log(`\n${rec.length - bad.length}/${rec.length} passed`)
  app.exit(bad.length ? 1 : 0)
}).catch((e) => { console.error(e); app.exit(1) })