/* ==========================================================================
   workflowSilent · A 类工具纯函数执行器
   - 只在主包内运行，不依赖任何页面实例与 UI
   - Base64 / 去重 / JSON / URL / 字数统计 与现有工具默认行为一致
   - 每个步骤都必须可抛错，由 workflowStore 统一熔断
   ========================================================================== */
import {
  addDate,
  dateAddSummary,
  dateSummaryText,
  formatAll,
  parseDateAddWorkflow,
} from '../toolbox/engines/date'
import { colorSummary, parseColor } from '../toolbox/engines/color'
import { jsonToCsv } from '../toolbox/engines/csv'
import { pickUnique, splitOptions } from '../toolbox/engines/random'
import { convertText, isConvertMode } from '../toolbox/engines/text'
import { extractPlaceholders } from '../toolbox/engines/template'
import { analyzeResolution, resolutionSummary } from '../toolbox/engines/resolution'
import {
  changeRate,
  parsePercentWorkflow,
  percentOf,
  percentSummary,
  ratioParts,
} from '../toolbox/engines/percent'
import { workflowToolName } from './workflowConfig'
import type { IWorkflowData, WorkflowToolId } from './types'

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const SPACE_CODEPOINTS = new Set<number>([
  32,
  9,
  10,
  11,
  12,
  13,
  160,
  5760,
  8192,
  8193,
  8194,
  8195,
  8196,
  8197,
  8198,
  8199,
  8200,
  8201,
  8202,
  8232,
  8233,
  8239,
  8287,
  12288,
  65279,
])

function utf8ToBytes(text: string): number[] {
  const bytes: number[] = []
  for (const char of Array.from(text)) {
    const code = char.codePointAt(0)
    if (code === undefined) {
      continue
    }
    if (code < 0x80) {
      bytes.push(code)
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      )
    }
  }
  return bytes
}

function bytesToBase64(bytes: number[]): string {
  let out = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const b1 = bytes[index]
    const b2 = bytes[index + 1]
    const b3 = bytes[index + 2]
    out += BASE64_ALPHABET[b1 >> 2]
    out += BASE64_ALPHABET[((b1 & 0x03) << 4) | ((b2 ?? 0) >> 4)]
    out += b2 === undefined ? '=' : BASE64_ALPHABET[((b2 & 0x0f) << 2) | ((b3 ?? 0) >> 6)]
    out += b3 === undefined ? '=' : BASE64_ALPHABET[b3 & 0x3f]
  }
  return out
}

/** UTF-8 → Base64：支持中文、Emoji 与完整 Unicode */
export function encodeBase64Utf8(text: string): string {
  return bytesToBase64(utf8ToBytes(text))
}

/** 按行去重：默认去首尾空格、去空行、保持原序（与去重工具默认值一致） */
export function dedupeLines(text: string): string {
  const rawLines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const lines = rawLines.map((line) => line.trim()).filter((line) => line !== '')
  const seen = new Set<string>()
  const output: string[] = []
  lines.forEach((line) => {
    if (seen.has(line)) {
      return
    }
    seen.add(line)
    output.push(line)
  })
  if (output.length === 0) {
    throw new Error('去重结果为空')
  }
  return output.join('\n')
}

/** JSON 格式化：默认 2 空格缩进；非法 JSON 明确抛错，由 Store 熔断 */
export function formatJsonText(text: string): string {
  if (!text.trim()) {
    throw new Error('请输入 JSON 内容')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`JSON 解析失败：${message}`)
  }
  try {
    const output = JSON.stringify(parsed, null, 2)
    if (typeof output !== 'string') {
      throw new Error('该内容无法序列化为 JSON 文本')
    }
    return output
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`JSON 序列化失败：${message}`)
  }
}

/** URL 编码：使用平台标准 encodeURIComponent，异常直接上抛 */
export function encodeUrlText(text: string): string {
  if (!text) {
    throw new Error('请输入 URL 内容')
  }
  return encodeURIComponent(text)
}

interface TextCounts {
  total: number
  noSpace: number
  chinese: number
  english: number
  digits: number
  lines: number
  paragraphs: number
}

/** 与字数统计工具同口径：中文 / 英文单词 / 数字串 / 行 / 段落 */
export function countText(text: string): TextCounts {
  const chars = Array.from(text)
  let total = 0
  let noSpace = 0
  let chinese = 0
  let english = 0
  let digits = 0
  let inWord = false
  let inDigits = false

  for (const char of chars) {
    total += 1
    const cp = char.codePointAt(0) ?? 0
    if (!SPACE_CODEPOINTS.has(cp)) {
      noSpace += 1
    }
    if (
      (cp >= 0x3400 && cp <= 0x4dbf) ||
      (cp >= 0x4e00 && cp <= 0x9fff) ||
      (cp >= 0xf900 && cp <= 0xfaff)
    ) {
      chinese += 1
    }

    const isAsciiLetter = (cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122)
    const isConnector = cp === 39 || cp === 8217 || cp === 45
    if (isAsciiLetter) {
      if (!inWord) {
        english += 1
        inWord = true
      }
    } else if (!(isConnector && inWord)) {
      inWord = false
    }

    const isDigit = cp >= 48 && cp <= 57
    if (isDigit) {
      if (!inDigits) {
        digits += 1
        inDigits = true
      }
    } else {
      inDigits = false
    }
  }

  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const rawLines = normalized.split('\n')
  const lines = rawLines.length
  const paragraphs =
    normalized
      .split(/\n\s*\n/)
      .map((block) => block.trim())
      .filter(Boolean).length || 0

  return { total, noSpace, chinese, english, digits, lines, paragraphs }
}

function formatCountSummary(text: string): string {
  if (!text.trim()) {
    throw new Error('请输入需要统计的文本')
  }
  const counts = countText(text)
  return [
    `字符 ${counts.total}`,
    `不含空格 ${counts.noSpace}`,
    `中文 ${counts.chinese}`,
    `英文单词 ${counts.english}`,
    `数字串 ${counts.digits}`,
    `行 ${counts.lines}`,
    `段落 ${counts.paragraphs}`,
  ].join(' · ')
}

/** 进制摘要：十进制文本 → 四进制摘要；仅接受安全整数，超出交给页面处理 */
function formatRadixSummary(text: string): string {
  const raw = text.trim()
  if (!/^-?\d+$/.test(raw)) {
    throw new Error('进制转换：静默流转仅支持十进制整数')
  }
  const value = Number(raw)
  if (!Number.isSafeInteger(value)) {
    throw new Error('进制转换：数值超出安全整数范围，请在页面内转换')
  }
  const negative = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  return [
    `BIN ${negative}${abs.toString(2)}`,
    `OCT ${negative}${abs.toString(8)}`,
    `DEC ${negative}${abs.toString(10)}`,
    `HEX ${negative}${abs.toString(16).toUpperCase()}`,
  ].join(' / ')
}

/** 日期格式：与页面同源 formatAll，非法日期明确抛错 */
function formatDateSummary(text: string): string {
  const result = formatAll(text.trim())
  if (!result) {
    throw new Error('日期格式：请输入 1900–2100 之间的合法日期')
  }
  return dateSummaryText(result)
}

/** 文本转换：context.convertMode 决定模式；缺失时默认 snake，保证面板可直接流转 */
function convertSilentText(input: IWorkflowData): string {
  const raw = input.context?.convertMode
  const mode = isConvertMode(raw) ? raw : 'snake'
  const result = convertText(mode, input.payload)
  if (!result.text) {
    throw new Error('文本转换：没有可转换的内容')
  }
  return result.text
}

/** 随机决定：silent 固定不重复，pickCount 缺省 1 */
function pickSilent(input: IWorkflowData): string {
  const raw = input.context?.pickCount
  const count = typeof raw === 'number' && Number.isInteger(raw) ? raw : 1
  const result = pickUnique(splitOptions(input.payload), count)
  if (!result.ok) {
    throw new Error(
      result.code === 'insufficient'
        ? '随机决定：选项数量不足'
        : result.code === 'count'
          ? '随机决定：抽取数量需在 1–10 之间'
          : '随机决定：没有可抽取的选项',
    )
  }
  return `抽中：${result.picked.join('、')}`
}

/** 占位符模板：silent 只提取变量清单，替换需要变量表，引导去页面填写 */
function templateSilent(input: IWorkflowData): string {
  const keys = extractPlaceholders(input.payload)
  if (keys.length === 0) {
    throw new Error('占位符模板：未发现 {{变量}}，请到页面填写模板与变量')
  }
  return `变量：${keys.join('、')}（${keys.length} 个）`
}

/** 分辨率静默：解析「宽x高」，输出化简比例 / 像素 / 高清判定 */
function resolutionSilent(input: IWorkflowData): string {
  const match = input.payload.match(/(\d{1,6})\s*[x×*]\s*(\d{1,6})/i)
  if (!match) {
    throw new Error('分辨率与比例：请输入 宽x高，例如 1920x1080')
  }
  const base = analyzeResolution(Number(match[1]), Number(match[2]))
  if (!base) {
    throw new Error('分辨率与比例：宽高需为大于 0 的整数')
  }
  return resolutionSummary({
    ...base,
    targetWidth: null,
    targetHeight: null,
    targetRatioText: null,
  })
}

/** 日期加减静默：输入 `YYYY-MM-DD ±30d/w/m/y`，摘要与页面同源 */
function dateAddSilent(input: IWorkflowData): string {
  const parsed = parseDateAddWorkflow(input.payload)
  if (!parsed) {
    throw new Error('日期加减：请输入「日期 ±数量单位」，例如 2026-01-31 +1m')
  }
  const result = addDate(parsed.startISO, parsed.amount, parsed.unit)
  if (!result) {
    throw new Error('日期加减：结果需在 1900-01-01 至 2100-12-31 之间')
  }
  return dateAddSummary(result)
}

/** 颜色静默：HEX / RGB / HSL 任一，默认对白底计算对比度 */
function colorSilent(input: IWorkflowData): string {
  const foreground = parseColor(input.payload)
  if (!foreground) {
    throw new Error('颜色：请输入 #RGB / #RRGGBB 或 rgb(...) / hsl(...)')
  }
  return colorSummary(foreground)
}

/** JSON → CSV 静默：输入 JSON 对象数组，输出首行表头的 CSV 文本 */
function jsonCsvSilent(input: IWorkflowData): string {
  const result = jsonToCsv(input.payload)
  if (!result.ok) {
    throw new Error(`JSON 转 CSV：${result.error}`)
  }
  return result.output
}

/** 百分比静默：支持「占比 / 增减 / 配比」前缀，无前缀默认占比 */
function percentSilent(input: IWorkflowData): string {
  const parsed = parsePercentWorkflow(input.payload)
  if (!parsed) {
    throw new Error('百分比：请输入两个数字，例如 占比 25 200')
  }
  const result =
    parsed.mode === 'share'
      ? percentOf(parsed.aCents, parsed.bCents)
      : parsed.mode === 'change'
        ? changeRate(parsed.aCents, parsed.bCents)
        : ratioParts(parsed.aCents, parsed.bCents)
  if (!result) {
    throw new Error('百分比：请检查总数 / 原值是否为 0，或涨跌幅是否超过 1000%')
  }
  return percentSummary(result)
}

/** A 类工具唯一执行入口；返回新的 IWorkflowData，绝不修改入参 */
export function executeSilentTool(toolId: WorkflowToolId, input: IWorkflowData): IWorkflowData {
  if (!input.payload) {
    throw new Error(`${workflowToolName(toolId)}：输入内容为空`)
  }
  if (input.type === 'image') {
    throw new Error(`${workflowToolName(toolId)}：不支持图片静默计算`)
  }

  switch (toolId) {
    case 'base64':
      return { type: 'text', payload: encodeBase64Utf8(input.payload) }
    case 'radix':
      return { type: 'text', payload: formatRadixSummary(input.payload) }
    case 'date-format':
      return { type: 'text', payload: formatDateSummary(input.payload) }
    case 'date-add':
      return { type: 'text', payload: dateAddSilent(input) }
    case 'color':
      return { type: 'text', payload: colorSilent(input) }
    case 'json-csv':
      return { type: 'text', payload: jsonCsvSilent(input) }
    case 'text-convert':
      return { type: 'text', payload: convertSilentText(input) }
    case 'random-pick':
      return { type: 'text', payload: pickSilent(input) }
    case 'template':
      return { type: 'text', payload: templateSilent(input) }
    case 'resolution':
      return { type: 'text', payload: resolutionSilent(input) }
    case 'percent':
      return { type: 'text', payload: percentSilent(input) }
    case 'dedupe':
      return { type: 'text', payload: dedupeLines(input.payload) }
    case 'json':
      return { type: 'json', payload: formatJsonText(input.payload) }
    case 'url':
      return { type: 'text', payload: encodeUrlText(input.payload) }
    case 'wordcount':
      return { type: 'text', payload: formatCountSummary(input.payload) }
    default:
      throw new Error(`${workflowToolName(toolId)}：该工具不是静默执行器`)
  }
}
