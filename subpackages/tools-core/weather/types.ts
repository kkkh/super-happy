/* ==========================================================================
   weather/types · 全息气象站数据契约
   - 只收录高德标准天气 API 实际返回的字段
   - 温度 / 湿度允许 null，UI 用「—」诚实降级，绝不用 0 伪造
   ========================================================================== */

/** 天气图标族：60+ 官方天气现象归并为有限族，未知走兜底 */
export type WeatherFamily =
  | 'clear'
  | 'partly'
  | 'cloudy'
  | 'overcast'
  | 'wind'
  | 'haze'
  | 'rain'
  | 'heavyRain'
  | 'thunder'
  | 'snow'
  | 'sleet'
  | 'dust'
  | 'fog'
  | 'tornado'
  | 'hot'
  | 'cold'
  | 'unknown'

export interface LiveWeather {
  province: string
  city: string
  adcode: string
  weather: string
  temperature: number | null
  winddirection: string
  windpower: string
  humidity: number | null
  reporttime: string
}

export interface ForecastDay {
  date: string
  /** 官方原始 week 字段（实际返回 1-7 数字） */
  week: string
  /** 归一化后的「周一…周日」 */
  weekLabel: string
  dayweather: string
  nightweather: string
  daytemp: number | null
  nighttemp: number | null
  daywind: string
  nightwind: string
  daypower: string
  nightpower: string
}

export interface ForecastWeather {
  province: string
  city: string
  adcode: string
  reporttime: string
  /** 最多 4 天，按接口实际 casts 长度返回 */
  days: ForecastDay[]
}

export type CitySource = 'fuzzy' | 'ip' | 'manual'

export interface CityCandidate {
  adcode: string
  name: string
  province: string
  city: string
  level: string
  center?: GeoPoint
}

export interface SavedCity {
  adcode: string
  name: string
  province: string
  city: string
  source: CitySource
  center?: GeoPoint
  updatedAt: number
}

export interface GeoPoint {
  lng: number
  lat: number
}

export interface CacheEntry<T> {
  version: 1
  fetchedAt: number
  reporttime: string
  data: T
}

export interface CacheRead<T> {
  data: T
  fetchedAt: number
  reporttime: string
  ageMs: number
  stale: boolean
}

export type WeatherFailureKind =
  | 'config'
  | 'network'
  | 'timeout'
  | 'api'
  | 'parse'
  | 'aborted'

export interface WeatherFailure {
  kind: WeatherFailureKind
  endpoint: string
  infocode: string
  info: string
  statusCode: number
  retryable: boolean
}

export interface RequestLogEntry {
  endpoint: string
  startedAt: number
  durationMs: number
  statusCode: number
  infocode: string
  ok: boolean
  cacheHit: boolean
  adcode: string
  label: string
}

export type SunKind = 'normal' | 'polar-day' | 'polar-night'

export interface SunTimes {
  kind: SunKind
  /** HH:mm；极昼 / 极夜时为提示文案 */
  sunrise: string
  sunset: string
  sunriseMinutes: number | null
  sunsetMinutes: number | null
}

export interface HourlyPoint {
  /** 0-23 本地小时 */
  hour: number
  label: string
  temp: number
  isNight: boolean
  weather: string
}

export type AmbientScene = 'rain' | 'wind' | null

export interface ForecastDayView extends ForecastDay {
  daytempText: string
  nighttempText: string
  dayFamily: WeatherFamily
  nightFamily: WeatherFamily
}

export interface RegeoResult {
  province: string
  city: string
  district: string
  adcode: string
  center?: GeoPoint
}
