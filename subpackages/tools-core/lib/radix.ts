/* ==========================================================================
   进制引擎 · 纯字符串大数，不依赖 BigInt
   - 支持 2 / 8 / 10 / 16，负数、前后空格、下划线分隔、0x/0b/0o 前缀
   - 有效数字上限 128 位，超出明确报错，避免 O(n²) 拖死主线程
   ========================================================================== */

export type RadixBase = 2 | 8 | 10 | 16

export const RADIX_BASES: RadixBase[] = [2, 8, 10, 16]

export const RADIX_LABELS: Record<RadixBase, string> = {
  2: '二进制',
  8: '八进制',
  10: '十进制',
  16: '十六进制',
}

export const MAX_RADIX_DIGITS = 128

export type RadixFailReason = 'empty' | 'invalid-base' | 'invalid-char' | 'too-long'

export type RadixParseResult =
  | { ok: true; decimal: string; negative: boolean; digits: number }
  | { ok: false; reason: RadixFailReason; index?: number; char?: string }

const DIGITS: Record<RadixBase, string> = {
  2: '01',
  8: '01234567',
  10: '0123456789',
  16: '0123456789abcdefABCDEF',
}

/** 全角数字/字母转半角，去空格与下划线；附带回溯到原始字符的索引 */
interface NormalizedText {
  text: string
  /** 归一化后第 i 个字符在原始输入中的下标 */
  map: number[]
}

function normalize(raw: string): NormalizedText {
  let text = ''
  const map: number[] = []
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]
    const code = char.charCodeAt(0)
    if (code === 0x3000 || code === 32 || char === '_') {
      continue
    }
    text += code >= 0xff01 && code <= 0xff5e ? String.fromCharCode(code - 0xfee0) : char
    map.push(index)
  }
  return { text, map }
}

function isBase(value: number): value is RadixBase {
  return value === 2 || value === 8 || value === 10 || value === 16
}

/** 十进制字符串 × 小整数 + 小整数（用于逐位累加） */
function mulAdd(decimal: string, mul: number, add: number): string {
  let carry = add
  let out = ''
  for (let index = decimal.length - 1; index >= 0; index -= 1) {
    const value = Number(decimal[index]) * mul + carry
    out = String(value % 10) + out
    carry = Math.floor(value / 10)
  }
  while (carry > 0) {
    out = String(carry % 10) + out
    carry = Math.floor(carry / 10)
  }
  return out.replace(/^0+(?=\d)/, '')
}

/** 十进制字符串 ÷ 小整数（用于反复取余换基） */
function divMod(decimal: string, divisor: number): { quotient: string; remainder: number } {
  let remainder = 0
  let quotient = ''
  for (const char of decimal) {
    const current = remainder * 10 + Number(char)
    quotient += String(Math.floor(current / divisor))
    remainder = current % divisor
  }
  return { quotient: quotient.replace(/^0+(?=\d)/, ''), remainder }
}

/** 解析任意进制到十进制字符串 */
export function parseToDecimal(raw: string, base: number): RadixParseResult {
  if (!isBase(base)) {
    return { ok: false, reason: 'invalid-base' }
  }
  const normalized = normalize(raw)
  let text = normalized.text
  if (!text) {
    return { ok: false, reason: 'empty' }
  }

  /* cursor：从归一化串头部已消费的字符数，用于把错误位置映射回原始输入 */
  let cursor = 0
  let negative = false
  if (text[0] === '+' || text[0] === '-') {
    negative = text[0] === '-'
    cursor = 1
    text = text.slice(1)
  }
  if (!text) {
    return { ok: false, reason: 'empty' }
  }

  const prefix = text.slice(0, 2).toLowerCase()
  const expected: Record<string, RadixBase> = { '0x': 16, '0b': 2, '0o': 8 }
  /* 只有前缀与所选进制一致时才剥离；不一致按普通数字解析，由逐位校验定位错误 */
  if (expected[prefix] === base) {
    cursor += 2
    text = text.slice(2)
    if (!text) {
      return { ok: false, reason: 'empty' }
    }
  }

  const significant = text.replace(/^0+/, '')
  if (significant.length > MAX_RADIX_DIGITS) {
    return { ok: false, reason: 'too-long' }
  }

  const allowed = DIGITS[base]
  let decimal = '0'
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (allowed.indexOf(char) < 0) {
      return {
        ok: false,
        reason: 'invalid-char',
        index: normalized.map[cursor + index] ?? cursor + index,
        char,
      }
    }
    const digit = parseInt(char, 16)
    decimal = mulAdd(decimal, base, digit)
  }

  return { ok: true, decimal, negative, digits: significant.length }
}

/** 十进制字符串转目标进制；符号由调用方处理 */
export function decimalToBase(decimal: string, base: RadixBase): string {
  const normalized = decimal.replace(/^0+(?=\d)/, '')
  if (normalized === '0') {
    return '0'
  }
  let current = normalized
  let out = ''
  let guard = 0
  while (current !== '0' && guard < 512) {
    const step = divMod(current, base)
    out = step.remainder.toString(base).toUpperCase() + out
    current = step.quotient
    guard += 1
  }
  return out || '0'
}

export interface RadixConversion {
  base: RadixBase
  label: string
  value: string
}

/** 一次解析，输出四种进制；失败时返回错误 */
export type RadixResult =
  | { ok: true; negative: boolean; decimal: string; conversions: RadixConversion[] }
  | { ok: false; reason: RadixFailReason; index?: number; char?: string }

export function convertRadix(raw: string, base: number): RadixResult {
  const parsed = parseToDecimal(raw, base)
  if (!parsed.ok) {
    return parsed
  }
  const sign = parsed.negative && parsed.decimal !== '0' ? '-' : ''
  const conversions = RADIX_BASES.map((item) => ({
    base: item,
    label: RADIX_LABELS[item],
    value: `${sign}${decimalToBase(parsed.decimal, item)}`,
  }))
  return { ok: true, negative: parsed.negative, decimal: parsed.decimal, conversions }
}

/** 人类可读错误文案 */
export function radixErrorText(result: Extract<RadixResult, { ok: false }>, base: number): string {
  if (result.reason === 'empty') {
    return '请输入要转换的数值'
  }
  if (result.reason === 'invalid-base') {
    return '不支持的进制'
  }
  if (result.reason === 'too-long') {
    return `有效数字最多 ${MAX_RADIX_DIGITS} 位，请分段转换`
  }
  const index = (result.index ?? 0) + 1
  return `第 ${index} 位「${result.char ?? ''}」不是合法的 ${base} 进制数字`
}
