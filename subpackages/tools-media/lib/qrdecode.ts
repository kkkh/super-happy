/* ==========================================================================
   二维码识别引擎 · 本机解码
   - 复用 jsQR 1.4.0（Apache-2.0）单文件移植，解码路径不碰 DOM / 网络
   - 输入 RGBA ImageData；长边超过 1024 先等比缩小
   - 只负责「图 → 文本」，不打开链接、不复制、不读写文件
   ========================================================================== */
import jsQR from './qrdecode-vendor'

/** 解码前允许的最大长边：超过后先缩小，降低内存与耗时 */
export const QR_DECODE_MAX_EDGE = 1024

/** 结果区展示上限：超过只截断展示，复制仍保留全文 */
export const QR_TEXT_LIMIT = 2000

interface DecodedQr {
  data?: string
}

type QrDecoder = (
  data: Uint8ClampedArray | number[],
  width: number,
  height: number,
  options?: { inversionAttempts?: 'dontInvert' | 'onlyInvert' | 'attemptBoth' | 'invertFirst' },
) => DecodedQr | null

export interface QrDecodeSize {
  width: number
  height: number
}

export interface QrDisplayResult {
  display: string
  truncated: boolean
}

/**
 * 计算解码画布尺寸：长边不超过 max，短边等比；非法输入返回 1×1。
 */
export function qrDecodeSize(
  width: number,
  height: number,
  max: number = QR_DECODE_MAX_EDGE,
): QrDecodeSize {
  const sourceWidth = Math.max(0, Math.floor(Number(width) || 0))
  const sourceHeight = Math.max(0, Math.floor(Number(height) || 0))
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return { width: 1, height: 1 }
  }
  const limit = Math.max(1, Math.floor(Number(max) || QR_DECODE_MAX_EDGE))
  const longEdge = Math.max(sourceWidth, sourceHeight)
  if (longEdge <= limit) {
    return { width: sourceWidth, height: sourceHeight }
  }
  const scale = limit / longEdge
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  }
}

/**
 * 从 RGBA 像素解码二维码；识别失败返回 null。
 * 注意：底层二值化会就地改写 data，调用方不要复用同一份像素。
 */
export function decodeImageData(
  data: Uint8ClampedArray | number[] | null | undefined,
  width: number,
  height: number,
): string | null {
  const w = Math.floor(Number(width) || 0)
  const h = Math.floor(Number(height) || 0)
  if (!data || w <= 0 || h <= 0 || data.length < w * h * 4) {
    return null
  }
  try {
    const decode = jsQR as unknown as QrDecoder
    const result = decode(data, w, h, { inversionAttempts: 'attemptBoth' })
    const text = result && typeof result.data === 'string' ? result.data : ''
    return text || null
  } catch {
    return null
  }
}

/** 结果区展示文本：超出上限截断并加省略号，复制使用原文 */
export function qrDisplayText(text: string, limit: number = QR_TEXT_LIMIT): QrDisplayResult {
  const value = typeof text === 'string' ? text : ''
  const max = Math.max(1, Math.floor(Number(limit) || QR_TEXT_LIMIT))
  if (value.length <= max) {
    return { display: value, truncated: false }
  }
  return { display: `${value.slice(0, max)}…`, truncated: true }
}

/** 结果类型标签：只用于展示，不改变文本内容 */
export function qrKindLabel(text: string): string {
  const value = typeof text === 'string' ? text : ''
  if (/^https?:\/\//i.test(value)) {
    return '链接'
  }
  if (/^WIFI:/i.test(value)) {
    return 'Wi-Fi'
  }
  if (/^BEGIN:VCARD/i.test(value)) {
    return '名片'
  }
  if (/^mailto:/i.test(value)) {
    return '邮箱'
  }
  if (/^tel:/i.test(value)) {
    return '电话'
  }
  return '文本'
}

/** 是否外链：复制后只提示「请在浏览器中打开」，绝不自动跳转 */
export function qrIsExternalLink(text: string): boolean {
  return /^https?:\/\//i.test(typeof text === 'string' ? text : '')
}
