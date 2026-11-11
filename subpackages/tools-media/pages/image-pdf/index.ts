/* ==========================================================================
   图片转 PDF · 1–9 张 · A4 / Letter / 原图
   - PNG 统一白底转 JPEG，丢弃透明通道；只嵌入 JPEG
   - 超 2MB 自动降低质量 / 长边重试，仍超限则拒绝
   - 写入 USER_DATA_PATH/exports，openDocument 预览，退出清理
   ========================================================================== */
import { tapTick } from '../../../../core/utils/haptics'
import { isDevtools } from '../../../../core/utils/platform'
import {
  chooseImages,
  formatBytes,
  getFileSize,
  getImageInfo,
  type PickedImage,
} from '../../lib/image'
import { exportCanvas, selectCanvasNode, unlinkQuietly } from '../../lib/canvas'
import {
  PDF_MAX_PAGES,
  buildImagePdf,
  jpegSize,
  type PdfJpegPage,
  type PdfPageSize,
} from '../../lib/pdf'
import { toast } from '../../lib/ui'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'
import type { IWorkflowData } from '../../../../core/workflow/types'

const CANVAS_CSS = 300
const IS_DEVTOOLS = isDevtools()
const MAX_PIXELS = 60000000

type PdfItem = {
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

interface PdfState {
  destroyed: boolean
  renderSeq: number
  nextId: number
  tempFiles: string[]
}

const PAGE_SIZE_OPTIONS: Array<{ key: PdfPageSize; label: string }> = [
  { key: 'a4', label: 'A4' },
  { key: 'letter', label: 'Letter' },
  { key: 'original', label: '原图' },
]

const PRESETS = [
  { quality: 90, maxEdge: 1600 },
  { quality: 75, maxEdge: 1280 },
  { quality: 60, maxEdge: 1024 },
]

function pageSizeLabel(size: PdfPageSize): string {
  return PAGE_SIZE_OPTIONS.find((item) => item.key === size)?.label ?? 'A4'
}

function ensureExportDir(): string {
  const dir = `${wx.env.USER_DATA_PATH}/exports`
  const manager = wx.getFileSystemManager()
  try {
    manager.accessSync(dir)
  } catch {
    try {
      manager.mkdirSync(dir, true)
    } catch {
      /* 已存在或并发创建，写入阶段再兜底 */
    }
  }
  return dir
}

Page({
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: '图片转 PDF',
    kicker: '图片处理',
    desc: '1–9 图 · A4 / Letter · 本机生成',
    pageSize: 'a4' as PdfPageSize,
    pageSizeLabel: 'A4',
    pageSizeOptions: PAGE_SIZE_OPTIONS,
    selected: [] as PdfItem[],
    imageCount: 0,
    maxImages: PDF_MAX_PAGES,
    canvasCss: CANVAS_CSS,
    outputPath: '',
    outputSizeText: '',
    pageCountText: '',
    resultRows: [] as ResultRow[],
    processing: false,
    hasResult: false,
    shellState: 'idle',
    error: '',
    devtools: IS_DEVTOOLS,
    posterData: null as IPosterData | null,
  },

  onLoad() {
    const state = this as unknown as PdfState
    state.destroyed = false
    state.renderSeq = 0
    state.nextId = 0
    state.tempFiles = []
  },

  onUnload() {
    const state = this as unknown as PdfState
    state.destroyed = true
    state.renderSeq += 1
    this.cleanupFiles()
  },

  async onChoose() {
    const state = this as unknown as PdfState
    const remain = PDF_MAX_PAGES - this.data.selected.length
    if (remain <= 0) {
      toast(`最多 ${PDF_MAX_PAGES} 张，请先移除一张`)
      return
    }
    tapTick()
    try {
      const images = await chooseImages(remain)
      if (state.destroyed || images.length === 0) {
        return
      }
      const items: PdfItem[] = []
      for (const image of images) {
        if (!image.width || !image.height) {
          const info = await getImageInfo(image.path)
          items.push(this.toItem(image, info.width, info.height))
        } else {
          items.push(this.toItem(image, image.width, image.height))
        }
      }
      if (state.destroyed) {
        items.forEach((item) => unlinkQuietly(item.path))
        return
      }
      const selected = [...this.data.selected, ...items].slice(0, PDF_MAX_PAGES)
      this.setData({ selected, imageCount: selected.length, error: '' }, () =>
        this.invalidateResult(),
      )
    } catch (error) {
      if (state.destroyed) {
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      this.setData({ error: message || '选择图片失败' })
    }
  },

  toItem(image: PickedImage, width: number, height: number): PdfItem {
    const state = this as unknown as PdfState
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
    if (this.data.processing) {
      return
    }
    const id = Number(event.currentTarget.dataset.id)
    const target = this.data.selected.find((item) => item.id === id)
    if (!target) {
      return
    }
    tapTick()
    const state = this as unknown as PdfState
    state.renderSeq += 1
    const selected = this.data.selected.filter((item) => item.id !== id)
    unlinkQuietly(target.path)
    this.setData({ selected, imageCount: selected.length, error: '' }, () =>
      this.invalidateResult(),
    )
  },

  onPageSize(event: WechatMiniprogram.TouchEvent) {
    const size = event.currentTarget.dataset.key as PdfPageSize
    if (!PAGE_SIZE_OPTIONS.some((item) => item.key === size) || size === this.data.pageSize) {
      return
    }
    tapTick()
    this.setData({ pageSize: size, pageSizeLabel: pageSizeLabel(size) }, () =>
      this.invalidateResult(),
    )
  },

  onRun() {
    if (this.data.selected.length === 0) {
      this.setData({ error: '请先选择 1–9 张图片' })
      return
    }
    void this.render()
  },

  onExample() {
    this.onChoose()
  },

  onReset() {
    if (this.data.processing) {
      return
    }
    this.cleanupFiles()
    const state = this as unknown as PdfState
    state.renderSeq += 1
    this.setData({
      selected: [],
      imageCount: 0,
      pageSize: 'a4',
      pageSizeLabel: 'A4',
      ...this.emptyResult(),
    })
  },

  onPreview() {
    if (!this.data.outputPath) {
      return
    }
    wx.openDocument({
      filePath: this.data.outputPath,
      fileType: 'pdf',
      showMenu: true,
      fail: () => toast('当前环境无法预览 PDF，请稍后重试'),
    })
  },

  /** Workflow 注入单张图片：追加一页 */
  async onReceiveWorkflow(data: IWorkflowData): Promise<boolean> {
    if (!data || data.type !== 'image' || typeof data.payload !== 'string') {
      return false
    }
    const state = this as unknown as PdfState
    if (state.destroyed || this.data.selected.length >= PDF_MAX_PAGES) {
      return false
    }
    const payload = data.payload
    try {
      const info = await getImageInfo(payload)
      const size = await getFileSize(payload)
      if (state.destroyed) {
        return false
      }
      const item = this.toItem(
        { path: payload, size, width: info.width, height: info.height, fileType: 'image' },
        info.width,
        info.height,
      )
      const selected = [...this.data.selected, item].slice(0, PDF_MAX_PAGES)
      this.setData({ selected, imageCount: selected.length, error: '' }, () =>
        this.invalidateResult(),
      )
      return true
    } catch {
      return false
    }
  },

  emptyResult() {
    return {
      outputPath: '',
      outputSizeText: '',
      pageCountText: '',
      resultRows: [] as ResultRow[],
      hasResult: false,
      shellState: 'idle',
      error: '',
      posterData: null as IPosterData | null,
    }
  },

  invalidateResult() {
    const state = this as unknown as PdfState
    /* 输入或页面尺寸变化：作废进行中的渲染，并清空与新输入不匹配的旧结果 */
    state.renderSeq += 1
    if (!this.data.hasResult && !this.data.processing && !this.data.outputPath) {
      return
    }
    this.cleanupFiles()
    this.setData({ ...this.emptyResult(), processing: false })
  },

  cleanupTempFiles() {
    const state = this as unknown as PdfState
    state.tempFiles.splice(0).forEach((path) => unlinkQuietly(path))
  },

  cleanupFiles() {
    if (this.data.outputPath) {
      unlinkQuietly(this.data.outputPath)
    }
    this.cleanupTempFiles()
  },

  readFileBytes(filePath: string): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      wx.getFileSystemManager().readFile({
        filePath,
        success: (result) => {
          if (result.data instanceof ArrayBuffer) {
            resolve(new Uint8Array(result.data))
            return
          }
          reject(new Error('读取图片字节失败'))
        },
        fail: (error) => reject(new Error(error.errMsg || '读取图片失败')),
      })
    })
  },

  writePdf(bytes: Uint8Array): Promise<string> {
    const dir = ensureExportDir()
    const filePath = `${dir}/image-pdf-${Date.now()}.pdf`
    const buffer = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(buffer).set(bytes)
    return new Promise((resolve, reject) => {
      wx.getFileSystemManager().writeFile({
        filePath,
        data: buffer,
        success: () => resolve(filePath),
        fail: (error) => reject(new Error(error.errMsg || '写入 PDF 失败')),
      })
    })
  },

  async toJpeg(
    canvas: WechatMiniprogram.Canvas,
    item: PdfItem,
    quality: number,
    maxEdge: number,
  ): Promise<{ data: Uint8Array; width: number; height: number }> {
    if (item.width * item.height > MAX_PIXELS) {
      throw new Error('图片像素过大，请先压缩后再试')
    }
    const scale = Math.min(1, maxEdge / Math.max(item.width, item.height))
    const width = Math.max(1, Math.round(item.width * scale))
    const height = Math.max(1, Math.round(item.height * scale))
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d') as unknown as {
      fillStyle: string
      fillRect(x: number, y: number, w: number, h: number): void
      drawImage(image: unknown, x: number, y: number, w: number, h: number): void
    } | null
    if (!ctx) {
      throw new Error('画布上下文不可用')
    }
    const image = canvas.createImage()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('图片解码失败，请换一张 JPG/PNG'))
      image.src = item.path
    })
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(image, 0, 0, width, height)
    const tempPath = await exportCanvas(canvas, width, height, 'jpeg', quality)
    const state = this as unknown as PdfState
    state.tempFiles.push(tempPath)
    const data = await this.readFileBytes(tempPath)
    const info = jpegSize(data)
    if (!info) {
      throw new Error('JPEG 编码失败，请更换图片')
    }
    return { data, width: info.width, height: info.height }
  },

  async render() {
    const state = this as unknown as PdfState
    if (state.destroyed) {
      return
    }
    if (this.data.devtools) {
      this.fail('开发者工具暂不支持 Skyline 画布，请扫码在真机预览')
      return
    }
    if (this.data.selected.length === 0) {
      this.fail('请先选择 1–9 张图片')
      return
    }
    const seq = ++state.renderSeq
    this.setData({ processing: true, shellState: 'running', error: '' })

    try {
      const canvas = await selectCanvasNode(this, '#pdf-canvas')
      if (state.destroyed || seq !== state.renderSeq) {
        return
      }
      let pdf: Uint8Array | null = null
      for (const preset of PRESETS) {
        const pages: PdfJpegPage[] = []
        for (const item of this.data.selected) {
          const page = await this.toJpeg(canvas, item, preset.quality, preset.maxEdge)
          if (state.destroyed || seq !== state.renderSeq) {
            return
          }
          pages.push(page)
        }
        pdf = buildImagePdf(pages, this.data.pageSize)
        if (pdf) {
          break
        }
      }
      this.cleanupTempFiles()
      if (!pdf) {
        throw new Error('PDF 超过 2MB 或图片格式不受支持，请减少图片或换用 JPG')
      }
      const outputPath = await this.writePdf(pdf)
      if (state.destroyed || seq !== state.renderSeq) {
        unlinkQuietly(outputPath)
        return
      }
      const previous = this.data.outputPath
      if (previous && previous !== outputPath) {
        unlinkQuietly(previous)
      }
      const sizeText = formatBytes(pdf.length)
      const count = this.data.selected.length
      const sizeLabel = pageSizeLabel(this.data.pageSize)
      const poster: IPosterData = {
        toolName: '图片转 PDF',
        category: '图片处理',
        mainResult: `${count} 页`,
        resultLabel: 'PDF 已生成',
        params: [
          { label: '页面', value: sizeLabel },
          { label: '体积', value: sizeText },
        ],
        extras: [`${count} 张图片`, '本机生成'],
      }
      this.setData({
        outputPath,
        outputSizeText: sizeText,
        pageCountText: `${count} 页`,
        resultRows: [
          { k: '页数', v: `${count} 页` },
          { k: '体积', v: sizeText },
          { k: '页面尺寸', v: sizeLabel },
          { k: '页数上限', v: `${PDF_MAX_PAGES} 页` },
        ],
        processing: false,
        hasResult: true,
        shellState: 'done',
        error: '',
        posterData: poster,
      })
      wx.openDocument({
        filePath: outputPath,
        fileType: 'pdf',
        showMenu: true,
        fail: () => toast('PDF 已生成，当前环境无法预览'),
      })
    } catch (error) {
      if (state.destroyed || seq !== state.renderSeq) {
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      this.fail(message || '生成 PDF 失败')
    }
  },

  fail(message: string) {
    this.cleanupTempFiles()
    this.setData({
      ...this.emptyResult(),
      processing: false,
      shellState: 'invalid',
      error: message,
    })
  },
})
