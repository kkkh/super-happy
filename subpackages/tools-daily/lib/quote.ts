/* ==========================================================================
   报价单引擎 · 明细 / 优惠 / 税额 / 大写 / CSV
   - 全部整数分；行小计先四舍五入，合计为各行小计之和（保证守恒）
   - 优惠后金额先扣减再计税；优惠超过合计时按合计封顶并标记
   - 只生成报价单，不是税务发票，不生成发票号码
   ========================================================================== */
import { buildCsv } from '../../../core/toolbox/engines/csv'
import { roundHalfUp } from '../../../core/toolbox/engines/money'
import { centsToChinese } from '../../../core/toolbox/engines/rmb'

export interface QuoteRowInput {
  name: string
  /** 数量，最多两位小数 */
  quantity: number
  /** 单价，分 */
  unitPriceCents: number
}

export interface QuoteRowResult extends QuoteRowInput {
  subtotalCents: number
}

export interface QuoteTotals {
  rows: QuoteRowResult[]
  totalCents: number
  discountCents: number
  discountClamped: boolean
  afterDiscountCents: number
  taxCents: number | null
  payableCents: number
  chinese: string
}

export const QUOTE_MAX_ROWS = 50
export const QUOTE_TAX_MAX = 100

/** 行小计 = round(数量 × 单价)；数量按百分之一精度处理 */
export function quoteRowSubtotal(quantity: number, unitPriceCents: number): number | null {
  const qty = Number(quantity)
  const price = Number(unitPriceCents)
  if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price < 0) {
    return null
  }
  const qtyHundredths = Math.round(qty * 100)
  if (qtyHundredths <= 0) {
    return null
  }
  return roundHalfUp((qtyHundredths * price) / 100)
}

export function quoteTotals(
  rows: readonly QuoteRowInput[],
  taxPercent?: number | null,
  discountCents = 0,
): QuoteTotals | null {
  if (!rows || rows.length === 0 || rows.length > QUOTE_MAX_ROWS) {
    return null
  }
  const resultRows: QuoteRowResult[] = []
  let totalCents = 0
  for (const row of rows) {
    const subtotal = quoteRowSubtotal(row.quantity, row.unitPriceCents)
    if (subtotal === null) {
      return null
    }
    totalCents += subtotal
    resultRows.push({
      name: row.name || '未命名',
      quantity: row.quantity,
      unitPriceCents: row.unitPriceCents,
      subtotalCents: subtotal,
    })
  }

  const rawDiscount = Number(discountCents)
  if (!Number.isFinite(rawDiscount) || rawDiscount < 0) {
    return null
  }
  const normalizedDiscount = roundHalfUp(rawDiscount)
  const discountClamped = normalizedDiscount > totalCents
  const effectiveDiscount = Math.min(normalizedDiscount, totalCents)
  const afterDiscountCents = Math.max(0, totalCents - effectiveDiscount)

  let taxCents: number | null = null
  if (taxPercent !== undefined && taxPercent !== null) {
    const percent = Number(taxPercent)
    if (!Number.isFinite(percent) || percent < 0 || percent > QUOTE_TAX_MAX) {
      return null
    }
    taxCents = roundHalfUp((afterDiscountCents * percent) / 100)
  }
  const payableCents = afterDiscountCents + (taxCents ?? 0)

  return {
    rows: resultRows,
    totalCents,
    discountCents: effectiveDiscount,
    discountClamped,
    afterDiscountCents,
    taxCents,
    payableCents,
    chinese: centsToChinese(payableCents),
  }
}

/** 报价单 CSV：明细 + 合计 / 优惠 / 税额 / 应付；不含发票号码 */
export function quoteCsv(totals: QuoteTotals): string {
  const yuan = (cents: number): string => (cents / 100).toFixed(2)
  const rows: Array<Array<string | number>> = [
    ['名称', '数量', '单价', '小计'],
    ...totals.rows.map((row) => [row.name, row.quantity, yuan(row.unitPriceCents), yuan(row.subtotalCents)]),
    [],
    ['合计', '', '', yuan(totals.totalCents)],
    ['优惠', '', '', yuan(totals.discountCents)],
  ]
  if (totals.taxCents !== null) {
    rows.push(['税额', '', '', yuan(totals.taxCents)])
  }
  rows.push(['应付', '', '', yuan(totals.payableCents)])
  rows.push(['大写', totals.chinese])
  rows.push(['说明', '报价单，非发票'])
  return buildCsv(rows)
}
