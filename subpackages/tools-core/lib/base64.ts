/* ==========================================================================
   Base64 · 文本编解码 + 图片转 Base64
   - 文本走纯 JS UTF-8 / Base64，兼容 URL-safe 与中文 / Emoji
   - 图片限制 2MB；只读取用户主动选择的单张图片，不扫描相册、不上传
   ========================================================================== */

export const BASE64_MAX_BYTES = 2 * 1024 * 1024
/** 图片 Base64 结果预览长度；完整内容通过复制获取，避免大字符串进 setData */
export const BASE64_PREVIEW_LENGTH = 1200

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const IMAGE_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  heic: 'image/heic',
  heif: 'image/heif',
}

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

function bytesToUtf8(bytes: number[]): string {
  let out = ''
  let index = 0
  while (index < bytes.length) {
    const first = bytes[index]
    if (first < 0x80) {
      out += String.fromCodePoint(first)
      index += 1
      continue
    }
    if (first >= 0xc2 && first <= 0xdf) {
      const second = bytes[index + 1]
      if (second === undefined || (second & 0xc0) !== 0x80) {
        throw new Error('不是有效的 UTF-8 文本')
      }
      out += String.fromCodePoint(((first & 0x1f) << 6) | (second & 0x3f))
      index += 2
      continue
    }
    if (first >= 0xe0 && first <= 0xef) {
      const second = bytes[index + 1]
      const third = bytes[index + 2]
      if (
        second === undefined ||
        third === undefined ||
        (second & 0xc0) !== 0x80 ||
        (third & 0xc0) !== 0x80
      ) {
        throw new Error('不是有效的 UTF-8 文本')
      }
      const code = ((first & 0x0f) << 12) | ((second & 0x3f) << 6) | (third & 0x3f)
      if (code >= 0xd800 && code <= 0xdfff) {
        throw new Error('不是有效的 UTF-8 文本')
      }
      out += String.fromCodePoint(code)
      index += 3
      continue
    }
    if (first >= 0xf0 && first <= 0xf4) {
      const second = bytes[index + 1]
      const third = bytes[index + 2]
      const fourth = bytes[index + 3]
      if (
        second === undefined ||
        third === undefined ||
        fourth === undefined ||
        (second & 0xc0) !== 0x80 ||
        (third & 0xc0) !== 0x80 ||
        (fourth & 0xc0) !== 0x80
      ) {
        throw new Error('不是有效的 UTF-8 文本')
      }
      const code =
        ((first & 0x07) << 18) |
        ((second & 0x3f) << 12) |
        ((third & 0x3f) << 6) |
        (fourth & 0x3f)
      if (code > 0x10ffff) {
        throw new Error('不是有效的 UTF-8 文本')
      }
      out += String.fromCodePoint(code)
      index += 4
      continue
    }
    throw new Error('不是有效的 UTF-8 文本')
  }
  return out
}

export function bytesToBase64(bytes: number[]): string {
  let out = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const b1 = bytes[index]
    const b2 = bytes[index + 1]
    const b3 = bytes[index + 2]
    out += ALPHABET[b1 >> 2]
    out += ALPHABET[((b1 & 0x03) << 4) | ((b2 ?? 0) >> 4)]
    out += b2 === undefined ? '=' : ALPHABET[((b2 & 0x0f) << 2) | ((b3 ?? 0) >> 6)]
    out += b3 === undefined ? '=' : ALPHABET[b3 & 0x3f]
  }
  return out
}

export function base64ToBytes(raw: string): number[] {
  const clean = raw.trim().replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/')
  if (!clean) {
    throw new Error('请输入 Base64 内容')
  }
  if (clean.length % 4 === 1) {
    throw new Error('Base64 长度不正确')
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) {
    throw new Error('包含无效的 Base64 字符')
  }
  const padded = clean.padEnd(clean.length + ((4 - (clean.length % 4)) % 4), '=')
  const bytes: number[] = []
  for (let index = 0; index < padded.length; index += 4) {
    const chunk = padded.slice(index, index + 4)
    const values = chunk.split('').map((char) => (char === '=' ? -1 : ALPHABET.indexOf(char)))
    if (values.some((value) => value < 0 && value !== -1)) {
      throw new Error('包含无效的 Base64 字符')
    }
    const [v1, v2, v3, v4] = values
    bytes.push(((v1 << 2) | ((v2 & 0x3f) >> 4)) & 0xff)
    if (v3 !== -1) {
      bytes.push((((v2 & 0x0f) << 4) | ((v3 & 0x3f) >> 2)) & 0xff)
    }
    if (v4 !== -1) {
      bytes.push((((v3 & 0x03) << 6) | (v4 & 0x3f)) & 0xff)
    }
  }
  return bytes
}

/** 文本 → Base64；返回输入字节数，便于结果区展示 */
export function encodeTextToBase64(text: string): { base64: string; byteLength: number } {
  const bytes = utf8ToBytes(text)
  return { base64: bytesToBase64(bytes), byteLength: bytes.length }
}

/** Base64 → UTF-8 文本；返回解码字节数 */
export function decodeBase64ToText(raw: string): { text: string; byteLength: number } {
  const bytes = base64ToBytes(raw)
  return { text: bytesToUtf8(bytes), byteLength: bytes.length }
}

/** 从文件名推断图片 MIME；未知扩展按 JPEG 处理 */
export function mimeForImage(filePath: string): string {
  const clean = filePath.split('?')[0]
  const name = clean.split('/').pop() ?? ''
  const dot = name.lastIndexOf('.')
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
  return IMAGE_MIME[ext] ?? 'image/jpeg'
}

/** 是否在 2MB 限制内（含边界） */
export function isImageWithinLimit(size: number): boolean {
  return Number.isFinite(size) && size > 0 && size <= BASE64_MAX_BYTES
}

export function withDataUrlPrefix(base64: string, mime: string): string {
  return `data:${mime};base64,${base64}`
}

export interface ImageBase64Result {
  base64: string
  dataUrl: string
  size: number
  mime: string
}

function fileSizeOf(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    try {
      wx.getFileSystemManager().getFileInfo({
        filePath,
        success: (result) => {
          resolve(typeof result.size === 'number' && result.size > 0 ? result.size : 0)
        },
        fail: () => resolve(0),
      })
    } catch {
      resolve(0)
    }
  })
}

function readBase64(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      wx.getFileSystemManager().readFile({
        filePath,
        encoding: 'base64',
        success: (result) => resolve(String(result.data)),
        fail: () => reject(new Error('读取图片失败，请重试')),
      })
    } catch {
      reject(new Error('当前环境不支持读取图片'))
    }
  })
}

/**
 * 读取本地图片并转 Base64
 * - 超过 2MB、大小读取失败、文件读取失败都会抛出可直接展示的中文错误
 * - withPrefix 为 true 时返回 data:image/...;base64,... 形式
 */
export function imageToBase64(
  filePath: string,
  withPrefix = true,
): Promise<ImageBase64Result> {
  if (!filePath) {
    return Promise.reject(new Error('请先选择图片'))
  }
  return fileSizeOf(filePath).then((size) => {
    if (!isImageWithinLimit(size)) {
      return Promise.reject(
        new Error(
          size > BASE64_MAX_BYTES
            ? '图片超过 2MB，请压缩后再试'
            : '无法读取图片大小，请重新选择',
        ),
      )
    }
    return readBase64(filePath).then((base64) => {
      const mime = mimeForImage(filePath)
      return {
        base64,
        dataUrl: withPrefix ? withDataUrlPrefix(base64, mime) : base64,
        size,
        mime,
      }
    })
  })
}
