/* ==========================================================================
   日期格式 · 格式 / ISO 周 / 闰年
   - 选择日期即自动计算，无「开始计算」按钮
   - 摘要与 silent 执行器同源 dateSummaryText(formatAll)
   ========================================================================== */
import { tapTick } from '../../../../core/utils/haptics'
import {
  dateSummaryText,
  formatAll,
  todayISO,
  type DateFormatAll,
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

interface DateFormatState {
  destroyed: boolean
}

function toRows(result: DateFormatAll): ResultRow[] {
  return [
    { k: '斜杠格式', v: result.slashDate },
    { k: '中文', v: result.cnDate },
    { k: 'ISO 8601', v: result.iso8601 },
    { k: 'Unix 秒', v: String(result.unixSec) },
    { k: 'Unix 毫秒', v: String(result.unixMs) },
    { k: 'ISO 周', v: result.isoWeek },
    { k: '星期', v: result.weekday },
    { k: '当年第几天', v: String(result.dayOfYear) },
    { k: '闰年', v: result.leapYear ? '是' : '否' },
    { k: '当月天数', v: String(result.daysInMonth) },
  ]
}

Page({
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: '日期格式',
    kicker: '日期时间',
    desc: '日期格式 · ISO 周 · 闰年',
    date: todayISO(),
    resultLabel: '日期',
    resultMain: '',
    resultRows: [] as ResultRow[],
    dateSummary: '',
    shellState: 'idle',
    canRun: true,
    hasResult: false,
    error: '',
    posterData: null as IPosterData | null,
  },

  onLoad() {
    const state = this as unknown as DateFormatState
    state.destroyed = false
    this.onRun()
  },

  onUnload() {
    const state = this as unknown as DateFormatState
    state.destroyed = true
  },

  onDateChange(event: WechatMiniprogram.PickerChange) {
    const value = String(event.detail.value || '')
    this.setData({ date: value, error: '' }, () => this.onRun())
  },

  onExample() {
    tapTick()
    this.setData({ date: '2020-02-29', error: '' }, () => this.onRun())
  },

  onReset() {
    this.setData({ date: todayISO(), error: '' }, () => this.onRun())
  },

  /* ---- 草稿：只存日期；恢复后重新格式化 ---- */
  collectDraftInput(): Record<string, string> {
    return { date: this.data.date }
  },

  applyDraftInput(input: Record<string, string>): void {
    this.setData({ date: input.date || todayISO(), error: '' }, () => this.onRun())
  },

  onRun() {
    const state = this as unknown as DateFormatState
    if (state.destroyed) {
      return
    }
    const result = formatAll(this.data.date)
    if (!result) {
      this.setData({
        shellState: 'invalid',
        hasResult: false,
        resultMain: '',
        resultRows: [],
        dateSummary: '',
        error: '请输入 1900–2100 之间的合法日期',
        posterData: null,
      })
      return
    }
    const summary = dateSummaryText(result)
    const poster: IPosterData = {
      toolName: '日期格式',
      category: '日期时间',
      mainResult: result.isoDate,
      resultLabel: '日期',
      params: [{ label: '日期', value: result.isoDate }],
      extras: [
        result.weekday,
        `ISO ${result.isoWeek}`,
        `第 ${result.dayOfYear} 天`,
        result.leapYear ? '闰年' : '平年',
      ],
    }
    this.setData({
      shellState: 'done',
      hasResult: true,
      error: '',
      resultLabel: '日期',
      resultMain: result.isoDate,
      resultRows: toRows(result),
      dateSummary: summary,
      posterData: poster,
    })
  },

  onCopy() {
    const text = this.data.dateSummary
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

  onReceiveWorkflow(data: { payload?: string }): boolean {
    const payload = typeof data?.payload === 'string' ? data.payload : ''
    const match = payload.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
    if (!match) {
      return false
    }
    const iso = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
    if (!formatAll(iso)) {
      return false
    }
    this.setData({ date: iso, error: '' }, () => this.onRun())
    return true
  },
})
