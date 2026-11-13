/* ==========================================================================
   realtime-log · 线上实时日志（微信后台「实时日志」）
   - 只上报 error / warn；同文案 30s 内去重，单次会话最多 100 条
   - 单条截断 500 字符，避免超过实时日志单次 5KB 限制
   - 基础库 < 2.7.1 或 API 不可用时静默降级，绝不影响业务
   ========================================================================== */

const DEDUP_WINDOW_MS = 30000
const MAX_PER_SESSION = 100
const MAX_MESSAGE_LENGTH = 500

let manager: WechatMiniprogram.RealtimeLogManager | null | undefined
let emitted = 0
const recent = new Map<string, number>()

function getManager(): WechatMiniprogram.RealtimeLogManager | null {
  if (manager !== undefined) {
    return manager
  }
  try {
    manager =
      typeof wx !== 'undefined' && typeof wx.getRealtimeLogManager === 'function'
        ? wx.getRealtimeLogManager()
        : null
  } catch {
    manager = null
  }
  return manager
}

/** 去重与配额判定：同 key 30s 内只放行一次，会话总量封顶 */
export function shouldEmitRealtime(key: string, now: number = Date.now()): boolean {
  if (emitted >= MAX_PER_SESSION) {
    return false
  }
  const last = recent.get(key)
  if (last !== undefined && now - last < DEDUP_WINDOW_MS) {
    return false
  }
  recent.set(key, now)
  emitted += 1
  return true
}

/** 上报一条实时日志；返回是否真正写入 */
export function logRealtime(
  level: 'info' | 'warn' | 'error',
  module: string,
  message: string,
  extra?: Record<string, unknown>,
): boolean {
  const logManager = getManager()
  if (!logManager) {
    return false
  }
  const key = `${level}|${module}|${message}`
  if (!shouldEmitRealtime(key)) {
    return false
  }
  try {
    const text = `[${module}] ${message}`.slice(0, MAX_MESSAGE_LENGTH)
    if (level === 'error') {
      logManager.error(text, extra ?? '')
    } else if (level === 'warn') {
      logManager.warn(text, extra ?? '')
    } else {
      logManager.info(text)
    }
    return true
  } catch {
    return false
  }
}

/** 仅测试使用：重置内存状态 */
export function resetRealtimeLogForTest(): void {
  manager = undefined
  emitted = 0
  recent.clear()
}
