/* ==========================================================================
   和风天气 · 业务编排
   - 组合接口、缓存、解析、取消
   - 页面不直接拼 URL / 不直接解析原始 JSON
   - 每个方法都可被页面单独调用，便于按 Tab 懒加载
   ========================================================================== */

import { describeQWeatherError, requestQWeather, type QwRequestHandle } from './client'
import { readQwCache, writeQwCache } from './cache'
import { cityFromPoint } from './city'
import {
  airCurrent,
  airDaily,
  airHourly,
  astronomyMoon,
  astronomySolar,
  astronomySun,
  endpointCatalog,
  history,
  indices,
  minutely,
  weatherAlert,
  weatherCurrent,
  weatherDailyV1,
  weatherDailyV7,
  weatherHourlyV1,
  weatherHourlyV7,
  weatherNowV7,
  type QwRequestSpec,
} from './endpoints'
import {
  parseAirCurrent,
  parseAirDaily,
  parseAirHourly,
  parseAlerts,
  parseCurrentV1,
  parseDailyV1,
  parseDailyV7,
  parseHistory,
  parseHourlyV1,
  parseHourlyV7,
  parseIndices,
  parseMinutely,
  parseMoon,
  parseNowV7,
  parseSolar,
  parseSun,
  todayKey,
  todayKeyFor,
  dateKeyForOffset,
} from './parse'
import type {
  QwAirDayView,
  QwAirHourView,
  QwAirView,
  QwAlertView,
  QwCity,
  QwCurrentView,
  QwDailyRange,
  QwDailyView,
  QwHistoryView,
  QwHourlyRange,
  QwHourlyView,
  QwIndicesView,
  QwMinutelyView,
  QwMoonView,
  QwSolarView,
  QwSunView,
} from './types'

export interface QwLoadResult<T> {
  data: T
  fromCache: boolean
  at: number
}

export interface QwDailyResult {
  days: QwDailyView[]
  source: 'v1' | 'v7'
}

export interface QwAirResult {
  current: QwAirView
  hourly: QwAirHourView[]
  daily: QwAirDayView[]
}

export interface QwAstronomyResult {
  sun: QwSunView
  moon: QwMoonView
  solar: QwSolarView | null
}

export interface QwEndpointRunResult {
  ok: boolean
  latency: number
  count: number
  error: string
}

function yyyymmdd(value: string): string {
  return value.replace(/-/g, '')
}

function countRaw(raw: unknown): number {
  if (Array.isArray(raw)) {
    return raw.length
  }
  if (!raw || typeof raw !== 'object') {
    return 0
  }
  const record = raw as Record<string, unknown>
  for (const key of ['days', 'hours', 'hourly', 'weatherHourly', 'minutely', 'alerts', 'daily', 'location', 'topCityList', 'poi', 'indexes', 'pollutants']) {
    const value = record[key]
    if (Array.isArray(value)) {
      return value.length
    }
  }
  if (record.metadata && typeof record.metadata === 'object') {
    return 1
  }
  return 1
}

export class QWeatherService {
  private handles = new Map<string, QwRequestHandle<unknown>>()

  abortAll(): void {
    this.handles.forEach((handle) => handle.abort())
    this.handles.clear()
  }

  /** 仅取消指定前缀的请求（如 astro| / history|），不影响其他 Tab */
  abortPrefix(prefix: string): void {
    if (!prefix) {
      return
    }
    Array.from(this.handles.entries()).forEach(([key, handle]) => {
      if (key.startsWith(prefix)) {
        handle.abort()
        this.handles.delete(key)
      }
    })
  }

  private async call<T>(
    spec: QwRequestSpec,
    parser: (raw: unknown) => T,
    options: { force?: boolean; utcOffset?: string } = {},
  ): Promise<QwLoadResult<T>> {
    if (spec.cacheable && !options.force) {
      const cached = readQwCache<T>(spec.cacheKey)
      if (cached !== null) {
        return { data: cached, fromCache: true, at: Date.now() }
      }
    }
    const previous = this.handles.get(spec.cacheKey)
    if (previous) {
      previous.abort()
      this.handles.delete(spec.cacheKey)
    }
    const handle = requestQWeather<unknown>(spec)
    this.handles.set(spec.cacheKey, handle)
    try {
      const raw = await handle.promise
      const data = parser(raw)
      if (spec.cacheable) {
        writeQwCache(spec.cacheKey, data, spec.ttlMs, options.utcOffset)
      }
      return { data, fromCache: false, at: Date.now() }
    } finally {
      if (this.handles.get(spec.cacheKey) === handle) {
        this.handles.delete(spec.cacheKey)
      }
    }
  }

  async loadCurrent(city: QwCity, force = false): Promise<QwLoadResult<QwCurrentView>> {
    const [current, now] = await Promise.all([
      this.call(weatherCurrent(city), (raw) => raw, { force, utcOffset: city.utcOffset }),
      /* v7 只用于昼夜图标对照，失败不应拖垮 v1 实况 */
      this.call(weatherNowV7(city), (raw) => parseNowV7(raw), { force, utcOffset: city.utcOffset }).catch(() => null),
    ])
    return {
      data: parseCurrentV1(current.data, now ? now.data.icon : '', now ? now.data.obsTime : ''),
      fromCache: current.fromCache && (!now || now.fromCache),
      at: now ? Math.min(current.at, now.at) : current.at,
    }
  }

  async loadHourly(city: QwCity, range: QwHourlyRange, force = false): Promise<QwLoadResult<QwHourlyView[]>> {
    if (range === 72 || range === 168) {
      return this.call(weatherHourlyV7(city, range), (raw) => parseHourlyV7(raw, range), {
        force,
        utcOffset: city.utcOffset,
      })
    }
    return this.call(weatherHourlyV1(city, range), (raw) => parseHourlyV1(raw, range), {
      force,
      utcOffset: city.utcOffset,
    })
  }

  async loadDaily(city: QwCity, range: QwDailyRange, force = false): Promise<QwLoadResult<QwDailyResult>> {
    const today = todayKeyFor(city.utcOffset)
    if (range === 3 || range === 7 || range === 15 || range === 30) {
      const result = await this.call(weatherDailyV7(city, range), (raw) => parseDailyV7(raw, range, today), {
        force,
        utcOffset: city.utcOffset,
      })
      return { ...result, data: { days: result.data, source: 'v7' } }
    }
    const [v1, v7] = await Promise.all([
      this.call(weatherDailyV1(city, 10), (raw) => parseDailyV1(raw, 10, today), {
        force,
        utcOffset: city.utcOffset,
      }),
      /* v7 只补充气压 / 能见度 / 月相，失败时保留 v1 全部字段 */
      this.call(weatherDailyV7(city, 10), (raw) => parseDailyV7(raw, 10, today), {
        force,
        utcOffset: city.utcOffset,
      }).catch(() => null),
    ])
    const merged = v1.data.map((day) => {
      const extra = v7 ? v7.data.find((item) => item.date === day.date) : undefined
      if (!extra) {
        return day
      }
      return {
        ...day,
        iconDay: extra.iconDay && extra.iconDay !== '9999' ? extra.iconDay : day.iconDay,
        iconNight: extra.iconNight && extra.iconNight !== '9999' ? extra.iconNight : day.iconNight,
        pressureText: extra.pressureText !== '—' ? extra.pressureText : day.pressureText,
        visibilityText: extra.visibilityText !== '—' ? extra.visibilityText : day.visibilityText,
        moonPhase: extra.moonPhase !== '—' ? extra.moonPhase : day.moonPhase,
        moonIcon: extra.moonPhase !== '—' && extra.moonIcon !== '9999' ? extra.moonIcon : day.moonIcon,
      }
    })
    return {
      data: { days: merged, source: 'v1' },
      fromCache: v1.fromCache && (!v7 || v7.fromCache),
      at: v7 ? Math.min(v1.at, v7.at) : v1.at,
    }
  }

  async loadMinutely(city: QwCity, force = false): Promise<QwLoadResult<QwMinutelyView>> {
    return this.call(minutely(city), parseMinutely, { force, utcOffset: city.utcOffset })
  }

  async loadAlerts(city: QwCity, force = false): Promise<QwLoadResult<QwAlertView[]>> {
    return this.call(weatherAlert(city), parseAlerts, { force, utcOffset: city.utcOffset })
  }

  async loadAir(city: QwCity, force = false): Promise<QwLoadResult<QwAirResult>> {
    const today = todayKeyFor(city.utcOffset)
    const [current, hourly, daily] = await Promise.all([
      this.call(airCurrent(city), parseAirCurrent, { force, utcOffset: city.utcOffset }),
      /* 24 小时与 3 天是增强信息，失败不影响实时 AQI */
      this.call(airHourly(city), parseAirHourly, { force, utcOffset: city.utcOffset }).catch(() => null),
      this.call(airDaily(city), (raw) => parseAirDaily(raw, today), {
        force,
        utcOffset: city.utcOffset,
      }).catch(() => null),
    ])
    return {
      data: {
        current: current.data,
        hourly: hourly ? hourly.data : [],
        daily: daily ? daily.data : [],
      },
      fromCache: current.fromCache && (!hourly || hourly.fromCache) && (!daily || daily.fromCache),
      at: Math.min(current.at, hourly ? hourly.at : current.at, daily ? daily.at : current.at),
    }
  }

  async loadIndices(city: QwCity, days: 1 | 3, force = false): Promise<QwLoadResult<QwIndicesView[]>> {
    return this.call(indices(city, days), (raw) => parseIndices(raw, todayKeyFor(city.utcOffset)), {
      force,
      utcOffset: city.utcOffset,
    })
  }

  async loadAstronomy(
    city: QwCity,
    date: string,
    time = '1200',
    altitude = 0,
    force = false,
  ): Promise<QwLoadResult<QwAstronomyResult>> {
    const tz = city.utcOffset.replace(':', '').replace('+', '')
    const [sun, moon, solar] = await Promise.all([
      this.call(astronomySun(city, date), parseSun, { force, utcOffset: city.utcOffset }),
      this.call(astronomyMoon(city, date), (raw) => parseMoon(raw, todayKeyFor(city.utcOffset)), {
        force,
        utcOffset: city.utcOffset,
      }),
      /* 太阳高度角是增强信息，单独失败时保留日出日落与月相 */
      this.call(
        astronomySolar({ city, date, time, tz, alt: altitude }),
        parseSolar,
        { force, utcOffset: city.utcOffset },
      ).catch(() => null),
    ])
    return {
      data: { sun: sun.data, moon: moon.data, solar: solar ? solar.data : null },
      fromCache: sun.fromCache && moon.fromCache && (!solar || solar.fromCache),
      at: Math.min(sun.at, moon.at, solar ? solar.at : sun.at),
    }
  }

  async loadHistory(city: QwCity, date: string, force = false): Promise<QwLoadResult<QwHistoryView>> {
    let target = city
    /* 兼容未保存 parentId 的旧景点城市：时光机只接受城市 LocationID */
    if (city.source === 'poi' && !city.parentId) {
      const parent = await cityFromPoint(city.lat, city.lon)
      if (parent && parent.id) {
        target = { ...city, parentId: parent.id }
      }
    }
    return this.call(history(target, yyyymmdd(date)), parseHistory, { force, utcOffset: city.utcOffset })
  }

  catalog(city: QwCity): QwRequestSpec[] {
    return endpointCatalog(city, dateKeyForOffset(city.utcOffset, -1))
  }

  async runEndpoint(spec: QwRequestSpec): Promise<QwEndpointRunResult> {
    const start = Date.now()
    const handleKey = `run|${spec.key}`
    /* 同端点重复自检：先取消旧请求，避免旧响应写回 */
    this.handles.get(handleKey)?.abort()
    const handle = requestQWeather<unknown>(spec)
    this.handles.set(handleKey, handle)
    try {
      const raw = await handle.promise
      return {
        ok: true,
        latency: Date.now() - start,
        count: countRaw(raw),
        error: '',
      }
    } catch (error) {
      return {
        ok: false,
        latency: Date.now() - start,
        count: 0,
        error: describeQWeatherError(error),
      }
    } finally {
      if (this.handles.get(handleKey) === handle) {
        this.handles.delete(handleKey)
      }
    }
  }

  today(): string {
    return todayKey()
  }
}

export const qweatherService = new QWeatherService()
