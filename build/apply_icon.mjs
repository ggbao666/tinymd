import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

const ico = readFileSync(join(root, 'build', 'icon.ico'))
const sizeDirectory = join(root, 'build', `icon-sizes-${candidate}`)
rmSync(sizeDirectory, { recursive: true, force: true })
mkdirSync(sizeDirectory, { recursive: true })
const imageCount = ico.readUInt16LE(4)
for (let index = 0; index < imageCount; index += 1) {
  const entry = 6 + index * 16
  const size = ico[entry] || 256
  const length = ico.readUInt32LE(entry + 8)
  const offset = ico.readUInt32LE(entry + 12)
  const image = ico.subarray(offset, offset + length)
  if (image.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error(`ICO entry ${size}x${size} is not PNG encoded`)
  }
  writeFileSync(join(sizeDirectory, `${size}.png`), image)
}
copyFileSync(join(sizeDirectory, '32.png'), join(root, 'build', 'icon-window.png'))

console.log(`Applied icon candidate ${candidate} with Electron Builder's standard ICO converter.`)
