import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const candidate = (process.argv[2] || '03').padStart(2, '0')
const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
const sizeDir = join(root, 'build', `icon-sizes-${candidate}`)

const images = sizes.map(size => {
  const file = join(sizeDir, `${size}.png`)
  const data = readFileSync(file)
  if (data.toString('ascii', 1, 4) !== 'PNG') throw new Error(`${file} is not a PNG file`)
  const width = data.readUInt32BE(16)
  const height = data.readUInt32BE(20)
  if (width !== size || height !== size) {
    throw new Error(`${file} must be ${size}x${size}, got ${width}x${height}`)
  }
  return { size, data }
})

const headerSize = 6 + images.length * 16
const header = Buffer.alloc(headerSize)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(images.length, 4)

let offset = headerSize
images.forEach(({ size, data }, index) => {
  const entry = 6 + index * 16
  header[entry] = size === 256 ? 0 : size
  header[entry + 1] = size === 256 ? 0 : size
  header[entry + 2] = 0
  header[entry + 3] = 0
  header.writeUInt16LE(1, entry + 4)
  header.writeUInt16LE(32, entry + 6)
  header.writeUInt32LE(data.length, entry + 8)
  header.writeUInt32LE(offset, entry + 12)
  offset += data.length
})

copyFileSync(join(root, `icon-candidate-${candidate}.png`), join(root, 'build', 'icon.png'))
copyFileSync(join(root, `icon-candidate-${candidate}.svg`), join(root, 'build', 'icon-source.svg'))
writeFileSync(join(root, 'build', 'icon.ico'), Buffer.concat([header, ...images.map(image => image.data)]))

console.log(`Applied icon candidate ${candidate}: build/icon.png, build/icon-source.svg and build/icon.ico`)
