/* ==========================================================================
   油耗计算引擎 · 纯本地
   - 百公里油耗 = 加油量 ÷ 里程 × 100
   - 油价可选：为空时只给油耗，不伪造费用
   - 里程超过 10,000 km 仍计算，但提示复核
   ========================================================================== */

export interface FuelInput {
  distanceKm: number
  liters: number
  /** 元 / L；留空表示不计算费用 */
  pricePerLiter?: number | null
}

export interface FuelResult {
  distanceKm: number
  liters: number
  pricePerLiter: number | null
  /** L / 100km */
  consumption: number
  /** 元 / km；油价为空时为 null */
  costPerKm: number | null
  /** 本次油费；油价为空时为 null */
  totalCost: number | null
  needsReview: boolean
}

/** 超过该里程只提示复核，不阻止计算 */
export const FUEL_REVIEW_DISTANCE = 10000

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function calcFuel(input: FuelInput): FuelResult | null {
  const distance = Number(input.distanceKm)
  const liters = Number(input.liters)
  if (!Number.isFinite(distance) || !Number.isFinite(liters)) {
    return null
  }
  if (distance <= 0 || liters <= 0) {
    return null
  }

  const rawPrice = input.pricePerLiter
  let price: number | null = null
  if (rawPrice !== undefined && rawPrice !== null && `${rawPrice}`.trim() !== '') {
    const parsed = Number(rawPrice)
    if (!Number.isFinite(parsed) || parsed < 0) {
      return null
    }
    price = parsed
  }

  const consumption = round2((liters / distance) * 100)
  const totalCost = price === null ? null : round2(liters * price)
  const costPerKm = price === null || totalCost === null ? null : round2(totalCost / distance)

  return {
    distanceKm: distance,
    liters,
    pricePerLiter: price,
    consumption,
    costPerKm,
    totalCost,
    needsReview: distance > FUEL_REVIEW_DISTANCE,
  }
}

export function fuelSummaryText(result: FuelResult): string {
  const parts = [`百公里油耗 ${result.consumption.toFixed(2)} L/100km`]
  if (result.costPerKm !== null && result.totalCost !== null) {
    parts.push(`${result.costPerKm.toFixed(2)} 元/km`)
    parts.push(`本次油费 ${result.totalCost.toFixed(2)} 元`)
  }
  if (result.needsReview) {
    parts.push(`里程超过 ${FUEL_REVIEW_DISTANCE.toLocaleString()} km，请复核`)
  }
  return parts.join('；')
}
