/* ==========================================================================
   个税计算 · 月度 / 年度综合所得试算
   - 金额全部转分；税率用整数百分比；结果 roundHalfUp 到分
   - 仅作试算，不构成税务建议
   ========================================================================== */
import { formatCents, parseCents, roundHalfUp } from '../../lib/money'
import { copyText } from '../../lib/ui'
import { tapTick } from '../../../../core/utils/haptics'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'

type TaxMode = 'monthly' | 'annual'

interface Bracket {
  minCents: number
  maxCents: number
  rate: number
  quickCents: number
  label: string
}

const MONTHLY_BRACKETS: Bracket[] = [
  { minCents: 0, maxCents: 300000, rate: 3, quickCents: 0, label: '不超过 3,000 元' },
  { minCents: 300000, maxCents: 1200000, rate: 10, quickCents: 21000, label: '3,000 至 12,000 元' },
  { minCents: 1200000, maxCents: 2500000, rate: 20, quickCents: 141000, label: '12,000 至 25,000 元' },
  { minCents: 2500000, maxCents: 3500000, rate: 25, quickCents: 266000, label: '25,000 至 35,000 元' },
  { minCents: 3500000, maxCents: 5500000, rate: 30, quickCents: 441000, label: '35,000 至 55,000 元' },
  { minCents: 5500000, maxCents: 8000000, rate: 35, quickCents: 716000, label: '55,000 至 80,000 元' },
  { minCents: 8000000, maxCents: Number.MAX_SAFE_INTEGER, rate: 45, quickCents: 1516000, label: '超过 80,000 元' },
]

const ANNUAL_BRACKETS: Bracket[] = [
  { minCents: 0, maxCents: 3600000, rate: 3, quickCents: 0, label: '不超过 36,000 元' },
  { minCents: 3600000, maxCents: 14400000, rate: 10, quickCents: 252000, label: '36,000 至 144,000 元' },
  { minCents: 14400000, maxCents: 30000000, rate: 20, quickCents: 1692000, label: '144,000 至 300,000 元' },
  { minCents: 30000000, maxCents: 42000000, rate: 25, quickCents: 3192000, label: '300,000 至 420,000 元' },
  { minCents: 42000000, maxCents: 66000000, rate: 30, quickCents: 5292000, label: '420,000 至 660,000 元' },
  { minCents: 66000000, maxCents: 96000000, rate: 35, quickCents: 8592000, label: '660,000 至 960,000 元' },
  { minCents: 96000000, maxCents: Number.MAX_SAFE_INTEGER, rate: 45, quickCents: 18192000, label: '超过 960,000 元' },
]

const MONTHLY_THRESHOLD = 500000
const ANNUAL_THRESHOLD = 6000000

Page({
  /* 此处是处理工具页分享与深链参数校验的边界 */
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: '个税计算',
    kicker: '计算换算',
    desc: '月度 / 年度综合所得试算',
    mode: 'monthly' as TaxMode,
    income: '',
    insurance: '',
    special: '',
    other: '',
    shellState: 'idle',
    hasResult: false,
    error: '',
    taxText: '',
    netText: '',
    taxableText: '',
    rateText: '',
    bracketLabel: '',
    quickText: '',
    bracketSteps: [0, 1, 2, 3, 4, 5, 6],
    bracketIndex: -1,
    taxValue: 0,
    copyPayload: '',
    posterData: null as IPosterData | null,
  },

  onMode(event: WechatMiniprogram.TouchEvent) {
    const mode = event.currentTarget.dataset.mode as TaxMode
    if (mode !== 'monthly' && mode !== 'annual') {
      return
    }
    if (mode === this.data.mode) {
      return
    }
    tapTick()
    this.setData({
      mode,
      income: '',
      insurance: '',
      special: '',
      other: '',
      shellState: 'idle',
      hasResult: false,
      error: '',
      taxText: '',
      netText: '',
      taxableText: '',
      rateText: '',
      bracketLabel: '',
      quickText: '',
      bracketIndex: -1,
      taxValue: 0,
    })
  },

  onInput(event: WechatMiniprogram.Input) {
    const field = event.currentTarget.dataset.field as
      | 'income'
      | 'insurance'
      | 'special'
      | 'other'
    if (!field) {
      return
    }
    this.setData({ [field]: event.detail.value, error: '' })
  },

  onExample() {
    tapTick()
    this.setData(
      { mode: 'monthly', income: '15000', insurance: '2000', special: '1000', other: '0' },
      () => {
        this.compute()
      },
    )
  },

  onReset() {
    this.setData({
      income: '',
      insurance: '',
      special: '',
      other: '',
      shellState: 'idle',
      hasResult: false,
      error: '',
      taxText: '',
      netText: '',
      taxableText: '',
      rateText: '',
      bracketLabel: '',
      quickText: '',
      bracketIndex: -1,
      taxValue: 0,
    })
  },

  onRun() {
    this.compute()
  },

  onCopy() {
    copyText(this.data.copyPayload, '个税试算结果已复制')
  },

  compute() {
    const monthly = this.data.mode === 'monthly'
    const income = parseCents(this.data.income)
    if (income === null || income <= 0) {
      this.setData({ shellState: 'invalid', hasResult: false, error: '请输入大于 0 的收入金额，最多两位小数' })
      return
    }

    let insurance = 0
    let special = 0
    let other = 0
    if (this.data.insurance.trim()) {
      const parsed = parseCents(this.data.insurance)
      if (parsed === null) {
        this.setData({ shellState: 'invalid', hasResult: false, error: '五险一金金额格式不正确' })
        return
      }
      insurance = parsed
    }
    if (this.data.special.trim()) {
      const parsed = parseCents(this.data.special)
      if (parsed === null) {
        this.setData({ shellState: 'invalid', hasResult: false, error: '专项附加扣除格式不正确' })
        return
      }
      special = parsed
    }
    if (this.data.other.trim()) {
      const parsed = parseCents(this.data.other)
      if (parsed === null) {
        this.setData({ shellState: 'invalid', hasResult: false, error: '其他扣除格式不正确' })
        return
      }
      other = parsed
    }
    if (insurance > income) {
      this.setData({ shellState: 'invalid', hasResult: false, error: '五险一金不应高于收入' })
      return
    }

    const threshold = monthly ? MONTHLY_THRESHOLD : ANNUAL_THRESHOLD
    const taxable = Math.max(0, income - insurance - special - other - threshold)
    const brackets = monthly ? MONTHLY_BRACKETS : ANNUAL_BRACKETS
    const bracket =
      brackets.find((item) => taxable <= item.maxCents) ?? brackets[brackets.length - 1]
    const tax = Math.max(0, roundHalfUp(taxable * bracket.rate / 100) - bracket.quickCents)
    const net = income - insurance - tax
    const rate = income > 0 ? (tax / income) * 100 : 0

    const taxText = `¥${formatCents(tax)}`
    const netText = `¥${formatCents(net)}`
    const taxableText = `¥${formatCents(taxable)}`
    const rateText = `${rate.toFixed(2)}%`
    const bracketLabel = taxable === 0 ? '未达起征点' : bracket.label
    const bracketIndex = taxable === 0 ? -1 : brackets.indexOf(bracket)
    const quickText = taxable === 0 ? '—' : `¥${formatCents(bracket.quickCents)}`
    const copy = [
      monthly ? '月度个税试算' : '年度个税试算',
      `应纳税所得额：${taxableText}`,
      `应纳税额：${taxText}`,
      monthly ? `税后收入：${netText}` : `税后年收入：${netText}`,
      `实际税率：${rateText}`,
    ].join('\n')
    const poster: IPosterData = {
      toolName: '个税计算',
      category: '财务计算',
      mainResult: taxText,
      resultLabel: monthly ? '本月应缴税额' : '本年应缴税额',
      params: [
        { label: monthly ? '月收入' : '年收入', value: `¥${formatCents(income)}` },
        { label: '五险一金', value: `¥${formatCents(insurance)}` },
        { label: '专项附加', value: `¥${formatCents(special)}` },
        { label: '其他扣除', value: `¥${formatCents(other)}` },
      ],
      extras: [
        `税后到手 ${netText}`,
        `实际税率 ${rateText}`,
        `全年纳税约 ¥${formatCents(monthly ? tax * 12 : tax)}`,
        `适用级距 ${bracketLabel}`,
      ],
    }

    this.setData({
      shellState: 'done',
      hasResult: true,
      error: '',
      taxText,
      netText,
      taxableText,
      rateText,
      bracketLabel,
      bracketIndex,
      quickText,
      taxValue: tax / 100,
      copyPayload: copy,
      posterData: poster,
    })
  },
})
