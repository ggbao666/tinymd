/* 布局量测：把「哪里不合理」变成具体数字
   - 正文实际行宽（中文按 16px/字 折算每行字数）
   - 标题栏三组元素的横向分布
   - 状态栏/侧栏底栏的碎片
   - 目录面板与编辑区右缘的错位
   - 多个窗口宽度下的表现 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { app, BrowserWindow, dialog } = require('electron')

const ROOT = path.resolve(__dirname, '..')
const SHOT = path.join(__dirname, '_shots')
fs.mkdirSync(SHOT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const js = (w, code) => w.webContents.executeJavaScript(code)

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tinymd_measure_'))
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu')
app.disableHardwareAcceleration()
app.setPath('userData', path.join(TMP, 'user-data'))
dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] })
require(path.join(ROOT, 'main.js'))

const out = []

app.whenReady().then(async () => {
  // main.js 是 whenReady().then(...) 里同步建窗的，但那个 then 排在我们的 then 后面，
  // 所以这里要轮询等窗口出现（固定 sleep 会拍到空数组）
  let W = null
  for (let i = 0; i < 60 && !W; i++) {
    await sleep(150)
    W = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html')) || null
  }
  if (!W) { console.error('no window'); app.exit(1); return }
  await new Promise((res) => { if (W.webContents.isLoading()) W.webContents.once('did-finish-load', res); else res() })
  await sleep(600)

  // ---- 欢迎页量测 ----
  const welcome = await js(W, `(() => {
    const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return {x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height)} }
    return { win: {w: innerWidth, h: innerHeight}, inner: r('.welcome-inner'), mark: r('.app-mark'), links: r('.entry-links'), recents: r('#recents'), list: r('.recents-list') }
  })()`)
  out.push(['WELCOME', welcome])

  // ---- 造一个工作空间 ----
  const WS = path.join(TMP, '我的项目')
  fs.mkdirSync(WS, { recursive: true })
  fs.writeFileSync(path.join(WS, '产品需求文档.md'), [
    '# 产品需求文档', '', '这是第一段正文，用来量测行宽到底能塞多少个汉字。'.repeat(3), '',
    '## 一、背景', '', '第二段。', '',
    '## 二、功能列表', '', '1. 第一项', '2. 第二项', '',
    '## 三、接口定义', '', '正文。', '',
    '## 四、数据对照', '', '正文。', '',
    '## 五、补充说明', '', '正文。',
  ].join('\n'))
  fs.writeFileSync(path.join(WS, '会议纪要.md'), '# 会议纪要\n\n内容\n')
  fs.mkdirSync(path.join(WS, '子目录'), { recursive: true })
  fs.writeFileSync(path.join(WS, '子目录', '随笔.md'), '# 随笔\n\n内容\n')

  await js(W, `localStorage.setItem('jianmo.recents', ${JSON.stringify(JSON.stringify([{ path: WS.replace(/\\/g, '/'), name: '我的项目', time: Date.now(), kind: 'dir' }]))}); location.reload(); 1`)
  await sleep(1500)
  await js(W, `(document.querySelector('.recent-row') || {click(){}}).click(); 1`)
  await sleep(1200)
  await js(W, `(() => { const r = [...document.querySelectorAll('.tree-row.file')].find(x => x.dataset.path.includes('产品需求')); r.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); r.click(); return 1 })()`)
  await sleep(1400)

  const probe = `(() => {
    const R = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return {x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height)} }
    const cs = getComputedStyle(document.documentElement)
    const ed = document.querySelector('#editor')
    const pm = document.querySelector('.ProseMirror')
    const pad = ed ? getComputedStyle(ed) : null
    return {
      win: {w: innerWidth, h: innerHeight},
      topbar: R('#topbar'),
      topLeft: R('.topbar-left'),
      topRight: R('.topbar-right'),
      crumb: R('#breadcrumb'),
      sidebar: R('#sidebar'),
      sidebarLabel: R('#sidebar-files-label'),
      tree: R('#tree'),
      sidebarFooter: R('#sidebar-footer'),
      content: R('#content'),
      editorWrap: R('#editor-wrap'),
      editor: R('#editor'),
      pm: R('.ProseMirror'),
      statusPill: R('#status-pill'),
      toc: R('#toc-float'),
      vars: {
        contentPad: cs.getPropertyValue('--content-pad').trim(),
        sbw: cs.getPropertyValue('--sb-w').trim(),
        topbarH: cs.getPropertyValue('--topbar-h').trim(),
        statusH: cs.getPropertyValue('--statusbar-h').trim(),
      },
      padLeft: pad ? pad.paddingLeft : null,
      padRight: pad ? pad.paddingRight : null,
      padTop: pad ? pad.paddingTop : null,
      fontSize: pm ? getComputedStyle(pm).fontSize : null,
      lineHeight: pm ? getComputedStyle(pm).lineHeight : null,
      pmFont: pm ? getComputedStyle(pm).fontFamily.split(',')[0] : null,
      h1: (() => { const h = document.querySelector('.ProseMirror h1'); return h ? Math.round(h.getBoundingClientRect().height) : null })(),
      pmTextW: pm ? Math.round(pm.getBoundingClientRect().width) : null,
      sbWidth: document.querySelector('#sidebar').getBoundingClientRect().width,
      titleText: (document.querySelector('#breadcrumb')||{}).textContent,
      statusText: (document.querySelector('#status')||{}).textContent,
      countText: (document.querySelector('#count')||{}).textContent,
      wsPath: (document.querySelector('#ws-path')||{}).textContent,
    }
  })()`

  const base = await js(W, probe)
  out.push(['WORKSPACE-1000', base])

  const img = await W.webContents.capturePage()
  fs.writeFileSync(path.join(SHOT, 'm-1000.png'), img.toPNG())

  // 开目录
  await js(W, `document.querySelector('#btn-toc').click(); 1`)
  await sleep(500)
  out.push(['TOC-OPEN', await js(W, probe)])
  fs.writeFileSync(path.join(SHOT, 'm-toc.png'), (await W.webContents.capturePage()).toPNG())
  await js(W, `document.querySelector('#btn-toc').click(); 1`)
  await sleep(400)

  // 宽窗口
  W.setBounds({ x: 60, y: 60, width: 1600, height: 900 })
  await sleep(700)
  out.push(['WIDE-1600', await js(W, probe)])
  fs.writeFileSync(path.join(SHOT, 'm-1600.png'), (await W.webContents.capturePage()).toPNG())

  // 窄窗口
  W.setBounds({ x: 60, y: 60, width: 760, height: 680 })
  await sleep(700)
  out.push(['NARROW-760', await js(W, probe)])
  fs.writeFileSync(path.join(SHOT, 'm-760.png'), (await W.webContents.capturePage()).toPNG())

  W.setBounds({ x: 60, y: 60, width: 1000, height: 680 })
  await sleep(600)

  // 亮色
  await js(W, `document.querySelector('#btn-image-settings').click(); 1`)
  await sleep(400)
  await js(W, `document.querySelector('[data-settings-page="appearance"]').click(); 1`)
  await sleep(300)
  await js(W, `(() => { const r = document.querySelector('input[name="settings-theme"][value="light"]'); r.click(); return 1 })()`)
  await sleep(500)
  await js(W, `document.querySelector('#btn-settings-close').click(); 1`)
  await sleep(500)
  fs.writeFileSync(path.join(SHOT, 'm-light.png'), (await W.webContents.capturePage()).toPNG())
  await js(W, `document.querySelector('#btn-image-settings').click(); 1`); await sleep(300)
  await js(W, `document.querySelector('[data-settings-page="appearance"]').click(); 1`); await sleep(200)
  await js(W, `document.querySelector('input[name="settings-theme"][value="neutral"]').click(); 1`); await sleep(400)
  await js(W, `document.querySelector('#btn-settings-close').click(); 1`); await sleep(400)

  // 纯文本模式
  await js(W, `document.querySelector('#btn-source-mode').click(); 1`)
  await sleep(600)
  fs.writeFileSync(path.join(SHOT, 'm-source.png'), (await W.webContents.capturePage()).toPNG())
  out.push(['SOURCE', await js(W, probe)])
  await js(W, `document.querySelector('#btn-source-mode').click(); 1`)
  await sleep(400)

  // 空状态
  await js(W, `window.__t = null; 1`)
  fs.writeFileSync(path.join(ROOT, 'measure.json'), JSON.stringify(out, null, 2))
  console.log(JSON.stringify(out, null, 2))
  app.exit(0)
})