/* ==========================================================================
   农历与节气引擎 · 公历 → 农历 / 生肖 / 节气 / 传统节日
   - 词库与换算来自 solarlunar 3.1.0（ISC）单文件 vendor，覆盖 1900–2100
   - 公历 serial 复用 core/toolbox/engines/date.ts 的日期语义
   - 只做本地换算，不联网、不读写用户数据
   ========================================================================== */
import solarLunar from './lunar-data'

export const LUNAR_MIN_DATE = '1900-01-31'
export const LUNAR_MAX_DATE = '2100-12-31'

interface SolarLunarResult {
  lYear: number
  lMonth: number
  lDay: number
  animal: string
  yearCn: string
  monthCn: string
  dayCn: string
  cYear: number
  cMonth: number
  cDay: number
  isLeap: boolean
  ncWeek: string
  isTerm: boolean
  term: string
}

interface SolarLunarLib {
  solar2lunar(year?: number, month?: number, day?: number): SolarLunarResult | -1
  lunar2solar(
    year: number,
    month: number,
    day: number,
    isLeapMonth?: boolean,
  ): SolarLunarResult | -1
  monthDays(year: number, month: number): number
  getTerm(year: number, index: number): number
  lunarTerm: string[]
}

export interface LunarInfo {
  year: number
  month: number
  day: number
  isLeap: boolean
  animal: string
  yearCn: string
  monthCn: string
  dayCn: string
  lunarText: string
  solarYear: number
  solarMonth: number
  solarDay: number
  dateText: string
  weekday: string
  solarTerm: string
  solarTermDate: string
  solarTermToday: boolean
  daysToSolarTerm: number
  festivals: string[]
  summary: string
}

export interface SolarTermInfo {
  name: string
  date: string
  days: number
  isToday: boolean
}

export interface DateParts {
  year: number
  month: number
  day: number
}

const lib = solarLunar as unknown as SolarLunarLib

const FESTIVALS: Record<string, string> = {
  '1-1': '春节',
  '1-15': '元宵',
  '5-5': '端午',
  '8-15': '中秋',
  '9-9': '重阳',
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : `${value}`
}

function isValidDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false
  }
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false
  }
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

function serialOf(year: number, month: number, day: number): number {
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000)
}

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`
}

/** 解析 YYYY-MM-DD / YYYY/MM/DD / YYYY年M月D日 / YYYYMMDD */
export function parseLunarDate(text: string): DateParts | null {
  const value = typeof text === 'string' ? text.trim() : ''
  if (!value) {
    return null
  }
  const separated = value.match(/(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/)
  if (separated) {
    const year = Number(separated[1])
    const month = Number(separated[2])
    const day = Number(separated[3])
    return isValidDate(year, month, day) ? { year, month, day } : null
  }
  const compact = value.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (compact) {
    const year = Number(compact[1])
    const month = Number(compact[2])
    const day = Number(compact[3])
    return isValidDate(year, month, day) ? { year, month, day } : null
  }
  return null
}

/** 农历传统节日：只认非闰月 */
export function lunarFestival(month: number, day: number, isLeap = false): string[] {
  if (isLeap) {
    return []
  }
  const name = FESTIVALS[`${month}-${day}`]
  return name ? [name] : []
}

/**
 * 当日节气；当日无节气则返回下一个节气与距今天数。
 * 超出 2100-12-31 后的节气表无数据，返回 null。
 */
export function solarTermOf(year: number, month: number, day: number): SolarTermInfo | null {
  if (!isValidDate(year, month, day)) {
    return null
  }
  const today = serialOf(year, month, day)
  for (let offset = 0; offset <= 1; offset += 1) {
    const targetYear = year + offset
    for (let index = 1; index <= 24; index += 1) {
      const termMonth = Math.floor((index - 1) / 2) + 1
      const termDay = lib.getTerm(targetYear, index)
      if (!Number.isFinite(termDay) || termDay <= 0) {
        continue
      }
      const serial = serialOf(targetYear, termMonth, termDay)
      if (serial >= today) {
        const name = lib.lunarTerm[index - 1] ?? ''
        return {
          name,
          date: formatDate(targetYear, termMonth, termDay),
          days: serial - today,
          isToday: serial === today,
        }
      }
    }
  }
  return null
}

/** 公历转农历；非法日期或超出 1900-01-31 ~ 2100-12-31 返回 null */
export function toLunar(year: number, month: number, day: number): LunarInfo | null {
  if (!isValidDate(year, month, day)) {
    return null
  }
  const serial = serialOf(year, month, day)
  if (
    serial < serialOf(1900, 1, 31) ||
    serial > serialOf(2100, 12, 31)
  ) {
    return null
  }
  const result = lib.solar2lunar(year, month, day)
  if (!result || result === -1) {
    return null
  }
  const term = solarTermOf(year, month, day)
  const festivals = lunarFestival(result.lMonth, result.lDay, result.isLeap)
  const lunarText = `${result.yearCn}${result.monthCn}${result.dayCn}`
  const info: LunarInfo = {
    year: result.lYear,
    month: result.lMonth,
    day: result.lDay,
    isLeap: result.isLeap,
    animal: result.animal,
    yearCn: result.yearCn,
    monthCn: result.monthCn,
    dayCn: result.dayCn,
    lunarText,
    solarYear: year,
    solarMonth: month,
    solarDay: day,
    dateText: formatDate(year, month, day),
    weekday: result.ncWeek,
    solarTerm: term ? term.name : '',
    solarTermDate: term ? term.date : '',
    solarTermToday: term ? term.isToday : false,
    daysToSolarTerm: term ? term.days : -1,
    festivals,
    summary: '',
  }
  info.summary = lunarSummary(info)
  return info
}

/** 供结果区复制与 Workflow 使用的摘要 */
export function lunarSummary(info: LunarInfo): string {
  const parts = [
    `公历 ${info.dateText}`,
    `农历 ${info.lunarText}`,
    `生肖${info.animal}`,
  ]
  if (info.solarTerm) {
    parts.push(
      info.solarTermToday
        ? `节气 ${info.solarTerm}`
        : `下一节气 ${info.solarTerm}（${info.daysToSolarTerm} 天后）`,
    )
  }
  if (info.festivals.length > 0) {
    parts.push(info.festivals.join('、'))
  }
  return parts.join(' · ')
}

/* ---- 农历生日：公历生日 → 农历生日 → 下次农历生日倒计时 ---- */

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export interface LunarBirthdayInfo {
  /** 公历生日 YYYY-MM-DD */
  birthDateText: string
  /** 完整农历文本，如 一九九五年五月初五 */
  lunarText: string
  monthCn: string
  dayCn: string
  /** 出生是否为闰月 */
  isLeapBirth: boolean
  animal: string
  /** 下次农历生日对应公历；超出范围时为空 */
  nextSolarDate: string
  nextWeekday: string
  /** 距下次生日天数；0 表示今天；-1 表示超出范围 */
  daysUntil: number
  isToday: boolean
  /** 第几个农历生日（出生当天算第 1 个）；0 表示超出范围 */
  birthdayCount: number
  /** 闰月 / 小月 / 范围说明 */
  notes: string[]
  summary: string
}

function currentDateParts(): DateParts {
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() }
}

function weekdayText(year: number, month: number, day: number): string {
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]
}

/**
 * 公历生日 → 农历生日与下次农历生日。
 * - 闰月出生按同月非闰月计算，避免部分年份没有闰月而丢失生日
 * - 目标农历月只有 29 天时按廿九计算
 * - 只支持 1900-01-31 至 2100-12-31
 */
export function lunarBirthday(
  year: number,
  month: number,
  day: number,
  today: DateParts = currentDateParts(),
): LunarBirthdayInfo | null {
  const birth = toLunar(year, month, day)
  const reference = toLunar(today.year, today.month, today.day)
  if (!birth || !reference) {
    return null
  }

  const birthDateText = formatDate(year, month, day)
  const birthSerial = serialOf(year, month, day)
  const todaySerial = serialOf(today.year, today.month, today.day)
  const notes: string[] = []
  if (birth.isLeap) {
    notes.push('闰月生日按同月非闰月计算')
  }

  let nextSolarDate = ''
  let nextWeekday = ''
  let daysUntil = -1
  let birthdayCount = 0
  const startYear = Math.max(birth.year, reference.year)

  for (let lunarYear = startYear; lunarYear <= startYear + 2; lunarYear += 1) {
    let dayToUse = birth.day
    let dayAdjusted = false
    const maxDay = lib.monthDays(lunarYear, birth.month)
    if (maxDay > 0 && dayToUse > maxDay) {
      dayToUse = maxDay
      dayAdjusted = true
    }
    const solar = lib.lunar2solar(lunarYear, birth.month, dayToUse, false)
    if (!solar || solar === -1) {
      continue
    }
    const solarSerial = serialOf(solar.cYear, solar.cMonth, solar.cDay)
    if (solarSerial < birthSerial || solarSerial < todaySerial) {
      continue
    }
    nextSolarDate = formatDate(solar.cYear, solar.cMonth, solar.cDay)
    nextWeekday = weekdayText(solar.cYear, solar.cMonth, solar.cDay)
    daysUntil = solarSerial - todaySerial
    birthdayCount = lunarYear - birth.year + 1
    if (dayAdjusted) {
      notes.push('该年农历月只有 29 天，按廿九计算')
    }
    break
  }

  if (!nextSolarDate) {
    notes.push('下次农历生日超出 2100 年范围')
  }

  const info: LunarBirthdayInfo = {
    birthDateText,
    lunarText: birth.lunarText,
    monthCn: birth.monthCn,
    dayCn: birth.dayCn,
    isLeapBirth: birth.isLeap,
    animal: birth.animal,
    nextSolarDate,
    nextWeekday,
    daysUntil,
    isToday: daysUntil === 0,
    birthdayCount,
    notes,
    summary: '',
  }
  info.summary = lunarBirthdaySummary(info)
  return info
}

export function lunarBirthdaySummary(info: LunarBirthdayInfo): string {
  const parts = [
    `公历 ${info.birthDateText}`,
    `农历 ${info.lunarText}`,
    `生肖${info.animal}`,
  ]
  if (info.nextSolarDate) {
    parts.push(
      info.isToday
        ? '今天就是农历生日'
        : `下次农历生日 ${info.nextSolarDate}（${info.daysUntil} 天后）`,
    )
    parts.push(`第 ${info.birthdayCount} 个农历生日`)
  } else {
    parts.push('下次农历生日超出 2100 年范围')
  }
  if (info.notes.length > 0) {
    parts.push(info.notes.join('；'))
  }
  return parts.join(' · ')
}
