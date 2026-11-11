/* ==========================================================================
   条形码生成 · CODE128B + 1-bit PNG
   - 不使用 Canvas：开发者工具与真机一致可用
   - 纯本机编码与写入，不上传、不读相册
   - 条码图不含人眼可读文字，原文在结果区展示并支持复制
   ========================================================================== */
import { tapTick } from '../../../../core/utils/haptics'
import { copyText, toast } from '../../lib/ui'
import { saveImageToAlbum } from '../../lib/image'
import { writePngFile } from '../../lib/png'
import { unlinkQuietly } from '../../lib/canvas'
import {
  BARCODE_ERROR_TEXT,
  BARCODE_MAX_CHARS,
  BARCODE_MODULE_WIDTHS,
  barcodePngBase64,
  encodeCode128B,
  type BarcodeModuleWidth,
} from '../../lib/barcode'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'

interface ResultRow {
  k: string
  v: string
}

interface BarcodeState {
  destroyed: boolean
}

const MODULE_OPTIONS: Array<{ key: BarcodeModuleWidth; label: string; hint: string }> = [
  { key: 2, label: '小', hint: '2px' },
  { key: 3, label: '标准', hint: '3px' },
  { key: 4, label: '大', hint: '4px' },
]

const SAMPLE = 'TBX-2026-001'

/** 生成序号：输入变化、重置、退出都会递增，过期写入结果直接丢弃 */
let barcodeRenderSeq = 0

function emptyResult() {
  return {
    outputPath: '',
    resultText: '',
    sizeText: '',
    resultRows: [] as ResultRow[],
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
    toolName: '条形码生成',
    kicker: '图片处理',
    desc: 'CODE128B · 数字字母 · 本机生成',
    content: '',
    canRun: false,
    maxChars: BARCODE_MAX_CHARS,
    moduleWidth: 3 as BarcodeModuleWidth,
    moduleOptions: MODULE_OPTIONS,
    saving: false,
    ...emptyResult(),
  },

  onLoad() {
    const state = this as unknown as BarcodeState
    state.destroyed = false
  },

  onUnload() {
    const state = this as unknown as BarcodeState
    state.destroyed = true
    barcodeRenderSeq += 1
    if (!this.data.saving) {
      unlinkQuietly(this.data.outputPath)
    }
  },

  onInput(event: WechatMiniprogram.Input) {
    const content = event.detail.value
    barcodeRenderSeq += 1
    if (!this.data.saving) {
      unlinkQuietly(this.data.outputPath)
    }
    this.setData({
      content,
      canRun: content.trim().length > 0,
      ...emptyResult(),
    })
  },

  onModule(event: WechatMiniprogram.TouchEvent) {
    if (this.data.saving || this.data.shellState === 'running') {
      return
    }
    const next = Number(event.currentTarget.dataset.key)
    if (
      !BARCODE_MODULE_WIDTHS.includes(next as BarcodeModuleWidth) ||
      next === this.data.moduleWidth
    ) {
      return
    }
    tapTick()
    this.setData({ moduleWidth: next as BarcodeModuleWidth }, () => {
      if (this.data.hasResult) {
        this.generate()
      }
    })
  },

  onExample() {
    if (this.data.saving || this.data.shellState === 'running') {
      toast('正在处理，请稍候')
      return
    }
    tapTick()
    this.setData(
      {
        content: SAMPLE,
        canRun: true,
        ...emptyResult(),
      },
      () => this.generate(),
    )
  },

  onReset() {
    if (this.data.shellState === 'running') {
      toast('正在生成，请稍候')
      return
    }
    if (this.data.saving) {
      toast('正在保存，请稍候')
      return
    }
    barcodeRenderSeq += 1
    unlinkQuietly(this.data.outputPath)
    this.setData({
      content: '',
      canRun: false,
      moduleWidth: 3 as BarcodeModuleWidth,
      ...emptyResult(),
    })
  },

  onRun() {
    this.generate()
  },

  onCopy() {
    if (!this.data.resultText) {
      return
    }
    tapTick()
    void copyText(this.data.resultText, '条码内容已复制')
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
    if (!path || this.data.saving || this.data.shellState === 'running') {
      return
    }
    const state = this as unknown as BarcodeState
    this.setData({ saving: true })
    saveImageToAlbum(path)
      .then((ok) => {
        if (state.destroyed) {
          return
        }
        this.setData({ saving: false })
        if (ok) {
          toast('条形码已保存到相册')
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
        /* 页面已销毁，或保存期间结果被替换：清理旧文件 */
        if (state.destroyed || this.data.outputPath !== path) {
          unlinkQuietly(path)
        }
      })
  },

  /** Workflow 注入：仅接受可编码的 ASCII 文本，编码失败返回 false 不污染页面 */
  onReceiveWorkflow(data: { type?: string; payload?: unknown }): boolean {
    if (!data || data.type !== 'text' || typeof data.payload !== 'string') {
      return false
    }
    if (this.data.saving || this.data.shellState === 'running') {
      return false
    }
    const encoded = encodeCode128B(data.payload)
    if (!encoded.ok) {
      return false
    }
    this.setData(
      {
        content: encoded.text,
        canRun: true,
        ...emptyResult(),
      },
      () => this.generate(),
    )
    return true
  },

  generate() {
    const state = this as unknown as BarcodeState
    if (state.destroyed || this.data.saving || this.data.shellState === 'running') {
      return
    }
    const encoded = encodeCode128B(this.data.content)
    if (!encoded.ok) {
      unlinkQuietly(this.data.outputPath)
      this.setData({
        ...emptyResult(),
        shellState: 'invalid',
        error: BARCODE_ERROR_TEXT[encoded.error],
        canRun: this.data.content.trim().length > 0,
      })
      return
    }
    const image = barcodePngBase64(encoded, this.data.moduleWidth)
    if (!image) {
      unlinkQuietly(this.data.outputPath)
      this.setData({
        ...emptyResult(),
        shellState: 'error',
        error: '条形码生成失败，请重试',
      })
      return
    }

    const seq = (barcodeRenderSeq += 1)
    const previous = this.data.outputPath
    this.setData({ shellState: 'running', hasResult: false, error: '' })

    writePngFile(image.base64, `tbx-barcode-${Date.now()}.png`)
      .then((path) => {
        if (state.destroyed || seq !== barcodeRenderSeq) {
          unlinkQuietly(path)
          return
        }
        const resultRows: ResultRow[] = [
          { k: '编码方式', v: 'CODE128B' },
          { k: '字符数', v: `${encoded.charCount} 字符` },
          { k: '校验位', v: `${encoded.checksum}` },
          { k: '条宽', v: `${image.moduleWidth} px` },
          { k: '图片尺寸', v: `${image.width} × ${image.height} px` },
        ]
        const extras = [
          `${encoded.charCount} 字符`,
          `校验位 ${encoded.checksum}`,
          `${image.width} × ${image.height} px`,
        ]
        const poster: IPosterData = {
          toolName: '条形码生成',
          category: '图片处理',
          mainResult: encoded.text,
          resultLabel: '条码内容',
          params: [
            { label: '编码', value: 'CODE128B' },
            { label: '条宽', value: `${image.moduleWidth} px` },
          ],
          extras,
        }
        this.setData({
          outputPath: path,
          resultText: encoded.text,
          sizeText: `${image.width} × ${image.height} px`,
          resultRows,
          hasResult: true,
          shellState: 'done',
          error: '',
          posterData: poster,
        })
        if (previous && previous !== path) {
          unlinkQuietly(previous)
        }
      })
      .catch((error) => {
        unlinkQuietly(previous)
        if (state.destroyed || seq !== barcodeRenderSeq) {
          return
        }
        const message = error instanceof Error ? error.message : String(error)
        this.setData({
          ...emptyResult(),
          shellState: 'error',
          error: `生成失败：${message}`,
        })
      })
  },
})
