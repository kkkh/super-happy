/* ==========================================================================
   vCard 3.0 引擎 · 转义 / 折行 / 字节预算
   - 行分隔固定 CRLF；每行 ≤75 UTF-8 字节
   - 续行以单个空格开头，该空格计入 75 字节
   ========================================================================== */

export const VCARD_MAX_BYTES = 1000
export const FIELD_MAX = 200

export interface VCardInput {
  name: string
  company: string
  title: string
  phone: string
  email: string
  address: string
  website: string
  note: string
}

export type VCardResult =
  | { ok: true; text: string; bytes: number }
  | { ok: false; code: 'name' | 'field' | 'size'; bytes: number }

/** UTF-8 字节数：不依赖 TextEncoder，兼容小程序运行时 */
export function utf8ByteLength(value: string): number {
  let bytes = 0
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x80) {
      bytes += 1
    } else if (code < 0x800) {
      bytes += 2
    } else if (code < 0x10000) {
      bytes += 3
    } else {
      bytes += 4
    }
  }
  return bytes
}

/** vCard 3.0 转义：反斜杠、分号、逗号与换行 */
export function escapeVCard(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
}

/** 按 75 字节折行；续行开头空格计入字节上限，不切断 UTF-8 字符 */
export function foldVCard(line: string): string {
  if (utf8ByteLength(line) <= 75) {
    return line
  }
  const chunks: string[] = []
  let current = ''
  let currentBytes = 0
  let limit = 75
  for (const char of line) {
    const size = utf8ByteLength(char)
    if (currentBytes + size > limit) {
      chunks.push(current)
      current = ' '
      currentBytes = 1
      limit = 75
    }
    current += char
    currentBytes += size
  }
  if (current) {
    chunks.push(current)
  }
  return chunks.join('\r\n')
}

function fieldLine(label: string, value: string): string {
  return `${label}:${escapeVCard(value.trim())}`
}

/** 生成 vCard 3.0：整段 ≤1000 UTF-8 字节 */
export function buildVCard(input: VCardInput): VCardResult {
  const name = input.name.trim()
  if (!name) {
    return { ok: false, code: 'name', bytes: 0 }
  }
  const fields = [
    input.name,
    input.company,
    input.title,
    input.phone,
    input.email,
    input.address,
    input.website,
    input.note,
  ]
  for (const field of fields) {
    if (Array.from(field.trim()).length > FIELD_MAX) {
      return { ok: false, code: 'field', bytes: 0 }
    }
  }

  const lines: string[] = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${escapeVCard(name)};;;;`,
    fieldLine('FN', name),
  ]
  if (input.company.trim()) {
    lines.push(fieldLine('ORG', input.company))
  }
  if (input.title.trim()) {
    lines.push(fieldLine('TITLE', input.title))
  }
  if (input.phone.trim()) {
    lines.push(fieldLine('TEL;TYPE=CELL', input.phone))
  }
  if (input.email.trim()) {
    lines.push(fieldLine('EMAIL;TYPE=INTERNET', input.email))
  }
  if (input.address.trim()) {
    lines.push(`ADR;TYPE=WORK:;;${escapeVCard(input.address.trim())};;;;`)
  }
  if (input.website.trim()) {
    lines.push(fieldLine('URL', input.website))
  }
  if (input.note.trim()) {
    lines.push(fieldLine('NOTE', input.note))
  }
  lines.push('END:VCARD')

  const text = `${lines.map((line) => foldVCard(line)).join('\r\n')}\r\n`
  const bytes = utf8ByteLength(text)
  if (bytes > VCARD_MAX_BYTES) {
    return { ok: false, code: 'size', bytes }
  }
  return { ok: true, text, bytes }
}
