/* ==========================================================================
   拼图与长图 · 2×2 / 3×3 / 竖排
   - 2–9 张图，统一单元尺寸，单 Canvas 串行绘制
   - 间距 0 / 8 / 16，背景白 / 黑 / 主题；输出长边 ≤4096
   - 解码失败跳过并提示；全部失败才中止
   ========================================================================== */
import { tapTick } from '../../../../core/utils/haptics'
import { uiStore } from '../../../../core/stores/ui'
import { isDevtools } from '../../../../core/utils/platform'
import {
  chooseImages,
  formatBytes,
  getFileSize,
  getImageInfo,
  saveImageToAlbum,
  type PickedImage,
} from '../../lib/image'
import { exportCanvas, selectCanvasNode, unlinkQuietly } from '../../lib/canvas'
import {
  COLLAGE_MAX_IMAGES,
  COLLAGE_MIN_IMAGES,
  collageDrawCount,
  collageLayout,
  collageSkipNotice,
  type CollageGap,
  type CollageTemplate,
} from '../../lib/collage'
import { toast } from '../../lib/ui'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'
import type { IWorkflowData } from '../../../../core/workflow/types'

const CANVAS_CSS = 300
const IS_DEVTOOLS = isDevtools()

type CollageBackground = 'white' | 'black' | 'theme'

interface CollageItem {
  id: number
  path: string
  width: number
  height: number
  sizeText: string
}

interface ResultRow {
  k: string
  v: string
}

interface CollageState {
  destroyed: boolean
  renderSeq: number
  nextId: number
}

const TEMPLATE_OPTIONS: Array<{ key: CollageTemplate; label: string }> = [
  { key: 'grid2', label: '2 × 2' },
  { key: 'grid3', label: '3 × 3' },
  { key: 'vertical', label: '竖排长图' },
]

const GAP_OPTIONS: CollageGap[] = [0, 8, 16]

const BACKGROUND_OPTIONS: Array<{ key: CollageBackground; label: string }> = [
  { key: 'white', label: '白底' },
  { key: 'black', label: '黑底' },
  { key: 'theme', label: '主题底色' },
]

function backgroundFill(key: CollageBackground): string {
  if (key === 'black') {
    return '#111111'
  }
  if (key === 'theme') {
    return uiStore.resolvedTheme === 'dark' ? '#0b0f1a' : '#f4f6fb'
  }
  return '#ffffff'
}

Page({
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: '拼图与长图',
    kicker: '图片处理',
    desc: '2×2 / 3×3 / 竖排 · 间距与背景',
    template: 'grid2' as CollageTemplate,
    templateOptions: TEMPLATE_OPTIONS,
    gap: 8 as CollageGap,
    gapOptions: GAP_OPTIONS,
    background: 'white' as CollageBackground,
    backgroundOptions: BACKGROUND_OPTIONS,
    selected: [] as CollageItem[],
    imageCount: 0,
    maxImages: COLLAGE_MAX_IMAGES,
    canvasCss: CANVAS_CSS,
    outputPath: '',
    outputTitle: '',
    outputSizeText: '',
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
    const state = this as unknown as CollageState
    state.destroyed = false
    state.renderSeq = 0
    state.nextId = 0
  },

  onUnload() {
    const state = this as unknown as CollageState
    state.destroyed = true
    state.renderSeq += 1
    this.cleanupFiles()
  },

  async onChoose() {
    if (this.data.saving) {
      toast('正在保存，请稍候')
      return
    }
    const state = this as unknown as CollageState
    const remain = COLLAGE_MAX_IMAGES - this.data.selected.length
    if (remain <= 0) {
      toast(`最多 ${COLLAGE_MAX_IMAGES} 张，请先移除一张`)
      return
    }
    tapTick()
    try {
      const images = await chooseImages(remain)
      if (state.destroyed || images.length === 0) {
        return
      }
      const items: CollageItem[] = []
      for (const image of images) {
        if (!image.width || !image.height) {
          const info = await getImageInfo(image.path)
          items.push(this.toItem(image, info.width, info.height))
        } else {
          items.push(this.toItem(image, image.width, image.height))
        }
      }
      if (state.destroyed) {
        for (const item of items) {
          unlinkQuietly(item.path)
        }
        return
      }
      const selected = [...this.data.selected, ...items].slice(0, COLLAGE_MAX_IMAGES)
      this.setData(
        {
          selected,
          imageCount: selected.length,
          error: '',
        },
        () => this.invalidateResult(),
      )
    } catch (error) {
      if (state.destroyed) {
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      this.setData({ error: message || '选择图片失败' })
    }
  },

  toItem(image: PickedImage, width: number, height: number): CollageItem {
    const state = this as unknown as CollageState
    state.nextId += 1
    return {
      id: state.nextId,
      path: image.path,
      width,
      height,
      sizeText: formatBytes(image.size),
    }
  },

  onRemove(event: WechatMiniprogram.TouchEvent) {
    if (this.data.saving) {
      return
    }
    const id = Number(event.currentTarget.dataset.id)
    const target = this.data.selected.find((item) => item.id === id)
    if (!target) {
      return
    }
    tapTick()
    /* 选图变化立即作废进行中的渲染，避免旧结果覆盖新状态 */
    const state = this as unknown as CollageState
    state.renderSeq += 1
    const selected = this.data.selected.filter((item) => item.id !== id)
    unlinkQuietly(target.path)
    this.setData({ selected, imageCount: selected.length, error: '' }, () =>
      this.invalidateResult(),
    )
  },

  onTemplate(event: WechatMiniprogram.TouchEvent) {
    const template = event.currentTarget.dataset.key as CollageTemplate
    if (!TEMPLATE_OPTIONS.some((item) => item.key === template) || template === this.data.template) {
      return
    }
    tapTick()
    this.setData({ template }, () => this.invalidateResult())
  },

  onGap(event: WechatMiniprogram.TouchEvent) {
    const gap = Number(event.currentTarget.dataset.gap) as CollageGap
    if (!GAP_OPTIONS.includes(gap) || gap === this.data.gap) {
      return
    }
    tapTick()
    this.setData({ gap }, () => this.invalidateResult())
  },

  onBackground(event: WechatMiniprogram.TouchEvent) {
    const background = event.currentTarget.dataset.key as CollageBackground
    if (!BACKGROUND_OPTIONS.some((item) => item.key === background) || background === this.data.background) {
      return
    }
    tapTick()
    this.setData({ background }, () => this.invalidateResult())
  },

  onRun() {
    if (this.data.selected.length < COLLAGE_MIN_IMAGES) {
      this.setData({ error: `至少选择 ${COLLAGE_MIN_IMAGES} 张图片` })
      return
    }
    void this.render()
  },

  onExample() {
    this.onChoose()
  },

  onReset() {
    if (this.data.saving) {
      toast('正在保存，请稍候')
      return
    }
    this.cleanupFiles()
    const state = this as unknown as CollageState
    state.renderSeq += 1
    this.setData({
      selected: [],
      imageCount: 0,
      outputPath: '',
      outputTitle: '',
      outputSizeText: '',
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
    const state = this as unknown as CollageState
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

  /** Workflow 注入单张图片：追加到已选列表，等待用户补齐第二张 */
  async onReceiveWorkflow(data: IWorkflowData): Promise<boolean> {
    if (!data || data.type !== 'image' || typeof data.payload !== 'string') {
      return false
    }
    const state = this as unknown as CollageState
    if (state.destroyed || this.data.selected.length >= COLLAGE_MAX_IMAGES) {
      return false
    }
    const payload = data.payload
    try {
      const info = await getImageInfo(payload)
      if (state.destroyed) {
        return false
      }
      const size = await getFileSize(payload)
      const item = this.toItem(
        { path: payload, size, width: info.width, height: info.height, fileType: 'image' },
        info.width,
        info.height,
      )
      const selected = [...this.data.selected, item].slice(0, COLLAGE_MAX_IMAGES)
      this.setData({ selected, imageCount: selected.length, error: '' }, () =>
        this.invalidateResult(),
      )
      return true
    } catch {
      return false
    }
  },

  async render() {
    const state = this as unknown as CollageState
    if (state.destroyed) {
      return
    }
    if (this.data.devtools) {
      this.fail('开发者工具暂不支持 Skyline 画布，请扫码在真机预览')
      return
    }
    const layout = collageLayout(this.data.template, this.data.selected.length, this.data.gap)
    if (!layout) {
      this.fail(`至少选择 ${COLLAGE_MIN_IMAGES} 张图片`)
      return
    }
    const drawCount = collageDrawCount(this.data.template, this.data.selected.length)
    const seq = ++state.renderSeq
    const previous = this.data.outputPath
    let created = ''
    this.setData({ processing: true, shellState: 'running', error: '' })

    try {
      const canvas = await selectCanvasNode(this, '#collage-canvas')
      if (state.destroyed || seq !== state.renderSeq) {
        return
      }
      canvas.width = layout.width
      canvas.height = layout.height
      const ctx = canvas.getContext(
        '2d',
      ) as unknown as WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D | null
      if (!ctx) {
        throw new Error('画布上下文不可用')
      }
      ctx.fillStyle = backgroundFill(this.data.background)
      ctx.fillRect(0, 0, layout.width, layout.height)

      let drawn = 0
      let skipped = 0
      for (let index = 0; index < drawCount; index += 1) {
        const item = this.data.selected[index]
        const cell = layout.cells[index]
        if (!item || !cell) {
          continue
        }
        try {
          const image = canvas.createImage()
          await new Promise<void>((resolve, reject) => {
            image.onload = () => resolve()
            image.onerror = () => reject(new Error('decode'))
            image.src = item.path
          })
          if (state.destroyed || seq !== state.renderSeq) {
            return
          }
          const side = Math.min(image.width, image.height)
          if (side <= 0) {
            skipped += 1
            continue
          }
          const sx = Math.floor((image.width - side) / 2)
          const sy = Math.floor((image.height - side) / 2)
          ctx.drawImage(image, sx, sy, side, side, cell.x, cell.y, cell.width, cell.height)
          drawn += 1
        } catch {
          skipped += 1
        }
      }
      if (drawn === 0) {
        throw new Error('所有图片都无法解码，请换一组 JPG / PNG')
      }

      const path = await exportCanvas(canvas, layout.width, layout.height, 'png', 1)
      created = path
      const bytes = await getFileSize(path)
      if (state.destroyed || seq !== state.renderSeq) {
        unlinkQuietly(path)
        return
      }

      const templateLabel =
        TEMPLATE_OPTIONS.find((item) => item.key === this.data.template)?.label ?? '2 × 2'
      const notice = collageSkipNotice(drawCount, skipped)
      const resultRows: ResultRow[] = [
        { k: '模板', v: templateLabel },
        { k: '画布', v: `${layout.width} × ${layout.height}` },
        { k: '间距', v: `${this.data.gap} px` },
        { k: '图片', v: `${drawn} / ${drawCount} 张` },
        { k: '体积', v: formatBytes(bytes) },
        { k: '格式', v: 'PNG' },
      ]
      const poster: IPosterData = {
        toolName: '拼图与长图',
        category: '图片处理',
        mainResult: `${layout.width} × ${layout.height}`,
        resultLabel: '拼图尺寸',
        params: [
          { label: '模板', value: templateLabel },
          { label: '间距', value: `${this.data.gap} px` },
        ],
        extras: [`共 ${drawn} 张`, `体积 ${formatBytes(bytes)}`],
      }
      this.setData({
        processing: false,
        shellState: 'done',
        hasResult: true,
        outputPath: path,
        outputTitle: `${layout.width} × ${layout.height}`,
        outputSizeText: formatBytes(bytes),
        resultRows,
        error: notice,
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
      this.fail(message || '拼图生成失败')
    }
  },

  invalidateResult() {
    const state = this as unknown as CollageState
    /* 输入或参数变化：作废进行中的渲染，并清空与新输入不匹配的旧结果 */
    state.renderSeq += 1
    if (!this.data.hasResult && !this.data.processing && !this.data.outputPath) {
      return
    }
    this.resetResult()
  },

  resetResult() {
    const previous = this.data.outputPath
    if (previous) {
      unlinkQuietly(previous)
    }
    this.setData({
      processing: false,
      hasResult: false,
      shellState: 'idle',
      outputPath: '',
      outputTitle: '',
      outputSizeText: '',
      resultRows: [],
      error: '',
      posterData: null,
    })
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
      resultRows: [],
      error: message,
      posterData: null,
    })
  },

  cleanupFiles() {
    const previous = this.data.outputPath
    if (previous && !this.data.saving) {
      unlinkQuietly(previous)
    }
    for (const item of this.data.selected) {
      unlinkQuietly(item.path)
    }
  },
})
