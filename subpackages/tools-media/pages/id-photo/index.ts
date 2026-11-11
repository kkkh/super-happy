/* ==========================================================================
   证件照换底 · 纯色背景 / 白蓝红 / 本机像素替换
   - 不引入 AI 抠图：8 个边缘采样块判纯色，复杂背景直接拒绝
   - 色差阈值 24、方差阈值 12；边缘按输出长边 ×2/1000 羽化
   - 不做人脸识别、不提取特征、不上传；退出页面清理临时文件
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
  ID_PHOTO_BACKGROUNDS,
  ID_PHOTO_DEFAULT_EDGE_PROTECT,
  ID_PHOTO_DEFAULT_FEATHER,
  ID_PHOTO_DEFAULT_TOLERANCE,
  ID_PHOTO_MAX_SOURCE_PIXELS,
  autoReplaceIdPhotoBackground,
  idPhotoBackgroundByKey,
  idPhotoFeatherRadius,
  idPhotoOutputSize,
  type IdPhotoBackgroundKey,
  type IdPhotoBackgroundType,
  type IdPhotoConfidence,
} from '../../lib/idphoto'
import { toast } from '../../lib/ui'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'

const CANVAS_CSS = 300
const IS_DEVTOOLS = isDevtools()

const BACKGROUND_TYPE_TEXT: Record<IdPhotoBackgroundType, string> = {
  solid: '纯色',
  gradient: '渐变',
  textured: '纹理',
  complex: '复杂',
}

const CONFIDENCE_TEXT: Record<IdPhotoConfidence, string> = {
  high: '高',
  medium: '中',
  low: '低',
}

interface ResultRow {
  k: string
  v: string
}

interface IdPhotoState {
  destroyed: boolean
  renderSeq: number
}

function emptyResult() {
  return {
    outputPath: '',
    outputTitle: '',
    outputSizeText: '',
    outputMeta: '',
    qualityHint: '',
    resultRows: [] as ResultRow[],
    hasResult: false,
    shellState: 'idle',
    error: '',
    posterData: null as IPosterData | null,
  }
}

Page({
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: '证件照换底',
    kicker: '图片处理',
    desc: '智能识别背景 · 白 / 蓝 / 红 · 本机换底',
    imagePath: '',
    imageWidth: 0,
    imageHeight: 0,
    sourceMeta: '',
    background: 'white' as IdPhotoBackgroundKey,
    backgroundOptions: ID_PHOTO_BACKGROUNDS,
    tolerance: ID_PHOTO_DEFAULT_TOLERANCE,
    edgeProtect: ID_PHOTO_DEFAULT_EDGE_PROTECT,
    feather: ID_PHOTO_DEFAULT_FEATHER,
    canvasCss: CANVAS_CSS,
    processing: false,
    saving: false,
    devtools: IS_DEVTOOLS,
    ...emptyResult(),
  },

  onLoad() {
    const state = this as unknown as IdPhotoState
    state.destroyed = false
    state.renderSeq = 0
  },

  onUnload() {
    const state = this as unknown as IdPhotoState
    state.destroyed = true
    state.renderSeq += 1
    unlinkQuietly(this.data.imagePath)
    if (!this.data.saving) {
      unlinkQuietly(this.data.outputPath)
    }
  },

  async onChoose() {
    if (this.data.saving || this.data.processing) {
      toast('正在处理，请稍候')
      return
    }
    const state = this as unknown as IdPhotoState
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
      if (width * height > ID_PHOTO_MAX_SOURCE_PIXELS) {
        this.setData({ error: '图片超过 1200 万像素，请先压缩或截图后再试' })
        unlinkQuietly(image.path)
        return
      }
      state.renderSeq += 1
      unlinkQuietly(this.data.imagePath)
      unlinkQuietly(this.data.outputPath)
      const output = idPhotoOutputSize(width, height)
      const feather = output
        ? idPhotoFeatherRadius(Math.max(output.width, output.height))
        : ID_PHOTO_DEFAULT_FEATHER
      this.setData({
        imagePath: image.path,
        imageWidth: width,
        imageHeight: height,
        sourceMeta: `${width} × ${height} · ${formatBytes(image.size)}`,
        feather,
        processing: false,
        ...emptyResult(),
      })
    } catch (error) {
      if (state.destroyed) {
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      this.setData({ error: message || '选择图片失败' })
    }
  },

  onBackground(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.background || '')
    const background = idPhotoBackgroundByKey(key)
    if (!background || background.key === this.data.background) {
      return
    }
    tapTick()
    this.invalidateResult()
    this.setData({ background: background.key })
  },

  onToleranceChanging(event: { detail: { value: number } }) {
    this.setData({ tolerance: Number(event.detail.value) })
  },

  onToleranceChange(event: { detail: { value: number } }) {
    this.setData({ tolerance: Number(event.detail.value) }, () => this.invalidateResult())
  },

  onEdgeProtectChanging(event: { detail: { value: number } }) {
    this.setData({ edgeProtect: Number(event.detail.value) })
  },

  onEdgeProtectChange(event: { detail: { value: number } }) {
    this.setData({ edgeProtect: Number(event.detail.value) }, () => this.invalidateResult())
  },

  onFeatherChanging(event: { detail: { value: number } }) {
    this.setData({ feather: Number(event.detail.value) })
  },

  onFeatherChange(event: { detail: { value: number } }) {
    this.setData({ feather: Number(event.detail.value) }, () => this.invalidateResult())
  },

  invalidateResult() {
    if (!this.data.hasResult && !this.data.outputPath && !this.data.processing) {
      return
    }
    const state = this as unknown as IdPhotoState
    state.renderSeq += 1
    const previous = this.data.outputPath
    if (previous) {
      unlinkQuietly(previous)
    }
    this.setData({ processing: false, ...emptyResult() })
  },

  onRun() {
    void this.render()
  },

  onReset() {
    if (this.data.saving || this.data.processing) {
      toast('正在处理，请稍候')
      return
    }
    const state = this as unknown as IdPhotoState
    state.renderSeq += 1
    unlinkQuietly(this.data.imagePath)
    unlinkQuietly(this.data.outputPath)
    this.setData({
      imagePath: '',
      imageWidth: 0,
      imageHeight: 0,
      sourceMeta: '',
      background: 'white',
      tolerance: ID_PHOTO_DEFAULT_TOLERANCE,
      edgeProtect: ID_PHOTO_DEFAULT_EDGE_PROTECT,
      feather: ID_PHOTO_DEFAULT_FEATHER,
      processing: false,
      ...emptyResult(),
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
    const state = this as unknown as IdPhotoState
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
    const state = this as unknown as IdPhotoState
    const src = this.data.imagePath
    if (!src || state.destroyed) {
      this.fail('请先从相册选择一张人像照片')
      return
    }
    if (this.data.devtools) {
      this.fail('开发者工具暂不支持 Skyline 画布，请扫码在真机预览')
      return
    }
    const size = idPhotoOutputSize(this.data.imageWidth, this.data.imageHeight)
    if (!size) {
      this.fail('图片尺寸不可用，请重新选择')
      return
    }
    const target = idPhotoBackgroundByKey(this.data.background)
    if (!target) {
      this.fail('请选择白底、蓝底或红底')
      return
    }

    const seq = ++state.renderSeq
    const previous = this.data.outputPath
    let created = ''
    this.setData({ processing: true, shellState: 'running', error: '' })

    try {
      const canvas = await selectCanvasNode(this, '#id-photo-canvas')
      if (state.destroyed || seq !== state.renderSeq) {
        return
      }
      canvas.width = size.width
      canvas.height = size.height
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

      ctx.clearRect(0, 0, size.width, size.height)
      ctx.drawImage(image, 0, 0, size.width, size.height)
      const imageData = ctx.getImageData(0, 0, size.width, size.height)
      const matte = autoReplaceIdPhotoBackground(
        imageData.data,
        size.width,
        size.height,
        target.rgb,
        {
          tolerance: this.data.tolerance,
          featherRadius: this.data.feather,
          edgeProtect: this.data.edgeProtect,
        },
      )
      if (!matte) {
        throw new Error('图片尺寸过小，无法识别背景')
      }
      imageData.data.set(matte.data)
      ctx.putImageData(imageData, 0, 0)

      const path = await exportCanvas(canvas, size.width, size.height, 'png', 1)
      created = path
      const bytes = await getFileSize(path)
      if (state.destroyed || seq !== state.renderSeq) {
        unlinkQuietly(path)
        return
      }

      const typeText = BACKGROUND_TYPE_TEXT[matte.backgroundType]
      const confidenceText = CONFIDENCE_TEXT[matte.confidence]
      const percent = Math.round(matte.removedRatio * 100)
      let qualityHint = ''
      if (matte.removedRatio < 0.02) {
        qualityHint = '几乎没有识别到背景：请降低容差，或选择人像与背景边界更清晰的照片。'
      } else if (matte.confidence === 'low') {
        qualityHint = '背景较复杂，已尽量保留主体；如仍有残留可提高容差，并适当调整边缘保护与羽化后重试。'
      } else if (matte.confidence === 'medium') {
        qualityHint = '已识别人像边界；发丝或半透明边缘可能仍有少量残留，可调整羽化后重试。'
      }
      const resultRows: ResultRow[] = [
        { k: '底色', v: `${target.label} · ${target.hex}` },
        { k: '背景识别', v: `${typeText} · 置信度${confidenceText}` },
        { k: '输出尺寸', v: `${size.width} × ${size.height}` },
        { k: '背景容差', v: `${this.data.tolerance}` },
        { k: '边缘保护', v: `${this.data.edgeProtect}` },
        { k: '羽化半径', v: `${matte.featherRadius}px` },
        { k: '背景占比', v: `${percent}%` },
        { k: '格式', v: 'PNG' },
        { k: '原图', v: this.data.sourceMeta },
      ]
      const poster: IPosterData = {
        toolName: '证件照换底',
        category: '图片处理',
        mainResult: `${target.label} ${target.hex}`,
        resultLabel: '新底色',
        params: [
          { label: '背景', value: `${typeText} · ${confidenceText}` },
          { label: '输出', value: `${size.width} × ${size.height}` },
        ],
        extras: [`移除 ${percent}% 背景`, `容差 ${this.data.tolerance}`, `原图 ${this.data.sourceMeta}`],
      }

      this.setData({
        processing: false,
        shellState: 'done',
        hasResult: true,
        outputPath: path,
        outputTitle: `${target.label}证件照`,
        outputSizeText: formatBytes(bytes),
        outputMeta: `${size.width} × ${size.height} · ${formatBytes(bytes)}`,
        resultRows,
        qualityHint,
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
      this.fail(message || '换底失败，请换一张人像照片重试')
    }
  },

  fail(message: string) {
    const previous = this.data.outputPath
    if (previous) {
      unlinkQuietly(previous)
    }
    this.setData({
      processing: false,
      ...emptyResult(),
      shellState: 'invalid',
      error: message,
    })
  },
})
