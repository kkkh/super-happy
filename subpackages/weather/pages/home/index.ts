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
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    workflowPanelVisible: false,
    weatherSummary: '',
  },

  onSummary(event: WechatMiniprogram.CustomEvent<{ text?: string }>) {
    this.setData({ weatherSummary: String((event.detail && event.detail.text) || '') })
  },

  onWorkflowPanelClose() {
    this.setData({ workflowPanelVisible: false })
  },
})
