// 用 Electron 离屏窗口把 SVG 候选渲染为 1024×1024 PNG（带透明通道）
// 关键：不用 capturePage（会把透明区域合成到不透明的窗口背景上），
// 而是在页面里用 Canvas drawImage + toDataURL 导出，四角保持透明。
// 用法: npx electron build/render_icons_electron.cjs icon-ty-01.svg icon-ty-02.svg ...
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')

const root = join(__dirname, '..')
const files = process.argv.slice(2)
const logLines = []
const log = (msg) => logLines.push(String(msg))
const flushLog = () => { try { writeFileSync(join(root, 'build', 'render_log.txt'), logLines.join('\n')) } catch { /* ignore */ } }

let win = null

function withWindow() {
  if (win && !win.isDestroyed()) return win
  win = new BrowserWindow({
    width: 1200,
    height: 1200,
    show: false,
    frame: false,
    webPreferences: { offscreen: true, webSecurity: false }, // data: 页面需要加载 file: 图片
  })
  return win
}

async function renderPage(svgPath) {
  const w = withWindow()
  await w.loadURL('data:text/html,<body></body>')
  const fileUrl = 'file:///' + svgPath.replace(/\\/g, '/')
  const dataUrl = await w.webContents.executeJavaScript(`(async () => {
    const img = new Image()
    img.src = ${JSON.stringify(fileUrl)}
    await img.decode()
    const c = document.createElement('canvas')
    c.width = 1024
    c.height = 1024
    c.getContext('2d').drawImage(img, 0, 0, 1024, 1024)
    return c.toDataURL('image/png')
  })()`)
  return Buffer.from(String(dataUrl).split(',')[1], 'base64')
}

app.whenReady().then(async () => {
  try {
    log('args: ' + JSON.stringify(files))
    for (const file of files) {
      const png = await renderPage(join(root, file))
      const out = join(root, file.replace(/\.svg$/i, '.png'))
      writeFileSync(out, png)
      log(`rendered ${file} (${Math.round(png.length / 1024)} KB)`)
    }
    flushLog()
    if (win && !win.isDestroyed()) win.destroy()
    app.exit(0)
  } catch (e) {
    log('error: ' + (e?.stack || e))
    flushLog()
    app.exit(1)
  }
})
