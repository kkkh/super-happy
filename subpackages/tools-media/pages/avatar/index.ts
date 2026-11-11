/* ==========================================================================
   圆角头像 · 中心裁切 / 圆形 / 圆角 / PNG
   - 单张隐藏 Canvas 按输出尺寸重绘，预览仅屏幕缩放
   - 源图长边 >2048 先缩；输出 256 / 512 / 1024；PNG 保留透明边角
   - 选图前置隐私授权，保存相册复用 core 相册能力
   ========================================================================== */
import { tapTick } from '../../../../core/utils/haptics'
import { LIMITS } from '../../../../core/constants/index'
import { isDevtools } from '../../../../core/utils/platform'
import {
  chooseSingleImage,
  formatBytes,
  getFileSize,
  getImageInfo,
  saveImageToAlbum,
} from '../../lib/image'
import { exportCanvas, selectCanvasNode, unlinkQuietly } from '../../lib/canvas'
import {
  AVATAR_SIZES,
  avatarCropRect,
  avatarOutputSize,
  avatarRadius,
  avatarSourceScale,
  type AvatarShape,
  type AvatarSize,
} from '../../lib/avatar'
import { toast } from '../../lib/ui'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'

const CANVAS_CSS = 300
const IS_DEVTOOLS = isDevtools()

interface ResultRow {
  k: string
  v: string
}

interface AvatarState {
  destroyed: boolean
  renderSeq: number
}

const SHAPE_OPTIONS: Array<{ key: AvatarShape; label: string }> = [
  { key: 'circle', label: '圆形' },
  { key: 'round12', label: '圆角 12%' },
  { key: 'round25', label: '圆角 25%' },
]

Page({
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: '圆角头像',
    kicker: '图片处理',
    desc: '中心裁切 · 圆形 / 圆角 · PNG',
    imagePath: '',
    imageWidth: 0,
    imageHeight: 0,
    sourceMeta: '',
    sourceNote: '',
    shape: 'circle' as AvatarShape,
    shapeOptions: SHAPE_OPTIONS,
    size: 512 as AvatarSize,
    sizeOptions: AVATAR_SIZES,
    canvasCss: CANVAS_CSS,
    outputPath: '',
    outputTitle: '',
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
    const state = this as unknown as AvatarState
    state.destroyed = false
    state.renderSeq = 0
  },

  onUnload() {
    const state = this as unknown as AvatarState
    state.destroyed = true
    state.renderSeq += 1
    unlinkQuietly(this.data.imagePath)
    if (!this.data.saving) {
      unlinkQuietly(this.data.outputPath)
    }
  },

  async onChoose() {
    if (this.data.saving) {
      toast('正在保存，请稍候')
      return
    }
    const state = this as unknown as AvatarState
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
      state.renderSeq += 1
      unlinkQuietly(this.data.imagePath)
      unlinkQuietly(this.data.outputPath)
      this.setData({
        imagePath: image.path,
        imageWidth: width,
        imageHeight: height,
        sourceMeta: `${width} × ${height} · ${formatBytes(image.size)}`,
        sourceNote: '',
        outputPath: '',
        outputTitle: '',
        outputSizeText: '',
        outputMeta: '',
        resultRows: [],
        processing: false,
        hasResult: false,
        shellState: 'idle',
        error: '',
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

  onShape(event: WechatMiniprogram.TouchEvent) {
    const shape = event.currentTarget.dataset.shape as AvatarShape
    if (!SHAPE_OPTIONS.some((item) => item.key === shape) || shape === this.data.shape) {
      return
    }
    tapTick()
    this.setData({ shape }, () => void this.render())
  },

  onSize(event: WechatMiniprogram.TouchEvent) {
    const value = Number(event.currentTarget.dataset.size)
    const size = avatarOutputSize(value)
    if (!size || size === this.data.size) {
      return
    }
    tapTick()
    this.setData({ size }, () => void this.render())
  },

  onExample() {
    this.onChoose()
  },

  onReset() {
    if (this.data.saving) {
      toast('正在保存，请稍候')
      return
    }
    const state = this as unknown as AvatarState
    state.renderSeq += 1
    unlinkQuietly(this.data.imagePath)
    unlinkQuietly(this.data.outputPath)
    this.setData({
      imagePath: '',
      imageWidth: 0,
      imageHeight: 0,
      sourceMeta: '',
      sourceNote: '',
      shape: 'circle',
      size: 512,
      outputPath: '',
      outputTitle: '',
      outputSizeText: '',
      outputMeta: '',
      resultRows: [],
      processing: false,
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

  onSave() {
    const path = this.data.outputPath
    if (!path || this.data.saving || this.data.processing) {
      return
    }
    const state = this as unknown as AvatarState
    this.setData({ saving: true })
    saveImageToAlbum(path)
      .then((ok) => {
        if (state.destroyed) {
          return
        }
        this.setData({ saving: false })
        if (ok) {
          this.setData({ error: '' })
        }
      })
      .catch(() => {
        if (!state.destroyed) {
          this.setData({ saving: false })
        }
      })
  },

  async render() {
    const state = this as unknown as AvatarState
    const src = this.data.imagePath
    if (!src || state.destroyed) {
      return
    }
    if (this.data.devtools) {
      this.fail('开发者工具暂不支持 Skyline 画布，请扫码在真机预览')
      return
    }
    const size = avatarOutputSize(this.data.size)
    if (!size) {
      this.fail('输出尺寸只支持 256 / 512 / 1024')
      return
    }
    const scale = avatarSourceScale(this.data.imageWidth, this.data.imageHeight)
    const scaledWidth = Math.max(1, Math.round(this.data.imageWidth * scale))
    const scaledHeight = Math.max(1, Math.round(this.data.imageHeight * scale))
    const crop = avatarCropRect(scaledWidth, scaledHeight)
    if (!crop) {
      this.fail('图片太小，短边至少需要 32px')
      return
    }

    const seq = ++state.renderSeq
    const previous = this.data.outputPath
    let created = ''
    this.setData({ processing: true, shellState: 'running', error: '' })

    try {
      const canvas = await selectCanvasNode(this, '#avatar-canvas')
      if (state.destroyed || seq !== state.renderSeq) {
        return
      }
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext(
        '2d',
      ) as unknown as WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D | null
      if (!ctx) {
        throw new Error('画布上下文不可用')
      }
      const image = canvas.createImage()
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('图片解码失败，请换一张 JPG/PNG'))
        image.src = src
      })
      if (state.destroyed || seq !== state.renderSeq) {
        return
      }

      ctx.clearRect(0, 0, size, size)
      ctx.save()
      this.clipShape(ctx, size)
      ctx.drawImage(
        image,
        crop.x / scale,
        crop.y / scale,
        crop.size / scale,
        crop.size / scale,
        0,
        0,
        size,
        size,
      )
      ctx.restore()

      const path = await exportCanvas(canvas, size, size, 'png', 1)
      created = path
      const bytes = await getFileSize(path)
      if (state.destroyed || seq !== state.renderSeq) {
        unlinkQuietly(path)
        return
      }

      const shapeLabel =
        SHAPE_OPTIONS.find((item) => item.key === this.data.shape)?.label ?? '圆形'
      const resultRows: ResultRow[] = [
        { k: '形状', v: shapeLabel },
        { k: '输出尺寸', v: `${size} × ${size}` },
        { k: '体积', v: formatBytes(bytes) },
        { k: '格式', v: 'PNG · 透明' },
        { k: '原图', v: this.data.sourceMeta },
      ]
      const poster: IPosterData = {
        toolName: '圆角头像',
        category: '图片处理',
        mainResult: `${size} × ${size}`,
        resultLabel: '头像尺寸',
        params: [
          { label: '形状', value: shapeLabel },
          { label: '格式', value: 'PNG · 透明' },
        ],
        extras: [`体积 ${formatBytes(bytes)}`, `原图 ${this.data.sourceMeta}`],
      }

      this.setData({
        processing: false,
        shellState: 'done',
        hasResult: true,
        outputPath: path,
        outputTitle: `${size} × ${size}`,
        outputSizeText: formatBytes(bytes),
        outputMeta: `${size} × ${size} · ${formatBytes(bytes)}`,
        sourceNote: scale < 1 ? '长边已缩至 2048px 后裁切' : '',
        resultRows,
        error: '',
        posterData: poster,
      })
      if (previous && previous !== path) {
        unlinkQuietly(previous)
      }
    } catch (error) {
      unlinkQuietly(created)
      if (state.destroyed || seq !== state.renderSeq) {
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      this.fail(message || '头像生成失败，请换一张图片')
    }
  },

  /** 圆形 / 圆角路径；半径 0 时不裁剪（不应出现） */
  clipShape(
    ctx: WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D,
    size: number,
  ) {
    const radius = avatarRadius(this.data.shape, size)
    if (radius <= 0) {
      return
    }
    if (this.data.shape === 'circle') {
      ctx.beginPath()
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
      ctx.closePath()
      ctx.clip()
      return
    }
    const r = Math.min(radius, size / 2)
    ctx.beginPath()
    ctx.moveTo(r, 0)
    ctx.lineTo(size - r, 0)
    ctx.arc(size - r, r, r, -Math.PI / 2, 0)
    ctx.lineTo(size, size - r)
    ctx.arc(size - r, size - r, r, 0, Math.PI / 2)
    ctx.lineTo(r, size)
    ctx.arc(r, size - r, r, Math.PI / 2, Math.PI)
    ctx.lineTo(0, r)
    ctx.arc(r, r, r, Math.PI, Math.PI * 1.5)
    ctx.closePath()
    ctx.clip()
  },

  fail(message: string) {
    const previous = this.data.outputPath
    if (previous) {
      unlinkQuietly(previous)
    }
    this.setData({
      processing: false,
      shellState: 'invalid',
      hasResult: false,
      outputPath: '',
      outputTitle: '',
      outputSizeText: '',
      outputMeta: '',
      resultRows: [],
      error: message,
      posterData: null,
    })
  },
})
