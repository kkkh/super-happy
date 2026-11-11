/* ==========================================================================
   图片编辑 · 裁剪 / 旋转 / 翻转 / 格式
   - 单张隐藏 Canvas 按真实像素重绘；预览仅屏幕缩放
   - 源图 ≤12MP；长边 >4096 先缩；裁剪最小 32×32；JPEG 透明补白
   ========================================================================== */
import { copyText, toast } from '../../lib/ui'
import { tapTick } from '../../../../core/utils/haptics'
import {
  chooseSingleImage,
  formatBytes,
  getFileSize,
  getImageInfo,
  saveImageToAlbum,
} from '../../lib/image'
import { LIMITS } from '../../../../core/constants/index'
import { isDevtools } from '../../../../core/utils/platform'
import { drawEditedImage, exportCanvas, selectCanvasNode, unlinkQuietly } from '../../lib/canvas'
import {
  MAX_EDGE,
  clampSourceSize,
  cropRect,
  rotatedSize,
  type CropRatio,
} from '../../lib/geometry'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'

const CANVAS_CSS = 320
const IS_DEVTOOLS = isDevtools()

type FormatKey = 'jpeg' | 'png'
type QualityKey = 'high' | 'balanced' | 'small'

interface ResultRow {
  k: string
  v: string
}

interface PhotoEditState {
  destroyed: boolean
  pending: boolean
}

const RATIO_OPTIONS: Array<{ key: CropRatio; label: string }> = [
  { key: '1:1', label: '1:1' },
  { key: '4:3', label: '4:3' },
  { key: '16:9', label: '16:9' },
  { key: 'free', label: '自由' },
]

const FORMAT_OPTIONS: Array<{ key: FormatKey; label: string }> = [
  { key: 'jpeg', label: 'JPEG' },
  { key: 'png', label: 'PNG' },
]

const QUALITY_OPTIONS: Array<{ key: QualityKey; label: string; quality: number }> = [
  { key: 'high', label: '高清', quality: 90 },
  { key: 'balanced', label: '均衡', quality: 80 },
  { key: 'small', label: '轻巧', quality: 65 },
]

Page({
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: '图片编辑',
    kicker: '图片处理',
    desc: '裁剪 · 旋转 · 翻转 · 格式',
    imagePath: '',
    imageWidth: 0,
    imageHeight: 0,
    sourceMeta: '',
    sourceNote: '',
    ratioKey: '1:1' as CropRatio,
    ratioOptions: RATIO_OPTIONS,
    rotation: 0,
    flipH: false,
    flipV: false,
    formatKey: 'jpeg' as FormatKey,
    formatOptions: FORMAT_OPTIONS,
    qualityKey: 'balanced' as QualityKey,
    qualityOptions: QUALITY_OPTIONS,
    canvasCss: CANVAS_CSS,
    outputPath: '',
    outputWidth: 0,
    outputHeight: 0,
    outputSizeText: '',
    outputMeta: '',
    resultRows: [] as ResultRow[],
    processing: false,
    saving: false,
    hasResult: false,
    shellState: 'idle',
    error: '',
    devtools: IS_DEVTOOLS,
    posterData: null as IPosterData | null,
  },

  onLoad() {
    const state = this as unknown as PhotoEditState
    state.destroyed = false
    state.pending = false
  },

  onUnload() {
    const state = this as unknown as PhotoEditState
    state.destroyed = true
    unlinkQuietly(this.data.imagePath)
    if (!this.data.saving) {
      unlinkQuietly(this.data.outputPath)
    }
  },

  async onChoose() {
    if (this.data.processing || this.data.saving) {
      toast('正在处理，请稍候')
      return
    }
    const state = this as unknown as PhotoEditState
    tapTick()
    try {
      const image = await chooseSingleImage()
      if (!image) {
        return
      }
      if (state.destroyed) {
        unlinkQuietly(image.path)
        return
      }
      if (image.size > LIMITS.MEDIA_SOURCE_BYTES) {
        this.setData({ error: '图片超过 50MB，请换一张或先截图' })
        return
      }
      let width = image.width
      let height = image.height
      if (!width || !height) {
        const info = await getImageInfo(image.path)
        width = info.width
        height = info.height
      }
      if (state.destroyed) {
        unlinkQuietly(image.path)
        return
      }
      unlinkQuietly(this.data.imagePath)
      unlinkQuietly(this.data.outputPath)
      state.pending = false
      this.setData({
        imagePath: image.path,
        imageWidth: width,
        imageHeight: height,
        sourceMeta: `${width} × ${height} · ${formatBytes(image.size)}`,
        sourceNote: '',
        outputPath: '',
        outputWidth: 0,
        outputHeight: 0,
        outputSizeText: '',
        outputMeta: '',
        resultRows: [],
        processing: false,
        hasResult: false,
        error: '',
        shellState: 'idle',
        posterData: null,
      })
      void this.render()
    } catch (error) {
      if (state.destroyed) {
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      this.setData({ error: message || '选择图片失败' })
    }
  },

  onRatio(event: WechatMiniprogram.TouchEvent) {
    const key = event.currentTarget.dataset.key as CropRatio
    if (!RATIO_OPTIONS.some((item) => item.key === key) || key === this.data.ratioKey) {
      return
    }
    tapTick()
    this.setData({ ratioKey: key }, () => void this.render())
  },

  onRotate(event: WechatMiniprogram.TouchEvent) {
    const delta = Number(event.currentTarget.dataset.delta)
    if (delta !== 90 && delta !== -90) {
      return
    }
    tapTick()
    const rotation = (this.data.rotation + delta + 360) % 360
    this.setData({ rotation }, () => void this.render())
  },

  onFlip(event: WechatMiniprogram.TouchEvent) {
    const axis = event.currentTarget.dataset.axis as 'h' | 'v'
    if (axis !== 'h' && axis !== 'v') {
      return
    }
    tapTick()
    this.setData(axis === 'h' ? { flipH: !this.data.flipH } : { flipV: !this.data.flipV }, () =>
      this.render(),
    )
  },

  onFormat(event: WechatMiniprogram.TouchEvent) {
    const key = event.currentTarget.dataset.key as FormatKey
    if (!FORMAT_OPTIONS.some((item) => item.key === key) || key === this.data.formatKey) {
      return
    }
    tapTick()
    this.setData({ formatKey: key }, () => void this.render())
  },

  onQuality(event: WechatMiniprogram.TouchEvent) {
    const key = event.currentTarget.dataset.key as QualityKey
    if (!QUALITY_OPTIONS.some((item) => item.key === key) || key === this.data.qualityKey) {
      return
    }
    tapTick()
    this.setData({ qualityKey: key }, () => void this.render())
  },

  onExample() {
    this.onChoose()
  },

  onReset() {
    if (this.data.processing || this.data.saving) {
      toast('正在处理，请稍候')
      return
    }
    const state = this as unknown as PhotoEditState
    state.pending = false
    unlinkQuietly(this.data.imagePath)
    unlinkQuietly(this.data.outputPath)
    this.setData({
      imagePath: '',
      imageWidth: 0,
      imageHeight: 0,
      sourceMeta: '',
      sourceNote: '',
      ratioKey: '1:1',
      rotation: 0,
      flipH: false,
      flipV: false,
      formatKey: 'jpeg',
      qualityKey: 'balanced',
      outputPath: '',
      outputWidth: 0,
      outputHeight: 0,
      outputSizeText: '',
      outputMeta: '',
      resultRows: [],
      processing: false,
      saving: false,
      hasResult: false,
      shellState: 'idle',
      error: '',
      posterData: null,
    })
  },

  onPreview() {
    const path = this.data.outputPath
    if (!path) {
      return
    }
    wx.previewImage({
      current: path,
      urls: [path],
      fail: () => toast('预览失败，请重试'),
    })
  },

  onCopyInfo() {
    if (!this.data.outputPath) {
      return
    }
    copyText(
      [
        '图片编辑结果',
        `输出：${this.data.outputWidth} × ${this.data.outputHeight} · ${this.data.outputSizeText}`,
        `格式：${this.data.formatKey === 'png' ? 'PNG' : 'JPEG'}`,
        `旋转：${this.data.rotation}° · 水平翻转 ${this.data.flipH ? '开' : '关'} · 垂直翻转 ${this.data.flipV ? '开' : '关'}`,
        `原图：${this.data.sourceMeta}`,
      ].join('\n'),
      '图片信息已复制',
    )
  },

  onSave() {
    const path = this.data.outputPath
    if (!path || this.data.saving || this.data.processing) {
      return
    }
    const state = this as unknown as PhotoEditState
    this.setData({ saving: true })
    saveImageToAlbum(path)
      .then((ok) => {
        if (state.destroyed) {
          return
        }
        this.setData({ saving: false })
        if (ok) {
          toast('已保存到相册')
        }
      })
      .catch(() => {
        if (state.destroyed) {
          return
        }
        this.setData({ saving: false })
        toast('保存失败，请重试')
      })
      .finally(() => {
        if (state.destroyed) {
          unlinkQuietly(path)
        }
      })
  },

  async onReceiveWorkflow(data: { imagePath?: string; payload?: string }): Promise<boolean> {
    const src =
      typeof data?.imagePath === 'string'
        ? data.imagePath
        : typeof data?.payload === 'string'
          ? data.payload
          : ''
    if (!src) {
      return false
    }
    try {
      const [info, size] = await Promise.all([getImageInfo(src), getFileSize(src)])
      unlinkQuietly(this.data.imagePath)
      unlinkQuietly(this.data.outputPath)
      this.setData({
        imagePath: src,
        imageWidth: info.width,
        imageHeight: info.height,
        sourceMeta: `${info.width} × ${info.height} · ${formatBytes(size)}`,
        sourceNote: '',
        outputPath: '',
        outputWidth: 0,
        outputHeight: 0,
        outputSizeText: '',
        outputMeta: '',
        resultRows: [],
        hasResult: false,
        error: '',
        shellState: 'idle',
        posterData: null,
      })
      void this.render()
      return true
    } catch {
      return false
    }
  },

  async render() {
    const src = this.data.imagePath
    if (!src) {
      return
    }
    const state = this as unknown as PhotoEditState
    if (this.data.processing) {
      state.pending = true
      return
    }
    if (IS_DEVTOOLS) {
      this.fail('开发者工具暂不支持 Skyline 画布，请扫码在真机预览')
      return
    }

    const clamp = clampSourceSize(this.data.imageWidth, this.data.imageHeight)
    if (!clamp.ok) {
      const message =
        clamp.code === 'too-large'
          ? '图片超过 12MP，请先裁剪或缩小'
          : clamp.code === 'too-small'
            ? '图片太小，至少需要 32 × 32'
            : '图片尺寸不可用，请换一张'
      this.fail(message)
      return
    }
    const crop = cropRect({ width: clamp.width, height: clamp.height }, this.data.ratioKey)
    if (!crop) {
      this.fail('裁剪区域小于 32 × 32，请换一张或调整比例')
      return
    }
    const output = rotatedSize({ width: crop.width, height: crop.height }, this.data.rotation)

    const quality =
      QUALITY_OPTIONS.find((item) => item.key === this.data.qualityKey) ?? QUALITY_OPTIONS[1]
    const previous = this.data.outputPath
    let created = ''
    this.setData({ processing: true, shellState: 'running', error: '' })

    try {
      const canvas = await selectCanvasNode(this, '#photo-canvas')
      await drawEditedImage(canvas, src, crop, output, {
        rotation: this.data.rotation,
        flipH: this.data.flipH,
        flipV: this.data.flipV,
        whiteBackground: this.data.formatKey === 'jpeg',
        scale: clamp.scale,
      })
      if (state.destroyed) {
        return
      }

      const path = await exportCanvas(
        canvas,
        output.width,
        output.height,
        this.data.formatKey,
        quality.quality,
      )
      created = path
      const size = await getFileSize(path)
      if (state.destroyed) {
        unlinkQuietly(path)
        return
      }

      const poster: IPosterData = {
        toolName: '图片编辑',
        category: '图片处理',
        mainResult: `${output.width} × ${output.height}`,
        resultLabel: '输出尺寸',
        params: [
          { label: '比例', value: RATIO_OPTIONS.find((item) => item.key === this.data.ratioKey)?.label ?? '' },
          { label: '格式', value: this.data.formatKey === 'png' ? 'PNG' : 'JPEG' },
          { label: '旋转', value: `${this.data.rotation}°` },
        ],
        extras: [
          `体积 ${formatBytes(size)}`,
          `水平翻转 ${this.data.flipH ? '开' : '关'} · 垂直翻转 ${this.data.flipV ? '开' : '关'}`,
        ],
      }
      this.setData({
        processing: false,
        shellState: 'done',
        hasResult: true,
        outputPath: path,
        outputWidth: output.width,
        outputHeight: output.height,
        outputSizeText: formatBytes(size),
        outputMeta: `${output.width} × ${output.height} · ${formatBytes(size)}`,
        sourceNote: clamp.scaled ? `长边已缩至 ${MAX_EDGE}px` : '',
        resultRows: [
          { k: '输出尺寸', v: `${output.width} × ${output.height}` },
          { k: '体积', v: formatBytes(size) },
          { k: '格式', v: this.data.formatKey === 'png' ? 'PNG' : `JPEG · ${quality.label}` },
          { k: '旋转', v: `${this.data.rotation}°` },
          { k: '翻转', v: `水平 ${this.data.flipH ? '开' : '关'} · 垂直 ${this.data.flipV ? '开' : '关'}` },
          { k: '原图', v: this.data.sourceMeta },
        ],
        error: '',
        posterData: poster,
      })
      if (previous && previous !== path) {
        unlinkQuietly(previous)
      }
    } catch (error) {
      unlinkQuietly(created)
      if (state.destroyed) {
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      this.setData({
        processing: false,
        shellState: 'error',
        hasResult: false,
        error: `处理失败：${message}`,
        posterData: null,
      })
    } finally {
      if (!state.destroyed && state.pending) {
        state.pending = false
        void this.render()
      }
    }
  },

  fail(message: string) {
    unlinkQuietly(this.data.outputPath)
    const state = this as unknown as PhotoEditState
    state.pending = false
    this.setData({
      processing: false,
      shellState: 'invalid',
      hasResult: false,
      outputPath: '',
      outputWidth: 0,
      outputHeight: 0,
      outputSizeText: '',
      outputMeta: '',
      resultRows: [],
      error: message,
      posterData: null,
    })
  },
})
