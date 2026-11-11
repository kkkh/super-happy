/* ==========================================================================
   分辨率与比例引擎 · 纯本地
   - GCD 化简比例；按目标宽度等比取整
   - 宽高必须 > 0；取整后为 0 视为极端比例，明确拒绝
   ========================================================================== */

export interface RatioParts {
  width: number
  height: number
  text: string
}

export interface ResolutionBase {
  width: number
  height: number
  ratio: RatioParts
  pixels: number
  megapixels: number
  isHD: boolean
}

export interface ResolutionPlan extends ResolutionBase {
  targetWidth: number | null
  targetHeight: number | null
  targetRatioText: string | null
}

export interface ResolutionInput {
  width: number
  height: number
  /** 按目标宽度等比缩放；与 ratio 二选一 */
  targetWidth?: number | null
  /** 目标比例；与 targetWidth 二选一 */
  ratio?: { width: number; height: number } | null
}

export const HD_MIN_WIDTH = 1280

function gcd(a: number, b: number): number {
  let left = Math.abs(a)
  let right = Math.abs(b)
  while (right > 0) {
    const next = left % right
    left = right
    right = next
  }
  return left
}

function round(value: number): number {
  return Math.round(value + Number.EPSILON)
}

function validSize(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

export function simplifyRatio(width: number, height: number): RatioParts | null {
  if (!validSize(width) || !validSize(height)) {
    return null
  }
  const w = round(width)
  const h = round(height)
  if (w <= 0 || h <= 0) {
    return null
  }
  const divisor = gcd(w, h)
  if (divisor <= 0) {
    return null
  }
  const ratioW = w / divisor
  const ratioH = h / divisor
  return { width: ratioW, height: ratioH, text: `${ratioW}:${ratioH}` }
}

export function analyzeResolution(width: number, height: number): ResolutionBase | null {
  if (!validSize(width) || !validSize(height)) {
    return null
  }
  const w = round(width)
  const h = round(height)
  if (w <= 0 || h <= 0) {
    return null
  }
  const ratio = simplifyRatio(w, h)
  if (!ratio) {
    return null
  }
  const pixels = w * h
  return {
    width: w,
    height: h,
    ratio,
    pixels,
    megapixels: Math.round((pixels / 1000000 + Number.EPSILON) * 100) / 100,
    isHD: w >= HD_MIN_WIDTH,
  }
}

/** 按目标宽度等比缩放；取整后高度为 0 时返回 null */
export function fitWidth(
  width: number,
  height: number,
  targetWidth: number,
): { width: number; height: number } | null {
  if (!validSize(width) || !validSize(height) || !validSize(targetWidth)) {
    return null
  }
  const targetH = round((targetWidth * height) / width)
  const targetW = round(targetWidth)
  if (targetW <= 0 || targetH <= 0) {
    return null
  }
  return { width: targetW, height: targetH }
}

export function planResolution(input: ResolutionInput): ResolutionPlan | null {
  const base = analyzeResolution(input.width, input.height)
  if (!base) {
    return null
  }

  let targetWidth: number | null = null
  let targetHeight: number | null = null
  let targetRatioText: string | null = null

  if (input.targetWidth !== undefined && input.targetWidth !== null) {
    const fitted = fitWidth(base.width, base.height, Number(input.targetWidth))
    if (!fitted) {
      return null
    }
    targetWidth = fitted.width
    targetHeight = fitted.height
    targetRatioText = base.ratio.text
  } else if (input.ratio) {
    const ratioW = Number(input.ratio.width)
    const ratioH = Number(input.ratio.height)
    if (!validSize(ratioW) || !validSize(ratioH)) {
      return null
    }
    const height = round((base.width * ratioH) / ratioW)
    if (height <= 0) {
      return null
    }
    targetWidth = base.width
    targetHeight = height
    const simplified = simplifyRatio(ratioW, ratioH)
    targetRatioText = simplified ? simplified.text : `${ratioW}:${ratioH}`
  }

  return {
    ...base,
    targetWidth,
    targetHeight,
    targetRatioText,
    isHD: (targetWidth ?? base.width) >= HD_MIN_WIDTH,
  }
}

export function resolutionSummary(plan: ResolutionPlan): string {
  const parts = [`原图 ${plan.width} × ${plan.height}`, `比例 ${plan.ratio.text}`]
  if (plan.targetWidth !== null && plan.targetHeight !== null) {
    parts.push(`目标 ${plan.targetWidth} × ${plan.targetHeight}`)
  }
  parts.push(`${plan.megapixels.toFixed(2)} MP`)
  parts.push(plan.isHD ? '高清' : '非高清')
  return parts.join('；')
}

/* ---- 纸张 / DPI / 打印像素 ---- */

export interface PaperPreset {
  key: string
  label: string
  widthMm: number
  heightMm: number
}

export const PAPER_PRESETS: PaperPreset[] = [
  { key: 'a4', label: 'A4', widthMm: 210, heightMm: 297 },
  { key: 'a3', label: 'A3', widthMm: 297, heightMm: 420 },
  { key: 'a5', label: 'A5', widthMm: 148, heightMm: 210 },
  { key: 'b5', label: 'B5', widthMm: 176, heightMm: 250 },
  { key: 'letter', label: 'Letter', widthMm: 215.9, heightMm: 279.4 },
  { key: '4r', label: '4R', widthMm: 102, heightMm: 152 },
]

export const DPI_OPTIONS = [72, 150, 300, 600] as const
export type PrintOrientation = 'portrait' | 'landscape'

export interface PrintSizeInput {
  paperKey: string
  dpi: number
  orientation: PrintOrientation
}

export interface PrintSizeResult {
  paper: PaperPreset
  orientation: PrintOrientation
  widthMm: number
  heightMm: number
  widthCm: number
  heightCm: number
  widthInch: number
  heightInch: number
  dpi: number
  pixelWidth: number
  pixelHeight: number
  pixels: number
  megapixels: number
}

/** 纸张 + DPI → 像素尺寸；横版交换宽高 */
export function printPixelSize(input: PrintSizeInput): PrintSizeResult | null {
  const paper = PAPER_PRESETS.find((item) => item.key === input.paperKey)
  const dpi = Number(input.dpi)
  if (!paper || !Number.isFinite(dpi) || dpi <= 0 || dpi > 2400) {
    return null
  }
  if (input.orientation !== 'portrait' && input.orientation !== 'landscape') {
    return null
  }
  const widthMm =
    input.orientation === 'landscape' ? paper.heightMm : paper.widthMm
  const heightMm =
    input.orientation === 'landscape' ? paper.widthMm : paper.heightMm
  const pixelWidth = Math.round((widthMm / 25.4) * dpi)
  const pixelHeight = Math.round((heightMm / 25.4) * dpi)
  if (pixelWidth <= 0 || pixelHeight <= 0) {
    return null
  }
  const pixels = pixelWidth * pixelHeight
  return {
    paper,
    orientation: input.orientation,
    widthMm,
    heightMm,
    widthCm: Math.round((widthMm / 10 + Number.EPSILON) * 100) / 100,
    heightCm: Math.round((heightMm / 10 + Number.EPSILON) * 100) / 100,
    widthInch: Math.round((widthMm / 25.4 + Number.EPSILON) * 100) / 100,
    heightInch: Math.round((heightMm / 25.4 + Number.EPSILON) * 100) / 100,
    dpi,
    pixelWidth,
    pixelHeight,
    pixels,
    megapixels: Math.round((pixels / 1000000 + Number.EPSILON) * 100) / 100,
  }
}

export function printSummaryText(result: PrintSizeResult): string {
  const orientation = result.orientation === 'landscape' ? '横版' : '竖版'
  return [
    `${result.paper.label} ${orientation}`,
    `${result.dpi} DPI`,
    `${result.pixelWidth} × ${result.pixelHeight} px`,
    `${result.megapixels.toFixed(2)} MP`,
    `纸张 ${result.widthCm.toFixed(2)} × ${result.heightCm.toFixed(2)} cm`,
  ].join('；')
}
