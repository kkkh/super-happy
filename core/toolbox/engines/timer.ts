/* ==========================================================================
   会议倒计时引擎 · 截止时间戳 / 剩余格式化 / 进度
   - 剩余始终由 deadline − now 推导，不做递减累加，后台切回不会跳秒
   - 结束时间点早于当前时按次日处理，并标记 nextDay
   - 不申请订阅消息、不做后台提醒
   ========================================================================== */

export type TimerMode = 'duration' | 'deadline'

export interface TimerPlan {
  mode: TimerMode
  /** 截止时间戳（毫秒） */
  deadline: number
  /** 计划总时长（毫秒） */
  totalMs: number
  /** 结束时间点早于当前，已顺延到次日 */
  nextDay: boolean
}

export const TIMER_MIN_MINUTES = 1
export const TIMER_MAX_MINUTES = 24 * 60
/** 页面重算间隔：只刷新显示，不参与计时 */
export const TIMER_TICK_MS = 250

/** 时长（分钟）→ 截止时间戳；仅接受 1–1440 的整数分钟 */
export function planDuration(minutes: number, now: number): TimerPlan | null {
  if (!Number.isFinite(minutes) || !Number.isFinite(now)) {
    return null
  }
  const whole = Math.round(minutes)
  if (Math.abs(minutes - whole) > 1e-9) {
    return null
  }
  if (whole < TIMER_MIN_MINUTES || whole > TIMER_MAX_MINUTES) {
    return null
  }
  const totalMs = whole * 60_000
  return { mode: 'duration', deadline: now + totalMs, totalMs, nextDay: false }
}

/** 结束时间点（HH:mm）→ 截止时间戳；早于当前时顺延到次日 */
export function planDeadline(timeText: string, now: number): TimerPlan | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(timeText.trim())
  if (!match || !Number.isFinite(now)) {
    return null
  }
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) {
    return null
  }
  const date = new Date(now)
  date.setHours(hours, minutes, 0, 0)
  let deadline = date.getTime()
  let nextDay = false
  if (deadline <= now) {
    deadline += 24 * 60 * 60 * 1000
    nextDay = true
  }
  return { mode: 'deadline', deadline, totalMs: deadline - now, nextDay }
}

/** 剩余毫秒；到期归零，不返回负数 */
export function remainingMs(now: number, deadline: number): number {
  if (!Number.isFinite(now) || !Number.isFinite(deadline)) {
    return 0
  }
  return Math.max(0, deadline - now)
}

/** 毫秒 → mm:ss；向上取整到秒，分钟可超过 59 */
export function formatRemaining(ms: number): string {
  const totalSeconds = Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 1000)) : 0
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/** 已流逝百分比：0–100 的整数，供进度环使用 */
export function timerProgress(remaining: number, totalMs: number): number {
  if (!Number.isFinite(remaining) || !Number.isFinite(totalMs) || totalMs <= 0) {
    return 0
  }
  const elapsed = 1 - remaining / totalMs
  return Math.min(100, Math.max(0, Math.round(elapsed * 100)))
}

/** 毫秒 → 「x 分钟」或「x 小时 y 分钟」，用于截止信息 */
export function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  if (minutes < 60) {
    return `${minutes} 分钟`
  }
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`
}
