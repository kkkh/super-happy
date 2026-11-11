/* ==========================================================================
   weather/weatherParse · 高德天气 / 逆地理 / IP / 行政区响应严格解析
   - 所有字段先收口再进 UI：数组、空串、NaN、越界一律降级
   - reporttime 使用手写组件解析，避免 iOS new Date 字符串解析失效
   ========================================================================== */
import type {
  CityCandidate,
  ForecastDay,
  ForecastWeather,
  GeoPoint,
  LiveWeather,
  RegeoResult,
} from './types'

const ADCODE_PATTERN = /^\d{6}$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/

export interface ParsedTime {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

export function toText(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim()
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => toText(item))
      .filter(Boolean)
      .join('')
  }
  return ''
}

function toInteger(value: unknown, min: number, max: number): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return null
    }
    const rounded = Math.round(value)
    return rounded >= min && rounded <= max ? rounded : null
  }
  const text = toText(value)
  if (!text) {
    return null
  }
  const parsed = Number(text)
  if (!Number.isFinite(parsed)) {
    return null
  }
  const rounded = Math.round(parsed)
  return rounded >= min && rounded <= max ? rounded : null
}

export function parseAmapTime(value: unknown): ParsedTime | null {
  const text = toText(value)
  const match = TIME_PATTERN.exec(text)
  if (!match) {
    return null
  }
  const parsed: ParsedTime = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6]),
  }
  if (
    parsed.month < 1 ||
    parsed.month > 12 ||
    parsed.day < 1 ||
    parsed.day > 31 ||
    parsed.hour > 23 ||
    parsed.minute > 59 ||
    parsed.second > 59
  ) {
    return null
  }
  return parsed
}

/** 官方 week 实际返回 1-7 数字；统一转成中文星期 */
export function formatWeek(raw: string): string {
  const text = toText(raw)
  const numeric = Number(text)
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 7) {
    return ['周一', '周二', '周三', '周四', '周五', '周六', '周日'][numeric - 1]
  }
  return text
}

export function formatReportTime(raw: string): string {
  const parsed = parseAmapTime(raw)
  if (!parsed) {
    return toText(raw) || '—'
  }
  const month = String(parsed.month).padStart(2, '0')
  const day = String(parsed.day).padStart(2, '0')
  const hour = String(parsed.hour).padStart(2, '0')
  const minute = String(parsed.minute).padStart(2, '0')
  return `${month}-${day} ${hour}:${minute}`
}

export function formatReportTimeAria(raw: string): string {
  const parsed = parseAmapTime(raw)
  if (!parsed) {
    return '数据发布时间未知'
  }
  return `数据发布于 ${parsed.year} 年 ${parsed.month} 月 ${parsed.day} 日 ${parsed.hour} 时 ${parsed.minute} 分`
}

export function formatTemperature(value: number | null): string {
  return value === null ? '—' : String(value)
}

export function parseLiveWeather(raw: unknown): LiveWeather | null {
  const payload = asRecord(raw)
  const lives = payload && Array.isArray(payload.lives) ? payload.lives : []
  const item = asRecord(lives[0])
  if (!item) {
    return null
  }
  const weather = toText(item.weather)
  const adcode = toText(item.adcode)
  if (!weather || !ADCODE_PATTERN.test(adcode)) {
    return null
  }
  return {
    province: toText(item.province),
    city: toText(item.city),
    adcode,
    weather,
    temperature: toInteger(item.temperature, -90, 60),
    winddirection: toText(item.winddirection),
    windpower: toText(item.windpower),
    humidity: toInteger(item.humidity, 0, 100),
    reporttime: toText(item.reporttime),
  }
}

export function parseForecastWeather(raw: unknown): ForecastWeather | null {
  const payload = asRecord(raw)
  if (!payload) {
    return null
  }
  const forecasts = payload.forecasts
  const list = Array.isArray(forecasts)
    ? forecasts
    : forecasts && typeof forecasts === 'object'
      ? [forecasts]
      : []
  const item = asRecord(list[0])
  if (!item) {
    return null
  }
  const casts = Array.isArray(item.casts) ? item.casts : []
  const days: ForecastDay[] = []
  for (const cast of casts) {
    if (days.length >= 4) {
      break
    }
    const day = asRecord(cast)
    if (!day) {
      continue
    }
    const date = toText(day.date)
    if (!DATE_PATTERN.test(date)) {
      continue
    }
    days.push({
      date,
      week: toText(day.week),
      weekLabel: formatWeek(toText(day.week)),
      dayweather: toText(day.dayweather),
      nightweather: toText(day.nightweather),
      daytemp: toInteger(day.daytemp, -90, 60),
      nighttemp: toInteger(day.nighttemp, -90, 60),
      daywind: toText(day.daywind),
      nightwind: toText(day.nightwind),
      daypower: toText(day.daypower),
      nightpower: toText(day.nightpower),
    })
  }
  if (days.length === 0) {
    return null
  }
  return {
    province: toText(item.province),
    city: toText(item.city),
    adcode: toText(item.adcode),
    reporttime: toText(item.reporttime),
    days,
  }
}

export function parseRegeo(raw: unknown): RegeoResult | null {
  const payload = asRecord(raw)
  const regeocode = payload ? asRecord(payload.regeocode) : null
  const component = regeocode ? asRecord(regeocode.addressComponent) : null
  if (!component) {
    return null
  }
  const adcode = toText(component.adcode)
  if (!ADCODE_PATTERN.test(adcode)) {
    return null
  }
  const province = toText(component.province)
  const city = toText(component.city) || province
  const district = toText(component.district)
  if (!province && !city) {
    return null
  }
  return { province, city, district, adcode }
}

export function parseRectangleCenter(raw: unknown): GeoPoint | undefined {
  const text = toText(raw)
  if (!text.includes(';')) {
    return undefined
  }
  const [leftBottom, rightTop] = text.split(';')
  const left = leftBottom.split(',').map(Number)
  const right = rightTop.split(',').map(Number)
  if (left.length !== 2 || right.length !== 2) {
    return undefined
  }
  if (![...left, ...right].every((value) => Number.isFinite(value))) {
    return undefined
  }
  return {
    lng: (left[0] + right[0]) / 2,
    lat: (left[1] + right[1]) / 2,
  }
}

export interface IpLocationResult {
  province: string
  city: string
  adcode: string
  center?: GeoPoint
}

export function parseIpLocation(raw: unknown): IpLocationResult | null {
  const payload = asRecord(raw)
  if (!payload) {
    return null
  }
  const province = toText(payload.province)
  const city = toText(payload.city)
  const adcode = toText(payload.adcode)
  /* 局域网 / 非法 IP / 国外 IP：高德会返回「局域网」或空值，直接跳过 */
  if (!province || province === '局域网' || !city || !ADCODE_PATTERN.test(adcode)) {
    return null
  }
  return {
    province,
    city,
    adcode,
    center: parseRectangleCenter(payload.rectangle),
  }
}

export function parseDistrictSearch(raw: unknown): CityCandidate[] {
  const payload = asRecord(raw)
  const districts = payload && Array.isArray(payload.districts) ? payload.districts : []
  const output: CityCandidate[] = []
  const seen = new Set<string>()
  for (const item of districts) {
    if (output.length >= 8) {
      break
    }
    const record = asRecord(item)
    if (!record) {
      continue
    }
    const adcode = toText(record.adcode)
    const name = toText(record.name)
    const level = toText(record.level)
    if (!ADCODE_PATTERN.test(adcode) || !name || seen.has(adcode)) {
      continue
    }
    if (level !== 'province' && level !== 'city' && level !== 'district') {
      continue
    }
    const center = parseCenterText(record.center)
    seen.add(adcode)
    output.push({
      adcode,
      name,
      province: level === 'province' ? name : '',
      city: level === 'city' ? name : '',
      level,
      center,
    })
  }
  return output
}

export function parseCenterText(raw: unknown): GeoPoint | undefined {
  const text = toText(raw)
  if (!text.includes(',')) {
    return undefined
  }
  const [lngText, latText] = text.split(',')
  const lng = Number(lngText)
  const lat = Number(latText)
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return undefined
  }
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
    return undefined
  }
  return { lng, lat }
}

export function buildWeatherSummary(live: LiveWeather): string {
  const place = live.city || live.province || '当前城市'
  const temp = live.temperature === null ? '' : ` ${live.temperature}℃`
  return `${place} ${live.weather}${temp}`.trim()
}

export function isNightHour(hour: number): boolean {
  return hour < 6 || hour >= 18
}
