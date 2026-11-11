/* ==========================================================================
   图片信息 · 尺寸 / 体积 / 格式 / 方向
   - 相册单图，只读元信息；不解析 GPS / 设备 / 拍摄时间
   - 选图或 Workflow 注入后自动读取
   ========================================================================== */
import { tapTick } from '../../../../core/utils/haptics'
import { copyText, toast } from '../../lib/ui'
import { chooseSingleImage } from '../../lib/image'
import {
  exifSummary,
  readImageMeta,
  type ImageMeta,
} from '../../lib/exif'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'

interface ResultRow {
  k: string
  v: string
}

interface ExifState {
  destroyed: boolean
}

/** 读取序号：重新选图 / 重置 / 退出时递增，过期结果直接丢弃 */
let exifReadSeq = 0

function emptyResult() {
  return {
    fileName: '',
    widthText: '',
    typeLabel: '',
    sizeText: '',
    ratioText: '',
    megapixelsText: '',
    orientationLabel: '',
    resultRows: [] as ResultRow[],
    exifSummary: '',
    reading: false,
    hasResult: false,
    shellState: 'idle' as string,
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
    toolName: '图片信息',
    kicker: '图片处理',
    desc: '尺寸 / 体积 / 格式 / 方向 · 本机读取',
    imagePath: '',
    ...emptyResult(),
  },

  onLoad() {
    const state = this as unknown as ExifState
    state.destroyed = false
  },

  onUnload() {
    const state = this as unknown as ExifState
    state.destroyed = true
    exifReadSeq += 1
  },

  async onChoose() {
    if (this.data.reading) {
      toast('正在读取，请稍候')
      return
    }
    const state = this as unknown as ExifState
    tapTick()
    try {
      const image = await chooseSingleImage()
      if (state.destroyed || !image) {
        return
      }
      exifReadSeq += 1
      this.setData({ imagePath: image.path, ...emptyResult() }, () => {
        void this.analyze()
      })
    } catch (error) {
      if (state.destroyed) {
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      this.setData({
        ...emptyResult(),
        shellState: 'error',
        error: message || '选择图片失败',
      })
    }
  },

  onExample() {
    this.onChoose()
  },

  onRun() {
    const path = this.data.imagePath
    if (!path) {
      this.setData({ shellState: 'invalid', error: '请先选择一张图片' })
      return
    }
    void this.analyze()
  },

  onReset() {
    exifReadSeq += 1
    this.setData({ imagePath: '', ...emptyResult() })
  },

  onCopy() {
    if (!this.data.exifSummary) {
      return
    }
    tapTick()
    void copyText(this.data.exifSummary, '图片信息已复制')
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

  /** Workflow 注入：只接受图片路径，读取失败不污染页面 */
  onReceiveWorkflow(data: { type?: string; payload?: unknown }): boolean {
    if (!data || data.type !== 'image' || typeof data.payload !== 'string') {
      return false
    }
    const path = data.payload.trim()
    if (!path || this.data.reading) {
      return false
    }
    exifReadSeq += 1
    this.setData({ imagePath: path, ...emptyResult() }, () => {
      void this.analyze()
    })
    return true
  },

  async analyze(): Promise<boolean> {
    const state = this as unknown as ExifState
    const path = this.data.imagePath
    if (state.destroyed || !path || this.data.reading) {
      return false
    }
    const seq = (exifReadSeq += 1)
    this.setData({ reading: true, shellState: 'running', hasResult: false, error: '' })
    try {
      const meta: ImageMeta = await readImageMeta(path)
      if (state.destroyed || seq !== exifReadSeq) {
        return false
      }
      this.render(meta)
      return true
    } catch (error) {
      if (state.destroyed || seq !== exifReadSeq) {
        return false
      }
      const message = error instanceof Error ? error.message : String(error)
      this.setData({
        ...emptyResult(),
        shellState: 'error',
        error: message || '图片读取失败，请重试',
      })
      return false
    }
  },

  render(meta: ImageMeta) {
    const resultRows: ResultRow[] = [
      { k: '文件名', v: meta.fileName },
      { k: '格式', v: meta.typeLabel },
      { k: '尺寸', v: meta.widthText },
      { k: '体积', v: meta.sizeText },
      { k: '宽高比', v: meta.ratioText },
      { k: '像素', v: meta.megapixelsText },
      { k: '方向', v: meta.orientationLabel },
    ]
    const extras = [
      `方向 ${meta.orientationLabel}`,
      `宽高比 ${meta.ratioText}`,
      meta.megapixelsText,
      `文件 ${meta.fileName}`,
    ]
    const poster: IPosterData = {
      toolName: '图片信息',
      category: '图片处理',
      mainResult: meta.widthText,
      resultLabel: '图片尺寸',
      params: [
        { label: '格式', value: meta.typeLabel },
        { label: '体积', value: meta.sizeText },
      ],
      extras,
    }
    this.setData({
      fileName: meta.fileName,
      widthText: meta.widthText,
      typeLabel: meta.typeLabel,
      sizeText: meta.sizeText,
      ratioText: meta.ratioText,
      megapixelsText: meta.megapixelsText,
      orientationLabel: meta.orientationLabel,
      resultRows,
      exifSummary: exifSummary(meta),
      reading: false,
      hasResult: true,
      shellState: 'done',
      error: '',
      posterData: poster,
    })
  },
})
