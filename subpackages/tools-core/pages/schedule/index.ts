/* ==========================================================================
   工期排期 · 工作日推进
   - 开始日 + 工期 → 结束日；可选含开始日、跳过周末、自定义休息日
   - 全部按 UTC 日序号推进，不依赖本机时区
   ========================================================================== */
import { tapTick } from '../../../../core/utils/haptics'
import {
  MAX_WORKDAYS,
  addWorkdays,
  parseISODate,
  todayISO,
  weekdayLabel,
  serialOfISO,
  type WorkdayEntry,
  type WorkdayResult,
} from '../../../../core/toolbox/engines/date'
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

interface ListRow {
  date: string
  weekday: string
  label: string
  kind: string
}

interface ScheduleState {
  destroyed: boolean
}

const LIST_LIMIT = 60
const HOLIDAY_LIMIT = 10
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function parseHolidays(text: string): { holidays: string[]; error: string } {
  const lines = text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length > HOLIDAY_LIMIT) {
    return { holidays: [], error: `自定义休息日最多 ${HOLIDAY_LIMIT} 个` }
  }
  const holidays: string[] = []
  for (const line of lines) {
    if (!DATE_RE.test(line) || !parseISODate(line)) {
      return { holidays: [], error: `休息日格式需为 YYYY-MM-DD：${line}` }
    }
    if (!holidays.includes(line)) {
      holidays.push(line)
    }
  }
  return { holidays, error: '' }
}

function toListRows(entries: WorkdayEntry[]): ListRow[] {
  return entries.map((entry) => ({
    date: entry.date,
    weekday: entry.weekday,
    label: `${entry.date} ${entry.weekday}`,
    kind: entry.holiday ? '休息日' : entry.workday ? '工作日' : '周末',
  }))
}

function summaryText(
  result: WorkdayResult,
  includeStart: boolean,
  skipWeekend: boolean,
  holidayCount: number,
): string {
  const parts = [
    `${result.workdays} 个工作日 → ${result.endISO}`,
    `跨越 ${result.calendarDays} 个自然日`,
    includeStart ? '含开始日' : '不含开始日',
    skipWeekend ? '跳过周末' : '周末计工作日',
  ]
  if (holidayCount > 0) {
    parts.push(`自定义休息日 ${holidayCount} 个`)
  }
  return parts.join('；')
}

Page({
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: '工期排期',
    kicker: '日期时间',
    desc: '开始日 + 工作日 · 跳周末 · 自定义休息日',
    startDate: todayISO(),
    workdaysText: '5',
    includeStart: true,
    skipWeekend: true,
    holidaysText: '',
    showList: false,
    resultLabel: '结束日期',
    resultMain: '',
    resultRows: [] as ResultRow[],
    scheduleSummary: '',
    listRows: [] as ListRow[],
    visibleList: [] as ListRow[],
    listNote: '',
    shellState: 'idle',
    hasResult: false,
    error: '',
    posterData: null as IPosterData | null,
    formTouched: false,
  },

  onLoad() {
    const state = this as unknown as ScheduleState
    state.destroyed = false
  },

  onUnload() {
    const state = this as unknown as ScheduleState
    state.destroyed = true
  },

  onDateChange(event: WechatMiniprogram.PickerChange) {
    this.setData(
      { startDate: String(event.detail.value || ''), formTouched: true },
      () => this.clearResult(),
    )
  },

  onFieldInput(event: WechatMiniprogram.Input) {
    const field = String(event.currentTarget.dataset.field || '')
    const value = String(event.detail.value ?? '')
    if (field === 'workdaysText') {
      this.setData({ workdaysText: value, formTouched: true }, () => this.invalidateResult())
      return
    }
    if (field === 'holidaysText') {
      this.setData({ holidaysText: value, formTouched: true }, () => this.invalidateResult())
    }
  },

  onToggle(event: { currentTarget: { dataset: { field?: string } }; detail: { value: boolean } }) {
    const field = String(event.currentTarget.dataset.field || '')
    const checked = Boolean(event.detail.value)
    if (field === 'includeStart') {
      this.setData({ includeStart: checked, formTouched: true }, () => this.clearResult())
      return
    }
    if (field === 'skipWeekend') {
      this.setData({ skipWeekend: checked, formTouched: true }, () => this.clearResult())
    }
  },

  onToggleList() {
    tapTick()
    this.setData({ showList: !this.data.showList })
  },

  onExample() {
    tapTick()
    this.setData(
      {
        startDate: '2026-01-05',
        workdaysText: '5',
        includeStart: true,
        skipWeekend: true,
        holidaysText: '',
        showList: false,
        formTouched: true,
      },
      () => this.clearResult(),
    )
  },

  onReset() {
    this.setData(
      {
        startDate: todayISO(),
        workdaysText: '5',
        includeStart: true,
        skipWeekend: true,
        holidaysText: '',
        showList: false,
        formTouched: false,
      },
      () => this.clearResult(),
    )
  },

  clearResult() {
    this.setData({
      shellState: 'idle',
      hasResult: false,
      resultMain: '',
      resultRows: [],
      scheduleSummary: '',
      listRows: [],
      visibleList: [],
      listNote: '',
      showList: false,
      error: '',
      posterData: null,
    })
  },

  invalidateResult() {
    if (!this.data.hasResult && !this.data.error) {
      return
    }
    this.clearResult()
  },

  onRun() {
    const state = this as unknown as ScheduleState
    if (state.destroyed) {
      return
    }
    const workdays = Number(this.data.workdaysText)
    if (!Number.isInteger(workdays) || workdays < 1 || workdays > MAX_WORKDAYS) {
      this.setData({
        shellState: 'invalid',
        hasResult: false,
        resultMain: '',
        resultRows: [],
        scheduleSummary: '',
        listRows: [],
        visibleList: [],
        listNote: '',
        error: `工期需为 1–${MAX_WORKDAYS} 的整数`,
        posterData: null,
      })
      return
    }
    const parsedHolidays = parseHolidays(this.data.holidaysText)
    if (parsedHolidays.error) {
      this.setData({
        shellState: 'invalid',
        hasResult: false,
        resultMain: '',
        resultRows: [],
        scheduleSummary: '',
        listRows: [],
        visibleList: [],
        listNote: '',
        error: parsedHolidays.error,
        posterData: null,
      })
      return
    }

    const result = addWorkdays(this.data.startDate, workdays, {
      includeStart: this.data.includeStart,
      skipWeekend: this.data.skipWeekend,
      holidays: parsedHolidays.holidays,
    })
    if (!result) {
      this.setData({
        shellState: 'invalid',
        hasResult: false,
        resultMain: '',
        resultRows: [],
        scheduleSummary: '',
        listRows: [],
        visibleList: [],
        listNote: '',
        error: '请输入 1900–2100 之间的合法开始日期',
        posterData: null,
      })
      return
    }

    const summary = summaryText(
      result,
      this.data.includeStart,
      this.data.skipWeekend,
      parsedHolidays.holidays.length,
    )
    const listRows = toListRows(result.entries)
    const visibleList = listRows.slice(0, LIST_LIMIT)
    const listNote =
      listRows.length > LIST_LIMIT
        ? `仅展示前 ${LIST_LIMIT} 天，共 ${listRows.length} 天`
        : `共 ${listRows.length} 天`
    const restDays = result.entries.filter((entry) => !entry.workday).length
    const startSerial = serialOfISO(this.data.startDate)
    const endSerial = startSerial === null ? null : startSerial + result.calendarDays - 1
    const poster: IPosterData = {
      toolName: '工期排期',
      category: '日期时间',
      mainResult: result.endISO,
      resultLabel: '结束日期',
      params: [{ label: '开始', value: this.data.startDate }],
      extras: [
        `${result.workdays} 个工作日`,
        `跨越 ${result.calendarDays} 个自然日`,
        this.data.skipWeekend ? '跳过周末' : '周末计工作日',
        endSerial === null ? '' : weekdayLabel(endSerial),
      ].filter(Boolean),
    }
    this.setData({
      shellState: 'done',
      hasResult: true,
      error: '',
      resultLabel: '结束日期',
      resultMain: result.endISO,
      resultRows: [
        { k: '结束星期', v: endSerial === null ? '' : weekdayLabel(endSerial) },
        { k: '跨越自然日', v: `${result.calendarDays} 天` },
        { k: '实际工作日', v: `${result.workdays} 个` },
        { k: '休息日跳过', v: `${restDays} 天` },
      ],
      scheduleSummary: summary,
      listRows,
      visibleList,
      listNote,
      posterData: poster,
    })
  },

  onCopy() {
    const text = this.data.scheduleSummary
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
    const match = data.payload.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
    if (!match) {
      return false
    }
    const iso = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
    if (!parseISODate(iso)) {
      return false
    }
    this.setData({ startDate: iso, formTouched: true, error: '' }, () => this.onRun())
    return true
  },
})
