/* ==========================================================================
   体脂率引擎 · 美国海军围度公式（cm）
   - 男：495 / (1.0324 − 0.19077·log10(腰−颈) + 0.15456·log10(身高)) − 450
   - 女：495 / (1.29579 − 0.35004·log10(腰+臀−颈) + 0.22100·log10(身高)) − 450
   - 结果夹在 0–100；<3% 或 >60% 标记复核，仅作参考，不构成医疗建议
   ========================================================================== */

export type BodyFatGender = 'male' | 'female'

export interface BodyFatInput {
  gender: BodyFatGender
  heightCm: number
  weightKg: number
  neckCm: number
  waistCm: number
  /** 女性必填 */
  hipCm?: number
}

export type BodyFatCategoryKey = 'low' | 'athletic' | 'fitness' | 'average' | 'high'

export interface BodyFatCategory {
  key: BodyFatCategoryKey
  label: string
  hint: string
}

export interface BodyFatResult {
  /** 体脂率百分比，已夹在 0–100 */
  percent: number
  category: BodyFatCategory
  /** 脂肪重量（公斤） */
  fatMassKg: number
  /** 去脂体重（公斤） */
  leanMassKg: number
  /** <3% 或 >60%：提示复核围度 */
  needsReview: boolean
}

const clampPercent = (value: number): number => Math.min(100, Math.max(0, value))

/** 美国海军公式；围度非法或公式定义域外返回 null */
export function navyBodyFat(input: BodyFatInput): BodyFatResult | null {
  if (!input || (input.gender !== 'male' && input.gender !== 'female')) {
    return null
  }
  const { heightCm, weightKg, neckCm, waistCm, hipCm } = input
  const parts = [heightCm, weightKg, neckCm, waistCm]
  if (input.gender === 'female') {
    parts.push(Number(hipCm))
  }
  if (parts.some((value) => !Number.isFinite(value) || value <= 0)) {
    return null
  }

  let denominator: number
  if (input.gender === 'male') {
    const abdomen = waistCm - neckCm
    if (abdomen <= 0) {
      return null
    }
    denominator =
      1.0324 -
      0.19077 * Math.log10(abdomen) +
      0.15456 * Math.log10(heightCm)
  } else {
    const abdomen = waistCm + Number(hipCm) - neckCm
    if (abdomen <= 0) {
      return null
    }
    denominator =
      1.29579 -
      0.35004 * Math.log10(abdomen) +
      0.221 * Math.log10(heightCm)
  }
  if (!Number.isFinite(denominator) || denominator === 0) {
    return null
  }

  const raw = 495 / denominator - 450
  if (!Number.isFinite(raw)) {
    return null
  }
  const percent = clampPercent(raw)
  const fatMassKg = (weightKg * percent) / 100
  return {
    percent,
    category: bodyFatCategory(input.gender, percent),
    fatMassKg,
    leanMassKg: Math.max(0, weightKg - fatMassKg),
    needsReview: raw < 3 || raw > 60,
  }
}

/** 区间左闭右开；标签仅参考，不构成医疗建议 */
export function bodyFatCategory(gender: BodyFatGender, percent: number): BodyFatCategory {
  if (gender === 'female') {
    if (percent < 14) {
      return { key: 'low', label: '偏低', hint: '低于常见参考区间，建议复核围度或咨询专业人士。' }
    }
    if (percent < 21) {
      return { key: 'athletic', label: '运动', hint: '常见于规律训练人群。' }
    }
    if (percent < 25) {
      return { key: 'fitness', label: '健身', hint: '处于较理想的健身区间。' }
    }
    if (percent < 32) {
      return { key: 'average', label: '平均', hint: '处于常见成人区间。' }
    }
    return { key: 'high', label: '偏高', hint: '高于常见参考区间，建议关注饮食与运动。' }
  }
  if (percent < 6) {
    return { key: 'low', label: '偏低', hint: '低于常见参考区间，建议复核围度或咨询专业人士。' }
  }
  if (percent < 14) {
    return { key: 'athletic', label: '运动', hint: '常见于规律训练人群。' }
  }
  if (percent < 18) {
    return { key: 'fitness', label: '健身', hint: '处于较理想的健身区间。' }
  }
  if (percent < 25) {
    return { key: 'average', label: '平均', hint: '处于常见成人区间。' }
  }
  return { key: 'high', label: '偏高', hint: '高于常见参考区间，建议关注饮食与运动。' }
}
