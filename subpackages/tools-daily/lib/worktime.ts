/* ==========================================================================
   工时与请假引擎 · 纯函数
   - 工时分：跨天按次日；正常 / 加班拆分；加班费复用分运算
   - 请假：先排除周末，再扣半天（固定开始日 0.5 天）
   ========================================================================== */
import {
  countWeekdays,
  isWeekend,
  parseISODate,
  serialOf,
} from '../../../core/toolbox/engines/date'
import { parseCents, roundHalfUp } from '../../../core/toolbox/engines/money'

export interface WorkMinutesResult {
  ok: true
  totalMinutes: number
  normalMinutes: number
  overtimeMinutes: number
  breakMinutes: number
  crossDay: boolean
}

export type WorkMinutesFailure = {
  ok: false
  code: 'time' | 'break' | 'standard'
}

export type WorkMinutes = WorkMinutesResult | WorkMinutesFailure

export type OvertimePay =
  | { ok: true; payCents: number }
  | { ok: false; code: 'wage' | 'multiplier' | 'minutes' }

export interface LeaveDaysResult {
  ok: true
  totalDays: number
  workdays: number
  leaveDays: number
  halfApplied: boolean
  startWeekend: boolean
}

export type LeaveDays = LeaveDaysResult | { ok: false; code: 'date' | 'order' }

function parseClock(raw: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(raw.trim())
  if (!match) {
    return null
  }
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) {
    return null
  }
  return hour * 60 + minute
}

/** 总工时 = 下班 − 上班 − 休息；下班 ≤ 上班按次日 */
export function calcWorkMinutes(
  start: string,
  end: string,
  breakRaw: string | number,
  standardRaw: string | number,
): WorkMinutes {
  const startMinute = parseClock(start)
  const endMinute = parseClock(end)
  if (startMinute === null || endMinute === null) {
    return { ok: false, code: 'time' }
  }
  const breakMinutes =
    typeof breakRaw === 'number' ? breakRaw : Number(breakRaw.trim() || '0')
  if (!Number.isFinite(breakMinutes) || breakMinutes < 0 || breakMinutes > 1440) {
    return { ok: false, code: 'break' }
  }
  const standardHours =
    typeof standardRaw === 'number' ? standardRaw : Number(standardRaw.trim() || '0')
  if (!Number.isFinite(standardHours) || standardHours < 0 || standardHours > 24) {
    return { ok: false, code: 'standard' }
  }

  const crossDay = endMinute <= startMinute
  const span = crossDay ? endMinute + 1440 - startMinute : endMinute - startMinute
  const totalMinutes = span - breakMinutes
  if (totalMinutes < 0) {
    return { ok: false, code: 'break' }
  }
  const standardMinutes = Math.round(standardHours * 60)
  const normalMinutes = Math.min(totalMinutes, standardMinutes)
  return {
    ok: true,
    totalMinutes,
    normalMinutes,
    overtimeMinutes: totalMinutes - normalMinutes,
    breakMinutes,
    crossDay,
  }
}

/** 加班费 = 加班小时 × 时薪 × 倍率，结果按分四舍五入 */
export function calcOvertimePay(
  overtimeMinutes: number,
  hourlyWage: string,
  multiplier: number,
): OvertimePay {
  if (!Number.isFinite(overtimeMinutes) || overtimeMinutes < 0) {
    return { ok: false, code: 'minutes' }
  }
  const wageCents = parseCents(hourlyWage)
  if (wageCents === null || wageCents <= 0) {
    return { ok: false, code: 'wage' }
  }
  if (!Number.isFinite(multiplier) || multiplier < 0 || multiplier > 10) {
    return { ok: false, code: 'multiplier' }
  }
  return {
    ok: true,
    payCents: roundHalfUp((overtimeMinutes / 60) * wageCents * multiplier),
  }
}

/** 请假天数：先按是否含周末算工作日，再固定扣开始日 0.5 天 */
export function calcLeaveDays(
  startISO: string,
  endISO: string,
  includeWeekend: boolean,
  halfDay: boolean,
): LeaveDays {
  const start = parseISODate(startISO)
  const end = parseISODate(endISO)
  if (!start || !end) {
    return { ok: false, code: 'date' }
  }
  const startSerial = serialOf(start)
  const endSerial = serialOf(end)
  if (startSerial > endSerial) {
    return { ok: false, code: 'order' }
  }
  const totalDays = endSerial - startSerial + 1
  const workdays = includeWeekend ? totalDays : countWeekdays(startSerial, endSerial)
  const halfApplied = halfDay && workdays > 0
  return {
    ok: true,
    totalDays,
    workdays,
    leaveDays: halfApplied ? Math.max(0, workdays - 0.5) : workdays,
    halfApplied,
    startWeekend: isWeekend(startSerial),
  }
}

/** 分钟 → 小时文本，最多两位小数，去掉尾零 */
export function formatHours(minutes: number): string {
  const hours = Math.round((minutes / 60) * 100) / 100
  return String(hours)
}
