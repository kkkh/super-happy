/* ==========================================================================
   contrast-guardian · 毛玻璃对比度守护
   - WCAG 2.1 AA：普通文本 4.5:1，大字号 3:1
   - 输入前景 / 背景 / 字号，输出可直接绑定的 class + style
   - 优先保留原文字色；不达标时自动反色；仍不达标时启用高不透明度背板
   - 提供 difference / smart text-shadow 两种毛玻璃策略
   - 纯函数 + 单例，可单元测试；无 wx 依赖
   ========================================================================== */
export interface RgbaColor {
  r: number
  g: number
  b: number
  a: number
}

export interface ContrastPair {
  label: string
  textColor: string
  backgroundColor: string
  fontSizePx: number
  bold?: boolean
}

export interface ContrastGuardOptions {
  textColor: string
  backgroundColor: string
  fontSizePx: number
  bold?: boolean
  /** 背景透明时的兜底画布色，默认浅色纸面 */
  canvasColor?: string
  /** 是否优先使用 mix-blend-mode: difference */
  preferDifference?: boolean
}

export type ContrastTone = 'glass' | 'inverted' | 'backplate' | 'difference'

export interface ContrastGuardResult {
  tone: ContrastTone
  passes: boolean
  ratio: number
  requiredRatio: number
  foreground: string
  background: string
  className: string
  style: string
}

export interface ContrastAuditEntry extends ContrastGuardResult {
  label: string
}

const LIGHT_CANVAS = '#f4f5f1'
const LIGHT_BACKPLATE = 'rgba(250, 251, 247, 0.94)'
const DARK_BACKPLATE = 'rgba(12, 15, 22, 0.94)'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function parseHex(input: string): RgbaColor | null {
  const normalized = input.trim()
  if (!normalized.startsWith('#')) {
    return null
  }
  const hex = normalized.slice(1)
  if (hex.length === 3 || hex.length === 4) {
    const r = parseInt(hex[0] + hex[0], 16)
    const g = parseInt(hex[1] + hex[1], 16)
    const b = parseInt(hex[2] + hex[2], 16)
    const a = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) / 255 : 1
    if ([r, g, b].some((value) => Number.isNaN(value))) {
      return null
    }
    return { r, g, b, a }
  }
  if (hex.length === 6 || hex.length === 8) {
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
    if ([r, g, b, a].some((value) => Number.isNaN(value))) {
      return null
    }
    return { r, g, b, a }
  }
  return null
}

function parseRgb(input: string): RgbaColor | null {
  const match = input.trim().match(/^rgba?\(([^)]+)\)$/i)
  if (!match) {
    return null
  }
  const parts = (match[1] ?? '').split(/[\s,/]+/).filter(Boolean)
  if (parts.length < 3) {
    return null
  }
  const channel = (raw: string): number => {
    if (raw.endsWith('%')) {
      return (parseFloat(raw) / 100) * 255
    }
    return parseFloat(raw)
  }
  const r = channel(parts[0] ?? '0')
  const g = channel(parts[1] ?? '0')
  const b = channel(parts[2] ?? '0')
  const a = parts[3] !== undefined ? parseFloat(parts[3]) : 1
  if ([r, g, b, a].some((value) => Number.isNaN(value))) {
    return null
  }
  return {
    r: clamp(Math.round(r), 0, 255),
    g: clamp(Math.round(g), 0, 255),
    b: clamp(Math.round(b), 0, 255),
    a: clamp(a, 0, 1),
  }
}

export function parseColor(input: string): RgbaColor | null {
  return parseHex(input) ?? parseRgb(input)
}

export function flattenColor(color: RgbaColor, base: RgbaColor): RgbaColor {
  const alpha = clamp(color.a, 0, 1)
  if (alpha >= 1) {
    return color
  }
  return {
    r: Math.round(color.r * alpha + base.r * (1 - alpha)),
    g: Math.round(color.g * alpha + base.g * (1 - alpha)),
    b: Math.round(color.b * alpha + base.b * (1 - alpha)),
    a: 1,
  }
}

function channelLuminance(value: number): number {
  const channel = clamp(value, 0, 255) / 255
  return channel <= 0.03928
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4)
}

export function relativeLuminance(color: RgbaColor): number {
  return (
    0.2126 * channelLuminance(color.r) +
    0.7152 * channelLuminance(color.g) +
    0.0722 * channelLuminance(color.b)
  )
}

export function contrastRatio(foreground: RgbaColor, background: RgbaColor): number {
  const first = relativeLuminance(foreground)
  const second = relativeLuminance(background)
  const lighter = Math.max(first, second)
  const darker = Math.min(first, second)
  return (lighter + 0.05) / (darker + 0.05)
}

export function isLargeText(fontSizePx: number, bold = false): boolean {
  if (bold) {
    return fontSizePx >= 18.66
  }
  return fontSizePx >= 24
}

export function requiredRatio(fontSizePx: number, bold = false): number {
  return isLargeText(fontSizePx, bold) ? 3 : 4.5
}

export function pickContrastingText(background: RgbaColor): string {
  const black: RgbaColor = { r: 0, g: 0, b: 0, a: 1 }
  const white: RgbaColor = { r: 255, g: 255, b: 255, a: 1 }
  return contrastRatio(black, background) >= contrastRatio(white, background)
    ? '#000000'
    : '#ffffff'
}

function textShadowFor(background: RgbaColor): string {
  if (relativeLuminance(background) < 0.42) {
    return '0 1rpx 2rpx rgba(0,0,0,0.55), 0 0 12rpx rgba(0,0,0,0.2)'
  }
  return '0 1rpx 1rpx rgba(255,255,255,0.5), 0 1rpx 2rpx rgba(0,0,0,0.14)'
}

function colorToCss(color: RgbaColor): string {
  return `rgba(${color.r},${color.g},${color.b},${color.a.toFixed(3)})`
}

function backplateFor(background: RgbaColor): { color: string; foreground: string } {
  const isDark = relativeLuminance(background) < 0.42
  if (isDark) {
    return {
      color: DARK_BACKPLATE,
      foreground: '#f7f8fb',
    }
  }
  return {
    color: LIGHT_BACKPLATE,
    foreground: '#14171c',
  }
}

function parseOrFallback(input: string, fallback: string): RgbaColor {
  return parseColor(input) ?? parseColor(fallback) ?? { r: 0, g: 0, b: 0, a: 1 }
}

/**
 * 核心判定：
 * 1. 原文字色达标 → 玻璃直出；
 * 2. 不达标 → 自动选择黑/白反色；
 * 3. 反色仍不达标 → 高不透明度背板；
 * 4. preferDifference → 满足 AA 时使用 difference 类。
 */
export function ensureContrast(options: ContrastGuardOptions): ContrastGuardResult {
  const canvas = parseOrFallback(options.canvasColor ?? LIGHT_CANVAS, LIGHT_CANVAS)
  const background = flattenColor(
    parseOrFallback(options.backgroundColor, LIGHT_CANVAS),
    canvas,
  )
  const original = flattenColor(
    parseOrFallback(options.textColor, '#14171c'),
    background,
  )
  const required = requiredRatio(options.fontSizePx, options.bold)

  const originalRatio = contrastRatio(original, background)
  if (originalRatio >= required) {
    const tone: ContrastTone = options.preferDifference ? 'difference' : 'glass'
    const className = options.preferDifference
      ? 'text-on-glass text-on-glass--difference'
      : 'text-on-glass'
    return {
      tone,
      passes: true,
      ratio: originalRatio,
      requiredRatio: required,
      foreground: colorToCss(original),
      background: colorToCss(background),
      className,
      style: `color:${colorToCss(original)};text-shadow:${
        options.preferDifference ? 'none' : textShadowFor(background)
      };`,
    }
  }

  const invertedText = pickContrastingText(background)
  const inverted = flattenColor(parseOrFallback(invertedText, '#000000'), background)
  const invertedRatio = contrastRatio(inverted, background)
  if (invertedRatio >= required) {
    return {
      tone: 'inverted',
      passes: true,
      ratio: invertedRatio,
      requiredRatio: required,
      foreground: colorToCss(inverted),
      background: colorToCss(background),
      className: 'text-on-glass',
      style: `color:${colorToCss(inverted)};text-shadow:${textShadowFor(
        background,
      )};`,
    }
  }

  const plate = backplateFor(background)
  const plateColor = parseOrFallback(plate.color, LIGHT_BACKPLATE)
  const plateForeground = parseOrFallback(plate.foreground, '#14171c')
  const plateRatio = contrastRatio(plateForeground, plateColor)

  return {
    tone: 'backplate',
    passes: plateRatio >= required,
    ratio: plateRatio,
    requiredRatio: required,
    foreground: plate.foreground,
    background: plate.color,
    className: 'sg-contrast-backplate text-on-glass',
    style: [
      `color:${plate.foreground}`,
      'text-shadow:none',
      `background-color:${plate.color}`,
      'border:1rpx solid rgba(255,255,255,0.4)',
      'padding:12rpx 18rpx',
      'border-radius:18rpx',
    ].join(';'),
  }
}

export function auditContrast(pairs: ContrastPair[]): ContrastAuditEntry[] {
  return pairs.map((pair) => ({
    label: pair.label,
    ...ensureContrast({
      textColor: pair.textColor,
      backgroundColor: pair.backgroundColor,
      fontSizePx: pair.fontSizePx,
      bold: pair.bold,
    }),
  }))
}

export interface ContrastGuardian {
  evaluate(options: ContrastGuardOptions): ContrastGuardResult
  audit(pairs: ContrastPair[]): ContrastAuditEntry[]
  pickTextColor(backgroundColor: string): string
}

class ContrastGuardianEngine implements ContrastGuardian {
  evaluate(options: ContrastGuardOptions): ContrastGuardResult {
    return ensureContrast(options)
  }

  audit(pairs: ContrastPair[]): ContrastAuditEntry[] {
    return auditContrast(pairs)
  }

  pickTextColor(backgroundColor: string): string {
    const bg = parseOrFallback(backgroundColor, LIGHT_CANVAS)
    return pickContrastingText(bg)
  }
}

/** 全局单例；无需持有页面引用 */
export const contrastGuardian = new ContrastGuardianEngine()

/** 页面根节点可绑定的 CSS 变量 */
export function buildContrastVars(result: ContrastGuardResult): string {
  return [
    `--sg-contrast-text:${result.foreground}`,
    `--sg-contrast-text-2:${result.foreground}`,
    `--sg-backplate:${result.background}`,
  ].join(';')
}
