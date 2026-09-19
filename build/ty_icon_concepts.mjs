// Typora 风格图标候选：单色圆角方块 + 极简字标，无阴影无叠层。
// 生成 icon-ty-01..06.svg 与 icon-ty-preview.html
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))

const INK = '#f4f3ef'      // 浅字
const CHARCOAL = '#363c42' // 深字
const TEAL = '#79a99b'     // 品牌青
const TILE_DARK = '#3a4148'
const TILE_LIGHT = '#ebeae4'
const TILE_TEAL = '#5f9284'

const tile = (fill) => `<rect width="1024" height="1024" rx="256" fill="${fill}"/>`

// 极简 M：三笔连写，圆角端点
const M_DARK = 'M292 714V310L512 565L732 310V714'
const mMark = (color, width = 78) =>
  `<path d="${M_DARK}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`

// 小写 ty：纯笔画，无字体依赖（横笔与 y 臂留出间隙，避免粘连）
const tyMark = (color, width = 74) => `
  <g fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round">
    <path d="M380 330v370" />
    <path d="M295 372h150" />
    <path d="M530 335l100 330" />
    <path d="M730 335l-135 450" />
  </g>`

// Markdown 语义 M↓
const mDownMark = (mColor, arrowColor, width = 74) => `
  <g fill="none" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">
    <path d="M226 700V318L416 545L606 318V700" stroke="${mColor}" />
    <path d="M738 330v290" stroke="${arrowColor}" />
  </g>
  <path d="M672 566 L804 566 L738 652 Z" fill="${arrowColor}" stroke="${arrowColor}" stroke-width="36" stroke-linejoin="round" />`

const icons = [
  {
    name: '01 墨字 M',
    desc: '深灰底 + 白色单笔 M，最接近 Typora 的极简单字标',
    svg: tile(TILE_DARK) + mMark(INK),
  },
  {
    name: '02 一点青',
    desc: 'M 的中折两笔用品牌青，白竖笔，多一分识别度',
    svg: tile(TILE_DARK) + `
  <g fill="none" stroke-width="78" stroke-linecap="round" stroke-linejoin="round">
    <path d="M292 714V310" stroke="${INK}" />
    <path d="M732 714V310" stroke="${INK}" />
    <path d="M292 310L512 565L732 310" stroke="${TEAL}" />
  </g>`,
  },
  {
    name: '03 ty 字标',
    desc: '小写 ty 笔画字标，致敬 Typora 的 Ty',
    svg: tile(TILE_DARK) + tyMark(INK),
  },
  {
    name: '04 浅色 M',
    desc: '米白底 + 炭色 M，浅色任务栏 / Dock 上更跳',
    svg: tile(TILE_LIGHT) + mMark(CHARCOAL),
  },
  {
    name: '05 M↓',
    desc: 'M + 下箭头，Markdown 语义一眼可读',
    svg: tile(TILE_DARK) + mDownMark(INK, TEAL),
  },
  {
    name: '06 青瓷 M',
    desc: '品牌青底 + 白 M，彩色方案里最稳的一版',
    svg: tile(TILE_TEAL) + mMark(INK),
  },
]

icons.forEach((it, index) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 1024 1024" style="display:block">
  ${it.svg}
</svg>`
  writeFileSync(join(root, `icon-ty-${String(index + 1).padStart(2, '0')}.svg`), svg)
})

const cards = icons.map((it, index) => {
  const file = `icon-ty-${String(index + 1).padStart(2, '0')}.svg`
  return `<figure>
    <div class="dual">
      <div class="bg light"><img src="${file}"></div>
      <div class="bg dark"><img src="${file}"></div>
    </div>
    <figcaption>${it.name}</figcaption>
    <p class="desc">${it.desc}</p>
    <div class="sizes">
      <div class="bg light chip"><img src="${file}"></div>
      <div class="bg dark chip"><img src="${file}"></div>
    </div>
  </figure>`
}).join('')

writeFileSync(join(root, 'icon-ty-preview.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>tinymd · Typora 风格图标候选</title><style>
*{box-sizing:border-box}
body{margin:0;background:#eceae6;font-family:"Segoe UI","Microsoft YaHei",sans-serif;color:#33363b;padding:36px}
h1{font-size:26px;margin:0 0 6px}h1 span{color:#8a8d92;font-weight:400}
.sub{margin:0 0 28px;color:#77797e;font-size:14px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;max-width:1360px}
figure{margin:0;background:#fff;border-radius:14px;padding:22px 22px 18px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.dual{display:flex;border-radius:10px;overflow:hidden}
.bg{flex:1;display:flex;align-items:center;justify-content:center}
.bg img{width:170px;height:170px;display:block}
.bg.light{background:#f6f5f2}
.bg.dark{background:#2e3238}
figcaption{font-size:19px;font-weight:650;margin-top:14px}
.desc{margin:4px 0 12px;font-size:13px;color:#77797e;line-height:1.5}
.sizes{display:flex;gap:8px}
.chip{width:64px;height:64px;border-radius:8px;overflow:hidden}
.chip img{width:100%;height:100%}
</style>
<h1>Typora 风格图标候选 <span>· 6 选 1</span></h1>
<p class="sub">每格左侧为浅色环境、右侧为深色环境；下方小图模拟任务栏 / 托盘尺寸下的辨识度。</p>
<div class="grid">${cards}</div>
</html>`)

console.log(`Generated ${icons.length} Typora-style candidates + preview in ${root}`)
