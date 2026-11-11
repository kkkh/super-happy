/* ==========================================================================
   证件号校验 · 18 位身份证 / 12–19 位银行卡
   - 身份证：GB 11643 加权校验 + 证内出生日期 + 性别位
   - 银行卡：Luhn 校验；12–19 位数字，允许空格 / 连字符
   - 15 位旧证在自动识别下明确提示仅支持 18 位
   - 纯本机校验，不联网、不保存、不上传
   ========================================================================== */
import { parseISODate, todayISO } from '../../../core/toolbox/engines/date'

export type IdType = 'id-card' | 'bank-card'
export type IdInputMode = 'auto' | IdType

export interface IdValidationSuccess {
  ok: true
  type: IdType
  normalized: string
  birthDate: string
  gender: string
  regionCode: string
  algorithm: 'id-card' | 'luhn'
}

export interface IdValidationFailure {
  ok: false
  type: IdType | 'unknown'
  normalized: string
  reason: string
}

export type IdValidationResult = IdValidationSuccess | IdValidationFailure

const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2] as const
const ID_CHECK_CODES = '10X98765432'

export function normalizeId(raw: string): string {
  if (typeof raw !== 'string') {
    return ''
  }
  return raw.replace(/[\s-]/g, '').toUpperCase()
}

function failure(type: IdType | 'unknown', normalized: string, reason: string): IdValidationFailure {
  return { ok: false, type, normalized, reason }
}

/** Luhn 校验：仅接受 12–19 位纯数字 */
export function validateLuhn(raw: string): boolean {
  const normalized = normalizeId(raw)
  if (!/^\d{12,19}$/.test(normalized)) {
    return false
  }
  let sum = 0
  let double = false
  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    let digit = Number(normalized.charAt(index))
    if (double) {
      digit *= 2
      if (digit > 9) {
        digit -= 9
      }
    }
    sum += digit
    double = !double
  }
  return sum % 10 === 0
}

/** 18 位身份证：格式 + 出生日期 + 校验位 */
export function validateIdCard(raw: string): IdValidationResult {
  const normalized = normalizeId(raw)
  if (normalized.length !== 18) {
    return failure('id-card', normalized, '身份证需为 18 位')
  }
  if (!/^\d{17}[\dX]$/.test(normalized)) {
    return failure('id-card', normalized, '身份证格式不正确，前 17 位需为数字，末位为数字或 X')
  }

  const birth = normalized.slice(6, 14)
  const birthISO = `${birth.slice(0, 4)}-${birth.slice(4, 6)}-${birth.slice(6, 8)}`
  if (!parseISODate(birthISO)) {
    return failure('id-card', normalized, '证号内出生日期不合法')
  }
  if (birthISO > todayISO()) {
    return failure('id-card', normalized, '证号内出生日期晚于今天')
  }

  let sum = 0
  for (let index = 0; index < 17; index += 1) {
    sum += Number(normalized.charAt(index)) * ID_WEIGHTS[index]
  }
  const expected = ID_CHECK_CODES.charAt(sum % 11)
  if (normalized.charAt(17) !== expected) {
    return failure('id-card', normalized, '身份证校验位不匹配')
  }

  const genderDigit = Number(normalized.charAt(16))
  return {
    ok: true,
    type: 'id-card',
    normalized,
    birthDate: birthISO,
    gender: genderDigit % 2 === 1 ? '男' : '女',
    regionCode: normalized.slice(0, 6),
    algorithm: 'id-card',
  }
}

function validateBankCard(raw: string): IdValidationResult {
  const normalized = normalizeId(raw)
  if (!/^\d{12,19}$/.test(normalized)) {
    return failure('bank-card', normalized, '银行卡号需为 12–19 位数字')
  }
  if (!validateLuhn(normalized)) {
    return failure('bank-card', normalized, '银行卡校验位不匹配')
  }
  return {
    ok: true,
    type: 'bank-card',
    normalized,
    birthDate: '',
    gender: '',
    regionCode: '',
    algorithm: 'luhn',
  }
}

/**
 * 统一入口：
 * - auto：15 位纯数字提示旧证；18 位先按身份证、失败再按 Luhn；其余 12–19 位按银行卡
 * - 指定类型时只按该类型校验
 */
export function validateIdentifier(
  raw: string,
  mode: IdInputMode = 'auto',
): IdValidationResult {
  const normalized = normalizeId(raw)
  if (!normalized) {
    return failure('unknown', '', '请输入身份证号或银行卡号')
  }
  if (mode === 'id-card') {
    return validateIdCard(normalized)
  }
  if (mode === 'bank-card') {
    return validateBankCard(normalized)
  }
  if (/^\d{15}$/.test(normalized)) {
    return failure('id-card', normalized, '仅支持 18 位身份证，15 位旧证请先升级')
  }
  if (/^\d{17}[\dX]$/.test(normalized)) {
    const idResult = validateIdCard(normalized)
    if (idResult.ok) {
      return idResult
    }
    if (/^\d{18}$/.test(normalized) && validateLuhn(normalized)) {
      return validateBankCard(normalized)
    }
    return idResult
  }
  if (/^\d{12,19}$/.test(normalized)) {
    return validateBankCard(normalized)
  }
  return failure('unknown', normalized, '仅支持 18 位身份证或 12–19 位银行卡号')
}

/** 展示与流转统一脱敏，禁止把完整号码写入摘要 */
export function maskIdentifier(value: string, type: IdType | 'unknown'): string {
  const normalized = normalizeId(value)
  if (type === 'id-card' && normalized.length === 18) {
    return `${normalized.slice(0, 6)}********${normalized.slice(-4)}`
  }
  if (type === 'bank-card' && normalized.length >= 8) {
    return `${normalized.slice(0, 4)} **** ${normalized.slice(-4)}`
  }
  if (normalized.length <= 4) {
    return '****'
  }
  return `${normalized.slice(0, 2)}****${normalized.slice(-2)}`
}

function typeLabel(type: IdType | 'unknown'): string {
  if (type === 'id-card') {
    return '身份证'
  }
  return type === 'bank-card' ? '银行卡' : '未识别'
}

/** 摘要与 silent / 页面同源；号码始终脱敏 */
export function idSummary(result: IdValidationResult): string {
  const masked = maskIdentifier(result.normalized, result.type)
  const head = `${typeLabel(result.type)} ${masked}`
  if (!result.ok) {
    return `${head} · 校验未通过：${result.reason}`
  }
  if (result.type === 'id-card') {
    return `${head} · 校验通过 · ${result.birthDate} · ${result.gender}`
  }
  return `${head} · Luhn 校验通过 · ${result.normalized.length} 位`
}
