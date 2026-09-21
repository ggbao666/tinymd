#!/usr/bin/env node
/**
 * tinymd 缓存清理脚本
 *
 * 用法：
 *   node build/clean.mjs              # 只看会删什么（dry-run，不动文件）
 *   node build/clean.mjs --yes        # 清理项目内构建产物与临时文件
 *   node build/clean.mjs --cache --yes   # 额外清应用运行时缓存（保留用户设置）
 *   node build/clean.mjs --data --yes    # 额外清 localStorage（会重置主题/最近文件等设置）
 *   node build/clean.mjs --deps --yes    # 额外删 node_modules（之后需重新 npm install）
 *   node build/clean.mjs --all --yes     # 以上全部
 *
 * 安全约定：
 *   - 只删白名单路径，不接受外部传入的任意路径
 *   - 不会删 build/icon.png|icon.ico|icon-window.png（electron-builder 打包依赖）
 *   - 不会碰 src/ 与任何源码
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const root = path.resolve(import.meta.dirname, '..')
const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const all = has('--all')
const apply = has('--yes') || has('-y')
const doCache = all || has('--cache')
const doData = all || has('--data')
const doDeps = all || has('--deps')

const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
const userDataDir = path.join(appData, 'tinymd')

/** @type {{label:string, targets:string[], note?:string}[]} */
const groups = []

// ---------- 1. 打包 / 构建产物（始终清理） ----------
groups.push({
  label: '打包产物 (electron-builder)',
  targets: [path.join(root, 'release')],
  note: '安装包与 win-unpacked，重新 npm run dist:win 可重建',
})
groups.push({
  label: '渲染层构建产物 (vite build)',
  targets: [path.join(root, 'dist')],
  note: '重新 npm run build 可重建；注意：直接 electron . 启动前必须先 build',
})
groups.push({
  label: 'Vite 依赖预构建缓存',
  targets: [
    path.join(root, 'node_modules', '.vite'),
    path.join(root, 'node_modules', '.cache'),
    path.join(root, 'node_modules', '.tmp'),
  ],
  note: '下次 dev/build 自动重建',
})
groups.push({
  label: 'build/ 下的临时日志与中间图标',
  targets: [
    ...globBuild(/^run\d*\.(log|txt)$/i),
    ...globBuild(/^render_log\.txt$/i),
    ...globBuild(/^welcome-mark-check\.(html|png)$/i),
    ...globBuild(/^icon-sizes-.+$/i),
  ],
  note: '图标中间尺寸目录由 build:icon 重建；不含 icon.png/ico/icon-window.png',
})

// ---------- 2. 应用运行时缓存（--cache） ----------
if (doCache) {
  groups.push({
    label: '应用运行时缓存 (Chromium/GPU/网络)',
    targets: [
      'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'DIPS',
      'Network', 'Shared Dictionary', 'Dictionaries', 'Code Cache',
      'declarative_performance_observer.db',
    ].map((n) => path.join(userDataDir, n)),
    note: `位于 ${userDataDir}，应用下次启动自动重建，不影响设置`,
  })
  groups.push({
    label: '自动更新缓存',
    targets: [path.join(localAppData, 'tinymd-updater')],
    note: '下载过的更新包',
  })
}

// ---------- 3. 用户设置（--data，破坏性） ----------
if (doData) {
  groups.push({
    label: '⚠ 用户设置 (localStorage)',
    targets: [
      path.join(userDataDir, 'Local Storage'),
      path.join(userDataDir, 'Session Storage'),
    ],
    note: '会重置主题、最近打开文件、侧栏宽度、编辑区宽度、图片存储设置',
  })
}

// ---------- 4. 依赖（--deps） ----------
if (doDeps) {
  groups.push({
    label: '依赖目录',
    targets: [path.join(root, 'node_modules')],
    note: '之后必须重新 npm install',
  })
}

function globBuild(re) {
  const dir = path.join(root, 'build')
  try {
    return fs.readdirSync(dir).filter((n) => re.test(n)).map((n) => path.join(dir, n))
  } catch { return [] }
}

function sizeOf(p) {
  try {
    const st = fs.statSync(p)
    if (st.isFile()) return st.size
    let total = 0
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      total += sizeOf(path.join(p, e.name))
    }
    return total
  } catch { return 0 }
}

const fmt = (b) => b >= 1 << 30 ? `${(b / (1 << 30)).toFixed(2)} GB`
  : b >= 1 << 20 ? `${(b / (1 << 20)).toFixed(1)} MB`
  : b >= 1 << 10 ? `${(b / (1 << 10)).toFixed(0)} KB` : `${b} B`

let grand = 0
let found = 0
console.log(`\n${apply ? '清理' : '预览（dry-run，未删除任何文件）'} — ${root}\n`)

for (const g of groups) {
  const existing = g.targets.filter((p) => fs.existsSync(p))
  if (!existing.length) continue
  const bytes = existing.reduce((s, p) => s + sizeOf(p), 0)
  grand += bytes
  found += existing.length
  console.log(`▸ ${g.label}  [${fmt(bytes)}]`)
  if (g.note) console.log(`  ${g.note}`)
  for (const p of existing) {
    const rel = p.startsWith(root) ? path.relative(root, p) : p
    if (apply) {
      try {
        fs.rmSync(p, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
        console.log(`  ✓ ${rel}`)
      } catch (e) {
        console.log(`  ✗ ${rel} — ${e.message}`)
      }
    } else {
      console.log(`  · ${rel}`)
    }
  }
  console.log()
}

if (!found) {
  console.log('没有可清理的内容，已经是干净状态。\n')
  process.exit(0)
}

console.log(`合计 ${found} 项，约 ${fmt(grand)}`)
if (!apply) {
  console.log('\n以上仅为预览。确认无误后加 --yes 执行：')
  console.log(`  node build/clean.mjs ${argv.join(' ')} --yes`.replace(/\s+/g, ' '))
}
console.log()
