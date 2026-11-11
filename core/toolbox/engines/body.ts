/* ==========================================================================
   身体指标引擎 · BMI 共享实现
   - BMI = 体重 / 身高²；区间沿用中国成人参考标准
   - 只做数值与文案映射，不构成医疗建议
   - bmi 页与 bodyfat 页共用，避免两套区间口径
   ========================================================================== */
import { clamp } from './money'

export type BmiCategoryKey = 'under' | 'normal' | 'over' | 'obese'

export interface BmiCategory {
  key: BmiCategoryKey
  label: string
  hint: string
  /** 区间文案，用于结果行 */
  rangeText: string
}

/** BMI 数值；身高 / 体重非法返回 null */
export function bmiOf(heightCm: number, weightKg: number): number | null {
  if (!Number.isFinite(heightCm) || !Number.isFinite(weightKg)) {
    return null
  }
  if (heightCm <= 0 || weightKg <= 0) {
    return null
  }
  const meters = heightCm / 100
  const bmi = weightKg / (meters * meters)
  return Number.isFinite(bmi) ? bmi : null
}

/** 中国成人 BMI 区间：<18.5 偏瘦 / 18.5–23.9 正常 / 24–27.9 超重 / ≥28 肥胖 */
export function bmiCategory(bmi: number): BmiCategory {
  if (bmi < 18.5) {
    return {
      key: 'under',
      label: '偏瘦',
      hint: '低于 18.5，建议关注营养摄入与作息。',
      rangeText: '< 18.5',
    }
  }
  if (bmi < 24) {
    return {
      key: 'normal',
      label: '正常',
      hint: '18.5–23.9，保持规律作息与适量运动。',
      rangeText: '18.5 – 23.9',
    }
  }
  if (bmi < 28) {
    return {
      key: 'over',
      label: '超重',
      hint: '24–27.9，建议控制热量并增加运动。',
      rangeText: '24 – 27.9',
    }
  }
  return {
    key: 'obese',
    label: '肥胖',
    hint: '≥ 28，建议咨询专业医生制定计划。',
    rangeText: '≥ 28',
  }
}

/** 参考体重区间：18.5–23.9 对应的公斤数 */
export function idealWeightRange(heightCm: number): { minKg: number; maxKg: number } | null {
  if (!Number.isFinite(heightCm) || heightCm <= 0) {
    return null
  }
  const meters = heightCm / 100
  return {
    minKg: 18.5 * meters * meters,
    maxKg: 23.9 * meters * meters,
  }
}

/** 秤标位置：14–36 映射到 2%–98%，避免贴边 */
export function bmiMarkerPercent(bmi: number): number {
  if (!Number.isFinite(bmi)) {
    return 2
  }
  return clamp(((bmi - 14) / 22) * 100, 2, 98)
}
