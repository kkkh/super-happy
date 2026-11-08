/* ==========================================================================
   九宫格切图 · 居中正方形 3×3
   - 单张隐藏 Canvas 逐格绘制并导出，避免 9 个画布占内存
   - 保存全部时逐张写入相册；仅在保存时申请权限
   ========================================================================== */
import { toast } from '../../lib/ui'
import { tapTick } from '../../../../core/utils/haptics'
import {
  chooseSingleImage,
  formatBytes,
  getImageInfo,
  saveImageToAlbum,
} from '../../lib/image'
import { LIMITS } from '../../../../core/constants/index'
import { isDevtools } from '../../../../core/utils/platform'
import { planNineGridInWorker } from '../../lib/worker-sandbox'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'

const CANVAS_CSS = 320
const IS_DEVTOOLS = isDevtools()

interface DrawContext {
  scale(x: number, y: number): void
  clearRect(x: number, y: number, width: number, height: number): void
  drawImage(
    image: unknown,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void
}

interface TileItem {
  index: number
  path: string
}

interface NineGridState {
  destroyed: boolean
}

/** 静默删除单张临时文件 */
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

/** 批量清理上一次生成的切图 */
function unlinkTiles(tiles: TileItem[]): void {
  tiles.forEach((tile) => unlinkQuietly(tile.path))
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function exportCanvas(canvas: WechatMiniprogram.Canvas, size: number): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas,
      fileType: 'jpg',
      quality: 0.92,
      destWidth: size,
      destHeight: size,
      success: (result) => resolve(result.tempFilePath),
      fail: (error) => reject(new Error(error.errMsg || '导出切图失败')),
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
    toolName: '九宫格切图',
    kicker: '图片处理',
    desc: '正方形九宫格，一键保存',
    imagePath: '',
    imageMeta: '',
    canvasCss: CANVAS_CSS,
    generating: false,
    savingAll: false,
    hasResult: false,
    error: '',
    tiles: [] as TileItem[],
    tileCount: 0,
    devtools: IS_DEVTOOLS,
    posterData: null as IPosterData | null,
  },

  onLoad() {
    const state = this as unknown as NineGridState
    state.destroyed = false
  },

  onUnload() {
    const state = this as unknown as NineGridState
    state.destroyed = true
    /* 半途返回时清理原图与已生成的 9 张切图；保存中的文件留给 finally 收尾 */
    unlinkQuietly(this.data.imagePath)
    if (!this.data.savingAll) {
      unlinkTiles(this.data.tiles)
    }
  },

  async onChoose() {
    if (this.data.generating) {
      toast('正在生成，请稍候')
      return
    }
    if (this.data.savingAll) {
      toast('正在保存，请稍候')
      return
    }
    const state = this as unknown as NineGridState
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
      unlinkTiles(this.data.tiles)
      unlinkQuietly(this.data.imagePath)
      this.setData({
        imagePath: image.path,
        imageMeta: `${image.width} × ${image.height} · ${formatBytes(image.size)}`,
        hasResult: false,
        error: '',
        tiles: [],
        tileCount: 0,
      })
      this.generate()
    } catch (error) {
      if (state.destroyed) {
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      this.setData({ error: message || '选择图片失败' })
    }
  },

  async generate() {
    const path = this.data.imagePath
    if (!path || this.data.generating) {
      return
    }
    const state = this as unknown as NineGridState
    unlinkTiles(this.data.tiles)
    this.setData({ generating: true, error: '', hasResult: false, tiles: [], tileCount: 0 })
    let tiles: TileItem[] = []
    try {
      if (IS_DEVTOOLS) {
        throw new Error('开发者工具暂不支持 Skyline 画布，请在真机预览')
      }
      const info = await getImageInfo(path)
      const canvas = await this.getCanvasNode()
      const dpr = Math.min(3, wx.getWindowInfo().pixelRatio || 1)
      const backing = Math.round(CANVAS_CSS * dpr)
      canvas.width = backing
      canvas.height = backing
      const ctx = canvas.getContext('2d') as unknown as DrawContext | null
      if (!ctx) {
        throw new Error('画布上下文不可用')
      }
      ctx.scale(dpr, dpr)

      const image = canvas.createImage()
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('图片解码失败，请换一张 JPG/PNG'))
        image.src = path
      })

      const width = info.width || image.width
      const height = info.height || image.height
      if (!width || !height) {
        throw new Error('无法读取图片尺寸')
      }

      let side = Math.min(width, height)
      let tileSource = side / 3
      let startX = (width - side) / 2
      let startY = (height - side) / 2

      /* 几何计划丢给 Worker；失败时自动回退主线程纯几何计算 */
      try {
        const plan = await planNineGridInWorker(
          { width, height, columns: 3, rows: 3 },
          { timeout: 5000, priority: 8 },
        )
        if (plan && plan.side > 0 && plan.cell > 0) {
          side = plan.side
          tileSource = plan.cell
          startX = plan.offsetsX[0] ?? startX
          startY = plan.offsetsY[0] ?? startY
        }
      } catch {
        /* Worker 不可用时保留本地几何 */
      }

      for (let row = 0; row < 3; row += 1) {
        for (let col = 0; col < 3; col += 1) {
          if (state.destroyed) {
            unlinkTiles(tiles)
            return
          }
          ctx.clearRect(0, 0, CANVAS_CSS, CANVAS_CSS)
          ctx.drawImage(
            image,
            startX + col * tileSource,
            startY + row * tileSource,
            tileSource,
            tileSource,
            0,
            0,
            CANVAS_CSS,
            CANVAS_CSS,
          )
          await delay(20)
          const tilePath = await exportCanvas(canvas, backing)
          tiles.push({ index: row * 3 + col + 1, path: tilePath })
        }
      }

      if (state.destroyed) {
        unlinkTiles(tiles)
        return
      }
      const poster: IPosterData = {
        toolName: '九宫格切图',
        category: '图片处理',
        mainResult: `${tiles.length}`,
        resultLabel: '切图张数',
        params: [
          { label: '原图参数', value: this.data.imageMeta },
          { label: '排布', value: '3 × 3' },
        ],
        extras: [
          `单张 ${CANVAS_CSS} × ${CANVAS_CSS} px`,
          '输出 JPG · 质量 92%',
        ],
      }
      this.setData({
        generating: false,
        hasResult: true,
        tiles,
        tileCount: tiles.length,
        posterData: poster,
      })
    } catch (error) {
      unlinkTiles(tiles)
      if (state.destroyed) {
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      this.setData({
        generating: false,
        hasResult: false,
        tiles: [],
        tileCount: 0,
        error: `切图失败：${message}`,
      })
    }
  },

  getCanvasNode(): Promise<WechatMiniprogram.Canvas> {
    return new Promise((resolve, reject) => {
      this.createSelectorQuery()
        .select('#nine-canvas')
        .fields({ node: true, size: true })
        .exec((result) => {
          const first = result[0] as { node?: WechatMiniprogram.Canvas } | null
          if (!first || !first.node) {
            reject(new Error('画布不可用，请在真机预览'))
            return
          }
          resolve(first.node)
        })
    })
  },

  onPreviewTile(event: WechatMiniprogram.TouchEvent) {
    const path = event.currentTarget.dataset.path as string
    if (!path) {
      return
    }
    wx.previewImage({
      current: path,
      urls: this.data.tiles.map((tile) => tile.path),
      fail: () => {
        toast('预览失败，请重试')
      },
    })
  },

  async onSaveAll() {
    if (!this.data.tiles.length || this.data.savingAll) {
      return
    }
    const state = this as unknown as NineGridState
    this.setData({ savingAll: true })
    let saved = 0
    try {
      for (const tile of this.data.tiles) {
        if (state.destroyed) {
          break
        }
        const ok = await saveImageToAlbum(tile.path)
        if (!ok) {
          break
        }
        saved += 1
      }
    } catch {
      toast('保存中断，请重试')
    } finally {
      if (state.destroyed) {
        /* 保存期间离开页面：写入结束后再清理临时切图 */
        unlinkTiles(this.data.tiles)
      } else {
        this.setData({ savingAll: false })
        if (saved > 0) {
          toast(saved === this.data.tiles.length ? '9 张切图已保存' : `已保存 ${saved} 张切图`)
        }
      }
    }
  },

  onExample() {
    this.onChoose()
  },

  onReset() {
    if (this.data.generating) {
      toast('正在生成，请稍候')
      return
    }
    if (this.data.savingAll) {
      toast('正在保存，请稍候')
      return
    }
    unlinkTiles(this.data.tiles)
    unlinkQuietly(this.data.imagePath)
    this.setData({
      imagePath: '',
      imageMeta: '',
      generating: false,
      savingAll: false,
      hasResult: false,
      error: '',
      tiles: [],
      tileCount: 0,
    })
  },
})
