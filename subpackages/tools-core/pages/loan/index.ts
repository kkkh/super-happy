/* ==========================================================================
   房贷试算 · 等额本息 / 等额本金
   - 本金按「万元」输入并转分；年利率转基点；月利率 = 基点 / 10000 / 12
   - 展示月供、总利息、总还款与前 12 期明细
   ========================================================================== */
import {
  formatCents,
  formatNumber,
  parseBasisPoints,
  parseDecimal,
  parseInteger,
  roundHalfUp,
} from '../../lib/money'
import { planLoan } from '../../../../core/toolbox/engines/loan'
import { copyText } from '../../lib/ui'
import { tapTick } from '../../../../core/utils/haptics'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'

type LoanMode = 'equal-payment' | 'equal-principal'

interface ScheduleRow {
  index: number
  payment: string
  principal: string
  interest: string
  balance: string
}

Page({
  /* 此处是处理工具页分享与深链参数校验的边界 */
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: '房贷试算',
    kicker: '计算换算',
    desc: '等额本息 / 等额本金',
    mode: 'equal-payment' as LoanMode,
    principal: '',
    rate: '',
    years: '',
    shellState: 'idle',
    hasResult: false,
    error: '',
    monthlyText: '',
    monthlyValue: 0,
    interestText: '',
    totalText: '',
    firstText: '',
    lastText: '',
    periodsText: '',
    schedule: [] as ScheduleRow[],
    scheduleShow: false,
    copyPayload: '',
    posterData: null as IPosterData | null,
  },

  onMode(event: WechatMiniprogram.TouchEvent) {
    const mode = event.currentTarget.dataset.mode as LoanMode
    if (mode !== 'equal-payment' && mode !== 'equal-principal') {
      return
    }
    if (mode === this.data.mode) {
      return
    }
    tapTick()
    this.setData({
      mode,
      shellState: 'idle',
      hasResult: false,
      error: '',
      monthlyText: '',
      monthlyValue: 0,
      interestText: '',
      totalText: '',
      firstText: '',
      lastText: '',
      periodsText: '',
      schedule: [],
      scheduleShow: false,
    })
  },

  onInput(event: WechatMiniprogram.Input) {
    const field = event.currentTarget.dataset.field as 'principal' | 'rate' | 'years'
    if (!field) {
      return
    }
    this.setData({ [field]: event.detail.value, error: '' })
  },

  onToggleSchedule() {
    if (!this.data.hasResult) {
      return
    }
    tapTick()
    this.setData({ scheduleShow: !this.data.scheduleShow })
  },

  onExample() {
    tapTick()
    this.setData(
      { mode: 'equal-payment', principal: '100', rate: '3.5', years: '30' },
      () => {
        this.compute()
      },
    )
  },

  onReset() {
    this.setData({
      principal: '',
      rate: '',
      years: '',
      shellState: 'idle',
      hasResult: false,
      error: '',
      monthlyText: '',
      monthlyValue: 0,
      interestText: '',
      totalText: '',
      firstText: '',
      lastText: '',
      periodsText: '',
      schedule: [],
      scheduleShow: false,
    })
  },

  onRun() {
    this.compute()
  },

  onCopy() {
    copyText(this.data.copyPayload, '房贷试算结果已复制')
  },

  compute() {
    const principalWan = parseDecimal(this.data.principal, 0.01, 10000, 4)
    if (principalWan === null) {
      this.setData({ shellState: 'invalid', hasResult: false, error: '贷款金额需在 0.01–10,000 万元之间' })
      return
    }
    const bp = parseBasisPoints(this.data.rate)
    if (bp === null || bp > 2400) {
      this.setData({ shellState: 'invalid', hasResult: false, error: '年利率需在 0–24% 之间，最多两位小数' })
      return
    }
    const years = parseInteger(this.data.years, 1, 50)
    if (years === null) {
      this.setData({ shellState: 'invalid', hasResult: false, error: '贷款年限需为 1–50 年的整数' })
      return
    }

    const principalCents = roundHalfUp(principalWan * 10000 * 100)
    const periods = years * 12
    const equalPayment = this.data.mode === 'equal-payment'
    const plan = planLoan({
      principalCents,
      annualRateBp: bp,
      periods,
      mode: this.data.mode,
      scheduleLimit: 12,
    })
    if (!plan) {
      this.setData({ shellState: 'invalid', hasResult: false, error: '贷款参数无效，请检查金额、利率与期限' })
      return
    }

    const { totalCents, interestCents, firstCents, lastCents } = plan
    const schedule: ScheduleRow[] = plan.schedule.map((row) => ({
      index: row.index,
      payment: `¥${formatCents(row.paymentCents)}`,
      principal: `¥${formatCents(row.principalCents)}`,
      interest: `¥${formatCents(row.interestCents)}`,
      balance: `¥${formatCents(row.balanceCents)}`,
    }))

    const interestText = `¥${formatCents(interestCents)}`
    const totalText = `¥${formatCents(totalCents)}`
    const monthlyText = `¥${formatCents(plan.monthlyCents || firstCents)}`
    const firstText = `¥${formatCents(firstCents)}`
    const lastText = `¥${formatCents(lastCents)}`
    const periodsText = `${periods} 期`
    const modeLabel = equalPayment ? '等额本息' : '等额本金'
    const copy = [
      `房贷试算（${modeLabel}）`,
      `贷款金额：${formatNumber(principalWan, 2)} 万元`,
      `年利率：${formatNumber(bp / 100, 2)}%`,
      `期限：${years} 年（${periods} 期）`,
      equalPayment ? `每月月供：${monthlyText}` : `首月月供：${firstText}`,
      `总利息：${interestText}`,
      `总还款：${totalText}`,
    ].join('\n')
    const poster: IPosterData = {
      toolName: '房贷试算',
      category: '财务计算',
      mainResult: monthlyText,
      resultLabel: equalPayment ? '每月月供' : '首月月供',
      params: [
        { label: '贷款金额', value: `${formatNumber(principalWan, 2)} 万元` },
        { label: '年利率', value: `${formatNumber(bp / 100, 2)}%` },
        { label: '贷款年限', value: `${years} 年 · ${periods} 期` },
        { label: '还款方式', value: modeLabel },
      ],
      extras: [
        `总利息 ${interestText}`,
        `利息占比 ${((interestCents / Math.max(1, totalCents)) * 100).toFixed(1)}%`,
        `总还款 ${totalText}`,
      ],
    }

    this.setData({
      shellState: 'done',
      hasResult: true,
      error: '',
      monthlyText,
      monthlyValue: (plan.monthlyCents || firstCents) / 100,
      interestText,
      totalText,
      firstText,
      lastText,
      periodsText,
      schedule,
      copyPayload: copy,
      posterData: poster,
    })
  },
})
