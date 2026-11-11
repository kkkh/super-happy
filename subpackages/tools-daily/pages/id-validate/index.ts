/* ==========================================================================
   证件号校验 · 18 位身份证 / 12–19 位银行卡
   - 自动识别或手动指定类型；不合法也作为结果展示，不弹全局错误
   - 展示与摘要统一脱敏，不保存、不上传
   - 只做格式与校验位检查，不验证证件真伪
   ========================================================================== */
import { tapTick } from '../../../../core/utils/haptics'
import {
  idSummary,
  maskIdentifier,
  normalizeId,
  validateIdentifier,
  type IdInputMode,
  type IdValidationResult,
} from '../../lib/id'
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

interface IdState {
  destroyed: boolean
}

const MODE_OPTIONS: Array<{ key: IdInputMode; label: string }> = [
  { key: 'auto', label: '自动识别' },
  { key: 'id-card', label: '身份证' },
  { key: 'bank-card', label: '银行卡' },
]

const SAMPLE = '11010519491231002X'

function typeLabel(type: IdValidationResult['type']): string {
  if (type === 'id-card') {
    return '身份证'
  }
  return type === 'bank-card' ? '银行卡' : '未识别'
}

function emptyResult() {
  return {
    resultMain: '',
    resultLabel: '校验结果',
    resultRows: [] as ResultRow[],
    idSummary: '',
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
    toolName: '证件号校验',
    kicker: '生活健康',
    desc: '身份证 / 银行卡 · 本机校验',
    mode: 'auto' as IdInputMode,
    modeOptions: MODE_OPTIONS,
    value: '',
    canRun: false,
    ...emptyResult(),
  },

  onLoad() {
    const state = this as unknown as IdState
    state.destroyed = false
  },

  onUnload() {
    const state = this as unknown as IdState
    state.destroyed = true
  },

  onMode(event: WechatMiniprogram.TouchEvent) {
    const mode = event.currentTarget.dataset.mode as IdInputMode
    if ((mode !== 'auto' && mode !== 'id-card' && mode !== 'bank-card') || mode === this.data.mode) {
      return
    }
    tapTick()
    this.setData({ mode, ...emptyResult() }, () => this.updateCanRun())
  },

  onInput(event: WechatMiniprogram.Input) {
    this.setData({ value: event.detail.value, ...emptyResult() }, () =>
      this.updateCanRun(),
    )
  },

  onExample() {
    tapTick()
    this.setData({ mode: 'auto', value: SAMPLE, ...emptyResult() }, () =>
      this.onRun(),
    )
  },

  onReset() {
    this.setData({
      mode: 'auto',
      value: '',
      canRun: false,
      ...emptyResult(),
    })
  },

  onRun() {
    this.compute()
  },

  onCopy() {
    if (!this.data.idSummary) {
      return
    }
    tapTick()
    void copyText(this.data.idSummary, '校验结果已复制')
  },

  onCopyRow(event: WechatMiniprogram.TouchEvent) {
    const value = String(event.currentTarget.dataset.value || '')
    if (!value) {
      return
    }
    tapTick()
    void copyText(value, '已复制')
  },

  onReceiveWorkflow(data: { payload?: string }): boolean {
    const payload = typeof data?.payload === 'string' ? data.payload : ''
    const normalized = normalizeId(payload)
    if (!normalized) {
      return false
    }
    this.setData({ mode: 'auto', value: normalized, ...emptyResult() }, () =>
      this.compute(),
    )
    return true
  },

  updateCanRun() {
    this.setData({ canRun: normalizeId(this.data.value).length > 0 })
  },

  compute() {
    const state = this as unknown as IdState
    if (state.destroyed) {
      return
    }
    const normalized = normalizeId(this.data.value)
    if (!normalized) {
      this.invalidate('请输入身份证号或银行卡号')
      return
    }
    this.render(validateIdentifier(normalized, this.data.mode))
  },

  render(result: IdValidationResult) {
    const type = typeLabel(result.type)
    const main = result.ok ? '校验通过' : '校验未通过'
    const rows: ResultRow[] = [
      { k: '类型', v: type },
      { k: '校验结果', v: result.ok ? '通过' : '未通过' },
    ]
    if (result.ok && result.type === 'id-card') {
      rows.push(
        { k: '出生日期', v: result.birthDate },
        { k: '性别', v: result.gender },
        { k: '地区码', v: result.regionCode },
        { k: '校验算法', v: 'GB 11643 加权校验' },
      )
    } else if (result.ok) {
      rows.push(
        { k: '卡号长度', v: `${result.normalized.length} 位` },
        { k: '校验算法', v: 'Luhn' },
      )
    } else {
      rows.push({ k: '原因', v: result.reason }, { k: '建议', v: '请检查号码位数与校验位' })
    }

    const summary = idSummary(result)
    const masked = maskIdentifier(result.normalized, result.type)
    const extras =
      result.ok && result.type === 'id-card'
        ? [result.birthDate, result.gender]
        : result.ok
          ? [`${result.normalized.length} 位`, 'Luhn']
          : [result.reason]
    const poster: IPosterData = {
      toolName: '证件号校验',
      category: '生活健康',
      mainResult: main,
      resultLabel: '证件校验',
      params: [
        { label: '类型', value: type },
        { label: '号码', value: masked },
      ],
      extras,
    }
    this.setData({
      resultMain: main,
      resultRows: rows,
      idSummary: summary,
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
