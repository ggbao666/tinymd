// 查找 / 替换端到端验证：真实 require main.js、真实键盘事件、真实编辑器事务。
// 跑法：npm run build && unset ELECTRON_RUN_AS_NODE && ./node_modules/.bin/electron build/_verify_find.cjs
const fs = require('fs')
const os = require('os')
const path = require('path')
const { app, BrowserWindow, dialog } = require('electron')

const ROOT = path.resolve(__dirname, '..')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tinymd_verify_find_'))
const RESULT = path.join(__dirname, '_verify_find.json')
const STAGE = path.join(__dirname, '_verify_find.stage.json')
const stage = (s) => { try { fs.writeFileSync(STAGE, JSON.stringify({ stage: s, at: Date.now() })) } catch {} }
stage('init')

app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu')
app.disableHardwareAcceleration()
app.setPath('userData', path.join(TMP, 'user-data'))
dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] })

const WS = path.join(TMP, 'ws')
fs.mkdirSync(WS, { recursive: true })
const A = path.join(WS, '样张.md')
// 关键词 apple 出现 5 次（含大小写变体），用于计数 / 逐个 / 全部替换
fs.writeFileSync(A, [
  '# 水果清单', '',
  'apple 是第一种。', '', 'Apple 是第二种。', '',
  'APPLE 是第三种。', '', '还有 apple pie。', '', '最后 apple。', '',
].join('\n'))

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
const J = (v) => JSON.stringify(v)
/** 派发一次真实的 keydown（Ctrl/Cmd 由 platform 决定） */
const key = (w, k, opts = {}) => js(w, `(() => {
  const mod = ${JSON.stringify(opts.mod || false)};
  const shift = ${JSON.stringify(opts.shift || false)};
  const mac = window.api.platform === 'darwin';
  document.dispatchEvent(new KeyboardEvent('keydown', {
    key: ${JSON.stringify(k)}, bubbles: true, cancelable: true,
    ctrlKey: mod && !mac, metaKey: mod && mac, shiftKey: shift,
  }));
  return true
})()`)

const inputKey = (w, sel, k, opts = {}) => js(w, `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  el.dispatchEvent(new KeyboardEvent('keydown', {
    key: ${JSON.stringify(k)}, bubbles: true, cancelable: true,
    shiftKey: ${JSON.stringify(!!opts.shift)},
  }));
  return true
})()`)

const typeInto = (w, sel, text) => js(w, `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  el.value = ${JSON.stringify(text)};
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true
})()`)

/** 第 n 次（0 起）出现的位置；找不到返回 -1 */
function idxOfNth(text, word, n) {
  const re = new RegExp(word, 'gi')
  let m
  let k = 0
  while ((m = re.exec(text))) {
    if (k === n) return m.index
    k++
  }
  return -1
}

// 同步写文件：app.exit() 会把管道里的 stdout 一起丢掉
const DUMP = path.join(__dirname, '_verify_find_dump.txt')
const dump = (w, tag) => js(w, `(() => ({
  tag: ${J(tag)},
  srcVisible: !document.querySelector('#source-wrap').classList.contains('hidden'),
  srcLen: document.querySelector('#source-editor').value.length,
  srcApple: (document.querySelector('#source-editor').value.match(/apple/gi) || []).length,
  srcBanana: (document.querySelector('#source-editor').value.match(/香蕉/g) || []).length,
  count: document.querySelector('#find-count').textContent,
  hits: document.querySelectorAll('.ProseMirror .find-hit').length,
  current: [...document.querySelectorAll('.ProseMirror .find-hit')].findIndex(e => e.classList.contains('is-current')),
  richText: ((document.querySelector('#editor .ProseMirror') || {}).innerText || '').slice(0, 160),
}))()`).then((r) => { fs.appendFileSync(DUMP, tag + ' ' + JSON.stringify(r) + '\n') })

const snap = (w) => js(w, `(() => ({
  mode: window.__mode ? window.__mode() : '?',
  srcLen: document.querySelector('#source-editor').value.length,
  srcApple: (document.querySelector('#source-editor').value.match(/apple/gi) || []).length,
  srcBanana: (document.querySelector('#source-editor').value.match(/香蕉/g) || []).length,
  hidden: document.querySelector('#find-bar').classList.contains('hidden'),
  count: document.querySelector('#find-count').textContent,
  noHit: document.querySelector('#find-input').classList.contains('no-hit'),
  replaceHidden: document.querySelector('#find-replace-row').classList.contains('hidden'),
  hits: document.querySelectorAll('.ProseMirror .find-hit').length,
  srcVisible: !document.querySelector('#source-wrap').classList.contains('hidden'),
  richText: ((document.querySelector('#editor .ProseMirror') || {}).innerText || '').slice(0, 160),
  current: [...document.querySelectorAll('.ProseMirror .find-hit')].findIndex(e => e.classList.contains('is-current')),
  sel: JSON.stringify(editorSelection()),
}))()`)

// 提供一个全局辅助：把当前 PM 选区序列化出来
const defineHelper = (w) => js(w, `(() => {
  window.editorSelection = () => {
    const pm = document.querySelector('#editor .ProseMirror')
    if (!pm) return null
    const s = getSelection()
    if (!s || !s.rangeCount) return null
    const r = s.getRangeAt(0)
    const el = pm.querySelector('#__probe')
    void el
    return { text: String(r) }
  }
  return true
})()`)

app.whenReady().then(async () => {
  let W = null
  for (let i = 0; i < 60 && !W; i++) { W = BrowserWindow.getAllWindows()[0] || null; if (!W) await sleep(200) }
  if (!W) { finish('no window', new Error('主窗口未出现')); return }
  if (W.webContents.isLoading()) await new Promise((r) => W.webContents.once('did-finish-load', r))
  await sleep(700)
  await defineHelper(W)

  await js(W, `localStorage.setItem('jianmo.recents', ${J(JSON.stringify([{ path: WS, name: 'ws', time: Date.now(), kind: 'dir' }]))}); location.reload(); true`)
  await new Promise((r) => W.webContents.once('did-finish-load', r))
  await sleep(700)
  await defineHelper(W)
  await js(W, `document.querySelector('.recent-row').click(); true`)
  await sleep(900)
  const rowSel = (p) => `.tree-row.file[data-path=${JSON.stringify(p)}]`
  for (let i = 0; i < 40; i++) { if (await js(W, `!!document.querySelector(${J(rowSel(A))})`)) break; await sleep(150) }
  await js(W, `document.querySelector(${J(rowSel(A))}).click(); true`)
  await sleep(1200)
  rec('前置：工作空间 + 样张.md 打开', await js(W, `document.querySelector('#editor .ProseMirror').innerText.includes('apple')`))

  // ---- F1：Ctrl+F 打开查找条；输入关键词后计数正确（默认不区分大小写）----
  await key(W, 'f', { mod: true })
  await sleep(400)
  rec('F1 Ctrl+F 打开查找条', await js(W, `!document.querySelector('#find-bar').classList.contains('hidden')`) === true)
  rec('F1 查找框获得焦点', await js(W, `document.activeElement && document.activeElement.id === 'find-input'`) === true)
  await typeInto(W, '#find-input', 'apple')
  await sleep(500)
  let s = await snap(W)
  rec('F1 计数 = 1/5（不区分大小写，共 5 处）', s.count === '1/5', s)
  rec('F1 命中高亮数 = 5', s.hits === 5, s)
  rec('F1 当前命中下标 = 0', s.current === 0, s)

  // ---- F2：Enter 下一个 / Shift+Enter 上一个（含循环）----
  await inputKey(W, '#find-input', 'Enter')
  await sleep(350)
  s = await snap(W)
  rec('F2 Enter → 2/5', s.count === '2/5', s)
  await inputKey(W, '#find-input', 'Enter', { shift: true })
  await sleep(350)
  s = await snap(W)
  rec('F2 Shift+Enter → 1/5', s.count === '1/5', s)
  await inputKey(W, '#find-input', 'Enter', { shift: true })
  await sleep(350)
  s = await snap(W)
  rec('F2 首条再往前 → 循环到 5/5', s.count === '5/5', s)

  // ---- F3：区分大小写（大小写敏感后只剩 3 个小写 apple；下标仍锚在光标处）----
  await js(W, `document.querySelector('#find-case').click(); true`)
  await sleep(450)
  s = await snap(W)
  rec('F3 区分大小写后只剩 3 处', /\/3$/.test(s.count) && s.hits === 3, s)
  rec('F3 大小写开关 aria-pressed=true', await js(W, `document.querySelector('#find-case').getAttribute('aria-pressed')`) === 'true')
  await js(W, `document.querySelector('#find-case').click(); true`)
  await sleep(400)
  s = await snap(W)
  rec('F3 关掉后恢复 5 处', /\/5$/.test(s.count) && s.hits === 5, s)

  // ---- F4：无结果时输入框标红 ----
  await typeInto(W, '#find-input', 'zzzz-not-exist')
  await sleep(450)
  s = await snap(W)
  rec('F4 无结果提示', s.count === '无结果' && s.noHit === true && s.hits === 0, s)
  await typeInto(W, '#find-input', 'apple')
  await sleep(450)
  s = await snap(W)
  rec('F4 有结果时标红撤销', s.noHit === false, s)

  // ---- F5：替换「当前命中」这一条，随后停在同一下标（即原来的下一条）----
  await js(W, `document.querySelector('#find-toggle-replace').click(); true`)
  await sleep(350)
  rec('F5 替换行展开', await js(W, `!document.querySelector('#find-replace-row').classList.contains('hidden')`) === true)
  await typeInto(W, '#find-replace-input', '香蕉')
  await sleep(250)
  const beforeText = await js(W, `document.querySelector('#editor .ProseMirror').innerText`)
  const idxBefore = (await snap(W)).current
  const occBefore = idxOfNth(beforeText, 'apple', idxBefore)
  await js(W, `document.querySelector('#find-replace-one').click(); true`)
  await sleep(600)
  s = await snap(W)
  const afterText = await js(W, `document.querySelector('#editor .ProseMirror').innerText`)
  rec('F5 命中数 5 → 4', s.hits === 4, s)
  rec('F5 换掉的正是「当前那条」', occBefore >= 0 && afterText.startsWith(beforeText.slice(0, occBefore) + '香蕉'), { idxBefore, occBefore, head: afterText.slice(0, 60) })
  rec('F5 状态栏提示已替换 1 处', (await js(W, `document.querySelector('#status').textContent`)).includes('已替换 1 处'))

  // ---- F6：全部替换 ----
  await js(W, `document.querySelector('#find-replace-all').click(); true`)
  await sleep(600)
  s = await snap(W)
  const text2 = await js(W, `document.querySelector('#editor .ProseMirror').innerText`)
  rec('F6 全部替换后 0 处命中', s.hits === 0 && s.count === '无结果', s)
  rec('F6 文档里不再有 apple（大小写均）', !/apple/i.test(text2), { text2: text2.slice(0, 120) })
  rec('F6 香蕉出现 5 次', (text2.match(/香蕉/g) || []).length === 5, { n: (text2.match(/香蕉/g) || []).length })

  // ---- F7：Esc 只收查找条，不带走目录 ----
  await js(W, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, shiftKey: true, bubbles: true })); true`)
  await sleep(400)
  rec('F7 前置：目录已展开', await js(W, `document.body.classList.contains('toc-open')`) === true)
  await key(W, 'f', { mod: true })
  await sleep(400)
  rec('F7 前置：查找条已打开', await js(W, `!document.querySelector('#find-bar').classList.contains('hidden')`) === true)
  await key(W, 'Escape')
  await sleep(400)
  const after = await js(W, `({ findHidden: document.querySelector('#find-bar').classList.contains('hidden'), toc: document.body.classList.contains('toc-open') })`)
  rec('F7 Esc 只收查找条、目录仍在', after.findHidden === true && after.toc === true, after)
  await key(W, 'Escape')
  await sleep(300)
  rec('F7 再按 Esc 才收目录', await js(W, `!document.body.classList.contains('toc-open')`) === true)

  // ---- F8：纯文本模式下查找 / 替换同样可用 ----
  await js(W, `document.querySelector('#btn-source-mode').click(); true`)
  await sleep(800)
  s = await snap(W)
  // 核心不变量：切到纯文本后，刚才的「全部替换」必须还在（不能回退成旧文本）
  rec('F8 切到纯文本后编辑不丢（0 apple / 5 香蕉）', s.srcApple === 0 && s.srcBanana === 5, s)
  await key(W, 'f', { mod: true })
  await sleep(400)
  rec('F8 纯文本模式下查找条打开', await js(W, `!document.querySelector('#find-bar').classList.contains('hidden')`) === true)
  await typeInto(W, '#find-input', '香蕉')
  await sleep(500)
  s = await snap(W)
  rec('F8 纯文本命中 5 处（1/5）', s.count === '1/5', s)
  rec('F8 纯文本下无装饰层（textarea 不支持高亮）', s.hits === 0, s)
  await typeInto(W, '#find-replace-input', 'XG')
  await sleep(250)
  await js(W, `document.querySelector('#find-replace-all').click(); true`)
  await sleep(700)
  const text3 = await js(W, `document.querySelector('#source-editor').value`)
  rec('F8 纯文本全部替换生效', (text3.match(/XG/g) || []).length === 5 && !text3.includes('香蕉'), { head: text3.slice(0, 80) })

  // ---- F9：替换后文件确实被保存（自动保存链路没断）----
  await sleep(1500)
  const disk = fs.readFileSync(A, 'utf8')
  rec('F9 自动保存已落盘（磁盘内容含 XG）', disk.includes('XG'), { head: disk.slice(0, 80) })

  // ---- F10：关闭查找条后高亮清干净 ----
  await key(W, 'f', { mod: true })
  await sleep(400)
  await js(W, `document.querySelector('#find-close').click(); true`)
  await sleep(400)
  s = await snap(W)
  rec('F10 关闭后无残留高亮', s.hits === 0, s)

  try { fs.writeFileSync(RESULT, JSON.stringify({ failed, results }, null, 2)) } catch {}
  console.log(failed ? `FAILED: ${failed} 条` : `ALL PASS: ${results.length}/${results.length}`)
  app.exit(failed ? 1 : 0)
})
