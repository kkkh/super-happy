/* ==========================================================================
   分辨率与比例 · 化简 / 等比缩放
   - 输入原宽高，按目标宽度或目标比例给出目标尺寸
   - GCD 化简比例；极端比例取整为 0 时明确报错
   ========================================================================== */
import { tapTick } from '../../../../core/utils/haptics'
import {
  DPI_OPTIONS,
  PAPER_PRESETS,
  planResolution,
  printPixelSize,
  printSummaryText,
  resolutionSummary,
  type PrintOrientation,
  type ResolutionPlan,
} from '../../lib/resolution'
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

interface ResolutionState {
  destroyed: boolean
}

type Mode = 'width' | 'ratio' | 'print'

interface OrientationOption {
  key: PrintOrientation
  label: string
}

const ORIENTATIONS: OrientationOption[] = [
  { key: 'portrait', label: '竖版' },
  { key: 'landscape', label: '横版' },
]

interface RatioOption {
  key: string
  label: string
  width: number
  height: number
}

const RATIOS: RatioOption[] = [
  { key: '16:9', label: '16:9', width: 16, height: 9 },
  { key: '4:3', label: '4:3', width: 4, height: 3 },
  { key: '1:1', label: '1:1', width: 1, height: 1 },
  { key: 'custom', label: '自定义', width: 0, height: 0 },
]

function parsePositive(value: string): number | null {
  const parsed = Number(value.trim())
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }
  return parsed
}

function toRows(plan: ResolutionPlan): ResultRow[] {
  const rows: ResultRow[] = [
    { k: '原始尺寸', v: `${plan.width} × ${plan.height}` },
    { k: '比例化简', v: plan.ratio.text },
    { k: '像素总量', v: `${plan.pixels.toLocaleString()}（${plan.megapixels.toFixed(2)} MP）` },
    { k: '高清判定', v: plan.isHD ? '是（≥1280 宽）' : '否（<1280 宽）' },
  ]
  if (plan.targetWidth !== null && plan.targetHeight !== null) {
    rows.splice(1, 0, { k: '目标尺寸', v: `${plan.targetWidth} × ${plan.targetHeight}` })
  }
  if (plan.targetRatioText && plan.targetRatioText !== plan.ratio.text) {
    rows.splice(2, 0, { k: '目标比例', v: plan.targetRatioText })
  }
  return rows
}

Page({
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: '分辨率与比例',
    kicker: '计算换算',
    desc: '宽高化简 · 等比缩放 · A4 / DPI 打印尺寸',
    mode: 'width' as Mode,
    widthText: '',
    heightText: '',
    targetWidthText: '',
    ratioKey: '16:9',
    customWText: '',
    customHText: '',
    ratios: RATIOS,
    paperKey: 'a4',
    paperOptions: PAPER_PRESETS,
    orientation: 'portrait' as PrintOrientation,
    orientationOptions: ORIENTATIONS,
    dpi: 300,
    dpiOptions: DPI_OPTIONS,
    resultLabel: '目标尺寸',
    resultMain: '',
    resultRows: [] as ResultRow[],
    resolutionSummary: '',
    shellState: 'idle',
    hasResult: false,
    error: '',
    posterData: null as IPosterData | null,
    formTouched: false,
  },

  onLoad() {
    const state = this as unknown as ResolutionState
    state.destroyed = false
  },

  onUnload() {
    const state = this as unknown as ResolutionState
    state.destroyed = true
  },

  onFieldInput(event: WechatMiniprogram.Input) {
    const field = String(event.currentTarget.dataset.field || '')
    const value = String(event.detail.value ?? '')
    if (
      field === 'widthText' ||
      field === 'heightText' ||
      field === 'targetWidthText' ||
      field === 'customWText' ||
      field === 'customHText'
    ) {
      this.setData({ [field]: value, formTouched: true, error: '' })
    }
  },

  onMode(event: WechatMiniprogram.TouchEvent) {
    const mode = String(event.currentTarget.dataset.mode || '') as Mode
    if (mode !== 'width' && mode !== 'ratio' && mode !== 'print') {
      return
    }
    tapTick()
    this.setData({ mode, formTouched: true, ...this.emptyResult() })
  },

  onPaper(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.key || '')
    if (!PAPER_PRESETS.some((item) => item.key === key) || key === this.data.paperKey) {
      return
    }
    tapTick()
    this.setData({ paperKey: key, formTouched: true, ...this.emptyResult() })
  },

  onOrientation(event: WechatMiniprogram.TouchEvent) {
    const orientation = String(event.currentTarget.dataset.key || '') as PrintOrientation
    if (
      !ORIENTATIONS.some((item) => item.key === orientation) ||
      orientation === this.data.orientation
    ) {
      return
    }
    tapTick()
    this.setData({
      orientation,
      formTouched: true,
      ...this.emptyResult(),
    })
  },

  onDpi(event: WechatMiniprogram.TouchEvent) {
    const dpi = Number(event.currentTarget.dataset.dpi)
    if (!DPI_OPTIONS.includes(dpi as (typeof DPI_OPTIONS)[number]) || dpi === this.data.dpi) {
      return
    }
    tapTick()
    this.setData({ dpi, formTouched: true, ...this.emptyResult() })
  },

  emptyResult() {
    return {
      resultLabel: '目标尺寸',
      resultMain: '',
      resultRows: [] as ResultRow[],
      resolutionSummary: '',
      shellState: 'idle',
      hasResult: false,
      error: '',
      posterData: null as IPosterData | null,
    }
  },

  onRatio(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.key || '')
    if (!RATIOS.some((item) => item.key === key)) {
      return
    }
    tapTick()
    this.setData({ ratioKey: key, formTouched: true, error: '' })
  },

  onExample() {
    tapTick()
    if (this.data.mode === 'print') {
      this.setData(
        {
          paperKey: 'a4',
          orientation: 'portrait',
          dpi: 300,
          formTouched: true,
          error: '',
        },
        () => this.onRun(),
      )
      return
    }
    this.setData(
      {
        mode: 'width',
        widthText: '1920',
        heightText: '1080',
        targetWidthText: '1280',
        ratioKey: '16:9',
        customWText: '',
        customHText: '',
        formTouched: true,
        error: '',
      },
      () => this.onRun(),
    )
  },

  onReset() {
    this.setData({
      mode: 'width',
      widthText: '',
      heightText: '',
      targetWidthText: '',
      ratioKey: '16:9',
      customWText: '',
      customHText: '',
      paperKey: 'a4',
      orientation: 'portrait',
      dpi: 300,
      ...this.emptyResult(),
      formTouched: false,
    })
  },

  onRun() {
    const state = this as unknown as ResolutionState
    if (state.destroyed) {
      return
    }
    if (this.data.mode === 'print') {
      this.runPrint()
      return
    }
    const width = parsePositive(this.data.widthText)
    const height = parsePositive(this.data.heightText)
    if (width === null || height === null) {
      this.setData({
        shellState: 'invalid',
        hasResult: false,
        resultMain: '',
        resultRows: [],
        resolutionSummary: '',
        error: '请填写大于 0 的原始宽度与高度',
        posterData: null,
      })
      return
    }

    let input: Parameters<typeof planResolution>[0]
    if (this.data.mode === 'width') {
      const targetWidth = parsePositive(this.data.targetWidthText)
      if (targetWidth === null) {
        this.setData({
          shellState: 'invalid',
          hasResult: false,
          resultMain: '',
          resultRows: [],
          resolutionSummary: '',
          error: '请填写大于 0 的目标宽度',
          posterData: null,
        })
        return
      }
      input = { width, height, targetWidth }
    } else {
      const preset = RATIOS.find((item) => item.key === this.data.ratioKey)
      if (!preset) {
        this.setData({ error: '请选择目标比例' })
        return
      }
      let ratioWidth = preset.width
      let ratioHeight = preset.height
      if (preset.key === 'custom') {
        const customW = parsePositive(this.data.customWText)
        const customH = parsePositive(this.data.customHText)
        if (customW === null || customH === null) {
          this.setData({
            shellState: 'invalid',
            hasResult: false,
            resultMain: '',
            resultRows: [],
            resolutionSummary: '',
            error: '自定义比例需填写大于 0 的宽与高',
            posterData: null,
          })
          return
        }
        ratioWidth = customW
        ratioHeight = customH
      }
      input = { width, height, ratio: { width: ratioWidth, height: ratioHeight } }
    }

    const plan = planResolution(input)
    if (!plan) {
      this.setData({
        shellState: 'invalid',
        hasResult: false,
        resultMain: '',
        resultRows: [],
        resolutionSummary: '',
        error: '尺寸或比例无效；极端比例取整后可能为 0',
        posterData: null,
      })
      return
    }

    const hasTarget = plan.targetWidth !== null && plan.targetHeight !== null
    const summary = resolutionSummary(plan)
    const poster: IPosterData = {
      toolName: '分辨率与比例',
      category: '计算换算',
      mainResult: hasTarget ? `${plan.targetWidth} × ${plan.targetHeight}` : `${plan.width} × ${plan.height}`,
      resultLabel: hasTarget ? '目标尺寸' : '原始尺寸',
      params: [{ label: '原图', value: `${plan.width} × ${plan.height}` }],
      extras: [plan.ratio.text, `${plan.megapixels.toFixed(2)} MP`, plan.isHD ? '高清' : '非高清'],
    }
    this.setData({
      shellState: 'done',
      hasResult: true,
      error: '',
      resultLabel: hasTarget ? '目标尺寸' : '原始尺寸',
      resultMain: hasTarget
        ? `${plan.targetWidth} × ${plan.targetHeight}`
        : `${plan.width} × ${plan.height}`,
      resultRows: toRows(plan),
      resolutionSummary: summary,
      posterData: poster,
    })
  },

  runPrint() {
    const result = printPixelSize({
      paperKey: this.data.paperKey,
      dpi: this.data.dpi,
      orientation: this.data.orientation,
    })
    if (!result) {
      this.setData({
        shellState: 'invalid',
        hasResult: false,
        resultMain: '',
        resultRows: [],
        resolutionSummary: '',
        error: '请选择纸张、方向与 DPI',
        posterData: null,
      })
      return
    }
    const orientationText = result.orientation === 'landscape' ? '横版' : '竖版'
    const summary = printSummaryText(result)
    const poster: IPosterData = {
      toolName: '分辨率与比例',
      category: '计算换算',
      mainResult: `${result.pixelWidth} × ${result.pixelHeight}`,
      resultLabel: '打印像素',
      params: [
        { label: '纸张', value: `${result.paper.label} ${orientationText}` },
        { label: 'DPI', value: `${result.dpi}` },
      ],
      extras: [summary],
    }
    this.setData({
      shellState: 'done',
      hasResult: true,
      error: '',
      resultLabel: '打印像素',
      resultMain: `${result.pixelWidth} × ${result.pixelHeight}`,
      resultRows: [
        { k: '纸张', v: `${result.paper.label} ${orientationText}` },
        {
          k: '物理尺寸',
          v: `${result.widthCm.toFixed(2)} × ${result.heightCm.toFixed(2)} cm（${result.widthInch.toFixed(2)} × ${result.heightInch.toFixed(2)} in）`,
        },
        { k: '像素尺寸', v: `${result.pixelWidth} × ${result.pixelHeight}` },
        {
          k: '总像素',
          v: `${result.pixels.toLocaleString()}（${result.megapixels.toFixed(2)} MP）`,
        },
        { k: '打印分辨率', v: `${result.dpi} DPI` },
        { k: '适用场景', v: result.dpi >= 300 ? '高清打印' : '普通打印 / 屏幕预览' },
      ],
      resolutionSummary: summary,
      posterData: poster,
    })
  },

  onCopy() {
    const text = this.data.resolutionSummary
    if (!text) {
      return
    }
    tapTick()
    copyText(text, '摘要已复制')
  },

  onCopyRow(event: WechatMiniprogram.TouchEvent) {
    const value = String(event.currentTarget.dataset.value || '')
    if (!value) {
      return
    }
    tapTick()
    copyText(value, '已复制')
  },
})
