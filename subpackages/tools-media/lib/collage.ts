/* ==========================================================================
   拼图与长图引擎 · 纯函数
   - 2×2 / 3×3 / 竖排长图；间距 0 / 8 / 16px
   - 统一单元尺寸，输出长边 ≤4096；不足位置用背景色补齐
   - 只算布局，不依赖 wx / Canvas
   ========================================================================== */

export type CollageTemplate = 'grid2' | 'grid3' | 'vertical'

export type CollageGap = 0 | 8 | 16

export const COLLAGE_GAPS: CollageGap[] = [0, 8, 16]

/** 单图单元基准尺寸：3×3 时 3072 + 间距仍低于 4096 */
export const COLLAGE_UNIT = 1024

export const COLLAGE_MAX_EDGE = 4096

export const COLLAGE_MIN_IMAGES = 2

export const COLLAGE_MAX_IMAGES = 9

export interface CollageCell {
  x: number
  y: number
  width: number
  height: number
}

export interface CollageLayout {
  width: number
  height: number
  unit: number
  columns: number
  rows: number
  cells: CollageCell[]
}

export function collageCapacity(template: CollageTemplate): number {
  return template === 'grid2' ? 4 : 9
}

/** 超出模板容量时截断；返回实际参与绘制的张数 */
export function collageDrawCount(template: CollageTemplate, count: number): number {
  if (!Number.isFinite(count) || count < COLLAGE_MIN_IMAGES) {
    return 0
  }
  return Math.min(collageCapacity(template), Math.floor(count))
}

/**
 * 生成布局；图片数量不足 2 或模板非法返回 null。
 * grid2 / grid3 固定行列，未填满的格子保留背景色；vertical 按实际张数顺排。
 */
export function collageLayout(
  template: CollageTemplate,
  count: number,
  gap: CollageGap,
): CollageLayout | null {
  const drawCount = collageDrawCount(template, count)
  if (drawCount < COLLAGE_MIN_IMAGES) {
    return null
  }
  const safeGap = COLLAGE_GAPS.includes(gap) ? gap : 8
  if (template === 'vertical') {
    const unit = Math.min(
      COLLAGE_UNIT,
      Math.floor((COLLAGE_MAX_EDGE - safeGap * (drawCount - 1)) / drawCount),
    )
    if (unit < 128) {
      return null
    }
    const cells: CollageCell[] = []
    for (let index = 0; index < drawCount; index += 1) {
      cells.push({
        x: 0,
        y: index * (unit + safeGap),
        width: unit,
        height: unit,
      })
    }
    return {
      width: unit,
      height: drawCount * unit + safeGap * (drawCount - 1),
      unit,
      columns: 1,
      rows: drawCount,
      cells,
    }
  }

  const side = template === 'grid2' ? 2 : 3
  const unit = COLLAGE_UNIT
  const width = side * unit + safeGap * (side - 1)
  if (width > COLLAGE_MAX_EDGE) {
    return null
  }
  const cells: CollageCell[] = []
  for (let row = 0; row < side; row += 1) {
    for (let column = 0; column < side; column += 1) {
      cells.push({
        x: column * (unit + safeGap),
        y: row * (unit + safeGap),
        width: unit,
        height: unit,
      })
    }
  }
  return {
    width,
    height: width,
    unit,
    columns: side,
    rows: side,
    cells,
  }
}

/** 解码失败摘要：全部失败返回空字符串，由页面单独中止 */
export function collageSkipNotice(total: number, skipped: number): string {
  if (!Number.isFinite(total) || !Number.isFinite(skipped) || skipped <= 0) {
    return ''
  }
  return `已跳过 ${skipped} / ${total} 张无法解码的图片`
}
