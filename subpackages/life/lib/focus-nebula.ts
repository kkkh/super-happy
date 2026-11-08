/* ==========================================================================
   focus-nebula · 确定性星云
   - mulberry32(seed) + 固定精度坐标，同 seed 跨版本可复现
   - 60 颗星以内；核心光晕 + 星点，一次性绘制，不做逐帧动画
   - tainted 枯萎：去光晕、danger 色、低透明度
   - confidence=low → 降饱和度 / 降透明度
   - 纯函数 + 最小 Canvas 接口；不调用 wx / DOM
   ========================================================================== */
import type { FocusConfidence } from './focus-types'

export const NEBULA_WIDTH = 750
export const NEBULA_HEIGHT = 1000
export const NEBULA_MAX_STARS = 60

export interface NebulaPalette {
  /** 核心光晕 */
  core: string
  /** 内圈星点 */
  inner: string
  /** 外圈星点 */
  outer: string
  /** 枯萎 / 故障 */
  danger: string
}

export const DEFAULT_NEBULA_PALETTE: NebulaPalette = {
  core: '#8f9bff',
  inner: '#6ee7c8',
  outer: '#ffcf8a',
  danger: '#ff7a63',
}

export interface NebulaPoint {
  /** 归一化坐标 0..1，保留 4 位小数 */
  x: number
  y: number
  r: number
  alpha: number
  colorIndex: 0 | 1 | 2
}

export interface NebulaCore {
  x: number
  y: number
  radius: number
  alpha: number
}

export interface NebulaScene {
  version: 1
  seed: number
  width: number
  height: number
  points: NebulaPoint[]
  core: NebulaCore
  palette: NebulaPalette
  tainted: boolean
  confidence: FocusConfidence
}

export interface CreateNebulaOptions {
  width?: number
  height?: number
  tainted?: boolean
  confidence?: FocusConfidence
  palette?: Partial<NebulaPalette>
  starCount?: number
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function round4(value: number): number {
  return Number(clamp01(value).toFixed(4))
}

/** 固定算法 PRNG：星云 / 测试共用，禁止依赖 Math.random */
export function mulberry32(seed: number): () => number {
  let state = Number.isFinite(seed) ? (seed >>> 0) : 0
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export function createNebulaScene(seed: number, options: CreateNebulaOptions = {}): NebulaScene {
  const width = options.width && options.width > 0 ? Math.floor(options.width) : NEBULA_WIDTH
  const height =
    options.height && options.height > 0 ? Math.floor(options.height) : NEBULA_HEIGHT
  const tainted = options.tainted === true
  const confidence: FocusConfidence = options.confidence === 'low' ? 'low' : 'high'
  const palette: NebulaPalette = {
    ...DEFAULT_NEBULA_PALETTE,
    ...(options.palette || {}),
  }
  const random = mulberry32(seed)
  const count = Math.min(
    NEBULA_MAX_STARS,
    Math.max(0, Math.floor(options.starCount ?? NEBULA_MAX_STARS)),
  )

  const points: NebulaPoint[] = []
  const arms = 3
  const cy = 0.42
  for (let index = 0; index < count; index += 1) {
    const arm = index % arms
    const angle =
      (arm * Math.PI * 2) / arms + (random() - 0.5) * 0.95
    const distance = Math.pow(random(), 0.66) * 0.42
    const spiral = angle + distance * 1.9
    const x = 0.5 + Math.cos(spiral) * distance
    const y = cy + Math.sin(spiral) * distance * 0.78
    const radius = 0.9 + random() * 2.4
    const baseAlpha = 0.32 + random() * 0.68
    const confidenceAlpha = confidence === 'low' ? 0.55 : 1
    const taintAlpha = tainted ? 0.4 : 1
    points.push({
      x: round4(x),
      y: round4(y),
      r: Number(radius.toFixed(2)),
      alpha: Number((baseAlpha * confidenceAlpha * taintAlpha).toFixed(3)),
      colorIndex: (index % 3) as 0 | 1 | 2,
    })
  }

  return {
    version: 1,
    seed: Number.isFinite(seed) ? seed >>> 0 : 0,
    width,
    height,
    points,
    core: {
      x: 0.5,
      y: cy,
      radius: tainted ? 0.2 : 0.34,
      alpha: tainted ? 0.18 : confidence === 'low' ? 0.8 : 1,
    },
    palette,
    tainted,
    confidence,
  }
}

export interface NebulaGradientLike {
  addColorStop(offset: number, color: string): void
}

export interface NebulaContextLike {
  globalAlpha: number
  fillStyle: unknown
  clearRect(x: number, y: number, width: number, height: number): void
  beginPath(): void
  arc(x: number, y: number, radius: number, start: number, end: number): void
  fill(): void
  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ): NebulaGradientLike
}

/** #rrggbb → rgba(r,g,b,a)；非法 hex 回退 iris 色 */
export function hexToRgba(hex: string, alpha: number): string {
  const value = typeof hex === 'string' ? hex.trim() : ''
  const match = /^#([0-9a-f]{6})$/i.exec(value)
  const a = Math.min(1, Math.max(0, Number.isFinite(alpha) ? alpha : 0))
  if (!match) {
    return `rgba(143,155,255,${a})`
  }
  const raw = match[1]
  const red = parseInt(raw.slice(0, 2), 16)
  const green = parseInt(raw.slice(2, 4), 16)
  const blue = parseInt(raw.slice(4, 6), 16)
  return `rgba(${red},${green},${blue},${a})`
}

function pointColor(scene: NebulaScene, index: 0 | 1 | 2): string {
  if (scene.tainted) {
    return scene.palette.danger
  }
  if (index === 1) {
    return scene.palette.inner
  }
  if (index === 2) {
    return scene.palette.outer
  }
  return scene.palette.core
}

/** 一次性绘制；调用方负责 canvas 尺寸与导出 */
export function renderNebulaScene(
  ctx: NebulaContextLike,
  scene: NebulaScene,
): void {
  const width = scene.width
  const height = scene.height
  const cx = scene.core.x * width
  const cy = scene.core.y * height
  const coreRadius = scene.core.radius * Math.min(width, height)

  ctx.clearRect(0, 0, width, height)

  if (!scene.tainted && coreRadius > 0) {
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreRadius)
    gradient.addColorStop(0, hexToRgba(scene.palette.core, 0.46 * scene.core.alpha))
    gradient.addColorStop(0.45, hexToRgba(scene.palette.inner, 0.16 * scene.core.alpha))
    gradient.addColorStop(1, hexToRgba(scene.palette.outer, 0))
    ctx.globalAlpha = 1
    ctx.fillStyle = gradient
    ctx.beginPath()
    /* 用一个覆盖核心的圆弧裁剪填充；Canvas 2D 支持直接 arc + fill 渐变 */
    ctx.arc(cx, cy, coreRadius, 0, Math.PI * 2)
    ctx.fill()
  }

  for (const point of scene.points) {
    ctx.globalAlpha = point.alpha
    ctx.fillStyle = hexToRgba(pointColor(scene, point.colorIndex), 1)
    ctx.beginPath()
    ctx.arc(point.x * width, point.y * height, point.r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

/** 生成星云场景的轻量摘要，供战报 / 无障碍文本使用 */
export function nebulaSummary(scene: NebulaScene): string {
  if (scene.tainted) {
    return '本机记录校验失败，本次星云已枯萎'
  }
  return scene.confidence === 'low' ? '星云已生成 · 记录置信度较低' : '星云已生成'
}
