/* ==========================================================================
   Canvas 管线 · 图片重绘 / 导出 / 临时文件清理
   - 供 photo-edit / avatar / collage / id-photo 等图片卡复用
   - 只做离屏绘制，不读取相册、不上传
   ========================================================================== */

export interface CanvasCrop {
  x: number
  y: number
  width: number
  height: number
}

export interface CanvasOutput {
  width: number
  height: number
}

export interface DrawOptions {
  rotation: number
  flipH: boolean
  flipV: boolean
  /** JPEG 导出前补白底，PNG 保留透明 */
  whiteBackground: boolean
  /** 钳制后 / 原图；绘制时把裁剪坐标换算回原图像素 */
  scale: number
}

interface DrawContext {
  fillStyle: string
  save(): void
  restore(): void
  clearRect(x: number, y: number, width: number, height: number): void
  fillRect(x: number, y: number, width: number, height: number): void
  translate(x: number, y: number): void
  rotate(angle: number): void
  scale(x: number, y: number): void
  drawImage(
    image: unknown,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void
}

export type ExportFormat = 'jpeg' | 'png'

export function unlinkQuietly(filePath: string): void {
  if (!filePath) {
    return
  }
  try {
    wx.getFileSystemManager().unlink({ filePath, fail: () => undefined })
  } catch {
    // 文件系统不可用时忽略清理
  }
}

/** 取页面内隐藏 Canvas 节点；调用方负责在 onUnload 释放引用 */
export function selectCanvasNode(
  page: { createSelectorQuery(): WechatMiniprogram.SelectorQuery },
  selector: string,
): Promise<WechatMiniprogram.Canvas> {
  return new Promise((resolve, reject) => {
    page
      .createSelectorQuery()
      .select(selector)
      .fields({ node: true, size: true })
      .exec((result) => {
        const first = result[0] as { node?: WechatMiniprogram.Canvas } | null
        if (!first || !first.node) {
          reject(new Error('画布不可用，请在真机预览'))
          return
        }
        resolve(first.node)
      })
  })
}

/** 按裁剪区域与旋转 / 翻转重绘到真实像素 Canvas */
export async function drawEditedImage(
  canvas: WechatMiniprogram.Canvas,
  src: string,
  crop: CanvasCrop,
  output: CanvasOutput,
  options: DrawOptions,
): Promise<void> {
  canvas.width = output.width
  canvas.height = output.height
  const ctx = canvas.getContext('2d') as unknown as DrawContext | null
  if (!ctx) {
    throw new Error('画布上下文不可用')
  }
  const image = canvas.createImage()
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('图片解码失败，请换一张 JPG/PNG'))
    image.src = src
  })

  ctx.clearRect(0, 0, output.width, output.height)
  if (options.whiteBackground) {
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, output.width, output.height)
  }
  ctx.save()
  ctx.translate(output.width / 2, output.height / 2)
  ctx.rotate((options.rotation * Math.PI) / 180)
  ctx.scale(options.flipH ? -1 : 1, options.flipV ? -1 : 1)
  const scale = options.scale > 0 ? options.scale : 1
  ctx.drawImage(
    image,
    crop.x / scale,
    crop.y / scale,
    crop.width / scale,
    crop.height / scale,
    -crop.width / 2,
    -crop.height / 2,
    crop.width,
    crop.height,
  )
  ctx.restore()
}

export function exportCanvas(
  canvas: WechatMiniprogram.Canvas,
  width: number,
  height: number,
  format: ExportFormat,
  quality: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas,
      fileType: format === 'png' ? 'png' : 'jpg',
      quality: format === 'png' ? 1 : quality / 100,
      destWidth: width,
      destHeight: height,
      success: (result) => resolve(result.tempFilePath),
      fail: (error) => reject(new Error(error.errMsg || '导出图片失败')),
    })
  })
}
