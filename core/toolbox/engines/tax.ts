/* ==========================================================================
   个税引擎 · 月度 / 年度综合所得试算
   - 金额全部以分整数计算；税率用整数百分比；结果四舍五入到分
   - 月度按 5,000 元起征、年度按 60,000 元起征；仅作简化试算
   - 不按累计预扣，不构成税务建议
   ========================================================================== */
import { roundHalfUp } from './money'

export type TaxMode = 'monthly' | 'annual'

export interface TaxBracket {
  minCents: number
  maxCents: number
  /** 整数百分比，例如 10 表示 10% */
  rate: number
  quickCents: number
  label: string
}

export const MONTHLY_BRACKETS: TaxBracket[] = [
  { minCents: 0, maxCents: 300000, rate: 3, quickCents: 0, label: '不超过 3,000 元' },
  { minCents: 300000, maxCents: 1200000, rate: 10, quickCents: 21000, label: '3,000 至 12,000 元' },
  { minCents: 1200000, maxCents: 2500000, rate: 20, quickCents: 141000, label: '12,000 至 25,000 元' },
  { minCents: 2500000, maxCents: 3500000, rate: 25, quickCents: 266000, label: '25,000 至 35,000 元' },
  { minCents: 3500000, maxCents: 5500000, rate: 30, quickCents: 441000, label: '35,000 至 55,000 元' },
  { minCents: 5500000, maxCents: 8000000, rate: 35, quickCents: 716000, label: '55,000 至 80,000 元' },
  { minCents: 8000000, maxCents: Number.MAX_SAFE_INTEGER, rate: 45, quickCents: 1516000, label: '超过 80,000 元' },
]

export const ANNUAL_BRACKETS: TaxBracket[] = [
  { minCents: 0, maxCents: 3600000, rate: 3, quickCents: 0, label: '不超过 36,000 元' },
  { minCents: 3600000, maxCents: 14400000, rate: 10, quickCents: 252000, label: '36,000 至 144,000 元' },
  { minCents: 14400000, maxCents: 30000000, rate: 20, quickCents: 1692000, label: '144,000 至 300,000 元' },
  { minCents: 30000000, maxCents: 42000000, rate: 25, quickCents: 3192000, label: '300,000 至 420,000 元' },
  { minCents: 42000000, maxCents: 66000000, rate: 30, quickCents: 5292000, label: '420,000 至 660,000 元' },
  { minCents: 66000000, maxCents: 96000000, rate: 35, quickCents: 8592000, label: '660,000 至 960,000 元' },
  { minCents: 96000000, maxCents: Number.MAX_SAFE_INTEGER, rate: 45, quickCents: 18192000, label: '超过 960,000 元' },
]

export const MONTHLY_THRESHOLD_CENTS = 500000
export const ANNUAL_THRESHOLD_CENTS = 6000000

export interface TaxInput {
  mode: TaxMode
  incomeCents: number
  insuranceCents?: number
  specialCents?: number
  otherCents?: number
}

export interface TaxResult {
  mode: TaxMode
  incomeCents: number
  insuranceCents: number
  specialCents: number
  otherCents: number
  thresholdCents: number
  taxableCents: number
  bracket: TaxBracket
  bracketIndex: number
  quickCents: number
  taxCents: number
  netCents: number
  /** 税额 / 收入，百分比 */
  ratePercent: number
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0
}

/**
 * 计算月度 / 年度个税。
 * - 收入必须为正整数分；五险一金不得高于收入
 * - 未达起征点时 bracketIndex = -1，税额为 0
 */
export function calcTax(input: TaxInput): TaxResult | null {
  const mode: TaxMode = input.mode === 'annual' ? 'annual' : 'monthly'
  const incomeCents = input.incomeCents
  const insuranceCents = input.insuranceCents ?? 0
  const specialCents = input.specialCents ?? 0
  const otherCents = input.otherCents ?? 0
  if (
    !Number.isInteger(incomeCents) ||
    incomeCents <= 0 ||
    !isNonNegativeInteger(insuranceCents) ||
    !isNonNegativeInteger(specialCents) ||
    !isNonNegativeInteger(otherCents) ||
    insuranceCents > incomeCents
  ) {
    return null
  }

  const thresholdCents =
    mode === 'monthly' ? MONTHLY_THRESHOLD_CENTS : ANNUAL_THRESHOLD_CENTS
  const brackets = mode === 'monthly' ? MONTHLY_BRACKETS : ANNUAL_BRACKETS
  const taxableCents = Math.max(
    0,
    incomeCents - insuranceCents - specialCents - otherCents - thresholdCents,
  )
  const bracket =
    brackets.find((item) => taxableCents <= item.maxCents) ?? brackets[brackets.length - 1]
  const bracketIndex = taxableCents === 0 ? -1 : brackets.indexOf(bracket)
  const taxCents =
    taxableCents === 0
      ? 0
      : Math.max(0, roundHalfUp((taxableCents * bracket.rate) / 100) - bracket.quickCents)
  const netCents = incomeCents - insuranceCents - taxCents
  const ratePercent = incomeCents > 0 ? (taxCents / incomeCents) * 100 : 0

  return {
    mode,
    incomeCents,
    insuranceCents,
    specialCents,
    otherCents,
    thresholdCents,
    taxableCents,
    bracket,
    bracketIndex,
    quickCents: taxableCents === 0 ? 0 : bracket.quickCents,
    taxCents,
    netCents,
    ratePercent,
  }
}
