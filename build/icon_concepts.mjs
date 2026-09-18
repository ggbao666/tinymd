import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const shell = (bg, tile, body, transparent = false) => `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 1024 1024" style="display:block">
  <defs><filter id="s" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="24" stdDeviation="30" flood-color="#111318" flood-opacity=".34"/></filter></defs>
${transparent ? '' : `  <rect width="1024" height="1024" fill="${bg}"/>\n`}  <rect x="${transparent ? 0 : 92}" y="${transparent ? 0 : 92}" width="${transparent ? 1024 : 840}" height="${transparent ? 1024 : 840}" rx="${transparent ? 256 : 210}" fill="${tile}"${transparent ? '' : ' filter="url(#s)"'}/>
  ${body}
</svg>`

const icons = [
  shell('#353940', '#3e434c', `
    <g filter="url(#s)"><rect x="254" y="184" width="516" height="656" rx="72" fill="#ecebe6"/></g>
    <path d="M626 184h144v144z" fill="#3e434c"/><path d="M626 184l144 144H626z" fill="#c9cbc8"/>
    <path d="M352 460l70 70-70 70" fill="none" stroke="#4d8277" stroke-width="42" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="462" y="574" width="190" height="40" rx="20" fill="#4d8277"/>`),
  shell('#444955', '#4d5360', `
    <rect x="214" y="214" width="596" height="596" rx="156" fill="#e7e5de"/>
    <rect x="454" y="296" width="112" height="428" rx="52" fill="#393d45"/>
    <rect x="340" y="398" width="340" height="110" rx="52" fill="#393d45"/>
    <rect x="522" y="612" width="136" height="112" rx="55" fill="#393d45"/>
    <circle cx="648" cy="678" r="42" fill="#72a494"/>`),
  shell('#374247', '#405057', `
    <g transform="matrix(1.2190476 0 0 1.2190476 -112.15238 -112.15238)">
      <path d="M236 278h188l88 164 88-164h188v468H650V480L520 674h-16L374 480v266H236z" fill="#ebeae4"/>
      <path d="M424 278l88 164v232h-8L374 480z" fill="#c5cbc8"/>
      <path d="M512 442l88-164 50 202-130 194h-8z" fill="#79a99b"/>
    </g>`, true),
  shell('#3f4652', '#48515f', `
    <g filter="url(#s)"><rect x="218" y="202" width="588" height="620" rx="82" fill="#e9e8e2"/></g>
    <g fill="#a9adb0"><rect x="322" y="366" width="330" height="38" rx="19"/><rect x="322" y="478" width="408" height="38" rx="19"/><rect x="322" y="590" width="270" height="38" rx="19"/><rect x="322" y="682" width="226" height="38" rx="19"/></g>
    <rect x="584" y="324" width="36" height="318" rx="18" fill="#ce725f"/>`),
  shell('#4a444c', '#554e58', `
    <rect x="196" y="248" width="632" height="528" rx="126" fill="#e9e6e0"/>
    <text x="512" y="615" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="274" font-weight="650" letter-spacing="-20" fill="#47414a">MD</text>
    <rect x="628" y="664" width="106" height="36" rx="18" fill="#9b7d91"/>`),
  shell('#474640', '#535149', `
    <rect x="284" y="234" width="506" height="480" rx="74" fill="#b7b6af"/>
    <rect x="234" y="304" width="506" height="486" rx="74" fill="#eceae3"/>
    <g fill="#686961"><rect x="334" y="424" width="298" height="42" rx="21"/><rect x="334" y="534" width="312" height="42" rx="21"/></g>
    <rect x="334" y="644" width="204" height="42" rx="21" fill="#c48661"/>`),
]

const names = ['Markdown 文档', '几何 t', '折页 M', '编辑光标', 'MD 字标', '叠放笔记']
icons.forEach((svg, index) => writeFileSync(join(root, `icon-candidate-${String(index + 1).padStart(2, '0')}.svg`), svg))

const cards = names.map((name, index) => `<figure><img src="icon-candidate-${String(index + 1).padStart(2, '0')}.svg"><figcaption>${String(index + 1).padStart(2, '0')}　${name}</figcaption><img class="tiny" src="icon-candidate-${String(index + 1).padStart(2, '0')}.svg"></figure>`).join('')
writeFileSync(join(root, 'icon-candidates-preview.html'), `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;width:1320px;height:1000px;overflow:hidden;background:#e7e6e2;font-family:"Segoe UI",sans-serif;color:#34363a}.grid{display:grid;grid-template-columns:repeat(3,440px);grid-template-rows:repeat(2,500px)}figure{margin:0;text-align:center;padding-top:38px;position:relative}figure>img:not(.tiny){display:block;width:340px;height:340px;margin:0 auto 17px}figcaption{font-size:30px;font-weight:650}.tiny{width:32px;height:32px;margin-top:12px}
</style><div class="grid">${cards}</div>`)

console.log(`Generated ${icons.length} SVG candidates and preview page in ${root}`)
