/* ==========================================================================
   和风天气 · 页面壳
   - UI 与数据编排在 components/qw-screen，页面只保留分享与 Workflow 外壳
   ========================================================================== */

import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'

Page({
  onShareAppMessage() {
    const payload = sharePayloadForCurrentPage()
    const summary = String(this.data.weatherSummary || '')
    return summary ? { ...payload, title: summary.length > 40 ? `${summary.slice(0, 40)}…` : summary } : payload
  },

  onShareTimeline() {
    const payload = timelinePayloadForCurrentPage()
    const summary = String(this.data.weatherSummary || '')
    return summary ? { ...payload, title: summary.length > 40 ? `${summary.slice(0, 40)}…` : summary } : payload
  },

  data: {
    workflowPanelVisible: false,
    weatherSummary: '',
    blocked: false,
  },

  onSummary(event: WechatMiniprogram.CustomEvent<{ text?: string }>) {
    this.setData({ weatherSummary: String((event.detail && event.detail.text) || '') })
  },

  onSheet(event: WechatMiniprogram.CustomEvent<{ blocked?: boolean }>) {
    this.setData({ blocked: Boolean(event.detail && event.detail.blocked) })
  },

  onFlow() {
    this.setData({ workflowPanelVisible: true })
  },

  onWorkflowPanelClose() {
    this.setData({ workflowPanelVisible: false })
  },
})
