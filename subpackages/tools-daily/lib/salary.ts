/* ==========================================================================
   薪资反算引擎 · 目标到手 → 税前月薪
   - 月度简化口径：5,000 元起征、7 级税率、五险一金 + 专项附加扣除
   - 累进税率不可解析反解，使用整数分二分逼近，误差 ≤1 分
   - 税前上限 1,000,000 元/月；maxIter 可注入用于测试不收敛
   ========================================================================== */
import { calcTax, type TaxBracket } from '../../../core/toolbox/engines/tax'
import { formatCents, parseCents, roundHalfUp } from '../../../core/toolbox/engines/money'

export type InsuranceMode = 'ratio' | 'fixed'

export const SALARY_MAX_GROSS_CENTS = 100000000
export const SALARY_DEFAULT_MAX_ITER = 60
export const SALARY_MAX_ITER = 200

export interface SalaryInput {
  targetNetCents: number
  insuranceMode: InsuranceMode
  /** 五险一金月度比例，0–100，例如 10.5 表示 10.5% */
  insuranceRatio: number
  /** 五险一金固定金额（分） */
  insuranceFixedCents: number
  /** 专项附加扣除（分） */
  specialCents: number
  /** 二分迭代上限；默认 60，测试可注入较小值 */
  maxIter?: number
}

export interface SalaryBreakdown {
  grossCents: number
  insuranceCents: number
  specialCents: number
  taxableCents: number
  taxCents: number
  netCents: number
  bracket: TaxBracket
  bracketIndex: number
}

export interface SalaryInverseResult extends SalaryBreakdown {
  targetNetCents: number
  iterations: number
  summary: string
}

export function insuranceModeLabel(mode: InsuranceMode): string {
  return mode === 'fixed' ? '固定金额' : '按比例'
}

function normalizeMode(mode: InsuranceMode): InsuranceMode {
  return mode === 'fixed' ? 'fixed' : 'ratio'
}

function normalizeMaxIter(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return SALARY_DEFAULT_MAX_ITER
  }
  return Math.min(SALARY_MAX_ITER, Math.max(1, Math.floor(value as number)))
}

function insuranceFor(grossCents: number, input: SalaryInput): number {
  if (normalizeMode(input.insuranceMode) === 'fixed') {
    return Math.min(Math.max(0, input.insuranceFixedCents), grossCents)
  }
  const ratio = Math.min(100, Math.max(0, input.insuranceRatio))
  return Math.min(grossCents, roundHalfUp((grossCents * ratio) / 100))
}

function validateInput(input: SalaryInput): boolean {
  if (!Number.isInteger(input.targetNetCents) || input.targetNetCents <= 0) {
    return false
  }
  if (!Number.isFinite(input.insuranceRatio) || input.insuranceRatio < 0 || input.insuranceRatio > 100) {
    return false
  }
  if (!Number.isInteger(input.insuranceFixedCents) || input.insuranceFixedCents < 0) {
    return false
  }
  if (!Number.isInteger(input.specialCents) || input.specialCents < 0) {
    return false
  }
  return true
}

/** 已知税前月薪，按月度简化口径计算到手；非法输入返回 null */
export function forwardSalaryNet(grossCents: number, input: SalaryInput): SalaryBreakdown | null {
  if (!Number.isInteger(grossCents) || grossCents <= 0 || grossCents > SALARY_MAX_GROSS_CENTS) {
    return null
  }
  if (!validateInput(input)) {
    return null
  }
  const insuranceCents = insuranceFor(grossCents, input)
  const tax = calcTax({
    mode: 'monthly',
    incomeCents: grossCents,
    insuranceCents,
    specialCents: input.specialCents,
  })
  if (!tax) {
    return null
  }
  return {
    grossCents,
    insuranceCents,
    specialCents: input.specialCents,
    taxableCents: tax.taxableCents,
    taxCents: tax.taxCents,
    netCents: tax.netCents,
    bracket: tax.bracket,
    bracketIndex: tax.bracketIndex,
  }
}

/**
 * 目标到手 → 税前月薪。
 * - 二分逼近最小税前值，误差 ≤1 分
 * - 目标超过税前上限可达到的到手值、或 maxIter 内未收敛时返回 null
 */
export function inverseSalary(input: SalaryInput): SalaryInverseResult | null {
  if (!validateInput(input)) {
    return null
  }
  const target = input.targetNetCents
  const maxBreakdown = forwardSalaryNet(SALARY_MAX_GROSS_CENTS, input)
  if (!maxBreakdown || maxBreakdown.netCents < target) {
    return null
  }

  const maxIter = normalizeMaxIter(input.maxIter)
  let low = 1
  let high = SALARY_MAX_GROSS_CENTS
  let best: SalaryBreakdown | null = null
  let iterations = 0

  /* 先找“到手 ≥ 目标”的最小税前值，再与它前一分比较，优先返回精确值 */
  while (low <= high && iterations < maxIter) {
    const mid = Math.floor((low + high) / 2)
    const current = forwardSalaryNet(mid, input)
    iterations += 1
    if (!current) {
      return null
    }
    if (current.netCents >= target) {
      best = current
      high = mid - 1
    } else {
      low = mid + 1
    }
  }

  if (!best) {
    return null
  }
  const previous = forwardSalaryNet(best.grossCents - 1, input)
  if (previous) {
    iterations += 1
    const bestDiff = Math.abs(best.netCents - target)
    const previousDiff = Math.abs(previous.netCents - target)
    if (previousDiff < bestDiff || (previousDiff === bestDiff && previous.netCents > best.netCents)) {
      best = previous
    }
  }
  if (Math.abs(best.netCents - target) > 1) {
    return null
  }

  const result: SalaryInverseResult = {
    ...best,
    targetNetCents: target,
    iterations,
    summary: '',
  }
  result.summary = salarySummary(result)
  return result
}

/** 从 Workflow 文本中取第一个金额数字（支持千分位与两位小数） */
export function parseSalaryWorkflowAmount(text: string): number | null {
  const value = typeof text === 'string' ? text : ''
  const match = value.match(/-?\d[\d,]*(?:\.\d{1,2})?/)
  if (!match) {
    return null
  }
  const cents = parseCents(match[0])
  return cents !== null && cents > 0 ? cents : null
}

/** 复制与 Workflow 共用的摘要 */
export function salarySummary(result: SalaryInverseResult): string {
  return [
    `目标到手 ¥${formatCents(result.targetNetCents)}`,
    `税前月薪 ¥${formatCents(result.grossCents)}`,
    `五险一金 ¥${formatCents(result.insuranceCents)}`,
    `专项附加扣除 ¥${formatCents(result.specialCents)}`,
    `应纳税所得额 ¥${formatCents(result.taxableCents)}`,
    `个税 ¥${formatCents(result.taxCents)}`,
    `校验到手 ¥${formatCents(result.netCents)}`,
    '按月度简化口径试算，不按累计预扣，仅供参考',
  ].join(' · ')
}
