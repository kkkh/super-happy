/* ==========================================================================
   二维码名片 · vCard 3.0 + 二维码 + 图片名片
   - 不读取通讯录、不申请联系人权限；名片只在本机生成
   - 复用 qrcode.ts + png.ts；整段 ≤1000 字节，二维码纠错等级 M
   - 图片名片由 lib/card.ts 离屏绘制，1080 × 672，可保存相册
   ========================================================================== */
import qrcodeFactory from '../../lib/qrcode'
import { qrPngBase64, writePngFile } from '../../lib/png'
import { copyText, toast } from '../../lib/ui'
import { tapTick } from '../../../../core/utils/haptics'
import { saveImageToAlbum } from '../../lib/image'
import { buildVCard } from '../../lib/vcard'
import {
  CARD_CSS_HEIGHT,
  CARD_CSS_WIDTH,
  CARD_HEIGHT,
  CARD_WIDTH,
  drawVCardCard,
} from '../../lib/card'
import { exportCanvas, selectCanvasNode } from '../../lib/canvas'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'

interface QrCode {
  addData(data: string): void
  make(maskPattern?: number): void
  getModuleCount(): number
  isDark(row: number, col: number): boolean
}

interface QrFactory {
  (typeNumber: number, level: string): QrCode
  stringToBytes: (text: string) => number[]
  stringToBytesFuncs: Record<string, (text: string) => number[]>
}

const qrcodeLib = qrcodeFactory as unknown as QrFactory
qrcodeLib.stringToBytes = qrcodeLib.stringToBytesFuncs['UTF-8']
const qrcode = qrcodeLib

interface ResultRow {
  k: string
  v: string
}

interface VCardState {
  destroyed: boolean
  saving: boolean
  savingCard: boolean
  seq: number
}

interface QrRender {
  matrix: boolean[][]
  count: number
}

let renderSeq = 0

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

function makeQr(content: string): QrRender {
  const code = qrcode(0, 'M')
  code.addData(content)
  code.make(0)
  const count = code.getModuleCount()
  if (count <= 0) {
    throw new Error('无法生成二维码矩阵')
  }
  const matrix: boolean[][] = []
  for (let row = 0; row < count; row += 1) {
    const line: boolean[] = []
    for (let col = 0; col < count; col += 1) {
      line.push(code.isDark(row, col))
    }
    matrix.push(line)
  }
  return { matrix, count }
}

function makeQrImage(render: QrRender): Promise<string> {
  const scale = Math.max(4, Math.round(280 / (render.count + 8)))
  const base64 = qrPngBase64(render.matrix, render.count, scale, 4)
  return writePngFile(base64, `tbx-vcard-${Date.now()}.png`)
}

Page({
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: '二维码名片',
    kicker: '职场辅助',
    desc: 'vCard 3.0 · 二维码 · 本机生成',
    name: '',
    company: '',
    title: '',
    phone: '',
    email: '',
    address: '',
    website: '',
    note: '',
    shellState: 'idle',
    hasResult: false,
    error: '',
    vcardText: '',
    vcardBytes: 0,
    qrImagePath: '',
    cardImagePath: '',
    cardCssWidth: CARD_CSS_WIDTH,
    cardCssHeight: CARD_CSS_HEIGHT,
    resultRows: [] as ResultRow[],
    vcardSummary: '',
    saving: false,
    savingCard: false,
    posterData: null as IPosterData | null,
  },

  onLoad() {
    const state = this as unknown as VCardState
    state.destroyed = false
    state.saving = false
    state.savingCard = false
    state.seq = 0
  },

  onUnload() {
    const state = this as unknown as VCardState
    state.destroyed = true
    renderSeq += 1
    if (!state.saving) {
      unlinkQuietly(this.data.qrImagePath)
    }
    if (!state.savingCard) {
      unlinkQuietly(this.data.cardImagePath)
    }
  },

  onFieldInput(event: WechatMiniprogram.Input) {
    const field = String(event.currentTarget.dataset.field || '')
    if (!field) {
      return
    }
    const previousQr = this.data.qrImagePath
    const previousCard = this.data.cardImagePath
    const saving = this.data.saving
    const savingCard = this.data.savingCard
    renderSeq += 1
    this.setData({
      [field]: String(event.detail.value || ''),
      hasResult: false,
      qrImagePath: '',
      cardImagePath: '',
      error: '',
      shellState: 'idle',
    })
    if (!saving) {
      unlinkQuietly(previousQr)
    }
    if (!savingCard) {
      unlinkQuietly(previousCard)
    }
  },

  onExample() {
    tapTick()
    this.setData(
      {
        name: '秦超',
        company: '超欢',
        title: '独立开发者',
        phone: '13800000000',
        email: '56967916@qq.com',
        address: '杭州市西湖区',
        website: 'https://example.com',
        note: '扫码保存联系人',
      },
      () => this.generate(),
    )
  },

  onReset() {
    if (this.data.shellState === 'running' || this.data.saving || this.data.savingCard) {
      toast('正在处理，请稍候')
      return
    }
    renderSeq += 1
    unlinkQuietly(this.data.qrImagePath)
    unlinkQuietly(this.data.cardImagePath)
    this.setData({
      name: '',
      company: '',
      title: '',
      phone: '',
      email: '',
      address: '',
      website: '',
      note: '',
      shellState: 'idle',
      hasResult: false,
      error: '',
      vcardText: '',
      vcardBytes: 0,
      qrImagePath: '',
      cardImagePath: '',
      resultRows: [],
      vcardSummary: '',
      savingCard: false,
      posterData: null,
    })
  },

  onRun() {
    this.generate()
  },

  onCopyText() {
    if (!this.data.vcardText) {
      return
    }
    tapTick()
    copyText(this.data.vcardText, 'vCard 已复制')
  },

  onPreview() {
    if (!this.data.qrImagePath) {
      return
    }
    wx.previewImage({
      current: this.data.qrImagePath,
      urls: [this.data.qrImagePath],
      fail: () => toast('预览失败，请重试'),
    })
  },

  onSave() {
    if (!this.data.qrImagePath || this.data.saving) {
      return
    }
    const state = this as unknown as VCardState
    const target = this.data.qrImagePath
    state.saving = true
    this.setData({ saving: true })
    saveImageToAlbum(target)
      .then((ok) => {
        if (state.destroyed) {
          return
        }
        state.saving = false
        this.setData({ saving: false })
        if (ok) {
          toast('名片二维码已保存到相册')
        }
      })
      .catch(() => {
        if (state.destroyed) {
          return
        }
        state.saving = false
        this.setData({ saving: false })
        toast('保存失败，请重试')
      })
      .finally(() => {
        if (state.destroyed || this.data.qrImagePath !== target) {
          unlinkQuietly(target)
        }
      })
  },

  onPreviewCard() {
    if (!this.data.cardImagePath) {
      return
    }
    wx.previewImage({
      current: this.data.cardImagePath,
      urls: [this.data.cardImagePath],
      fail: () => toast('预览失败，请重试'),
    })
  },

  onSaveCard() {
    if (!this.data.cardImagePath || this.data.savingCard) {
      return
    }
    const state = this as unknown as VCardState
    const target = this.data.cardImagePath
    state.savingCard = true
    this.setData({ savingCard: true })
    saveImageToAlbum(target)
      .then((ok) => {
        if (state.destroyed) {
          return
        }
        state.savingCard = false
        this.setData({ savingCard: false })
        if (ok) {
          toast('图片名片已保存到相册')
        }
      })
      .catch(() => {
        if (state.destroyed) {
          return
        }
        state.savingCard = false
        this.setData({ savingCard: false })
        toast('保存失败，请重试')
      })
      .finally(() => {
        if (state.destroyed || this.data.cardImagePath !== target) {
          unlinkQuietly(target)
        }
      })
  },

  generate() {
    if (this.data.shellState === 'running' || this.data.saving || this.data.savingCard) {
      return
    }
    const cardData = {
      name: this.data.name,
      company: this.data.company,
      title: this.data.title,
      phone: this.data.phone,
      email: this.data.email,
      address: this.data.address,
      website: this.data.website,
      note: this.data.note,
    }
    const result = buildVCard(cardData)
    if (!result.ok) {
      const message =
        result.code === 'name'
          ? '请输入姓名'
          : result.code === 'field'
            ? '单个字段最多 200 字符'
            : `名片内容 ${result.bytes} 字节，超过 1000 字节，请精简备注或地址`
      this.setData({ shellState: 'invalid', hasResult: false, error: message, posterData: null })
      return
    }
    let qr: QrRender
    try {
      qr = makeQr(result.text)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.setData({
        shellState: 'error',
        hasResult: false,
        error: `生成失败：${message}`,
        posterData: null,
      })
      return
    }

    const seq = (renderSeq += 1)
    const state = this as unknown as VCardState
    state.seq = seq
    const previousQr = this.data.qrImagePath
    const previousCard = this.data.cardImagePath
    const summary = `名片：${cardData.name.trim()} · ${cardData.company.trim() || '个人'}（${result.bytes} 字节）`
    const poster: IPosterData = {
      toolName: '二维码名片',
      category: '职场辅助',
      mainResult: `${result.bytes} 字节`,
      resultLabel: 'vCard 体积',
      params: [
        { label: '姓名', value: cardData.name.trim() },
        { label: '公司', value: cardData.company.trim() || '—' },
      ],
      extras: ['vCard 3.0', '图片名片 1080 × 672', '二维码纠错 M'],
    }

    this.setData(
      {
        shellState: 'running',
        hasResult: true,
        error: '',
        vcardText: result.text,
        vcardBytes: result.bytes,
        qrImagePath: '',
        cardImagePath: '',
        vcardSummary: summary,
        resultMain: '正在生成图片名片…',
        resultRows: [
          { k: '体积', v: `${result.bytes} 字节 / 1000` },
          { k: '图片名片', v: '1080 × 672 PNG' },
          { k: '二维码', v: '纠错 M · UTF-8' },
        ],
        posterData: poster,
      },
      () => {
        setTimeout(() => {
          this.renderCard(result.text, result.bytes, qr, cardData, seq, previousQr, previousCard)
        }, 50)
      },
    )
  },

  async renderCard(
    text: string,
    bytes: number,
    qr: QrRender,
    cardData: {
      name: string
      company: string
      title: string
      phone: string
      email: string
      address: string
      website: string
      note: string
    },
    seq: number,
    previousQr: string,
    previousCard: string,
  ): Promise<void> {
    const state = this as unknown as VCardState
    let cardPath = ''
    try {
      const canvas = await selectCanvasNode(this, '#vcard-canvas')
      if (seq !== renderSeq || state.destroyed) {
        return
      }
      drawVCardCard(canvas, cardData, qr.matrix, qr.count)
      cardPath = await exportCanvas(canvas, CARD_WIDTH, CARD_HEIGHT, 'png', 100)
    } catch {
      /* 画布不可用时退化为仅二维码 */
      cardPath = ''
    }
    if (seq !== renderSeq || state.destroyed) {
      unlinkQuietly(cardPath)
      return
    }

    try {
      const qrPath = await makeQrImage(qr)
      if (seq !== renderSeq || state.destroyed) {
        unlinkQuietly(cardPath)
        unlinkQuietly(qrPath)
        return
      }
      unlinkQuietly(previousQr)
      unlinkQuietly(previousCard)
      this.setData({
        shellState: 'done',
        hasResult: true,
        error: '',
        vcardText: text,
        vcardBytes: bytes,
        qrImagePath: qrPath,
        cardImagePath: cardPath,
        resultMain: `${bytes} 字节`,
        resultRows: [
          { k: '体积', v: `${bytes} 字节 / 1000` },
          {
            k: '图片名片',
            v: cardPath ? '1080 × 672 PNG' : '当前环境不可用，已生成二维码',
          },
          { k: '二维码', v: '纠错 M · UTF-8' },
        ],
      })
    } catch (error) {
      unlinkQuietly(cardPath)
      if (seq !== renderSeq || state.destroyed) {
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      this.setData({
        shellState: 'error',
        hasResult: false,
        qrImagePath: '',
        cardImagePath: '',
        error: `生成失败：${message}`,
        posterData: null,
      })
    }
  },
})
