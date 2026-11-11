/* ==========================================================================
   日期引擎 · 纯本地、零点对齐、无时区漂移
   - 跨分包唯一实现：tools-core / tools-daily 统一从这里引用（后续 tools-dict 复用）
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

export interface IsoWeek {
  /** ISO 周年：跨年周可能不等于公历年 */
  weekYear: number
  week: number
}

export interface DateFormatAll {
  isoDate: string
  slashDate: string
  cnDate: string
  iso8601: string
  unixSec: number
  unixMs: number
  /** YYYY-Www，含 ISO 周年 */
  isoWeek: string
  weekday: string
  dayOfYear: number
  leapYear: boolean
  daysInMonth: number
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

/** ISO 8601 周：周四所在年即周年；2021-01-01 属于 2020-W53 */
export function isoWeekOf(serial: number): IsoWeek {
  const weekday = new Date(serial * DAY_MS).getUTCDay() || 7
  const thursday = serial + (4 - weekday)
  const weekYear = partsFromSerial(thursday).year
  const jan1 = serialOf({ year: weekYear, month: 1, day: 1 })
  return { weekYear, week: Math.floor((thursday - jan1) / 7) + 1 }
}

/** 当年第几天：1 月 1 日为第 1 天 */
export function dayOfYear(serial: number): number {
  const parts = partsFromSerial(serial)
  return serial - serialOf({ year: parts.year, month: 1, day: 1 }) + 1
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

export interface WorkdayOptions {
  /** 含开始日：开始日若是工作日则计入第 1 天 */
  includeStart?: boolean
  /** 跳过周末；关闭后周末也计工作日 */
  skipWeekend?: boolean
  /** 自定义休息日，ISO 日期，最多 10 个 */
  holidays?: readonly string[]
}

export interface WorkdayEntry {
  date: string
  weekday: string
  workday: boolean
  holiday: boolean
}

export interface WorkdayResult {
  endISO: string
  /** 含首尾的自然日跨度 */
  calendarDays: number
  workdays: number
  entries: WorkdayEntry[]
}

export const MAX_WORKDAYS = 1000
const MAX_WORKDAY_SEARCH_DAYS = 3660

function holidaySerials(holidays: readonly string[] | undefined): Set<number> {
  const set = new Set<number>()
  if (!holidays) {
    return set
  }
  holidays.slice(0, 10).forEach((item) => {
    const serial = serialOfISO(item)
    if (serial !== null) {
      set.add(serial)
    }
  })
  return set
}

/** 闭区间实际工作日数：可选跳过周末与自定义休息日 */
export function countWorkdays(
  startISO: string,
  endISO: string,
  options: WorkdayOptions = {},
): number | null {
  const start = serialOfISO(startISO)
  const end = serialOfISO(endISO)
  if (start === null || end === null) {
    return null
  }
  const from = Math.min(start, end)
  const to = Math.max(start, end)
  if (to - from > 36600) {
    return null
  }
  const skipWeekend = options.skipWeekend !== false
  const holidays = holidaySerials(options.holidays)
  let count = 0
  for (let serial = from; serial <= to; serial += 1) {
    const holiday = holidays.has(serial)
    if (!holiday && (!skipWeekend || !isWeekend(serial))) {
      count += 1
    }
  }
  return count
}

/** 从开始日推进 N 个工作日；返回结束日与逐日清单 */
export function addWorkdays(
  startISO: string,
  workdays: number,
  options: WorkdayOptions = {},
): WorkdayResult | null {
  const start = serialOfISO(startISO)
  if (start === null || !Number.isInteger(workdays) || workdays < 1 || workdays > MAX_WORKDAYS) {
    return null
  }
  const skipWeekend = options.skipWeekend !== false
  const holidays = holidaySerials(options.holidays)
  const includeStart = options.includeStart !== false

  let cursor = includeStart ? start : start + 1
  let counted = 0
  let end: number | null = null
  const limit = start + MAX_WORKDAY_SEARCH_DAYS
  while (cursor <= limit) {
    const holiday = holidays.has(cursor)
    if (!holiday && (!skipWeekend || !isWeekend(cursor))) {
      counted += 1
      if (counted === workdays) {
        end = cursor
        break
      }
    }
    cursor += 1
  }
  if (end === null) {
    return null
  }

  const entries: WorkdayEntry[] = []
  for (let serial = start; serial <= end; serial += 1) {
    const holiday = holidays.has(serial)
    entries.push({
      date: isoFromSerial(serial),
      weekday: weekdayLabel(serial),
      workday: !holiday && (!skipWeekend || !isWeekend(serial)),
      holiday,
    })
  }
  return {
    endISO: isoFromSerial(end),
    calendarDays: end - start + 1,
    workdays: counted,
    entries,
  }
}

export function addDays(iso: string, days: number): string | null {
  const serial = serialOfISO(iso)
  if (serial === null) {
    return null
  }
  return isoFromSerial(serial + days)
}

/** 加 N 个月，月末自动钳制：2024-01-31 + 1 → 2024-02-29 */
export function addMonths(iso: string, months: number): string | null {
  const parts = parseISODate(iso)
  if (!parts || !Number.isFinite(months) || !Number.isInteger(months)) {
    return null
  }
  const total = parts.year * 12 + (parts.month - 1) + months
  const year = Math.floor(total / 12)
  const month = ((total % 12) + 12) % 12 + 1
  if (year < 1900 || year > 2100) {
    return null
  }
  return isoOf({ year, month, day: Math.min(parts.day, daysInMonth(year, month)) })
}

export type DateAddUnit = 'day' | 'week' | 'month' | 'year'

export const DATE_ADD_MAX_AMOUNT = 100000

const DATE_ADD_UNIT_LABELS: Record<DateAddUnit, string> = {
  day: '天',
  week: '周',
  month: '月',
  year: '年',
}

export interface DateAddResult {
  startISO: string
  endISO: string
  unit: DateAddUnit
  /** 有符号数量：正为加、负为减、0 为原日期 */
  amount: number
  weekday: string
  /** 结束 − 开始（自然日），可为负 */
  diffDays: number
  /** 按月 / 年推进时目标日被月末钳制（含 2/29 → 2/28） */
  clamped: boolean
}

export interface DateAddWorkflowInput {
  startISO: string
  amount: number
  unit: DateAddUnit
}

export function isDateAddUnit(value: unknown): value is DateAddUnit {
  return value === 'day' || value === 'week' || value === 'month' || value === 'year'
}

export function dateAddUnitLabel(unit: DateAddUnit): string {
  return DATE_ADD_UNIT_LABELS[unit]
}

/**
 * 日期加减：天 / 周按日序号推进，月 / 年按日历推进并钳制月末。
 * - 2 月 29 日加一年到平年会落到 2 月 28 日（clamped = true）
 * - 结果超出 1900–2100 或参数非法返回 null
 */
export function addDate(
  startISO: string,
  amount: number,
  unit: DateAddUnit,
): DateAddResult | null {
  const start = parseISODate(startISO)
  if (
    !start ||
    !isDateAddUnit(unit) ||
    !Number.isInteger(amount) ||
    Math.abs(amount) > DATE_ADD_MAX_AMOUNT
  ) {
    return null
  }

  const startSerial = serialOf(start)
  let endISO: string | null
  let clamped = false

  if (unit === 'day' || unit === 'week') {
    const days = unit === 'week' ? amount * 7 : amount
    endISO = isoFromSerial(startSerial + days)
  } else {
    const months = unit === 'month' ? amount : amount * 12
    endISO = addMonths(startISO, months)
  }

  const end = endISO ? parseISODate(endISO) : null
  if (!end) {
    return null
  }
  if (unit === 'month' || unit === 'year') {
    clamped = end.day !== start.day
  }
  const endSerial = serialOf(end)
  return {
    startISO: isoOf(start),
    endISO: isoOf(end),
    unit,
    amount,
    weekday: weekdayLabel(endSerial),
    diffDays: endSerial - startSerial,
    clamped,
  }
}

/** 摘要与 silent 执行器同源，禁止页面另拼一份 */
export function dateAddSummary(result: DateAddResult): string {
  const sign = result.amount >= 0 ? '+' : '-'
  const operation = `${sign}${Math.abs(result.amount)} ${dateAddUnitLabel(result.unit)}`
  const suffix = result.clamped ? ' · 月末已调整' : ''
  return `${result.startISO} ${operation} → ${result.endISO} · ${result.weekday} · 相差 ${Math.abs(
    result.diffDays,
  )} 天${suffix}`
}

const WORKFLOW_UNIT_ALIASES: Record<string, DateAddUnit> = {
  d: 'day',
  day: 'day',
  days: 'day',
  天: 'day',
  日: 'day',
  w: 'week',
  week: 'week',
  weeks: 'week',
  周: 'week',
  星期: 'week',
  m: 'month',
  month: 'month',
  months: 'month',
  月: 'month',
  y: 'year',
  year: 'year',
  years: 'year',
  年: 'year',
}

/** 解析静默流转输入：`YYYY-MM-DD ±30d/w/m/y`，单位缺省视为非法 */
export function parseDateAddWorkflow(text: string): DateAddWorkflowInput | null {
  const match = text
    .trim()
    .match(
      /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s*([+-])?\s*(\d{1,6})\s*(d|w|m|y|day|days|week|weeks|month|months|year|years|天|日|周|星期|月|年)$/i,
    )
  if (!match) {
    return null
  }
  const iso = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
  if (!parseISODate(iso)) {
    return null
  }
  const magnitude = Number(match[5])
  if (!Number.isInteger(magnitude) || magnitude > DATE_ADD_MAX_AMOUNT) {
    return null
  }
  const unit = WORKFLOW_UNIT_ALIASES[match[6].toLowerCase()]
  if (!unit) {
    return null
  }
  return {
    startISO: iso,
    amount: match[4] === '-' ? -magnitude : magnitude,
    unit,
  }
}

export function formatCN(iso: string): string {
  const parts = parseISODate(iso)
  if (!parts) {
    return iso
  }
  return `${parts.year} 年 ${parts.month} 月 ${parts.day} 日`
}

/** 日期全量格式：非法日期返回 null；Unix 按本机时区当天 00:00:00 计算 */
export function formatAll(iso: string): DateFormatAll | null {
  const parts = parseISODate(iso)
  if (!parts) {
    return null
  }
  const serial = serialOf(parts)
  const isoDate = isoOf(parts)
  const local = new Date(parts.year, parts.month - 1, parts.day, 0, 0, 0, 0)
  const week = isoWeekOf(serial)
  return {
    isoDate,
    slashDate: `${parts.year}/${pad(parts.month)}/${pad(parts.day)}`,
    cnDate: formatCN(isoDate),
    iso8601: `${isoDate}T00:00:00`,
    unixSec: Math.floor(local.getTime() / 1000),
    unixMs: local.getTime(),
    isoWeek: `${week.weekYear}-W${pad(week.week)}`,
    weekday: weekdayLabel(serial),
    dayOfYear: dayOfYear(serial),
    leapYear: isLeapYear(parts.year),
    daysInMonth: daysInMonth(parts.year, parts.month),
  }
}

/** 页面摘要与 silent 执行器同源文案，禁止各自拼装 */
export function dateSummaryText(result: DateFormatAll): string {
  return `${result.isoDate} · ${result.weekday} · ISO ${result.isoWeek} · 第 ${result.dayOfYear} 天`
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
