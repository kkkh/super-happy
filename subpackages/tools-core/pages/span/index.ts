/* ==========================================================================
   日期间隔 · 自然日 / 工作日 / 周末
   - 日期零点对齐；可选是否包含开始日
   - 工作日仅排除周末，不含法定节假日与调休
   ========================================================================== */
import {
  addDays,
  countWeekdays,
  dayDiff,
  formatCN,
  serialOfISO,
  todayISO,
  weekdayLabel,
} from '../../lib/date'
import { copyText } from '../../lib/ui'
import { tapTick } from '../../../../core/utils/haptics'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'
import type { IWorkflowData } from '../../../../core/workflow/types'

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * 解析流转载荷为起止日期：
 * - 日期范围：取文本中的前两个合法日期
 * - 单个日期：今天 → 该日期；若日期已过去，则反向为 该日期 → 今天
 * - 纯天数：以当前开始日为锚点向后推算
 */
function resolveSpanDates(
  payload: string,
  fallbackStart: string,
): { start: string; end: string } | null {
  const text = typeof payload === 'string' ? payload.replace(/\s+/g, ' ').trim() : ''
  if (!text) {
    return null
  }
  const dates = text.match(/\d{4}-\d{2}-\d{2}/g) ?? []
  if (dates.length >= 2) {
    const first = dates[0] ?? ''
    const second = dates[1] ?? ''
    if (!first || !second) {
      return null
    }
    const diff = dayDiff(first, second)
    if (diff === null) {
      return null
    }
    return diff >= 0 ? { start: first, end: second } : { start: second, end: first }
  }
  if (dates.length === 1) {
    const date = dates[0] ?? ''
    if (!ISO_DATE_RE.test(date)) {
      return null
    }
    const today = todayISO()
    const forward = dayDiff(today, date)
    if (forward !== null && forward >= 0) {
      return { start: today, end: date }
    }
    const backward = dayDiff(date, today)
    if (backward !== null && backward >= 0) {
      return { start: date, end: today }
    }
    return null
  }
  if (/^\d{1,5}$/.test(text)) {
    const start = fallbackStart || todayISO()
    const end = addDays(start, Number(text))
    if (end && dayDiff(start, end) !== null) {
      return { start, end }
    }
  }
  return null
}

Page({
  /* 此处是处理工具页分享与深链参数校验的边界 */
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: '日期间隔',
    kicker: '日期时间',
    desc: '自然日 · 工作日 · 周数',
    start: '',
    end: '',
    startLabel: '',
    endLabel: '',
    startWeek: '',
    endWeek: '',
    includeStart: false,
    excludeWeekend: true,
    /** 用户是否手动调整过表单：决定接收端是否需要弹「覆盖确认」 */
    formTouched: false,
    hasResult: false,
    error: '',
    calendarText: '',
    calendarDays: 0,
    workText: '',
    weekendText: '',
    weekText: '',
    copyPayload: '',
    posterData: null as IPosterData | null,
  },

  onLoad() {
    const start = todayISO()
    const end = addDays(start, 30) ?? start
    this.setData({ start, end }, () => {
      this.recalculate()
    })
  },

  onStartChange(event: WechatMiniprogram.PickerChange) {
    const start = String(event.detail.value)
    this.setData({ start, formTouched: true }, () => {
      this.recalculate()
    })
  },

  onEndChange(event: WechatMiniprogram.PickerChange) {
    const end = String(event.detail.value)
    this.setData({ end, formTouched: true }, () => {
      this.recalculate()
    })
  },

  onIncludeStart(event: { detail: { value: boolean } }) {
    this.setData({ includeStart: event.detail.value, formTouched: true }, () => {
      this.recalculate()
    })
  },

  onExcludeWeekend(event: { detail: { value: boolean } }) {
    this.setData({ excludeWeekend: event.detail.value, formTouched: true }, () => {
      this.recalculate()
    })
  },

  onQuick(event: WechatMiniprogram.TouchEvent) {
    const days = Number(event.currentTarget.dataset.days)
    if (!Number.isFinite(days)) {
      return
    }
    tapTick()
    const start = this.data.start || todayISO()
    const end = addDays(start, days) ?? start
    this.setData({ start, end, formTouched: true }, () => {
      this.recalculate()
    })
  },

  onExample() {
    tapTick()
    const start = todayISO()
    this.setData(
      {
        start,
        end: '2027-01-01',
        includeStart: false,
        excludeWeekend: true,
        formTouched: true,
      },
      () => {
        this.recalculate()
      },
    )
  },

  onReset() {
    const start = todayISO()
    const end = addDays(start, 30) ?? start
    this.setData(
      {
        start,
        end,
        includeStart: false,
        excludeWeekend: true,
        formTouched: false,
      },
      () => {
        this.recalculate()
      },
    )
  },

  onCopy() {
    copyText(this.data.copyPayload, '日期间隔结果已复制')
  },

  /**
   * Workflow 接收端：
   * - 支持单日期、日期范围、纯天数三种载荷
   * - 应用来源页的「包含开始日 / 排除周末」上下文
   * - 写入后立即复用 recalculate，不复制任何计算逻辑
   */
  onReceiveWorkflow(data: IWorkflowData): boolean {
    if (!data || data.type === 'image' || typeof data.payload !== 'string') {
      return false
    }
    const dates = resolveSpanDates(data.payload, this.data.start || todayISO())
    if (!dates) {
      return false
    }
    const patch: Record<string, string | boolean> = {
      start: dates.start,
      end: dates.end,
      formTouched: true,
      error: '',
    }
    const includeStart = data.context?.spanIncludeStart
    if (typeof includeStart === 'boolean') {
      patch.includeStart = includeStart
    }
    const excludeWeekend = data.context?.spanExcludeWeekend
    if (typeof excludeWeekend === 'boolean') {
      patch.excludeWeekend = excludeWeekend
    }
    this.setData(patch, () => {
      this.recalculate()
    })
    return true
  },

  recalculate() {
    const start = this.data.start
    const end = this.data.end
    if (!start || !end) {
      return
    }
    const diff = dayDiff(start, end)
    if (diff === null) {
      this.setData({ hasResult: false, error: '日期格式不正确' })
      return
    }
    if (diff < 0) {
      this.setData({ hasResult: false, error: '结束日不能早于开始日' })
      return
    }

    const totalInclusive = diff + 1
    const startSerial = serialOfISO(start) ?? 0
    const endSerial = serialOfISO(end) ?? 0
    const weekdayInclusive = countWeekdays(startSerial, endSerial)
    const weekdayExclusive = diff > 0 ? countWeekdays(startSerial + 1, endSerial) : 0
    const weekendInclusive = totalInclusive - weekdayInclusive
    const selectedDays = this.data.includeStart ? totalInclusive : diff
    const selectedWeekdays = this.data.excludeWeekend
      ? this.data.includeStart
        ? weekdayInclusive
        : weekdayExclusive
      : selectedDays
    const selectedWeekend = this.data.includeStart
      ? weekendInclusive
      : Math.max(0, diff - weekdayExclusive)

    const calendarText = `${selectedDays} 天`
    const workText = `${selectedWeekdays} 天`
    const weekendText = `${selectedWeekend} 天`
    const weekText = selectedDays === 0 ? '0 周' : `${(selectedDays / 7).toFixed(1)} 周`
    const copy = [
      '日期间隔',
      `开始：${formatCN(start)}（${weekdayLabel(startSerial)}）`,
      `结束：${formatCN(end)}（${weekdayLabel(endSerial)}）`,
      `自然日：${calendarText}`,
      `工作日：${workText}`,
      `周末：${weekendText}`,
    ].join('\n')
    const poster: IPosterData = {
      toolName: '日期间隔',
      category: '日期时间',
      mainResult: calendarText,
      resultLabel: '自然日',
      params: [
        { label: '开始日', value: formatCN(start) },
        { label: '结束日', value: formatCN(end) },
        { label: '含开始日', value: this.data.includeStart ? '是' : '否' },
        { label: '排除周末', value: this.data.excludeWeekend ? '是' : '否' },
      ],
      extras: [
        `工作日 ${workText}`,
        `周末 ${weekendText}`,
        `约合 ${weekText}`,
      ],
    }

    this.setData({
      hasResult: true,
      error: '',
      startLabel: formatCN(start),
      endLabel: formatCN(end),
      startWeek: weekdayLabel(startSerial),
      endWeek: weekdayLabel(endSerial),
      calendarText,
      calendarDays: selectedDays,
      workText,
      weekendText,
      weekText,
      copyPayload: copy,
      posterData: poster,
    })
  },
})
