/**
 * 图片查看器：全屏遮罩 + 可缩放/平移的大图预览。
 * 滚轮缩放(以鼠标为中心)、按住拖动平移、双击在适应窗口与 100% 间切换。
 */
export function openImageViewer(src: string, title: string): void {
  if (document.querySelector('.imgview-backdrop')) return

  const backdrop = document.createElement('div')
  backdrop.className = 'imgview-backdrop'

  const bar = document.createElement('div')
  bar.className = 'imgview-bar'

  const name = document.createElement('span')
  name.className = 'imgview-name'
  name.textContent = title
  name.title = title

  const zoomLabel = document.createElement('span')
  zoomLabel.className = 'imgview-zoom'

  const mkBtn = (text: string, titleText: string, onClick: () => void) => {
    const b = document.createElement('button')
    b.className = 'imgview-btn'
    b.textContent = text
    b.title = titleText
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick() })
    return b
  }

  const img = document.createElement('img')
  img.className = 'imgview-img'
  img.src = src
  img.draggable = false

  let scale = 1
  let tx = 0
  let ty = 0
  let fitMode = true

  const apply = () => {
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`
    zoomLabel.textContent = `${Math.round(scale * 100)}%`
  }

  const fit = () => {
    // 重置为适应窗口
    scale = 1
    tx = 0
    ty = 0
    img.style.width = ''
    img.style.maxWidth = '88vw'
    img.style.maxHeight = '80vh'
    fitMode = true
    apply()
  }

  const full = () => {
    // 原始尺寸 100%
    img.style.maxWidth = 'none'
    img.style.maxHeight = 'none'
    img.style.width = 'auto'
    scale = 1
    tx = 0
    ty = 0
    fitMode = false
    apply()
  }

  const zoomTo = (next: number, cx = window.innerWidth / 2, cy = window.innerHeight / 2) => {
    const clamped = Math.min(12, Math.max(0.05, next))
    if (fitMode) {
      // 从适应模式切到自由缩放：先把 maxWidth/maxHeight 约束去掉，按当前显示尺寸换算
      const rect = img.getBoundingClientRect()
      img.style.maxWidth = 'none'
      img.style.maxHeight = 'none'
      img.style.width = 'auto'
      scale = rect.width / img.naturalWidth || 1
      fitMode = false
    }
    const factor = clamped / scale
    tx = cx - window.innerWidth / 2 - (window.innerWidth / 2 - cx - tx) * (factor - 1)
    ty = cy - window.innerHeight / 2 - (window.innerHeight / 2 - cy - ty) * (factor - 1)
    scale = clamped
    apply()
  }

  bar.append(
    name,
    zoomLabel,
    mkBtn('−', '缩小', () => zoomTo(scale / 1.25)),
    mkBtn('+', '放大', () => zoomTo(scale * 1.25)),
    mkBtn('1:1', '原始尺寸', full),
    mkBtn('⤢', '适应窗口', fit),
  )
  const closeBtn = mkBtn('✕', '关闭 (Esc)', () => cleanup())
  closeBtn.className = 'imgview-btn imgview-close'
  bar.append(closeBtn)

  backdrop.append(bar, img)
  document.body.append(backdrop)

  // 滚轮缩放（以鼠标位置为中心）
  backdrop.addEventListener('wheel', (e) => {
    e.preventDefault()
    zoomTo(scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY)
  }, { passive: false })

  // 拖动平移
  let dragging = false
  let sx = 0
  let sy = 0
  let bx = 0
  let by = 0
  backdrop.addEventListener('mousedown', (e) => {
    if ((e.target as HTMLElement).closest('.imgview-bar')) return
    dragging = true
    sx = e.clientX
    sy = e.clientY
    bx = tx
    by = ty
    backdrop.classList.add('dragging')
  })
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)

  function onMove(e: MouseEvent) {
    if (!dragging) return
    tx = bx + e.clientX - sx
    ty = by + e.clientY - sy
    apply()
  }
  function onUp() {
    dragging = false
    backdrop.classList.remove('dragging')
  }

  // 双击：适应 ↔ 100%
  backdrop.addEventListener('dblclick', (e) => {
    if ((e.target as HTMLElement).closest('.imgview-bar')) return
    if (fitMode) full()
    else fit()
  })

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') cleanup()
  }
  document.addEventListener('keydown', onKey, true)
  window.addEventListener('blur', cleanup)

  let done = false
  function cleanup() {
    if (done) return
    done = true
    backdrop.remove()
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    document.removeEventListener('keydown', onKey, true)
    window.removeEventListener('blur', cleanup)
  }

  img.addEventListener('load', fit)
  if (img.complete) fit()
}
