/* ==========================================================================
   crc32 · UTF-8 CRC32
   - 分片传输与 Cyber 快照校验共用同一实现，避免两份算法漂移
   ========================================================================== */

let crcTable: number[] | null = null

function buildCrcTable(): number[] {
  const table: number[] = []
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table.push(value >>> 0)
  }
  return table
}

function utf8Bytes(text: string): number[] {
  const bytes: number[] = []
  for (let index = 0; index < text.length; index += 1) {
    let code = text.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00)
        index += 1
      }
    }
    if (code <= 0x7f) {
      bytes.push(code)
    } else if (code <= 0x7ff) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    } else if (code <= 0xffff) {
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

export function crc32(text: string): number {
  if (!crcTable) {
    crcTable = buildCrcTable()
  }
  const bytes = utf8Bytes(text)
  let crc = 0xffffffff
  for (let index = 0; index < bytes.length; index += 1) {
    crc = crcTable[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

export function crc32Hex(text: string): string {
  return crc32(text).toString(16).padStart(8, '0')
}
