/* ==========================================================================
   二维码识别 · 相册单图解码
   - 选图后绘制到隐藏 Canvas → RGBA → 本机纯 JS 解码
   - 结果只展示与复制；链接不自动打开
   - 超过 2000 字仅截断展示，复制保留全文
   ========================================================================== */
import { tapTick } from '../../../../core/utils/haptics'
import { LIMITS } from '../../../../core/constants/index'
import { isDevtools } from '../../../../core/utils/platform'
import {
  chooseSingleImage,
  formatBytes,
  getImageInfo,
} from '../../lib/image'
import { selectCanvasNode, unlinkQuietly } from '../../lib/canvas'
import {
  decodeImageData,
  qrDecodeSize,
  qrDisplayText,
  qrIsExternalLink,
  qrKindLabel,
} from '../../lib/qrdecode'
import { copyText, toast } from '../../lib/ui'
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

interface DecodeState {
  destroyed: boolean
  renderSeq: number
}

Page({
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: '二维码识别',
    kicker: '图片处理',
    desc: '相册单图 · 本机解码 · 只复制不打开',
    imagePath: '',
    imageWidth: 0,
    imageHeight: 0,
    sourceMeta: '',
    resultText: '',
    qrSummary: '',
    displayText: '',
    truncated: false,
    charCount: 0,
    kindLabel: '',
    resultRows: [] as ResultRow[],
    processing: false,
    hasResult: false,
    shellState: 'idle',
    error: '',
    devtools: IS_DEVTOOLS,
    canvasCss: CANVAS_CSS,
    posterData: null as IPosterData | null,
  },

  onLoad() {
    const state = this as unknown as DecodeState
    state.destroyed = false
    state.renderSeq = 0
  },

  onUnload() {
    const state = this as unknown as DecodeState
    state.destroyed = true
    state.renderSeq += 1
    this.cleanupFiles()
  },

  async onChoose() {
    const state = this as unknown as DecodeState
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
      /* 选图只做预览与清空旧结果；解码由用户点击「识别二维码」显式触发 */
      this.setData({
        ...this.emptyResult(),
        imagePath: image.path,
        imageWidth: width,
        imageHeight: height,
        sourceMeta: `${width} × ${height} · ${formatBytes(image.size)}`,
        processing: false,
        hasResult: false,
        shellState: 'idle',
        error: '',
        posterData: null,
      })
    } catch (error) {
      if (state.destroyed) {
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      this.setData({ error: message || '选择图片失败' })
    }
  },

  onRun() {
    if (!this.data.imagePath) {
      this.setData({ error: '请先从相册选择一张二维码图片' })
      return
    }
    void this.decode()
  },

  onReset() {
    const state = this as unknown as DecodeState
    state.renderSeq += 1
    this.cleanupFiles()
    this.setData({
      imagePath: '',
      imageWidth: 0,
      imageHeight: 0,
      sourceMeta: '',
      processing: false,
      hasResult: false,
      shellState: 'idle',
      error: '',
      posterData: null,
      ...this.emptyResult(),
    })
  },

  onPreview() {
    const path = this.data.imagePath
    if (!path) {
      return
    }
    wx.previewImage({
      current: path,
      urls: [path],
      fail: () => toast('预览失败，请重试'),
    })
  },

  async onCopy() {
    const text = this.data.resultText
    if (!text) {
      toast('没有可复制的内容')
      return
    }
    const message = qrIsExternalLink(text) ? '已复制，请在浏览器中打开' : '已复制'
    await copyText(text, message)
  },

  async decode() {
    const state = this as unknown as DecodeState
    if (state.destroyed) {
      return
    }
    if (this.data.devtools) {
      this.fail('开发者工具暂不支持 Skyline 画布，请扫码在真机预览')
      return
    }
    if (!this.data.imagePath) {
      this.fail('请先从相册选择一张二维码图片')
      return
    }
    const seq = ++state.renderSeq
    this.setData({ processing: true, shellState: 'running', error: '' })

    try {
      const canvas = await selectCanvasNode(this, '#qr-canvas')
      if (state.destroyed || seq !== state.renderSeq) {
        return
      }
      const target = qrDecodeSize(this.data.imageWidth, this.data.imageHeight)
      canvas.width = target.width
      canvas.height = target.height
      const ctx = canvas.getContext(
        '2d',
      ) as unknown as WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D | null
      if (!ctx) {
        throw new Error('画布上下文不可用')
      }
      /* 透明 PNG 先铺白底，避免透明像素被当成黑色模块 */
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, target.width, target.height)

      const image = canvas.createImage()
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('图片解码失败，请换一张 JPG / PNG'))
        image.src = this.data.imagePath
      })
      if (state.destroyed || seq !== state.renderSeq) {
        return
      }
      ctx.drawImage(image, 0, 0, target.width, target.height)
      const frame = ctx.getImageData(0, 0, target.width, target.height)
      const text = decodeImageData(frame.data, target.width, target.height)
      if (state.destroyed || seq !== state.renderSeq) {
        return
      }
      if (!text) {
        this.fail('未识别到二维码，请换一张更清晰、完整的图片')
        return
      }

      const shown = qrDisplayText(text)
      const kindLabel = qrKindLabel(text)
      const resultRows: ResultRow[] = [
        { k: '类型', v: kindLabel },
        { k: '字符数', v: `${text.length} 字` },
        { k: '来源', v: `${this.data.imageWidth} × ${this.data.imageHeight}` },
        { k: '处理', v: `${target.width} × ${target.height} · 本机` },
      ]
      const poster: IPosterData = {
        toolName: '二维码识别',
        category: '图片处理',
        mainResult: `${text.length} 字`,
        resultLabel: '识别文本长度',
        params: [{ label: '类型', value: kindLabel }],
        extras: [shown.truncated ? '已截断展示' : '完整展示'],
      }
      this.setData({
        processing: false,
        shellState: 'done',
        hasResult: true,
        resultText: text,
        qrSummary: text,
        displayText: shown.display,
        truncated: shown.truncated,
        charCount: text.length,
        kindLabel,
        resultRows,
        error: '',
        posterData: poster,
      })
    } catch (error) {
      if (state.destroyed || seq !== state.renderSeq) {
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      this.fail(message || '二维码识别失败')
    }
  },

  emptyResult() {
    return {
      resultText: '',
      qrSummary: '',
      displayText: '',
      truncated: false,
      charCount: 0,
      kindLabel: '',
      resultRows: [],
    }
  },

  fail(message: string) {
    this.setData({
      processing: false,
      shellState: 'invalid',
      hasResult: false,
      error: message,
      posterData: null,
      ...this.emptyResult(),
    })
  },

  cleanupFiles() {
    unlinkQuietly(this.data.imagePath)
  },
})
