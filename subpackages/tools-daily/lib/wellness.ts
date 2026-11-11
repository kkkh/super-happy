/* ==========================================================================
   每日健康引擎 · 饮水 / 热量 / 保质期
   - 饮水：体重 × 30ml + 活动增量，毫升取整到 10，杯数 0.5 步进
   - 热量：1 kcal = 4.184 kJ
   - 保质期：天 / 月 / 年，按月复用共享 addMonths（月末钳制）
   ========================================================================== */
import {
  addDays,
  addMonths,
  dayDiff,
  parseISODate,
  todayISO,
} from '../../../core/toolbox/engines/date'

export type ActivityLevel = 'sedentary' | 'medium' | 'high'
export type ShelfUnit = 'day' | 'month' | 'year'

export type WaterTarget =
  | { ok: true; ml: number; cups: number }
  | { ok: false; code: 'weight' | 'activity' }

export type ShelfLife =
  | { ok: true; expiryISO: string; remainingDays: number }
  | { ok: false; code: 'date' | 'amount' | 'unit' }

const ACTIVITY_EXTRA: Record<ActivityLevel, number> = {
  sedentary: 0,
  medium: 300,
  high: 600,
}

/** 建议饮水量与 200ml 杯数 */
export function waterTarget(weightKg: number, activity: ActivityLevel): WaterTarget {
  if (!Number.isFinite(weightKg) || weightKg <= 0 || weightKg > 300) {
    return { ok: false, code: 'weight' }
  }
  const extra = ACTIVITY_EXTRA[activity]
  if (extra === undefined) {
    return { ok: false, code: 'activity' }
  }
  const ml = Math.round((weightKg * 30 + extra) / 10) * 10
  return { ok: true, ml, cups: Math.round((ml / 200) * 2) / 2 }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

export function kcalToKj(kcal: number): number | null {
  if (!Number.isFinite(kcal) || kcal < 0) {
    return null
  }
  return round2(kcal * 4.184)
}

export function kjToKcal(kj: number): number | null {
  if (!Number.isFinite(kj) || kj < 0) {
    return null
  }
  return round2(kj / 4.184)
}

/** 生产日期 + 天/月/年 → 到期日与剩余天数（到期日 − 参考日） */
export function addShelfLife(
  productionISO: string,
  amount: number,
  unit: ShelfUnit,
  refISO: string = todayISO(),
): ShelfLife {
  if (!parseISODate(productionISO) || !parseISODate(refISO)) {
    return { ok: false, code: 'date' }
  }
  if (!Number.isInteger(amount) || amount <= 0 || amount > 36500) {
    return { ok: false, code: 'amount' }
  }
  if (unit !== 'day' && unit !== 'month' && unit !== 'year') {
    return { ok: false, code: 'unit' }
  }
  const expiryISO =
    unit === 'day'
      ? addDays(productionISO, amount)
      : addMonths(productionISO, unit === 'year' ? amount * 12 : amount)
  if (!expiryISO) {
    return { ok: false, code: 'date' }
  }
  const remainingDays = dayDiff(refISO, expiryISO)
  if (remainingDays === null) {
    return { ok: false, code: 'date' }
  }
  return { ok: true, expiryISO, remainingDays }
}
