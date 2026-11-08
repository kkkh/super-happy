/* ==========================================================================
   workflowSilent · A 类工具纯函数执行器
   - 只在主包内运行，不依赖任何页面实例与 UI
   - Base64 / 去重 / JSON / URL / 字数统计 与现有工具默认行为一致
   - 每个步骤都必须可抛错，由 workflowStore 统一熔断
   ========================================================================== */
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
