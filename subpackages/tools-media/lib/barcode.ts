/* ==========================================================================
   条形码 · CODE128B 编码与 1-bit PNG 渲染
   - 纯函数，不依赖 wx / Canvas；开发者工具与真机表现一致
   - 仅支持 ASCII 32–126；自动计算校验位；左右各 10 模块静区
   - 图案表为公开标准（ISO/IEC 15417），索引 0–106，末项为终止符
   ========================================================================== */
import { repeatRowPngBase64 } from './png'

export const BARCODE_MAX_CHARS = 80
/** 兼顾扫码识别与手机展示的条宽档位（像素 / 模块） */
export const BARCODE_MODULE_WIDTHS = [2, 3, 4] as const
export type BarcodeModuleWidth = (typeof BARCODE_MODULE_WIDTHS)[number]
/** CODE128 强制静区：左右各 10 模块 */
export const BARCODE_QUIET_MODULES = 10
/** 条高 40 模块，上下各留 5 模块空白，总高 50 模块 */
export const BARCODE_BAR_MODULES = 40
export const BARCODE_HEIGHT_MODULES = 50

export type BarcodeError = 'empty' | 'non-ascii' | 'too-long'

export const BARCODE_ERROR_TEXT: Record<BarcodeError, string> = {
  empty: '请输入条码内容',
  'non-ascii': '仅支持数字、英文字母与英文标点，中文与 Emoji 无法编码',
  'too-long': `最多 ${BARCODE_MAX_CHARS} 字符，请精简后再试`,
}

export interface BarcodeEncoded {
  ok: true
  /** 去除首尾空白后的原文 */
  text: string
  /** 起始符 + 数据符 + 校验符；不含终止符 */
  codes: number[]
  checksum: number
  /** 含左右静区的模块序列，true = 黑条 */
  modules: boolean[]
  moduleCount: number
  charCount: number
}

export interface BarcodeInvalid {
  ok: false
  error: BarcodeError
}

export type BarcodeResult = BarcodeEncoded | BarcodeInvalid

export interface BarcodeImage {
  base64: string
  width: number
  height: number
  moduleWidth: BarcodeModuleWidth
}

/** 索引即 CODE128 码值；数字为条 / 空交替的模块宽度 */
const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312',
  '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112',
  '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412',
  '211214', '211232', '2331112',
]

const START_B = 104
const STOP = 106

/** 把图案宽度串追加为模块序列：偶数位是条，奇数位是空 */
function appendPattern(target: boolean[], pattern: string): void {
  for (let index = 0; index < pattern.length; index += 1) {
    const width = pattern.charCodeAt(index) - 48
    const bar = index % 2 === 0
    for (let count = 0; count < width; count += 1) {
      target.push(bar)
    }
  }
}

/**
 * CODE128B 编码
 * - 校验位 = (起始符 + Σ 数据符 × 位序) mod 103
 * - 结果含左右静区，页面可直接按条宽渲染
 */
export function encodeCode128B(input: string): BarcodeResult {
  const text = typeof input === 'string' ? input.trim() : ''
  if (!text) {
    return { ok: false, error: 'empty' }
  }
  const chars = Array.from(text)
  if (chars.length > BARCODE_MAX_CHARS) {
    return { ok: false, error: 'too-long' }
  }

  const values: number[] = []
  for (const char of chars) {
    const code = char.codePointAt(0) ?? 0
    if (code < 32 || code > 126) {
      return { ok: false, error: 'non-ascii' }
    }
    values.push(code - 32)
  }

  let sum = START_B
  values.forEach((value, index) => {
    sum += value * (index + 1)
  })
  const checksum = sum % 103
  const codes = [START_B, ...values, checksum]

  const modules: boolean[] = new Array(BARCODE_QUIET_MODULES).fill(false)
  appendPattern(modules, CODE128_PATTERNS[START_B])
  for (const value of values) {
    appendPattern(modules, CODE128_PATTERNS[value])
  }
  appendPattern(modules, CODE128_PATTERNS[checksum])
  appendPattern(modules, CODE128_PATTERNS[STOP])
  for (let count = 0; count < BARCODE_QUIET_MODULES; count += 1) {
    modules.push(false)
  }

  return {
    ok: true,
    text,
    codes,
    checksum,
    modules,
    moduleCount: modules.length,
    charCount: chars.length,
  }
}

function normalizeModuleWidth(value: number): BarcodeModuleWidth {
  return value === 4 ? 4 : value === 2 ? 2 : 3
}

/** 把含静区的模块序列渲染成黑条白底 1-bit PNG */
export function barcodePngBase64(
  encoded: BarcodeEncoded,
  moduleWidth = 3,
): BarcodeImage | null {
  if (!encoded || !encoded.ok || !encoded.modules.length) {
    return null
  }
  const width = normalizeModuleWidth(moduleWidth)
  const pixelWidth = encoded.modules.length * width
  const pixelHeight = BARCODE_HEIGHT_MODULES * width
  const rowBytes = Math.ceil(pixelWidth / 8)
  const row = new Uint8Array(rowBytes).fill(0xff)
  encoded.modules.forEach((bar, index) => {
    if (!bar) {
      return
    }
    const startX = index * width
    for (let x = startX; x < startX + width; x += 1) {
      row[x >> 3] &= ~(0x80 >> (x & 7))
    }
  })
  return {
    base64: repeatRowPngBase64(pixelWidth, pixelHeight, row),
    width: pixelWidth,
    height: pixelHeight,
    moduleWidth: width,
  }
}
