/* ==========================================================================
   会议倒计时 · 全局单例服务
   - 状态放在主包，页面 / HUD 跨分包共享；离开页面仍按截止时间计时
   - 纯 deadline 推导，暂停时冻结剩余时长，继续时重新计算截止时间
   - 结束前 5 秒震动 + 声音警示；结束时震动 + Toast
   - 不申请订阅消息，不做后台提醒；切后台停表，回前台按时间戳补算
   ========================================================================== */
import { observable } from 'mobx-miniprogram'
import { vibrate } from '../utils/haptics'
import { toast } from './feedback'
import {
  TIMER_TICK_MS,
  formatDuration,
  formatRemaining,
  planDeadline,
  planDuration,
  remainingMs,
  timerProgress,
  type TimerMode,
  type TimerPlan,
} from '../toolbox/engines/timer'

export type MeetingTimerPhase = 'idle' | 'running' | 'paused' | 'finished'

export interface MeetingTimerSnapshot {
  phase: MeetingTimerPhase
  mode: TimerMode | ''
  nextDay: boolean
  deadlineLabel: string
  totalText: string
  deadline: number
  totalMs: number
  remainingMs: number
  remainingText: string
  progressPercent: number
  finishedAt: number
}

type TimerListener = (snapshot: MeetingTimerSnapshot) => void

/** 结束前提醒阈值 */
export const MEETING_TIMER_WARN_MS = 5000

let ticker = 0
let warningFired = false
const listeners: TimerListener[] = []

export const meetingTimerStore = observable({
  phase: 'idle' as MeetingTimerPhase,
  mode: '' as TimerMode | '',
  nextDay: false,
  deadlineLabel: '',
  totalText: '',
  deadline: 0,
  totalMs: 0,
  remainingMs: 0,
  finishedAt: 0,

  get active(): boolean {
    return this.phase !== 'idle'
  },

  get paused(): boolean {
    return this.phase === 'paused'
  },

  get remainingText(): string {
    return formatRemaining(this.remainingMs)
  },

  get progressPercent(): number {
    return timerProgress(this.remainingMs, this.totalMs)
  },

  get statusText(): string {
    if (this.phase === 'running') {
      return '计时中'
    }
    if (this.phase === 'paused') {
      return '已暂停'
    }
    if (this.phase === 'finished') {
      return '已结束'
    }
    return '待开始'
  },
})

export function meetingTimerSnapshot(): MeetingTimerSnapshot {
  return {
    phase: meetingTimerStore.phase,
    mode: meetingTimerStore.mode,
    nextDay: meetingTimerStore.nextDay,
    deadlineLabel: meetingTimerStore.deadlineLabel,
    totalText: meetingTimerStore.totalText,
    deadline: meetingTimerStore.deadline,
    totalMs: meetingTimerStore.totalMs,
    remainingMs: meetingTimerStore.remainingMs,
    remainingText: meetingTimerStore.remainingText,
    progressPercent: meetingTimerStore.progressPercent,
    finishedAt: meetingTimerStore.finishedAt,
  }
}

function notify(): void {
  const snapshot = meetingTimerSnapshot()
  for (const listener of listeners.slice()) {
    try {
      listener(snapshot)
    } catch {
      /* 单个订阅者异常不得中断计时 */
    }
  }
}

function clearTicker(): void {
  if (ticker) {
    clearInterval(ticker)
    ticker = 0
  }
}

function applyRemaining(remain: number): void {
  meetingTimerStore.remainingMs = remain
  meetingTimerStore.phase = 'running'
  meetingTimerStore.deadline = Date.now() + remain
}

function finish(): void {
  if (meetingTimerStore.phase !== 'running') {
    return
  }
  clearTicker()
  meetingTimerStore.phase = 'finished'
  meetingTimerStore.remainingMs = 0
  meetingTimerStore.finishedAt = Date.now()
  notify()
  vibrate('heavy')
  toast('倒计时结束')
}

function warnIfNeeded(remain: number): void {
  if (!warningFired && remain > 0 && remain <= MEETING_TIMER_WARN_MS) {
    warningFired = true
    vibrate('heavy')
    toast('还剩 5 秒')
  }
}

function tick(): void {
  if (meetingTimerStore.phase !== 'running') {
    return
  }
  const remain = remainingMs(Date.now(), meetingTimerStore.deadline)
  meetingTimerStore.remainingMs = remain
  if (remain <= 0) {
    finish()
    return
  }
  warnIfNeeded(remain)
  notify()
}

function startTicker(): void {
  clearTicker()
  if (meetingTimerStore.phase !== 'running') {
    return
  }
  ticker = setInterval(tick, TIMER_TICK_MS) as unknown as number
}

function begin(plan: TimerPlan, meta: { deadlineLabel: string; totalText: string }): void {
  clearTicker()
  warningFired = false
  meetingTimerStore.phase = 'running'
  meetingTimerStore.mode = plan.mode
  meetingTimerStore.nextDay = plan.nextDay
  meetingTimerStore.deadlineLabel = meta.deadlineLabel
  meetingTimerStore.totalText = meta.totalText
  meetingTimerStore.deadline = plan.deadline
  meetingTimerStore.totalMs = Math.max(1, plan.totalMs)
  meetingTimerStore.remainingMs = plan.totalMs
  meetingTimerStore.finishedAt = 0
  notify()
  startTicker()
}

/** 按时长开始；返回计划供页面展示截止信息 */
export function startMeetingTimer(minutes: number, now = Date.now()): TimerPlan | null {
  const plan = planDuration(minutes, now)
  if (!plan) {
    return null
  }
  begin(plan, {
    deadlineLabel: `现在起 ${formatDuration(plan.totalMs)}`,
    totalText: formatDuration(plan.totalMs),
  })
  return plan
}

/** 按结束时间点开始；早于当前自动按次日处理 */
export function startMeetingTimerAt(timeText: string, now = Date.now()): TimerPlan | null {
  const plan = planDeadline(timeText, now)
  if (!plan) {
    return null
  }
  begin(plan, {
    deadlineLabel: `${plan.nextDay ? '次日' : '今天'} ${timeText.trim()}`,
    totalText: formatDuration(plan.totalMs),
  })
  return plan
}

/** 暂停：冻结剩余时长，HUD 与页面同时更新 */
export function pauseMeetingTimer(): boolean {
  if (meetingTimerStore.phase !== 'running') {
    return false
  }
  clearTicker()
  const remain = remainingMs(Date.now(), meetingTimerStore.deadline)
  meetingTimerStore.remainingMs = remain
  meetingTimerStore.phase = 'paused'
  notify()
  return true
}

/** 继续：以当前剩余时长重新计算截止时间 */
export function resumeMeetingTimer(): boolean {
  if (meetingTimerStore.phase !== 'paused') {
    return false
  }
  applyRemaining(meetingTimerStore.remainingMs)
  warningFired = meetingTimerStore.remainingMs <= MEETING_TIMER_WARN_MS
  notify()
  startTicker()
  return true
}

/** 重置：停止计时并清空状态 */
export function resetMeetingTimer(): void {
  clearTicker()
  warningFired = false
  meetingTimerStore.phase = 'idle'
  meetingTimerStore.mode = ''
  meetingTimerStore.nextDay = false
  meetingTimerStore.deadlineLabel = ''
  meetingTimerStore.totalText = ''
  meetingTimerStore.deadline = 0
  meetingTimerStore.totalMs = 0
  meetingTimerStore.remainingMs = 0
  meetingTimerStore.finishedAt = 0
  notify()
}

/** 回前台 / 页面显示时调用：按截止时间补算，已到期立即结束 */
export function syncMeetingTimer(): void {
  if (meetingTimerStore.phase !== 'running') {
    return
  }
  const remain = remainingMs(Date.now(), meetingTimerStore.deadline)
  meetingTimerStore.remainingMs = remain
  if (remain <= 0) {
    finish()
    return
  }
  warnIfNeeded(remain)
  if (!ticker) {
    startTicker()
  }
  notify()
}

/** 切后台：只停表，不改变状态与截止时间 */
export function suspendMeetingTimer(): void {
  clearTicker()
}

/** 订阅完整快照；返回取消函数 */
export function subscribeMeetingTimer(listener: TimerListener): () => void {
  listeners.push(listener)
  try {
    listener(meetingTimerSnapshot())
  } catch {
    /* 首次同步异常不影响订阅 */
  }
  return () => {
    const index = listeners.indexOf(listener)
    if (index >= 0) {
      listeners.splice(index, 1)
    }
  }
}
