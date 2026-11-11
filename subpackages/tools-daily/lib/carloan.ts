/* ==========================================================================
   车贷计算引擎 · 复用贷款计划
   - 车价 / 首付 / 贷款额全部以「分」计算
   - 首付支持比例或金额；首付 ≥ 车价时拒绝
   - 月供、利息、逐月表与 loan 引擎同源，禁止复制公式
   ========================================================================== */
import {
  formatCents,
  parseBasisPoints,
  parseCents,
  parseDecimal,
  parseInteger,
  roundHalfUp,
} from '../../../core/toolbox/engines/money'
import type { IPosterData } from '../../../core/toolbox/poster'
import {
  LOAN_MAX_PERIODS,
  LOAN_MAX_RATE_BP,
  planLoan,
  type LoanMode,
  type LoanScheduleRow,
} from '../../../core/toolbox/engines/loan'

export interface CarLoanInput {
  carPriceCents: number
  /** 首付金额（分）；与 downPaymentPercent 二选一 */
  downPaymentCents?: number | null
  /** 首付比例：30 表示 30% */
  downPaymentPercent?: number | null
  termMonths: number
  annualRateBp: number
  mode: LoanMode
}

export interface CarLoanPlan {
  mode: LoanMode
  carPriceCents: number
  downPaymentCents: number
  loanCents: number
  termMonths: number
  annualRateBp: number
  monthlyCents: number
  firstCents: number
  lastCents: number
  totalCents: number
  interestCents: number
  schedule: LoanScheduleRow[]
}

export const CAR_LOAN_MAX_TERM = 360

export interface CarLoanSchemeInput {
  downPaymentCents?: number | null
  downPaymentPercent?: number | null
  termMonths: number
  annualRateBp: number
  mode: LoanMode
}

export type CarLoanDownMode = 'percent' | 'amount'

export interface CarLoanSchemeText {
  downMode: CarLoanDownMode
  downPercentText: string
  downAmountText: string
  termText: string
  rateText: string
  mode: LoanMode
}

export type CarLoanSchemeParse =
  | { ok: true; scheme: CarLoanSchemeInput }
  | { ok: false; error: string }

/** 车价输入 → 分；非正数或非法返回 null */
export function parseCarLoanPrice(text: string): number | null {
  const cents = parseCents(text)
  return cents !== null && cents > 0 ? cents : null
}

export function parseCarLoanScheme(texts: CarLoanSchemeText): CarLoanSchemeParse {
  const termMonths = parseInteger(texts.termText, 1, 360)
  if (termMonths === null) {
    return { ok: false, error: '期限需为 1–360 个月的整数' }
  }
  const annualRateBp = parseBasisPoints(texts.rateText)
  if (annualRateBp === null || annualRateBp > 2400) {
    return { ok: false, error: '年利率需在 0–24% 之间，最多两位小数' }
  }
  if (texts.downMode === 'percent') {
    const downPaymentPercent = parseDecimal(texts.downPercentText, 0, 99.99, 2)
    if (downPaymentPercent === null) {
      return { ok: false, error: '首付比例需在 0–99.99% 之间' }
    }
    return { ok: true, scheme: { downPaymentPercent, termMonths, annualRateBp, mode: texts.mode } }
  }
  const downPaymentCents = parseCents(texts.downAmountText)
  if (downPaymentCents === null) {
    return { ok: false, error: '首付金额需为大于等于 0 的数字，最多两位小数' }
  }
  return { ok: true, scheme: { downPaymentCents, termMonths, annualRateBp, mode: texts.mode } }
}

export interface CarLoanCompareInput {
  carPriceCents: number
  schemeA: CarLoanSchemeInput
  schemeB: CarLoanSchemeInput
}

export interface CarLoanCompareResult {
  schemeA: CarLoanPlan
  schemeB: CarLoanPlan
  /** A − B，正数表示 A 月供更高 */
  monthlyDiffCents: number
  /** A − B，正数表示 A 总利息更高 */
  interestDiffCents: number
  totalDiffCents: number
  cheaper: 'a' | 'b' | 'tie'
}

export interface CarLoanPrepayInput extends CarLoanInput {
  /** 第 N 期还款后提前还款，1 ≤ N < 期限 */
  prepayAfterPeriod: number
  prepayCents: number
}

export interface CarLoanPrepayResult {
  plan: CarLoanPlan
  prepayAfterPeriod: number
  prepayCents: number
  remainingBeforeCents: number
  remainingAfterCents: number
  remainingPeriods: number
  /** 原月供（等额本金为首月） */
  monthlyPaymentCents: number
  newMonthlyPaymentCents: number
  monthlySavedCents: number
  savedInterestCents: number
  newInterestCents: number
}

export function carLoanPaymentCents(
  plan: Pick<CarLoanPlan, 'mode' | 'monthlyCents' | 'firstCents'>,
): number {
  return plan.mode === 'equal-payment' ? plan.monthlyCents : plan.firstCents
}

export function carLoanRateText(annualRateBp: number): string {
  return `${(Number(annualRateBp) / 100).toFixed(2)}%`
}

/** 双方案对比：同一车价，首付 / 期限 / 利率 / 还款方式可不同 */
export function compareCarLoan(input: CarLoanCompareInput): CarLoanCompareResult | null {
  const schemeA = carLoanPlan({ carPriceCents: input.carPriceCents, ...input.schemeA })
  const schemeB = carLoanPlan({ carPriceCents: input.carPriceCents, ...input.schemeB })
  if (!schemeA || !schemeB) {
    return null
  }
  const interestDiffCents = schemeA.interestCents - schemeB.interestCents
  return {
    schemeA,
    schemeB,
    monthlyDiffCents: carLoanPaymentCents(schemeA) - carLoanPaymentCents(schemeB),
    interestDiffCents,
    totalDiffCents: schemeA.totalCents - schemeB.totalCents,
    cheaper: interestDiffCents === 0 ? 'tie' : interestDiffCents > 0 ? 'b' : 'a',
  }
}

/** 提前还款试算：第 N 期后还款，期限不变、重算月供，利息差额即节省利息 */
export function prepayCarLoan(input: CarLoanPrepayInput): CarLoanPrepayResult | null {
  const plan = carLoanPlan(input)
  if (!plan) {
    return null
  }
  const after = Number(input.prepayAfterPeriod)
  if (!Number.isInteger(after) || after < 1 || after >= plan.termMonths) {
    return null
  }
  const prepayCents = roundHalfUp(Number(input.prepayCents))
  if (!Number.isFinite(prepayCents) || prepayCents <= 0) {
    return null
  }

  const prefix = planLoan({
    principalCents: plan.loanCents,
    annualRateBp: input.annualRateBp,
    periods: plan.termMonths,
    mode: plan.mode,
    scheduleLimit: after,
  })
  if (!prefix || prefix.schedule.length < after) {
    return null
  }
  const prefixRows = prefix.schedule
  const remainingBeforeCents = prefixRows[after - 1].balanceCents
  if (prepayCents >= remainingBeforeCents) {
    return null
  }
  const prepaidInterestCents = prefixRows.reduce((sum, row) => sum + row.interestCents, 0)
  const remainingPeriods = plan.termMonths - after
  const next = planLoan({
    principalCents: remainingBeforeCents - prepayCents,
    annualRateBp: input.annualRateBp,
    periods: remainingPeriods,
    mode: plan.mode,
    scheduleLimit: 1,
  })
  if (!next) {
    return null
  }

  const monthlyPaymentCents = carLoanPaymentCents(plan)
  const newMonthlyPaymentCents = carLoanPaymentCents(next)
  /* 0 利率或分摊取整可能产生几分钱反差，按 0 处理 */
  const savedInterestCents = Math.max(
    0,
    plan.interestCents - prepaidInterestCents - next.interestCents,
  )
  return {
    plan,
    prepayAfterPeriod: after,
    prepayCents,
    remainingBeforeCents,
    remainingAfterCents: remainingBeforeCents - prepayCents,
    remainingPeriods,
    monthlyPaymentCents,
    newMonthlyPaymentCents,
    monthlySavedCents: monthlyPaymentCents - newMonthlyPaymentCents,
    savedInterestCents,
    newInterestCents: plan.interestCents - savedInterestCents,
  }
}

function schemeSummary(plan: CarLoanPlan): string {
  const percent =
    plan.downPaymentCents > 0
      ? `${((plan.downPaymentCents / plan.carPriceCents) * 100).toFixed(2)}%`
      : '0%'
  return [
    `首付 ${percent}（${formatCents(plan.downPaymentCents)} 元）`,
    `${plan.termMonths} 期`,
    carLoanRateText(plan.annualRateBp),
    plan.mode === 'equal-payment' ? '等额本息' : '等额本金',
    `${plan.mode === 'equal-payment' ? '月供' : '首月月供'} ${formatCents(carLoanPaymentCents(plan))} 元`,
    `总利息 ${formatCents(plan.interestCents)} 元`,
  ].join(' / ')
}

export function carLoanCompareSummary(result: CarLoanCompareResult): string {
  const diff = result.interestDiffCents
  const verdict =
    diff === 0
      ? '两方案总利息相同'
      : `方案 ${diff > 0 ? 'B' : 'A'} 省利息 ${formatCents(Math.abs(diff))} 元`
  return [
    `车贷对比（车价 ${formatCents(result.schemeA.carPriceCents)} 元）`,
    `方案 A：${schemeSummary(result.schemeA)}`,
    `方案 B：${schemeSummary(result.schemeB)}`,
    verdict,
  ].join('；')
}

export function carLoanPrepaySummary(result: CarLoanPrepayResult): string {
  const mode = result.plan.mode === 'equal-payment' ? '等额本息' : '等额本金'
  return [
    `车贷提前还款（${mode}）`,
    `车价 ${formatCents(result.plan.carPriceCents)} 元`,
    `贷款 ${formatCents(result.plan.loanCents)} 元`,
    `第 ${result.prepayAfterPeriod} 期后提前还款 ${formatCents(result.prepayCents)} 元`,
    `${result.plan.mode === 'equal-payment' ? '月供' : '首月月供'} ${formatCents(result.monthlyPaymentCents)} → ${formatCents(result.newMonthlyPaymentCents)} 元`,
    `节省利息 ${formatCents(result.savedInterestCents)} 元`,
    `期限不变，剩余 ${result.remainingPeriods} 期`,
  ].join('；')
}

export interface CarLoanViewRow {
  k: string
  v: string
}

export interface CarLoanViewScheduleRow {
  index: number
  payment: string
  principal: string
  interest: string
  balance: string
}

export interface CarLoanView {
  resultLabel: string
  resultMain: string
  resultRows: CarLoanViewRow[]
  schedule: CarLoanViewScheduleRow[]
  carloanSummary: string
  posterData: IPosterData
}

function money(cents: number): string {
  return `¥${formatCents(cents)}`
}

function planDetail(plan: CarLoanPlan): string {
  return [
    `首付 ${money(plan.downPaymentCents)}`,
    `${plan.termMonths} 期`,
    `${plan.mode === 'equal-payment' ? '每月月供' : '首月月供'} ${money(carLoanPaymentCents(plan))}`,
    `总利息 ${money(plan.interestCents)}`,
  ].join(' · ')
}

export function carLoanPlanView(plan: CarLoanPlan): CarLoanView {
  const equalPayment = plan.mode === 'equal-payment'
  const monthlyText = money(carLoanPaymentCents(plan))
  const label = equalPayment ? '等额本息' : '等额本金'
  const summary = [
    `车贷（${label}）`,
    `车价 ${formatCents(plan.carPriceCents)} 元`,
    `首付 ${formatCents(plan.downPaymentCents)} 元`,
    `贷款 ${formatCents(plan.loanCents)} 元`,
    `${equalPayment ? '每月月供' : '首月月供'} ${monthlyText}`,
    `总利息 ${money(plan.interestCents)}`,
    `总还款 ${money(plan.totalCents)}`,
  ].join('；')
  const schedule = plan.schedule.map((row) => ({
    index: row.index,
    payment: money(row.paymentCents),
    principal: money(row.principalCents),
    interest: money(row.interestCents),
    balance: money(row.balanceCents),
  }))
  const resultLabel = equalPayment ? '每月月供' : '首月月供'
  return {
    resultLabel,
    resultMain: monthlyText,
    resultRows: [
      { k: '车价', v: money(plan.carPriceCents) },
      { k: '首付', v: money(plan.downPaymentCents) },
      { k: '贷款额', v: money(plan.loanCents) },
      { k: equalPayment ? '每月月供' : '首月月供', v: monthlyText },
      { k: '末月月供', v: money(plan.lastCents) },
      { k: '总利息', v: money(plan.interestCents) },
      { k: '总还款', v: money(plan.totalCents) },
      { k: '期数', v: `${plan.termMonths} 个月` },
    ],
    schedule,
    carloanSummary: summary,
    posterData: {
      toolName: '车贷计算',
      category: '计算换算',
      mainResult: monthlyText,
      resultLabel,
      params: [
        { label: '车价', value: money(plan.carPriceCents) },
        { label: '首付', value: money(plan.downPaymentCents) },
        { label: '期限', value: `${plan.termMonths} 个月` },
        { label: '还款方式', value: label },
      ],
      extras: [
        `贷款 ${money(plan.loanCents)}`,
        `总利息 ${money(plan.interestCents)}`,
        `总还款 ${money(plan.totalCents)}`,
      ],
    },
  }
}

export function carLoanCompareView(result: CarLoanCompareResult): CarLoanView {
  const a = result.schemeA
  const b = result.schemeB
  const diff = result.interestDiffCents
  const verdict =
    diff === 0
      ? '两方案总利息相同'
      : `方案 ${diff > 0 ? 'B' : 'A'} 省利息 ${money(Math.abs(diff))}`
  const monthDiff = result.monthlyDiffCents
  const bothEqualPayment = a.mode === 'equal-payment' && b.mode === 'equal-payment'
  const paymentWord = bothEqualPayment ? '月供' : '首月月供'
  const monthText =
    monthDiff === 0
      ? `两方案${paymentWord}相同`
      : monthDiff > 0
        ? `A 比 B 高 ${money(monthDiff)}`
        : `A 比 B 低 ${money(-monthDiff)}`
  const resultMain = money(carLoanPaymentCents(a))
  const resultLabel = bothEqualPayment ? '方案 A 月供' : '方案 A 首月'
  return {
    resultLabel,
    resultMain,
    resultRows: [
      { k: '方案 A', v: planDetail(a) },
      { k: '方案 B', v: planDetail(b) },
      { k: bothEqualPayment ? '月供对比' : '首月月供对比', v: monthText },
      { k: '利息对比', v: verdict },
      { k: '总还款 A / B', v: `${money(a.totalCents)} / ${money(b.totalCents)}` },
    ],
    schedule: [],
    carloanSummary: carLoanCompareSummary(result),
    posterData: {
      toolName: '车贷计算',
      category: '计算换算',
      mainResult: resultMain,
      resultLabel,
      params: [
        { label: '车价', value: money(a.carPriceCents) },
        { label: '方案 A', value: planDetail(a) },
        { label: '方案 B', value: planDetail(b) },
      ],
      extras: [verdict, `月供差 ${monthText}`],
    },
  }
}

export function carLoanPrepayView(result: CarLoanPrepayResult): CarLoanView {
  const main = money(result.newMonthlyPaymentCents)
  const plan = result.plan
  const label =
    plan.mode === 'equal-payment' ? '提前还款后月供' : '提前还款后首月'
  return {
    resultLabel: label,
    resultMain: main,
    resultRows: [
      { k: '原月供', v: money(result.monthlyPaymentCents) },
      { k: '新月供', v: main },
      { k: '每月少还', v: money(result.monthlySavedCents) },
      {
        k: '提前还款',
        v: `第 ${result.prepayAfterPeriod} 期后 ${money(result.prepayCents)}`,
      },
      {
        k: '剩余本金',
        v: `${money(result.remainingBeforeCents)} → ${money(result.remainingAfterCents)}`,
      },
      { k: '节省利息', v: money(result.savedInterestCents) },
      {
        k: '总利息',
        v: `${money(plan.interestCents)} → ${money(result.newInterestCents)}`,
      },
    ],
    schedule: [],
    carloanSummary: carLoanPrepaySummary(result),
    posterData: {
      toolName: '车贷计算',
      category: '计算换算',
      mainResult: main,
      resultLabel: label,
      params: [
        { label: '车价', value: money(plan.carPriceCents) },
        { label: '贷款', value: money(plan.loanCents) },
        {
          label: '提前还款',
          value: `第 ${result.prepayAfterPeriod} 期后 ${money(result.prepayCents)}`,
        },
      ],
      extras: [
        `节省利息 ${money(result.savedInterestCents)}`,
        `每月少还 ${money(result.monthlySavedCents)}`,
      ],
    },
  }
}

/** 车贷月供：首付按比例或金额解析后，直接委托 planLoan */
export function carLoanPlan(input: CarLoanInput): CarLoanPlan | null {
  const carPrice = roundHalfUp(Number(input.carPriceCents))
  if (!Number.isFinite(carPrice) || carPrice <= 0) {
    return null
  }

  let downPayment: number
  if (input.downPaymentPercent !== undefined && input.downPaymentPercent !== null) {
    const percent = Number(input.downPaymentPercent)
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      return null
    }
    downPayment = roundHalfUp((carPrice * percent) / 100)
  } else {
    downPayment = roundHalfUp(Number(input.downPaymentCents ?? 0))
  }
  if (!Number.isFinite(downPayment) || downPayment < 0 || downPayment >= carPrice) {
    return null
  }

  const termMonths = Number(input.termMonths)
  if (
    !Number.isInteger(termMonths) ||
    termMonths < 1 ||
    termMonths > CAR_LOAN_MAX_TERM ||
    termMonths > LOAN_MAX_PERIODS
  ) {
    return null
  }
  const annualRateBp = Number(input.annualRateBp)
  if (!Number.isFinite(annualRateBp) || annualRateBp < 0 || annualRateBp > LOAN_MAX_RATE_BP) {
    return null
  }

  const loanCents = carPrice - downPayment
  const plan = planLoan({
    principalCents: loanCents,
    annualRateBp,
    periods: termMonths,
    mode: input.mode,
    scheduleLimit: 12,
  })
  if (!plan) {
    return null
  }
  return {
    mode: plan.mode,
    carPriceCents: carPrice,
    downPaymentCents: downPayment,
    loanCents,
    termMonths,
    annualRateBp,
    monthlyCents: plan.monthlyCents,
    firstCents: plan.firstCents,
    lastCents: plan.lastCents,
    totalCents: plan.totalCents,
    interestCents: plan.interestCents,
    schedule: plan.schedule,
  }
}
