// 验证文件树行尾操作按钮：⋮ 打开原右键菜单、目录 + 新建文件、行右键已移除。
// 用真实 main.js 启动应用，executeJavaScript 驱动，结果落盘 JSON。
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { once } = require('events')

const records = []
const rec = (name, ok, extra) => { records.push({ name, ok, extra }); console.log((ok ? 'PASS' : 'FAIL') + ' ' + name) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 沙箱 + 临时 userData（单实例锁 / localStorage 隔离，别和用户开着的实例打架）
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu')
app.disableHardwareAcceleration()
const TMP_USERDATA = path.join(os.tmpdir(), '_verify_treeact_' + Date.now())
fs.mkdirSync(TMP_USERDATA, { recursive: true })
app.setPath('userData', TMP_USERDATA)

require('../main.js')   // 启动真实应用（IPC / preload 全是正式那套）

// 临时工作空间：根目录一个文件 + 一个子目录（子目录里一个文件）
const WS = path.join(os.tmpdir(), '_verify_treeact_ws_' + Date.now())
const SUB = path.join(WS, '子目录')
fs.mkdirSync(SUB, { recursive: true })
fs.writeFileSync(path.join(WS, '根文件.md'), '# root\n')
fs.writeFileSync(path.join(SUB, '子文件.md'), '# sub\n')

process.on('uncaughtException', (e) => { rec('uncaughtException', false, e.message); try { flush() } catch {} ; app.exit(1) })
process.on('unhandledRejection', (e) => { rec('unhandledRejection', false, String(e)); try { flush() } catch {} ; app.exit(1) })

function flush() { fs.writeFileSync(path.join(__dirname, '_verify_treeact_result.json'), JSON.stringify(records, null, 2)) }

async function waitForWindow() {
  for (let i = 0; i < 100; i++) {
    const w = BrowserWindow.getAllWindows()[0]
    if (w) return w
    await sleep(100)
  }
  throw new Error('window never appeared')
}

app.whenReady().then(async () => {
  try {
    const win = await waitForWindow()
    if (win.webContents.isLoading()) await once(win.webContents, 'did-finish-load')
    await sleep(600)
    const js = (code) => win.webContents.executeJavaScript(code)

    // 走「最近打开」进工作空间（不碰原生对话框）
    await js(`localStorage.setItem('jianmo.recents', JSON.stringify([
      { path: ${JSON.stringify(WS)}, name: 'x', time: Date.now(), kind: 'dir' }
    ]))`)
    await js(`location.reload()`)
    await once(win.webContents, 'did-finish-load')
    await sleep(800)
    await js(`document.querySelector('.recent-row').click()`)
    // 等树渲染出根文件行
    let ok = false
    for (let i = 0; i < 50; i++) {
      ok = await js(`!!document.querySelector('.tree-row.file[data-path]')`)
      if (ok) break
      await sleep(100)
    }
    if (!ok) throw new Error('tree never rendered')

    // 1) 按钮构成：文件行只有 ⋮，目录行是 + + ⋮
    const structure = await js(`(() => {
      const rows = [...document.querySelectorAll('.tree-row')]
      return rows.map(r => ({
        type: r.classList.contains('dir') ? 'dir' : 'file',
        path: r.dataset.path,
        acts: [...r.querySelectorAll('.tree-act')].map(b => b.title),
      }))
    })()`)
    const fileRow = structure.find(r => r.type === 'file' && path.dirname(r.path) === WS)
    const dirRow = structure.find(r => r.type === 'dir')
    rec('文件行只有 ⋮', !!fileRow && fileRow.acts.length === 1 && fileRow.acts[0] === '更多操作', fileRow)
    rec('目录行是 + 和 ⋮', !!dirRow && dirRow.acts.length === 2 && dirRow.acts[0] === '新建文件' && dirRow.acts[1] === '更多操作', dirRow)

    // 2) 未选中且未 hover 的行：按钮区不占布局；hover 规则存在
    const idleDisplay = await js(`getComputedStyle(document.querySelector('.tree-row .tree-actions')).display`)
    rec('未 hover 的行按钮区 display:none', idleDisplay === 'none', idleDisplay)
    const hasHoverRule = await js(`[...document.styleSheets].some(s => { try { return [...s.cssRules].some(r => r.selectorText && r.selectorText.includes('.tree-row:hover .tree-actions')) } catch { return false } })`)
    rec('CSS 有 :hover 浮现规则', hasHoverRule === true, hasHoverRule)

    // 3) 点文件行打开（顺带选中 → 选中行按钮区可见），再点 ⋮ 应弹出原右键菜单
    await js(`document.querySelector('.tree-row.file[data-path]').click()`)
    await sleep(400)
    const selVisible = await js(`(() => {
      const a = document.querySelector('.tree-row.selected .tree-actions')
      return a ? getComputedStyle(a).display : 'missing'
    })()`)
    rec('选中行按钮区可见', selVisible === 'flex', selVisible)

    await js(`document.querySelector('.tree-row.selected .tree-act').click()`)
    let menuText = ''
    for (let i = 0; i < 40; i++) {
      menuText = await js(`document.querySelector('.ctx-menu')?.textContent || ''`)
      if (menuText) break
      await sleep(100)
    }
    rec('⋮ 弹出文件菜单', /打开/.test(menuText) && /导出为 PDF/.test(menuText) && /移到废纸篓/.test(menuText), menuText)
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
    await sleep(200)
    const menuGone = await js(`!document.querySelector('.ctx-menu')`)
    rec('Escape 关闭菜单', menuGone === true)

    // 4) 行右键不再弹菜单；空白处右键仍是根目录菜单
    await js(`(() => {
      const r = document.querySelector('.tree-row.file[data-path]').getBoundingClientRect()
      document.querySelector('.tree-row.file[data-path]').dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 5 }))
    })()`)
    await sleep(400)
    const noRowMenu = await js(`!document.querySelector('.ctx-menu')`)
    rec('行右键不再弹菜单', noRowMenu === true)

    await js(`(() => {
      const t = document.getElementById('tree')
      const r = t.getBoundingClientRect()
      t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true,
        clientX: r.left + r.width / 2, clientY: r.bottom - 10 }))
    })()`)
    let rootMenu = ''
    for (let i = 0; i < 30; i++) {
      rootMenu = await js(`document.querySelector('.ctx-menu')?.textContent || ''`)
      if (rootMenu) break
      await sleep(100)
    }
    rec('空白处右键仍是根目录菜单', /新建文件/.test(rootMenu) && /在文件夹中打开/.test(rootMenu), rootMenu)
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
    await sleep(200)

    // 5) 点目录行的 +：在该目录下新建文件 → 进重命名态，磁盘上真出现 未命名.md
    await js(`(() => {
      const row = document.querySelector('.tree-row.dir[data-path]')
      const plus = row.querySelector('.tree-act')   // 目录行第一个按钮就是 +
      plus.click()
    })()`)
    let renameInfo = null
    for (let i = 0; i < 50; i++) {
      renameInfo = await js(`(() => {
        const input = document.querySelector('input.tree-rename')
        if (!input) return null
        const row = input.closest('.tree-row')
        return { value: input.value, parent: row.dataset.path }
      })()`)
      if (renameInfo) break
      await sleep(100)
    }
    const created = path.join(SUB, '未命名.md')
    // 重命名输入框在「新文件自己的行」上，所以 parent 是新文件路径；其所在目录才是 SUB
    rec('+ 在当前目录下新建文件并进重命名态', !!renameInfo && renameInfo.value === '未命名' && path.dirname(renameInfo.parent) === SUB, renameInfo)
    rec('磁盘上出现 未命名.md', fs.existsSync(created) && fs.statSync(created).size === 0)

    // Escape 取消重命名；文件保留默认名
    await js(`document.querySelector('input.tree-rename').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await sleep(300)
    const stillThere = await js(`(() => {
      const row = [...document.querySelectorAll('.tree-row')].find(r => r.dataset.path === ${JSON.stringify(created)})
      return !!row && !row.querySelector('input')
    })()`)
    rec('Escape 后保留默认名', stillThere === true)

    // 截一张图留档（子目录展开 + 新文件行）
    await js(`(() => { const d = document.querySelector('.tree-row.dir[data-path]'); if (d) d.click(); return true })()`)
    await sleep(300)
    fs.writeFileSync(path.join(__dirname, '_verify_treeact.png'), (await win.webContents.capturePage()).toPNG())

    flush()
    app.exit(0)
  } catch (e) {
    rec('script error', false, e && e.message)
    flush()
    app.exit(1)
  }
})
