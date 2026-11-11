/* ==========================================================================
   颜色引擎 · HEX / RGB / HSL 互转、WCAG 对比度、色觉模拟
   - 纯函数、无 DOM / 无 wx；页面与 silent 执行器共用同一实现
   - 透明度统一忽略：4 / 8 位 HEX 与 rgba 只取 RGB
   - 对比度按 WCAG 2.x 相对亮度公式；色觉模拟使用 Machado 2009 公开矩阵
   ========================================================================== */

export interface RgbColor {
  r: number
  g: number
  b: number
}

export interface HslColor {
  h: number
  s: number
  l: number
}

export interface ColorFormats {
  hex: string
  rgbText: string
  hslText: string
  hsl: HslColor
}

export interface ContrastReport {
  ratio: number
  ratioText: string
  aaNormal: boolean
  aaLarge: boolean
  aaaNormal: boolean
  aaaLarge: boolean
}

export type CvdType = 'protanopia' | 'deuteranopia' | 'tritanopia'

export interface CvdResult {
  type: CvdType
  label: string
  hex: string
  rgb: RgbColor
  contrast: ContrastReport
}

export const DEFAULT_BACKGROUND: RgbColor = { r: 255, g: 255, b: 255 }

export const CVD_TYPES: CvdType[] = ['protanopia', 'deuteranopia', 'tritanopia']

export const CVD_LABELS: Record<CvdType, string> = {
  protanopia: '红色盲',
  deuteranopia: '绿色盲',
  tritanopia: '蓝色盲',
}

/** Machado 2009 色觉缺陷模拟矩阵（severity 1.0，线性 RGB 空间） */
const CVD_MATRICES: Record<CvdType, readonly number[][]> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
}

function clampByte(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.min(255, Math.max(0, Math.round(value)))
}

function normalizeRgb(rgb: RgbColor): RgbColor {
  return { r: clampByte(rgb.r), g: clampByte(rgb.g), b: clampByte(rgb.b) }
}

function parseHexColor(raw: string): RgbColor | null {
  const value = raw.trim()
  if (!/^#?[0-9a-fA-F]+$/.test(value)) {
    return null
  }
  const hex = value.startsWith('#') ? value.slice(1) : value
  if (hex.length === 3 || hex.length === 4) {
    return {
      r: parseInt(`${hex[0]}${hex[0]}`, 16),
      g: parseInt(`${hex[1]}${hex[1]}`, 16),
      b: parseInt(`${hex[2]}${hex[2]}`, 16),
    }
  }
  if (hex.length === 6 || hex.length === 8) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    }
  }
  return null
}

const RGB_PATTERN =
  /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*[\d.]+%?)?\s*\)$/i

function parseRgbColor(raw: string): RgbColor | null {
  const match = raw.trim().match(RGB_PATTERN)
  if (!match) {
    return null
  }
  const values = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (values.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return null
  }
  return { r: values[0], g: values[1], b: values[2] }
}

const HSL_PATTERN =
  /^hsla?\(\s*(-?\d{1,3}(?:\.\d+)?)(?:deg)?\s*[, ]\s*(\d{1,3}(?:\.\d+)?)%\s*[, ]\s*(\d{1,3}(?:\.\d+)?)%\s*(?:[,/]\s*[\d.]+%?)?\s*\)$/i

function parseHslColor(raw: string): RgbColor | null {
  const match = raw.trim().match(HSL_PATTERN)
  if (!match) {
    return null
  }
  const h = Number(match[1])
  const s = Number(match[2])
  const l = Number(match[3])
  if (!Number.isFinite(h) || h < -360 || h > 360 || s < 0 || s > 100 || l < 0 || l > 100) {
    return null
  }
  return hslToRgb({ h, s, l })
}

/** 解析 HEX（3 / 4 / 6 / 8 位）、rgb / rgba、hsl / hsla；alpha 忽略 */
export function parseColor(input: string): RgbColor | null {
  if (typeof input !== 'string') {
    return null
  }
  const text = input.trim()
  if (!text) {
    return null
  }
  if (/^rgba?\(/i.test(text)) {
    return parseRgbColor(text)
  }
  if (/^hsla?\(/i.test(text)) {
    return parseHslColor(text)
  }
  return parseHexColor(text)
}

export function rgbToHsl(rgb: RgbColor): HslColor {
  const color = normalizeRgb(rgb)
  const r = color.r / 255
  const g = color.g / 255
  const b = color.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) {
    return { h: 0, s: 0, l: l * 100 }
  }
  const delta = max - min
  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min)
  let h: number
  if (max === r) {
    h = (g - b) / delta + (g < b ? 6 : 0)
  } else if (max === g) {
    h = (b - r) / delta + 2
  } else {
    h = (r - g) / delta + 4
  }
  return { h: h * 60, s: s * 100, l: l * 100 }
}

export function hslToRgb(hsl: HslColor): RgbColor {
  const h = (((hsl.h % 360) + 360) % 360) / 360
  const s = Math.min(100, Math.max(0, hsl.s)) / 100
  const l = Math.min(100, Math.max(0, hsl.l)) / 100
  if (s === 0) {
    const value = Math.round(l * 255)
    return { r: value, g: value, b: value }
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (input: number): number => {
    let t = input
    if (t < 0) {
      t += 1
    }
    if (t > 1) {
      t -= 1
    }
    if (t < 1 / 6) {
      return p + (q - p) * 6 * t
    }
    if (t < 1 / 2) {
      return q
    }
    if (t < 2 / 3) {
      return p + (q - p) * (2 / 3 - t) * 6
    }
    return p
  }
  return {
    r: Math.round(channel(h + 1 / 3) * 255),
    g: Math.round(channel(h) * 255),
    b: Math.round(channel(h - 1 / 3) * 255),
  }
}

export function toHex(rgb: RgbColor): string {
  const color = normalizeRgb(rgb)
  const pair = (value: number): string => value.toString(16).padStart(2, '0')
  return `#${pair(color.r)}${pair(color.g)}${pair(color.b)}`.toUpperCase()
}

export function formatColor(rgb: RgbColor): ColorFormats {
  const color = normalizeRgb(rgb)
  const hsl = rgbToHsl(color)
  return {
    hex: toHex(color),
    rgbText: `rgb(${color.r}, ${color.g}, ${color.b})`,
    hslText: `hsl(${Math.round(hsl.h) % 360}, ${Math.round(hsl.s)}%, ${Math.round(hsl.l)}%)`,
    hsl,
  }
}

function linearize(value: number): number {
  const channel = clampByte(value) / 255
  return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4)
}

function delinearize(value: number): number {
  const channel = value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055
  return channel * 255
}

/** WCAG 2.x 相对亮度 */
export function relativeLuminance(rgb: RgbColor): number {
  const color = normalizeRgb(rgb)
  return 0.2126 * linearize(color.r) + 0.7152 * linearize(color.g) + 0.0722 * linearize(color.b)
}

export function formatRatio(ratio: number): string {
  const safe = Number.isFinite(ratio) && ratio > 0 ? ratio : 1
  const text = (Math.round(safe * 100) / 100).toFixed(2)
  return `${text.endsWith('0') ? text.slice(0, -1) : text}:1`
}

/** 对比度返回值不做四舍五入，阈值判断必须用原始值 */
export function contrastRatio(foreground: RgbColor, background: RgbColor): number {
  const a = relativeLuminance(foreground)
  const b = relativeLuminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

export function contrastReport(ratio: number): ContrastReport {
  const safe = Number.isFinite(ratio) && ratio > 0 ? ratio : 1
  return {
    ratio: safe,
    ratioText: formatRatio(safe),
    aaNormal: safe >= 4.5,
    aaLarge: safe >= 3,
    aaaNormal: safe >= 7,
    aaaLarge: safe >= 4.5,
  }
}

/** 色觉模拟：线性 RGB 乘 Machado 矩阵，再回 sRGB 并夹取到 0–255 */
export function simulateCvd(rgb: RgbColor, type: CvdType): RgbColor {
  const matrix = CVD_MATRICES[type]
  if (!matrix) {
    return normalizeRgb(rgb)
  }
  const color = normalizeRgb(rgb)
  const r = linearize(color.r)
  const g = linearize(color.g)
  const b = linearize(color.b)
  const mix = (row: readonly number[]): number => row[0] * r + row[1] * g + row[2] * b
  return normalizeRgb({
    r: delinearize(mix(matrix[0])),
    g: delinearize(mix(matrix[1])),
    b: delinearize(mix(matrix[2])),
  })
}

export function cvdResults(
  foreground: RgbColor,
  background: RgbColor = DEFAULT_BACKGROUND,
): CvdResult[] {
  return CVD_TYPES.map((type) => {
    const rgb = simulateCvd(foreground, type)
    return {
      type,
      label: CVD_LABELS[type],
      hex: toHex(rgb),
      rgb,
      contrast: contrastReport(contrastRatio(rgb, background)),
    }
  })
}

function backgroundLabel(background: RgbColor): string {
  const color = normalizeRgb(background)
  if (color.r === 255 && color.g === 255 && color.b === 255) {
    return '白'
  }
  if (color.r === 0 && color.g === 0 && color.b === 0) {
    return '黑'
  }
  return `背景 ${toHex(color)}`
}

/** 摘要与 silent 执行器同源，禁止页面另拼一份 */
export function colorSummary(
  foreground: RgbColor,
  background: RgbColor = DEFAULT_BACKGROUND,
): string {
  const formats = formatColor(foreground)
  const report = contrastReport(contrastRatio(foreground, background))
  return `${formats.hex} · ${formats.rgbText} · ${formats.hslText} · 对${backgroundLabel(
    background,
  )} ${report.ratioText}（${
    report.aaNormal ? 'AA 正文通过' : report.aaLarge ? '仅大字 AA 通过' : '对比度不足'
  }）`
}
