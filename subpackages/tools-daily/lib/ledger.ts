/* ==========================================================================
   算账助手 · 折扣 / 满减 / AA
   - 全部以「分」整数计算，展示层才转元
   - AA 余数从第一人起各 +1 分，保证总和守恒
   - 非法输入返回结果码，页面负责字段级文案
   ========================================================================== */
import { formatCents, roundHalfUp } from '../../../core/toolbox/engines/money'

/** 单笔金额上限：1 亿分（100 万元） */
export const MAX_LEDGER_CENTS = 100_000_000

export type LedgerMode = 'discount' | 'threshold' | 'aa'

export type LedgerErrorCode = 'amount' | 'discount' | 'people' | 'tip' | 'tiers'

export interface LedgerFailure {
  ok: false
  code: LedgerErrorCode
}

export interface DiscountResult {
  ok: true
  payable: number
  saved: number
}

export interface ThresholdTier {
  thresholdCents: number
  offCents: number
}

export interface ThresholdResult {
  ok: true
  payable: number
  saved: number
  applied: ThresholdTier | null
  reached: boolean
}

export interface SplitResult {
  ok: true
  payable: number
  tipCents: number
  perPerson: number[]
}

function validAmount(cents: number): boolean {
  return Number.isSafeInteger(cents) && cents >= 0 && cents <= MAX_LEDGER_CENTS
}

/** 折扣：discountPercent 为实付百分比，80 表示 8 折 */
export function calcDiscount(originalCents: number, discountPercent: number): DiscountResult | LedgerFailure {
  if (!validAmount(originalCents)) {
    return { ok: false, code: 'amount' }
  }
  if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
    return { ok: false, code: 'discount' }
  }
  const payable = roundHalfUp((originalCents * discountPercent) / 100)
  return { ok: true, payable, saved: originalCents - payable }
}

/** 满减：最多 3 档，取满足门槛的最高档；不满足时原价返回 */
export function calcThreshold(originalCents: number, tiers: ThresholdTier[]): ThresholdResult | LedgerFailure {
  if (!validAmount(originalCents)) {
    return { ok: false, code: 'amount' }
  }
  if (!Array.isArray(tiers) || tiers.length > 3) {
    return { ok: false, code: 'tiers' }
  }
  const valid: ThresholdTier[] = []
  for (const tier of tiers) {
    if (
      !tier ||
      !Number.isSafeInteger(tier.thresholdCents) ||
      !Number.isSafeInteger(tier.offCents) ||
      tier.thresholdCents <= 0 ||
      tier.offCents < 0 ||
      tier.offCents > tier.thresholdCents
    ) {
      return { ok: false, code: 'tiers' }
    }
    valid.push(tier)
  }

  let applied: ThresholdTier | null = null
  for (const tier of valid) {
    if (originalCents >= tier.thresholdCents && (!applied || tier.thresholdCents > applied.thresholdCents)) {
      applied = tier
    }
  }
  const saved = applied ? applied.offCents : 0
  return {
    ok: true,
    payable: originalCents - saved,
    saved,
    applied,
    reached: Boolean(applied),
  }
}

/** AA：小费按总额百分比四舍五入到分，余数从第一人起各 +1 分 */
export function splitBill(
  totalCents: number,
  people: number,
  tipPercent: number,
): SplitResult | LedgerFailure {
  if (!validAmount(totalCents)) {
    return { ok: false, code: 'amount' }
  }
  if (!Number.isSafeInteger(people) || people < 1 || people > 100) {
    return { ok: false, code: 'people' }
  }
  if (!Number.isFinite(tipPercent) || tipPercent < 0 || tipPercent > 100) {
    return { ok: false, code: 'tip' }
  }

  const tipCents = roundHalfUp((totalCents * tipPercent) / 100)
  const payable = totalCents + tipCents
  const base = Math.floor(payable / people)
  const remainder = payable - base * people
  const perPerson: number[] = []
  for (let index = 0; index < people; index += 1) {
    perPerson.push(base + (index < remainder ? 1 : 0))
  }
  return { ok: true, payable, tipCents, perPerson }
}

/** AA 分摊文案：前 N 人各多 1 分，其余人少 1 分 */
export function formatSplitSpread(perPerson: number[]): string {
  if (perPerson.length === 0) {
    return ''
  }
  const people = perPerson.length
  const first = perPerson[0]
  const extra = perPerson.filter((item) => item === first).length
  if (extra === people) {
    return `每人 ¥${formatCents(first)}`
  }
  const last = perPerson[people - 1]
  return `前 ${extra} 人 ¥${formatCents(first)}，其余 ${people - extra} 人 ¥${formatCents(last)}`
}

/** 结果码 → 字段级文案 */
export function ledgerErrorText(code: LedgerErrorCode): string {
  switch (code) {
    case 'amount':
      return '请输入 0–100 万元之间的金额'
    case 'discount':
      return '折扣需在 0–100% 之间'
    case 'people':
      return '人数需为 1–100 的整数'
    case 'tip':
      return '小费比例需在 0–100% 之间'
    case 'tiers':
      return '满减档位需满足 0 ≤ 减额 ≤ 门槛，最多 3 档'
    default:
      return '输入有误，请检查后重试'
  }
}
