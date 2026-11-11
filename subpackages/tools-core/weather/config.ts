/* ==========================================================================
   weather/config · 高德 Web服务 Key 唯一读取入口
   - 真实 Key 放在 config.local.ts（已被 .gitignore 忽略）
   - 未配置时页面进入引导态，绝不发起请求，也不在日志/诊断里输出 Key
   - 这不是 JS API 的 jscode；Web服务 REST 只需要 key
   ========================================================================== */
import { AMAP_WEB_SERVICE_KEY as LOCAL_KEY } from './config.local'

const rawKey = typeof LOCAL_KEY === 'string' ? LOCAL_KEY.trim() : ''

export const AMAP_WEB_SERVICE_KEY = rawKey

export function hasAmapWebKey(): boolean {
  return AMAP_WEB_SERVICE_KEY.length > 0
}
