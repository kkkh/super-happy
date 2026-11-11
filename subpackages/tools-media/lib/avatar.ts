/* ==========================================================================
   圆角头像引擎 · 纯函数
   - 中心裁正方形；形状按短边百分比换算圆角
   - 输出固定 256 / 512 / 1024；源图长边超过 2048 先缩
   - 只做几何与 alpha 判定，不依赖 wx / Canvas
   ========================================================================== */

export type AvatarShape = 'circle' | 'round12' | 'round25'

export type AvatarSize = 256 | 512 | 1024

export const AVATAR_SIZES: AvatarSize[] = [256, 512, 1024]

export const AVATAR_MAX_SOURCE_EDGE = 2048

/** 裁剪区域过小直接拒绝，与图片编辑的 32px 下限一致 */
export const AVATAR_MIN_EDGE = 32

export interface AvatarCrop {
  x: number
  y: number
  /** 正方形边长 */
  size: number
}

/** 输出尺寸只接受 256 / 512 / 1024 */
export function avatarOutputSize(value: number): AvatarSize | null {
  return AVATAR_SIZES.includes(value as AvatarSize) ? (value as AvatarSize) : null
}

/** 中心裁正方形；宽高非法或短边 <32 返回 null */
export function avatarCropRect(width: number, height: number): AvatarCrop | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }
  const edge = Math.floor(Math.min(width, height))
  if (edge < AVATAR_MIN_EDGE) {
    return null
  }
  return {
    x: Math.floor((width - edge) / 2),
    y: Math.floor((height - edge) / 2),
    size: edge,
  }
}

/** 源图缩放比：长边 >2048 时等比缩小，否则 1 */
export function avatarSourceScale(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 1
  }
  const edge = Math.max(width, height)
  return edge > AVATAR_MAX_SOURCE_EDGE ? AVATAR_MAX_SOURCE_EDGE / edge : 1
}

/** 圆角半径：圆形取一半；圆角 12% / 25% 相对输出短边 */
export function avatarRadius(shape: AvatarShape, size: number): number {
  if (!Number.isFinite(size) || size <= 0) {
    return 0
  }
  if (shape === 'circle') {
    return Math.floor(size / 2)
  }
  const ratio = shape === 'round12' ? 0.12 : shape === 'round25' ? 0.25 : 0
  return Math.round(size * ratio)
}

/**
 * 某个像素是否落在形状内：255 保留，0 透明。
 * 用于验证输出 PNG 四角透明；Canvas 实际绘制由 clip 路径完成。
 */
export function avatarAlphaAt(
  shape: AvatarShape,
  size: number,
  x: number,
  y: number,
): number {
  if (
    !Number.isFinite(size) ||
    size <= 0 ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 0 ||
    y < 0 ||
    x > size ||
    y > size
  ) {
    return 0
  }
  if (shape === 'circle') {
    const radius = size / 2
    const dx = x - radius
    const dy = y - radius
    return Math.hypot(dx, dy) <= radius ? 255 : 0
  }
  const radius = avatarRadius(shape, size)
  const innerMin = radius
  const innerMax = size - radius
  const nearestX = Math.min(innerMax, Math.max(innerMin, x))
  const nearestY = Math.min(innerMax, Math.max(innerMin, y))
  return Math.hypot(x - nearestX, y - nearestY) <= radius ? 255 : 0
}
