/* ==========================================================================
   和风天气 · 请求客户端
   - JWT Bearer / API KEY 双认证，API KEY 优先
   - 统一错误映射：401 / 403 / 429 / 400 / 5xx / 网络 / 取消
   - 返回可 abort 的 handle，页面卸载与城市切换必须全部取消
   - Token / Host / 坐标不写日志、不进分享、不进诊断
   ========================================================================== */

import {
  QWEATHER_API_KEY,
  QWEATHER_HOST,
  QWEATHER_TOKEN,
} from '../../config-local'
import type { QwRequestSpec } from './endpoints'

export type QwErrorKind =
  | 'unconfigured'
  | 'network'
  | 'auth'
  | 'forbidden'
  | 'rate'
  | 'client'
  | 'server'
  | 'parse'
  | 'cancelled'

export class QWeatherError extends Error {
  kind: QwErrorKind
  status: number
  code: string
  detail: string

  constructor(kind: QwErrorKind, message: string, options?: { status?: number; code?: string; detail?: string }) {
    super(message)
    this.name = 'QWeatherError'
    this.kind = kind
    this.status = options?.status || 0
    this.code = options?.code || ''
    this.detail = options?.detail || ''
  }
}

export interface QwRequestHandle<T> {
  promise: Promise<T>
  abort(): void
}

function configured(): boolean {
  return Boolean(QWEATHER_HOST && (QWEATHER_API_KEY || QWEATHER_TOKEN))
}

export function isQWeatherConfigured(): boolean {
  return configured()
}

/** 当前生效的认证方式，用于 API 自检面板展示（不暴露凭据本身） */
export function qweatherAuthMode(): string {
  if (!configured()) {
    return '未配置'
  }
  return QWEATHER_API_KEY ? 'API KEY · X-QW-Api-Key' : 'JWT · EdDSA'
}

function authHeader(): Record<string, string> {
  if (QWEATHER_API_KEY) {
    return { 'X-QW-Api-Key': QWEATHER_API_KEY }
  }
  return { Authorization: `Bearer ${QWEATHER_TOKEN}` }
}

function errorMessage(kind: QwErrorKind, detail = ''): string {
  if (kind === 'unconfigured') {
    return '未配置和风天气凭据，请运行 npm run qweather:token'
  }
  if (kind === 'auth') {
    return '和风天气凭据无效或已过期，请重新生成 Token'
  }
  if (kind === 'forbidden') {
    return '和风天气拒绝请求：请检查额度、请求限制或 API Host'
  }
  if (kind === 'rate') {
    return '请求过于频繁，请稍后重试'
  }
  if (kind === 'network') {
    return '网络不可用，请检查网络后重试'
  }
  if (kind === 'cancelled') {
    return '请求已取消'
  }
  if (kind === 'parse') {
    return '和风天气返回了无法解析的数据'
  }
  if (kind === 'server') {
    return '和风天气服务暂时不可用，请稍后重试'
  }
  return detail || '和风天气请求失败'
}

function mapHttp(status: number, body: unknown): QWeatherError {
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const error = record.error && typeof record.error === 'object'
    ? (record.error as Record<string, unknown>)
    : null
  const detail =
    (error && typeof error.detail === 'string' && error.detail) ||
    (typeof record.error === 'string' ? record.error : '') ||
    ''
  const code = error && typeof error.type === 'string' ? error.type : String(record.code || '')
  if (status === 401) {
    return new QWeatherError('auth', errorMessage('auth'), { status, code, detail })
  }
  if (status === 403) {
    return new QWeatherError('forbidden', errorMessage('forbidden'), { status, code, detail })
  }
  if (status === 429) {
    return new QWeatherError('rate', errorMessage('rate'), { status, code, detail })
  }
  if (status >= 500) {
    return new QWeatherError('server', errorMessage('server'), { status, code, detail })
  }
  if (status >= 400) {
    return new QWeatherError('client', detail || '请求参数有误，请检查城市或日期', { status, code, detail })
  }
  return new QWeatherError('parse', errorMessage('parse'), { status, code, detail })
}

function mapBody(body: unknown): QWeatherError | null {
  if (!body || typeof body !== 'object') {
    return null
  }
  const record = body as Record<string, unknown>
  if (record.error && typeof record.error === 'object') {
    const error = record.error as Record<string, unknown>
    const status = typeof error.status === 'number' ? error.status : 400
    return mapHttp(status, body)
  }
  const code = typeof record.code === 'string' ? record.code : ''
  if (!code || code === '200' || code === '204') {
    /* 204 表示请求成功但该地区暂无数据，按空结果交给解析层降级展示 */
    return null
  }
  const status = Number(code) || 400
  if (code === '401') {
    return new QWeatherError('auth', errorMessage('auth'), { status, code })
  }
  if (code === '403') {
    return new QWeatherError('forbidden', errorMessage('forbidden'), { status, code })
  }
  if (code === '429') {
    return new QWeatherError('rate', errorMessage('rate'), { status, code })
  }
  if (code === '404') {
    return new QWeatherError('client', '没有查询到地点或数据', { status, code })
  }
  return new QWeatherError('client', `和风天气错误码 ${code}`, { status, code })
}

export function requestQWeather<T>(spec: QwRequestSpec): QwRequestHandle<T> {
  if (!configured()) {
    return {
      promise: Promise.reject(new QWeatherError('unconfigured', errorMessage('unconfigured'))),
      abort: () => undefined,
    }
  }

  let task: WechatMiniprogram.RequestTask | null = null
  let aborted = false
  const promise = new Promise<T>((resolve, reject) => {
    try {
      task = wx.request({
        url: `https://${QWEATHER_HOST}${spec.path}`,
        method: 'GET',
        timeout: 12000,
        dataType: 'json',
        header: {
          ...authHeader(),
          Accept: 'application/json',
        },
        success: (response) => {
          if (aborted) {
            reject(new QWeatherError('cancelled', errorMessage('cancelled')))
            return
          }
          const status = response.statusCode || 0
          if (status < 200 || status >= 300) {
            reject(mapHttp(status, response.data))
            return
          }
          const bodyError = mapBody(response.data)
          if (bodyError) {
            reject(bodyError)
            return
          }
          resolve(response.data as T)
        },
        fail: (error) => {
          if (aborted || String(error.errMsg || '').includes('abort')) {
            reject(new QWeatherError('cancelled', errorMessage('cancelled')))
            return
          }
          reject(new QWeatherError('network', errorMessage('network'), { detail: String(error.errMsg || '') }))
        },
      })
    } catch (error) {
      reject(
        new QWeatherError('network', errorMessage('network'), {
          detail: error instanceof Error ? error.message : 'request exception',
        }),
      )
    }
  })

  return {
    promise,
    abort: () => {
      aborted = true
      try {
        task?.abort()
      } catch {
        /* 已结束 */
      }
    },
  }
}

export function describeQWeatherError(error: unknown): string {
  if (error instanceof QWeatherError) {
    const detail = String(error.detail || '').trim()
    /* 域名白名单是最高频的「网络不可用」原因，直接给出可执行结论 */
    if (error.kind === 'network' && /url not in domain list|domain list/i.test(detail)) {
      return `请求域名未加入小程序后台「request 合法域名」：${QWEATHER_HOST}`
    }
    if (error.kind === 'network' && detail) {
      return `${error.message}（${detail}）`
    }
    if ((error.kind === 'forbidden' || error.kind === 'auth') && detail) {
      return `${error.message}（${detail}）`
    }
    return error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return '和风天气请求失败'
}
