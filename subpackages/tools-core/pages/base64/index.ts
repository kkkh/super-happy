/* ==========================================================================
   Base64 · 文本编解码 + 图片转 Base64
   - 文本：UTF-8 / 标准 Base64，兼容 URL-safe、中文与 Emoji
   - 图片：相册单图，≤2MB，可选 data URL 前缀；只在本机读取
   ========================================================================== */
import { copyText } from '../../lib/ui'
import { tapTick } from '../../../../core/utils/haptics'
import { LIMITS } from '../../../../core/constants/index'
import { ensurePrivacyAuthorized } from '../../../../core/utils/privacy'
import {
  BASE64_MAX_BYTES,
  BASE64_PREVIEW_LENGTH,
  decodeBase64ToText,
  encodeTextToBase64,
  imageToBase64,
  type ImageBase64Result,
} from '../../lib/base64'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'

type Base64Mode = 'encode' | 'decode' | 'image'

interface Base64State {
  destroyed: boolean
  imageSeq: number
}

interface ImageCache extends ImageBase64Result {
  full: string
  path: string
}

/** 大图 Base64 可达 2.7MB，完整字符串只放模块缓存，页面只渲染预览 */
let imageCache: ImageCache | null = null

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '—'
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function fileNameOf(path: string): string {
  const name = path.split('?')[0].split('/').pop() ?? ''
  return name || '本地图片'
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
    desc: '文本 / 图片 · 本机编解码',
    mode: 'encode' as Base64Mode,
    input: '',
    maxText: LIMITS.TEXT_INPUT,
    imagePath: '',
    imageName: '',
    imageMeta: '',
    imagePrefix: true,
    imageReading: false,
    shellState: 'idle',
    hasResult: false,
    error: '',
    resultLabel: 'Base64 结果',
    outputText: '',
    outputIsPreview: false,
    inputSizeText: '',
    outputSizeText: '',
    posterData: null as IPosterData | null,
  },

  onLoad() {
    const state = this as unknown as Base64State
    state.destroyed = false
    state.imageSeq = 0
  },

  onUnload() {
    const state = this as unknown as Base64State
    state.destroyed = true
    state.imageSeq += 1
    imageCache = null
  },

  onMode(event: WechatMiniprogram.TouchEvent) {
    const mode = event.currentTarget.dataset.mode as Base64Mode
    if (mode !== 'encode' && mode !== 'decode' && mode !== 'image') {
      return
    }
    tapTick()
    this.setData(
      {
        mode,
        hasResult: false,
        shellState: 'idle',
        error: '',
        outputText: '',
        outputIsPreview: false,
        inputSizeText: '',
        outputSizeText: '',
        resultLabel: mode === 'image' ? '图片 Base64' : mode === 'encode' ? 'Base64 结果' : '解码文本',
      },
      () => {
        if (mode === 'image') {
          if (imageCache) {
            this.applyImageResult()
          }
        } else {
          this.recalculate()
        }
      },
    )
  },

  onInput(event: WechatMiniprogram.TextareaInput) {
    this.setData({ input: event.detail.value }, () => {
      this.recalculate()
    })
  },

  onExample() {
    if (this.data.mode === 'image') {
      void this.onChooseImage()
      return
    }
    const sample = '超欢 · 本机处理 Base64'
    this.setData({ mode: 'encode', resultLabel: 'Base64 结果', input: sample }, () => {
      this.recalculate()
    })
  },

  onReset() {
    const state = this as unknown as Base64State
    state.imageSeq += 1
    imageCache = null
    this.setData({
      mode: 'encode',
      input: '',
      imagePath: '',
      imageName: '',
      imageMeta: '',
      imagePrefix: true,
      imageReading: false,
      shellState: 'idle',
      hasResult: false,
      error: '',
      resultLabel: 'Base64 结果',
      outputText: '',
      outputIsPreview: false,
      inputSizeText: '',
      outputSizeText: '',
      posterData: null,
    })
  },

  /* ---- 草稿：只恢复文本模式与输入；图片不进入草稿 ---- */
  draftMode(): string {
    return this.data.mode === 'decode' ? 'decode' : 'encode'
  },

  collectDraftInput(): Record<string, string> {
    return { input: this.data.input, imagePrefix: this.data.imagePrefix ? '1' : '0' }
  },

  applyDraftInput(input: Record<string, string>, mode: string): void {
    this.setData(
      {
        mode: mode === 'decode' ? 'decode' : 'encode',
        input: input.input ?? '',
        imagePath: '',
        imageName: '',
        imageMeta: '',
        imagePrefix: input.imagePrefix !== '0',
        imageReading: false,
        shellState: 'idle',
        hasResult: false,
        error: '',
        resultLabel: mode === 'decode' ? '解码文本' : 'Base64 结果',
        outputText: '',
        outputIsPreview: false,
        inputSizeText: '',
        outputSizeText: '',
        posterData: null,
      },
      () => {
        this.recalculate()
      },
    )
  },

  onCopy() {
    const state = this as unknown as Base64State
    if (state.destroyed) {
      return
    }
    const text =
      this.data.mode === 'image' && imageCache ? imageCache.full : this.data.outputText
    if (!text) {
      return
    }
    tapTick()
    copyText(text, 'Base64 结果已复制')
  },

  onImagePrefix(event: { detail: { value: boolean } }) {
    if (this.data.imageReading) {
      return
    }
    const imagePrefix = Boolean(event.detail.value)
    this.setData({ imagePrefix }, () => {
      if (imageCache) {
        this.applyImageResult()
      }
    })
  },

  async onChooseImage() {
    if (this.data.imageReading) {
      return
    }
    const state = this as unknown as Base64State
    const authorized = await ensurePrivacyAuthorized()
    if (state.destroyed) {
      return
    }
    if (!authorized) {
      this.setData({
        hasResult: false,
        shellState: 'invalid',
        error: '未同意隐私保护指引，无法访问相册',
      })
      return
    }
    tapTick()
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album'],
      sizeType: ['original'],
      success: (result) => {
        const file = result.tempFiles[0]
        if (!file || state.destroyed) {
          return
        }
        if (file.size > BASE64_MAX_BYTES) {
          this.setData({
            hasResult: false,
            shellState: 'invalid',
            error: '图片超过 2MB，请压缩后再试',
          })
          return
        }
        const seq = (state.imageSeq += 1)
        this.setData({
          imagePath: file.tempFilePath,
          imageName: fileNameOf(file.tempFilePath),
          imageMeta: `${formatSize(file.size)} · 读取中`,
          imageReading: true,
          hasResult: false,
          shellState: 'running',
          error: '',
          posterData: null,
        })
        imageToBase64(file.tempFilePath, this.data.imagePrefix)
          .then((meta) => {
            if (state.destroyed || seq !== state.imageSeq) {
              return
            }
            imageCache = {
              ...meta,
              full: this.data.imagePrefix ? meta.dataUrl : meta.base64,
              path: file.tempFilePath,
            }
            this.applyImageResult()
          })
          .catch((error) => {
            if (state.destroyed || seq !== state.imageSeq) {
              return
            }
            const message = error instanceof Error ? error.message : String(error)
            this.setData({
              imageReading: false,
              hasResult: false,
              shellState: 'error',
              imageMeta: formatSize(file.size),
              error: message || '图片读取失败，请重试',
            })
          })
      },
      fail: (error) => {
        const message = error.errMsg ?? ''
        if (state.destroyed || message.includes('cancel')) {
          return
        }
        this.setData({
          hasResult: false,
          shellState: 'error',
          error: /privacy|auth|authorize/i.test(message)
            ? '需要相册权限或隐私授权，请在设置中开启后再试'
            : '选择图片失败，请重试',
        })
      },
    })
  },

  applyImageResult() {
    const state = this as unknown as Base64State
    if (!imageCache || state.destroyed) {
      return
    }
    const full = this.data.imagePrefix ? imageCache.dataUrl : imageCache.base64
    imageCache.full = full
    const preview =
      full.length > BASE64_PREVIEW_LENGTH
        ? `${full.slice(0, BASE64_PREVIEW_LENGTH)}…`
        : full
    const mimeLabel = imageCache.mime.replace('image/', '').toUpperCase()
    const poster: IPosterData = {
      toolName: 'Base64',
      category: '文本效率',
      mainResult: `${full.length}`,
      resultLabel: 'Base64 字符数',
      params: [
        { label: '图片大小', value: formatSize(imageCache.size) },
        { label: '格式', value: mimeLabel },
      ],
      extras: [
        this.data.imagePrefix ? '含 data URL 前缀' : '纯 Base64',
        `原图 ${formatSize(imageCache.size)}`,
        `预览 ${Math.min(full.length, BASE64_PREVIEW_LENGTH)} 字符`,
      ],
    }
    this.setData({
      imagePath: imageCache.path,
      imageName: fileNameOf(imageCache.path),
      imageMeta: `${formatSize(imageCache.size)} · ${mimeLabel}`,
      imageReading: false,
      hasResult: true,
      shellState: 'done',
      resultLabel: '图片 Base64',
      error: '',
      outputText: preview,
      outputIsPreview: full.length > BASE64_PREVIEW_LENGTH,
      inputSizeText: `${formatSize(imageCache.size)} · ${mimeLabel}`,
      outputSizeText: `${full.length} 字符`,
      posterData: poster,
    })
  },

  recalculate() {
    if (this.data.mode === 'image') {
      if (imageCache) {
        this.applyImageResult()
      }
      return
    }
    const input = this.data.input
    if (!input) {
      this.setData({
        hasResult: false,
        shellState: 'idle',
        error: '',
        outputText: '',
        outputIsPreview: false,
        inputSizeText: '',
        outputSizeText: '',
      })
      return
    }
    try {
      if (this.data.mode === 'encode') {
        const { base64, byteLength } = encodeTextToBase64(input)
        const poster: IPosterData = {
          toolName: 'Base64',
          category: '文本效率',
          mainResult: `${base64.length}`,
          resultLabel: '输出字符数',
          params: [
            { label: '处理模式', value: '编码' },
            { label: '输入字符', value: `${Array.from(input).length}` },
          ],
          extras: [
            `输入 ${byteLength} 字节`,
            `输出 ${base64.length} 字符`,
            `编码预览 ${base64.slice(0, 24)}${base64.length > 24 ? '…' : ''}`,
          ],
        }
        this.setData({
          hasResult: true,
          shellState: 'done',
          error: '',
          resultLabel: 'Base64 结果',
          outputText: base64,
          outputIsPreview: false,
          inputSizeText: `${Array.from(input).length} 字符 · ${byteLength} 字节`,
          outputSizeText: `${base64.length} 字符`,
          posterData: poster,
        })
      } else {
        const { text, byteLength } = decodeBase64ToText(input)
        const outputChars = Array.from(text).length
        const asText = outputChars <= 24
        const poster: IPosterData = {
          toolName: 'Base64',
          category: '文本效率',
          mainResult: asText ? text : `${outputChars}`,
          resultLabel: asText ? '解码文本' : '解码字符数',
          params: [
            { label: '处理模式', value: '解码' },
            { label: '输入字符', value: `${input.length}` },
          ],
          extras: [
            `输出 ${outputChars} 字符 · ${byteLength} 字节`,
            `解码预览 ${text.slice(0, 24)}${outputChars > 24 ? '…' : ''}`,
          ],
        }
        this.setData({
          hasResult: true,
          shellState: 'done',
          error: '',
          resultLabel: '解码文本',
          outputText: text,
          outputIsPreview: false,
          inputSizeText: `${input.length} 字符`,
          outputSizeText: `${outputChars} 字符 · ${byteLength} 字节`,
          posterData: poster,
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.setData({ hasResult: false, shellState: 'error', error: message })
    }
  },
})
