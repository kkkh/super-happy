/* ==========================================================================
   电费估算引擎 · 纯本地
   - 总电量 = 功率 ÷ 1000 × 每日时长 × 天数
   - 支持平价电价与最多 3 档阶梯；阶梯按累计度数分段
   - 超出最高档时按末档单价计费并标记，绝不静默吞掉
   ========================================================================== */

export interface PowerTier {
  /** 该档累计上限（度）；null 表示无上限，只能出现在最后一档 */
  limitKwh: number | null
  /** 元 / 度 */
  pricePerKwh: number
}

export interface PowerInput {
  powerW: number
  hoursPerDay: number
  days: number
  /** 平价电价；使用阶梯时忽略 */
  pricePerKwh?: number | null
  /** 阶梯：1–3 档，上限严格递增 */
  tiers?: PowerTier[]
}

export interface PowerSlice {
  fromKwh: number
  toKwh: number
  kwh: number
  pricePerKwh: number
  cost: number
}

export interface PowerResult {
  mode: 'flat' | 'tier'
  totalKwh: number
  averageDailyKwh: number
  totalCost: number | null
  slices: PowerSlice[]
  aboveHighest: boolean
}

export const MAX_POWER_TIERS = 3

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function validPrice(value: number): boolean {
  return Number.isFinite(value) && value >= 0
}

/** 阶梯上限必须严格递增；只有最后一档允许无上限 */
function validTiers(tiers: PowerTier[]): boolean {
  if (tiers.length === 0 || tiers.length > MAX_POWER_TIERS) {
    return false
  }
  let last = 0
  for (let index = 0; index < tiers.length; index += 1) {
    const tier = tiers[index]
    if (!validPrice(tier.pricePerKwh)) {
      return false
    }
    if (tier.limitKwh === null) {
      return index === tiers.length - 1
    }
    if (!Number.isFinite(tier.limitKwh) || tier.limitKwh <= last) {
      return false
    }
    last = tier.limitKwh
  }
  return true
}

export function powerBill(input: PowerInput): PowerResult | null {
  const powerW = Number(input.powerW)
  const hoursPerDay = Number(input.hoursPerDay)
  const days = Number(input.days)
  if (
    !Number.isFinite(powerW) ||
    !Number.isFinite(hoursPerDay) ||
    !Number.isFinite(days) ||
    powerW <= 0 ||
    hoursPerDay <= 0 ||
    days <= 0
  ) {
    return null
  }

  const totalKwh = (powerW / 1000) * hoursPerDay * days
  if (!Number.isFinite(totalKwh) || totalKwh <= 0) {
    return null
  }
  const averageDailyKwh = totalKwh / days
  const tiers = input.tiers?.filter((tier) => tier !== undefined) ?? []

  if (tiers.length > 0) {
    if (!validTiers(tiers)) {
      return null
    }
    const slices: PowerSlice[] = []
    let from = 0
    let cost = 0
    let aboveHighest = false
    for (const tier of tiers) {
      if (from >= totalKwh) {
        break
      }
      const upper = tier.limitKwh === null ? totalKwh : tier.limitKwh
      const to = Math.min(totalKwh, upper)
      if (to > from) {
        const kwh = to - from
        const sliceCost = kwh * tier.pricePerKwh
        slices.push({
          fromKwh: round2(from),
          toKwh: round2(to),
          kwh: round2(kwh),
          pricePerKwh: tier.pricePerKwh,
          cost: round2(sliceCost),
        })
        cost += sliceCost
        from = to
      }
    }
    if (from < totalKwh) {
      aboveHighest = true
      const lastPrice = tiers[tiers.length - 1].pricePerKwh
      const kwh = totalKwh - from
      slices.push({
        fromKwh: round2(from),
        toKwh: round2(totalKwh),
        kwh: round2(kwh),
        pricePerKwh: lastPrice,
        cost: round2(kwh * lastPrice),
      })
      cost += kwh * lastPrice
    }
    return {
      mode: 'tier',
      totalKwh: round2(totalKwh),
      averageDailyKwh: round2(averageDailyKwh),
      totalCost: round2(cost),
      slices,
      aboveHighest,
    }
  }

  const price = input.pricePerKwh
  if (price === undefined || price === null) {
    return {
      mode: 'flat',
      totalKwh: round2(totalKwh),
      averageDailyKwh: round2(averageDailyKwh),
      totalCost: null,
      slices: [],
      aboveHighest: false,
    }
  }
  const flatPrice = Number(price)
  if (!validPrice(flatPrice)) {
    return null
  }
  return {
    mode: 'flat',
    totalKwh: round2(totalKwh),
    averageDailyKwh: round2(averageDailyKwh),
    totalCost: round2(totalKwh * flatPrice),
    slices: [],
    aboveHighest: false,
  }
}

export function powerSummaryText(result: PowerResult): string {
  const parts = [`总电量 ${result.totalKwh.toFixed(2)} 度`]
  if (result.totalCost === null) {
    parts.push('未填电价，未计算电费')
  } else {
    parts.push(`电费 ${result.totalCost.toFixed(2)} 元`)
    parts.push(result.mode === 'tier' ? '阶梯计价' : '平价计价')
  }
  parts.push(`日均 ${result.averageDailyKwh.toFixed(2)} 度`)
  if (result.aboveHighest) {
    parts.push('超出最高档，按末档单价计费')
  }
  return parts.join('；')
}

/* ---- 水费 / 燃气费：直接按用量与费率表计费 ---- */

export type UtilityKind = 'water' | 'gas'

export interface UtilityInput {
  kind: UtilityKind
  /** 用量：水为吨，燃气为立方米 */
  usage: number
  /** 平价单价；使用阶梯时忽略 */
  pricePerUnit?: number | null
  /** 阶梯：1–3 档，上限严格递增 */
  tiers?: PowerTier[]
  /** 固定基础费，默认 0 */
  baseFee?: number
}

export interface UtilitySlice {
  from: number
  to: number
  amount: number
  pricePerUnit: number
  cost: number
}

export interface UtilityResult {
  kind: UtilityKind
  mode: 'flat' | 'tier'
  usage: number
  totalCost: number | null
  baseFee: number
  totalWithFee: number | null
  slices: UtilitySlice[]
  aboveHighest: boolean
}

/** 水费 / 燃气费：用量 × 单价，或按阶梯费率表分段累进 */
export function utilityBill(input: UtilityInput): UtilityResult | null {
  if (input.kind !== 'water' && input.kind !== 'gas') {
    return null
  }
  const usage = Number(input.usage)
  const baseFee = input.baseFee === undefined ? 0 : Number(input.baseFee)
  if (!Number.isFinite(usage) || usage <= 0) {
    return null
  }
  if (!Number.isFinite(baseFee) || baseFee < 0) {
    return null
  }
  const tiers = input.tiers?.filter((tier) => tier !== undefined) ?? []

  if (tiers.length > 0) {
    if (!validTiers(tiers)) {
      return null
    }
    const slices: UtilitySlice[] = []
    let from = 0
    let cost = 0
    let aboveHighest = false
    for (const tier of tiers) {
      if (from >= usage) {
        break
      }
      const upper = tier.limitKwh === null ? usage : tier.limitKwh
      const to = Math.min(usage, upper)
      if (to > from) {
        const amount = to - from
        slices.push({
          from: round2(from),
          to: round2(to),
          amount: round2(amount),
          pricePerUnit: tier.pricePerKwh,
          cost: round2(amount * tier.pricePerKwh),
        })
        cost += amount * tier.pricePerKwh
        from = to
      }
    }
    if (from < usage) {
      aboveHighest = true
      const lastPrice = tiers[tiers.length - 1].pricePerKwh
      const amount = usage - from
      slices.push({
        from: round2(from),
        to: round2(usage),
        amount: round2(amount),
        pricePerUnit: lastPrice,
        cost: round2(amount * lastPrice),
      })
      cost += amount * lastPrice
    }
    return {
      kind: input.kind,
      mode: 'tier',
      usage: round2(usage),
      totalCost: round2(cost),
      baseFee: round2(baseFee),
      totalWithFee: round2(cost + baseFee),
      slices,
      aboveHighest,
    }
  }

  if (input.pricePerUnit === undefined || input.pricePerUnit === null) {
    return {
      kind: input.kind,
      mode: 'flat',
      usage: round2(usage),
      totalCost: null,
      baseFee: round2(baseFee),
      totalWithFee: null,
      slices: [],
      aboveHighest: false,
    }
  }
  const price = Number(input.pricePerUnit)
  if (!validPrice(price)) {
    return null
  }
  const cost = usage * price
  return {
    kind: input.kind,
    mode: 'flat',
    usage: round2(usage),
    totalCost: round2(cost),
    baseFee: round2(baseFee),
    totalWithFee: round2(cost + baseFee),
    slices: [],
    aboveHighest: false,
  }
}

export function utilitySummaryText(result: UtilityResult): string {
  const unit = result.kind === 'water' ? '吨' : 'm³'
  const name = result.kind === 'water' ? '水费' : '燃气费'
  const parts = [`${result.kind === 'water' ? '用水' : '用气'} ${result.usage.toFixed(2)} ${unit}`]
  if (result.totalCost === null) {
    parts.push('未填单价，未计算费用')
  } else {
    parts.push(`${name} ${result.totalCost.toFixed(2)} 元`)
    parts.push(result.mode === 'tier' ? '阶梯费率' : '平价费率')
  }
  if (result.baseFee > 0) {
    parts.push(`基础费 ${result.baseFee.toFixed(2)} 元`)
  }
  if (result.totalWithFee !== null) {
    parts.push(`合计 ${result.totalWithFee.toFixed(2)} 元`)
  }
  if (result.aboveHighest) {
    parts.push('超出最高档，按末档单价计费')
  }
  return parts.join('；')
}
