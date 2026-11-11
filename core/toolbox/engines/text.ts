/* ==========================================================================
   文本转换引擎 · 大小写 / 命名 / HTML 实体 / Unicode 转义 / 清洗
   - core 唯一实现：页面与 silent 执行器共用，禁止分包内再写一份
   - 纯函数、无 wx 依赖；CJK 按字母保留，不参与 ASCII 大小写语义
   ========================================================================== */

export type CaseMode = 'upper' | 'lower'
export type NamingMode = 'camel' | 'snake' | 'kebab'
export type ConvertMode =
  | CaseMode
  | NamingMode
  | 'html-encode'
  | 'html-decode'
  | 'unicode-escape'
  | 'clean'

/** 与 LIMITS.TEXT_INPUT 保持一致；引擎侧再兜底一次，防外部注入超长 */
export const TEXT_CONVERT_LIMIT = 20000

export const CONVERT_MODES: ConvertMode[] = [
  'snake',
  'camel',
  'kebab',
  'upper',
  'lower',
  'html-encode',
  'html-decode',
  'unicode-escape',
  'clean',
]

export interface ConvertResult {
  text: string
  /** 变更字符数：公共前后缀之外的最大码点数，仅作展示 */
  changed: number
  truncated: boolean
}

export function isConvertMode(value: unknown): value is ConvertMode {
  return typeof value === 'string' && (CONVERT_MODES as string[]).includes(value)
}

export function toCase(input: string, mode: CaseMode): string {
  return mode === 'upper' ? input.toUpperCase() : input.toLowerCase()
}

/** 按非字母数字边界切词，并拆开 camel / 连续大写缩写边界 */
function splitWords(input: string): string[] {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0)
}

export function toNaming(input: string, mode: NamingMode): string {
  const words = splitWords(input)
  if (words.length === 0) {
    return ''
  }
  if (mode === 'snake') {
    return words.map((word) => word.toLowerCase()).join('_')
  }
  if (mode === 'kebab') {
    return words.map((word) => word.toLowerCase()).join('-')
  }
  return words
    .map((word, index) => {
      const lower = word.toLowerCase()
      if (index === 0) {
        return lower
      }
      return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`
    })
    .join('')
}

const HTML_ENCODE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** 公开 HTML5 实体子集：覆盖常见排版 / 货币 / 箭头符号，未知实体原样保留 */
const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00A0',
  copy: '\u00A9',
  reg: '\u00AE',
  trade: '\u2122',
  hellip: '\u2026',
  mdash: '\u2014',
  ndash: '\u2013',
  laquo: '\u00AB',
  raquo: '\u00BB',
  times: '\u00D7',
  divide: '\u00F7',
  plusmn: '\u00B1',
  deg: '\u00B0',
  euro: '\u20AC',
  pound: '\u00A3',
  yen: '\u00A5',
  cent: '\u00A2',
  sect: '\u00A7',
  para: '\u00B6',
  middot: '\u00B7',
  bull: '\u2022',
  larr: '\u2190',
  rarr: '\u2192',
  uarr: '\u2191',
  darr: '\u2193',
  hearts: '\u2665',
  spades: '\u2660',
  clubs: '\u2663',
  diams: '\u2666',
}

export function encodeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (char) => HTML_ENCODE[char])
}

export function decodeHtml(input: string): string {
  return input.replace(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]+);/g,
    (match, body: string) => {
      if (body.charAt(0) === '#') {
        const isHex = body.charAt(1) === 'x' || body.charAt(1) === 'X'
        const code = Number.parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10)
        if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) {
          return match
        }
        /* 孤立代理项无法构成合法字符，保持原样 */
        if (code >= 0xd800 && code <= 0xdfff) {
          return match
        }
        return String.fromCodePoint(code)
      }
      return HTML_ENTITIES[body] ?? HTML_ENTITIES[body.toLowerCase()] ?? match
    },
  )
}

/** 非 ASCII 转 \uXXXX；BMP 外转代理对；换行与制表符保留可读性 */
export function escapeUnicode(input: string): string {
  let output = ''
  for (const char of input) {
    const code = char.codePointAt(0) ?? 0
    if (code >= 0x20 && code <= 0x7e) {
      output += char
    } else if (char === '\n' || char === '\r' || char === '\t') {
      output += char
    } else if (code <= 0xffff) {
      output += `\\u${code.toString(16).padStart(4, '0')}`
    } else {
      const value = code - 0x10000
      const high = 0xd800 + (value >> 10)
      const low = 0xdc00 + (value & 0x3ff)
      output += `\\u${high.toString(16).padStart(4, '0')}\\u${low
        .toString(16)
        .padStart(4, '0')}`
    }
  }
  return output
}

export interface CleanOptions {
  /** 全角 ASCII（！–～）、全角空格与全角货币符号转半角；默认开启 */
  toHalfWidth?: boolean
  /** 中文标点（。、，【】《》「」等）转英文标点；默认关闭 */
  cjkPunctuation?: boolean
  /** 合并连续空格 / 制表符并去除每行首尾空白；默认开启 */
  trimSpaces?: boolean
  /** 删除所有半角空格、制表符、不换行空格与全角空格；默认关闭 */
  removeSpaces?: boolean
  /** 删除空行；默认开启 */
  removeBlankLines?: boolean
  /** 把 CRLF / CR / LF 统一替换为空格并合并为一行；默认关闭 */
  removeLineBreaks?: boolean
  /** 删除零宽字符、BOM、软连字符与不可见控制字符；默认开启 */
  removeInvisible?: boolean
}

export interface ConvertOptions {
  clean?: CleanOptions
}

/** 横向空白：除换行外的全部 Unicode 空白（含全角空格、窄空格、不换行空格） */
const HORIZONTAL_SPACE_PATTERN = /[^\S\n\r\u2028\u2029]+/g

/** 零宽 / BOM / 软连字符 / 不可见控制字符；保留 \t \n \r 与 emoji ZWJ / ZWNJ */
const INVISIBLE_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u00AD\u200B\u200E\u200F\u202A-\u202E\u2060\uFEFF]/g

const HALF_WIDTH_EXTRA: Record<string, string> = {
  '￥': '¥',
  '￡': '£',
  '￠': '¢',
  '￢': '¬',
}

const CJK_PUNCTUATION: Record<string, string> = {
  '。': '.',
  '、': ',',
  '，': ',',
  '；': ';',
  '：': ':',
  '！': '!',
  '？': '?',
  '（': '(',
  '）': ')',
  '【': '[',
  '】': ']',
  '《': '<',
  '》': '>',
  '〈': '<',
  '〉': '>',
  '「': '"',
  '」': '"',
  '『': "'",
  '』': "'",
  '“': '"',
  '”': '"',
  '‘': "'",
  '’': "'",
  '—': '--',
  '–': '-',
  '…': '...',
}

/** 全角区里属于中文标点的字符：未开启中文标点转换时必须原样保留 */
const CJK_IN_FULL_WIDTH = new Set([
  '\uFF01',
  '\uFF08',
  '\uFF09',
  '\uFF0C',
  '\uFF1A',
  '\uFF1B',
  '\uFF1F',
])

const CJK_PUNCTUATION_PATTERN = new RegExp(
  `[${Object.keys(CJK_PUNCTUATION).join('')}]`,
  'g',
)

function toHalfWidthText(input: string, cjkPunctuation: boolean): string {
  return input
    .replace(/[\uFF01-\uFF5E]/g, (char) => {
      if (!cjkPunctuation && CJK_IN_FULL_WIDTH.has(char)) {
        return char
      }
      return String.fromCharCode(char.charCodeAt(0) - 0xfee0)
    })
    .replace(/\u3000/g, ' ')
    .replace(/[￥￡￠￢]/g, (char) => HALF_WIDTH_EXTRA[char] ?? char)
}

/** 合并多行：仅当两侧都是 ASCII 字母 / 数字时补一个空格，中文之间直接相连 */
function mergeLines(text: string): string {
  const lines = text.split('\n')
  let output = lines[0] ?? ''
  for (let index = 1; index < lines.length; index += 1) {
    const next = lines[index]
    if (!next) {
      continue
    }
    const prevChar = output.slice(-1)
    const nextChar = next.charAt(0)
    const needSpace =
      /[A-Za-z0-9]$/.test(prevChar) && /[A-Za-z0-9]/.test(nextChar)
    output += needSpace ? ` ${next}` : next
  }
  return output
}

/**
 * 文本清洗（高级）
 * 1. 删除零宽 / BOM / 软连字符等不可见字符
 * 2. CRLF / CR 统一为 LF
 * 3. 全角字母 / 数字 / 符号与全角空格转半角；中文标点默认保留
 * 4. 可选：中文标点（，。！？【】《》等）转英文标点
 * 5. 可选：合并为一行（默认保留段落；中英文边界智能补空格）
 * 6. 可选：删除所有半角 / 全角空格与制表符（中英文均生效）
 * 7. 合并连续空白、逐行去首尾空白、删除空行
 * - 默认保留段落结构；只有显式开启 removeLineBreaks 才合并为一行
 */
export function cleanText(input: string, options: CleanOptions = {}): string {
  let text = input
  if (options.removeInvisible !== false) {
    text = text.replace(INVISIBLE_PATTERN, '')
  }
  text = text.replace(/\r\n?/g, '\n')
  if (options.toHalfWidth !== false) {
    text = toHalfWidthText(text, options.cjkPunctuation === true)
  }
  if (options.cjkPunctuation === true) {
    text = text
      .replace(/——/g, '--')
      .replace(/……/g, '...')
      .replace(
        CJK_PUNCTUATION_PATTERN,
        (char) => CJK_PUNCTUATION[char] ?? char,
      )
  }
  if (options.trimSpaces !== false) {
    text = text
      .split('\n')
      .map((line) => line.replace(HORIZONTAL_SPACE_PATTERN, ' ').trim())
      .join('\n')
  }
  if (options.removeLineBreaks === true) {
    text = mergeLines(text)
  }
  if (options.removeSpaces === true) {
    text = text.replace(HORIZONTAL_SPACE_PATTERN, '')
  }
  if (options.removeBlankLines !== false && options.removeLineBreaks !== true) {
    text = text
      .split('\n')
      .filter((line) => line.trim() !== '')
      .join('\n')
  }
  return options.trimSpaces !== false ? text.trim() : text
}

/** 公共前后缀之外的码点数取最大值，作为“变更字符数” */
export function changedCharCount(input: string, output: string): number {
  const left = Array.from(input)
  const right = Array.from(output)
  let prefix = 0
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) {
    prefix += 1
  }
  let suffix = 0
  while (
    suffix < left.length - prefix &&
    suffix < right.length - prefix &&
    left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
  ) {
    suffix += 1
  }
  return Math.max(left.length - prefix - suffix, right.length - prefix - suffix)
}

export function convertText(
  mode: ConvertMode,
  input: string,
  options: ConvertOptions = {},
): ConvertResult {
  const chars = Array.from(input)
  const truncated = chars.length > TEXT_CONVERT_LIMIT
  const source = truncated ? chars.slice(0, TEXT_CONVERT_LIMIT).join('') : input
  let text = ''
  if (mode === 'upper' || mode === 'lower') {
    text = toCase(source, mode)
  } else if (mode === 'camel' || mode === 'snake' || mode === 'kebab') {
    text = toNaming(source, mode)
  } else if (mode === 'html-encode') {
    text = encodeHtml(source)
  } else if (mode === 'html-decode') {
    text = decodeHtml(source)
  } else if (mode === 'clean') {
    text = cleanText(source, options.clean)
  } else {
    text = escapeUnicode(source)
  }
  return { text, changed: changedCharCount(source, text), truncated }
}
