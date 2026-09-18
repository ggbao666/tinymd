import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const candidate = (process.argv[2] || '03').padStart(2, '0')
const require = createRequire(import.meta.url)
const { runIconsTool } = require('app-builder-lib/out/toolsets/icons')

copyFileSync(join(root, `icon-candidate-${candidate}.png`), join(root, 'build', 'icon.png'))
copyFileSync(join(root, `icon-candidate-${candidate}.svg`), join(root, 'build', 'icon-source.svg'))

const conversionDirectory = mkdtempSync(join(tmpdir(), 'tinymd-icon-'))
try {
  await runIconsTool({
    inputFile: join(root, 'build', 'icon.png'),
    outputFormat: 'ico',
    outDir: conversionDirectory,
  })
  copyFileSync(join(conversionDirectory, 'icon.ico'), join(root, 'build', 'icon.ico'))
} finally {
  rmSync(conversionDirectory, { recursive: true, force: true })
}

console.log(`Applied icon candidate ${candidate} with Electron Builder's standard ICO converter.`)
