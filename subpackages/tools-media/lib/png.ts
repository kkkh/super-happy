/* ==========================================================================
   极简 1-bit PNG 编码器 · 二维码专用
   - 1 位灰度 + 无压缩 deflate 块 + Adler32 + CRC32
   - 输出体积小，不依赖 Canvas，开发者工具与真机均可用
   ========================================================================== */

function crcTable(): number[] {
  const table: number[] = []
  for (let index = 0; index < 256; index += 1) {
    let crcValue = index
    for (let bit = 0; bit < 8; bit += 1) {
      crcValue = crcValue & 1 ? 0xedb88320 ^ (crcValue >>> 1) : crcValue >>> 1
    }
    table[index] = crcValue >>> 0
  }
  return table
}

const CRC_TABLE = crcTable()

function crc32(bytes: number[]): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function adler32(bytes: number[]): number {
  let low = 1
  let high = 0
  for (const byte of bytes) {
    low = (low + byte) % 65521
    high = (high + low) % 65521
  }
  return ((high << 16) | low) >>> 0
}

function u32(value: number): number[] {
  return [value >>> 24 & 0xff, value >>> 16 & 0xff, value >>> 8 & 0xff, value & 0xff]
}

function chunk(type: string, data: number[]): number[] {
  const typeBytes = Array.from(type).map((char) => char.charCodeAt(0))
  const body = [...typeBytes, ...data]
  return [...u32(data.length), ...body, ...u32(crc32(body))]
}

function zlibStore(raw: number[]): number[] {
  const out: number[] = [0x78, 0x01]
  let offset = 0
  while (offset < raw.length) {
    const length = Math.min(65535, raw.length - offset)
    const final = offset + length >= raw.length
    out.push(final ? 0x01 : 0x00)
    out.push(length & 0xff, length >>> 8 & 0xff)
    out.push((~length) & 0xff, (~length) >>> 8 & 0xff)
    for (let index = 0; index < length; index += 1) {
      out.push(raw[offset + index])
    }
    offset += length
  }
  out.push(...u32(adler32(raw)))
  return out
}

function bytesToBase64(bytes: number[]): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const b1 = bytes[index]
    const b2 = bytes[index + 1]
    const b3 = bytes[index + 2]
    out += alphabet[b1 >> 2]
    out += alphabet[((b1 & 0x03) << 4) | ((b2 ?? 0) >> 4)]
    out += b2 === undefined ? '=' : alphabet[((b2 & 0x0f) << 2) | ((b3 ?? 0) >> 6)]
    out += b3 === undefined ? '=' : alphabet[b3 & 0x3f]
  }
  return out
}

/**
 * 生成二维码 1-bit PNG 的 base64
 * @param matrix 暗模块矩阵
 * @param count 模块数（不含静区）
 * @param scale 每个模块的像素数
 * @param margin 静区模块数，默认 4
 */
export function qrPngBase64(matrix: boolean[][], count: number, scale: number, margin = 4): string {
  const size = (count + margin * 2) * scale
  const rowBytes = Math.ceil(size / 8)
  const raw = new Array<number>(size * (rowBytes + 1))
  const blankRow = new Uint8Array(rowBytes).fill(0xff)
  /* 预生成每个模块行的字节模式：同一模式在 scale 行内复用，避免逐像素 Math.floor */
  const rowPatterns: Uint8Array[] = new Array(count)
  for (let moduleRow = 0; moduleRow < count; moduleRow += 1) {
    const row = new Uint8Array(rowBytes).fill(0xff)
    const source = matrix[moduleRow]
    for (let moduleCol = 0; moduleCol < count; moduleCol += 1) {
      if (!source[moduleCol]) {
        continue
      }
      const startX = (moduleCol + margin) * scale
      for (let x = startX; x < startX + scale; x += 1) {
        row[Math.floor(x / 8)] &= ~(0x80 >> (x % 8))
      }
    }
    rowPatterns[moduleRow] = row
  }

  let cursor = 0
  for (let y = 0; y < size; y += 1) {
    raw[cursor] = 0
    cursor += 1
    const moduleRow = Math.floor(y / scale) - margin
    const pattern =
      moduleRow >= 0 && moduleRow < count ? rowPatterns[moduleRow] : blankRow
    for (let i = 0; i < rowBytes; i += 1) {
      raw[cursor] = pattern[i]
      cursor += 1
    }
  }

  const ihdr = [
    ...u32(size),
    ...u32(size),
    1,
    0,
    0,
    0,
    0,
  ]
  const png = [
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk('IHDR', ihdr),
    ...chunk('IDAT', zlibStore(raw)),
    ...chunk('IEND', []),
  ]
  return bytesToBase64(png)
}

/** 将 base64 PNG 写入用户目录；返回可保存/展示的临时路径 */
export function writePngFile(base64: string, fileName: string): Promise<string> {
  const filePath = `${wx.env.USER_DATA_PATH}/${fileName}`
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().writeFile({
      filePath,
      data: base64,
      encoding: 'base64',
      success: () => resolve(filePath),
      fail: (error) => reject(new Error(error.errMsg || '写入图片失败')),
    })
  })
}
