/* ==========================================================================
   水电燃气费 · 电费（功率 × 时长）/ 水费 / 燃气费（用量 × 费率表）
   - 电费：总电量 = 功率 ÷ 1000 × 每日时长 × 天数
   - 水费 / 燃气费：用量 × 单价 + 基础费，支持最多 3 档阶梯费率
   ========================================================================== */
import { tapTick } from '../../../../core/utils/haptics'
import {
  MAX_POWER_TIERS,
  powerBill,
  powerSummaryText,
  utilityBill,
  utilitySummaryText,
  type PowerResult,
  type PowerTier,
  type UtilityKind,
  type UtilityResult,
} from '../../lib/power'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'
import type { IWorkflowData } from '../../../../core/workflow/types'
import { copyText } from '../../lib/ui'
import { collectPowerDraft, powerDraftPatch } from '../../lib/draft'
import { MODE_COPY, emptyInputs, type PowerMode } from '../../lib/power-ui'

interface ResultRow {
  k: string
  v: string
}

interface TierRow {
  range: string
  detail: string
}

interface PowerState {
  destroyed: boolean
}

const MODES: Array<{ key: PowerMode; label: string }> = [
  { key: 'electric', label: '电费' },
  { key: 'water', label: '水费' },
  { key: 'gas', label: '燃气' },
]

interface TierInput {
  limit: string
  price: string
}

const TIER_FIELDS: Array<{ limit: keyof PowerData; price: keyof PowerData }> = [
  { limit: 'tier1Limit', price: 'tier1Price' },
  { limit: 'tier2Limit', price: 'tier2Price' },
  { limit: 'tier3Limit', price: 'tier3Price' },
]

interface PowerData {
  tier1Limit: string
  tier1Price: string
  tier2Limit: string
  tier2Price: string
  tier3Limit: string
  tier3Price: string
}

function parseTiers(data: PowerData): { tiers: PowerTier[]; error: string } {
  const inputs: TierInput[] = TIER_FIELDS.map((fields) => ({
    limit: String(data[fields.limit] ?? '').trim(),
    price: String(data[fields.price] ?? '').trim(),
  }))
  const active = inputs.filter((row) => row.limit !== '' || row.price !== '')
  if (active.length === 0) {
    return { tiers: [], error: '' }
  }
  if (active.length > MAX_POWER_TIERS) {
    return { tiers: [], error: `阶梯最多 ${MAX_POWER_TIERS} 档` }
  }
  const tiers: PowerTier[] = []
  let unlimitedSeen = false
  for (let index = 0; index < inputs.length; index += 1) {
    const row = inputs[index]
    if (row.limit === '' && row.price === '') {
      continue
    }
    if (unlimitedSeen) {
      return { tiers: [], error: '无上限档只能放在最后一档' }
    }
    const price = Number(row.price)
    if (row.price === '' || !Number.isFinite(price) || price < 0) {
      return { tiers: [], error: `第 ${index + 1} 档单价需为大于等于 0 的数字` }
    }
    if (row.limit === '') {
      unlimitedSeen = true
      tiers.push({ limitKwh: null, pricePerKwh: price })
      continue
    }
    const limit = Number(row.limit)
    if (!Number.isFinite(limit) || limit <= 0) {
      return { tiers: [], error: `第 ${index + 1} 档上限需为大于 0 的用量` }
    }
    tiers.push({ limitKwh: limit, pricePerKwh: price })
  }
  return { tiers, error: '' }
}

function tierRows(result: PowerResult): TierRow[] {
  return result.slices.map((slice) => ({
    range: `${slice.fromKwh}–${slice.toKwh} 度`,
    detail: `${slice.kwh} 度 × ${slice.pricePerKwh} 元 = ${slice.cost.toFixed(2)} 元`,
  }))
}

function utilityTierRows(result: UtilityResult, unit: string): TierRow[] {
  return result.slices.map((slice) => ({
    range: `${slice.from}–${slice.to} ${unit}`,
    detail: `${slice.amount} ${unit} × ${slice.pricePerUnit} 元 = ${slice.cost.toFixed(2)} 元`,
  }))
}

function emptyResult() {
  return {
    resultLabel: '总电量',
    resultMain: '',
    resultRows: [] as ResultRow[],
    tierRows: [] as TierRow[],
    powerSummary: '',
    hasTiers: false,
    aboveHighest: false,
    shellState: 'idle',
    hasResult: false,
    error: '',
    posterData: null as IPosterData | null,
    formTouched: false,
  }
}

Page({
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: '水电燃气费',
    kicker: '计算换算',
    desc: '电费 · 水费 · 燃气 · 平价 / 阶梯费率',
    mode: 'electric' as PowerMode,
    modes: MODES,
    ...MODE_COPY.electric,
    ...emptyInputs(),
    ...emptyResult(),
  },

  onLoad() {
    const state = this as unknown as PowerState
    state.destroyed = false
  },

  onUnload() {
    const state = this as unknown as PowerState
    state.destroyed = true
  },

  onMode(event: WechatMiniprogram.TouchEvent) {
    const mode = event.currentTarget.dataset.mode as PowerMode
    if (!MODES.some((item) => item.key === mode) || mode === this.data.mode) {
      return
    }
    tapTick()
    this.setData({
      ...emptyInputs(),
      ...emptyResult(),
      ...MODE_COPY[mode],
      mode,
    })
  },

  onFieldInput(event: WechatMiniprogram.Input) {
    const field = String(event.currentTarget.dataset.field || '')
    const value = String(event.detail.value ?? '')
    if (
      field === 'powerText' ||
      field === 'hoursText' ||
      field === 'daysText' ||
      field === 'usageText' ||
      field === 'baseFeeText' ||
      field === 'priceText' ||
      field === 'tier1Limit' ||
      field === 'tier1Price' ||
      field === 'tier2Limit' ||
      field === 'tier2Price' ||
      field === 'tier3Limit' ||
      field === 'tier3Price'
    ) {
      this.setData({ [field]: value, formTouched: true, error: '' })
    }
  },

  onExample() {
    tapTick()
    if (this.data.mode === 'water') {
      this.setData(
        {
          usageText: '10',
          baseFeeText: '5',
          priceText: '3.5',
          tier1Limit: '',
          tier1Price: '',
          tier2Limit: '',
          tier2Price: '',
          tier3Limit: '',
          tier3Price: '',
          formTouched: true,
          error: '',
        },
        () => this.onRun(),
      )
      return
    }
    if (this.data.mode === 'gas') {
      this.setData(
        {
          usageText: '8',
          baseFeeText: '0',
          priceText: '2.8',
          tier1Limit: '',
          tier1Price: '',
          tier2Limit: '',
          tier2Price: '',
          tier3Limit: '',
          tier3Price: '',
          formTouched: true,
          error: '',
        },
        () => this.onRun(),
      )
      return
    }
    this.setData(
      {
        powerText: '1000',
        hoursText: '1',
        daysText: '30',
        priceText: '0.6',
        tier1Limit: '',
        tier1Price: '',
        tier2Limit: '',
        tier2Price: '',
        tier3Limit: '',
        tier3Price: '',
        formTouched: true,
        error: '',
      },
      () => this.onRun(),
    )
  },

  onReset() {
    this.setData({
      ...emptyInputs(),
      ...emptyResult(),
      ...MODE_COPY[this.data.mode],
    })
  },

  /* ---- 草稿：模式 + 全部输入；恢复后重新估算 ---- */
  draftMode(): string {
    return this.data.mode
  },

  collectDraftInput(): Record<string, string> {
    return collectPowerDraft(this.data)
  },

  applyDraftInput(input: Record<string, string>, mode: string): void {
    const patch = powerDraftPatch(input, mode)
    this.setData(
      {
        ...emptyInputs(),
        ...emptyResult(),
        ...MODE_COPY[patch.mode],
        ...patch.fields,
        mode: patch.mode,
        formTouched: true,
      },
      () => {
        this.onRun()
      },
    )
  },

  onRun() {
    if (this.data.mode !== 'electric') {
      this.runUtility()
      return
    }
    this.runElectric()
  },

  runElectric() {
    const state = this as unknown as PowerState
    if (state.destroyed) {
      return
    }
    const powerW = Number(this.data.powerText)
    const hoursPerDay = Number(this.data.hoursText)
    const days = Number(this.data.daysText)
    if (!powerW || !hoursPerDay || !days) {
      this.fail('请填写大于 0 的功率、每日时长与天数')
      return
    }

    const parsed = parseTiers(this.data as unknown as PowerData)
    if (parsed.error) {
      this.fail(parsed.error)
      return
    }

    const priceText = String(this.data.priceText).trim()
    const flatPrice = priceText === '' ? null : Number(priceText)
    if (priceText !== '' && (!Number.isFinite(flatPrice) || (flatPrice as number) < 0)) {
      this.fail('电价需为大于等于 0 的数字，或留空')
      return
    }

    const result = powerBill({
      powerW,
      hoursPerDay,
      days,
      pricePerKwh: flatPrice,
      tiers: parsed.tiers.length > 0 ? parsed.tiers : undefined,
    })
    if (!result) {
      this.fail('阶梯上限需严格递增，且功率、时长、天数为大于 0 的数字')
      return
    }

    const rows: ResultRow[] = [
      {
        k: '电费',
        v: result.totalCost === null ? '未填电价' : `${result.totalCost.toFixed(2)} 元`,
      },
      { k: '日均用电', v: `${result.averageDailyKwh.toFixed(2)} 度` },
      {
        k: '计价方式',
        v: result.mode === 'tier' ? `阶梯电价（${result.slices.length} 段）` : '平价电价',
      },
    ]
    const slices = tierRows(result)
    const summary = powerSummaryText(result)
    const poster: IPosterData = {
      toolName: '水电燃气费',
      category: '计算换算',
      mainResult: `${result.totalKwh.toFixed(2)} 度`,
      resultLabel: '总电量',
      params: [
        { label: '功率', value: `${powerW} W` },
        { label: '时长', value: `${hoursPerDay} h/天 × ${days} 天` },
      ],
      extras: [
        result.totalCost === null ? '未填电价' : `电费 ${result.totalCost.toFixed(2)} 元`,
        result.mode === 'tier' ? '阶梯计价' : '平价计价',
        result.aboveHighest ? '超出最高档' : '',
      ].filter(Boolean),
    }
    this.setData({
      shellState: 'done',
      hasResult: true,
      error: '',
      resultLabel: '总电量',
      resultMain: `${result.totalKwh.toFixed(2)} 度`,
      resultRows: rows,
      tierRows: slices,
      powerSummary: summary,
      hasTiers: result.mode === 'tier',
      aboveHighest: result.aboveHighest,
      posterData: poster,
    })
  },

  runUtility() {
    const kind = this.data.mode as UtilityKind
    const unit = kind === 'water' ? '吨' : 'm³'
    const feeName = kind === 'water' ? '水费' : '燃气费'
    const usage = Number(this.data.usageText)
    if (!Number.isFinite(usage) || usage <= 0) {
      this.fail(`请填写大于 0 的${kind === 'water' ? '用水量' : '用气量'}`)
      return
    }
    const baseText = String(this.data.baseFeeText).trim()
    const baseFee = baseText === '' ? 0 : Number(baseText)
    if (!Number.isFinite(baseFee) || baseFee < 0) {
      this.fail('基础费需为大于等于 0 的数字，或留空')
      return
    }
    const parsed = parseTiers(this.data as unknown as PowerData)
    if (parsed.error) {
      this.fail(parsed.error)
      return
    }
    const priceText = String(this.data.priceText).trim()
    const price = priceText === '' ? null : Number(priceText)
    if (priceText !== '' && (!Number.isFinite(price) || (price as number) < 0)) {
      this.fail('单价需为大于等于 0 的数字，或留空')
      return
    }
    const result = utilityBill({
      kind,
      usage,
      pricePerUnit: price,
      tiers: parsed.tiers.length > 0 ? parsed.tiers : undefined,
      baseFee,
    })
    if (!result) {
      this.fail('阶梯上限需严格递增，且用量、基础费需为合法数字')
      return
    }

    const main =
      result.totalWithFee === null
        ? `${result.usage.toFixed(2)} ${unit}`
        : `¥${result.totalWithFee.toFixed(2)}`
    const rows: ResultRow[] = [
      { k: '用量', v: `${result.usage.toFixed(2)} ${unit}` },
      {
        k: '计价方式',
        v:
          result.totalCost === null
            ? '未填单价'
            : result.mode === 'tier'
              ? `阶梯费率（${result.slices.length} 段）`
              : '平价费率',
      },
      {
        k: '单价',
        v:
          result.totalCost === null
            ? '—'
            : result.mode === 'tier'
              ? '按阶梯分段'
              : `${(price as number).toFixed(2)} 元/${unit}`,
      },
      {
        k: feeName,
        v: result.totalCost === null ? '未填单价' : `${result.totalCost.toFixed(2)} 元`,
      },
      { k: '基础费', v: `${result.baseFee.toFixed(2)} 元` },
      {
        k: '合计',
        v: result.totalWithFee === null ? '未填单价' : `${result.totalWithFee.toFixed(2)} 元`,
      },
    ]
    const slices = utilityTierRows(result, unit)
    const summary = utilitySummaryText(result)
    const poster: IPosterData = {
      toolName: '水电燃气费',
      category: '计算换算',
      mainResult: main,
      resultLabel: feeName,
      params: [
        { label: '用量', value: `${result.usage.toFixed(2)} ${unit}` },
        { label: '计价', value: result.mode === 'tier' ? '阶梯费率' : '平价费率' },
      ],
      extras: [
        summary,
        result.baseFee > 0 ? `基础费 ${result.baseFee.toFixed(2)} 元` : '',
        result.aboveHighest ? '超出最高档' : '',
      ].filter(Boolean),
    }
    this.setData({
      shellState: 'done',
      hasResult: true,
      error: '',
      resultLabel: feeName,
      resultMain: main,
      resultRows: rows,
      tierRows: slices,
      powerSummary: summary,
      hasTiers: result.mode === 'tier',
      aboveHighest: result.aboveHighest,
      posterData: poster,
    })
  },

  fail(message: string) {
    this.setData({ ...emptyResult(), shellState: 'invalid', error: message })
  },

  onCopy() {
    const text = this.data.powerSummary
    if (!text) {
      return
    }
    tapTick()
    copyText(text, '摘要已复制')
  },

  onCopyRow(event: WechatMiniprogram.TouchEvent) {
    const value = String(event.currentTarget.dataset.value || '')
    if (!value) {
      return
    }
    tapTick()
    copyText(value, '已复制')
  },

  onReceiveWorkflow(data: IWorkflowData): boolean {
    if (!data || data.type === 'image' || typeof data.payload !== 'string') {
      return false
    }
    const match = data.payload.match(/(\d+(?:\.\d+)?)/)
    if (!match) {
      return false
    }
    const watts = Number(match[1])
    if (!Number.isFinite(watts) || watts <= 0) {
      return false
    }
    this.setData(
      {
        ...MODE_COPY.electric,
        mode: 'electric',
        powerText: match[1],
        formTouched: true,
        error: '',
      },
      () => this.onRun(),
    )
    return true
  },
})
