/* ==========================================================================
   会议倒计时 · 页面控制器
   - 计时状态在全局 meetingTimer 服务中，离开页面继续走
   - 支持暂停 / 继续 / 重置；结束前 5 秒声音震动警告，结束提醒
   - 进度环用 2D Canvas 绘制，卸载只释放节点，不打断计时
   ========================================================================== */
import { tapTick } from '../../../../core/utils/haptics'
import { uiStore } from '../../../../core/stores/ui'
import {
  meetingTimerStore,
  pauseMeetingTimer,
  resetMeetingTimer,
  resumeMeetingTimer,
  startMeetingTimer,
  startMeetingTimerAt,
  subscribeMeetingTimer,
  syncMeetingTimer,
  type MeetingTimerPhase,
  type MeetingTimerSnapshot,
} from '../../../../core/services/meetingTimer'
import { copyText } from '../../lib/ui'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'

type TimerMode = 'duration' | 'deadline'

interface ResultRow {
  k: string
  v: string
}

interface RingContext {
  lineWidth: number
  lineCap: string
  strokeStyle: string
  clearRect(x: number, y: number, width: number, height: number): void
  beginPath(): void
  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
  ): void
  stroke(): void
  scale(x: number, y: number): void
}

interface TimerState {
  destroyed: boolean
  unsubscribe: (() => void) | null
  canvas: WechatMiniprogram.Canvas | null
  ctx: RingContext | null
  canvasPending: Promise<void> | null
}

const MODE_LABELS: Record<TimerMode, string> = {
  duration: '时长倒计时',
  deadline: '结束时间点',
}

const PHASE_LABELS: Record<MeetingTimerPhase, string> = {
  idle: '准备开始',
  running: '计时中',
  paused: '已暂停',
  finished: '已结束',
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** 当前时间 +10 分钟，格式化为 HH:mm */
function defaultDeadlineTime(now: number): string {
  const date = new Date(now + 10 * 60 * 1000)
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

function posterForFinish(deadlineLabel: string, totalText: string): IPosterData {
  return {
    toolName: '会议倒计时',
    category: '日期时间',
    mainResult: '00:00',
    resultLabel: '倒计时结束',
    params: [{ label: '截止', value: deadlineLabel || '—' }],
    extras: [`总时长 ${totalText || '—'}`, '倒计时已在本机结束'],
  }
}

Page({
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: '会议倒计时',
    kicker: '日期时间',
    desc: '时长 / 结束时间点 · 剩余提醒',
    mode: 'duration' as TimerMode,
    durationText: '10',
    deadlineTime: '',
    quickMinutes: [5, 10, 15, 30, 60],
    ringPx: 168,
    phase: 'idle' as MeetingTimerPhase,
    remainingText: '00:00',
    progressValue: 0,
    progressText: '0%',
    statusText: '准备开始',
    pauseLabel: '暂停',
    isFinished: false,
    deadlineLabel: '',
    totalText: '',
    nextDay: false,
    timerText: '',
    resultRows: [] as ResultRow[],
    hasResult: false,
    shellState: 'idle',
    error: '',
    posterData: null as IPosterData | null,
    formTouched: false,
  },

  onLoad() {
    const state = this as unknown as TimerState
    state.destroyed = false
    state.canvas = null
    state.ctx = null
    state.canvasPending = null
    state.unsubscribe = subscribeMeetingTimer((snapshot) => {
      this.applySnapshot(snapshot)
    })

    const info = wx.getWindowInfo()
    const width = Number(info.windowWidth) || 375
    const ringPx = Math.max(140, Math.min(200, Math.round(width * 0.44)))
    this.setData({
      ringPx,
      deadlineTime: defaultDeadlineTime(Date.now()),
    })
    if (meetingTimerStore.phase !== 'idle') {
      this.restoreFromStore()
    }
  },

  onShow() {
    syncMeetingTimer()
    const state = this as unknown as TimerState
    if (!state.destroyed && meetingTimerStore.phase !== 'idle' && !this.data.hasResult) {
      this.restoreFromStore()
    }
  },

  onUnload() {
    const state = this as unknown as TimerState
    state.destroyed = true
    if (state.unsubscribe) {
      state.unsubscribe()
      state.unsubscribe = null
    }
    state.canvas = null
    state.ctx = null
    state.canvasPending = null
  },

  onMode(event: WechatMiniprogram.TouchEvent) {
    const mode = event.currentTarget.dataset.mode as TimerMode
    if (mode !== 'duration' && mode !== 'deadline') {
      return
    }
    if (mode === this.data.mode) {
      return
    }
    tapTick()
    if (meetingTimerStore.phase !== 'idle') {
      resetMeetingTimer()
    }
    const patch: Record<string, unknown> = {
      mode,
      hasResult: false,
      shellState: 'idle',
      error: '',
      timerText: '',
      posterData: null,
      resultRows: [],
      remainingText: '00:00',
      progressValue: 0,
      progressText: '0%',
      statusText: '准备开始',
      isFinished: false,
      deadlineLabel: '',
      totalText: '',
      nextDay: false,
    }
    if (mode === 'deadline' && !this.data.deadlineTime) {
      patch.deadlineTime = defaultDeadlineTime(Date.now())
    }
    this.setData(patch)
  },

  onQuick(event: WechatMiniprogram.TouchEvent) {
    const minutes = Number(event.currentTarget.dataset.minutes)
    if (!Number.isFinite(minutes) || minutes <= 0) {
      return
    }
    tapTick()
    this.setData({ durationText: String(minutes), formTouched: true, error: '' })
  },

  onDurationInput(event: WechatMiniprogram.Input) {
    this.setData({ durationText: String(event.detail.value ?? ''), formTouched: true, error: '' })
  },

  onTimeChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ deadlineTime: String(event.detail.value ?? ''), formTouched: true, error: '' })
  },

  onExample() {
    tapTick()
    this.setData({ mode: 'duration', durationText: '5', formTouched: true, error: '' }, () => {
      this.startCountdown()
    })
  },

  onReset() {
    resetMeetingTimer()
    const state = this as unknown as TimerState
    state.canvasPending = null
    this.setData({
      durationText: '10',
      deadlineTime: defaultDeadlineTime(Date.now()),
      hasResult: false,
      shellState: 'idle',
      error: '',
      remainingText: '00:00',
      progressValue: 0,
      progressText: '0%',
      statusText: '准备开始',
      pauseLabel: '暂停',
      isFinished: false,
      deadlineLabel: '',
      totalText: '',
      nextDay: false,
      timerText: '',
      resultRows: [],
      posterData: null,
      formTouched: false,
    })
  },

  /* ---- 草稿：模式、时长与结束时间；恢复后不自动开始计时 ---- */
  draftMode(): string {
    return this.data.mode
  },

  collectDraftInput(): Record<string, string> {
    return { durationText: this.data.durationText, deadlineTime: this.data.deadlineTime }
  },

  applyDraftInput(input: Record<string, string>, mode: string): void {
    this.onReset()
    this.setData({
      mode: mode === 'deadline' ? 'deadline' : 'duration',
      durationText: input.durationText || '10',
      deadlineTime: input.deadlineTime || defaultDeadlineTime(Date.now()),
      formTouched: true,
    })
  },

  onRun() {
    this.startCountdown()
  },

  onTogglePause() {
    if (meetingTimerStore.phase === 'running') {
      pauseMeetingTimer()
      tapTick()
      return
    }
    if (meetingTimerStore.phase === 'paused') {
      resumeMeetingTimer()
      tapTick()
    }
  },

  onCopy() {
    if (!this.data.hasResult) {
      return
    }
    const lines = [
      '会议倒计时',
      `截止：${this.data.deadlineLabel || '—'}`,
      `剩余：${this.data.remainingText}`,
      `状态：${this.data.statusText}`,
    ]
    copyText(lines.join('\n'), '倒计时摘要已复制')
  },

  startCountdown() {
    const state = this as unknown as TimerState
    if (state.destroyed) {
      return
    }
    const now = Date.now()
    let ok = false
    if (this.data.mode === 'duration') {
      const minutes = Number(String(this.data.durationText).trim())
      ok = startMeetingTimer(minutes, now) !== null
      if (!ok) {
        resetMeetingTimer()
        this.setData({
          shellState: 'invalid',
          hasResult: false,
          error: '时长需为 1–1440 分钟的整数',
          posterData: null,
        })
        return
      }
    } else {
      ok = startMeetingTimerAt(String(this.data.deadlineTime), now) !== null
      if (!ok) {
        resetMeetingTimer()
        this.setData({
          shellState: 'invalid',
          hasResult: false,
          error: '请选择有效的结束时间',
          posterData: null,
        })
        return
      }
    }

    const mode = this.data.mode
    const deadlineLabel = meetingTimerStore.deadlineLabel
    const totalText = meetingTimerStore.totalText
    const resultRows: ResultRow[] = [
      { k: '模式', v: MODE_LABELS[mode] },
      { k: '截止', v: deadlineLabel },
      { k: '总时长', v: totalText },
    ]
    const remainingText = meetingTimerStore.remainingText
    const progress = meetingTimerStore.progressPercent
    const poster: IPosterData = {
      toolName: '会议倒计时',
      category: '日期时间',
      mainResult: remainingText,
      resultLabel: '倒计时时长',
      params: [
        { label: '模式', value: MODE_LABELS[mode] },
        { label: '截止', value: deadlineLabel },
      ],
      extras: [
        `总时长 ${totalText}`,
        meetingTimerStore.nextDay ? '结束时间已顺延到次日' : '结束前请保持页面在前台',
        '不发送订阅消息，不做后台提醒',
      ],
    }

    this.setData(
      {
        shellState: 'done',
        hasResult: true,
        isFinished: false,
        error: '',
        remainingText,
        progressValue: progress,
        progressText: `${progress}%`,
        statusText: '计时中',
        pauseLabel: '暂停',
        deadlineLabel,
        totalText,
        nextDay: meetingTimerStore.nextDay,
        timerText: `会议倒计时 ${remainingText}`,
        resultRows,
        posterData: poster,
        formTouched: true,
      },
      () => {
        if (state.destroyed) {
          return
        }
        void this.ensureCanvas().then(() => this.paint(progress))
      },
    )
  },

  /** 从全局服务恢复页面展示（HUD 跳回 / 页面重建） */
  restoreFromStore() {
    const phase = meetingTimerStore.phase
    if (phase === 'idle') {
      return
    }
    const mode = (meetingTimerStore.mode || 'duration') as TimerMode
    const resultRows: ResultRow[] = [
      { k: '模式', v: MODE_LABELS[mode] },
      { k: '截止', v: meetingTimerStore.deadlineLabel },
      { k: '总时长', v: meetingTimerStore.totalText },
    ]
    const finished = phase === 'finished'
    this.setData(
      {
        shellState: 'done',
        hasResult: true,
        mode,
        phase,
        remainingText: meetingTimerStore.remainingText,
        progressValue: meetingTimerStore.progressPercent,
        progressText: `${meetingTimerStore.progressPercent}%`,
        statusText: PHASE_LABELS[phase],
        pauseLabel: phase === 'paused' ? '继续' : '暂停',
        isFinished: finished,
        deadlineLabel: meetingTimerStore.deadlineLabel,
        totalText: meetingTimerStore.totalText,
        nextDay: meetingTimerStore.nextDay,
        timerText: finished
          ? '会议倒计时 00:00（已结束）'
          : `会议倒计时 ${meetingTimerStore.remainingText}`,
        resultRows,
        posterData: finished
          ? posterForFinish(meetingTimerStore.deadlineLabel, meetingTimerStore.totalText)
          : this.startPoster(mode),
      },
      () => {
        void this.ensureCanvas().then(() =>
          this.paint(meetingTimerStore.progressPercent),
        )
      },
    )
  },

  startPoster(mode: TimerMode): IPosterData {
    return {
      toolName: '会议倒计时',
      category: '日期时间',
      mainResult: meetingTimerStore.remainingText,
      resultLabel: '倒计时时长',
      params: [
        { label: '模式', value: MODE_LABELS[mode] },
        { label: '截止', value: meetingTimerStore.deadlineLabel },
      ],
      extras: [`总时长 ${meetingTimerStore.totalText}`, '不发送订阅消息，不做后台提醒'],
    }
  },

  applySnapshot(snapshot: MeetingTimerSnapshot) {
    const state = this as unknown as TimerState
    if (state.destroyed) {
      return
    }
    const phaseChanged = snapshot.phase !== this.data.phase
    const textChanged = snapshot.remainingText !== this.data.remainingText
    const progressChanged = snapshot.progressPercent !== this.data.progressValue
    if (!phaseChanged && !textChanged && !progressChanged) {
      return
    }
    const finished = snapshot.phase === 'finished'
    const patch: Record<string, unknown> = {
      phase: snapshot.phase,
      remainingText: snapshot.remainingText,
      progressValue: snapshot.progressPercent,
      progressText: `${snapshot.progressPercent}%`,
      statusText: PHASE_LABELS[snapshot.phase],
      pauseLabel: snapshot.phase === 'paused' ? '继续' : '暂停',
      isFinished: finished,
      timerText: finished
        ? '会议倒计时 00:00（已结束）'
        : snapshot.phase === 'idle'
          ? ''
          : `会议倒计时 ${snapshot.remainingText}`,
    }
    if (finished && phaseChanged) {
      patch.shellState = 'done'
      patch.posterData = posterForFinish(
        meetingTimerStore.deadlineLabel,
        meetingTimerStore.totalText,
      )
    }
    this.setData(patch)
    if (this.data.hasResult) {
      this.paint(snapshot.progressPercent)
    }
  },

  ensureCanvas(): Promise<void> {
    const state = this as unknown as TimerState
    if (state.ctx) {
      return Promise.resolve()
    }
    if (state.canvasPending) {
      return state.canvasPending
    }
    state.canvasPending = new Promise((resolve) => {
      this.createSelectorQuery()
        .select('#timer-ring')
        .fields({ node: true, size: true })
        .exec((result) => {
          state.canvasPending = null
          const first = result[0] as { node?: WechatMiniprogram.Canvas } | null
          const node = first?.node
          if (!node || state.destroyed) {
            resolve()
            return
          }
          const info = wx.getWindowInfo()
          const dpr = Math.min(3, Math.max(1, Number(info.pixelRatio) || 1))
          const size = this.data.ringPx
          node.width = Math.round(size * dpr)
          node.height = Math.round(size * dpr)
          const ctx = node.getContext('2d') as unknown as RingContext | null
          if (!ctx || typeof ctx.scale !== 'function') {
            resolve()
            return
          }
          ctx.scale(dpr, dpr)
          state.canvas = node
          state.ctx = ctx
          resolve()
        })
    })
    return state.canvasPending
  },

  paint(percent: number) {
    const state = this as unknown as TimerState
    const ctx = state.ctx
    if (!ctx) {
      return
    }
    const size = this.data.ringPx
    const line = Math.max(6, Math.round(size * 0.07))
    const center = size / 2
    const radius = center - line / 2
    const dark = uiStore.resolvedTheme === 'dark'
    ctx.clearRect(0, 0, size, size)
    ctx.lineWidth = line
    ctx.lineCap = 'round'
    ctx.strokeStyle = dark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(20, 26, 40, 0.12)'
    ctx.beginPath()
    ctx.arc(center, center, radius, 0, Math.PI * 2)
    ctx.stroke()
    if (percent > 0) {
      ctx.strokeStyle = dark ? '#8f9bff' : '#5367ff'
      ctx.beginPath()
      ctx.arc(center, center, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (percent / 100))
      ctx.stroke()
    }
  },
})
