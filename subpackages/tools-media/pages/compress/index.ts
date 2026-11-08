/* ==========================================================================
   图片压缩 · 原生压缩 + 最大边缩放
   - 只从相册选择；在本机处理，不上传
   - 展示原图 / 压缩图 / 体积对比，可保存到相册
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
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'

/** 静默删除上一次压缩产生的临时文件 */
function unlinkQuietly(filePath: string): void {
  if (!filePath) {
    return
  }
  try {
    wx.getFileSystemManager().unlink({ filePath, fail: () => undefined })
  } catch {
    // 文件系统不可用时忽略清理
  }
}

interface CompressState {
  destroyed: boolean
}

interface QualityOption {
  key: string
  label: string
  quality: number
}

interface EdgeOption {
  key: string
  label: string
  edge: number
}

const QUALITIES: QualityOption[] = [
  { key: 'high', label: '高清', quality: 90 },
  { key: 'balanced', label: '均衡', quality: 75 },
  { key: 'small', label: '轻巧', quality: 55 },
]

const EDGES: EdgeOption[] = [
  { key: 'origin', label: '原尺寸', edge: 0 },
  { key: '1920', label: '1920', edge: 1920 },
  { key: '1280', label: '1280', edge: 1280 },
  { key: '750', label: '750', edge: 750 },
]

function compressImage(
  src: string,
  quality: number,
  width: number | null,
  height: number | null,
): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.compressImage({
      src,
      quality,
      compressedWidth: width ?? undefined,
      compressedHeight: height ?? undefined,
      success: (result) => resolve(result.tempFilePath),
      fail: (error) => {
        if (width && height) {
          /* 低版本基础库不支持按尺寸压缩时，退回纯质量压缩 */
          wx.compressImage({
            src,
            quality,
            success: (fallback) => resolve(fallback.tempFilePath),
            fail: (fallbackError) =>
              reject(new Error(fallbackError.errMsg || error.errMsg || '压缩失败')),
          })
          return
        }
        reject(new Error(error.errMsg || '压缩失败'))
      },
    })
  })
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
    toolName: '图片压缩',
    kicker: '图片处理',
    desc: '本机压缩、前后体积对比',
    qualities: QUALITIES,
    edges: EDGES,
    qualityKey: 'balanced',
    edgeKey: '1920',
    imagePath: '',
    imageWidth: 0,
    imageHeight: 0,
    originalSize: 0,
    originalSizeText: '',
    originalSizeNote: '',
    compressedPath: '',
    compressedWidth: 0,
    compressedHeight: 0,
    compressedSize: 0,
    compressedSizeText: '',
    originalSizeMb: 0,
    compressedSizeMb: 0,
    ratioValue: 0,
    savedText: '',
    ratioText: '',
    compressedNote: '',
    compressing: false,
    shellState: 'idle',
    hasResult: false,
    error: '',
    saving: false,
    posterData: null as IPosterData | null,
  },

  onLoad() {
    const state = this as unknown as CompressState
    state.destroyed = false
  },

  onUnload() {
    const state = this as unknown as CompressState
    state.destroyed = true
    /* 半途返回时清理原图与压缩图；保存中的压缩文件留给 finally 收尾 */
    unlinkQuietly(this.data.imagePath)
    if (!this.data.saving) {
      unlinkQuietly(this.data.compressedPath)
    }
  },

  async onChoose() {
    if (this.data.compressing || this.data.saving) {
      return
    }
    const state = this as unknown as CompressState
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
      unlinkQuietly(this.data.compressedPath)
      this.setData({
        imagePath: image.path,
        imageWidth: width,
        imageHeight: height,
        originalSize: image.size,
        originalSizeText: formatBytes(image.size),
        originalSizeNote: `${width} × ${height}`,
        originalSizeMb: image.size / (1024 * 1024),
        compressedPath: '',
        compressedSize: 0,
        compressedSizeText: '',
        compressedSizeMb: 0,
        ratioValue: 0,
        compressing: false,
        hasResult: false,
        error: '',
        shellState: 'idle',
      })
      this.compress()
    } catch (error) {
      if (state.destroyed) {
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      this.setData({ error: message || '选择图片失败' })
    }
  },

  onQuality(event: WechatMiniprogram.TouchEvent) {
    if (this.data.compressing || this.data.saving) {
      return
    }
    const key = event.currentTarget.dataset.key as string
    if (!QUALITIES.some((item) => item.key === key) || key === this.data.qualityKey) {
      return
    }
    tapTick()
    this.setData({ qualityKey: key }, () => {
      if (this.data.imagePath) {
        this.compress()
      }
    })
  },

  onEdge(event: WechatMiniprogram.TouchEvent) {
    if (this.data.compressing || this.data.saving) {
      return
    }
    const key = event.currentTarget.dataset.key as string
    if (!EDGES.some((item) => item.key === key) || key === this.data.edgeKey) {
      return
    }
    tapTick()
    this.setData({ edgeKey: key }, () => {
      if (this.data.imagePath) {
        this.compress()
      }
    })
  },

  onSave() {
    if (!this.data.compressedPath || this.data.saving) {
      return
    }
    const state = this as unknown as CompressState
    const target = this.data.compressedPath
    this.setData({ saving: true })
    saveImageToAlbum(target)
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
        /* 页面已销毁：保存结束后再清理，避免打断在途写入 */
        if (state.destroyed) {
          unlinkQuietly(target)
        }
      })
  },

  onCopyInfo() {
    copyText(
      [
        '图片压缩结果',
        `原图：${this.data.originalSizeText} · ${this.data.imageWidth}×${this.data.imageHeight}`,
        `压缩后：${this.data.compressedSizeText} · ${this.data.compressedWidth}×${this.data.compressedHeight}`,
        this.data.savedText,
      ].join('\n'),
      '压缩信息已复制',
    )
  },

  onExample() {
    this.onChoose()
  },

  onReset() {
    if (this.data.compressing) {
      toast('正在处理，请稍候')
      return
    }
    if (this.data.saving) {
      toast('正在保存，请稍候')
      return
    }
    unlinkQuietly(this.data.imagePath)
    unlinkQuietly(this.data.compressedPath)
    this.setData({
      imagePath: '',
      imageWidth: 0,
      imageHeight: 0,
      originalSize: 0,
      originalSizeText: '',
      originalSizeNote: '',
      originalSizeMb: 0,
      compressedPath: '',
      compressedWidth: 0,
      compressedHeight: 0,
      compressedSize: 0,
      compressedSizeText: '',
      compressedSizeMb: 0,
      ratioValue: 0,
      savedText: '',
      ratioText: '',
      compressedNote: '',
      compressing: false,
      shellState: 'idle',
      hasResult: false,
      error: '',
      saving: false,
    })
  },

  async compress() {
    const src = this.data.imagePath
    if (!src || this.data.compressing) {
      return
    }
    const state = this as unknown as CompressState
    const quality = QUALITIES.find((item) => item.key === this.data.qualityKey) ?? QUALITIES[1]
    const edge = EDGES.find((item) => item.key === this.data.edgeKey) ?? EDGES[1]
    const maxSide = Math.max(this.data.imageWidth, this.data.imageHeight)
    const scale = edge.edge > 0 && maxSide > edge.edge ? edge.edge / maxSide : 1
    const targetWidth = scale < 1 ? Math.round(this.data.imageWidth * scale) : null
    const targetHeight = scale < 1 ? Math.round(this.data.imageHeight * scale) : null

    const previous = this.data.compressedPath
    let createdPath = ''
    this.setData({ compressing: true, error: '', shellState: 'running' })
    try {
      const path = await compressImage(src, quality.quality, targetWidth, targetHeight)
      createdPath = path
      if (state.destroyed) {
        unlinkQuietly(path)
        return
      }
      const size = await getFileSize(path)
      let width = targetWidth ?? this.data.imageWidth
      let height = targetHeight ?? this.data.imageHeight
      try {
        const info = await getImageInfo(path)
        width = info.width
        height = info.height
      } catch {
        // 尺寸读取失败时沿用目标尺寸
      }
      const ratio = this.data.originalSize > 0 ? (1 - size / this.data.originalSize) * 100 : 0
      const savedText = ratio >= 0 ? `已节省 ${ratio.toFixed(1)}%` : `体积增加 ${Math.abs(ratio).toFixed(1)}%`
      const compressedNote =
        ratio <= 0
          ? '该图片压缩收益有限，可尝试降低尺寸或换用 JPG 原图。'
          : ''
      if (state.destroyed) {
        unlinkQuietly(path)
        return
      }
      const poster: IPosterData = {
        toolName: '图片压缩',
        category: '图片处理',
        mainResult: `${Math.abs(ratio).toFixed(1)}%`,
        resultLabel: ratio >= 0 ? '体积节省' : '体积增加',
        params: [
          { label: '压缩质量', value: quality.label },
          { label: '最长边', value: edge.label },
        ],
        extras: [
          `原图体积 ${this.data.originalSizeText}`,
          `压缩后 ${formatBytes(size)}`,
          `原图 ${this.data.imageWidth}×${this.data.imageHeight}`,
          `输出 ${width}×${height}`,
        ],
      }
      this.setData({
        compressing: false,
        shellState: 'done',
        hasResult: true,
        compressedPath: path,
        compressedWidth: width,
        compressedHeight: height,
        compressedSize: size,
        compressedSizeText: formatBytes(size),
        originalSizeMb: this.data.originalSize / (1024 * 1024),
        compressedSizeMb: size / (1024 * 1024),
        ratioValue: Math.max(0, ratio),
        savedText,
        ratioText: `${Math.max(0, ratio).toFixed(1)}%`,
        compressedNote,
        posterData: poster,
      })
      if (previous && previous !== path) {
        unlinkQuietly(previous)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      unlinkQuietly(createdPath)
      unlinkQuietly(previous)
      if (state.destroyed) {
        return
      }
      this.setData({
        compressing: false,
        shellState: 'error',
        hasResult: false,
        compressedPath: '',
        error: `压缩失败：${message}。请尝试更换图片或降低尺寸。`,
      })
    }
  },
})
