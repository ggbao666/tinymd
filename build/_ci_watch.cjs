/* 轮询 v0.5.0 的 Release workflow 直到完成，并报告 Release 与资产 */
const TOKEN = process.env.GH_TOKEN
const REPO = 'ggbao666/tinymd'
const TAG = 'v0.5.0'
const api = async (path) => {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`https://api.github.com${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } })
      if (res.status === 403 || res.status === 502) { await new Promise(r => setTimeout(r, 15000)); continue }
      return res.json()
    } catch { await new Promise(r => setTimeout(r, 15000)) }
  }
  return null
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function main() {
  // 找到 v0.5.0 的 run
  let run = null
  for (let i = 0; i < 5 && !run; i++) {
    const j = await api(`/repos/${REPO}/actions/runs?per_page=5`)
    run = (j?.workflow_runs || []).find(r => r.head_branch === TAG && r.name === 'Release')
    if (!run) await sleep(15000)
  }
  if (!run) { console.log('RESULT: run not found'); process.exit(1) }
  console.log(`run ${run.id}: ${run.status}`)
  // 轮询直到 completed（上限 60 次 × 30s = 30 分钟）
  let done = null
  for (let i = 0; i < 60; i++) {
    await sleep(30000)
    const j = await api(`/repos/${REPO}/actions/runs/${run.id}`)
    if (!j) continue
    process.stdout.write(`[${i}] status=${j.status} conclusion=${j.conclusion}\n`)
    if (j.status === 'completed') { done = j; break }
  }
  if (!done) { console.log('RESULT: timeout'); process.exit(1) }
  console.log(`RESULT: ${done.conclusion}`)
  // 逐 job
  const jobs = await api(`/repos/${REPO}/actions/runs/${run.id}/jobs`)
  for (const job of jobs?.jobs || []) {
    console.log(`job: ${job.name} -> ${job.conclusion}`)
    for (const s of job.steps || []) if (s.conclusion !== 'success' && s.conclusion !== 'skipped') console.log(`  step: ${s.name} -> ${s.conclusion}`)
  }
  // Release 与资产
  const rel = await api(`/repos/${REPO}/releases/tags/${TAG}`)
  if (!rel || !rel.id) { console.log('RELEASE: none'); return }
  console.log(`RELEASE: ${rel.name || rel.tag_name} draft=${rel.draft} prerelease=${rel.prerelease}`)
  console.log(`URL: ${rel.html_url}`)
  for (const a of rel.assets || []) console.log(`asset: ${a.name} (${Math.round(a.size / 1024 / 1024 * 10) / 10} MB)`)
}
main().catch(e => { console.error(e); process.exit(1) })