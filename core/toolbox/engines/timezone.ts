/* ==========================================================================
   时区换算引擎 · 墙钟 → 墙钟，纯本地
   - 只做固定偏移换算；夏令时由页面手动 +60 分钟，不假装自动识别
   - 输入 / 输出都是墙钟字符串，避免 Date 本地时区带来的二次漂移
   ========================================================================== */
import { parseISODate } from './date'

export const MAX_OFFSET_MINUTES = 14 * 60
export const DST_OFFSET_MINUTES = 60

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export interface TimezoneZone {
  id: string
  label: string
  offsetMinutes: number
}

export interface TimezoneInput {
  /** YYYY-MM-DD */
  date: string
  /** HH:mm */
  time: string
  source: TimezoneZone
  target: TimezoneZone
  /** 源时区手动夏令时：+60 分钟 */
  sourceDst?: boolean
  /** 目标时区手动夏令时：+60 分钟 */
  targetDst?: boolean
}

export interface TimezoneResult {
  sourceZoneLabel: string
  sourceOffsetLabel: string
  sourceDateTime: string
  sourceWeekday: string
  targetZoneLabel: string
  targetOffsetLabel: string
  targetDate: string
  targetTime: string
  targetDateTime: string
  targetWeekday: string
  /** 目标 − 源，含手动夏令时 */
  diffMinutes: number
  diffLabel: string
  crossDay: boolean
  crossYear: boolean
}

/** 常用城市固定偏移；夏令时一律由页面开关手动处理 */
export const ZONE_PRESETS: TimezoneZone[] = [
  { id: 'beijing', label: '北京', offsetMinutes: 480 },
  { id: 'hongkong', label: '香港', offsetMinutes: 480 },
  { id: 'tokyo', label: '东京', offsetMinutes: 540 },
  { id: 'seoul', label: '首尔', offsetMinutes: 540 },
  { id: 'singapore', label: '新加坡', offsetMinutes: 480 },
  { id: 'bangkok', label: '曼谷', offsetMinutes: 420 },
  { id: 'jakarta', label: '雅加达', offsetMinutes: 420 },
  { id: 'delhi', label: '新德里', offsetMinutes: 330 },
  { id: 'dubai', label: '迪拜', offsetMinutes: 240 },
  { id: 'moscow', label: '莫斯科', offsetMinutes: 180 },
  { id: 'berlin', label: '柏林', offsetMinutes: 60 },
  { id: 'paris', label: '巴黎', offsetMinutes: 60 },
  { id: 'london', label: '伦敦', offsetMinutes: 0 },
  { id: 'lisbon', label: '里斯本', offsetMinutes: 0 },
  { id: 'reykjavik', label: '雷克雅未克', offsetMinutes: 0 },
  { id: 'sao-paulo', label: '圣保罗', offsetMinutes: -180 },
  { id: 'new-york', label: '纽约', offsetMinutes: -300 },
  { id: 'chicago', label: '芝加哥', offsetMinutes: -360 },
  { id: 'denver', label: '丹佛', offsetMinutes: -420 },
  { id: 'los-angeles', label: '洛杉矶', offsetMinutes: -480 },
  { id: 'vancouver', label: '温哥华', offsetMinutes: -480 },
  { id: 'honolulu', label: '檀香山', offsetMinutes: -600 },
  { id: 'sydney', label: '悉尼', offsetMinutes: 600 },
  { id: 'auckland', label: '奥克兰', offsetMinutes: 720 },
]

/** 本机当前固定偏移；跨夏令时切换后重新进入页面即可刷新 */
export function localZone(now: Date = new Date()): TimezoneZone {
  return {
    id: 'local',
    label: '本机',
    offsetMinutes: -now.getTimezoneOffset(),
  }
}

export function findZone(id: string, presets: readonly TimezoneZone[] = ZONE_PRESETS): TimezoneZone | null {
  return presets.find((zone) => zone.id === id) ?? null
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

export function offsetLabel(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMinutes)
  const hours = Math.floor(abs / 60)
  const minutes = abs % 60
  return minutes === 0 ? `UTC${sign}${hours}` : `UTC${sign}${hours}:${pad(minutes)}`
}

export function diffLabel(diffMinutes: number): string {
  if (diffMinutes === 0) {
    return '0 小时'
  }
  const sign = diffMinutes > 0 ? '+' : '-'
  const abs = Math.abs(diffMinutes)
  const hours = Math.floor(abs / 60)
  const minutes = abs % 60
  if (minutes === 0) {
    return `${sign}${hours} 小时`
  }
  return hours === 0 ? `${sign}${minutes} 分` : `${sign}${hours} 小时 ${minutes} 分`
}

function parseTime(raw: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw.trim())
  if (!match) {
    return null
  }
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) {
    return null
  }
  return { hour, minute }
}

function effectiveOffset(zone: TimezoneZone, dst: boolean): number {
  return zone.offsetMinutes + (dst ? DST_OFFSET_MINUTES : 0)
}

export function convertZone(input: TimezoneInput): TimezoneResult | null {
  const dateParts = parseISODate(input.date)
  const timeParts = parseTime(input.time)
  if (!dateParts || !timeParts) {
    return null
  }
  const sourceOffset = effectiveOffset(input.source, Boolean(input.sourceDst))
  const targetOffset = effectiveOffset(input.target, Boolean(input.targetDst))
  if (
    Math.abs(sourceOffset) > MAX_OFFSET_MINUTES ||
    Math.abs(targetOffset) > MAX_OFFSET_MINUTES
  ) {
    return null
  }

  const wallMs =
    Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, timeParts.hour, timeParts.minute) +
    (targetOffset - sourceOffset) * 60000
  const target = new Date(wallMs)
  const targetDate = `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(target.getUTCDate())}`
  const targetTime = `${pad(target.getUTCHours())}:${pad(target.getUTCMinutes())}`
  const diffMinutes = targetOffset - sourceOffset

  return {
    sourceZoneLabel: input.source.label,
    sourceOffsetLabel: offsetLabel(sourceOffset),
    sourceDateTime: `${input.date} ${input.time}`,
    sourceWeekday: WEEKDAYS[new Date(Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day)).getUTCDay()],
    targetZoneLabel: input.target.label,
    targetOffsetLabel: offsetLabel(targetOffset),
    targetDate,
    targetTime,
    targetDateTime: `${targetDate} ${targetTime}`,
    targetWeekday: WEEKDAYS[target.getUTCDay()],
    diffMinutes,
    diffLabel: diffLabel(diffMinutes),
    crossDay: targetDate !== input.date,
    crossYear: targetDate.slice(0, 4) !== input.date.slice(0, 4),
  }
}

export function timezoneSummaryText(result: TimezoneResult): string {
  return [
    `${result.sourceDateTime} ${result.sourceZoneLabel} ${result.sourceOffsetLabel}`,
    `→ ${result.targetDateTime} ${result.targetZoneLabel} ${result.targetOffsetLabel}`,
    `时差 ${result.diffLabel}`,
    result.crossDay ? '跨日' : '同日',
  ].join('；')
}

/* ---- 世界时钟：同一基准墙钟，多城市同屏 ---- */

/** 世界时钟内置城市（可自由勾选同屏；基准时区另行选择） */
export const WORLD_CLOCK_CITY_IDS = [
  'beijing',
  'tokyo',
  'sydney',
  'london',
  'paris',
  'new-york',
  'los-angeles',
  'sao-paulo',
] as const

/** 世界时钟最多同屏城市数（不含基准时区） */
export const WORLD_CLOCK_MAX_CITIES = 8

export interface WorldClockInput {
  /** 基准日期 YYYY-MM-DD */
  date: string
  /** 基准时间 HH:mm */
  time: string
  source: TimezoneZone
  /** 基准时区手动夏令时 */
  sourceDst?: boolean
  /** 同屏城市（不含基准）；重复 id 自动去重 */
  zones?: readonly TimezoneZone[]
  /** 各城市手动夏令时的 id 集合 */
  dstIds?: readonly string[]
}

export interface WorldClockRow {
  id: string
  label: string
  offsetLabel: string
  date: string
  time: string
  weekday: string
  /** 相对基准时区的分钟差 */
  diffMinutes: number
  diffLabel: string
  /** 目标日期相对基准日期的天数差，-1 表示早一天 */
  dayOffset: number
  dayOffsetLabel: string
  /** 是否与基准不在同一自然日 */
  crossDay: boolean
  dst: boolean
  isSource: boolean
}

function dayOffsetLabel(days: number): string {
  if (days === 0) {
    return '同日'
  }
  return days > 0 ? `晚 ${days} 天` : `早 ${Math.abs(days)} 天`
}

function calendarDaysBetween(fromISO: string, toISO: string): number {
  const from = parseISODate(fromISO)
  const to = parseISODate(toISO)
  if (!from || !to) {
    return 0
  }
  return Math.round(
    (Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day)) /
      86400000,
  )
}

export function worldClock(input: WorldClockInput): WorldClockRow[] | null {
  const dateParts = parseISODate(input.date)
  const timeParts = parseTime(input.time)
  if (!dateParts || !timeParts) {
    return null
  }
  const sourceOffset = effectiveOffset(input.source, Boolean(input.sourceDst))
  if (Math.abs(sourceOffset) > MAX_OFFSET_MINUTES) {
    return null
  }

  const targets: TimezoneZone[] = [input.source]
  const seen = new Set([input.source.id])
  for (const zone of input.zones ?? []) {
    if (seen.has(zone.id)) {
      continue
    }
    seen.add(zone.id)
    targets.push(zone)
  }

  const dstSet = new Set(input.dstIds ?? [])
  const baseMs = Date.UTC(
    dateParts.year,
    dateParts.month - 1,
    dateParts.day,
    timeParts.hour,
    timeParts.minute,
  )
  const rows: WorldClockRow[] = []

  for (const zone of targets) {
    const isSource = zone.id === input.source.id
    const dst = isSource ? Boolean(input.sourceDst) : dstSet.has(zone.id)
    const offset = effectiveOffset(zone, dst)
    if (Math.abs(offset) > MAX_OFFSET_MINUTES) {
      return null
    }
    const target = new Date(baseMs + (offset - sourceOffset) * 60000)
    const targetDate = `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(
      target.getUTCDate(),
    )}`
    const targetTime = `${pad(target.getUTCHours())}:${pad(target.getUTCMinutes())}`
    const diffMinutes = offset - sourceOffset
    const dayOffset = calendarDaysBetween(input.date, targetDate)
    rows.push({
      id: zone.id,
      label: zone.label,
      offsetLabel: offsetLabel(offset),
      date: targetDate,
      time: targetTime,
      weekday: WEEKDAYS[target.getUTCDay()],
      diffMinutes,
      diffLabel: diffLabel(diffMinutes),
      dayOffset,
      dayOffsetLabel: dayOffsetLabel(dayOffset),
      crossDay: dayOffset !== 0,
      dst,
      isSource,
    })
  }

  return rows
}

export function worldClockSummaryText(rows: readonly WorldClockRow[]): string {
  return rows
    .map((row) => {
      const day = row.dayOffset === 0 ? '' : ` ${row.dayOffsetLabel}`
      const dst = row.dst ? ' 夏令时' : ''
      const marker = row.isSource ? '（基准）' : ''
      return `${row.label} ${row.offsetLabel} ${row.date} ${row.time} ${row.weekday}${day}${dst}${marker}`
    })
    .join('\n')
}
