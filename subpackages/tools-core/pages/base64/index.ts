/* ==========================================================================
   Base64 · UTF-8 文本编解码（纯 JS，不依赖平台 API）
   - 支持中文、Emoji 与 URL-safe Base64（-_）
   - 只处理文本，不支持二进制文件；Base64 不是加密
   ========================================================================== */
import { copyText } from '../../lib/ui'
import { tapTick } from '../../../../core/utils/haptics'
import { LIMITS } from '../../../../core/constants/index'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'

type Base64Mode = 'encode' | 'decode'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

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

function bytesToBase64(bytes: number[]): string {
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

function base64ToBytes(raw: string): number[] {
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
      bytes.push(((v2 & 0x0f) << 4 | ((v3 & 0x3f) >> 2)) & 0xff)
    }
    if (v4 !== -1) {
      bytes.push(((v3 & 0x03) << 6 | (v4 & 0x3f)) & 0xff)
    }
  }
  return bytes
}

Page({
  /* 此处是处理工具页分享与深链参数校验的边界 */
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: 'Base64',
    kicker: '文本效率',
    desc: 'UTF-8 文本编解码',
    mode: 'encode' as Base64Mode,
    input: '',
    maxText: LIMITS.TEXT_INPUT,
    hasResult: false,
    error: '',
    outputText: '',
    inputSizeText: '',
    outputSizeText: '',
    posterData: null as IPosterData | null,
  },

  onMode(event: WechatMiniprogram.TouchEvent) {
    const mode = event.currentTarget.dataset.mode as Base64Mode
    if (mode !== 'encode' && mode !== 'decode') {
      return
    }
    tapTick()
    this.setData({ mode }, () => {
      this.recalculate()
    })
  },

  onInput(event: WechatMiniprogram.TextareaInput) {
    this.setData({ input: event.detail.value }, () => {
      this.recalculate()
    })
  },

  onExample() {
    const sample = '超欢 · 本机处理 Base64'
    this.setData({ mode: 'encode', input: sample }, () => {
      this.recalculate()
    })
  },

  onReset() {
    this.setData({
      input: '',
      hasResult: false,
      error: '',
      outputText: '',
      inputSizeText: '',
      outputSizeText: '',
    })
  },

  onCopy() {
    copyText(this.data.outputText, 'Base64 结果已复制')
  },

  recalculate() {
    const input = this.data.input
    if (!input) {
      this.setData({ hasResult: false, error: '', outputText: '' })
      return
    }
    try {
      if (this.data.mode === 'encode') {
        const bytes = utf8ToBytes(input)
        const output = bytesToBase64(bytes)
        const poster: IPosterData = {
          toolName: 'Base64',
          category: '文本效率',
          mainResult: `${output.length}`,
          resultLabel: '输出字符数',
          params: [
            { label: '处理模式', value: '编码' },
            { label: '输入字符', value: `${Array.from(input).length}` },
          ],
          extras: [
            `输入 ${bytes.length} 字节`,
            `输出 ${output.length} 字符`,
            `编码预览 ${output.slice(0, 24)}${output.length > 24 ? '…' : ''}`,
          ],
        }
        this.setData({
          hasResult: true,
          error: '',
          outputText: output,
          inputSizeText: `${Array.from(input).length} 字符 · ${bytes.length} 字节`,
          outputSizeText: `${output.length} 字符`,
          posterData: poster,
        })
      } else {
        const bytes = base64ToBytes(input)
        const output = bytesToUtf8(bytes)
        const outputChars = Array.from(output).length
        const asText = outputChars <= 24
        const poster: IPosterData = {
          toolName: 'Base64',
          category: '文本效率',
          mainResult: asText ? output : `${outputChars}`,
          resultLabel: asText ? '解码文本' : '解码字符数',
          params: [
            { label: '处理模式', value: '解码' },
            { label: '输入字符', value: `${input.length}` },
          ],
          extras: [
            `输出 ${outputChars} 字符 · ${bytes.length} 字节`,
            `解码预览 ${output.slice(0, 24)}${outputChars > 24 ? '…' : ''}`,
          ],
        }
        this.setData({
          hasResult: true,
          error: '',
          outputText: output,
          inputSizeText: `${input.length} 字符`,
          outputSizeText: `${Array.from(output).length} 字符 · ${bytes.length} 字节`,
          posterData: poster,
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.setData({ hasResult: false, error: message })
    }
  },
})
