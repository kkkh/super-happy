/* ==========================================================================
   统一传输层 · Transport 抽象 + 拦截器链 + Result 归一化
   - 纯离线：由本地数据 Transport 兑现（零延迟、天然可用）
   - 错误一律归一化为 AppError；瞬态错误自动退避重试
   ========================================================================== */
import type { AppError, ErrorCode, Result } from '../types/index'
import { NETWORK_POLICY } from '../constants/index'
import { logger } from '../utils/logger'

/** 传输任务描述：领域接口只声明「要什么」，不关心「从哪来」 */
export interface TransportRequest<T> {
  /** 领域命名空间（日志与追踪用） */
  domain: string
  /** 数据获取器：由具体 Transport 实现 */
  fetcher: () => Promise<T> | T
  /** 瞬态错误自动重试次数（默认 0：本地数据瞬回无需重试） */
  retries?: number
}

/** 传输器接口：本地/HTTP/云函数 三态可替换 */
export interface Transport {
  name: string
  execute<T>(request: TransportRequest<T>): Promise<Result<T>>
}

/* ---- 错误工厂 ---- */
function appError(code: ErrorCode, message: string, retryable = false): AppError {
  return { code, message, retryable }
}

/** 拦截器：请求前置（注入追踪上下文） */
function requestInterceptor(domain: string): string {
  return `${domain}#${Date.now().toString(36)}`
}

/** 拦截器：响应归一化（异常 → AppError） */
function normalizeError(domain: string, error: unknown): AppError {
  const message = error instanceof Error ? error.message : String(error)
  /* 领域内「未找到」是预期的正常分支，不应按 error 级别污染控制台 */
  if (message.includes('NOT_FOUND')) {
    logger.warn('transport', `${domain} 未找到`, error)
    return appError('NOT_FOUND', '内容不存在或已下线')
  }
  logger.error('transport', `${domain} 失败`, error)
  if (message.includes('timeout')) {
    return appError('TIMEOUT', '请求超时，请稍后再试', true)
  }
  if (message.includes('fail') || message.includes('network')) {
    return appError('NETWORK', '网络不可用，请检查连接', true)
  }
  return appError('UNKNOWN', message || '未知错误')
}

/** 带抖动的退避延迟（仅瞬态错误消费） */
function backoff(attempt: number): number {
  return (
    Math.min(NETWORK_POLICY.retryBaseMs * 2 ** attempt, NETWORK_POLICY.retryMaxMs) +
    Math.random() * NETWORK_POLICY.retryJitterMs
  )
}

/* ---- 本地数据 Transport（当前生产实现） ---- */
const localTransport: Transport = {
  name: 'local',
  async execute<T>(request: TransportRequest<T>): Promise<Result<T>> {
    const trace = requestInterceptor(request.domain)
    try {
      const data = await request.fetcher()
      logger.info('transport', `${trace} ✓`)
      return { ok: true, data }
    } catch (error) {
      const retries = request.retries ?? 0
      let lastError = normalizeError(request.domain, error)
      for (let attempt = 0; attempt < retries && lastError.retryable; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, backoff(attempt)))
        try {
          const data = await request.fetcher()
          logger.info('transport', `${trace} ✓ (retry ${attempt + 1})`)
          return { ok: true, data }
        } catch (retryError) {
          lastError = normalizeError(request.domain, retryError)
        }
      }
      return { ok: false, error: lastError }
    }
  },
}

/* ---- 领域层统一出口：当前生产实现固定为本地 Transport ---- */
export function send<T>(request: TransportRequest<T>): Promise<Result<T>> {
  return localTransport.execute(request)
}
