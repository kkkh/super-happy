/* ==========================================================================
   每日健康 · 饮水 / 热量 / 保质期
   - 三模式独立输入与结果；切换恢复各自结果
   - 健康建议仅供参考，不构成医疗意见
   ========================================================================== */
import { tapTick } from '../../../../core/utils/haptics'
import { todayISO } from '../../../../core/toolbox/engines/date'
import {
  addShelfLife,
  kcalToKj,
  kjToKcal,
  waterTarget,
  type ActivityLevel,
  type ShelfUnit,
} from '../../lib/wellness'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'
import { copyText } from '../../lib/ui'

type WellnessMode = 'water' | 'calorie' | 'shelf'
type CalorieDirection = 'kcal-kj' | 'kj-kcal'

interface ResultRow {
  k: string
  v: string
}

interface ModeView {
  label: string
  main: string
  rows: ResultRow[]
  summary: string
  poster: IPosterData
}

interface WellnessState {
  destroyed: boolean
  modeResults: Partial<Record<WellnessMode, ModeView>>
}

const MODE_OPTIONS: Array<{ key: WellnessMode; label: string }> = [
  { key: 'water', label: '饮水' },
  { key: 'calorie', label: '热量' },
  { key: 'shelf', label: '保质期' },
]

const ACTIVITY_OPTIONS: Array<{ key: ActivityLevel; label: string; extra: number }> = [
  { key: 'sedentary', label: '久坐', extra: 0 },
  { key: 'medium', label: '中等', extra: 300 },
  { key: 'high', label: '高强度', extra: 600 },
]

const UNIT_OPTIONS: Array<{ key: ShelfUnit; label: string }> = [
  { key: 'day', label: '天' },
  { key: 'month', label: '月' },
  { key: 'year', label: '年' },
]

Page({
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: '每日健康',
    kicker: '生活健康',
    desc: '饮水 · 热量 · 保质期',
    activeMode: 'water' as WellnessMode,
    modeOptions: MODE_OPTIONS,
    activityOptions: ACTIVITY_OPTIONS,
    unitOptions: UNIT_OPTIONS,
    waterWeight: '60',
    waterActivity: 'medium' as ActivityLevel,
    calorieValue: '1000',
    calorieDirection: 'kcal-kj' as CalorieDirection,
    shelfProduction: todayISO(),
    shelfAmount: '1',
    shelfUnit: 'month' as ShelfUnit,
    resultLabel: '建议饮水',
    resultMain: '',
    resultRows: [] as ResultRow[],
    resultText: '',
    wellnessSummary: '',
    stale: false,
    canRun: true,
    shellState: 'idle',
    hasResult: false,
    error: '',
    posterData: null as IPosterData | null,
  },

  onLoad() {
    const state = this as unknown as WellnessState
    state.destroyed = false
    state.modeResults = {}
    this.refreshCanRun()
  },

  onUnload() {
    const state = this as unknown as WellnessState
    state.destroyed = true
    state.modeResults = {}
  },

  onFieldInput(event: WechatMiniprogram.Input) {
    const field = String(event.currentTarget.dataset.field || '')
    if (!field) {
      return
    }
    this.setData({ [field]: String(event.detail.value || ''), stale: false, error: '' }, () => {
      this.invalidateCurrent()
      this.refreshCanRun()
    })
  },

  onActivity(event: WechatMiniprogram.TouchEvent) {
    const key = event.currentTarget.dataset.key as ActivityLevel
    if (!ACTIVITY_OPTIONS.some((item) => item.key === key) || key === this.data.waterActivity) {
      return
    }
    tapTick()
    this.setData({ waterActivity: key }, () => {
      this.invalidateCurrent()
      this.refreshCanRun()
    })
  },

  onDirection(event: WechatMiniprogram.TouchEvent) {
    const key = event.currentTarget.dataset.key as CalorieDirection
    if ((key !== 'kcal-kj' && key !== 'kj-kcal') || key === this.data.calorieDirection) {
      return
    }
    tapTick()
    this.setData({ calorieDirection: key }, () => {
      this.invalidateCurrent()
      this.refreshCanRun()
    })
  },

  onUnit(event: WechatMiniprogram.TouchEvent) {
    const key = event.currentTarget.dataset.key as ShelfUnit
    if (!UNIT_OPTIONS.some((item) => item.key === key) || key === this.data.shelfUnit) {
      return
    }
    tapTick()
    this.setData({ shelfUnit: key }, () => {
      this.invalidateCurrent()
      this.refreshCanRun()
    })
  },

  onProductionChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ shelfProduction: String(event.detail.value || '') }, () => {
      this.invalidateCurrent()
      this.refreshCanRun()
    })
  },

  onModeTap(event: WechatMiniprogram.TouchEvent) {
    const mode = event.currentTarget.dataset.mode as WellnessMode
    if (!MODE_OPTIONS.some((item) => item.key === mode) || mode === this.data.activeMode) {
      return
    }
    tapTick()
    const state = this as unknown as WellnessState
    const view = state.modeResults[mode]
    this.setData(
      view
        ? {
            activeMode: mode,
            stale: false,
            error: '',
            hasResult: true,
            shellState: 'done',
            resultLabel: view.label,
            resultMain: view.main,
            resultRows: view.rows,
            resultText: view.summary,
            wellnessSummary: view.summary,
            posterData: view.poster,
          }
        : {
            activeMode: mode,
            stale: false,
            error: '',
            hasResult: false,
            shellState: 'idle',
            resultLabel: mode === 'water' ? '建议饮水' : mode === 'shelf' ? '到期日' : '换算结果',
            resultMain: '',
            resultRows: [],
            resultText: '',
            wellnessSummary: '',
            posterData: null,
          },
      () => this.refreshCanRun(),
    )
  },

  onExample() {
    tapTick()
    if (this.data.activeMode === 'water') {
      this.setData({ waterWeight: '60', waterActivity: 'medium' }, () => this.runAndStore())
      return
    }
    if (this.data.activeMode === 'calorie') {
      this.setData({ calorieValue: '1000', calorieDirection: 'kcal-kj' }, () => this.runAndStore())
      return
    }
    this.setData({ shelfProduction: '2026-01-31', shelfAmount: '1', shelfUnit: 'month' }, () =>
      this.runAndStore(),
    )
  },

  onReset() {
    const state = this as unknown as WellnessState
    state.modeResults = {}
    this.setData({
      waterWeight: '60',
      waterActivity: 'medium',
      calorieValue: '1000',
      calorieDirection: 'kcal-kj',
      shelfProduction: todayISO(),
      shelfAmount: '1',
      shelfUnit: 'month',
      resultLabel: this.data.activeMode === 'water' ? '建议饮水' : this.data.activeMode === 'shelf' ? '到期日' : '换算结果',
      resultMain: '',
      resultRows: [],
      resultText: '',
      wellnessSummary: '',
      stale: false,
      hasResult: false,
      shellState: 'idle',
      error: '',
      posterData: null,
    })
    this.refreshCanRun()
  },

  onCopy() {
    if (!this.data.resultText) {
      return
    }
    tapTick()
    copyText(this.data.resultText, '结果已复制')
  },

  onRun() {
    this.runAndStore()
  },

  runAndStore() {
    const state = this as unknown as WellnessState
    if (state.destroyed) {
      return
    }
    const mode = this.data.activeMode
    const view = mode === 'water' ? this.runWater() : mode === 'calorie' ? this.runCalorie() : this.runShelf()
    if (!view) {
      return
    }
    state.modeResults[mode] = view
    this.setData({
      resultLabel: view.label,
      resultMain: view.main,
      resultRows: view.rows,
      resultText: view.summary,
      wellnessSummary: view.summary,
      hasResult: true,
      stale: false,
      shellState: 'done',
      error: '',
      posterData: view.poster,
    })
  },

  invalidateCurrent() {
    const state = this as unknown as WellnessState
    delete state.modeResults[this.data.activeMode]
    if (!this.data.hasResult) {
      return
    }
    this.setData({
      hasResult: false,
      shellState: 'idle',
      stale: true,
      resultMain: '',
      resultRows: [],
      resultText: '',
      wellnessSummary: '',
      posterData: null,
    })
  },

  refreshCanRun() {
    if (this.data.activeMode === 'water') {
      const weight = Number(this.data.waterWeight)
      this.setData({ canRun: Number.isFinite(weight) && weight > 0 && weight <= 300 })
      return
    }
    if (this.data.activeMode === 'calorie') {
      const value = Number(this.data.calorieValue)
      this.setData({ canRun: Number.isFinite(value) && value >= 0 })
      return
    }
    this.setData({ canRun: /^\d{4}-\d{2}-\d{2}$/.test(this.data.shelfProduction) })
  },

  fail(message: string) {
    this.setData({
      shellState: 'invalid',
      hasResult: false,
      stale: false,
      error: message,
      resultMain: '',
      resultRows: [],
      resultText: '',
      wellnessSummary: '',
      posterData: null,
    })
  },

  runWater(): ModeView | null {
    const weight = Number(this.data.waterWeight)
    const result = waterTarget(weight, this.data.waterActivity)
    if (!result.ok) {
      this.fail(result.code === 'weight' ? '请输入 0–300 之间的体重' : '请选择活动量')
      return null
    }
    const activity =
      ACTIVITY_OPTIONS.find((item) => item.key === this.data.waterActivity) ?? ACTIVITY_OPTIONS[1]
    const summary = `建议饮水 ${result.ml} ml（约 ${result.cups} 杯，200ml/杯，${activity.label}活动）`
    const poster: IPosterData = {
      toolName: '每日健康',
      category: '生活健康',
      mainResult: `${result.ml} ml`,
      resultLabel: '建议饮水',
      params: [
        { label: '体重', value: `${weight} kg` },
        { label: '活动量', value: activity.label },
      ],
      extras: [`约 ${result.cups} 杯`, '200ml/杯'],
    }
    return {
      label: '建议饮水',
      main: `${result.ml} ml`,
      rows: [
        { k: '建议饮水', v: `${result.ml} ml` },
        { k: '杯数', v: `${result.cups} 杯（200ml/杯）` },
        { k: '活动量', v: activity.label },
      ],
      summary,
      poster,
    }
  },

  runCalorie(): ModeView | null {
    const value = Number(this.data.calorieValue)
    if (!Number.isFinite(value) || value < 0) {
      this.fail('请输入大于等于 0 的数值')
      return null
    }
    const toKj = this.data.calorieDirection === 'kcal-kj'
    const converted = toKj ? kcalToKj(value) : kjToKcal(value)
    if (converted === null) {
      this.fail('数值超出可换算范围')
      return null
    }
    const main = toKj ? `${converted} kJ` : `${converted} kcal`
    const summary = toKj ? `${value} kcal = ${converted} kJ` : `${value} kJ = ${converted} kcal`
    const poster: IPosterData = {
      toolName: '每日健康',
      category: '生活健康',
      mainResult: main,
      resultLabel: '换算结果',
      params: [{ label: '方向', value: toKj ? '千卡 → 千焦' : '千焦 → 千卡' }],
      extras: ['1 kcal = 4.184 kJ'],
    }
    return {
      label: '换算结果',
      main,
      rows: [
        { k: '千卡', v: toKj ? `${value} kcal` : `${converted} kcal` },
        { k: '千焦', v: toKj ? `${converted} kJ` : `${value} kJ` },
        { k: '换算系数', v: '1 kcal = 4.184 kJ' },
      ],
      summary,
      poster,
    }
  },

  runShelf(): ModeView | null {
    const amount = Number(this.data.shelfAmount)
    const result = addShelfLife(this.data.shelfProduction, amount, this.data.shelfUnit)
    if (!result.ok) {
      this.fail(
        result.code === 'date'
          ? '请选择合法的生产日期'
          : result.code === 'amount'
            ? '保质期需为 1–36500 的整数'
            : '请选择保质期单位',
      )
      return null
    }
    const unitLabel =
      UNIT_OPTIONS.find((item) => item.key === this.data.shelfUnit)?.label ?? ''
    const remainingText =
      result.remainingDays < 0
        ? `已过期 ${Math.abs(result.remainingDays)} 天`
        : result.remainingDays === 0
          ? '今天到期'
          : `剩余 ${result.remainingDays} 天`
    const summary = `到期日 ${result.expiryISO} · ${remainingText}`
    const poster: IPosterData = {
      toolName: '每日健康',
      category: '生活健康',
      mainResult: result.expiryISO,
      resultLabel: '到期日',
      params: [
        { label: '生产日期', value: this.data.shelfProduction },
        { label: '保质期', value: `${amount} ${unitLabel}` },
      ],
      extras: [remainingText],
    }
    return {
      label: '到期日',
      main: result.expiryISO,
      rows: [
        { k: '生产日期', v: this.data.shelfProduction },
        { k: '保质期', v: `${amount} ${unitLabel}` },
        { k: '到期日', v: result.expiryISO },
        { k: '剩余', v: remainingText },
      ],
      summary,
      poster,
    }
  },
})
