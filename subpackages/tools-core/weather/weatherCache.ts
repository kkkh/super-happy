/* ==========================================================================
   weather/weatherCache · L2 本地缓存与城市表
   - 实况 15 分钟 / 预报 30 分钟；失败负缓存 60 秒
   - 城市最多 5 个；缓存键只用 6 位 adcode，绝不写入坐标明文
   - 缓存是可丢弃数据：读写失败一律静默降级，不阻塞主流程
   ========================================================================== */
import type {
  CacheEntry,
  CacheRead,
  ForecastWeather,
  LiveWeather,
  SavedCity,
  WeatherFailureKind,
} from './types'

export const LIVE_TTL_MS = 15 * 60 * 1000
export const FORECAST_TTL_MS = 30 * 60 * 1000
export const NEGATIVE_TTL_MS = 60 * 1000
export const MANUAL_REFRESH_CD_MS = 60 * 1000
export const MAX_CITIES = 5

export const WEATHER_CACHE_KEYS = {
  cities: 'weather:cities:v1',
  current: 'weather:current:v1',
  ambient: 'weather:ambient:v1',
  lab: 'weather:lab:v1',
  manualRefresh: 'weather:manual-refresh:v1',
  live: (adcode: string) => `weather:live:v1:${adcode}`,
  forecast: (adcode: string) => `weather:forecast:v1:${adcode}`,
  failure: (adcode: string, kind: WeatherFailureKind) =>
    `weather:fail:v1:${adcode}:${kind}`,
} as const

export interface WeatherStorage {
  get(key: string): unknown
  set(key: string, value: unknown): void
  remove(key: string): void
}

export function createWxWeatherStorage(): WeatherStorage {
  return {
    get(key) {
      try {
        return wx.getStorageSync(key)
      } catch {
        return null
      }
    },
    set(key, value) {
      try {
        wx.setStorageSync(key, value)
      } catch {
        /* 缓存写失败不阻塞天气主流程 */
      }
    },
    remove(key) {
      try {
        wx.removeStorageSync(key)
      } catch {
        /* 删除失败忽略 */
      }
    },
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  return null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isAdcode(value: unknown): value is string {
  return typeof value === 'string' && /^\d{6}$/.test(value)
}

function sanitizeLive(value: unknown): LiveWeather | null {
  const record = asRecord(value)
  if (!record) {
    return null
  }
  const adcode = text(record.adcode)
  const weather = text(record.weather)
  if (!isAdcode(adcode) || !weather) {
    return null
  }
  const temperature = record.temperature
  const humidity = record.humidity
  return {
    province: text(record.province),
    city: text(record.city),
    adcode,
    weather,
    temperature: typeof temperature === 'number' && Number.isFinite(temperature) ? temperature : null,
    winddirection: text(record.winddirection),
    windpower: text(record.windpower),
    humidity: typeof humidity === 'number' && Number.isFinite(humidity) ? humidity : null,
    reporttime: text(record.reporttime),
  }
}

function sanitizeForecast(value: unknown): ForecastWeather | null {
  const record = asRecord(value)
  if (!record || !Array.isArray(record.days)) {
    return null
  }
  const days = record.days
    .slice(0, 4)
    .map((item) => {
      const day = asRecord(item)
      if (!day) {
        return null
      }
      const date = text(day.date)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return null
      }
      const daytemp = day.daytemp
      const nighttemp = day.nighttemp
      return {
        date,
        week: text(day.week),
        weekLabel: text(day.weekLabel),
        dayweather: text(day.dayweather),
        nightweather: text(day.nightweather),
        daytemp: typeof daytemp === 'number' && Number.isFinite(daytemp) ? daytemp : null,
        nighttemp: typeof nighttemp === 'number' && Number.isFinite(nighttemp) ? nighttemp : null,
        daywind: text(day.daywind),
        nightwind: text(day.nightwind),
        daypower: text(day.daypower),
        nightpower: text(day.nightpower),
      }
    })
    .filter((day): day is NonNullable<typeof day> => Boolean(day))
  if (days.length === 0) {
    return null
  }
  return {
    province: text(record.province),
    city: text(record.city),
    adcode: text(record.adcode),
    reporttime: text(record.reporttime),
    days,
  }
}

function readCache<T>(
  storage: WeatherStorage,
  key: string,
  now: number,
  ttl: number,
  validate: (value: unknown) => T | null,
): CacheRead<T> | null {
  const raw = storage.get(key)
  const entry = asRecord(raw) as (CacheEntry<unknown> & Record<string, unknown>) | null
  if (!entry || entry.version !== 1) {
    return null
  }
  const fetchedAt = finiteNumber(entry.fetchedAt)
  const data = validate(entry.data)
  if (fetchedAt === null || !data) {
    return null
  }
  const ageMs = Math.max(0, now - fetchedAt)
  return {
    data,
    fetchedAt,
    reporttime: text(entry.reporttime),
    ageMs,
    stale: ageMs > ttl,
  }
}

function writeCache<T>(
  storage: WeatherStorage,
  key: string,
  data: T,
  reporttime: string,
  now: number,
): void {
  const entry: CacheEntry<T> = {
    version: 1,
    fetchedAt: now,
    reporttime,
    data,
  }
  storage.set(key, entry)
}

export function readLiveCache(
  storage: WeatherStorage,
  adcode: string,
  now: number,
): CacheRead<LiveWeather> | null {
  if (!isAdcode(adcode)) {
    return null
  }
  return readCache(storage, WEATHER_CACHE_KEYS.live(adcode), now, LIVE_TTL_MS, sanitizeLive)
}

export function writeLiveCache(
  storage: WeatherStorage,
  live: LiveWeather,
  now: number,
  adcodeOverride?: string,
): void {
  const adcode = adcodeOverride && isAdcode(adcodeOverride) ? adcodeOverride : live.adcode
  if (!isAdcode(adcode)) {
    return
  }
  writeCache(storage, WEATHER_CACHE_KEYS.live(adcode), live, live.reporttime, now)
}

export function readForecastCache(
  storage: WeatherStorage,
  adcode: string,
  now: number,
): CacheRead<ForecastWeather> | null {
  if (!isAdcode(adcode)) {
    return null
  }
  return readCache(
    storage,
    WEATHER_CACHE_KEYS.forecast(adcode),
    now,
    FORECAST_TTL_MS,
    sanitizeForecast,
  )
}

export function writeForecastCache(
  storage: WeatherStorage,
  forecast: ForecastWeather,
  adcode: string,
  now: number,
): void {
  if (!isAdcode(adcode)) {
    return
  }
  writeCache(
    storage,
    WEATHER_CACHE_KEYS.forecast(adcode),
    forecast,
    forecast.reporttime,
    now,
  )
}

export function writeNegativeCache(
  storage: WeatherStorage,
  adcode: string,
  kind: WeatherFailureKind,
  now: number,
): void {
  if (!isAdcode(adcode)) {
    return
  }
  storage.set(WEATHER_CACHE_KEYS.failure(adcode, kind), {
    version: 1,
    failedAt: now,
  })
}

export function hasRecentFailure(
  storage: WeatherStorage,
  adcode: string,
  kind: WeatherFailureKind,
  now: number,
): boolean {
  if (!isAdcode(adcode)) {
    return false
  }
  const raw = asRecord(storage.get(WEATHER_CACHE_KEYS.failure(adcode, kind)))
  const failedAt = raw ? finiteNumber(raw.failedAt) : null
  if (failedAt === null) {
    return false
  }
  return now - failedAt < NEGATIVE_TTL_MS
}

export function removeCityCache(storage: WeatherStorage, adcode: string): void {
  if (!isAdcode(adcode)) {
    return
  }
  const kinds: WeatherFailureKind[] = ['network', 'timeout', 'api', 'parse', 'config']
  storage.remove(WEATHER_CACHE_KEYS.live(adcode))
  storage.remove(WEATHER_CACHE_KEYS.forecast(adcode))
  for (const kind of kinds) {
    storage.remove(WEATHER_CACHE_KEYS.failure(adcode, kind))
  }
}

function sanitizeCity(value: unknown): SavedCity | null {
  const record = asRecord(value)
  if (!record) {
    return null
  }
  const adcode = text(record.adcode)
  const name = text(record.name).slice(0, 20)
  if (!isAdcode(adcode) || !name) {
    return null
  }
  const source = text(record.source)
  const safeSource = source === 'fuzzy' || source === 'ip' || source === 'manual' ? source : 'manual'
  const centerRecord = asRecord(record.center)
  const lng = centerRecord ? finiteNumber(centerRecord.lng) : null
  const lat = centerRecord ? finiteNumber(centerRecord.lat) : null
  const center =
    lng !== null && lat !== null && lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90
      ? { lng, lat }
      : undefined
  const updatedAt = finiteNumber(record.updatedAt)
  return {
    adcode,
    name,
    province: text(record.province),
    city: text(record.city),
    source: safeSource,
    ...(center ? { center } : {}),
    updatedAt: updatedAt === null ? 0 : updatedAt,
  }
}

export function readCities(storage: WeatherStorage): SavedCity[] {
  const raw = storage.get(WEATHER_CACHE_KEYS.cities)
  if (!Array.isArray(raw)) {
    return []
  }
  const output: SavedCity[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const city = sanitizeCity(item)
    if (!city || seen.has(city.adcode)) {
      continue
    }
    seen.add(city.adcode)
    output.push(city)
    if (output.length >= MAX_CITIES) {
      break
    }
  }
  return output
}

export function writeCities(storage: WeatherStorage, cities: SavedCity[]): SavedCity[] {
  const output: SavedCity[] = []
  const seen = new Set<string>()
  for (const item of cities) {
    const city = sanitizeCity(item)
    if (!city || seen.has(city.adcode)) {
      continue
    }
    seen.add(city.adcode)
    output.push(city)
  }
  const trimmed = output.slice(0, MAX_CITIES)
  storage.set(WEATHER_CACHE_KEYS.cities, trimmed)
  return trimmed
}

export function readCurrentAdcode(storage: WeatherStorage): string {
  const raw = storage.get(WEATHER_CACHE_KEYS.current)
  return isAdcode(raw) ? raw : ''
}

export function writeCurrentAdcode(storage: WeatherStorage, adcode: string): void {
  if (isAdcode(adcode)) {
    storage.set(WEATHER_CACHE_KEYS.current, adcode)
  }
}

export function readAmbientEnabled(storage: WeatherStorage): boolean {
  return storage.get(WEATHER_CACHE_KEYS.ambient) === true
}

export function writeAmbientEnabled(storage: WeatherStorage, enabled: boolean): void {
  storage.set(WEATHER_CACHE_KEYS.ambient, enabled === true)
}

export function readLabEnabled(storage: WeatherStorage): boolean {
  return storage.get(WEATHER_CACHE_KEYS.lab) === true
}

export function writeLabEnabled(storage: WeatherStorage, enabled: boolean): void {
  storage.set(WEATHER_CACHE_KEYS.lab, enabled === true)
}

export function readManualRefreshAt(storage: WeatherStorage): number {
  const value = storage.get(WEATHER_CACHE_KEYS.manualRefresh)
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function writeManualRefreshAt(storage: WeatherStorage, now: number): void {
  storage.set(WEATHER_CACHE_KEYS.manualRefresh, now)
}

export function findCity(cities: SavedCity[], adcode: string): SavedCity | null {
  return cities.find((city) => city.adcode === adcode) || null
}
