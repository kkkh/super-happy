/* 算账助手 · 折扣 / 满减 / AA */
import { tapTick } from '../../../../core/utils/haptics'
import { formatCents, parseCents } from '../../../../core/toolbox/engines/money'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'
import { copyText } from '../../lib/ui'
import {
  calcDiscount,
  calcThreshold,
  formatSplitSpread,
  ledgerErrorText,
  splitBill,
  type LedgerMode,
  type ThresholdTier,
} from '../../lib/ledger'

type DiscountUnit = 'zhe' | 'percent'

interface ResultRow {
  k: string
  v: string
}

interface ModeView {
  label: string
  main: string
  rows: ResultRow[]
  summary: string
}

interface LedgerState {
  destroyed: boolean
  modeResults: Partial<Record<LedgerMode, ModeView>>
}

const MODE_OPTIONS: Array<{ key: LedgerMode; label: string }> = [
  { key: 'discount', label: '折扣' },
  { key: 'threshold', label: '满减' },
  { key: 'aa', label: 'AA 分摊' },
]

function amountText(cents: number): string {
  return `¥${formatCents(cents)}`
}

function trimNumber(raw: string): string {
  return raw.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
}

Page({
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: '算账助手',
    kicker: '计算换算',
    desc: '折扣 / 满减 / AA 分摊',
    activeMode: 'discount' as LedgerMode,
    modeOptions: MODE_OPTIONS,
    discountPrice: '',
    discountValue: '8',
    discountUnit: 'zhe' as DiscountUnit,
    thresholdPrice: '',
    tier1Threshold: '100',
    tier1Off: '10',
    tier2Threshold: '',
    tier2Off: '',
    tier3Threshold: '',
    tier3Off: '',
    aaTotal: '',
    aaPeople: '2',
    aaTip: '0',
    resultLabel: '',
    resultMain: '',
    resultRows: [] as ResultRow[],
    resultText: '',
    ledgerSummary: '',
    stale: false,
    canRun: false,
    shellState: 'idle',
    hasResult: false,
    error: '',
    posterData: null as IPosterData | null,
  },

  onLoad() {
    const state = this as unknown as LedgerState
    state.destroyed = false
    state.modeResults = {}
  },

  onUnload() {
    const state = this as unknown as LedgerState
    state.destroyed = true
    state.modeResults = {}
  },

  onFieldInput(event: WechatMiniprogram.Input) {
    const field = String(event.currentTarget.dataset.field || '')
    if (!field) {
      return
    }
    const value = String(event.detail.value || '')
    const patch: Record<string, unknown> = { [field]: value, stale: false, error: '' }
    this.setData(patch, () => {
      this.invalidateCurrent()
      this.refreshCanRun()
    })
  },

  onUnitTap(event: WechatMiniprogram.TouchEvent) {
    const unit = event.currentTarget.dataset.unit as DiscountUnit
    if (unit !== 'zhe' && unit !== 'percent') {
      return
    }
    tapTick()
    this.setData({ discountUnit: unit, error: '' }, () => {
      this.invalidateCurrent()
      this.refreshCanRun()
    })
  },

  onModeTap(event: WechatMiniprogram.TouchEvent) {
    const mode = event.currentTarget.dataset.mode as LedgerMode
    if (!MODE_OPTIONS.some((item) => item.key === mode)) {
      return
    }
    if (mode === this.data.activeMode) {
      return
    }
    tapTick()
    const state = this as unknown as LedgerState
    const view = state.modeResults[mode]
    if (view) {
      this.setData({
        activeMode: mode,
        stale: false,
        error: '',
        hasResult: true,
        shellState: 'done',
        resultLabel: view.label,
        resultMain: view.main,
        resultRows: view.rows,
        resultText: view.summary,
        ledgerSummary: view.summary,
        posterData: this.buildPoster(view, mode),
      })
    } else {
      this.setData({
        activeMode: mode,
        stale: false,
        error: '',
        hasResult: false,
        shellState: 'idle',
        resultLabel: '',
        resultMain: '',
        resultRows: [],
        resultText: '',
        ledgerSummary: '',
        posterData: null,
      })
    }
    this.refreshCanRun()
  },

  onExample() {
    tapTick()
    const mode = this.data.activeMode
    if (mode === 'discount') {
      this.setData({ discountPrice: '100', discountValue: '8', discountUnit: 'zhe' }, () => this.onRun())
      return
    }
    if (mode === 'threshold') {
      this.setData(
        {
          thresholdPrice: '250',
          tier1Threshold: '100',
          tier1Off: '10',
          tier2Threshold: '200',
          tier2Off: '30',
          tier3Threshold: '',
          tier3Off: '',
        },
        () => this.onRun(),
      )
      return
    }
    this.setData({ aaTotal: '300', aaPeople: '3', aaTip: '10' }, () => this.onRun())
  },

  onReset() {
    const state = this as unknown as LedgerState
    state.modeResults = {}
    this.setData({
      discountPrice: '',
      discountValue: '8',
      discountUnit: 'zhe',
      thresholdPrice: '',
      tier1Threshold: '100',
      tier1Off: '10',
      tier2Threshold: '',
      tier2Off: '',
      tier3Threshold: '',
      tier3Off: '',
      aaTotal: '',
      aaPeople: '2',
      aaTip: '0',
      resultLabel: '',
      resultMain: '',
      resultRows: [],
      resultText: '',
      ledgerSummary: '',
      stale: false,
      canRun: false,
      shellState: 'idle',
      hasResult: false,
      error: '',
      posterData: null,
    })
  },

  onRun() {
    const state = this as unknown as LedgerState
    if (state.destroyed) {
      return
    }
    const mode = this.data.activeMode
    const view = mode === 'discount' ? this.runDiscount() : mode === 'threshold' ? this.runThreshold() : this.runSplit()
    if (!view) {
      return
    }
    state.modeResults[mode] = view
    const poster = this.buildPoster(view, mode)
    this.setData({
      resultLabel: view.label,
      resultMain: view.main,
      resultRows: view.rows,
      resultText: view.summary,
      ledgerSummary: view.summary,
      shellState: 'done',
      hasResult: true,
      stale: false,
      error: '',
      posterData: poster,
    })
  },

  onCopy() {
    const text = this.data.resultText
    if (!text) {
      return
    }
    tapTick()
    copyText(text, '结果已复制')
  },

  onReceiveWorkflow(data: { payload?: string }): boolean {
    const payload = typeof data?.payload === 'string' ? data.payload.replace(/,/g, '') : ''
    const match = payload.match(/\d{1,12}(?:\.\d{1,2})?/)
    if (!match) {
      return false
    }
    const raw = match[0]
    const field =
      this.data.activeMode === 'aa'
        ? 'aaTotal'
        : this.data.activeMode === 'threshold'
          ? 'thresholdPrice'
          : 'discountPrice'
    this.setData({ [field]: raw, stale: false, error: '' }, () => {
      this.invalidateCurrent()
      this.refreshCanRun()
    })
    return true
  },

  invalidateCurrent() {
    const state = this as unknown as LedgerState
    delete state.modeResults[this.data.activeMode]
    if (!this.data.hasResult) {
      return
    }
    this.setData({
      hasResult: false,
      shellState: 'idle',
      stale: true,
      resultLabel: '',
      resultMain: '',
      resultRows: [],
      resultText: '',
      ledgerSummary: '',
      posterData: null,
    })
  },

  refreshCanRun() {
    const mode = this.data.activeMode
    const amountOk = (raw: string): boolean => parseCents(raw) !== null
    let canRun = false
    if (mode === 'discount') {
      const value = Number(this.data.discountValue)
      const max = this.data.discountUnit === 'zhe' ? 10 : 100
      canRun =
        amountOk(this.data.discountPrice) &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= max
    } else if (mode === 'threshold') {
      const tierPairs: Array<[string, string]> = [
        [this.data.tier1Threshold, this.data.tier1Off],
        [this.data.tier2Threshold, this.data.tier2Off],
        [this.data.tier3Threshold, this.data.tier3Off],
      ]
      let tiersOk = false
      for (const [thresholdRaw, offRaw] of tierPairs) {
        const thresholdText = thresholdRaw.trim()
        const offText = offRaw.trim()
        if (!thresholdText && !offText) {
          continue
        }
        const threshold = parseCents(thresholdText)
        const off = parseCents(offText)
        if (threshold === null || threshold <= 0 || off === null || off > threshold) {
          tiersOk = false
          break
        }
        tiersOk = true
      }
      canRun = amountOk(this.data.thresholdPrice) && tiersOk
    } else {
      const people = Number(this.data.aaPeople)
      const tip = Number(this.data.aaTip)
      canRun =
        amountOk(this.data.aaTotal) &&
        /^\d{1,3}$/.test(this.data.aaPeople.trim()) &&
        people >= 1 &&
        people <= 100 &&
        Number.isFinite(tip) &&
        tip >= 0 &&
        tip <= 100
    }
    this.setData({ canRun })
  },

  buildPoster(view: ModeView, mode: LedgerMode): IPosterData {
    return {
      toolName: '算账助手',
      category: '计算换算',
      mainResult: view.main,
      resultLabel: view.label,
      params: [{ label: '模式', value: MODE_OPTIONS.find((item) => item.key === mode)?.label ?? '' }],
      extras: view.rows.map((row) => `${row.k} ${row.v}`).slice(0, 4),
    }
  },

  fail(code: Parameters<typeof ledgerErrorText>[0]): null {
    this.setData({
      shellState: 'invalid',
      hasResult: false,
      error: ledgerErrorText(code),
      posterData: null,
    })
    return null
  },

  runDiscount(): ModeView | null {
    const price = parseCents(this.data.discountPrice)
    if (price === null) {
      return this.fail('amount')
    }
    const raw = this.data.discountValue.trim()
    const value = Number(raw)
    if (!raw || !Number.isFinite(value)) {
      return this.fail('discount')
    }
    const percent = this.data.discountUnit === 'zhe' ? value * 10 : value
    const result = calcDiscount(price, percent)
    if (!result.ok) {
      return this.fail(result.code)
    }
    const discountText =
      this.data.discountUnit === 'zhe'
        ? `${trimNumber(raw)} 折`
        : `${trimNumber(raw)}%`
    const summary = `应付 ${amountText(result.payable)}（原价 ${amountText(price)}，${discountText}，省 ${amountText(result.saved)}）`
    return {
      label: '应付金额',
      main: amountText(result.payable),
      rows: [
        { k: '原价', v: amountText(price) },
        { k: '折扣', v: discountText },
        { k: '节省', v: amountText(result.saved) },
      ],
      summary,
    }
  },

  runThreshold(): ModeView | null {
    const price = parseCents(this.data.thresholdPrice)
    if (price === null) {
      return this.fail('amount')
    }
    const pairs = [
      [this.data.tier1Threshold, this.data.tier1Off],
      [this.data.tier2Threshold, this.data.tier2Off],
      [this.data.tier3Threshold, this.data.tier3Off],
    ]
    const tiers: ThresholdTier[] = []
    for (const [thresholdRaw, offRaw] of pairs) {
      const thresholdText = thresholdRaw.trim()
      const offText = offRaw.trim()
      if (!thresholdText && !offText) {
        continue
      }
      const thresholdCents = parseCents(thresholdText)
      const offCents = parseCents(offText)
      if (thresholdCents === null || offCents === null || thresholdCents <= 0) {
        return this.fail('tiers')
      }
      tiers.push({ thresholdCents, offCents })
    }
    if (tiers.length === 0) {
      return this.fail('tiers')
    }
    const result = calcThreshold(price, tiers)
    if (!result.ok) {
      return this.fail(result.code)
    }
    const rows: ResultRow[] = [{ k: '原价', v: amountText(price) }]
    if (result.applied) {
      rows.push({
        k: '优惠',
        v: `满 ${amountText(result.applied.thresholdCents)} 减 ${amountText(result.applied.offCents)}`,
      })
    } else {
      rows.push({ k: '优惠', v: '未达门槛' })
    }
    rows.push({ k: '节省', v: amountText(result.saved) })
    const summary = result.reached
      ? `应付 ${amountText(result.payable)}（满减省 ${amountText(result.saved)}）`
      : `应付 ${amountText(result.payable)}（未达满减门槛）`
    return { label: '应付金额', main: amountText(result.payable), rows, summary }
  },

  runSplit(): ModeView | null {
    const total = parseCents(this.data.aaTotal)
    if (total === null) {
      return this.fail('amount')
    }
    const people = Number(this.data.aaPeople.trim())
    if (!/^\d{1,3}$/.test(this.data.aaPeople.trim())) {
      return this.fail('people')
    }
    const tip = Number(this.data.aaTip.trim() || '0')
    if (!Number.isFinite(tip)) {
      return this.fail('tip')
    }
    const result = splitBill(total, people, tip)
    if (!result.ok) {
      return this.fail(result.code)
    }
    const first = result.perPerson[0]
    const spread = formatSplitSpread(result.perPerson)
    const summary = `每人 ${amountText(first)} × ${people} 人（实付 ${amountText(result.payable)}）`
    return {
      label: '每人金额',
      main: people > 1 ? `${amountText(first)} 起` : amountText(first),
      rows: [
        { k: '总额', v: amountText(total) },
        { k: '小费', v: amountText(result.tipCents) },
        { k: '实付', v: amountText(result.payable) },
        { k: '人数', v: `${people} 人` },
        { k: '分配', v: spread },
      ],
      summary,
    }
  },
})
