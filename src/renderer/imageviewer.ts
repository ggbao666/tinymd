/** 在独立的原生子窗口中查看图片。 */
export function openImageViewer(src: string, title: string): void {
  void window.api.openImageViewer(src, title)
}
