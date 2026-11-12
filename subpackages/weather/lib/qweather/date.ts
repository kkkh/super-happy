/* ==========================================================================
   和风天气 · 城市本地日期
   - 统一按城市 utcOffset 计算，避免设备时区与查看城市不一致时「今天」错位
   - 仅做日期键计算，不依赖 wx / 页面，可被数据层与组件复用
   ========================================================================== */

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** 城市本地日期键 yyyy-MM-dd；utcOffset 非法时回退设备本地日期 */
export function dateKeyForOffset(utcOffset?: string, dayOffset = 0, now = Date.now()): string {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(String(utcOffset || ''))
  const base = now + dayOffset * 24 * 60 * 60 * 1000
  const hours = match ? Number(match[2]) : 0
  const minutes = match ? Number(match[3]) : 0
  const validOffset = Boolean(match) && hours <= 14 && minutes < 60 && !(hours === 14 && minutes > 0)
  if (!match || !validOffset) {
    const date = new Date(base)
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  }
  const sign = match[1] === '-' ? -1 : 1
  const local = new Date(base + sign * (hours * 60 + minutes) * 60 * 1000)
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`
}

export function todayKeyFor(utcOffset?: string): string {
  return dateKeyForOffset(utcOffset, 0)
}

/** yyyy-MM-dd → M/D，用于日期快捷条标签 */
export function monthDayText(dateKey: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  return match ? `${Number(match[2])}/${Number(match[3])}` : dateKey
}
