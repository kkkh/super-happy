/* ==========================================================================
   图片取色 · 64×64 缩略图统计
   - 离屏 Canvas 采样，不写页面画布
   - 主色 / 平均色 / 五色色板；点击色值复制
   ========================================================================== */
import { copyText, toast } from '../../lib/ui'
import { tapTick } from '../../../../core/utils/haptics'
import { chooseSingleImage, formatBytes } from '../../lib/image'
import { LIMITS } from '../../../../core/constants/index'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'
import type { IWorkflowData } from '../../../../core/workflow/types'

const SAMPLE_SIZE = 64

/** 静默删除选图产生的临时文件 */
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

interface PaletteColor {
  hex: string
  rgb: string
  percent: string
  count: number
  red: number
  green: number
  blue: number
}

interface PaletteState {
  destroyed: boolean
}

interface PaletteResult {
  dominant: PaletteColor
  averageHex: string
  averageRgb: string
  colors: PaletteColor[]
}

function toHex(value: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(value)))
  return clamped.toString(16).padStart(2, '0').toUpperCase()
}

function rgbText(red: number, green: number, blue: number): string {
  return `RGB(${Math.round(red)}, ${Math.round(green)}, ${Math.round(blue)})`
}

function extractPalette(path: string): Promise<PaletteResult> {
  return new Promise((resolve, reject) => {
    let canvas: ReturnType<typeof wx.createOffscreenCanvas>
    try {
      canvas = wx.createOffscreenCanvas({ type: '2d', width: SAMPLE_SIZE, height: SAMPLE_SIZE })
    } catch {
      reject(new Error('当前环境不支持离屏画布，请在真机预览'))
      return
    }
    const context = canvas.getContext('2d')
    if (!context) {
      reject(new Error('无法创建取色画布'))
      return
    }
    const image = canvas.createImage()
    image.onload = () => {
      try {
        const side = Math.min(image.width, image.height)
        const sx = (image.width - side) / 2
        const sy = (image.height - side) / 2
        context.clearRect(0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
        context.drawImage(
          image,
          sx,
          sy,
          side,
          side,
          0,
          0,
          SAMPLE_SIZE,
          SAMPLE_SIZE,
        )
        const data = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data as Uint8ClampedArray

        const buckets = new Map<number, { red: number; green: number; blue: number; count: number }>()
        let sampled = 0
        let sumRed = 0
        let sumGreen = 0
        let sumBlue = 0
        for (let index = 0; index < data.length; index += 4) {
          const alpha = data[index + 3]
          if (alpha < 128) {
            continue
          }
          const red = data[index]
          const green = data[index + 1]
          const blue = data[index + 2]
          const key = ((red >> 4) << 8) | ((green >> 4) << 4) | (blue >> 4)
          const bucket = buckets.get(key)
          if (bucket) {
            bucket.red += red
            bucket.green += green
            bucket.blue += blue
            bucket.count += 1
          } else {
            buckets.set(key, { red, green, blue, count: 1 })
          }
          sampled += 1
          sumRed += red
          sumGreen += green
          sumBlue += blue
        }
        if (!sampled) {
          reject(new Error('图片没有可分析的颜色'))
          return
        }

        const clusters: PaletteColor[] = []
        const sorted = Array.from(buckets.values())
          .map((bucket) => ({
            red: bucket.red / bucket.count,
            green: bucket.green / bucket.count,
            blue: bucket.blue / bucket.count,
            count: bucket.count,
          }))
          .sort((left, right) => right.count - left.count)

        sorted.forEach((bucket) => {
          const hit = clusters.find((cluster) => {
            const dr = cluster.red - bucket.red
            const dg = cluster.green - bucket.green
            const db = cluster.blue - bucket.blue
            return dr * dr + dg * dg + db * db < 70 * 70
          })
          if (hit) {
            const total = hit.count + bucket.count
            hit.red = (hit.red * hit.count + bucket.red * bucket.count) / total
            hit.green = (hit.green * hit.count + bucket.green * bucket.count) / total
            hit.blue = (hit.blue * hit.count + bucket.blue * bucket.count) / total
            hit.count = total
            return
          }
          clusters.push({
            red: bucket.red,
            green: bucket.green,
            blue: bucket.blue,
            count: bucket.count,
            hex: '',
            rgb: '',
            percent: '',
          })
        })

        const colors = clusters.slice(0, 5).map((cluster) => {
          const red = Math.round(cluster.red)
          const green = Math.round(cluster.green)
          const blue = Math.round(cluster.blue)
          return {
            ...cluster,
            red,
            green,
            blue,
            hex: `#${toHex(red)}${toHex(green)}${toHex(blue)}`,
            rgb: rgbText(red, green, blue),
            percent: `${((cluster.count / sampled) * 100).toFixed(1)}%`,
          }
        })

        const averageRed = sumRed / sampled
        const averageGreen = sumGreen / sampled
        const averageBlue = sumBlue / sampled
        resolve({
          dominant: colors[0],
          averageHex: `#${toHex(averageRed)}${toHex(averageGreen)}${toHex(averageBlue)}`,
          averageRgb: rgbText(averageRed, averageGreen, averageBlue),
          colors,
        })
      } catch (error) {
        reject(error instanceof Error ? error : new Error('取色失败'))
      }
    }
    image.onerror = () => {
      reject(new Error('图片解码失败，请换一张 JPG/PNG'))
    }
    image.src = path
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
    toolName: '图片取色',
    kicker: '图片处理',
    desc: '提取主色与五色色板',
    imagePath: '',
    imageMeta: '',
    analyzing: false,
    hasResult: false,
    error: '',
    dominantHex: '',
    dominantRgb: '',
    averageHex: '',
    averageRgb: '',
    colors: [] as PaletteColor[],
    colorCount: 0,
    dominantPercent: 0,
    posterData: null as IPosterData | null,
  },

  onLoad() {
    const state = this as unknown as PaletteState
    state.destroyed = false
  },

  onUnload() {
    const state = this as unknown as PaletteState
    state.destroyed = true
    unlinkQuietly(this.data.imagePath)
  },

  async onChoose() {
    if (this.data.analyzing) {
      return
    }
    const state = this as unknown as PaletteState
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
      await this.analyzeImage(
        image.path,
        `${image.width} × ${image.height} · ${formatBytes(image.size)}`,
      )
    } catch (error) {
      if (state.destroyed) {
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      this.setData({ analyzing: false, hasResult: false, error: message })
    }
  },

  /**
   * 取色执行段：选图与 Workflow 注入共用
   * - 只负责分析、结果落位与错误兜底，不改变原取色算法
   */
  async analyzeImage(path: string, metaText: string): Promise<boolean> {
    if (!path) {
      return false
    }
    const state = this as unknown as PaletteState
    try {
      this.setData({
        imagePath: path,
        imageMeta: metaText,
        analyzing: true,
        hasResult: false,
        error: '',
      })
      const palette = await extractPalette(path)
      if (state.destroyed) {
        return false
      }
      const poster: IPosterData = {
        toolName: '图片取色',
        category: '图片处理',
        mainResult: palette.dominant.hex,
        resultLabel: `图片主色 · ${palette.dominant.percent}`,
        params: [
          { label: '主色 RGB', value: palette.dominant.rgb },
          { label: '色板数量', value: `${palette.colors.length} 色` },
        ],
        extras: [
          `平均色 ${palette.averageHex}`,
          `平均 RGB ${palette.averageRgb}`,
          `色板 ${palette.colors.map((color) => color.hex).join(' ')}`,
        ],
      }
      this.setData({
        analyzing: false,
        hasResult: true,
        dominantHex: palette.dominant.hex,
        dominantRgb: palette.dominant.rgb,
        averageHex: palette.averageHex,
        averageRgb: palette.averageRgb,
        colors: palette.colors,
        colorCount: palette.colors.length,
        dominantPercent: Number.parseFloat(palette.dominant.percent) || 0,
        posterData: poster,
      })
      return true
    } catch (error) {
      if (!state.destroyed) {
        const message = error instanceof Error ? error.message : String(error)
        this.setData({ analyzing: false, hasResult: false, error: message })
      }
      return false
    }
  },

  /**
   * Workflow 接收接口：图片已在流转层 saveFile 固化
   * 直接复用 analyzeImage，不重复选图、不改取色算法
   */
  async onReceiveWorkflow(data: IWorkflowData): Promise<boolean> {
    if (!data || data.type !== 'image' || typeof data.payload !== 'string' || !data.payload) {
      return false
    }
    if (this.data.analyzing) {
      return false
    }
    return this.analyzeImage(data.payload, '来自流转 · 本机取色')
  },

  onCopyColor(event: WechatMiniprogram.TouchEvent) {
    const hex = event.currentTarget.dataset.hex as string
    if (!hex) {
      return
    }
    copyText(hex, `${hex} 已复制`)
  },

  onExample() {
    this.onChoose()
  },

  onReset() {
    if (this.data.analyzing) {
      toast('正在分析，请稍候')
      return
    }
    unlinkQuietly(this.data.imagePath)
    this.setData({
      imagePath: '',
      imageMeta: '',
      analyzing: false,
      hasResult: false,
      error: '',
      dominantHex: '',
      dominantRgb: '',
      averageHex: '',
      averageRgb: '',
      colors: [],
      colorCount: 0,
      dominantPercent: 0,
    })
  },
})
