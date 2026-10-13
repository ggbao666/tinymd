/* 复现「查找上/下一个不滚动到命中位置」：
   长文档（80 段，命中最远在 20+ 屏之外），分别用合成 click 和
   真实鼠标事件序列（mousedown+mouseup+click）点「下一个/上一个」，
   观察 ① 计数 ② is-current 下标 ③ scrollTop 是否真的滚过去 ④ 焦点状态。
   同时覆盖纯文本模式（textarea 的 setSelectionRange 同样不保证滚动）。 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { app, BrowserWindow, dialog } = require('electron')

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(__dirname, '_find_nav_debug.txt')
const results = []

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const js = (w, code) => w.webContents.executeJavaScript(code)
const J = (s) => JSON.stringify(s)
const rec = (name, info) => results.push(`${name}: ${JSON.stringify(info)}`)
const flush = () => { try { fs.writeFileSync(OUT, results.join('\n') + '\n') } catch {} }

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tinymd_findnav_'))
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu')
app.disableHardwareAcceleration()
app.setPath('userData', path.join(TMP, 'user-data'))
dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] })

require(path.join(ROOT, 'main.js'))

app.whenReady().then(async () => {
  const W = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html')) ||
    BrowserWindow.getAllWindows()[0]
  await new Promise((res) => {
    if (W.webContents.isLoading()) W.webContents.once('did-finish-load', res)
    else res()
  })
  await sleep(600)

  const WS = path.join(TMP, 'ws')
  fs.mkdirSync(WS, { recursive: true })
  // 长文档：80 段，每段一个 apple —— 命中分布在不同「屏」上
  const lines = []
  for (let i = 1; i <= 80; i++) lines.push(`第 ${i} 段 apple 内容占位占位占位占位占位占位占位占位`, '')
  const LONG = path.join(WS, 'long.md')
  fs.writeFileSync(LONG, lines.join('\n'))

  await js(W, `localStorage.setItem('jianmo.recents', ${J(JSON.stringify([{ path: WS.replace(/\\/g, '/'), name: 'fn', time: Date.now(), kind: 'dir' }]))}); location.reload(); 1`)
  await sleep(1500)
  await js(W, `(document.querySelector('.recent-row') || { click() {} }).click(); 1`)
  await sleep(1200)
  const row = `document.querySelector('.tree-row.file[data-path*="long.md"]')`
  await js(W, `const r = ${row}; r.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); r.click(); 1`)
  await sleep(1200)

  // 打开查找条并搜索
  await js(W, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true })); 1`)
  await sleep(400)
  await js(W, `const i = document.querySelector('#find-input'); i.value = 'apple'; i.dispatchEvent(new Event('input', { bubbles: true })); 1`)
  await sleep(600)

  const snap = () => js(W, `(() => {
    const wrap = document.querySelector('#editor-wrap')
    const cur = document.querySelector('.ProseMirror .find-hit.is-current')
    const wb = wrap.getBoundingClientRect()
    const cb = cur && cur.getBoundingClientRect()
    return {
      count: document.querySelector('#find-count').textContent,
      current: [...document.querySelectorAll('.ProseMirror .find-hit')].findIndex(e => e.classList.contains('is-current')),
      hits: document.querySelectorAll('.ProseMirror .find-hit').length,
      scrollTop: Math.round(wrap.scrollTop),
      wrapTop: Math.round(wb.top), wrapH: Math.round(wb.height),
      curTopRel: cb ? Math.round(cb.top - wb.top) : null, curH: cb ? Math.round(cb.height) : null,
      active: document.activeElement && (document.activeElement.id || document.activeElement.tagName),
    }
  })()`)

  rec('搜索后初始', await snap())

  // ① 合成 click（无焦点转移 —— 老测试脚本的路径）
  await js(W, `document.querySelector('#find-next').click(); 1`)
  await sleep(500)
  rec('合成 click 下一个×1', await snap())

  for (let i = 0; i < 9; i++) { await js(W, `document.querySelector('#find-next').click(); 1`); await sleep(150) }
  await sleep(400)
  rec('合成 click 下一个×10', await snap())

  // ② 真实鼠标事件序列（含 mousedown → 焦点转移）—— 用户实际操作
  const realClick = `((sel) => {
    const btn = document.querySelector(sel)
    const r = btn.getBoundingClientRect()
    const o = { bubbles: true, cancelable: true, clientX: r.left + 4, clientY: r.top + 4, button: 0 }
    btn.dispatchEvent(new MouseEvent('mousedown', o))
    btn.dispatchEvent(new MouseEvent('mouseup', o))
    btn.dispatchEvent(new MouseEvent('click', o))
  })`
  await js(W, realClick + `('#find-next'); 1`)
  await sleep(500)
  rec('真实鼠标 下一个×11', await snap())

  for (let i = 0; i < 9; i++) { await js(W, realClick + `('#find-next'); 1`); await sleep(150) }
  await sleep(400)
  rec('真实鼠标 下一个×20', await snap())

  // ③ 真实鼠标点「上一个」×3
  for (let i = 0; i < 3; i++) { await js(W, realClick + `('#find-prev'); 1`); await sleep(300) }
  await sleep(400)
  rec('真实鼠标 上一个×3', await snap())

  // ④ 纯文本模式同样验证
  try {
    await js(W, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 1`)
    await sleep(300)
    await js(W, `document.querySelector('#btn-source-mode').click(); 1`)
    await sleep(800)
    const mode = await js(W, `({ src: !document.querySelector('#source-editor').closest('.hidden'), body: document.body.className.slice(0, 60) })`)
    rec('切纯文本后状态', mode)
    try {
      await js(W, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true })); 1`)
      rec('纯文本 CtrlF', 'ok')
    } catch (e2) { rec('纯文本 CtrlF 异常', String(e2 && e2.message).slice(0, 120)) }
    await sleep(400)
    try {
      await js(W, `(() => { const i = document.querySelector('#find-input'); i.value = 'apple'; i.dispatchEvent(new Event('input', { bubbles: true })); return 1 })()`)
      rec('纯文本输入', 'ok')
    } catch (e3) { rec('纯文本输入异常', String(e3 && e3.message).slice(0, 120)) }
    await sleep(600)
    const snapSrc = () => js(W, `(() => {
      const ta = document.querySelector('#source-editor')
      return { count: document.querySelector('#find-count').textContent, scrollTop: Math.round(ta.scrollTop), selStart: ta.selectionStart, focused: document.activeElement === ta }
    })()`)
    rec('纯文本搜索后初始', await snapSrc())
    for (let i = 0; i < 10; i++) { await js(W, realClick + `('#find-next'); 1`); await sleep(150) }
    await sleep(400)
    rec('纯文本 下一个×10', await snapSrc())
    for (let i = 0; i < 20; i++) { await js(W, realClick + `('#find-next'); 1`); await sleep(120) }
    await sleep(400)
    rec('纯文本 下一个×30', await snapSrc())
    for (let i = 0; i < 3; i++) { await js(W, realClick + `('#find-prev'); 1`); await sleep(250) }
    await sleep(400)
    rec('纯文本 上一个×3', await snapSrc())
    for (let i = 0; i < 15; i++) { await js(W, realClick + `('#find-prev'); 1`); await sleep(120) }
    await sleep(400)
    rec('纯文本 上一个×18', await snapSrc())
  } catch (e) {
    rec('纯文本段异常', { msg: String(e && e.message).slice(0, 160) })
  }

  flush()
  try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {}
  app.exit(0)
}).catch((e) => { rec('异常', e.stack); flush(); try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {}; app.exit(1) })
