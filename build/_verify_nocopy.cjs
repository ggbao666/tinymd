/* 验证：代码块复制按钮已删除，且删除后各功能不报错 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { app, BrowserWindow, dialog } = require('electron')

const ROOT = path.resolve(__dirname, '..')
const SHOT = path.join(__dirname, '_shots')
fs.mkdirSync(SHOT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const js = (w, code) => w.webContents.executeJavaScript(code)

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tinymd_nocopy_'))
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu')
app.disableHardwareAcceleration()
app.setPath('userData', path.join(TMP, 'user-data'))
dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] })
require(path.join(ROOT, 'main.js'))

const rec = []
const ok = (n, p, d) => { rec.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}  ${d === undefined ? '' : JSON.stringify(d)}`) }

app.whenReady().then(async () => {
  let W = null
  for (let i = 0; i < 60 && !W; i++) {
    await sleep(150)
    W = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html')) || null
  }
  if (!W) { console.error('no window'); app.exit(1); return }
  await new Promise((res) => { if (W.webContents.isLoading()) W.webContents.once('did-finish-load', res); else res() })
  await sleep(600)

  const WS = path.join(TMP, '我的项目')
  fs.mkdirSync(WS, { recursive: true })
  fs.writeFileSync(path.join(WS, '代码样例.md'), [
    '# 代码样例', '',
    '## 复制按钮的位置', '',
    '```bash',
    '# 一段 Bash',
    'echo "hello"',
    '```', '',
    '```python',
    'def f():',
    '    return 1',
    '```', '',
    '## 纯代码块（无语言）', '',
    '```',
    '裸代码块',
    '```', '',
    '> 引用块里的代码：', '',
    '> ```js',
    '> const a = 1',
    '> ```', '',
    '结尾。',
  ].join('\n'))

  await js(W, `localStorage.setItem('jianmo.recents', ${JSON.stringify(JSON.stringify([{ path: WS.replace(/\\/g, '/'), name: '我的项目', time: Date.now(), kind: 'dir' }]))}); location.reload(); 1`)
  await sleep(1500)
  await js(W, `(document.querySelector('.recent-row') || {click(){}}).click(); 1`)
  await sleep(1300)
  await js(W, `(() => { const r = [...document.querySelectorAll('.tree-row.file')].find(x => x.dataset.path.includes('代码样例')); r.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); r.click(); return 1 })()`)
  await sleep(1500)

  ok('复制按钮节点不存在', await js(W, `document.getElementById('code-copy') === null`), null)
  ok('CSS 里也没有 #code-copy 规则', !fs.readFileSync(path.join(ROOT, 'src/renderer/style.css'), 'utf8').includes('#code-copy {'), null)
  ok('JS 里没有 codeCopyBtn残留', !fs.readFileSync(path.join(ROOT, 'src/renderer/main.ts'), 'utf8').includes('codeCopyBtn'), null)

  const blocks = await js(W, `(() => {
    const pres = [...document.querySelectorAll('.ProseMirror pre')]
    return { count: pres.length, langs: pres.map(p => p.dataset.language || '(none)') }
  })()`)
  ok('文档里代码块都在（4 个）', blocks.count === 4, blocks)

  // 悬停每个代码块，确认没有任何悬浮 DOM 被创建
  for (let i = 0; i < blocks.count; i++) {
    await js(W, `(() => {
      const p = document.querySelectorAll('.ProseMirror pre')[${i}]
      p.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      return 1 })()`)
    await sleep(120)
  }
  const afterHover = await js(W, `({
    btn: document.getElementById('code-copy') !== null,
    // 任何 fixed 定位的小按钮都算异常
    fixed: [...document.body.children].filter(e => {
      const cs = getComputedStyle(e)
      return cs.position === 'fixed' && e.tagName === 'BUTTON'
    }).map(e => e.id || e.className),
  })`)
  ok('悬停代码块不产生悬浮按钮', afterHover.btn === false && afterHover.fixed.length === 0, afterHover)
  fs.writeFileSync(path.join(SHOT, 'nocopy-hover.png'), (await W.webContents.capturePage()).toPNG())

  // 切纯文本再切回来（这条路径原来会调 hideCodeCopy，删了函数最容易在这里炸）
  let err = null
  W.webContents.on('console-message', (_e, level, msg) => { if (level >= 2) err = msg })
  await js(W, `document.querySelector('#btn-source-mode').click(); 1`)
  await sleep(800)
  const inSource = await js(W, `({ src: !document.querySelector('#source-wrap').classList.contains('hidden'), txt: document.querySelector('#source-editor').value.includes('const a = 1') })`)
  ok('切纯文本：内容带过去了', inSource.src && inSource.txt, inSource)
  await js(W, `document.querySelector('#btn-source-mode').click(); 1`)
  await sleep(900)
  const back = await js(W, `({ vis: !document.querySelector('#editor-wrap').classList.contains('hidden'), blocks: document.querySelectorAll('.ProseMirror pre').length })`)
  ok('切回富文本：代码块完整恢复', back.vis && back.blocks === 4, back)
  await sleep(300)
  ok('切换过程无 console 报错', err === null, err)

  // 滚动 + 查找 + 大纲，确认没有别的连带影响
  await js(W, `document.querySelector('#editor-wrap').scrollTop = 200; 1`); await sleep(400)
  await js(W, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true })); 1`); await sleep(400)
  ok('查找条仍可用', !(await js(W, `document.querySelector('#find-bar').classList.contains('hidden')`)), null)
  await js(W, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 1`); await sleep(300)
  await js(W, `document.querySelector('#tab-outline').click(); 1`); await sleep(500)
  ok('大纲页仍可用', await js(W, `document.querySelectorAll('.outline-item').length > 0`), null)
  fs.writeFileSync(path.join(SHOT, 'nocopy-final.png'), (await W.webContents.capturePage()).toPNG())

  // 亮色
  await js(W, `document.querySelector('#tab-files').click(); 1`); await sleep(300)
  await js(W, `document.querySelector('#btn-image-settings').click(); 1`); await sleep(400)
  await js(W, `document.querySelector('[data-settings-page="appearance"]').click(); 1`); await sleep(250)
  await js(W, `document.querySelector('input[name="settings-theme"][value="light"]').click(); 1`); await sleep(500)
  await js(W, `document.querySelector('#btn-settings-close').click(); 1`); await sleep(600)
  fs.writeFileSync(path.join(SHOT, 'nocopy-light.png'), (await W.webContents.capturePage()).toPNG())

  const bad = rec.filter((r) => !r.p)
  console.log(`\n${rec.length - bad.length}/${rec.length} passed`)
  app.exit(bad.length ? 1 : 0)
}).catch((e) => { console.error(e); app.exit(1) })