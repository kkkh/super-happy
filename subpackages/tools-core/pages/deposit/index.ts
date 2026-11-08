/* ==========================================================================
   存款复利 · 本息终值
   - A = P × (1 + r/n)^(n×t)，本金按分计算，结果四舍五入到分
   - 支持按年 / 按季 / 按月复利
   ========================================================================== */
import {
  formatCents,
  formatNumber,
  parseBasisPoints,
  parseCents,
  parseInteger,
  roundHalfUp,
} from '../../lib/money'
import { copyText } from '../../lib/ui'
import { tapTick } from '../../../../core/utils/haptics'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'

type Frequency = 'year' | 'quarter' | 'month'

const FREQUENCIES: { key: Frequency; label: string; times: number }[] = [
  { key: 'year', label: '按年', times: 1 },
  { key: 'quarter', label: '按季', times: 4 },
  { key: 'month', label: '按月', times: 12 },
]

Page({
  /* 此处是处理工具页分享与深链参数校验的边界 */
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: '存款复利',
    kicker: '计算换算',
    desc: '本金、利率与复利终值',
    principal: '',
    rate: '',
    years: '',
    frequency: 'year' as Frequency,
    frequencies: FREQUENCIES,
    shellState: 'idle',
    hasResult: false,
    error: '',
    totalText: '',
    totalValue: 0,
    interestText: '',
    principalText: '',
    annualYieldText: '',
    timesText: '',
    copyPayload: '',
    posterData: null as IPosterData | null,
  },

  onFrequency(event: WechatMiniprogram.TouchEvent) {
    const frequency = event.currentTarget.dataset.key as Frequency
    if (!FREQUENCIES.some((item) => item.key === frequency)) {
      return
    }
    if (frequency === this.data.frequency) {
      return
    }
    tapTick()
    this.setData({
      frequency,
      shellState: 'idle',
      hasResult: false,
      error: '',
      totalText: '',
      totalValue: 0,
      interestText: '',
      principalText: '',
      annualYieldText: '',
      timesText: '',
    })
  },

  onInput(event: WechatMiniprogram.Input) {
    const field = event.currentTarget.dataset.field as 'principal' | 'rate' | 'years'
    if (!field) {
      return
    }
    this.setData({ [field]: event.detail.value, error: '' })
  },

  onExample() {
    tapTick()
    this.setData({ principal: '10000', rate: '3', years: '3', frequency: 'year' }, () => {
      this.compute()
    })
  },

  onReset() {
    this.setData({
      principal: '',
      rate: '',
      years: '',
      shellState: 'idle',
      hasResult: false,
      error: '',
      totalText: '',
      totalValue: 0,
      interestText: '',
      principalText: '',
      annualYieldText: '',
      timesText: '',
    })
  },

  onRun() {
    this.compute()
  },

  onCopy() {
    copyText(this.data.copyPayload, '复利试算结果已复制')
  },

  compute() {
    const principal = parseCents(this.data.principal)
    if (principal === null || principal <= 0) {
      this.setData({ shellState: 'invalid', hasResult: false, error: '请输入大于 0 的本金，最多两位小数' })
      return
    }
    const bp = parseBasisPoints(this.data.rate)
    if (bp === null || bp > 2400) {
      this.setData({ shellState: 'invalid', hasResult: false, error: '年利率需在 0–24% 之间' })
      return
    }
    const years = parseInteger(this.data.years, 1, 50)
    if (years === null) {
      this.setData({ shellState: 'invalid', hasResult: false, error: '存款年限需为 1–50 年的整数' })
      return
    }

    const frequency = FREQUENCIES.find((item) => item.key === this.data.frequency) ?? FREQUENCIES[0]
    const rate = bp / 10000
    const periods = frequency.times * years
    const factor = Math.pow(1 + rate / frequency.times, periods)
    const total = roundHalfUp(principal * factor)
    const interest = total - principal
    const annualYield = years > 0 ? (Math.pow(total / principal, 1 / years) - 1) * 100 : 0

    const totalText = `¥${formatCents(total)}`
    const interestText = `¥${formatCents(interest)}`
    const principalText = `¥${formatCents(principal)}`
    const annualYieldText = `${annualYield.toFixed(2)}%`
    const timesText = `${periods} 次`
    const copy = [
      '存款复利试算',
      `本金：¥${formatCents(principal)}`,
      `年利率：${formatNumber(bp / 100, 2)}%`,
      `期限：${years} 年 · ${frequency.label}复利`,
      `本息合计：${totalText}`,
      `利息：${interestText}`,
    ].join('\n')
    const poster: IPosterData = {
      toolName: '存款复利',
      category: '财务计算',
      mainResult: totalText,
      resultLabel: '本息合计',
      params: [
        { label: '本金', value: principalText },
        { label: '年利率', value: `${formatNumber(bp / 100, 2)}%` },
        { label: '存款年限', value: `${years} 年 · ${timesText}` },
        { label: '复利方式', value: `${frequency.label}复利` },
      ],
      extras: [
        `利息 ${interestText}`,
        `折合年化 ${annualYieldText}`,
        `复利计息 ${timesText}`,
      ],
    }

    this.setData({
      shellState: 'done',
      hasResult: true,
      error: '',
      totalText,
      totalValue: total / 100,
      interestText,
      principalText,
      annualYieldText,
      timesText,
      copyPayload: copy,
      posterData: poster,
    })
  },
})
