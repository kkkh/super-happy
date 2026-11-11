/* ==========================================================================
   离职补偿 · N / N+1 · 封顶 · 未休年假
   - 经济补偿：每满一年一个月工资；六个月以上不满一年按一年，不满六个月按半个月
   - 封顶：计发基数 = min(月薪, 3×社平)，补偿年限最多 12 年
   - 年假：日薪 = 月薪 / 21.75；额外补偿 = 日薪 × 天数 × 200%（正常工资另计）
   - 全部金额以分整数计算；结果仅供参考，不构成法律意见
   ========================================================================== */

export type SeveranceMode = 'n' | 'n1'

export interface SeveranceInput {
  monthlyCents: number
  years: number
  months: number
  mode: SeveranceMode
  capEnabled: boolean
  socialAverageCents: number
  unusedLeaveDays: number
}

export interface SeveranceResult {
  mode: SeveranceMode
  totalMonths: number
  yearsForComp: number
  baseCents: number
  monthlyCents: number
  compensationCents: number
  noticeCents: number
  leaveDays: number
  leaveDailyCents: number
  leavePayCents: number
  totalCents: number
  capEnabled: boolean
  capped: boolean
  yearsCapped: boolean
}

export type SeveranceOutcome =
  | { ok: true; result: SeveranceResult }
  | { ok: false; error: string }

export const MAX_MONTHLY_CENTS = 1000000000
export const MAX_LEAVE_DAYS = 30
export const MONTHLY_WORK_DAYS = 21.75

function fail(error: string): SeveranceOutcome {
  return { ok: false, error }
}

function roundCents(value: number): number {
  return Math.round(value)
}

/** 折算补偿年限：<6 个月半个月；6–12 个月一年；其余按满年 + 满 6 个月进一年 */
export function compensationYears(totalMonths: number): number {
  if (totalMonths < 6) {
    return 0.5
  }
  if (totalMonths < 12) {
    return 1
  }
  const full = Math.floor(totalMonths / 12)
  const rest = totalMonths % 12
  return full + (rest >= 6 ? 1 : 0)
}

/** 未休年假额外补偿：日薪 × 天数 × 200%，不含正常工资 */
export function annualLeavePay(monthlyCents: number, days: number): number | null {
  if (
    !Number.isFinite(monthlyCents) ||
    monthlyCents <= 0 ||
    monthlyCents > MAX_MONTHLY_CENTS ||
    !Number.isFinite(days) ||
    days < 0 ||
    days > MAX_LEAVE_DAYS ||
    Math.abs(days * 2 - Math.round(days * 2)) > 1e-9
  ) {
    return null
  }
  return roundCents((monthlyCents / MONTHLY_WORK_DAYS) * days * 2)
}

export function severanceTotal(input: SeveranceInput): SeveranceOutcome {
  if (!input || (input.mode !== 'n' && input.mode !== 'n1')) {
    return fail('请选择 N 或 N+1 方案')
  }
  const monthlyCents = input.monthlyCents
  if (
    !Number.isFinite(monthlyCents) ||
    monthlyCents <= 0 ||
    monthlyCents > MAX_MONTHLY_CENTS
  ) {
    return fail('月薪需大于 0 且不超过 1,000 万元')
  }
  if (
    !Number.isInteger(input.years) ||
    input.years < 0 ||
    input.years > 50 ||
    !Number.isInteger(input.months) ||
    input.months < 0 ||
    input.months > 11
  ) {
    return fail('工作年限需在 0–50 年、0–11 个月之间')
  }
  const totalMonths = input.years * 12 + input.months
  if (totalMonths <= 0) {
    return fail('工作年限需大于 0')
  }
  if (
    !Number.isFinite(input.unusedLeaveDays) ||
    input.unusedLeaveDays < 0 ||
    input.unusedLeaveDays > MAX_LEAVE_DAYS ||
    Math.abs(input.unusedLeaveDays * 2 - Math.round(input.unusedLeaveDays * 2)) > 1e-9
  ) {
    return fail('未休年假需在 0–30 天之间，支持半天')
  }

  let baseCents = monthlyCents
  let capped = false
  if (input.capEnabled) {
    if (
      !Number.isFinite(input.socialAverageCents) ||
      input.socialAverageCents <= 0 ||
      input.socialAverageCents > MAX_MONTHLY_CENTS
    ) {
      return fail('启用封顶时，请填写大于 0 的当地社平月薪')
    }
    const triple = input.socialAverageCents * 3
    if (monthlyCents > triple) {
      baseCents = triple
      capped = true
    }
  }

  let yearsForComp = compensationYears(totalMonths)
  let yearsCapped = false
  if (input.capEnabled && yearsForComp > 12) {
    yearsForComp = 12
    yearsCapped = true
  }

  const compensationCents = roundCents(baseCents * yearsForComp)
  const noticeCents = input.mode === 'n1' ? baseCents : 0
  const leavePayCents = annualLeavePay(monthlyCents, input.unusedLeaveDays) ?? 0
  const leaveDailyCents = roundCents(monthlyCents / MONTHLY_WORK_DAYS)
  const totalCents = compensationCents + noticeCents + leavePayCents

  return {
    ok: true,
    result: {
      mode: input.mode,
      totalMonths,
      yearsForComp,
      baseCents,
      monthlyCents,
      compensationCents,
      noticeCents,
      leaveDays: input.unusedLeaveDays,
      leaveDailyCents,
      leavePayCents,
      totalCents,
      capEnabled: input.capEnabled,
      capped,
      yearsCapped,
    },
  }
}

function formatMonths(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

/** 摘要与页面同源，供 Workflow 来源字段使用 */
export function severanceSummary(result: SeveranceResult): string {
  return `${result.mode === 'n1' ? 'N+1' : 'N'} · 补偿 ${formatMonths(
    result.yearsForComp,
  )} 个月 · 经济补偿 ¥${(result.compensationCents / 100).toFixed(2)}${
    result.noticeCents > 0 ? ` · 代通知金 ¥${(result.noticeCents / 100).toFixed(2)}` : ''
  }${result.leavePayCents > 0 ? ` · 年假补偿 ¥${(result.leavePayCents / 100).toFixed(2)}` : ''}`
}
