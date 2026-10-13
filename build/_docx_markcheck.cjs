/* 验证 docx 导出：标题里的 highlight 不产 shading，正文 highlight 保留 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const { buildDocx } = require(path.join(ROOT, 'docx-export.cjs'))

const markdownToPmDoc = (() => {
  // 复用渲染层的 markdown→PM JSON 路径太重（要走 vite 构建），
  // 直接手写等价的 ProseMirror JSON（扩展集封闭，字段手抄自 docx-export 的消费形态）
  return {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1, textAlign: null }, content: [{ type: 'text', text: '标题', marks: [{ type: 'highlight', attrs: { color: null } }] }, { type: 'text', text: ' 与正文' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '正文 ' }, { type: 'text', text: '高亮', marks: [{ type: 'highlight', attrs: { color: null } }] }] },
    ],
  }
})()

;(async () => {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tinymd_docxmark_'))
  const out = path.join(TMP, 'out.docx')
  const { buffer } = await buildDocx(markdownToPmDoc, TMP, { title: 'mark-check' })
  fs.writeFileSync(out, buffer)
  // 拆 zip 检查 document.xml（jszip 是 docx 的传递依赖，已提升到顶层）
  const JSZip = require(path.join(ROOT, 'node_modules', 'jszip'))
  const zip = await JSZip.loadAsync(fs.readFileSync(out))
  const xml = await zip.file('word/document.xml').async('string')
  const results = []
  const push = (name, ok, info) => results.push({ name, ok: !!ok, info })
  // docx 库产出 <w:p>（无属性无空格），不能按 '<w:p ' 切；按 Heading1 定位段内片段
  const h1At = xml.indexOf('Heading1')
  const headingChunk = h1At >= 0 ? xml.slice(h1At, xml.indexOf('</w:p>', h1At)) : ''
  push('标题段无高亮 shading', headingChunk.length > 0 && !headingChunk.includes('w:shd'), { len: headingChunk.length, head: headingChunk.slice(0, 200) })
  const bodyAt = xml.indexOf('正文')
  const bodyChunk = bodyAt >= 0 ? xml.slice(Math.max(0, bodyAt - 600), bodyAt + 200) : ''
  push('正文段保留高亮 shading', bodyChunk.includes('w:shd'), {})
  console.log(JSON.stringify(results))
  try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {}
  process.exit(results.every((r) => r.ok) ? 0 : 1)
})().catch((e) => { console.error('ERR', e.message); process.exit(1) })
