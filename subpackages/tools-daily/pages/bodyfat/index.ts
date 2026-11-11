/* ==========================================================================
   体脂率 · 美国海军围度公式
   - 男性：腰 − 颈；女性：腰 + 臀 − 颈；全部厘米
   - 结果夹在 0–100%，<3% 或 >60% 提示复核围度
   - 结果仅供参考，不构成医疗建议
   ========================================================================== */
import { tapTick } from '../../../../core/utils/haptics'
import { parseDecimal } from '../../../../core/toolbox/engines/money'
import {
  navyBodyFat,
  type BodyFatGender,
} from '../../lib/bodyfat'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'
import { copyText } from '../../lib/ui'

interface ResultRow {
  k: string
  v: string
}

Page({
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: '体脂率',
    kicker: '生活健康',
    desc: '海军围度公式 · 区间参考',
    gender: 'male' as BodyFatGender,
    height: '',
    weight: '',
    neck: '',
    waist: '',
    hip: '',
    isFemale: false,
    percentText: '',
    categoryText: '',
    categoryHint: '',
    reviewText: '',
    bodyfatSummary: '',
    resultRows: [] as ResultRow[],
    hasResult: false,
    shellState: 'idle',
    error: '',
    posterData: null as IPosterData | null,
    formTouched: false,
  },

  onGender(event: WechatMiniprogram.TouchEvent) {
    const gender = event.currentTarget.dataset.gender as BodyFatGender
    if (gender !== 'male' && gender !== 'female') {
      return
    }
    if (gender === this.data.gender) {
      return
    }
    tapTick()
    this.setData({
      gender,
      isFemale: gender === 'female',
      hasResult: false,
      shellState: 'idle',
      error: '',
      percentText: '',
      categoryText: '',
      categoryHint: '',
      reviewText: '',
      bodyfatSummary: '',
      resultRows: [],
      posterData: null,
    })
  },

  onInput(event: WechatMiniprogram.Input) {
    const field = String(event.currentTarget.dataset.field || '')
    if (field !== 'height' && field !== 'weight' && field !== 'neck' && field !== 'waist' && field !== 'hip') {
      return
    }
    this.setData({ [field]: event.detail.value, error: '' })
  },

  onExample() {
    tapTick()
    this.setData(
      {
        gender: 'male',
        isFemale: false,
        height: '175',
        weight: '70',
        neck: '38',
        waist: '85',
        hip: '',
        formTouched: true,
        error: '',
      },
      () => {
        this.compute()
      },
    )
  },

  onReset() {
    this.setData({
      gender: 'male',
      isFemale: false,
      height: '',
      weight: '',
      neck: '',
      waist: '',
      hip: '',
      percentText: '',
      categoryText: '',
      categoryHint: '',
      reviewText: '',
      bodyfatSummary: '',
      resultRows: [],
      hasResult: false,
      shellState: 'idle',
      error: '',
      posterData: null,
      formTouched: false,
    })
  },

  onRun() {
    this.compute()
  },

  onCopy() {
    if (!this.data.hasResult) {
      return
    }
    copyText(this.buildCopy(), '体脂率结果已复制')
  },

  compute() {
    const heightCm = parseDecimal(this.data.height, 100, 250, 1)
    if (heightCm === null) {
      this.invalidate('身高需在 100–250 厘米之间')
      return
    }
    const weightKg = parseDecimal(this.data.weight, 20, 300, 1)
    if (weightKg === null) {
      this.invalidate('体重需在 20–300 公斤之间')
      return
    }
    const neckCm = parseDecimal(this.data.neck, 10, 100, 1)
    if (neckCm === null) {
      this.invalidate('颈围需在 10–100 厘米之间')
      return
    }
    const waistCm = parseDecimal(this.data.waist, 30, 200, 1)
    if (waistCm === null) {
      this.invalidate('腰围需在 30–200 厘米之间')
      return
    }
    const female = this.data.gender === 'female'
    let hipCm: number | undefined
    if (female) {
      const parsedHip = parseDecimal(this.data.hip, 30, 200, 1)
      if (parsedHip === null) {
        this.invalidate('女性需填写 30–200 厘米的臀围')
        return
      }
      hipCm = parsedHip
      if (waistCm + parsedHip - neckCm <= 0) {
        this.invalidate('腰围 + 臀围需大于颈围，请复核围度')
        return
      }
    } else if (waistCm - neckCm <= 0) {
      this.invalidate('腰围需大于颈围，请复核围度')
      return
    }

    const result = navyBodyFat({
      gender: this.data.gender,
      heightCm,
      weightKg,
      neckCm,
      waistCm,
      hipCm,
    })
    if (!result) {
      this.invalidate('围度组合无法计算，请复核输入')
      return
    }

    const percentText = `${result.percent.toFixed(1)}%`
    const resultRows: ResultRow[] = [
      { k: '区间', v: result.category.label },
      { k: '脂肪重量', v: `${result.fatMassKg.toFixed(1)} kg` },
      { k: '去脂体重', v: `${result.leanMassKg.toFixed(1)} kg` },
    ]
    const reviewText = result.needsReview
      ? '结果低于 3% 或高于 60%，请复核颈围、腰围与臀围是否测量有误。'
      : ''
    const poster: IPosterData = {
      toolName: '体脂率',
      category: '生活健康',
      mainResult: percentText,
      resultLabel: '体脂率',
      params: [
        { label: '性别', value: female ? '女' : '男' },
        { label: '身高 / 体重', value: `${heightCm} cm / ${weightKg} kg` },
      ],
      extras: [
        `区间 ${result.category.label}`,
        `脂肪重量 ${result.fatMassKg.toFixed(1)} kg`,
        `去脂体重 ${result.leanMassKg.toFixed(1)} kg`,
      ],
    }

    this.setData({
      shellState: 'done',
      hasResult: true,
      error: '',
      percentText,
      categoryText: result.category.label,
      categoryHint: result.category.hint,
      reviewText,
      bodyfatSummary: `体脂率 ${percentText}（${result.category.label}）`,
      resultRows,
      posterData: poster,
      formTouched: true,
    })
  },

  invalidate(message: string) {
    this.setData({
      shellState: 'invalid',
      hasResult: false,
      error: message,
      percentText: '',
      categoryText: '',
      categoryHint: '',
      reviewText: '',
      bodyfatSummary: '',
      resultRows: [],
      posterData: null,
    })
  },

  buildCopy(): string {
    const lines = [
      '体脂率试算',
      `性别：${this.data.gender === 'female' ? '女' : '男'}`,
      `体脂率：${this.data.percentText}（${this.data.categoryText}）`,
      ...this.data.resultRows.map((row) => `${row.k}：${row.v}`),
    ]
    if (this.data.reviewText) {
      lines.push(this.data.reviewText)
    }
    lines.push('结果仅供参考，不构成医疗建议。')
    return lines.join('\n')
  },
})
