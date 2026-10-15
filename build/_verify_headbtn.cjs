/* 侧栏头部与顶栏按钮组的一致性核对：同尺寸、同圆角、同图标大小 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { app, BrowserWindow, dialog } = require('electron')

const ROOT = path.resolve(__dirname, '..')
const SHOT = path.join(__dirname, '_shots')
fs.mkdirSync(SHOT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const js = (w, code) => w.webContents.executeJavaScript(code)

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tinymd_headbtn_'))
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
  fs.writeFileSync(path.join(WS, '产品需求文档.md'), '# 产品需求文档\n\n## 一、背景\n\n正文。\n\n## 二、功能\n\n正文。\n')
  fs.writeFileSync(path.join(WS, '会议纪要.md'), '# 会议纪要\n\n内容\n')

  await js(W, `localStorage.setItem('jianmo.recents', ${JSON.stringify(JSON.stringify([{ path: WS.replace(/\\/g, '/'), name: '我的项目', time: Date.now(), kind: 'dir' }]))}); location.reload(); 1`)
  await sleep(1500)
  await js(W, `(document.querySelector('.recent-row') || {click(){}}).click(); 1`)
  await sleep(1300)
  await js(W, `(() => { const r = [...document.querySelectorAll('.tree-row.file')].find(x => x.dataset.path.includes('产品需求')); r.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); r.click(); return 1 })()`)
  await sleep(1500)

  // 量两处的按钮规格
  const m = await js(W, `(() => {
    const spec = (sel) => {
      const e = document.querySelector(sel)
      if (!e) return null
      const cs = getComputedStyle(e)
      const b = e.getBoundingClientRect()
      const svg = e.querySelector('svg')
      return {
        w: Math.round(b.width), h: Math.round(b.height),
        radius: cs.borderTopLeftRadius,
        svgW: svg ? Math.round(svg.getBoundingClientRect().width) : null,
        cls: e.className,
        label: (e.textContent || '').trim(),
      }
    }
    return {
      tabFiles: spec('#tab-files'),
      tabOutline: spec('#tab-outline'),
      headAdd: spec('#btn-add-file'),
      headAddDir: spec('#btn-add-folder'),
      topFolder: spec('#btn-open-folder-ws'),
      topFile: spec('#btn-open-file-ws'),
      headH: Math.round(document.querySelector('.sidebar-head').getBoundingClientRect().height),
      tabH: Math.round(document.querySelector('.sidebar-head-tabs').getBoundingClientRect().height),
      actionsGap: getComputedStyle(document.querySelector('.sidebar-head-actions')).gap,
      // 容器不能有底色/边框 —— 会和 .icon-btn.active 的 accent 底色打架
      tabsBg: getComputedStyle(document.querySelector('.sidebar-head-tabs')).backgroundColor,
      tabsBorder: getComputedStyle(document.querySelector('.sidebar-head-tabs')).borderTopWidth,
      // 头部与内容区之间的发丝线
      headBorderB: getComputedStyle(document.querySelector('.sidebar-head')).borderBottomWidth,
      headBorderColor: getComputedStyle(document.querySelector('.sidebar-head')).borderBottomColor,
      topbarBorderColor: getComputedStyle(document.querySelector('#topbar')).borderBottomColor,
      statusBorderColor: getComputedStyle(document.querySelector('#statusbar')).borderTopColor,
      // 顶栏「打开文件夹/打开文件」两个图标的 path —— 曾因两个都是圆角方块被用户指出分不清
      dFolder: [...document.querySelectorAll('#btn-open-folder-ws svg path')].map((x) => x.getAttribute('d')).join('|'),
      dFile: [...document.querySelectorAll('#btn-open-file-ws svg path')].map((x) => x.getAttribute('d')).join('|'),
      dAddFile: [...document.querySelectorAll('#btn-add-file svg path')].map((x) => x.getAttribute('d')).join('|'),
    }
  })()`)

  // 头部四枚 + 顶栏两枚，六枚都应是 30px / 圆角 7 / 图标 16
  const all = [['tab-files', m.tabFiles], ['tab-outline', m.tabOutline], ['btn-add-file', m.headAdd],
    ['btn-add-folder', m.headAddDir], ['top-folder', m.topFolder], ['top-file', m.topFile]]
  for (const [name, s] of all) {
    ok(`${name}：30px 方形`, s.w === 30 && s.h === 30, s)
  }
  const radii = new Set(all.map(([, s]) => s.radius))
  ok('六枚按钮圆角全部一致（7px）', radii.size === 1 && radii.has('7px'), [...radii])
  const svgW = new Set(all.map(([, s]) => s.svgW))
  ok('六枚按钮图标尺寸全部一致（16px）', svgW.size === 1 && svgW.has(16), [...svgW])

  ok('头部四枚都**没有文字标签**（纯图标）',
    all.slice(0, 4).every(([, s]) => s.label === ''),
    all.slice(0, 4).map(([n, s]) => ({ n, label: s.label })))
  // 头部 = 30px 按钮 + 上下各 4 padding + 1px 下边框 = 39
  ok('头部高度 = 38 内容 + 1px 下边框 = 39', m.headH === 39, m.headH)
  ok('头部下沿有 1px 发丝线（分界工具区/内容区）', m.headBorderB === '1px', m.headBorderB)
  // 直接比「算出来的色值」：三处都写 --hairline，解析后应是同一个 rgba。
  // 别去比 CSS 变量的字面值（那是 "rgba(255,255,255,0.075)"），getComputedStyle 给的是 rgb()。
  ok('发丝线与顶栏下沿、状态栏上沿同色', m.headBorderColor === m.statusBorderColor && m.headBorderColor === m.topbarBorderColor,
    { head: m.headBorderColor, topbar: m.topbarBorderColor, status: m.statusBorderColor })
  ok('切页按钮组无底色（避免与 active 底色打架）', m.tabsBg === 'rgba(0, 0, 0, 0)' && m.tabsBorder === '0px',
    { bg: m.tabsBg, border: m.tabsBorder })
  ok('打开文件夹/文件图标形状不同（可区分）', m.dFolder !== m.dFile, { folder: m.dFolder.slice(0, 30), file: m.dFile.slice(0, 30) })
  ok('打开文件夹是开口形状（含前面板斜线）', m.dFolder.includes('12.9'), m.dFolder.slice(0, 40))
  // 用户指定：打开文件 = 纯纸（折角文件），新建文件 = file-plus（纸+中心加号）
  ok('打开文件是纸形状（折角完整、右缘到底）',
    m.dFile.includes('M2 12.5V3.5') && m.dFile.includes('M8.5 3.5h4.5v4.5'), m.dFile.slice(0, 80))
  // 新建文件 = file-plus（纸+加号），加号居中
  ok('新建文件是 file-plus（纸+中心加号）',
    m.dAddFile && m.dAddFile.includes('M2 12.5V3.5') && m.dAddFile.includes('M7.5 6v4') && m.dAddFile.includes('M5.5 8h4'),
    m.dAddFile ? m.dAddFile.slice(0, 80) : '')

  // 亮色 + 大纲页（按钮应隐藏但头部不塌）
  await js(W, `document.querySelector('#btn-image-settings').click(); 1`); await sleep(400)
  await js(W, `document.querySelector('[data-settings-page="appearance"]').click(); 1`); await sleep(250)
  await js(W, `document.querySelector('input[name="settings-theme"][value="light"]').click(); 1`); await sleep(500)
  await js(W, `document.querySelector('#btn-settings-close').click(); 1`); await sleep(700)
  fs.writeFileSync(path.join(SHOT, 'headbtn-light.png'), (await W.webContents.capturePage()).toPNG())
  await js(W, `document.querySelector('#btn-image-settings').click(); 1`); await sleep(300)
  await js(W, `document.querySelector('[data-settings-page="appearance"]').click(); 1`); await sleep(250)
  await js(W, `document.querySelector('input[name="settings-theme"][value="neutral"]').click(); 1`); await sleep(400)
  await js(W, `document.querySelector('#btn-settings-close').click(); 1`); await sleep(400)

  await js(W, `document.querySelector('#tab-outline').click(); 1`); await sleep(600)
  const m2 = await js(W, `(() => ({
    actions: getComputedStyle(document.querySelector('.sidebar-head-actions')).display,
    headH: Math.round(document.querySelector('.sidebar-head').getBoundingClientRect().height),
    // 纯图标两枚是固定宽度，不再随容器拉伸，所以这里只验「头部不塌 + 切换按钮还在」
    tabsW: Math.round(document.querySelector('.sidebar-head-tabs').getBoundingClientRect().width),
    outlineActive: document.querySelector('#tab-outline').classList.contains('active'),
    filesActive: document.querySelector('#tab-files').classList.contains('active'),
  }))()`)
  ok('大纲页：新建按钮隐藏', m2.actions === 'none', m2.actions)
  ok('大纲页：头部不塌（仍 39px，含分割线）', m2.headH === 39, m2.headH)
  ok('大纲页：切页按钮仍在（active 落到大纲）', m2.outlineActive && !m2.filesActive, m2)
  fs.writeFileSync(path.join(SHOT, 'headbtn-outline.png'), (await W.webContents.capturePage()).toPNG())

  // 窄侧栏下不挤坏
  await js(W, `document.querySelector('#tab-files').click(); 1`); await sleep(300)
  W.setBounds({ x: 60, y: 60, width: 700, height: 680 })
  await sleep(700)
  const m3 = await js(W, `(() => {
    const b = document.querySelector('#sidebar').getBoundingClientRect()
    const t = document.querySelector('.sidebar-head-tabs').getBoundingClientRect()
    const a = document.querySelector('.sidebar-head-actions').getBoundingClientRect()
    const wrap = document.querySelector('#editor-wrap')
    return { sidebarW: Math.round(b.width), tabsW: Math.round(t.width), actsW: Math.round(a.width), noHScroll: wrap.scrollWidth <= wrap.clientWidth + 1 }
  })()`)
  ok('700 窄窗：头部两组不溢出侧栏', m3.tabsW + m3.actsW + 6 + 16 <= m3.sidebarW, m3)
  ok('700 窄窗：正文无横向滚动', m3.noHScroll, m3.noHScroll)
  fs.writeFileSync(path.join(SHOT, 'headbtn-narrow.png'), (await W.webContents.capturePage()).toPNG())

  const bad = rec.filter((r) => !r.p)
  console.log(`\n${rec.length - bad.length}/${rec.length} passed`)
  app.exit(bad.length ? 1 : 0)
}).catch((e) => { console.error(e); app.exit(1) })