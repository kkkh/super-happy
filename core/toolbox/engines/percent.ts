/* ==========================================================================
   百分比引擎 · 占比 / 增减幅 / 配比
   - 输入按两位小数放大为整数，避免浮点误差
   - 增减幅 =(新−旧)/旧；配比按最大公约数化简
   - 涨跌幅超过 1000% 或旧值为 0 返回 null
   ========================================================================== */
import { formatCents, roundHalfUp } from './money'

export type PercentMode = 'share' | 'change' | 'ratio'

export const PERCENT_SCALE = 100
export const PERCENT_MAX_RATE = 1000
export const PERCENT_MAX_VALUE = 1000000000

export interface PercentShareResult {
  mode: 'share'
  partCents: number
  wholeCents: number
  remainderCents: number
  percent: number
  percentText: string
}

export interface PercentChangeResult {
  mode: 'change'
  oldCents: number
  newCents: number
  diffCents: number
  percent: number
  percentText: string
  direction: 'up' | 'down' | 'same'
}

export interface PercentRatioResult {
  mode: 'ratio'
  aCents: number
  bCents: number
  a: number
  b: number
  ratioText: string
  totalParts: number
  aSharePercent: number
  bSharePercent: number
  aShareText: string
  bShareText: string
}

export type PercentResult = PercentShareResult | PercentChangeResult | PercentRatioResult

export interface PercentWorkflowInput {
  mode: PercentMode
  aCents: number
  bCents: number
}

export function percentModeLabel(mode: PercentMode): string {
  if (mode === 'change') {
    return '增减幅'
  }
  if (mode === 'ratio') {
    return '配比'
  }
  return '占比'
}

/** 最多两位小数，去掉无意义的末尾 0 */
export function formatPercentValue(value: number): string {
  if (!Number.isFinite(value)) {
    return '—'
  }
  return `${value.toFixed(2).replace(/\.?0+$/, '')}%`
}

export function formatSignedPercent(value: number): string {
  if (!Number.isFinite(value)) {
    return '—'
  }
  return `${value > 0 ? '+' : ''}${formatPercentValue(value)}`
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= PERCENT_MAX_VALUE * PERCENT_SCALE
}

function roundPercent(numerator: number, denominator: number): number {
  return roundHalfUp((numerator * 10000) / denominator) / 100
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y > 0) {
    const next = x % y
    x = y
    y = next
  }
  return x || 1
}

/** 占比：部分 / 总数；总数 0 或占比 >1000% 返回 null */
export function percentOf(partCents: number, wholeCents: number): PercentShareResult | null {
  if (!isNonNegativeInteger(partCents) || !isNonNegativeInteger(wholeCents) || wholeCents <= 0) {
    return null
  }
  const percent = roundPercent(partCents, wholeCents)
  if (!Number.isFinite(percent) || percent > PERCENT_MAX_RATE) {
    return null
  }
  return {
    mode: 'share',
    partCents,
    wholeCents,
    remainderCents: Math.max(0, wholeCents - partCents),
    percent,
    percentText: formatPercentValue(percent),
  }
}

/** 增减幅：旧值必须 >0；涨跌幅超过 ±1000% 返回 null */
export function changeRate(oldCents: number, newCents: number): PercentChangeResult | null {
  if (
    !isNonNegativeInteger(oldCents) ||
    !isNonNegativeInteger(newCents) ||
    oldCents <= 0
  ) {
    return null
  }
  const diffCents = newCents - oldCents
  const percent = roundPercent(diffCents, oldCents)
  if (!Number.isFinite(percent) || Math.abs(percent) > PERCENT_MAX_RATE) {
    return null
  }
  return {
    mode: 'change',
    oldCents,
    newCents,
    diffCents,
    percent,
    percentText: formatSignedPercent(percent),
    direction: diffCents > 0 ? 'up' : diffCents < 0 ? 'down' : 'same',
  }
}

/** 配比：A:B 化简；两者不能同时为 0 */
export function ratioParts(aCents: number, bCents: number): PercentRatioResult | null {
  if (!isNonNegativeInteger(aCents) || !isNonNegativeInteger(bCents)) {
    return null
  }
  if (aCents === 0 && bCents === 0) {
    return null
  }
  const divisor = gcd(aCents, bCents)
  const a = Math.round(aCents / divisor)
  const b = Math.round(bCents / divisor)
  const totalParts = a + b
  const aSharePercent = totalParts > 0 ? roundPercent(a, totalParts) : 0
  const bSharePercent = totalParts > 0 ? roundPercent(b, totalParts) : 0
  return {
    mode: 'ratio',
    aCents,
    bCents,
    a,
    b,
    ratioText: `${a}:${b}`,
    totalParts,
    aSharePercent,
    bSharePercent,
    aShareText: formatPercentValue(aSharePercent),
    bShareText: formatPercentValue(bSharePercent),
  }
}

/** 复制与 silent 工作流共用的摘要 */
export function percentSummary(result: PercentResult): string {
  if (result.mode === 'share') {
    return [
      '占比',
      `${formatCents(result.partCents)} 占 ${formatCents(result.wholeCents)}`,
      result.percentText,
      `其余 ${formatCents(result.remainderCents)}`,
    ].join(' · ')
  }
  if (result.mode === 'change') {
    return [
      '增减幅',
      `${formatCents(result.oldCents)} → ${formatCents(result.newCents)}`,
      `差额 ${result.diffCents > 0 ? '+' : ''}${formatCents(result.diffCents)}`,
      result.percentText,
    ].join(' · ')
  }
  return [
    '配比',
    `${formatCents(result.aCents)}:${formatCents(result.bCents)} = ${result.ratioText}`,
    `合计 ${result.totalParts} 份`,
    `${result.aShareText} / ${result.bShareText}`,
  ].join(' · ')
}

const WORKFLOW_PREFIX: Record<string, PercentMode> = {
  占比: 'share',
  百分比: 'share',
  share: 'share',
  增减: 'change',
  增减幅: 'change',
  涨跌幅: 'change',
  change: 'change',
  配比: 'ratio',
  比例: 'ratio',
  ratio: 'ratio',
}

/**
 * 解析 silent 文本：
 * - `占比 25 200` / `增减 100 120` / `配比 16 24`
 * - 无前缀时默认占比；数字最多两位小数，负值拒绝
 */
export function parsePercentWorkflow(text: string): PercentWorkflowInput | null {
  const raw = typeof text === 'string' ? text.trim() : ''
  if (!raw) {
    return null
  }
  let mode: PercentMode = 'share'
  let rest = raw
  const prefixMatch = raw.match(/^(占比|百分比|增减幅|增减|涨跌幅|配比|比例|share|change|ratio)\s*/i)
  if (prefixMatch) {
    const key = prefixMatch[1].toLowerCase()
    mode = WORKFLOW_PREFIX[key] ?? WORKFLOW_PREFIX[prefixMatch[1]] ?? 'share'
    rest = raw.slice(prefixMatch[0].length)
  }
  const numbers = rest.match(/-?\d[\d,]*(?:\.\d{1,2})?/g)
  if (!numbers || numbers.length !== 2) {
    return null
  }
  const values: number[] = []
  for (const token of numbers) {
    const normalized = token.replace(/,/g, '')
    if (normalized.startsWith('-')) {
      return null
    }
    const value = Number(normalized)
    if (!Number.isFinite(value) || value < 0 || value > PERCENT_MAX_VALUE) {
      return null
    }
    values.push(Math.round(value * PERCENT_SCALE))
  }
  return { mode, aCents: values[0], bCents: values[1] }
}
