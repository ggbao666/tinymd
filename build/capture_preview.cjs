// 离屏截图预览 HTML → PNG（页面为不透明背景，可直接 capturePage）
// 用法: node node_modules/electron/cli.js build/capture_preview.cjs <html相对路径> <png输出相对路径> <宽> <高>
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')

const root = join(__dirname, '..')
const [htmlFile, outFile, w, h] = process.argv.slice(2)

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: Number(w) || 1320,
    height: Number(h) || 800,
    show: false,
    frame: false,
    webPreferences: { offscreen: true, webSecurity: false },
  })
  await win.loadURL('file:///' + join(root, htmlFile).replace(/\\/g, '/'))
  await new Promise((r) => setTimeout(r, 500))
  const img = await win.webContents.capturePage()
  writeFileSync(join(root, outFile), img.toPNG())
  win.destroy()
  app.exit(0)
})
