/* ==========================================================================
   油耗计算 · 百公里油耗 / 每公里油费 / 本次油费
   - 油价可选；为空时只显示油耗，费用行整体隐藏
   - 里程 0 / 负值 / 加油量 0 明确报错
   ========================================================================== */
import { tapTick } from '../../../../core/utils/haptics'
import { calcFuel, fuelSummaryText } from '../../lib/fuel'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'
import type { IWorkflowData } from '../../../../core/workflow/types'
import { copyText } from '../../lib/ui'

interface ResultRow {
  k: string
  v: string
}

interface FuelState {
  destroyed: boolean
}

function formatInput(value: string): string {
  return value.trim()
}

Page({
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: '油耗计算',
    kicker: '计算换算',
    desc: '百公里油耗 · 每公里油费 · 本次油费',
    distanceText: '',
    litersText: '',
    priceText: '',
    resultLabel: '百公里油耗',
    resultMain: '',
    resultRows: [] as ResultRow[],
    fuelSummary: '',
    hasPrice: false,
    needsReview: false,
    shellState: 'idle',
    hasResult: false,
    error: '',
    posterData: null as IPosterData | null,
    formTouched: false,
  },

  onLoad() {
    const state = this as unknown as FuelState
    state.destroyed = false
  },

  onUnload() {
    const state = this as unknown as FuelState
    state.destroyed = true
  },

  onFieldInput(event: WechatMiniprogram.Input) {
    const field = String(event.currentTarget.dataset.field || '')
    const value = String(event.detail.value ?? '')
    if (field === 'distanceText') {
      this.setData({ distanceText: value, formTouched: true, error: '' })
      return
    }
    if (field === 'litersText') {
      this.setData({ litersText: value, formTouched: true, error: '' })
      return
    }
    if (field === 'priceText') {
      this.setData({ priceText: value, formTouched: true, error: '' })
    }
  },

  onExample() {
    tapTick()
    this.setData(
      {
        distanceText: '500',
        litersText: '40',
        priceText: '8',
        formTouched: true,
        error: '',
      },
      () => this.onRun(),
    )
  },

  onReset() {
    this.setData({
      distanceText: '',
      litersText: '',
      priceText: '',
      resultLabel: '百公里油耗',
      resultMain: '',
      resultRows: [],
      fuelSummary: '',
      hasPrice: false,
      needsReview: false,
      shellState: 'idle',
      hasResult: false,
      error: '',
      posterData: null,
      formTouched: false,
    })
  },

  /* ---- 草稿：里程 / 加油量 / 油价；恢复后重算 ---- */
  collectDraftInput(): Record<string, string> {
    return {
      distanceText: this.data.distanceText,
      litersText: this.data.litersText,
      priceText: this.data.priceText,
    }
  },

  applyDraftInput(input: Record<string, string>): void {
    this.setData(
      {
        distanceText: input.distanceText ?? '',
        litersText: input.litersText ?? '',
        priceText: input.priceText ?? '',
        formTouched: true,
        shellState: 'idle',
        hasResult: false,
        error: '',
        posterData: null,
      },
      () => {
        this.onRun()
      },
    )
  },

  onRun() {
    const state = this as unknown as FuelState
    if (state.destroyed) {
      return
    }
    const distance = Number(formatInput(this.data.distanceText))
    const liters = Number(formatInput(this.data.litersText))
    const priceText = formatInput(this.data.priceText)
    if (!distance || !liters) {
      this.setData({
        shellState: 'invalid',
        hasResult: false,
        resultMain: '',
        resultRows: [],
        fuelSummary: '',
        hasPrice: false,
        needsReview: false,
        error: '请填写大于 0 的里程与加油量',
        posterData: null,
      })
      return
    }
    const price = priceText === '' ? null : Number(priceText)
    if (priceText !== '' && (!Number.isFinite(price) || (price as number) < 0)) {
      this.setData({
        shellState: 'invalid',
        hasResult: false,
        resultMain: '',
        resultRows: [],
        fuelSummary: '',
        hasPrice: false,
        needsReview: false,
        error: '油价需为大于等于 0 的数字，或留空',
        posterData: null,
      })
      return
    }

    const result = calcFuel({ distanceKm: distance, liters, pricePerLiter: price })
    if (!result) {
      this.setData({
        shellState: 'invalid',
        hasResult: false,
        resultMain: '',
        resultRows: [],
        fuelSummary: '',
        hasPrice: false,
        needsReview: false,
        error: '里程与加油量需为大于 0 的数字',
        posterData: null,
      })
      return
    }

    const rows: ResultRow[] = [
      { k: '行驶里程', v: `${result.distanceKm} km` },
      { k: '加油量', v: `${result.liters} L` },
    ]
    if (result.pricePerLiter !== null) {
      rows.push({ k: '油价', v: `${result.pricePerLiter.toFixed(2)} 元/L` })
      rows.push({ k: '每公里油费', v: `${(result.costPerKm as number).toFixed(2)} 元` })
      rows.push({ k: '本次油费', v: `${(result.totalCost as number).toFixed(2)} 元` })
    }

    const summary = fuelSummaryText(result)
    const poster: IPosterData = {
      toolName: '油耗计算',
      category: '计算换算',
      mainResult: `${result.consumption.toFixed(2)} L/100km`,
      resultLabel: '百公里油耗',
      params: [
        { label: '里程', value: `${result.distanceKm} km` },
        { label: '加油量', value: `${result.liters} L` },
      ],
      extras: [
        result.pricePerLiter === null ? '未填油价' : `油价 ${result.pricePerLiter.toFixed(2)} 元/L`,
        result.costPerKm === null ? '' : `每公里 ${result.costPerKm.toFixed(2)} 元`,
        result.needsReview ? '里程超 10,000 km，请复核' : '',
      ].filter(Boolean),
    }
    this.setData({
      shellState: 'done',
      hasResult: true,
      error: '',
      resultLabel: '百公里油耗',
      resultMain: `${result.consumption.toFixed(2)} L/100km`,
      resultRows: rows,
      fuelSummary: summary,
      hasPrice: result.pricePerLiter !== null,
      needsReview: result.needsReview,
      posterData: poster,
    })
  },

  onCopy() {
    const text = this.data.fuelSummary
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
    const distance = Number(match[1])
    if (!Number.isFinite(distance) || distance <= 0) {
      return false
    }
    this.setData({ distanceText: match[1], formTouched: true, error: '' }, () => this.onRun())
    return true
  },
})
