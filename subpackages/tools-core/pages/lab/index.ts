/* ==========================================================================
   pages/lab · 组件样板间
   ========================================================================== */
import type { GlassInputValueDetail } from '../../../../components/glass-input/index'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'

interface LabRuntime {
  submitTimer: number
}

Page({
  /* 此处是处理全局分享与深链参数校验的边界 */
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    keyword: '',
    sheetKeyword: '',
    result: '',
    submitting: false,
    amount: 328650.5,
    sheetShow: false,
  },

  onLoad() {
    const runtime = this as unknown as LabRuntime
    runtime.submitTimer = 0
  },

  onUnload() {
    const runtime = this as unknown as LabRuntime
    if (runtime.submitTimer) {
      clearTimeout(runtime.submitTimer)
      runtime.submitTimer = 0
    }
  },

  onInput(event: WechatMiniprogram.CustomEvent<GlassInputValueDetail>) {
    this.setData({ keyword: event.detail.value })
  },

  onConfirm(event: WechatMiniprogram.CustomEvent<GlassInputValueDetail>) {
    this.setData({ keyword: event.detail.value })
  },

  onSubmit() {
    if (this.data.submitting) {
      return
    }
    const runtime = this as unknown as LabRuntime
    const keyword = this.data.keyword.trim()
    if (!keyword) {
      this.setData({ result: '请先输入内容。' })
      return
    }

    this.setData({ submitting: true, result: '' })
    runtime.submitTimer = setTimeout(() => {
      runtime.submitTimer = 0
      this.setData({
        submitting: false,
        result: `已处理 ${Array.from(keyword).length} 个字符：${keyword}`,
      })
    }, 720) as unknown as number
  },

  onOpenSheet() {
    this.setData({ sheetShow: true })
  },

  onCloseSheet() {
    this.setData({ sheetShow: false })
  },

  onSheetClose() {
    this.setData({ sheetShow: false })
  },

  onSheetClosed() {
    this.setData({ sheetShow: false })
  },

  onSheetInput(event: WechatMiniprogram.CustomEvent<GlassInputValueDetail>) {
    this.setData({ sheetKeyword: event.detail.value })
  },

  onSheetConfirm() {
    this.setData({ sheetShow: false })
  },
})
