/* ==========================================================================
   weather/weatherService · 高德 Web服务 REST 唯一网络入口
   - 只走 https://restapi.amap.com，只用 Web服务 Key，不传 jscode
   - 所有失败收敛为 WeatherError；日志与诊断绝不输出完整 Key
   - 传输层可注入，Node 测试不依赖 wx.request
   ========================================================================== */
import { AMAP_WEB_SERVICE_KEY } from './config'
import {
  parseDistrictSearch,
  parseForecastWeather,
  parseIpLocation,
  parseLiveWeather,
  parseRegeo,
} from './weatherParse'
import type {
  CityCandidate,
  ForecastWeather,
  LiveWeather,
  RegeoResult,
  WeatherFailure,
  WeatherFailureKind,
} from './types'
import type { IpLocationResult } from './weatherParse'

export const WEATHER_BASE_URL = 'https://restapi.amap.com'
export const WEATHER_TIMEOUT_MS = 8000

export const WEATHER_ENDPOINTS = {
  live: '/v3/weather/weatherInfo',
  forecast: '/v3/weather/weatherInfo',
  regeo: '/v3/geocode/regeo',
  ip: '/v3/ip',
  district: '/v3/config/district',
} as const

export interface HttpResponse {
  statusCode: number
  data: unknown
}

export interface HttpTask {
  promise: Promise<HttpResponse>
  abort: () => void
}

export type HttpTransport = (options: { url: string; timeout: number }) => HttpTask

export class WeatherError extends Error {
  readonly kind: WeatherFailureKind
  readonly endpoint: string
  readonly infocode: string
  readonly info: string
  readonly statusCode: number
  readonly retryable: boolean

  constructor(failure: WeatherFailure) {
    super(failure.info || failure.kind)
    this.name = 'WeatherError'
    this.kind = failure.kind
    this.endpoint = failure.endpoint
    this.infocode = failure.infocode
    this.info = failure.info
    this.statusCode = failure.statusCode
    this.retryable = failure.retryable
  }

  toFailure(): WeatherFailure {
    return {
      kind: this.kind,
      endpoint: this.endpoint,
      infocode: this.infocode,
      info: this.info,
      statusCode: this.statusCode,
      retryable: this.retryable,
    }
  }
}

export interface WeatherRequest<T> {
  promise: Promise<T>
  abort: () => void
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function decodePayload(data: unknown): unknown {
  if (typeof data !== 'string') {
    return data
  }
  try {
    return JSON.parse(data)
  } catch {
    return null
  }
}

function isRetryableInfoCode(infocode: string): boolean {
  return infocode === '10015' || infocode === '10016' || infocode === '20003'
}

function readErrorForTransport(endpoint: string, error: unknown): WeatherError {
  const message =
    error && typeof error === 'object' && 'errMsg' in error
      ? String((error as Record<string, unknown>).errMsg || '')
      : String(error || '')
  if (/abort/i.test(message)) {
    return new WeatherError({
      kind: 'aborted',
      endpoint,
      infocode: '',
      info: '请求已取消',
      statusCode: 0,
      retryable: false,
    })
  }
  if (/timeout/i.test(message)) {
    return new WeatherError({
      kind: 'timeout',
      endpoint,
      infocode: '',
      info: '网络请求超时',
      statusCode: 0,
      retryable: true,
    })
  }
  return new WeatherError({
    kind: 'network',
    endpoint,
    infocode: '',
    info: message || '网络请求失败',
    statusCode: 0,
    retryable: true,
  })
}

function readApiError(
  endpoint: string,
  statusCode: number,
  payload: unknown,
): WeatherError | null {
  const record = asRecord(payload)
  const status = record ? String(record.status ?? '') : ''
  if (status === '1') {
    return null
  }
  const infocode = record ? String(record.infocode ?? '') : ''
  const info = record ? String(record.info ?? '') : ''
  return new WeatherError({
    kind: 'api',
    endpoint,
    infocode,
    info: info || '高德接口返回失败',
    statusCode,
    retryable: isRetryableInfoCode(infocode),
  })
}

function buildUrl(
  path: string,
  key: string,
  params: Record<string, string>,
): string {
  const parts = Object.keys(params)
    .filter((name) => params[name] !== '')
    .map((name) => `${encodeURIComponent(name)}=${encodeURIComponent(params[name])}`)
  const query = parts.length > 0 ? `&${parts.join('&')}` : ''
  return `${WEATHER_BASE_URL}${path}?key=${encodeURIComponent(key)}${query}`
}

function defaultTransport(options: { url: string; timeout: number }): HttpTask {
  let task: WechatMiniprogram.RequestTask | null = null
  const promise = new Promise<HttpResponse>((resolve, reject) => {
    try {
      task = wx.request({
        url: options.url,
        method: 'GET',
        timeout: options.timeout,
        dataType: 'json',
        success: (response) => {
          resolve({ statusCode: response.statusCode, data: response.data })
        },
        fail: (error) => {
          reject(error)
        },
      })
    } catch (error) {
      reject(error)
    }
  })
  return {
    promise,
    abort: () => {
      try {
        task?.abort()
      } catch {
        /* 已结束的请求 abort 失败无需处理 */
      }
    },
  }
}

export interface WeatherServiceOptions {
  key?: string
  transport?: HttpTransport
}

export class WeatherService {
  private readonly key: string
  private readonly transport: HttpTransport

  constructor(options: WeatherServiceOptions = {}) {
    this.key = typeof options.key === 'string' ? options.key.trim() : AMAP_WEB_SERVICE_KEY
    this.transport = options.transport ?? defaultTransport
  }

  hasKey(): boolean {
    return this.key.length > 0
  }

  /** 诊断用：只暴露末 4 位，绝不输出完整 Key */
  maskedKey(): string {
    if (!this.key) {
      return '未配置'
    }
    if (this.key.length <= 4) {
      return '••••'
    }
    return `••••${this.key.slice(-4)}`
  }

  private request<T>(
    path: string,
    params: Record<string, string>,
    endpoint: string,
    parse: (raw: unknown) => T | null,
    missingLabel: string,
  ): WeatherRequest<T> {
    if (!this.key) {
      const error = new WeatherError({
        kind: 'config',
        endpoint,
        infocode: '',
        info: '未配置高德 Web服务 Key',
        statusCode: 0,
        retryable: false,
      })
      return { promise: Promise.reject(error), abort: () => undefined }
    }

    const task = this.transport({
      url: buildUrl(path, this.key, params),
      timeout: WEATHER_TIMEOUT_MS,
    })

    const promise = task.promise
      .catch((error) => {
        throw readErrorForTransport(endpoint, error)
      })
      .then((response) => {
        const payload = decodePayload(response.data)
        const apiError = readApiError(endpoint, response.statusCode, payload)
        if (apiError) {
          throw apiError
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          throw new WeatherError({
            kind: 'network',
            endpoint,
            infocode: '',
            info: `HTTP ${response.statusCode}`,
            statusCode: response.statusCode,
            retryable: true,
          })
        }
        const parsed = parse(payload)
        if (!parsed) {
          throw new WeatherError({
            kind: 'parse',
            endpoint,
            infocode: '',
            info: missingLabel,
            statusCode: response.statusCode,
            retryable: false,
          })
        }
        return parsed
      })

    return {
      promise,
      abort: task.abort,
    }
  }

  fetchLive(adcode: string): WeatherRequest<LiveWeather> {
    return this.request(
      WEATHER_ENDPOINTS.live,
      { city: adcode, extensions: 'base' },
      'weather.live',
      parseLiveWeather,
      '实况天气字段不完整',
    )
  }

  fetchForecast(adcode: string): WeatherRequest<ForecastWeather> {
    return this.request(
      WEATHER_ENDPOINTS.forecast,
      { city: adcode, extensions: 'all' },
      'weather.forecast',
      parseForecastWeather,
      '预报天气字段不完整',
    )
  }

  fetchRegeo(lng: number, lat: number): WeatherRequest<RegeoResult> {
    return this.request(
      WEATHER_ENDPOINTS.regeo,
      {
        location: `${lng.toFixed(6)},${lat.toFixed(6)}`,
        extensions: 'base',
      },
      'geocode.regeo',
      parseRegeo,
      '逆地理编码未返回有效 adcode',
    )
  }

  fetchIpLocation(): WeatherRequest<IpLocationResult> {
    return this.request(
      WEATHER_ENDPOINTS.ip,
      {},
      'ip.location',
      parseIpLocation,
      'IP 定位未返回可用城市',
    )
  }

  searchDistricts(keyword: string): WeatherRequest<CityCandidate[]> {
    return this.request(
      WEATHER_ENDPOINTS.district,
      { keywords: keyword, subdistrict: '0', extensions: 'base' },
      'config.district',
      (raw) => {
        const results = parseDistrictSearch(raw)
        return results.length > 0 ? results : null
      },
      '未找到匹配的行政区',
    )
  }
}
