// 真实应用截图：起真实 main.js，进工作空间打开一篇「样张」，逐状态拍照。
// 跑法：npm run build && unset ELECTRON_RUN_AS_NODE && ./node_modules/.bin/electron build/_shots.cjs
const fs = require('fs')
const os = require('os')
const path = require('path')
const { app, BrowserWindow } = require('electron')

const ROOT = path.resolve(__dirname, '..')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tinymd_shots_'))
const OUT = path.join(__dirname, '_shots')
fs.mkdirSync(OUT, { recursive: true })

app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu')
app.disableHardwareAcceleration()
app.setPath('userData', path.join(TMP, 'user-data'))

const WS = path.join(TMP, 'ws')
fs.mkdirSync(WS, { recursive: true })

// 样张：把版式里所有元素都放进去，便于一眼看出排版问题
const DOC = [
  '# 产品需求文档',
  '',
  '> 这是一段引用，用来看引用块的左边框与行距是否协调。',
  '',
  '## 一、背景',
  '',
  '正文段落用来看**行高**、*字距*以及 `行内代码` 与周围文字的对齐关系。',
  '这里是第二行，用来检查段间距是否过大或过小。',
  '',
  '## 二、功能列表',
  '',
  '1. 有序列表第一项',
  '2. 有序列表第二项',
  '   - 嵌套无序列表',
  '   - 嵌套第二项',
  '',
  '- [x] 已完成任务',
  '- [ ] 未完成任务',
  '',
  '## 三、接口定义',
  '',
  '```ts',
  'interface User {',
  '  id: number',
  '  name: string',
  '  tags: string[]',
  '}',
  '```',
  '',
  '## 四、数据对照',
  '',
  '| 模块 | 负责人 | 状态 | 备注 |',
  '|---|---|---|---|',
  '| 编辑器 | 张三 | 进行中 | 含协同 |',
  '| 导出 | 李四 | 已完成 | PDF / Word |',
  '',
  '## 五、补充说明',
  '',
  '链接示例：[tinymd 仓库](https://github.com/ggbao666/tinymd)。',
  '',
  '---',
  '',
  '结尾段落，用来看正文与窗口底部的留白。',
  '',
].join('\n')

const A = path.join(WS, '需求文档.md')
fs.writeFileSync(A, DOC)
const B = path.join(WS, '会议纪要.md')
fs.writeFileSync(B, '# 会议纪要\n\n- 议题一\n- 议题二\n')
const C = path.join(WS, '随笔.md')
fs.writeFileSync(C, '# 随笔\n\n随便写点什么。\n')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const js = (w, code) => w.webContents.executeJavaScript(code)
const log = (m) => { fs.appendFileSync(path.join(OUT, 'shots.log'), m + '\n') }
fs.writeFileSync(path.join(OUT, 'shots.log'), 'start\n')

async function shot(w, name) {
  log('capturing ' + name)
  const img = await w.webContents.capturePage()
  fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG())
  log('shot: ' + name)
}

process.on('uncaughtException', (e) => { log('uncaught: ' + e.message); app.exit(1) })
process.on('unhandledRejection', (e) => { log('unhandled: ' + (e && e.message)); app.exit(1) })

// ⚠️ 必须在 app ready **之前** require：main.js 顶层会调
// protocol.registerSchemesAsPrivileged，ready 之后调会直接抛错。
log('require main.js')
require(path.join(ROOT, 'main.js'))
log('main.js loaded')

app.whenReady().then(async () => {
  let W = null
  for (let i = 0; i < 60 && !W; i++) { W = BrowserWindow.getAllWindows()[0] || null; if (!W) await sleep(200) }
  if (!W) { console.log('no window'); app.exit(1); return }
  if (W.webContents.isLoading()) await new Promise((r) => W.webContents.once('did-finish-load', r))
  await sleep(700)

  // 1) 欢迎页
  await shot(W, '1-welcome')

  // 2) 工作空间（暗色/中性主题，默认）
  await js(W, `localStorage.setItem('jianmo.recents', ${JSON.stringify(JSON.stringify([{ path: WS, name: 'ws', time: Date.now(), kind: 'dir' }]))}); location.reload(); true`)
  await new Promise((r) => W.webContents.once('did-finish-load', r))
  await sleep(700)
  await shot(W, '2-welcome-recents')
  await js(W, `document.querySelector('.recent-row').click(); true`)
  await sleep(900)
  const rowSel = (p) => `.tree-row.file[data-path=${JSON.stringify(p)}]`
  for (let i = 0; i < 40; i++) { if (await js(W, `!!document.querySelector(${JSON.stringify(rowSel(A))})`)) break; await sleep(150) }
  await js(W, `document.querySelector(${JSON.stringify(rowSel(A))}).click(); true`)
  await sleep(1200)
  await shot(W, '3-workspace-neutral')

  // 3) 目录展开
  await js(W, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, shiftKey: true, bubbles: true })); true`)
  await sleep(600)
  await shot(W, '4-toc-open')
  await js(W, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`)
  await sleep(400)

  // 4) 亮色主题
  await js(W, `window.api.setTheme('light')`)
  await sleep(600)
  await shot(W, '5-workspace-light')
  await js(W, `window.api.setTheme('neutral')`)
  await sleep(500)

  // 5) 设置窗口
  await js(W, `document.querySelector('#btn-image-settings').dispatchEvent(new MouseEvent('click', { bubbles: true })); true`)
  await sleep(700)
  await shot(W, '6-settings')
  await js(W, `document.querySelector('#btn-settings-close').dispatchEvent(new MouseEvent('click', { bubbles: true })); true`)
  await sleep(500)

  // 6) 选中文本的气泡菜单
  await js(W, `(() => {
    const pm = document.querySelector('#editor .ProseMirror');
    const p = [...pm.querySelectorAll('p')].find(el => el.textContent.includes('行高'));
    const r = document.createRange(); r.selectNodeContents(p);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    document.dispatchEvent(new Event('selectionchange'));
    return true
  })()`)
  await sleep(700)
  await shot(W, '7-bubble-menu')

  // 7) 链接浮层（目录同时展开，看是否溢出）
  await js(W, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, shiftKey: true, bubbles: true })); true`)
  await sleep(400)
  W.webContents.send('menu', 'link')
  await sleep(600)
  await shot(W, '8-link-popover-toc')
  await js(W, `document.querySelector('#link-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); true`)
  await sleep(300)
  await js(W, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`)
  await sleep(300)

  // 8) 窄窗口（< 800，两块面板互斥）
  const b = W.getBounds()
  W.setBounds({ x: b.x, y: b.y, width: 760, height: b.height })
  await sleep(700)
  await shot(W, '9-narrow-760')
  await js(W, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, shiftKey: true, bubbles: true })); true`)
  await sleep(700)
  await shot(W, '10-narrow-toc-exclusive')
  W.webContents.send('menu', 'link')
  await sleep(600)
  await shot(W, '11-narrow-link-popover')

  // 9) 纯文本模式
  await js(W, `document.querySelector('#link-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); true`)
  await sleep(300)
  W.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height })
  await sleep(500)
  await js(W, `document.querySelector('#btn-source-mode').dispatchEvent(new MouseEvent('click', { bubbles: true })); true`)
  await sleep(700)
  await shot(W, '12-source-mode')

  console.log('DONE', OUT)
  app.exit(0)
})
