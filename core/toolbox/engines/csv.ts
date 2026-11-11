/* ==========================================================================
   CSV 引擎 · 转义、组装与 JSON ↔ CSV 双向转换
   - 防公式注入：非纯数值以空白后跟 = + - @ 开头时前置单引号
   - 含逗号 / 引号 / 换行时整体加引号，内部引号翻倍
   - buildCsv 统一 CRLF 行尾；JSON 转 CSV 输出可选 UTF-8 BOM
   - CSV → JSON 全部保留字符串，不做数字 / 布尔推断
   ========================================================================== */

export const CSV_MAX_BYTES = 2 * 1024 * 1024
export const CSV_BOM = '\uFEFF'

export interface CsvSuccess {
  ok: true
  output: string
  headers: string[]
  rowCount: number
  warnings: string[]
}

export interface CsvFailure {
  ok: false
  error: string
}

export type CsvResult = CsvSuccess | CsvFailure

export interface JsonToCsvOptions {
  /** 输出前置 UTF-8 BOM，便于 Excel 识别中文；默认 false */
  bom?: boolean
}

function utf8ByteLength(text: string): number {
  let bytes = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
  }
  return bytes
}

/** CSV 单元格转义 */
export function escapeCsv(value: string): string {
  const trimmed = value.replace(/^\s+/, '')
  const guarded =
    /^[=+\-@]/.test(trimmed) && !/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed)
      ? `'${value}`
      : value
  if (/[",\n\r]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`
  }
  return guarded
}

/** 兼容既有导出服务的命名 */
export const escapeCsvCell = escapeCsv

/** 二维表 → CSV 文本（CRLF，不含 BOM） */
export function buildCsv(rows: ReadonlyArray<ReadonlyArray<string | number>>): string {
  return rows
    .map((row) => row.map((cell) => escapeCsv(String(cell))).join(','))
    .join('\r\n')
}

function fail(error: string): CsvFailure {
  return { ok: false, error }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cellOf(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return JSON.stringify(value)
}

/** JSON 对象数组 → CSV；表头取所有对象键的并集，缺失留空 */
export function jsonToCsv(text: string, options: JsonToCsvOptions = {}): CsvResult {
  const input = text.trim()
  if (!input) {
    return fail('请输入 JSON 数组')
  }
  if (utf8ByteLength(input) > CSV_MAX_BYTES) {
    return fail('JSON 超过 2MB 上限')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(input)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return fail(`JSON 解析失败：${message}`)
  }
  if (!Array.isArray(parsed)) {
    return fail('请输入 JSON 数组')
  }
  if (parsed.length === 0) {
    return fail('JSON 数组为空，没有可导出的数据')
  }
  if (parsed.some((item) => !isPlainObject(item))) {
    return fail('数组元素需为对象，暂不支持纯值数组')
  }

  const records = parsed as Record<string, unknown>[]
  const headers: string[] = []
  records.forEach((record) => {
    Object.keys(record).forEach((key) => {
      if (!headers.includes(key)) {
        headers.push(key)
      }
    })
  })
  if (headers.length === 0) {
    return fail('对象没有可导出的字段')
  }

  let hasNested = false
  let hasTyped = false
  let hasMissing = false
  const rows = records.map((record) => {
    if (headers.some((key) => !(key in record))) {
      hasMissing = true
    }
    return headers.map((key) => {
      const value = record[key]
      if (value !== null && typeof value === 'object') {
        hasNested = true
      } else if (value === null || typeof value === 'number' || typeof value === 'boolean') {
        hasTyped = true
      }
      return cellOf(value)
    })
  })

  const warnings: string[] = []
  if (hasNested) {
    warnings.push('嵌套对象 / 数组已转为 JSON 字符串，CSV 转回时无法还原类型')
  }
  if (hasTyped) {
    warnings.push('数字 / 布尔 / null 转为文本，CSV 转回时会变成字符串')
  }
  if (hasMissing) {
    warnings.push('字段不一致，缺失值已留空')
  }

  const csv = buildCsv([headers, ...rows])
  return {
    ok: true,
    output: options.bom ? `${CSV_BOM}${csv}` : csv,
    headers,
    rowCount: records.length,
    warnings,
  }
}

function parseCsvRows(text: string): string[][] {
  const input = text.startsWith(CSV_BOM) ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  let index = 0

  while (index < input.length) {
    const char = input.charAt(index)
    if (inQuotes) {
      if (char === '"') {
        if (input.charAt(index + 1) === '"') {
          cell += '"'
          index += 2
          continue
        }
        inQuotes = false
        index += 1
        continue
      }
      cell += char
      index += 1
      continue
    }
    if (char === '"') {
      inQuotes = true
      index += 1
      continue
    }
    if (char === ',') {
      row.push(cell)
      cell = ''
      index += 1
      continue
    }
    if (char === '\r' || char === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      index += char === '\r' && input.charAt(index + 1) === '\n' ? 2 : 1
      continue
    }
    cell += char
    index += 1
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((item) => !(item.length === 1 && item[0] === ''))
}

/** 去掉 escapeCsv 为防公式注入加的前导单引号 */
function unguardCell(value: string): string {
  if (value.startsWith("'") && /^[=+\-@]/.test(value.slice(1).trimStart())) {
    return value.slice(1)
  }
  return value
}

/** CSV → JSON 对象数组；所有单元格按字符串输出 */
export function csvToJson(text: string): CsvResult {
  const input = text.trim()
  if (!input) {
    return fail('请输入 CSV 内容')
  }
  if (utf8ByteLength(input) > CSV_MAX_BYTES) {
    return fail('CSV 超过 2MB 上限')
  }

  const rows = parseCsvRows(input)
  if (rows.length === 0) {
    return fail('CSV 没有可解析的内容')
  }
  const headers = rows[0]
  if (headers.length === 0 || headers.every((header) => header === '')) {
    return fail('CSV 首行需要表头')
  }
  if (new Set(headers).size !== headers.length) {
    return fail('CSV 表头存在重复列')
  }

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    if (rows[rowIndex].length > headers.length) {
      return fail(
        `第 ${rowIndex + 1} 行有 ${rows[rowIndex].length} 列，超过表头 ${headers.length} 列`,
      )
    }
  }

  let guardRemoved = false
  let numericFound = false
  const records = rows.slice(1).map((row) => {
    const record: Record<string, string> = {}
    headers.forEach((header, columnIndex) => {
      const raw = row[columnIndex] ?? ''
      const value = unguardCell(raw)
      if (value !== raw) {
        guardRemoved = true
      }
      if (
        /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value.trim()) ||
        /^(true|false)$/i.test(value.trim())
      ) {
        numericFound = true
      }
      record[header] = value
    })
    return record
  })

  const warnings: string[] = []
  if (guardRemoved) {
    warnings.push('已移除 Excel 文本保护前缀（\'）')
  }
  if (numericFound) {
    warnings.push('数字 / 布尔按字符串保留，未做类型推断')
  }

  return {
    ok: true,
    output: JSON.stringify(records, null, 2),
    headers,
    rowCount: records.length,
    warnings,
  }
}
