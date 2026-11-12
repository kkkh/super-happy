/* ==========================================================================
   进制转换 · 2 / 8 / 10 / 16 互转
   - 引擎在 lib/radix.ts，纯字符串大数，不依赖 BigInt
   - 四栏结果同屏，单项复制；错误定位到具体位
   ========================================================================== */
import { copyText } from '../../lib/ui'
import { tapTick } from '../../../../core/utils/haptics'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'
import {
  RADIX_BASES,
  RADIX_LABELS,
  convertRadix,
  radixErrorText,
  type RadixBase,
  type RadixConversion,
} from '../../lib/radix'

interface RadixState {
  destroyed: boolean
}

const BASE_OPTIONS = RADIX_BASES.map((base) => ({
  base,
  label: RADIX_LABELS[base],
  short: `${base}`,
}))

Page({
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: '进制转换',
    kicker: '计算换算',
    desc: '2 / 8 / 10 / 16 进制互转',
    sourceValue: '',
    sourceBase: 10 as RadixBase,
    baseOptions: BASE_OPTIONS,
    conversions: [] as RadixConversion[],
    radixSummary: '',
    decimalText: '',
    canRun: false,
    shellState: 'idle',
    hasResult: false,
    error: '',
    posterData: null as IPosterData | null,
  },

  onLoad() {
    const state = this as unknown as RadixState
    state.destroyed = false
  },

  onUnload() {
    const state = this as unknown as RadixState
    state.destroyed = true
  },

  onValueInput(event: WechatMiniprogram.Input) {
    const value = String(event.detail.value || '')
    this.setData({ sourceValue: value, canRun: value.trim().length > 0 })
  },

  onBaseTap(event: WechatMiniprogram.TouchEvent) {
    const base = Number(event.currentTarget.dataset.base) as RadixBase
    if (!RADIX_BASES.includes(base)) {
      return
    }
    tapTick()
    this.setData({ sourceBase: base })
  },

  onExample() {
    tapTick()
    this.setData({ sourceValue: '255', sourceBase: 10, canRun: true })
  },

  onReset() {
    this.setData({
      sourceValue: '',
      sourceBase: 10,
      conversions: [],
      radixSummary: '',
      decimalText: '',
      canRun: false,
      shellState: 'idle',
      hasResult: false,
      error: '',
      posterData: null,
    })
  },

  /* ---- 草稿：数值与进制；恢复后重新转换 ---- */
  collectDraftInput(): Record<string, string> {
    return { sourceValue: this.data.sourceValue, sourceBase: `${this.data.sourceBase}` }
  },

  applyDraftInput(input: Record<string, string>): void {
    const base = Number(input.sourceBase)
    const sourceBase = RADIX_BASES.includes(base as RadixBase) ? (base as RadixBase) : 10
    const sourceValue = input.sourceValue ?? ''
    this.setData(
      {
        sourceValue,
        sourceBase,
        canRun: sourceValue.trim().length > 0,
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
    const state = this as unknown as RadixState
    if (state.destroyed) {
      return
    }
    const { sourceValue, sourceBase } = this.data
    const result = convertRadix(sourceValue, sourceBase)
    if (!result.ok) {
      this.setData({
        shellState: 'invalid',
        hasResult: false,
        conversions: [],
        error: radixErrorText(result, sourceBase),
        posterData: null,
      })
      return
    }

    const primary =
      result.conversions.find((item) => item.base === 10)?.value ?? result.conversions[0].value
    const summary = result.conversions.map((item) => `${item.label} ${item.value}`).join(' / ')
    const poster = {
      toolName: '进制转换',
      category: '计算换算',
      mainResult: primary,
      resultLabel: '十进制结果',
      params: [
        { label: '输入', value: `${sourceBase} 进制 · ${sourceValue.trim()}` },
        { label: '十六进制', value: result.conversions[3].value },
      ],
      extras: [...result.conversions.map((item) => `${item.label} ${item.value}`)],
    }
    this.setData({
      shellState: 'done',
      hasResult: true,
      error: '',
      conversions: result.conversions,
      radixSummary: summary,
      decimalText: primary,
      posterData: poster,
    })
  },

  onCopy(event: WechatMiniprogram.TouchEvent) {
    const value = String(event.currentTarget.dataset.value || '')
    if (!value) {
      return
    }
    tapTick()
    copyText(value, '已复制')
  },
})
