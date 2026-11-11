/* ==========================================================================
   车贷计算 · 单方案 / 双方案对比 / 提前还款试算
   - 车价 / 首付 / 贷款额全部转分，月供委托 loan 共享引擎
   - 输入或参数变化即清空旧结果，点击计算才重新产出
   ========================================================================== */
import { tapTick } from '../../../../core/utils/haptics'
import { parseCents, parseInteger } from '../../../../core/toolbox/engines/money'
import {
  carLoanCompareView,
  carLoanPlan,
  carLoanPlanView,
  carLoanPrepayView,
  compareCarLoan,
  parseCarLoanPrice,
  parseCarLoanScheme,
  prepayCarLoan,
  type CarLoanDownMode,
  type CarLoanSchemeInput,
  type CarLoanView,
} from '../../lib/carloan'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'
import type { IWorkflowData } from '../../../../core/workflow/types'
import { copyText } from '../../lib/ui'

type LoanMode = 'equal-payment' | 'equal-principal'
type DownMode = CarLoanDownMode
type CalcMode = 'single' | 'compare'

interface CarLoanState {
  destroyed: boolean
}

const DEFAULTS = {
  calcMode: 'single' as CalcMode,
  carPriceText: '',
  downMode: 'percent' as DownMode,
  downPercentText: '30',
  downAmountText: '',
  termText: '36',
  rateText: '4.5',
  mode: 'equal-payment' as LoanMode,
  bDownMode: 'percent' as DownMode,
  bDownPercentText: '20',
  bDownAmountText: '',
  bTermText: '24',
  bRateText: '3.9',
  bMode: 'equal-payment' as LoanMode,
  prepayOn: false,
  prepayPeriodText: '12',
  prepayAmountText: '',
}

const INPUT_FIELDS = [
  'carPriceText',
  'downPercentText',
  'downAmountText',
  'termText',
  'rateText',
  'bDownPercentText',
  'bDownAmountText',
  'bTermText',
  'bRateText',
  'prepayPeriodText',
  'prepayAmountText',
]

Page({
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: '车贷计算',
    kicker: '计算换算',
    desc: '单方案 / 双方案对比 · 提前还款节省利息',
    ...DEFAULTS,
    resultLabel: '每月月供',
    resultMain: '',
    resultRows: [] as CarLoanView['resultRows'],
    schedule: [] as CarLoanView['schedule'],
    scheduleShow: false,
    carloanSummary: '',
    shellState: 'idle',
    hasResult: false,
    error: '',
    posterData: null as IPosterData | null,
    formTouched: false,
  },

  onLoad() {
    const state = this as unknown as CarLoanState
    state.destroyed = false
  },

  onUnload() {
    const state = this as unknown as CarLoanState
    state.destroyed = true
  },

  emptyResult() {
    return {
      resultLabel: '每月月供',
      resultMain: '',
      resultRows: [] as CarLoanView['resultRows'],
      schedule: [] as CarLoanView['schedule'],
      scheduleShow: false,
      carloanSummary: '',
      shellState: 'idle',
      hasResult: false,
      error: '',
      posterData: null as IPosterData | null,
    }
  },

  fail(error: string) {
    this.setData({ ...this.emptyResult(), shellState: 'invalid', error })
  },

  show(view: CarLoanView) {
    this.setData({ shellState: 'done', hasResult: true, error: '', scheduleShow: false, ...view })
  },

  onFieldInput(event: WechatMiniprogram.Input) {
    const field = String(event.currentTarget.dataset.field || '')
    const value = String(event.detail.value ?? '')
    if (INPUT_FIELDS.includes(field)) {
      this.setData({ [field]: value, formTouched: true, ...this.emptyResult() })
    }
  },

  onCalcMode(event: WechatMiniprogram.TouchEvent) {
    const mode = String(event.currentTarget.dataset.mode || '') as CalcMode
    if (mode !== 'single' && mode !== 'compare') {
      return
    }
    tapTick()
    this.setData({ calcMode: mode, formTouched: true, ...this.emptyResult() })
  },

  onMode(event: WechatMiniprogram.TouchEvent) {
    const mode = String(event.currentTarget.dataset.mode || '') as LoanMode
    if (mode !== 'equal-payment' && mode !== 'equal-principal') {
      return
    }
    tapTick()
    this.setData({ mode, formTouched: true, ...this.emptyResult() })
  },

  onBMode(event: WechatMiniprogram.TouchEvent) {
    const mode = String(event.currentTarget.dataset.mode || '') as LoanMode
    if (mode !== 'equal-payment' && mode !== 'equal-principal') {
      return
    }
    tapTick()
    this.setData({ bMode: mode, formTouched: true, ...this.emptyResult() })
  },

  onDownMode(event: WechatMiniprogram.TouchEvent) {
    const mode = String(event.currentTarget.dataset.mode || '') as DownMode
    if (mode !== 'percent' && mode !== 'amount') {
      return
    }
    tapTick()
    this.setData({ downMode: mode, formTouched: true, ...this.emptyResult() })
  },

  onBDownMode(event: WechatMiniprogram.TouchEvent) {
    const mode = String(event.currentTarget.dataset.mode || '') as DownMode
    if (mode !== 'percent' && mode !== 'amount') {
      return
    }
    tapTick()
    this.setData({ bDownMode: mode, formTouched: true, ...this.emptyResult() })
  },

  onPrepayToggle(event: WechatMiniprogram.TouchEvent) {
    const value = String(event.currentTarget.dataset.value || '')
    if (value !== 'on' && value !== 'off') {
      return
    }
    tapTick()
    this.setData({ prepayOn: value === 'on', formTouched: true, ...this.emptyResult() })
  },

  onToggleSchedule() {
    if (!this.data.hasResult) {
      return
    }
    tapTick()
    this.setData({ scheduleShow: !this.data.scheduleShow })
  },

  onExample() {
    tapTick()
    this.setData(
      {
        ...DEFAULTS,
        calcMode: this.data.calcMode,
        prepayOn: this.data.prepayOn,
        carPriceText: '200000',
        prepayAmountText: '50000',
        formTouched: true,
        error: '',
      },
      () => this.onRun(),
    )
  },

  onReset() {
    this.setData({ ...DEFAULTS, ...this.emptyResult(), formTouched: false })
  },

  onRun() {
    const state = this as unknown as CarLoanState
    if (state.destroyed) {
      return
    }
    const carPriceCents = parseCarLoanPrice(this.data.carPriceText)
    if (carPriceCents === null) {
      this.fail('请填写大于 0 的车价')
      return
    }
    const scheme = parseCarLoanScheme(this.data)
    if (!scheme.ok) {
      this.fail(scheme.error)
      return
    }
    if (this.data.calcMode === 'compare') {
      this.runCompare(carPriceCents, scheme.scheme)
      return
    }
    this.runSingle(carPriceCents, scheme.scheme)
  },

  runSingle(carPriceCents: number, scheme: CarLoanSchemeInput) {
    const plan = carLoanPlan({ carPriceCents, ...scheme })
    if (!plan) {
      this.fail('首付需小于车价；期限需为 1–360 个月，利率需在 0–24%')
      return
    }
    if (this.data.prepayOn) {
      this.runPrepay(carPriceCents, scheme)
      return
    }
    this.show(carLoanPlanView(plan))
  },

  runCompare(carPriceCents: number, schemeA: CarLoanSchemeInput) {
    const b = parseCarLoanScheme({
      downMode: this.data.bDownMode,
      downPercentText: this.data.bDownPercentText,
      downAmountText: this.data.bDownAmountText,
      termText: this.data.bTermText,
      rateText: this.data.bRateText,
      mode: this.data.bMode,
    })
    if (!b.ok) {
      this.fail(`方案 B：${b.error}`)
      return
    }
    const result = compareCarLoan({ carPriceCents, schemeA, schemeB: b.scheme })
    if (!result) {
      this.fail('首付需小于车价；期限需为 1–360 个月，利率需在 0–24%')
      return
    }
    this.show(carLoanCompareView(result))
  },

  runPrepay(carPriceCents: number, scheme: CarLoanSchemeInput) {
    if (scheme.termMonths <= 1) {
      this.fail('期限至少 2 个月才能试算提前还款')
      return
    }
    const after = parseInteger(this.data.prepayPeriodText, 1, scheme.termMonths - 1)
    if (after === null) {
      this.fail(`提前还款期数需为 1–${scheme.termMonths - 1} 的整数`)
      return
    }
    const prepayCents = parseCents(this.data.prepayAmountText)
    if (prepayCents === null || prepayCents <= 0) {
      this.fail('提前还款金额需大于 0，最多两位小数')
      return
    }
    const result = prepayCarLoan({
      carPriceCents,
      ...scheme,
      prepayAfterPeriod: after,
      prepayCents,
    })
    if (!result) {
      this.fail('提前还款金额需小于剩余本金')
      return
    }
    this.show(carLoanPrepayView(result))
  },

  onCopy() {
    const text = this.data.carloanSummary
    if (!text) {
      return
    }
    tapTick()
    copyText(text, '车贷摘要已复制')
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
    const match = data.payload.replace(/,/g, '').match(/(\d+(?:\.\d{1,2})?)/)
    if (!match) {
      return false
    }
    const price = Number(match[1])
    if (!Number.isFinite(price) || price <= 0) {
      return false
    }
    this.setData(
      {
        carPriceText: match[1],
        calcMode: 'single',
        prepayOn: false,
        formTouched: true,
        error: '',
      },
      () => this.onRun(),
    )
    return true
  },
})
