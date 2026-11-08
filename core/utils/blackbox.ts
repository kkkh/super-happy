/* ==========================================================================
   本地黑匣子：记录致命错误 / 未处理 Promise / 页面丢失现场
   - 只写 wx storage，不联网、不上传；环形保留最近 20 条
   - 读取失败或写入超限时静默，绝不让诊断本身再次崩溃
   ========================================================================== */
import { DIAGNOSTICS } from '../constants/index'
import { logger } from './logger'

export type DiagnosticKind = 'app-error' | 'unhandled-rejection' | 'page-not-found' | 'memory-warning'

interface DiagnosticEntry {
  at: number
  kind: DiagnosticKind
  message: string
  stack?: string
  route: string
}

function currentRoute(): string {
  try {
    const pages = getCurrentPages()
    return pages[pages.length - 1]?.route ?? ''
  } catch {
    return ''
  }
}

function describe(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message.slice(0, DIAGNOSTICS.maxMessageLength),
      stack: error.stack?.slice(0, DIAGNOSTICS.maxStackLength),
    }
  }
  return { message: String(error).slice(0, DIAGNOSTICS.maxMessageLength) }
}

/** 写入本地黑匣子；level 仅影响控制台输出，不影响落盘 */
export function recordDiagnostic(
  kind: DiagnosticKind,
  error: unknown,
  level: 'error' | 'warn' = 'error',
): void {
  const { message, stack } = describe(error)
  const entry: DiagnosticEntry = { at: Date.now(), kind, message, stack, route: currentRoute() }
  if (level === 'error') {
    logger.error('blackbox', `${kind}: ${message}`, error)
  } else {
    logger.warn('blackbox', `${kind}: ${message}`)
  }
  try {
    const raw = wx.getStorageSync(DIAGNOSTICS.storageKey) as unknown
    const list = Array.isArray(raw) ? raw : []
    list.unshift(entry)
    wx.setStorageSync(DIAGNOSTICS.storageKey, list.slice(0, DIAGNOSTICS.maxEntries))
  } catch {
    // 存储不可用时仅保留控制台记录
  }
}
