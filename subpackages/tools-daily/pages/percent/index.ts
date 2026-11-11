/* ==========================================================================
   百分比计算 · 占比 / 增减幅 / 配比
   - 三模式独立缓存输入；切换模式恢复各自内容
   - 数值按两位小数放大为整数，避免浮点误差
   - 涨跌幅超过 1000%、旧值为 0、配比同时为 0 均拒绝
   ========================================================================== */
import { tapTick } from '../../../../core/utils/haptics'
import { parseDecimal } from '../../../../core/toolbox/engines/money'
import { copyText } from '../../lib/ui'
import {
  PERCENT_MAX_VALUE,
  PERCENT_SCALE,
  changeRate,
  percentModeLabel,
  percentOf,
  percentSummary,
  ratioParts,
  type PercentMode,
  type PercentResult,
} from '../../lib/percent'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'

interface ResultRow {
  k: string
  v: string
}

interface ModeMeta {
  label: string
  labelA: string
  labelB: string
  placeholderA: string
  placeholderB: string
  exampleA: string
  exampleB: string
}

interface PercentState {
  destroyed: boolean
  modeInputs: Record<PercentMode, { a: string; b: string }>
}

const MODE_OPTIONS: Array<{ key: PercentMode; label: string }> = [
  { key: 'share', label: '占比' },
  { key: 'change', label: '增减幅' },
  { key: 'ratio', label: '配比' },
]

const MODE_META: Record<PercentMode, ModeMeta> = {
  share: {
    label: '占比',
    labelA: '部分值',
    labelB: '总数',
    placeholderA: '例如 25',
    placeholderB: '例如 200',
    exampleA: '25',
    exampleB: '200',
  },
  change: {
    label: '增减幅',
    labelA: '原值',
    labelB: '新值',
    placeholderA: '例如 100',
    placeholderB: '例如 120',
    exampleA: '100',
    exampleB: '120',
  },
  ratio: {
    label: '配比',
    labelA: '数值 A',
    labelB: '数值 B',
    placeholderA: '例如 16',
    placeholderB: '例如 24',
    exampleA: '16',
    exampleB: '24',
  },
}

function emptyResult() {
  return {
    resultMain: '',
    resultRows: [] as ResultRow[],
    percentSummary: '',
    hasResult: false,
    shellState: 'idle' as string,
    error: '',
    posterData: null as IPosterData | null,
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
    toolName: '百分比计算',
    kicker: '计算换算',
    desc: '占比 · 增减幅 · 配比',
    mode: 'share' as PercentMode,
    modeOptions: MODE_OPTIONS,
    modeMeta: MODE_META.share,
    aValue: '',
    bValue: '',
    ...emptyResult(),
  },

  onLoad() {
    const state = this as unknown as PercentState
    state.destroyed = false
    state.modeInputs = {
      share: { a: '', b: '' },
      change: { a: '', b: '' },
      ratio: { a: '', b: '' },
    }
  },

  onUnload() {
    const state = this as unknown as PercentState
    state.destroyed = true
  },

  onMode(event: WechatMiniprogram.TouchEvent) {
    const mode = event.currentTarget.dataset.mode as PercentMode
    if (!MODE_OPTIONS.some((item) => item.key === mode) || mode === this.data.mode) {
      return
    }
    const state = this as unknown as PercentState
    state.modeInputs[this.data.mode] = { a: this.data.aValue, b: this.data.bValue }
    const shouldRun = this.data.hasResult
    tapTick()
    const next = state.modeInputs[mode]
    this.setData(
      {
        mode,
        modeMeta: MODE_META[mode],
        aValue: next.a,
        bValue: next.b,
        ...emptyResult(),
      },
      () => {
        if (shouldRun) {
          this.compute()
        }
      },
    )
  },

  onInput(event: WechatMiniprogram.Input) {
    const field = String(event.currentTarget.dataset.field || '')
    if (field !== 'a' && field !== 'b') {
      return
    }
    const key = field === 'a' ? 'aValue' : 'bValue'
    this.setData({ [key]: event.detail.value, ...emptyResult() })
  },

  onExample() {
    const meta = MODE_META[this.data.mode]
    tapTick()
    this.setData(
      {
        aValue: meta.exampleA,
        bValue: meta.exampleB,
        ...emptyResult(),
      },
      () => this.compute(),
    )
  },

  onReset() {
    const state = this as unknown as PercentState
    state.modeInputs = {
      share: { a: '', b: '' },
      change: { a: '', b: '' },
      ratio: { a: '', b: '' },
    }
    this.setData({
      mode: 'share',
      modeMeta: MODE_META.share,
      aValue: '',
      bValue: '',
      ...emptyResult(),
    })
  },

  onRun() {
    this.compute()
  },

  onCopy() {
    if (!this.data.percentSummary) {
      return
    }
    tapTick()
    void copyText(this.data.percentSummary, '百分比结果已复制')
  },

  compute() {
    const state = this as unknown as PercentState
    if (state.destroyed) {
      return
    }
    const a = parseDecimal(this.data.aValue, 0, PERCENT_MAX_VALUE, 2)
    const b = parseDecimal(this.data.bValue, 0, PERCENT_MAX_VALUE, 2)
    if (a === null || b === null) {
      this.invalidate('请输入 0–1,000,000,000 之间的数字，最多两位小数')
      return
    }
    const aCents = Math.round(a * PERCENT_SCALE)
    const bCents = Math.round(b * PERCENT_SCALE)
    let result: PercentResult | null
    if (this.data.mode === 'share') {
      result = percentOf(aCents, bCents)
    } else if (this.data.mode === 'change') {
      result = changeRate(aCents, bCents)
    } else {
      result = ratioParts(aCents, bCents)
    }
    if (!result) {
      this.invalidate(
        this.data.mode === 'share'
          ? '总数需大于 0，且占比不超过 1000%'
          : this.data.mode === 'change'
            ? '原值需大于 0，且涨跌幅不超过 1000%'
            : '两个数值不能同时为 0',
      )
      return
    }

    let main = ''
    let rows: ResultRow[] = []
    if (result.mode === 'share') {
      main = result.percentText
      rows = [
        { k: '部分值', v: this.data.aValue },
        { k: '总数', v: this.data.bValue },
        { k: '其余', v: this.formatValue(result.remainderCents) },
        { k: '占比', v: result.percentText },
      ]
    } else if (result.mode === 'change') {
      main = result.percentText
      rows = [
        { k: '原值', v: this.data.aValue },
        { k: '新值', v: this.data.bValue },
        { k: '差额', v: this.formatSigned(result.diffCents) },
        { k: '涨跌幅', v: result.percentText },
      ]
    } else {
      main = result.ratioText
      rows = [
        { k: '数值 A', v: this.data.aValue },
        { k: '数值 B', v: this.data.bValue },
        { k: '最简比', v: result.ratioText },
        { k: '合计份数', v: `${result.totalParts} 份` },
        { k: 'A 占比', v: result.aShareText },
        { k: 'B 占比', v: result.bShareText },
      ]
    }

    const poster: IPosterData = {
      toolName: '百分比计算',
      category: '计算换算',
      mainResult: main,
      resultLabel: percentModeLabel(result.mode),
      params: [
        { label: MODE_META[result.mode].labelA, value: this.data.aValue },
        { label: MODE_META[result.mode].labelB, value: this.data.bValue },
      ],
      extras: [percentSummary(result)],
    }
    this.setData({
      resultMain: main,
      resultRows: rows,
      percentSummary: percentSummary(result),
      hasResult: true,
      shellState: 'done',
      error: '',
      posterData: poster,
    })
  },

  formatValue(cents: number): string {
    return (cents / PERCENT_SCALE).toFixed(2).replace(/\.?0+$/, '')
  },

  formatSigned(cents: number): string {
    const value = this.formatValue(Math.abs(cents))
    return `${cents > 0 ? '+' : cents < 0 ? '-' : ''}${value}`
  },

  invalidate(message: string) {
    this.setData({
      ...emptyResult(),
      shellState: 'invalid',
      error: message,
    })
  },
})
