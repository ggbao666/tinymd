import './image-viewer.css'

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!

document.body.classList.add(window.api.platform === 'win32' ? 'win' : window.api.platform === 'darwin' ? 'mac' : 'other')

const canvas = $('#viewer-canvas')
const image = $<HTMLImageElement>('#viewer-image')
const titleEl = $('#viewer-title')
const zoomLabel = $('#zoom-label')
const errorEl = $('#viewer-error')

let scale = 1
let tx = 0
let ty = 0
let fitMode = true
let dragging = false
let startX = 0
let startY = 0
let baseX = 0
let baseY = 0

function applyTransform() {
  image.style.transform = `translate(-50%, -50%) translate(${tx}px, ${ty}px) scale(${scale})`
  zoomLabel.textContent = `${Math.round(scale * 100)}%`
}

function fitImage() {
  if (!image.naturalWidth || !image.naturalHeight) return
  const padding = 48
  scale = Math.min(
    1,
    (canvas.clientWidth - padding * 2) / image.naturalWidth,
    (canvas.clientHeight - padding * 2) / image.naturalHeight,
  )
  scale = Math.max(0.01, scale)
  tx = 0
  ty = 0
  fitMode = true
  applyTransform()
}

function actualSize() {
  scale = 1
  tx = 0
  ty = 0
  fitMode = false
  applyTransform()
}

function zoomTo(next: number, clientX?: number, clientY?: number) {
  const nextScale = Math.min(12, Math.max(0.02, next))
  const rect = canvas.getBoundingClientRect()
  const cx = (clientX ?? rect.left + rect.width / 2) - rect.left
  const cy = (clientY ?? rect.top + rect.height / 2) - rect.top
  const centerX = rect.width / 2
  const centerY = rect.height / 2
  const factor = nextScale / scale
  tx = cx - centerX - (cx - centerX - tx) * factor
  ty = cy - centerY - (cy - centerY - ty) * factor
  scale = nextScale
  fitMode = false
  applyTransform()
}

$('#zoom-out').addEventListener('click', () => zoomTo(scale / 1.25))
$('#zoom-in').addEventListener('click', () => zoomTo(scale * 1.25))
$('#actual-size').addEventListener('click', actualSize)
$('#fit-window').addEventListener('click', fitImage)

canvas.addEventListener('wheel', (event) => {
  event.preventDefault()
  zoomTo(scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15), event.clientX, event.clientY)
}, { passive: false })

canvas.addEventListener('mousedown', (event) => {
  if (event.button !== 0) return
  dragging = true
  startX = event.clientX
  startY = event.clientY
  baseX = tx
  baseY = ty
  canvas.classList.add('dragging')
})

window.addEventListener('mousemove', (event) => {
  if (!dragging) return
  tx = baseX + event.clientX - startX
  ty = baseY + event.clientY - startY
  applyTransform()
})

window.addEventListener('mouseup', () => {
  dragging = false
  canvas.classList.remove('dragging')
})

canvas.addEventListener('dblclick', () => {
  if (fitMode) actualSize()
  else fitImage()
})

window.addEventListener('resize', () => {
  if (fitMode) fitImage()
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') window.close()
  else if (event.key === '+' || event.key === '=') zoomTo(scale * 1.25)
  else if (event.key === '-') zoomTo(scale / 1.25)
  else if (event.key === '0') fitImage()
  else if (event.key === '1') actualSize()
})

image.addEventListener('load', fitImage)
image.addEventListener('error', () => {
  image.hidden = true
  errorEl.hidden = false
})

const data = await window.api.imageViewerData()
if (data) {
  document.title = data.title
  titleEl.textContent = data.title
  titleEl.title = data.title
  image.alt = data.title
  image.src = data.src
} else {
  image.hidden = true
  errorEl.hidden = false
}
