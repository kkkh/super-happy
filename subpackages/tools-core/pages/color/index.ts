/* ==========================================================================
   颜色转换 · HEX / RGB / HSL · WCAG 对比度 · 色觉模拟
   - 两个输入均接受 HEX / rgb() / hsl()，透明度统一忽略
   - 对比度按 WCAG 2.x 原始值判定，展示保留两位小数
   - 摘要与 silent 执行器同源 colorSummary
   ========================================================================== */
import { tapTick } from '../../../../core/utils/haptics'
import {
  contrastRatio,
  contrastReport,
  cvdResults,
  formatColor,
  parseColor,
  colorSummary,
  type CvdResult,
  type RgbColor,
} from '../../../../core/toolbox/engines/color'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'
import { copyText } from '../../lib/ui'

interface ResultRow {
  k: string
  v: string
}

interface CvdRow {
  label: string
  hex: string
  ratio: string
  note: string
}

interface ColorState {
  destroyed: boolean
}

const DEFAULT_FOREGROUND = '#3D5AFE'
const DEFAULT_BACKGROUND = '#FFFFFF'

function emptyResult() {
  return {
    resultMain: '',
    resultRows: [] as ResultRow[],
    cvdRows: [] as CvdRow[],
    colorSummary: '',
    fgPreview: '',
    bgPreview: '',
    hasResult: false,
    shellState: 'idle' as string,
    error: '',
    posterData: null as IPosterData | null,
  }
}

function passText(pass: boolean): string {
  return pass ? '通过' : '未通过'
}

function cvdNote(result: CvdResult): string {
  if (result.contrast.aaNormal) {
    return 'AA 正文通过'
  }
  return result.contrast.aaLarge ? '仅大字 AA 通过' : '对比度不足'
}

Page({
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: '颜色转换',
    kicker: '图片处理',
    desc: 'HEX / RGB / HSL · 对比度 · 色觉模拟',
    fgValue: DEFAULT_FOREGROUND,
    bgValue: DEFAULT_BACKGROUND,
    resultLabel: '对比度',
    canRun: true,
    ...emptyResult(),
  },

  onLoad() {
    const state = this as unknown as ColorState
    state.destroyed = false
  },

  onUnload() {
    const state = this as unknown as ColorState
    state.destroyed = true
  },

  onInput(event: WechatMiniprogram.Input) {
    const field = String(event.currentTarget.dataset.field || '')
    if (field !== 'fg' && field !== 'bg') {
      return
    }
    const key = field === 'fg' ? 'fgValue' : 'bgValue'
    this.setData({ [key]: event.detail.value, ...emptyResult() }, () => this.updateCanRun())
  },

  onExample() {
    tapTick()
    this.setData(
      {
        fgValue: '#FF0000',
        bgValue: '#FFFFFF',
        ...emptyResult(),
      },
      () => this.onRun(),
    )
  },

  onReset() {
    this.setData({
      fgValue: DEFAULT_FOREGROUND,
      bgValue: DEFAULT_BACKGROUND,
      ...emptyResult(),
      canRun: true,
    })
  },

  /* ---- 草稿：前景 / 背景色；恢复后重新计算对比度 ---- */
  collectDraftInput(): Record<string, string> {
    return { fgValue: this.data.fgValue, bgValue: this.data.bgValue }
  },

  applyDraftInput(input: Record<string, string>): void {
    this.setData(
      {
        fgValue: input.fgValue || DEFAULT_FOREGROUND,
        bgValue: input.bgValue || DEFAULT_BACKGROUND,
        ...emptyResult(),
      },
      () => {
        this.onRun()
      },
    )
  },

  onRun() {
    this.compute()
  },

  onCopy() {
    if (!this.data.colorSummary) {
      return
    }
    tapTick()
    void copyText(this.data.colorSummary, '颜色结果已复制')
  },

  onCopyRow(event: WechatMiniprogram.TouchEvent) {
    const value = String(event.currentTarget.dataset.value || '')
    if (!value) {
      return
    }
    tapTick()
    void copyText(value, '已复制')
  },

  readColor(field: 'fg' | 'bg'): RgbColor | null {
    return parseColor(field === 'fg' ? this.data.fgValue : this.data.bgValue)
  },

  updateCanRun() {
    this.setData({
      canRun: this.readColor('fg') !== null && this.readColor('bg') !== null,
    })
  },

  compute() {
    const state = this as unknown as ColorState
    if (state.destroyed) {
      return
    }
    const foreground = this.readColor('fg')
    if (!foreground) {
      this.invalidate('前景色无法识别，请输入 #RGB / #RRGGBB / rgb(...) / hsl(...)')
      return
    }
    const background = this.readColor('bg')
    if (!background) {
      this.invalidate('背景色无法识别，请输入 #RGB / #RRGGBB / rgb(...) / hsl(...)')
      return
    }

    const fg = formatColor(foreground)
    const bg = formatColor(background)
    const ratio = contrastRatio(foreground, background)
    const report = contrastReport(ratio)
    const simulated = cvdResults(foreground, background)
    const summary = colorSummary(foreground, background)
    const poster: IPosterData = {
      toolName: '颜色转换',
      category: '图片处理',
      mainResult: report.ratioText,
      resultLabel: '对比度',
      params: [
        { label: '前景', value: `${fg.hex} ${fg.rgbText}` },
        { label: '背景', value: bg.hex },
      ],
      extras: [
        `AA 正文${passText(report.aaNormal)}`,
        `AAA 正文${passText(report.aaaNormal)}`,
        summary,
      ],
    }
    this.setData({
      resultMain: report.ratioText,
      resultRows: [
        { k: '前景 HEX', v: fg.hex },
        { k: '前景 RGB', v: fg.rgbText },
        { k: '前景 HSL', v: fg.hslText },
        { k: '背景 HEX', v: bg.hex },
        { k: '对比度', v: report.ratioText },
        { k: 'AA 正文（≥4.5）', v: passText(report.aaNormal) },
        { k: 'AAA 正文（≥7）', v: passText(report.aaaNormal) },
        { k: 'AA 大字（≥3）', v: passText(report.aaLarge) },
        { k: 'AAA 大字（≥4.5）', v: passText(report.aaaLarge) },
      ],
      cvdRows: simulated.map((item) => ({
        label: item.label,
        hex: item.hex,
        ratio: item.contrast.ratioText,
        note: cvdNote(item),
      })),
      colorSummary: summary,
      fgPreview: fg.hex,
      bgPreview: bg.hex,
      hasResult: true,
      shellState: 'done',
      error: '',
      canRun: true,
      posterData: poster,
    })
  },

  invalidate(message: string) {
    this.setData({
      ...emptyResult(),
      shellState: 'invalid',
      error: message,
    })
  },
})
