/* ==========================================================================
   贷款计划引擎 · 等额本息 / 等额本金
   - 金额一律以「分」整数计算，利率以基点传入
   - 房贷页与车贷页共用；页面只负责万元 / 元与年 / 月的单位转换
   ========================================================================== */
import { roundHalfUp } from './money'

export type LoanMode = 'equal-payment' | 'equal-principal'

export interface LoanScheduleRow {
  index: number
  paymentCents: number
  principalCents: number
  interestCents: number
  balanceCents: number
}

export interface LoanPlan {
  mode: LoanMode
  principalCents: number
  periods: number
  monthlyRate: number
  /** 等额本息为每月月供；等额本金为 0 */
  monthlyCents: number
  firstCents: number
  lastCents: number
  totalCents: number
  interestCents: number
  schedule: LoanScheduleRow[]
}

export interface LoanInput {
  principalCents: number
  /** 年利率基点：3.5% = 350 */
  annualRateBp: number
  periods: number
  mode: LoanMode
  /** 逐月表最多返回多少期，默认 12 */
  scheduleLimit?: number
}

export const LOAN_MAX_RATE_BP = 2400
export const LOAN_MAX_PERIODS = 600

export function planLoan(input: LoanInput): LoanPlan | null {
  const principalCents = roundHalfUp(Number(input.principalCents))
  const annualRateBp = Number(input.annualRateBp)
  const periods = Number(input.periods)
  const mode = input.mode
  if (
    !Number.isFinite(principalCents) ||
    principalCents <= 0 ||
    !Number.isFinite(annualRateBp) ||
    annualRateBp < 0 ||
    annualRateBp > LOAN_MAX_RATE_BP ||
    !Number.isInteger(periods) ||
    periods < 1 ||
    periods > LOAN_MAX_PERIODS ||
    (mode !== 'equal-payment' && mode !== 'equal-principal')
  ) {
    return null
  }

  const limit = Math.min(
    periods,
    Math.max(1, Math.round(Number(input.scheduleLimit ?? 12))),
  )
  const monthlyRate = annualRateBp / 10000 / 12
  const schedule: LoanScheduleRow[] = []
  let monthlyCents = 0
  let totalCents = 0
  let interestCents = 0
  let firstCents = 0
  let lastCents = 0

  if (mode === 'equal-payment') {
    if (monthlyRate === 0) {
      monthlyCents = roundHalfUp(principalCents / periods)
      totalCents = monthlyCents * periods
    } else {
      const pow = Math.pow(1 + monthlyRate, periods)
      monthlyCents = roundHalfUp((principalCents * monthlyRate * pow) / (pow - 1))
      totalCents = monthlyCents * periods
    }
    interestCents = totalCents - principalCents
    firstCents = monthlyCents
    lastCents = monthlyCents

    let balance = principalCents
    let scheduleTotal = 0
    for (let index = 1; index <= limit; index += 1) {
      const interest = roundHalfUp(balance * monthlyRate)
      const principalPart = index === periods ? balance : monthlyCents - interest
      const payment = index === periods ? balance + interest : monthlyCents
      balance -= principalPart
      scheduleTotal += payment
      schedule.push({
        index,
        paymentCents: payment,
        principalCents: principalPart,
        interestCents: interest,
        balanceCents: Math.max(0, balance),
      })
    }
    /* 短期贷款以逐期明细合计为准，避免总额与明细差一分钱 */
    if (periods <= limit) {
      totalCents = scheduleTotal
      interestCents = totalCents - principalCents
    }
  } else {
    const principalPerPeriod = roundHalfUp(principalCents / periods)
    let balance = principalCents
    let total = 0
    for (let index = 1; index <= periods; index += 1) {
      const interest = roundHalfUp(balance * monthlyRate)
      const principalPart = index === periods ? balance : principalPerPeriod
      const payment = principalPart + interest
      total += payment
      if (index === 1) {
        firstCents = payment
      }
      if (index === periods) {
        lastCents = payment
      }
      if (index <= limit) {
        balance -= principalPart
        schedule.push({
          index,
          paymentCents: payment,
          principalCents: principalPart,
          interestCents: interest,
          balanceCents: Math.max(0, balance),
        })
      } else {
        balance -= principalPart
      }
    }
    totalCents = total
    interestCents = total - principalCents
  }

  return {
    mode,
    principalCents,
    periods,
    monthlyRate,
    monthlyCents,
    firstCents,
    lastCents,
    totalCents,
    interestCents,
    schedule,
  }
}
