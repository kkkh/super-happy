/* ==========================================================================
   拼音标注引擎 · 本地纯函数
   - 常用字表 + 2–4 字多音词消歧；多音字取常用读音并在结果中计数
   - 非汉字原样保留；未收录汉字保留原字并标注
   - 超 2,000 字截断并提示；带声调 / 不带声调切换不丢输入
   ========================================================================== */
import { PINYIN_CHARS_RAW, PINYIN_PHRASES_RAW } from './pinyin-data'

export const PINYIN_MAX_CHARS = 2000
export const PINYIN_TONE_TABLE: Record<string, string> = {
  ā: 'a',
  á: 'a',
  ǎ: 'a',
  à: 'a',
  ē: 'e',
  é: 'e',
  ě: 'e',
  è: 'e',
  ī: 'i',
  í: 'i',
  ǐ: 'i',
  ì: 'i',
  ō: 'o',
  ó: 'o',
  ǒ: 'o',
  ò: 'o',
  ū: 'u',
  ú: 'u',
  ǔ: 'u',
  ù: 'u',
  ǖ: 'ü',
  ǘ: 'ü',
  ǚ: 'ü',
  ǜ: 'ü',
  ń: 'n',
  ň: 'n',
  ǹ: 'n',
  ḿ: 'm',
}

export interface PinyinOptions {
  /** true 保留声调；false 输出去声调拼音 */
  tone?: boolean
}

export interface PinyinCharInfo {
  char: string
  pinyin: string
  /** 汉字且命中词库 */
  covered: boolean
  /** 词库中该字存在多个读音 */
  polyphonic: boolean
}

export interface PinyinResult {
  output: string
  chars: PinyinCharInfo[]
  tone: boolean
  truncated: boolean
  inputChars: number
  /** 已标注的汉字数 */
  covered: number
  /** 未收录的汉字数 */
  uncovered: number
  /** 多音字出现次数（按常用读音输出） */
  polyphonic: number
  summary: string
}

const PUNCTUATION = /[\s，。、；：！？（）《》“”‘’·…—～,.;:!?()[\]{}"'\-]/

let charMap: Map<string, string> | null = null
let phraseMap: Map<string, string> | null = null

function parsePairs(raw: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const entry of raw.split('|')) {
    const index = entry.indexOf(' ')
    if (index <= 0) {
      continue
    }
    const key = entry.slice(0, index)
    const value = entry.slice(index + 1).trim()
    if (key && value) {
      map.set(key, value)
    }
  }
  return map
}

function getCharMap(): Map<string, string> {
  if (!charMap) {
    charMap = parsePairs(PINYIN_CHARS_RAW)
  }
  return charMap
}

function getPhraseMap(): Map<string, string> {
  if (!phraseMap) {
    phraseMap = parsePairs(PINYIN_PHRASES_RAW)
  }
  return phraseMap
}

export function isCjkChar(char: string): boolean {
  const code = char.codePointAt(0)
  if (!code) {
    return false
  }
  return (
    (code >= 0x3400 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0x20000 && code <= 0x2fa1f)
  )
}

/** 去掉拼音声调符号，保留 ü */
export function stripTone(text: string): string {
  if (!text) {
    return ''
  }
  let output = ''
  for (const char of text) {
    output += PUNCTUATION.test(char) ? char : PINYIN_TONE_TABLE[char] || char
  }
  return output
}

function firstReading(value: string): string {
  const index = value.indexOf('/')
  return index >= 0 ? value.slice(0, index) : value
}

function isPolyphonic(value: string): boolean {
  return value.includes('/')
}

function needsSpace(output: string): boolean {
  if (!output) {
    return false
  }
  const chars = Array.from(output)
  return !PUNCTUATION.test(chars[chars.length - 1])
}

/**
 * 拼音标注：默认带声调。
 * - 先按 4→2 字词组匹配，命中后用词组读音消歧
 * - 未命中走单字表；非汉字原样保留
 */
export function toPinyin(input: string, options: PinyinOptions = {}): PinyinResult {
  const source = typeof input === 'string' ? input : ''
  const tone = options.tone !== false
  const allChars = Array.from(source)
  const truncated = allChars.length > PINYIN_MAX_CHARS
  const chars = truncated ? allChars.slice(0, PINYIN_MAX_CHARS) : allChars
  const charsTable = getCharMap()
  const phrases = getPhraseMap()
  const infos: PinyinCharInfo[] = []

  let index = 0
  while (index < chars.length) {
    let phraseMatched = false
    if (phrases.size > 0) {
      const maxLength = Math.min(4, chars.length - index)
      for (let length = maxLength; length >= 2; length -= 1) {
        const phrase = chars.slice(index, index + length).join('')
        const mapped = phrases.get(phrase)
        if (!mapped) {
          continue
        }
        const readings = mapped.split(' ')
        if (readings.length !== length) {
          continue
        }
        for (let offset = 0; offset < length; offset += 1) {
          const char = chars[index + offset]
          const entry = charsTable.get(char)
          infos.push({
            char,
            pinyin: readings[offset],
            covered: Boolean(entry),
            polyphonic: Boolean(entry && isPolyphonic(entry)),
          })
        }
        index += length
        phraseMatched = true
        break
      }
    }
    if (phraseMatched) {
      continue
    }

    const char = chars[index]
    const entry = charsTable.get(char)
    if (entry) {
      infos.push({
        char,
        pinyin: firstReading(entry),
        covered: true,
        polyphonic: isPolyphonic(entry),
      })
    } else {
      infos.push({
        char,
        pinyin: char,
        covered: false,
        polyphonic: false,
      })
    }
    index += 1
  }

  let output = ''
  let covered = 0
  let uncovered = 0
  let polyphonic = 0

  for (const info of infos) {
    if (info.covered) {
      covered += 1
      if (info.polyphonic) {
        polyphonic += 1
      }
      const reading = tone ? info.pinyin : stripTone(info.pinyin)
      if (needsSpace(output)) {
        output += ' '
      }
      output += reading
    } else {
      if (isCjkChar(info.char)) {
        uncovered += 1
      }
      output += info.char
    }
  }

  const result: PinyinResult = {
    output,
    chars: infos,
    tone,
    truncated,
    inputChars: allChars.length,
    covered,
    uncovered,
    polyphonic,
    summary: '',
  }
  result.summary = pinyinSummary(result)
  return result
}

/** 复制与 Workflow 共用的摘要；正文最多 200 字，避免超长载荷 */
export function pinyinSummary(result: PinyinResult, limit = 200): string {
  const outputChars = Array.from(result.output)
  const preview =
    outputChars.length > limit
      ? `${outputChars.slice(0, limit).join('')}…`
      : result.output
  const meta = [
    result.tone ? '带声调' : '不带声调',
    `已标注 ${result.covered} 字`,
  ]
  if (result.uncovered > 0) {
    meta.push(`未收录 ${result.uncovered} 字`)
  }
  if (result.polyphonic > 0) {
    meta.push('多音字按常用读音')
  }
  if (result.truncated) {
    meta.push(`已截断至 ${PINYIN_MAX_CHARS} 字`)
  }
  return `${meta.join(' · ')}\n${preview}`
}

/** 逐字对照：只列汉字，默认前 200 字 */
export function pinyinComparison(chars: PinyinCharInfo[], limit = 200): string {
  const rows: string[] = []
  for (const info of chars) {
    if (!info.covered) {
      continue
    }
    rows.push(`${info.char} ${info.pinyin}`)
    if (rows.length >= limit) {
      break
    }
  }
  return rows.join('\n')
}
