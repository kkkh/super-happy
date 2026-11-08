/* ==========================================================================
   结构化日志 · 统一 tag + 分级 + 领域标记
   - 线上仅 warn/error 全量输出；info 供联调排查
   ========================================================================== */
import { LOG_TAG } from '../constants/index'
import { isDevtools } from './platform'

type Level = 'info' | 'warn' | 'error'

function emit(level: Level, domain: string, message: string, detail?: unknown): void {
  const line = `${LOG_TAG}[${domain}] ${message}`
  if (level === 'error') {
    console.error(line, detail ?? '')
  } else if (level === 'warn') {
    console.warn(line, detail ?? '')
  } else {
    console.log(line, detail ?? '')
  }
}

export const logger = {
  /* info 只服务开发联调；真机生产环境不输出 console.log */
  info: (domain: string, message: string, detail?: unknown) => {
    if (!isDevtools()) {
      return
    }
    emit('info', domain, message, detail)
  },
  warn: (domain: string, message: string, detail?: unknown) => emit('warn', domain, message, detail),
  error: (domain: string, message: string, detail?: unknown) => emit('error', domain, message, detail),
}
