/* ==========================================================================
   汇率换算 · 纯函数
   - 8 个固定币种；支持 CFETS 官方中间价与用户手动牌价两种来源
   - 金额以分整数计算；牌价最多 6 位小数；结果四舍五入到分
   - 不宣称实时汇率；官方输出带来源与“仅供参考”，手动输出带“手动填写，仅供参考”
   ========================================================================== */
import { formatCents, parseCents } from '../../../core/toolbox/engines/money'

export type FxCurrencyCode = 'CNY' | 'USD' | 'EUR' | 'JPY' | 'HKD' | 'GBP' | 'AUD' | 'CAD'

export interface FxCurrency {
  code: FxCurrencyCode
  name: string
}

export const FX_CURRENCIES: FxCurrency[] = [
  { code: 'CNY', name: '人民币' },
  { code: 'USD', name: '美元' },
  { code: 'EUR', name: '欧元' },
  { code: 'JPY', name: '日元' },
  { code: 'HKD', name: '港币' },
  { code: 'GBP', name: '英镑' },
  { code: 'AUD', name: '澳元' },
  { code: 'CAD', name: '加元' },
]

export const FX_RATE_MIN = 0.000001
export const FX_RATE_MAX = 1000000
export const FX_RATE_DECIMALS = 6
/** 1 亿分 = 1,000,000.00 元；超过即拒绝 */
export const FX_MAX_AMOUNT_CENTS = 100000000
export const FX_DATE_MIN = '2000-01-01'

export interface FxConvertInput {
  amountCents: number
  rate: number
  from: FxCurrencyCode
  to: FxCurrencyCode
  rateDate: string
}

export interface FxConvertResult {
  from: FxCurrencyCode
  to: FxCurrencyCode
  amountCents: number
  rate: number
  rateDate: string
  convertedCents: number
  inverseRate: number
}

export interface FxOfficialRates {
  /** 官方中间价日期 YYYY-MM-DD */
  date: string
  /** 官方发布时间，如 2026-11-10 9:15 */
  updatedAt: string
  /** 1 单位外币 = ? 人民币；JPY 已按 100 日元折算为 1 日元 */
  rates: Record<FxCurrencyCode, number>
}

const CFETS_PAIRS: Record<string, FxCurrencyCode> = {
  'USD/CNY': 'USD',
  'EUR/CNY': 'EUR',
  '100JPY/CNY': 'JPY',
  'HKD/CNY': 'HKD',
  'GBP/CNY': 'GBP',
  'AUD/CNY': 'AUD',
  'CAD/CNY': 'CAD',
}

/** 解析中国外汇交易中心中间价 JSON；缺币种或日期非法返回 null */
export function parseCfetsRates(payload: unknown): FxOfficialRates | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }
  const root = payload as { data?: Record<string, unknown>; records?: unknown }
  const data = root.data
  const records = root.records
  if (!data || !Array.isArray(records)) {
    return null
  }
  const updatedAt = typeof data.lastDate === 'string' ? data.lastDate.trim() : ''
  const date = updatedAt.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return null
  }
  const rates: Partial<Record<FxCurrencyCode, number>> = { CNY: 1 }
  for (const raw of records) {
    if (!raw || typeof raw !== 'object') {
      continue
    }
    const record = raw as { vrtEName?: unknown; price?: unknown }
    const pair = typeof record.vrtEName === 'string' ? record.vrtEName : ''
    const code = CFETS_PAIRS[pair]
    const price = Number(record.price)
    if (!code || !Number.isFinite(price) || price <= 0) {
      continue
    }
    rates[code] = pair === '100JPY/CNY' ? price / 100 : price
  }
  const required: FxCurrencyCode[] = ['USD', 'EUR', 'JPY', 'HKD', 'GBP', 'AUD', 'CAD']
  if (required.some((code) => !rates[code])) {
    return null
  }
  return {
    date,
    updatedAt,
    rates: rates as Record<FxCurrencyCode, number>,
  }
}

/** 官方中间价交叉汇率：1 from = ? to；同币种或缺价返回 null */
export function officialCrossRate(
  from: FxCurrencyCode,
  to: FxCurrencyCode,
  official: FxOfficialRates | null,
): number | null {
  if (!official || from === to) {
    return null
  }
  const fromCny = official.rates[from]
  const toCny = official.rates[to]
  if (!Number.isFinite(fromCny) || !Number.isFinite(toCny) || fromCny <= 0 || toCny <= 0) {
    return null
  }
  const rate = fromCny / toCny
  if (!Number.isFinite(rate) || rate < FX_RATE_MIN || rate > FX_RATE_MAX) {
    return null
  }
  return rate
}


export function fxCurrencyLabel(code: FxCurrencyCode): string {
  const item = FX_CURRENCIES.find((currency) => currency.code === code)
  return item ? `${item.code} ${item.name}` : code
}

/** 金额输入 → 分；0、负数、超 1 亿分与非法格式返回 null */
export function parseFxAmount(raw: string): number | null {
  const cents = parseCents(raw)
  if (cents === null || cents <= 0 || cents > FX_MAX_AMOUNT_CENTS) {
    return null
  }
  return cents
}

/** 牌价输入 → 数字；范围 0.000001–1000000，最多 6 位小数 */
export function parseFxRate(raw: string): number | null {
  const normalized = typeof raw === 'string' ? raw.trim().replace(/,/g, '') : ''
  if (!/^\d{1,7}(\.\d{1,6})?$/.test(normalized)) {
    return null
  }
  const value = Number(normalized)
  if (!Number.isFinite(value) || value < FX_RATE_MIN || value > FX_RATE_MAX) {
    return null
  }
  return value
}

/** 牌价展示：最多 6 位小数，去掉无意义的末尾 0 */
export function formatFxRate(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) {
    return '—'
  }
  return rate
    .toFixed(FX_RATE_DECIMALS)
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '')
}

/** 牌价日期提醒：早于 2000 或晚于今天只提示，不阻止换算 */
export function fxDateWarning(rateDate: string, today: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rateDate)) {
    return '请选择有效的牌价日期'
  }
  if (rateDate < FX_DATE_MIN) {
    return '牌价日期早于 2000-01-01，仍按手动牌价换算，请确认日期'
  }
  if (rateDate > today) {
    return '牌价日期晚于今天，仍按手动牌价换算，请确认日期'
  }
  return ''
}

/** 手动汇率换算；同币种、非法金额或牌价返回 null */
export function convertManual(input: FxConvertInput): FxConvertResult | null {
  const { amountCents, rate, from, to, rateDate } = input
  if (
    !Number.isInteger(amountCents) ||
    amountCents <= 0 ||
    amountCents > FX_MAX_AMOUNT_CENTS ||
    !Number.isFinite(rate) ||
    rate < FX_RATE_MIN ||
    rate > FX_RATE_MAX ||
    from === to ||
    !FX_CURRENCIES.some((item) => item.code === from) ||
    !FX_CURRENCIES.some((item) => item.code === to)
  ) {
    return null
  }
  const convertedCents = Math.round(amountCents * rate)
  if (!Number.isSafeInteger(convertedCents) || convertedCents < 0) {
    return null
  }
  return {
    from,
    to,
    amountCents,
    rate,
    rateDate,
    convertedCents,
    inverseRate: 1 / rate,
  }
}

/** 从 Workflow 文本中取第一个金额数字（支持千分位与两位小数） */
export function parseFxWorkflowAmount(text: string): number | null {
  const value = typeof text === 'string' ? text : ''
  const match = value.match(/-?\d[\d,]*(?:\.\d{1,2})?/)
  if (!match) {
    return null
  }
  return parseFxAmount(match[0])
}

/** 复制与 Workflow 共用的摘要；手动模式必须包含“手动填写，仅供参考” */
export function fxSummary(
  result: FxConvertResult,
  source: 'manual' | 'official' = 'manual',
  sourceLabel = '',
): string {
  const parts = [
    `${formatCents(result.amountCents)} ${result.from} × ${formatFxRate(result.rate)} = ${formatCents(result.convertedCents)} ${result.to}`,
    `反向 1 ${result.to} = ${formatFxRate(result.inverseRate)} ${result.from}`,
    `牌价日期 ${result.rateDate}`,
  ]
  if (source === 'official') {
    parts.push(
      `来源 ${sourceLabel || '中国外汇交易中心（CFETS）官方中间价'}`,
      '官方中间价，仅供参考',
    )
  } else {
    parts.push('汇率由用户手动填写，仅供参考')
  }
  return parts.join(' · ')
}
