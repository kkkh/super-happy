/* ==========================================================================
   图片编辑几何引擎 · 纯函数
   - 裁剪比例 / 源图钳制 / 旋转尺寸 / 点位映射 / 透明补白
   - 不依赖 wx / Canvas，页面按返回值驱动真实像素重绘
   ========================================================================== */

export const MAX_SOURCE_PIXELS = 12000000
export const MAX_EDGE = 4096
export const MIN_CROP = 32

export type CropRatio = '1:1' | '4:3' | '16:9' | 'free'

export interface Size {
  width: number
  height: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type ClampResult =
  | {
      ok: true
      width: number
      height: number
      /** 钳制后 / 原图，1 表示未缩放 */
      scale: number
      pixels: number
      scaled: boolean
    }
  | { ok: false; code: 'invalid' | 'too-large' | 'too-small'; pixels: number }

/** 源图钳制：>12MP 拒绝；长边 >4096 等比缩；任一边 <32 拒绝 */
export function clampSourceSize(width: number, height: number): ClampResult {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return { ok: false, code: 'invalid', pixels: 0 }
  }
  const sourceWidth = Math.floor(width)
  const sourceHeight = Math.floor(height)
  const pixels = sourceWidth * sourceHeight
  if (sourceWidth < MIN_CROP || sourceHeight < MIN_CROP) {
    return { ok: false, code: 'too-small', pixels }
  }
  if (pixels > MAX_SOURCE_PIXELS) {
    return { ok: false, code: 'too-large', pixels }
  }
  const edge = Math.max(sourceWidth, sourceHeight)
  const scale = edge > MAX_EDGE ? MAX_EDGE / edge : 1
  return {
    ok: true,
    width: Math.max(MIN_CROP, Math.round(sourceWidth * scale)),
    height: Math.max(MIN_CROP, Math.round(sourceHeight * scale)),
    scale,
    pixels,
    scaled: scale < 1,
  }
}

/** 居中裁剪：自由比例保留原图；结果小于 32×32 返回 null */
export function cropRect(source: Size, ratio: CropRatio): Rect | null {
  if (
    !Number.isFinite(source.width) ||
    !Number.isFinite(source.height) ||
    source.width < MIN_CROP ||
    source.height < MIN_CROP
  ) {
    return null
  }
  let target = source.width / source.height
  if (ratio === '1:1') {
    target = 1
  } else if (ratio === '4:3') {
    target = 4 / 3
  } else if (ratio === '16:9') {
    target = 16 / 9
  }
  let width = source.width
  let height = source.height
  if (source.width / source.height > target) {
    width = Math.round(source.height * target)
  } else {
    height = Math.round(source.width / target)
  }
  if (width < MIN_CROP || height < MIN_CROP) {
    return null
  }
  return {
    x: Math.floor((source.width - width) / 2),
    y: Math.floor((source.height - height) / 2),
    width,
    height,
  }
}

/** 旋转角归一到 0 / 90 / 180 / 270 */
export function normalizeRotation(rotation: number): 0 | 90 | 180 | 270 {
  if (!Number.isFinite(rotation)) {
    return 0
  }
  const steps = Math.round(rotation / 90) % 4
  return ((steps + 4) % 4 * 90) as 0 | 90 | 180 | 270
}

/** 旋转后输出尺寸：90 / 270 宽高互换 */
export function rotatedSize(size: Size, rotation: number): Size {
  const angle = normalizeRotation(rotation)
  if (angle === 90 || angle === 270) {
    return { width: size.height, height: size.width }
  }
  return { width: size.width, height: size.height }
}

/**
 * 裁剪图内坐标 → 输出坐标
 * 顺序与 Canvas 一致：先按中心翻转，再顺时针旋转，最后平移到输出中心
 */
export function mapPoint(
  point: { x: number; y: number },
  size: Size,
  rotation: number,
  flipH = false,
  flipV = false,
): { x: number; y: number } {
  const angle = (normalizeRotation(rotation) * Math.PI) / 180
  const out = rotatedSize(size, rotation)
  const centerX = point.x - size.width / 2
  const centerY = point.y - size.height / 2
  const flippedX = flipH ? -centerX : centerX
  const flippedY = flipV ? -centerY : centerY
  const cos = Math.round(Math.cos(angle))
  const sin = Math.round(Math.sin(angle))
  return {
    x: out.width / 2 + flippedX * cos - flippedY * sin,
    y: out.height / 2 + flippedX * sin + flippedY * cos,
  }
}

/** 透明像素按 alpha 合成到白底；用于 JPEG 导出前的补白口径 */
export function flattenToWhite(
  red: number,
  green: number,
  blue: number,
  alpha: number,
): { r: number; g: number; b: number; a: number } {
  const ratio = Math.min(255, Math.max(0, alpha)) / 255
  const mix = (value: number): number =>
    Math.round(Math.min(255, Math.max(0, value)) * ratio + 255 * (1 - ratio))
  return { r: mix(red), g: mix(green), b: mix(blue), a: 255 }
}
