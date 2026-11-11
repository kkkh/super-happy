/* ==========================================================================
   占位符模板引擎 · {{key}} 提取 / 变量解析 / 替换
   - 变量表每行 key=value 或 key: value；重复 key 取首值
   - 缺失变量保留原样，返回值单独列出，便于页面高亮
   - 模板超过 20,000 码点截断，与文本框上限一致
   ========================================================================== */

export const TEMPLATE_LIMIT = 20000

const KEY_PATTERN = /^[\w.-]+$/

export interface TemplateVariable {
  key: string
  value: string
}

export interface TemplateRenderResult {
  text: string
  /** 模板中出现过的唯一变量，保持首次出现顺序 */
  keys: string[]
  filled: string[]
  missing: string[]
  truncated: boolean
}

function placeholderPattern(): RegExp {
  return /\{\{\s*([\w.-]+)\s*\}\}/g
}

export function extractPlaceholders(template: string): string[] {
  const keys: string[] = []
  const seen = new Set<string>()
  const pattern = placeholderPattern()
  let match = pattern.exec(template)
  while (match) {
    const key = match[1]
    if (key && !seen.has(key)) {
      seen.add(key)
      keys.push(key)
    }
    match = pattern.exec(template)
  }
  return keys
}

export function parseVariables(source: string): TemplateVariable[] {
  const variables = new Map<string, string>()
  for (const line of source.split(/\r\n|\r|\n/)) {
    const value = line.trim()
    if (!value || value.startsWith('#')) {
      continue
    }
    const equalAt = value.indexOf('=')
    const colonAt = value.indexOf(':')
    const splitAt =
      equalAt >= 0 && (colonAt < 0 || equalAt < colonAt) ? equalAt : colonAt
    if (splitAt <= 0) {
      continue
    }
    const key = value.slice(0, splitAt).trim()
    if (!KEY_PATTERN.test(key) || variables.has(key)) {
      continue
    }
    variables.set(key, value.slice(splitAt + 1).trim())
  }
  return Array.from(variables, ([key, value]) => ({ key, value }))
}

export function renderTemplate(
  template: string,
  variables: string | readonly TemplateVariable[],
): TemplateRenderResult {
  const chars = Array.from(template)
  const truncated = chars.length > TEMPLATE_LIMIT
  const source = truncated ? chars.slice(0, TEMPLATE_LIMIT).join('') : template
  const table = new Map<string, string>()
  const list =
    typeof variables === 'string' ? parseVariables(variables) : variables
  for (const item of list) {
    if (!table.has(item.key)) {
      table.set(item.key, item.value)
    }
  }

  const keys = extractPlaceholders(source)
  const filled: string[] = []
  const missing: string[] = []
  for (const key of keys) {
    if (table.has(key)) {
      filled.push(key)
    } else {
      missing.push(key)
    }
  }

  const text = source.replace(placeholderPattern(), (full, key: string) =>
    table.has(key) ? (table.get(key) as string) : full,
  )

  return { text, keys, filled, missing, truncated }
}

export function templateSummaryText(result: TemplateRenderResult): string {
  const parts = [`已填充 ${result.filled.length} / ${result.keys.length} 个变量`]
  if (result.missing.length > 0) {
    parts.push(`未填充：${result.missing.join('、')}`)
  }
  if (result.truncated) {
    parts.push(`模板超过 ${TEMPLATE_LIMIT.toLocaleString()} 字符，已截断`)
  }
  return parts.join('；')
}
