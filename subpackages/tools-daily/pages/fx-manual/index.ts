/* ==========================================================================
   汇率换算 · 官方中间价 / 手动牌价
   - 默认自动获取中国外汇交易中心（CFETS）人民币汇率中间价
   - 官方数据按交易日 9:15 发布，不是逐秒行情；失败可重试或改用手动
   - 金额分整数、结果按分四舍五入、双向牌价、固定免责
   ========================================================================== */
import { tapTick } from '../../../../core/utils/haptics'
import { formatCents } from '../../../../core/toolbox/engines/money'
import {
  FX_CURRENCIES,
  convertManual,
  fxCurrencyLabel,
  fxDateWarning,
  fxSummary,
  formatFxRate,
  officialCrossRate,
  parseFxAmount,
  parseFxRate,
  parseFxWorkflowAmount,
  type FxConvertResult,
  type FxCurrencyCode,
  type FxOfficialRates,
} from '../../lib/fx'
import { fetchOfficialRates } from '../../lib/fx-official'
import { copyText, toast } from '../../lib/ui'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'
import type { IWorkflowData } from '../../../../core/workflow/types'

type FxRateSource = 'official' | 'manual'

interface ResultRow {
  k: string
  v: string
}

interface FxState {
  destroyed: boolean
}

const OFFICIAL_SOURCE = '中国外汇交易中心（CFETS）官方中间价'

function todayText(): string {
  const now = new Date()
  const month = now.getMonth() + 1
  const day = now.getDate()
  return `${now.getFullYear()}-${month < 10 ? `0${month}` : month}-${day < 10 ? `0${day}` : day}`
}

const CURRENCY_LABELS = FX_CURRENCIES.map((item) => fxCurrencyLabel(item.code))
const DEFAULT_FROM = 0
const DEFAULT_TO = 1

Page({
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: '汇率换算',
    kicker: '金融换算',
    desc: '官方中间价 · 双向换算 · 仅供参考',
    rateSource: 'official' as FxRateSource,
    currencyLabels: CURRENCY_LABELS,
    fromIndex: DEFAULT_FROM,
    toIndex: DEFAULT_TO,
    fromCode: FX_CURRENCIES[DEFAULT_FROM].code as FxCurrencyCode,
    toCode: FX_CURRENCIES[DEFAULT_TO].code as FxCurrencyCode,
    fromLabel: CURRENCY_LABELS[DEFAULT_FROM],
    toLabel: CURRENCY_LABELS[DEFAULT_TO],
    amountText: '',
    rateText: '',
    rateDate: todayText(),
    officialRates: null as FxOfficialRates | null,
    officialRateText: '',
    officialUpdatedAt: '',
    officialLoading: false,
    officialError: '',
    officialStale: false,
    fxSummary: '',
    convertedText: '',
    resultPair: '',
    rateTextDisplay: '',
    inverseRateText: '',
    rateDateWarning: '',
    sourceNote: '',
    resultRows: [] as ResultRow[],
    hasResult: false,
    shellState: 'idle',
    error: '',
    posterData: null as IPosterData | null,
  },

  onLoad() {
    const state = this as unknown as FxState
    state.destroyed = false
    void this.loadOfficialRates(false)
  },

  onUnload() {
    const state = this as unknown as FxState
    state.destroyed = true
  },

  async loadOfficialRates(force: boolean) {
    if (this.data.officialLoading) {
      return
    }
    const state = this as unknown as FxState
    this.setData({ officialLoading: true, officialError: '' })
    try {
      const response = await fetchOfficialRates(force)
      if (state.destroyed) {
        return
      }
      this.setData(
        {
          officialRates: response.rates,
          officialUpdatedAt: response.rates.updatedAt,
          officialLoading: false,
          officialError: '',
          officialStale: response.stale,
          rateDate: response.rates.date,
        },
        () => {
          this.refreshOfficialText()
          this.invalidate()
        },
      )
    } catch (error) {
      if (state.destroyed) {
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      this.setData({
        officialLoading: false,
        officialStale: false,
        officialError: message || '官方中间价获取失败',
      })
    }
  },

  refreshOfficialText() {
    const rate = officialCrossRate(
      this.data.fromCode as FxCurrencyCode,
      this.data.toCode as FxCurrencyCode,
      this.data.officialRates,
    )
    this.setData({ officialRateText: rate === null ? '' : formatFxRate(rate) })
  },

  onSourceChange(event: WechatMiniprogram.TouchEvent) {
    const source = event.currentTarget.dataset.source as FxRateSource
    if (source !== 'official' && source !== 'manual') {
      return
    }
    if (source === this.data.rateSource) {
      return
    }
    tapTick()
    if (source === 'official') {
      const rateDate = this.data.officialRates ? this.data.officialRates.date : this.data.rateDate
      this.setData({ rateSource: 'official', rateDate }, () => {
        this.refreshOfficialText()
        this.invalidate()
        if (!this.data.officialRates && !this.data.officialLoading) {
          void this.loadOfficialRates(false)
        }
      })
      return
    }
    const rateText = this.data.officialRateText || this.data.rateText
    this.setData(
      {
        rateSource: 'manual',
        rateText,
        rateDate: todayText(),
      },
      () => this.invalidate(),
    )
  },

  onRefreshOfficial() {
    if (this.data.officialLoading) {
      return
    }
    tapTick()
    void this.loadOfficialRates(true)
  },

  onFieldInput(event: WechatMiniprogram.Input) {
    const field = String(event.currentTarget.dataset.field || '')
    if (field !== 'amountText' && field !== 'rateText') {
      return
    }
    this.setData({ [field]: String(event.detail.value ?? '') }, () => {
      this.invalidate()
    })
  },

  onFromChange(event: WechatMiniprogram.PickerChange) {
    const index = Number(event.detail.value)
    const item = FX_CURRENCIES[index]
    if (!item) {
      return
    }
    this.setData(
      {
        fromIndex: index,
        fromCode: item.code,
        fromLabel: CURRENCY_LABELS[index],
      },
      () => {
        this.refreshOfficialText()
        this.invalidate()
      },
    )
  },

  onToChange(event: WechatMiniprogram.PickerChange) {
    const index = Number(event.detail.value)
    const item = FX_CURRENCIES[index]
    if (!item) {
      return
    }
    this.setData(
      {
        toIndex: index,
        toCode: item.code,
        toLabel: CURRENCY_LABELS[index],
      },
      () => {
        this.refreshOfficialText()
        this.invalidate()
      },
    )
  },

  onSwap() {
    const fromIndex = this.data.toIndex
    const toIndex = this.data.fromIndex
    const isManual = this.data.rateSource === 'manual'
    const rate = parseFxRate(this.data.rateText)
    tapTick()
    this.setData(
      {
        fromIndex,
        toIndex,
        fromCode: FX_CURRENCIES[fromIndex].code,
        toCode: FX_CURRENCIES[toIndex].code,
        fromLabel: CURRENCY_LABELS[fromIndex],
        toLabel: CURRENCY_LABELS[toIndex],
        rateText:
          isManual && rate !== null ? formatFxRate(1 / rate) : this.data.rateText,
      },
      () => {
        this.refreshOfficialText()
        this.invalidate()
      },
    )
  },

  onRateDateChange(event: WechatMiniprogram.PickerChange) {
    const value = String(event.detail.value || '')
    if (!value) {
      return
    }
    this.setData({ rateDate: value }, () => this.invalidate())
  },

  onExample() {
    tapTick()
    this.setData(
      {
        rateSource: 'manual',
        fromIndex: 1,
        toIndex: 0,
        fromCode: 'USD',
        toCode: 'CNY',
        fromLabel: CURRENCY_LABELS[1],
        toLabel: CURRENCY_LABELS[0],
        amountText: '1000',
        rateText: '7.200000',
        rateDate: todayText(),
      },
      () => {
        this.onRun()
      },
    )
  },

  onReset() {
    const state = this as unknown as FxState
    if (state.destroyed) {
      return
    }
    this.setData({
      rateSource: 'official',
      fromIndex: DEFAULT_FROM,
      toIndex: DEFAULT_TO,
      fromCode: FX_CURRENCIES[DEFAULT_FROM].code,
      toCode: FX_CURRENCIES[DEFAULT_TO].code,
      fromLabel: CURRENCY_LABELS[DEFAULT_FROM],
      toLabel: CURRENCY_LABELS[DEFAULT_TO],
      amountText: '',
      rateText: '',
      rateDate: this.data.officialRates ? this.data.officialRates.date : todayText(),
      hasResult: false,
      shellState: 'idle',
      error: '',
      fxSummary: '',
      convertedText: '',
      resultPair: '',
      rateTextDisplay: '',
      inverseRateText: '',
      rateDateWarning: '',
      sourceNote: '',
      resultRows: [],
      posterData: null,
    })
    this.refreshOfficialText()
  },

  onRun() {
    const state = this as unknown as FxState
    if (state.destroyed) {
      return
    }
    const amountCents = parseFxAmount(this.data.amountText)
    if (amountCents === null) {
      this.fail('请输入大于 0 且不超过 1,000,000.00 的金额（最多两位小数）')
      return
    }
    if (this.data.fromCode === this.data.toCode) {
      this.fail('源币种与目标币种相同，请切换其中一个')
      return
    }
    const source = this.data.rateSource
    let rate: number | null = null
    let rateDate = this.data.rateDate
    if (source === 'official') {
      if (this.data.officialLoading) {
        this.fail('正在获取官方中间价，请稍候再试')
        return
      }
      if (!this.data.officialRates || this.data.officialError) {
        this.fail('官方中间价暂不可用，请点刷新重试或切换手动牌价')
        return
      }
      rate = officialCrossRate(
        this.data.fromCode as FxCurrencyCode,
        this.data.toCode as FxCurrencyCode,
        this.data.officialRates,
      )
      rateDate = this.data.officialRates.date
    } else {
      rate = parseFxRate(this.data.rateText)
    }
    if (rate === null) {
      this.fail('牌价需在 0.000001–1,000,000 之间，最多 6 位小数')
      return
    }
    const result = convertManual({
      amountCents,
      rate,
      from: this.data.fromCode as FxCurrencyCode,
      to: this.data.toCode as FxCurrencyCode,
      rateDate,
    })
    if (!result) {
      this.fail('换算失败，请检查金额、牌价与币种')
      return
    }
    this.applyResult(result, source)
  },

  applyResult(result: FxConvertResult, source: FxRateSource) {
    const isOfficial = source === 'official'
    const convertedText = `${formatCents(result.convertedCents)} ${result.to}`
    const rateDisplay = `1 ${result.from} = ${formatFxRate(result.rate)} ${result.to}`
    const inverseDisplay = `1 ${result.to} = ${formatFxRate(result.inverseRate)} ${result.from}`
    const warning = isOfficial
      ? this.data.officialStale
        ? '当前展示的是本机缓存的中间价，请点击刷新获取最新官方数据'
        : ''
      : fxDateWarning(result.rateDate, todayText())
    const resultRows: ResultRow[] = [
      { k: '金额', v: `${formatCents(result.amountCents)} ${result.from}` },
      { k: '牌价', v: rateDisplay },
      { k: '反向牌价', v: inverseDisplay },
      { k: '牌价日期', v: result.rateDate },
      {
        k: '来源',
        v: isOfficial ? OFFICIAL_SOURCE : '手动填写',
      },
    ]
    if (isOfficial && this.data.officialUpdatedAt) {
      resultRows.push({ k: '官方更新', v: this.data.officialUpdatedAt })
    }
    const poster: IPosterData = {
      toolName: '汇率换算',
      category: '金融换算',
      mainResult: convertedText,
      resultLabel: '换算结果',
      params: [
        { label: '金额', value: `${formatCents(result.amountCents)} ${result.from}` },
        { label: '牌价', value: formatFxRate(result.rate) },
      ],
      extras: isOfficial
        ? ['官方中间价，仅供参考', `更新 ${result.rateDate}`]
        : ['手动填写，仅供参考', `牌价日期 ${result.rateDate}`],
    }
    this.setData({
      convertedText,
      resultPair: `${result.from} → ${result.to}`,
      rateTextDisplay: rateDisplay,
      inverseRateText: inverseDisplay,
      rateDateWarning: warning,
      sourceNote: isOfficial
        ? '官方中间价来自中国外汇交易中心（CFETS），按交易日 9:15 发布，不是逐秒行情；仅供日常估算，不构成交易或投资建议。'
        : '牌价完全由你手动填写，本工具不接入行情源；结果按分四舍五入，仅用于日常估算，不构成交易或投资建议。',
      fxSummary: fxSummary(result, source, OFFICIAL_SOURCE),
      resultRows,
      hasResult: true,
      shellState: 'done',
      error: '',
      posterData: poster,
    })
  },

  onCopy() {
    if (!this.data.fxSummary) {
      toast('没有可复制的内容')
      return
    }
    void copyText(this.data.fxSummary)
  },

  onReceiveWorkflow(data: IWorkflowData): boolean {
    if (!data || data.type !== 'text' || typeof data.payload !== 'string') {
      return false
    }
    const amountCents = parseFxWorkflowAmount(data.payload)
    if (amountCents === null) {
      return false
    }
    this.setData({ amountText: formatCents(amountCents) }, () => {
      this.onRun()
    })
    return true
  },

  /** 输入变化后清空旧结果，避免展示过期换算 */
  invalidate() {
    if (!this.data.hasResult && !this.data.error) {
      return
    }
    this.setData({
      hasResult: false,
      shellState: 'idle',
      error: '',
      fxSummary: '',
      convertedText: '',
      resultPair: '',
      rateTextDisplay: '',
      inverseRateText: '',
      rateDateWarning: '',
      sourceNote: '',
      resultRows: [],
      posterData: null,
    })
  },

  fail(message: string) {
    this.setData({
      hasResult: false,
      shellState: 'invalid',
      error: message,
      fxSummary: '',
      convertedText: '',
      resultPair: '',
      rateTextDisplay: '',
      inverseRateText: '',
      rateDateWarning: '',
      sourceNote: '',
      resultRows: [],
      posterData: null,
    })
  },
})
