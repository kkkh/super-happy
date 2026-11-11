/* ==========================================================================
   工时与请假 · 工时拆分 / 加班费 / 请假天数
   - 两个模式独立输入与结果；切换恢复各自结果
   - 时薪只在填写时参与试算，并局部提示“薪资试算仅供参考”
   ========================================================================== */
import { tapTick } from '../../../../core/utils/haptics'
import { formatCents, parseCents } from '../../../../core/toolbox/engines/money'
import {
  isWeekend,
  isoFromSerial,
  parseISODate,
  serialOfISO,
  todayISO,
  weekdayLabel,
} from '../../../../core/toolbox/engines/date'
import {
  calcLeaveDays,
  calcOvertimePay,
  calcWorkMinutes,
  formatHours,
} from '../../lib/worktime'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'
import { copyText } from '../../lib/ui'

type WorkMode = 'work' | 'leave'

interface ResultRow {
  k: string
  v: string
}

interface ModeView {
  label: string
  main: string
  rows: ResultRow[]
  details: string[]
  summary: string
  wageNote: string
  poster: IPosterData
}

interface WorktimeState {
  destroyed: boolean
  modeResults: Partial<Record<WorkMode, ModeView>>
}

const MODE_OPTIONS: Array<{ key: WorkMode; label: string }> = [
  { key: 'work', label: '工时' },
  { key: 'leave', label: '请假' },
]

Page({
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: '工时与请假',
    kicker: '职场辅助',
    desc: '工时拆分 · 加班费 · 请假天数',
    activeMode: 'work' as WorkMode,
    modeOptions: MODE_OPTIONS,
    startTime: '09:00',
    endTime: '18:30',
    breakMinutes: '60',
    standardHours: '8',
    multiplier: '1.5',
    hourlyWage: '',
    leaveStart: todayISO(),
    leaveEnd: todayISO(),
    includeWeekend: false,
    halfDay: false,
    resultLabel: '总工时',
    resultMain: '',
    resultRows: [] as ResultRow[],
    detailRows: [] as string[],
    resultText: '',
    worktimeSummary: '',
    wageNote: '',
    stale: false,
    canRun: true,
    shellState: 'idle',
    hasResult: false,
    error: '',
    posterData: null as IPosterData | null,
  },

  onLoad() {
    const state = this as unknown as WorktimeState
    state.destroyed = false
    state.modeResults = {}
    this.refreshCanRun()
  },

  onUnload() {
    const state = this as unknown as WorktimeState
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

  onModeTap(event: WechatMiniprogram.TouchEvent) {
    const mode = event.currentTarget.dataset.mode as WorkMode
    if (!MODE_OPTIONS.some((item) => item.key === mode) || mode === this.data.activeMode) {
      return
    }
    tapTick()
    const state = this as unknown as WorktimeState
    const view = state.modeResults[mode]
    if (view) {
      this.setData(
        {
          activeMode: mode,
          stale: false,
          error: '',
          hasResult: true,
          shellState: 'done',
          resultLabel: view.label,
          resultMain: view.main,
          resultRows: view.rows,
          detailRows: view.details,
          resultText: view.summary,
          worktimeSummary: view.summary,
          wageNote: view.wageNote,
          posterData: view.poster,
        },
        () => this.refreshCanRun(),
      )
    } else {
      this.setData(
        {
          activeMode: mode,
          stale: false,
          error: '',
          hasResult: false,
          shellState: 'idle',
          resultLabel: mode === 'leave' ? '请假天数' : '总工时',
          resultMain: '',
          resultRows: [],
          detailRows: [],
          resultText: '',
          worktimeSummary: '',
          wageNote: '',
          posterData: null,
        },
        () => this.refreshCanRun(),
      )
    }
  },

  onStartChange(event: WechatMiniprogram.PickerChange) {
    this.onDateField('leaveStart', String(event.detail.value || ''))
  },

  onEndChange(event: WechatMiniprogram.PickerChange) {
    this.onDateField('leaveEnd', String(event.detail.value || ''))
  },

  onDateField(field: string, value: string) {
    this.setData({ [field]: value, stale: false, error: '' }, () => {
      this.invalidateCurrent()
      this.refreshCanRun()
    })
  },

  onToggle(event: { currentTarget: { dataset: { field?: string } }; detail: { value: boolean } }) {
    const field = String(event.currentTarget.dataset.field || '')
    if (field !== 'includeWeekend' && field !== 'halfDay') {
      return
    }
    this.setData({ [field]: Boolean(event.detail.value), stale: false, error: '' }, () => {
      this.invalidateCurrent()
      this.refreshCanRun()
    })
  },

  onExample() {
    tapTick()
    if (this.data.activeMode === 'work') {
      this.setData(
        {
          startTime: '09:00',
          endTime: '18:30',
          breakMinutes: '60',
          standardHours: '8',
          multiplier: '1.5',
          hourlyWage: '',
        },
        () => {
          this.refreshCanRun()
          this.onRun()
        },
      )
      return
    }
    this.setData(
      { leaveStart: '2026-11-06', leaveEnd: '2026-11-09', includeWeekend: false, halfDay: false },
      () => {
        this.refreshCanRun()
        this.onRun()
      },
    )
  },

  onReset() {
    const state = this as unknown as WorktimeState
    state.modeResults = {}
    this.setData({
      startTime: '09:00',
      endTime: '18:30',
      breakMinutes: '60',
      standardHours: '8',
      multiplier: '1.5',
      hourlyWage: '',
      leaveStart: todayISO(),
      leaveEnd: todayISO(),
      includeWeekend: false,
      halfDay: false,
      resultLabel: this.data.activeMode === 'leave' ? '请假天数' : '总工时',
      resultMain: '',
      resultRows: [],
      detailRows: [],
      resultText: '',
      worktimeSummary: '',
      wageNote: '',
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
    const state = this as unknown as WorktimeState
    if (state.destroyed) {
      return
    }
    const view = this.data.activeMode === 'work' ? this.runWork() : this.runLeave()
    if (!view) {
      return
    }
    state.modeResults[this.data.activeMode] = view
    this.setData({
      resultLabel: view.label,
      resultMain: view.main,
      resultRows: view.rows,
      detailRows: view.details,
      resultText: view.summary,
      worktimeSummary: view.summary,
      wageNote: view.wageNote,
      hasResult: true,
      stale: false,
      shellState: 'done',
      error: '',
      posterData: view.poster,
    })
  },

  invalidateCurrent() {
    const state = this as unknown as WorktimeState
    delete state.modeResults[this.data.activeMode]
    if (!this.data.hasResult) {
      return
    }
    this.setData({
      hasResult: false,
      shellState: 'idle',
      stale: true,
      resultLabel: this.data.activeMode === 'leave' ? '请假天数' : '总工时',
      resultMain: '',
      resultRows: [],
      detailRows: [],
      resultText: '',
      worktimeSummary: '',
      wageNote: '',
      posterData: null,
    })
  },

  refreshCanRun() {
    if (this.data.activeMode === 'work') {
      const work = calcWorkMinutes(
        this.data.startTime,
        this.data.endTime,
        this.data.breakMinutes,
        this.data.standardHours,
      )
      const wage = this.data.hourlyWage.trim()
      const wageCents = wage ? parseCents(wage) : null
      const multiplier = Number(this.data.multiplier)
      this.setData({
        canRun:
          work.ok &&
          (wage === '' || (wageCents !== null && wageCents > 0)) &&
          Number.isFinite(multiplier) &&
          multiplier >= 0 &&
          multiplier <= 10,
      })
      return
    }
    this.setData({
      canRun: Boolean(parseISODate(this.data.leaveStart) && parseISODate(this.data.leaveEnd)),
    })
  },

  fail(message: string) {
    this.setData({
      shellState: 'invalid',
      hasResult: false,
      stale: false,
      error: message,
      resultMain: '',
      resultRows: [],
      detailRows: [],
      resultText: '',
      worktimeSummary: '',
      wageNote: '',
      posterData: null,
    })
  },

  runWork(): ModeView | null {
    const result = calcWorkMinutes(
      this.data.startTime,
      this.data.endTime,
      this.data.breakMinutes,
      this.data.standardHours,
    )
    if (!result.ok) {
      this.fail(
        result.code === 'time'
          ? '请填写合法的上下班时间'
          : result.code === 'break'
            ? '休息时长不能超过在岗时长'
            : '标准工时需在 0–24 小时之间',
      )
      return null
    }
    const rows: ResultRow[] = [
      { k: '正常工时', v: `${formatHours(result.normalMinutes)} 小时` },
      { k: '加班工时', v: `${formatHours(result.overtimeMinutes)} 小时` },
      { k: '休息', v: `${result.breakMinutes} 分钟` },
      { k: '跨天', v: result.crossDay ? '是' : '否' },
    ]
    let wageNote = ''
    const wage = this.data.hourlyWage.trim()
    if (wage) {
      const pay = calcOvertimePay(
        result.overtimeMinutes,
        wage,
        Number(this.data.multiplier),
      )
      if (!pay.ok) {
        this.fail(pay.code === 'wage' ? '时薪需为大于 0 的金额' : '加班倍率需在 0–10 之间')
        return null
      }
      rows.push({ k: '加班费', v: `¥${formatCents(pay.payCents)}` })
      wageNote = '薪资试算仅供参考'
    }
    const totalText = formatHours(result.totalMinutes)
    const normalText = formatHours(result.normalMinutes)
    const overtimeText = formatHours(result.overtimeMinutes)
    const summary = `总工时 ${totalText} 小时（正常 ${normalText} 小时 + 加班 ${overtimeText} 小时）${
      result.crossDay ? ' · 跨天' : ''
    }`
    const poster: IPosterData = {
      toolName: '工时与请假',
      category: '职场辅助',
      mainResult: `${totalText} 小时`,
      resultLabel: '总工时',
      params: [
        { label: '上班', value: this.data.startTime },
        { label: '下班', value: this.data.endTime },
        { label: '标准工时', value: `${this.data.standardHours} 小时` },
      ],
      extras: [
        `正常 ${normalText} 小时`,
        `加班 ${overtimeText} 小时`,
        result.crossDay ? '跨天' : '当日',
      ],
    }
    return {
      label: '总工时',
      main: `${totalText} 小时`,
      rows,
      details: [],
      summary,
      wageNote,
      poster,
    }
  },

  runLeave(): ModeView | null {
    const startSerial = serialOfISO(this.data.leaveStart)
    const endSerial = serialOfISO(this.data.leaveEnd)
    if (startSerial === null || endSerial === null) {
      this.fail('请选择合法的开始与结束日期')
      return null
    }
    if (startSerial > endSerial) {
      this.fail('结束日期不能早于开始日期')
      return null
    }
    const result = calcLeaveDays(
      this.data.leaveStart,
      this.data.leaveEnd,
      this.data.includeWeekend,
      this.data.halfDay,
    )
    if (!result.ok) {
      this.fail(result.code === 'order' ? '结束日期不能早于开始日期' : '请选择合法日期')
      return null
    }
    const details: string[] = []
    const total = endSerial - startSerial + 1
    for (let index = 0; index < total && index < 14; index += 1) {
      const serial = startSerial + index
      const iso = isoFromSerial(serial)
      const weekend = isWeekend(serial)
      const counted = this.data.includeWeekend || !weekend
      const half = result.halfApplied && iso === this.data.leaveStart && counted
      details.push(`${iso.slice(5)} ${weekdayLabel(serial)} · ${counted ? '计入' : '跳过'}${half ? ' · 半天' : ''}`)
    }
    if (total > 14) {
      details.push(`…共 ${total} 天，仅展示前 14 天`)
    }
    const rows: ResultRow[] = [
      { k: '自然日', v: `${result.totalDays} 天` },
      { k: '工作日', v: `${result.workdays} 天` },
      { k: '周末', v: this.data.includeWeekend ? '计入' : '排除' },
      { k: '半天', v: result.halfApplied ? '扣 0.5 天' : '不扣' },
    ]
    const halfText = result.halfApplied ? '，已扣开始日半天' : ''
    const weekendText = this.data.includeWeekend ? '含周末' : '已排除周末'
    const summary = `请假 ${result.leaveDays} 天（自然日 ${result.totalDays} 天，工作日 ${result.workdays} 天，${weekendText}${halfText}）`
    const poster: IPosterData = {
      toolName: '工时与请假',
      category: '职场辅助',
      mainResult: `${result.leaveDays} 天`,
      resultLabel: '请假天数',
      params: [
        { label: '开始', value: this.data.leaveStart },
        { label: '结束', value: this.data.leaveEnd },
      ],
      extras: [
        `自然日 ${result.totalDays} 天`,
        `工作日 ${result.workdays} 天`,
        this.data.includeWeekend ? '含周末' : '排除周末',
      ],
    }
    return {
      label: '请假天数',
      main: `${result.leaveDays} 天`,
      rows,
      details,
      summary,
      wageNote: '',
      poster,
    }
  },
})
