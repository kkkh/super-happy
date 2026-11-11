/* ==========================================================================
   密码强度评估 · 纯函数
   - 熵 = 长度 × log2(字符集大小)，单位 bit
   - <40 弱 / 40–79 中 / ≥80 强；空密码单独标记
   - 仅本机计算，不联网查泄漏
   ========================================================================== */

export const PASSWORD_WEAK_BITS = 40
export const PASSWORD_STRONG_BITS = 80

export type PasswordStrengthKey = 'empty' | 'weak' | 'medium' | 'strong'

export interface PasswordStrength {
  key: PasswordStrengthKey
  label: string
  /** 进度条百分比：0–100，按 80 bit 满分线性映射 */
  percent: number
  entropy: number
}

/** 信息熵：非法长度 / 字符集返回 0，避免 NaN 进入 UI */
export function passwordEntropy(length: number, charsetSize: number): number {
  if (
    !Number.isFinite(length) ||
    !Number.isFinite(charsetSize) ||
    length <= 0 ||
    charsetSize <= 1
  ) {
    return 0
  }
  const bits = Math.floor(length) * Math.log2(Math.floor(charsetSize))
  return Number.isFinite(bits) && bits > 0 ? bits : 0
}

/** 强度等级：空密码 → 弱 → 中 → 强 */
export function strengthLevel(entropy: number): PasswordStrength {
  const bits = Number.isFinite(entropy) && entropy > 0 ? entropy : 0
  if (bits <= 0) {
    return { key: 'empty', label: '空密码', percent: 0, entropy: 0 }
  }
  if (bits < PASSWORD_WEAK_BITS) {
    const percent = Math.max(
      1,
      Math.min(49, Math.round((bits / PASSWORD_WEAK_BITS) * 49)),
    )
    return { key: 'weak', label: '弱', percent, entropy: bits }
  }
  if (bits < PASSWORD_STRONG_BITS) {
    const percent = Math.round(
      50 + ((bits - PASSWORD_WEAK_BITS) / (PASSWORD_STRONG_BITS - PASSWORD_WEAK_BITS)) * 49,
    )
    return { key: 'medium', label: '中', percent, entropy: bits }
  }
  return { key: 'strong', label: '强', percent: 100, entropy: bits }
}
