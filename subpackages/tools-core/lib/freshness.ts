/* 元宝搜索自定义时效归一化：页面只负责收集输入，规则统一在此校验 */
export type FreshnessUnit = 'd' | 'm' | 'y'
export type FreshnessMode = 'recent' | 'day' | 'range'

export interface CustomFreshnessInput {
  mode: FreshnessMode
  n: string
  unit: FreshnessUnit
  start: string
  end: string
}

export interface CustomFreshnessResult {
  /** 官方额度：dN / mN / yN 或 yyyy-mm-dd,yyyy-mm-dd；非法时为空 */
  freshness: string
  error: string
}

/** 本地日期（yyyy-mm-dd），避免 toISOString 的 UTC 偏移 */
export function todayISO(): string {
  const date = new Date()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function normalizeCustomFreshness(input: CustomFreshnessInput): CustomFreshnessResult {
  if (input.mode === 'day') {
    if (!input.start) {
      return { freshness: '', error: '请选择日期' }
    }
    if (input.start > todayISO()) {
      return { freshness: '', error: '日期不能晚于今天' }
    }
    return { freshness: input.start, error: '' }
  }

  if (input.mode === 'range') {
    const start = input.start
    const end = input.end
    if (!start || !end) {
      return { freshness: '', error: '请选择完整的日期区间' }
    }
    if (start > end) {
      return { freshness: '', error: '开始日期不能晚于结束日期' }
    }
    if (end > todayISO()) {
      return { freshness: '', error: '结束日期不能晚于今天' }
    }
    return { freshness: `${start},${end}`, error: '' }
  }

  const n = Number(input.n)
  const limits: Record<FreshnessUnit, number> = { d: 30, m: 12, y: 5 }
  const labels: Record<FreshnessUnit, string> = { d: '天', m: '月', y: '年' }
  const limit = limits[input.unit]
  if (!Number.isInteger(n) || n < 1 || n > limit) {
    return { freshness: '', error: `最近 ${labels[input.unit]}需为 1–${limit} 的整数` }
  }
  return { freshness: `${input.unit}${n}`, error: '' }
}
