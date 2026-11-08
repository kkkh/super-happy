/* ==========================================================================
   日期引擎 · 纯本地、零点对齐、无时区漂移
   - 日期字符串一律按 UTC 零点计算「日序号」，展示按本地时区
   - 闰年 / 闰日 / 生日推进显式处理
   ========================================================================== */

const DAY_MS = 86400000
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export interface DateParts {
  year: number
  month: number
  day: number
}

export interface AgeParts {
  years: number
  months: number
  days: number
  totalDays: number
  totalMonths: number
}

export interface NextBirthday {
  days: number
  dateISO: string
  today: boolean
  /** 2 月 29 日生日在平年按 2 月 28 日推进 */
  leapAdjusted: boolean
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

export function daysInMonth(year: number, month: number): number {
  let normalizedYear = year
  let normalizedMonth = month
  if (normalizedMonth < 1) {
    normalizedMonth += 12
    normalizedYear -= 1
  }
  if (normalizedMonth > 12) {
    normalizedMonth -= 12
    normalizedYear += 1
  }
  return new Date(Date.UTC(normalizedYear, normalizedMonth, 0)).getUTCDate()
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/** 严格解析 YYYY-MM-DD；非法日期返回 null */
export function parseISODate(raw: string): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim())
  if (!match) {
    return null
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1) {
    return null
  }
  if (day > daysInMonth(year, month)) {
    return null
  }
  return { year, month, day }
}

/** 日序号：UTC 零点起算的天数 */
export function serialOf(parts: DateParts): number {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / DAY_MS)
}

export function partsFromSerial(serial: number): DateParts {
  const date = new Date(serial * DAY_MS)
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  }
}

export function isoOf(parts: DateParts): string {
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`
}

export function serialOfISO(raw: string): number | null {
  const parts = parseISODate(raw)
  return parts ? serialOf(parts) : null
}

export function isoFromSerial(serial: number): string {
  return isoOf(partsFromSerial(serial))
}

/** 本地今天（避免 toISOString 的 UTC 偏移） */
export function todayISO(): string {
  const now = new Date()
  return isoOf({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() })
}

/** 结束日 − 开始日（自然日差） */
export function dayDiff(startISO: string, endISO: string): number | null {
  const start = serialOfISO(startISO)
  const end = serialOfISO(endISO)
  if (start === null || end === null) {
    return null
  }
  return end - start
}

export function weekdayLabel(serial: number): string {
  const index = new Date(serial * DAY_MS).getUTCDay()
  return WEEKDAYS[index]
}

export function isWeekend(serial: number): boolean {
  const index = new Date(serial * DAY_MS).getUTCDay()
  return index === 0 || index === 6
}

/** 闭区间工作日数：两端都计入 */
export function countWeekdays(startSerial: number, endSerial: number): number {
  const from = Math.min(startSerial, endSerial)
  const to = Math.max(startSerial, endSerial)
  if (to - from > 36600) {
    return 0
  }
  let count = 0
  for (let serial = from; serial <= to; serial += 1) {
    if (!isWeekend(serial)) {
      count += 1
    }
  }
  return count
}

export function addDays(iso: string, days: number): string | null {
  const serial = serialOfISO(iso)
  if (serial === null) {
    return null
  }
  return isoFromSerial(serial + days)
}

export function formatCN(iso: string): string {
  const parts = parseISODate(iso)
  if (!parts) {
    return iso
  }
  return `${parts.year} 年 ${parts.month} 月 ${parts.day} 日`
}

/** 周岁 / 月龄 / 日龄 */
export function ageParts(birthISO: string, refISO: string): AgeParts | null {
  const birth = parseISODate(birthISO)
  const ref = parseISODate(refISO)
  if (!birth || !ref) {
    return null
  }
  const birthSerial = serialOf(birth)
  const refSerial = serialOf(ref)
  if (birthSerial > refSerial) {
    return null
  }

  let years = ref.year - birth.year
  let months = ref.month - birth.month
  let days = ref.day - birth.day

  if (days < 0) {
    months -= 1
    days += daysInMonth(ref.year, ref.month - 1)
  }
  if (months < 0) {
    years -= 1
    months += 12
  }

  return {
    years,
    months,
    days,
    totalDays: refSerial - birthSerial,
    totalMonths: years * 12 + months,
  }
}

/** 下次生日：当天返回 0 天；2 月 29 日在平年按 2 月 28 日 */
export function nextBirthday(birthISO: string, refISO: string): NextBirthday | null {
  const birth = parseISODate(birthISO)
  const ref = parseISODate(refISO)
  if (!birth || !ref) {
    return null
  }
  const refSerial = serialOf(ref)

  const candidateFor = (year: number): { serial: number; leapAdjusted: boolean } => {
    let day = birth.day
    let adjusted = false
    if (birth.month === 2 && birth.day === 29 && !isLeapYear(year)) {
      day = 28
      adjusted = true
    }
    return {
      serial: serialOf({ year, month: birth.month, day }),
      leapAdjusted: adjusted,
    }
  }

  let candidate = candidateFor(ref.year)
  if (candidate.serial < refSerial) {
    candidate = candidateFor(ref.year + 1)
  }
  return {
    days: candidate.serial - refSerial,
    dateISO: isoFromSerial(candidate.serial),
    today: candidate.serial === refSerial,
    leapAdjusted: candidate.leapAdjusted,
  }
}

/** 本地日期时间格式：YYYY-MM-DD HH:mm:ss */
export function formatDateTime(date: Date, withSeconds = true): string {
  const body = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
  return withSeconds ? `${body}:${pad(date.getSeconds())}` : body
}

/** 解析本地日期 + 时间（HH:mm / HH:mm:ss） */
export function parseDateTime(dateISO: string, time: string): Date | null {
  const parts = parseISODate(dateISO)
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim())
  if (!parts || !match) {
    return null
  }
  const hour = Number(match[1])
  const minute = Number(match[2])
  const second = Number(match[3] ?? '0')
  if (hour > 23 || minute > 59 || second > 59) {
    return null
  }
  return new Date(parts.year, parts.month - 1, parts.day, hour, minute, second, 0)
}

/** UTC 展示：用于时间戳对照，避免用户误读时区 */
export function formatUTC(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(
    date.getUTCHours(),
  )}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC`
}

export function formatClock(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
