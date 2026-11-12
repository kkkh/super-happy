/* ==========================================================================
   日期加减 · 天 / 周 / 月 / 年
   - 方向与数量分离：输入框只收非负整数，减号由方向切换
   - 月 / 年按日历推进，目标月天数不足时钳制到月末
   - 摘要与 silent 执行器同源 dateAddSummary
   ========================================================================== */
import { tapTick } from '../../../../core/utils/haptics'
import {
  DATE_ADD_MAX_AMOUNT,
  addDate,
  dateAddSummary,
  dateAddUnitLabel,
  isDateAddUnit,
  parseISODate,
  todayISO,
  type DateAddUnit,
} from '../../../../core/toolbox/engines/date'
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

interface UnitOption {
  key: DateAddUnit
  label: string
  hint: string
}

type Direction = 'add' | 'subtract'

interface DateAddState {
  destroyed: boolean
}

const UNIT_OPTIONS: UnitOption[] = [
  { key: 'day', label: '天', hint: '按自然日推进，跨月跨年自动进位。' },
  { key: 'week', label: '周', hint: '1 周 = 7 天，按自然日推进。' },
  { key: 'month', label: '月', hint: '按日历月推进，目标月天数不足时自动取月末。' },
  { key: 'year', label: '年', hint: '按日历年推进，2 月 29 日在平年落到 2 月 28 日。' },
]

const DIRECTION_OPTIONS: Array<{ key: Direction; label: string }> = [
  { key: 'add', label: '加' },
  { key: 'subtract', label: '减' },
]

function emptyResult() {
  return {
    resultMain: '',
    resultLabel: '结果日期',
    resultRows: [] as ResultRow[],
    dateAddSummary: '',
    hasResult: false,
    shellState: 'idle' as string,
    error: '',
    posterData: null as IPosterData | null,
  }
}

function unitHintOf(unit: DateAddUnit): string {
  const option = UNIT_OPTIONS.find((item) => item.key === unit)
  return option ? option.hint : UNIT_OPTIONS[0].hint
}

Page({
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: '日期加减',
    kicker: '日期时间',
    desc: '日期 ± 天 / 周 / 月 / 年',
    dateValue: todayISO(),
    direction: 'add' as Direction,
    directionOptions: DIRECTION_OPTIONS,
    amountValue: '1',
    unit: 'day' as DateAddUnit,
    unitOptions: UNIT_OPTIONS,
    unitHint: unitHintOf('day'),
    canRun: true,
    ...emptyResult(),
  },

  onLoad() {
    const state = this as unknown as DateAddState
    state.destroyed = false
  },

  onUnload() {
    const state = this as unknown as DateAddState
    state.destroyed = true
  },

  onDateChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ dateValue: String(event.detail.value || ''), ...emptyResult() }, () =>
      this.updateCanRun(),
    )
  },

  onDirection(event: WechatMiniprogram.TouchEvent) {
    const direction = event.currentTarget.dataset.direction as Direction
    if (direction !== 'add' && direction !== 'subtract') {
      return
    }
    if (direction === this.data.direction) {
      return
    }
    tapTick()
    this.setData({ direction, ...emptyResult() }, () => this.updateCanRun())
  },

  onAmountInput(event: WechatMiniprogram.Input) {
    this.setData({ amountValue: event.detail.value, ...emptyResult() }, () =>
      this.updateCanRun(),
    )
  },

  onUnit(event: WechatMiniprogram.TouchEvent) {
    const unit = event.currentTarget.dataset.unit
    if (!isDateAddUnit(unit) || unit === this.data.unit) {
      return
    }
    tapTick()
    this.setData({ unit, unitHint: unitHintOf(unit), ...emptyResult() }, () =>
      this.updateCanRun(),
    )
  },

  onExample() {
    tapTick()
    this.setData(
      {
        dateValue: '2026-01-31',
        direction: 'add',
        amountValue: '1',
        unit: 'month',
        unitHint: unitHintOf('month'),
        ...emptyResult(),
      },
      () => this.onRun(),
    )
  },

  onReset() {
    this.setData({
      dateValue: todayISO(),
      direction: 'add',
      amountValue: '1',
      unit: 'day',
      unitHint: unitHintOf('day'),
      ...emptyResult(),
      canRun: true,
    })
  },

  /* ---- 草稿：日期、方向、数量与单位；恢复后重算 ---- */
  collectDraftInput(): Record<string, string> {
    return {
      dateValue: this.data.dateValue,
      direction: this.data.direction,
      amountValue: this.data.amountValue,
      unit: this.data.unit,
    }
  },

  applyDraftInput(input: Record<string, string>, mode: string): void {
    const unit = isDateAddUnit(input.unit) ? input.unit : 'day'
    const direction: Direction = mode === 'subtract' || input.direction === 'subtract'
      ? 'subtract'
      : 'add'
    this.setData(
      {
        dateValue: input.dateValue || todayISO(),
        direction,
        amountValue: input.amountValue ?? '1',
        unit,
        unitHint: unitHintOf(unit),
        ...emptyResult(),
      },
      () => {
        this.updateCanRun()
        this.onRun()
      },
    )
  },

  onRun() {
    this.compute()
  },

  onCopy() {
    if (!this.data.dateAddSummary) {
      return
    }
    tapTick()
    void copyText(this.data.dateAddSummary, '日期结果已复制')
  },

  onCopyRow(event: WechatMiniprogram.TouchEvent) {
    const value = String(event.currentTarget.dataset.value || '')
    if (!value) {
      return
    }
    tapTick()
    void copyText(value, '已复制')
  },

  readAmount(): number | null {
    const raw = this.data.amountValue.trim()
    if (!/^\d{1,6}$/.test(raw)) {
      return null
    }
    const value = Number(raw)
    return value <= DATE_ADD_MAX_AMOUNT ? value : null
  },

  updateCanRun() {
    const validDate = parseISODate(this.data.dateValue) !== null
    this.setData({ canRun: validDate && this.readAmount() !== null })
  },

  compute() {
    const state = this as unknown as DateAddState
    if (state.destroyed) {
      return
    }
    const amount = this.readAmount()
    if (amount === null) {
      this.invalidate('数量需为 0–100000 的整数')
      return
    }
    const signed = this.data.direction === 'subtract' ? -amount : amount
    const result = addDate(this.data.dateValue, signed, this.data.unit)
    if (!result) {
      this.invalidate('结果需在 1900-01-01 至 2100-12-31 之间')
      return
    }

    const operation = `${signed < 0 ? '-' : '+'}${Math.abs(signed)} ${dateAddUnitLabel(
      result.unit,
    )}`
    const diffLabel =
      result.diffDays === 0
        ? '0 天'
        : `${result.diffDays > 0 ? '+' : '-'}${Math.abs(result.diffDays)} 天`
    const clampLabel =
      result.unit === 'day' || result.unit === 'week'
        ? '不适用'
        : result.clamped
          ? '已按月末调整'
          : '未触发'
    const summary = dateAddSummary(result)
    const poster: IPosterData = {
      toolName: '日期加减',
      category: '日期时间',
      mainResult: result.endISO,
      resultLabel: '结果日期',
      params: [
        { label: '起始日', value: result.startISO },
        { label: '运算', value: operation },
      ],
      extras: [result.weekday, summary],
    }
    this.setData({
      resultMain: result.endISO,
      resultRows: [
        { k: '起始日', v: result.startISO },
        { k: '运算', v: operation },
        { k: '星期', v: result.weekday },
        { k: '相差天数', v: diffLabel },
        { k: '月末调整', v: clampLabel },
      ],
      dateAddSummary: summary,
      hasResult: true,
      shellState: 'done',
      error: '',
      canRun: true,
      posterData: poster,
    })
  },

  invalidate(message: string) {
    this.setData({
      ...emptyResult(),
      shellState: 'invalid',
      error: message,
    })
  },
})
