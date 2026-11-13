/* ==========================================================================
   BMI · 中国成人标准区间
   - BMI = 体重 / 身高²；区间标准仅作参考
   - 不构成医疗建议
   ========================================================================== */
import { parseDecimal } from '../../lib/money'
import {
  bmiCategory,
  bmiMarkerPercent,
  bmiOf,
  idealWeightRange,
} from '../../lib/body-engine'
import { copyText } from '../../lib/ui'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'

Page({
  /* 此处是处理工具页分享与深链参数校验的边界 */
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: 'BMI 指数',
    kicker: '生活健康',
    desc: '身体质量指数与区间提示',
    height: '',
    weight: '',
    shellState: 'idle',
    hasResult: false,
    error: '',
    bmiValue: 0,
    categoryText: '',
    categoryHint: '',
    idealText: '',
    markerPercent: 0,
    copyPayload: '',
    posterData: null as IPosterData | null,
  },

  onInput(event: WechatMiniprogram.Input) {
    const field = event.currentTarget.dataset.field as 'height' | 'weight'
    if (!field) {
      return
    }
    this.setData({ [field]: event.detail.value, error: '' })
  },

  onExample() {
    this.setData({ height: '175', weight: '70' }, () => {
      this.compute()
    })
  },

  onReset() {
    this.setData({
      height: '',
      weight: '',
      shellState: 'idle',
      hasResult: false,
      error: '',
      bmiValue: 0,
      categoryText: '',
      categoryHint: '',
      idealText: '',
      markerPercent: 0,
    })
  },

  onRun() {
    this.compute()
  },

  onCopy() {
    copyText(this.data.copyPayload, 'BMI 结果已复制')
  },

  compute() {
    const height = parseDecimal(this.data.height, 100, 250, 1)
    if (height === null) {
      this.setData({ shellState: 'invalid', hasResult: false, error: '身高需在 100–250 厘米之间' })
      return
    }
    const weight = parseDecimal(this.data.weight, 20, 300, 1)
    if (weight === null) {
      this.setData({ shellState: 'invalid', hasResult: false, error: '体重需在 20–300 公斤之间' })
      return
    }

    const bmi = bmiOf(height, weight)
    if (bmi === null) {
      this.setData({ shellState: 'invalid', hasResult: false, error: '身高或体重数值无效' })
      return
    }
    const bmiText = bmi.toFixed(1)
    const category = bmiCategory(bmi)
    const categoryText = category.label
    const categoryHint = category.hint
    const ideal = idealWeightRange(height)
    const idealText = ideal ? `${ideal.minKg.toFixed(1)} – ${ideal.maxKg.toFixed(1)} kg` : '—'
    const markerPercent = bmiMarkerPercent(bmi)
    const copy = [
      'BMI 试算',
      `身高：${height} cm`,
      `体重：${weight} kg`,
      `BMI：${bmiText}（${categoryText}）`,
      `参考体重区间：${idealText}`,
      '结果仅供参考，不构成医疗建议。',
    ].join('\n')
    const poster: IPosterData = {
      toolName: 'BMI 指数',
      category: '生活健康',
      mainResult: bmiText,
      resultLabel: 'BMI 指数',
      params: [
        { label: '身高', value: `${height} cm` },
        { label: '体重', value: `${weight} kg` },
      ],
      extras: [
        `体型分类 ${categoryText}`,
        `参考体重 ${idealText}`,
        '健康区间 18.5 – 23.9',
      ],
    }

    this.setData({
      shellState: 'done',
      hasResult: true,
      error: '',
      bmiValue: bmi,
      categoryText,
      categoryHint,
      idealText,
      markerPercent,
      copyPayload: copy,
      posterData: poster,
    })
  },
})
