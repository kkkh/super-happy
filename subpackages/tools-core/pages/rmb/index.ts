/* ==========================================================================
   金额大写 · 分 → 中文大写（亿/万/元分节）
   - 最大 1 万亿元；最多两位小数
   - 实时计算，结果可复制
   ========================================================================== */
import { formatCents, parseCents } from '../../lib/money'
import { centsToChinese } from '../../lib/rmb'
import { copyText } from '../../lib/ui'
import { tapTick } from '../../../../core/utils/haptics'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'

Page({
  /* 此处是处理工具页分享与深链参数校验的边界 */
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: '金额大写',
    kicker: '职场辅助',
    desc: '人民币金额转中文大写',
    amount: '',
    hasResult: false,
    error: '',
    amountText: '',
    upperText: '',
    unitText: '',
    copyPayload: '',
    posterData: null as IPosterData | null,
  },

  onInput(event: WechatMiniprogram.Input) {
    this.setData({ amount: event.detail.value }, () => {
      this.recalculate()
    })
  },

  onExample() {
    this.setData({ amount: '12345.67' }, () => {
      this.recalculate()
    })
  },

  onQuick(event: WechatMiniprogram.TouchEvent) {
    const value = event.currentTarget.dataset.value as string
    if (!value) {
      return
    }
    tapTick()
    this.setData({ amount: value }, () => {
      this.recalculate()
    })
  },

  onReset() {
    this.setData({
      amount: '',
      hasResult: false,
      error: '',
      amountText: '',
      upperText: '',
      unitText: '',
    })
  },

  /* ---- 草稿：只存金额输入，恢复后重算 ---- */
  collectDraftInput(): Record<string, string> {
    return { amount: this.data.amount }
  },

  applyDraftInput(input: Record<string, string>): void {
    this.setData({ amount: input.amount ?? '' }, () => {
      this.recalculate()
    })
  },

  onCopy() {
    copyText(this.data.upperText, '大写金额已复制')
  },

  recalculate() {
    const raw = this.data.amount.trim()
    if (!raw) {
      this.setData({ hasResult: false, error: '', upperText: '', unitText: '' })
      return
    }
    const cents = parseCents(raw)
    if (cents === null) {
      this.setData({
        hasResult: false,
        error: '请输入 0–1 万亿元之间的金额，最多两位小数',
        upperText: '',
        unitText: '',
      })
      return
    }
    const upperText = centsToChinese(cents)
    const jiao = Math.floor(cents / 10) % 10
    const fen = cents % 10
    const unitText = `角 ${jiao} · 分 ${fen}`
    const amountText = `¥${formatCents(cents)}`
    const poster: IPosterData = {
      toolName: '金额大写',
      category: '职场辅助',
      mainResult: upperText,
      resultLabel: '人民币大写',
      params: [{ label: '小写金额', value: amountText }],
      extras: [
        `小写金额 ${amountText}`,
        `角位 ${jiao} · 分位 ${fen}`,
        `大写共 ${Array.from(upperText).length} 字`,
      ],
    }
    this.setData({
      hasResult: true,
      error: '',
      amountText,
      upperText,
      unitText,
      posterData: poster,
    })
  },
})
