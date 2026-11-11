/* ==========================================================================
   元宝搜索服务 · 腾讯云 WSA SearchPro
   - 只负责请求、响应归一化与错误映射；页面 / 首页只消费结构化结果
   - 凭证二选一：TC3 SecretId/SecretKey（当前采用）或服务 API KEY（Bearer）
   - 查询词只在本次请求内使用，不写草稿、不写计算轨迹、不打印日志
   - 文档：https://cloud.tencent.com/document/product/1806/130615
   ========================================================================== */
import { YUANBAO_CONFIG } from './config-local'
import { signTc3 } from './sign'

export interface YuanbaoSearchOptions {
  /** 搜索词，1–100 字 */
  query: string
  /** 返回条数：10 / 20 / 30 / 40 / 50；极速版不支持 */
  cnt?: number
  /** 时效范围：d7 / m1 / y1 等，直接透传官方格式 */
  freshness?: string
  /** 垂直领域：gov / news / acad / finance；极速版不支持 */
  industry?: string
  /** 指定站点或排除站点：qq.com / exclude:qq.com|sohu.com */
  site?: string
  /** 是否返回附件子链；仅旗舰版支持 */
  deeplinks?: boolean
}

export interface YuanbaoPicture {
  caption: string
  originUrl: string
}

export interface YuanbaoDeeplink {
  title: string
  url: string
}

export interface YuanbaoResult {
  title: string
  url: string
  site: string
  date: string
  passage: string
  content: string
  score: number
  authorityLevel: number
  favicon: string
  pics: YuanbaoPicture[]
  deeplinks: YuanbaoDeeplink[]
}

export interface YuanbaoSearchResult {
  query: string
  version: string
  requestId: string
  message: string
  results: YuanbaoResult[]
}

export type YuanbaoErrorCode =
  | 'empty-query'
  | 'not-configured'
  | 'network'
  | 'timeout'
  | 'http'
  | 'parse'
  | 'unauthorized'
  | 'not-activated'
  | 'quota'
  | 'unavailable'
  | 'invalid-parameter'
  | 'server'

export class YuanbaoError extends Error {
  readonly code: YuanbaoErrorCode
  readonly retryable: boolean

  constructor(code: YuanbaoErrorCode, message: string, retryable = false) {
    super(message)
    this.name = 'YuanbaoError'
    this.code = code
    this.retryable = retryable
    Object.setPrototypeOf(this, YuanbaoError.prototype)
  }
}

export interface YuanbaoRequestHooks {
  /** 页面保存 RequestTask，离开 / 新搜索时 abort，避免迟到结果覆盖新状态 */
  onTask?: (task: WechatMiniprogram.RequestTask) => void
}

export const YUANBAO_MAX_QUERY = 100
export const YUANBAO_CNT_OPTIONS = [10, 20, 30, 40, 50] as const
export const YUANBAO_FRESHNESS_OPTIONS = [
  { value: '', label: '不限时间' },
  { value: 'd7', label: '近 7 天' },
  { value: 'm1', label: '近 1 月' },
  { value: 'y1', label: '近 1 年' },
] as const
export const YUANBAO_INDUSTRY_OPTIONS = [
  { value: '', label: '不限领域' },
  { value: 'news', label: '新闻' },
  { value: 'acad', label: '学术' },
  { value: 'finance', label: '财经' },
  { value: 'gov', label: '政府' },
] as const

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** wx.request 可能把 JSON 响应解析为对象，也可能保留字符串 */
function asPayload(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
}

/** 官方结果含 <strong> 等 HTML 标签；小程序 text 不解析 HTML，统一转纯文本 */
export function plainText(value: unknown): string {
  const text = asString(value)
  if (!text) {
    return ''
  }
  return decodeEntities(text.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function parsePictures(value: unknown): YuanbaoPicture[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .map((item) => {
      const record = asRecord(item)
      if (!record) {
        return null
      }
      const caption = plainText(record.caption)
      const originUrl = asString(record.origin_url || record.originUrl)
      if (!originUrl) {
        return null
      }
      return { caption, originUrl }
    })
    .filter((item): item is YuanbaoPicture => item !== null)
}

function parseDeeplinks(value: unknown): YuanbaoDeeplink[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .map((item) => {
      const record = asRecord(item)
      if (!record) {
        return null
      }
      const title = plainText(record.title)
      const url = asString(record.url)
      if (!url) {
        return null
      }
      return { title, url }
    })
    .filter((item): item is YuanbaoDeeplink => item !== null)
}

/** Pages 中每一项是 JSON 字符串；兼容未来直接返回对象的情况 */
export function parseYuanbaoPage(raw: unknown): YuanbaoResult | null {
  let record = asRecord(raw)
  if (!record && typeof raw === 'string') {
    const text = raw.trim()
    if (!text) {
      return null
    }
    try {
      record = asRecord(JSON.parse(text))
    } catch {
      return null
    }
  }
  if (!record) {
    return null
  }
  const title = plainText(record.title)
  const url = asString(record.url)
  if (!title && !url) {
    return null
  }
  return {
    title,
    url,
    site: plainText(record.site),
    date: plainText(record.date),
    passage: plainText(record.passage),
    content: plainText(record.content),
    score: asNumber(record.score),
    authorityLevel: asNumber(record.authority_level || record.authorityLevel),
    favicon: asString(record.favicon),
    pics: parsePictures(record.pics),
    deeplinks: parseDeeplinks(record.deeplinks),
  }
}

function mapApiError(code: string, message: string): YuanbaoError {
  const normalized = code.replace(/^.*?\./, '')
  if (
    code.startsWith('AuthFailure') ||
    normalized === 'UnauthorizedOperation' ||
    normalized === 'SignatureFailure' ||
    normalized === 'SecretIdNotFound'
  ) {
    return new YuanbaoError('unauthorized', '元宝搜索密钥无效或未授权，请检查本地配置', false)
  }
  if (code.startsWith('ResourceNotFound')) {
    return new YuanbaoError('not-activated', '元宝搜索服务未开通，请先在腾讯云控制台开通', false)
  }
  if (code.startsWith('RequestLimitExceeded')) {
    return new YuanbaoError('quota', '元宝搜索请求过于频繁，请稍后再试', true)
  }
  if (code.startsWith('ResourceUnavailable')) {
    return new YuanbaoError('unavailable', '元宝搜索资源不可用，请检查账号余额或服务状态', false)
  }
  if (code.startsWith('InvalidParameter')) {
    return new YuanbaoError('invalid-parameter', message || '搜索参数不合法', false)
  }
  return new YuanbaoError('server', message || '元宝搜索暂时不可用，请稍后再试', true)
}

export function isYuanbaoConfigured(): boolean {
  const apiKey = YUANBAO_CONFIG.apiKey.trim()
  const secretId = YUANBAO_CONFIG.secretId.trim()
  const secretKey = YUANBAO_CONFIG.secretKey.trim()
  return Boolean(apiKey || (secretId && secretKey))
}

/**
 * 解析服务端响应；无论 HTTP 200 内嵌 Error 还是正常 Pages 都在这里归一化。
 * 导出供单测直接构造官方响应。
 */
export function parseYuanbaoResponse(payload: unknown): YuanbaoSearchResult {
  const root = asRecord(payload)
  const response = root ? asRecord(root.Response) : null
  if (!response) {
    throw new YuanbaoError('parse', '元宝搜索返回格式异常', true)
  }
  const error = asRecord(response.Error)
  if (error) {
    throw mapApiError(asString(error.Code), plainText(error.Message))
  }

  const rawPages = Array.isArray(response.Pages) ? response.Pages : []
  const results = rawPages
    .map((page) => parseYuanbaoPage(page))
    .filter((page): page is YuanbaoResult => page !== null)

  return {
    query: asString(response.Query),
    version: asString(response.Version),
    requestId: asString(response.RequestId),
    message: plainText(response.Msg),
    results,
  }
}

export function searchYuanbao(
  options: YuanbaoSearchOptions,
  hooks: YuanbaoRequestHooks = {},
): Promise<YuanbaoSearchResult> {
  const query = options.query.trim()
  if (!query) {
    return Promise.reject(new YuanbaoError('empty-query', '请输入搜索词'))
  }
  if (query.length > YUANBAO_MAX_QUERY) {
    return Promise.reject(new YuanbaoError('invalid-parameter', `搜索词最多 ${YUANBAO_MAX_QUERY} 字`))
  }
  if (!isYuanbaoConfigured()) {
    return Promise.reject(
      new YuanbaoError('not-configured', '尚未配置元宝搜索密钥'),
    )
  }

  const data: Record<string, unknown> = { Query: query }
  if (options.cnt) {
    data.Cnt = options.cnt
  }
  if (options.freshness) {
    data.Freshness = options.freshness
  }
  if (options.industry) {
    data.Industry = options.industry
  }
  if (options.site && options.site.trim()) {
    data.Site = options.site.trim()
  }
  if (options.deeplinks) {
    data.Deeplinks = true
  }

  /* 固定 JSON 字符串作为请求体，保证 TC3 签名的 payload 与实际发送字节一致 */
  const payload = JSON.stringify(data)
  const apiKey = YUANBAO_CONFIG.apiKey.trim()
  const useApiKey = Boolean(apiKey)
  const headers: Record<string, string> = useApiKey
    ? {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${apiKey}`,
      }
    : signTc3({
        secretId: YUANBAO_CONFIG.secretId.trim(),
        secretKey: YUANBAO_CONFIG.secretKey.trim(),
        host: 'wsa.tencentcloudapi.com',
        service: 'wsa',
        action: 'SearchPro',
        version: '2025-05-08',
        payload,
        timestamp: Math.floor(Date.now() / 1000),
      }).headers

  return new Promise((resolve, reject) => {
    const task = wx.request({
      url: useApiKey ? YUANBAO_CONFIG.endpoint : 'https://wsa.tencentcloudapi.com/',
      method: 'POST',
      timeout: YUANBAO_CONFIG.timeout,
      header: headers,
      data: payload,
      success(response) {
        if (response.statusCode === 401 || response.statusCode === 403) {
          reject(
            new YuanbaoError('unauthorized', '元宝搜索密钥无效或未授权，请检查本地配置'),
          )
          return
        }
        if (response.statusCode === 429) {
          reject(new YuanbaoError('quota', '元宝搜索请求过于频繁，请稍后再试', true))
          return
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(
            new YuanbaoError('http', `元宝搜索请求失败（HTTP ${response.statusCode}）`, true),
          )
          return
        }
        try {
          resolve(parseYuanbaoResponse(asPayload(response.data)))
        } catch (error) {
          reject(
            error instanceof YuanbaoError
              ? error
              : new YuanbaoError('parse', '元宝搜索返回格式异常', true),
          )
        }
      },
      fail(error) {
        const message = asString(error && error.errMsg)
        if (/url not in domain list/i.test(message)) {
          reject(
            new YuanbaoError(
              'network',
              '域名未加入 request 合法域名：请在 MP 后台添加 wsa.tencentcloudapi.com',
              false,
            ),
          )
          return
        }
        if (/ssl|certificate|handshake/i.test(message)) {
          reject(new YuanbaoError('network', 'TLS 握手失败，请检查网络或证书', true))
          return
        }
        const timeout = /timeout/i.test(message)
        reject(
          timeout
            ? new YuanbaoError('timeout', '元宝搜索超时，请稍后再试', true)
            : new YuanbaoError('network', '网络不可用，请检查网络后重试', true),
        )
      },
    })
    hooks.onTask?.(task)
  })
}

/** 导出 / 分享 / Workflow 统一使用的纯文本摘要 */
export function summarizeYuanbaoResults(
  query: string,
  results: YuanbaoResult[],
  limit = 3,
): string {
  if (!results.length) {
    return `元宝搜索「${query}」暂无结果`
  }
  const lines = results.slice(0, limit).map((result, index) => {
    const source = result.site ? `（${result.site}）` : ''
    return `${index + 1}. ${result.title}${source}\n${result.url}`
  })
  return [`元宝搜索「${query}」，共 ${results.length} 条结果`, ...lines].join('\n')
}
