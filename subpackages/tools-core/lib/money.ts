/* ==========================================================================
   金额与数值容错 · 统一以「分」整数计算
   - 非法输入返回 null，页面负责文案
   - 利率用基点（3.6% = 360bp），避免浮点直接乘
   ========================================================================== */

/** 1 万亿元，仍在 Number 安全整数范围内 */
const MAX_CENTS = 1e14

/** 金额输入 → 分；最多两位小数 */
export function parseCents(raw: string, allowNegative = false): number | null {
  const normalized = raw.trim().replace(/,/g, '')
  const re = allowNegative ? /^-?\d{1,12}(\.\d{1,2})?$/ : /^\d{1,12}(\.\d{1,2})?$/
  if (!re.test(normalized)) {
    return null
  }
  const negative = normalized.startsWith('-')
  const body = negative ? normalized.slice(1) : normalized
  const [yuan, frac = ''] = body.split('.')
  const cents = Number(yuan) * 100 + Number((frac + '00').slice(0, 2))
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) {
    return null
  }
  return negative ? -cents : cents
}

/** 四舍五入到整数分 */
export function roundHalfUp(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value)
}

/** 分 → 千分位字符串（两位小数） */
export function formatCents(cents: number): string {
  return formatNumber(cents / 100, 2)
}

/** 数字 → 千分位字符串 */
export function formatNumber(value: number, fraction = 2): string {
  if (!Number.isFinite(value)) {
    return '—'
  }
  const fixed = value.toFixed(fraction)
  const negative = fixed.startsWith('-')
  const body = negative ? fixed.slice(1) : fixed
  const [integer, decimal] = body.split('.')
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const text = decimal ? `${grouped}.${decimal}` : grouped
  return negative ? `-${text}` : text
}

/** 百分比字符串 → 基点；3.6% → 360bp */
export function parseBasisPoints(raw: string): number | null {
  const normalized = raw.trim().replace(/%/g, '')
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(normalized)) {
    return null
  }
  const bp = Number((Number(normalized) * 100).toFixed(0))
  return Number.isSafeInteger(bp) ? bp : null
}

/** 正整数输入（月数、年限等） */
export function parseInteger(raw: string, min: number, max: number): number | null {
  const normalized = raw.trim()
  if (!/^\d{1,6}$/.test(normalized)) {
    return null
  }
  const value = Number(normalized)
  if (value < min || value > max) {
    return null
  }
  return value
}

/** 小数输入（身高、体重、利率之外的普通数值） */
export function parseDecimal(raw: string, min: number, max: number, decimals = 2): number | null {
  const normalized = raw.trim()
  const pattern = decimals === 0 ? '\\d{1,6}' : `\\d{1,6}(\\.[\\d]{1,${decimals}})?`
  if (!new RegExp(`^${pattern}$`).test(normalized)) {
    return null
  }
  const value = Number(normalized)
  if (!Number.isFinite(value) || value < min || value > max) {
    return null
  }
  return value
}

/** 0–100 的整数（百分比类展示） */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
