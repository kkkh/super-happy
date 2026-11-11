/* ==========================================================================
   简繁转换引擎 · 本地纯函数
   - 词组优先最长匹配（2–4 字），字符级兜底；未收录字符原样保留
   - 词库来自 OpenCC 1.4.2 字典，随包内置，不联网
   - 超 20,000 字截断并提示；方向 / 模式切换不丢输入
   ========================================================================== */
import {
  ZH_S2T_AMBIGUOUS,
  ZH_S2T_CHARS_RAW,
  ZH_S2T_PHRASES_RAW,
  ZH_T2S_AMBIGUOUS,
  ZH_T2S_CHARS_RAW,
  ZH_T2S_PHRASES_RAW,
} from './zh-data'

export type ZhDirection = 's2t' | 't2s'
export type ZhMode = 'char' | 'phrase'

export const ZH_MAX_CHARS = 20000

export interface ZhConvertOptions {
  direction?: ZhDirection
  mode?: ZhMode
}

export interface ZhConvertResult {
  output: string
  direction: ZhDirection
  mode: ZhMode
  /** 实际替换的字符数，不做公共前后缀差分 */
  replaced: number
  truncated: boolean
  inputChars: number
  outputChars: number
  /** 输入中命中“一词多繁 / 多简”的字符数 */
  ambiguous: number
  summary: string
}

let s2tChars: Map<string, string> | null = null
let s2tPhrases: Map<string, string> | null = null
let t2sChars: Map<string, string> | null = null
let t2sPhrases: Map<string, string> | null = null
let s2tAmbiguous: Set<string> | null = null
let t2sAmbiguous: Set<string> | null = null

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

function getS2TChars(): Map<string, string> {
  if (!s2tChars) {
    s2tChars = parsePairs(ZH_S2T_CHARS_RAW)
  }
  return s2tChars
}

function getS2TPhrases(): Map<string, string> {
  if (!s2tPhrases) {
    s2tPhrases = parsePairs(ZH_S2T_PHRASES_RAW)
  }
  return s2tPhrases
}

function getT2SChars(): Map<string, string> {
  if (!t2sChars) {
    t2sChars = parsePairs(ZH_T2S_CHARS_RAW)
  }
  return t2sChars
}

function getT2SPhrases(): Map<string, string> {
  if (!t2sPhrases) {
    t2sPhrases = parsePairs(ZH_T2S_PHRASES_RAW)
  }
  return t2sPhrases
}

function getS2TAmbiguous(): Set<string> {
  if (!s2tAmbiguous) {
    s2tAmbiguous = new Set(Array.from(ZH_S2T_AMBIGUOUS))
  }
  return s2tAmbiguous
}

function getT2SAmbiguous(): Set<string> {
  if (!t2sAmbiguous) {
    t2sAmbiguous = new Set(Array.from(ZH_T2S_AMBIGUOUS))
  }
  return t2sAmbiguous
}

export function zhDirectionLabel(direction: ZhDirection): string {
  return direction === 't2s' ? '繁→简' : '简→繁'
}

export function zhModeLabel(mode: ZhMode): string {
  return mode === 'char' ? '字符级' : '词组级'
}

export function normalizeZhDirection(value: unknown): ZhDirection {
  return value === 't2s' ? 't2s' : 's2t'
}

export function normalizeZhMode(value: unknown): ZhMode {
  return value === 'char' ? 'char' : 'phrase'
}

function countDifferences(source: string, target: string): number {
  const sourceChars = Array.from(source)
  const targetChars = Array.from(target)
  if (sourceChars.length !== targetChars.length) {
    return sourceChars.length
  }
  let count = 0
  for (let index = 0; index < sourceChars.length; index += 1) {
    if (sourceChars[index] !== targetChars[index]) {
      count += 1
    }
  }
  return count
}

/**
 * 简繁转换：默认简→繁 + 词组级。
 * - 词组级先按 4→2 字最长匹配，未命中再走字符表
 * - 空串返回空结果，由页面展示空态
 */
export function convertZh(input: string, options: ZhConvertOptions = {}): ZhConvertResult {
  const source = typeof input === 'string' ? input : ''
  const allChars = Array.from(source)
  const truncated = allChars.length > ZH_MAX_CHARS
  const chars = truncated ? allChars.slice(0, ZH_MAX_CHARS) : allChars
  const direction = normalizeZhDirection(options.direction)
  const mode = normalizeZhMode(options.mode)
  const charMap = direction === 's2t' ? getS2TChars() : getT2SChars()
  const phraseMap = direction === 's2t' ? getS2TPhrases() : getT2SPhrases()
  const ambiguousSet = direction === 's2t' ? getS2TAmbiguous() : getT2SAmbiguous()

  let output = ''
  let replaced = 0
  let ambiguous = 0
  for (const char of chars) {
    if (ambiguousSet.has(char)) {
      ambiguous += 1
    }
  }
  let index = 0

  while (index < chars.length) {
    const char = chars[index]

    let matched = false
    if (mode === 'phrase') {
      const maxLength = Math.min(4, chars.length - index)
      for (let length = maxLength; length >= 2; length -= 1) {
        const phrase = chars.slice(index, index + length).join('')
        const mapped = phraseMap.get(phrase)
        if (mapped) {
          output += mapped
          replaced += countDifferences(phrase, mapped)
          index += length
          matched = true
          break
        }
      }
    }
    if (matched) {
      continue
    }

    const mapped = charMap.get(char)
    if (mapped) {
      output += mapped
      if (mapped !== char) {
        replaced += 1
      }
    } else {
      output += char
    }
    index += 1
  }

  const result: ZhConvertResult = {
    output,
    direction,
    mode,
    replaced,
    truncated,
    inputChars: allChars.length,
    outputChars: Array.from(output).length,
    ambiguous,
    summary: '',
  }
  result.summary = zhSummary(result)
  return result
}

/** 复制与 Workflow 共用的摘要；正文最多 200 字，避免超长载荷 */
export function zhSummary(result: ZhConvertResult, limit = 200): string {
  const outputChars = Array.from(result.output)
  const preview =
    outputChars.length > limit
      ? `${outputChars.slice(0, limit).join('')}…`
      : result.output
  const meta = [
    zhDirectionLabel(result.direction),
    zhModeLabel(result.mode),
    `替换 ${result.replaced} 字`,
  ]
  if (result.truncated) {
    meta.push(`已截断至 ${ZH_MAX_CHARS} 字`)
  }
  return `${meta.join(' · ')}\n${preview}`
}
