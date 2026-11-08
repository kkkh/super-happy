/* ==========================================================================
   关于我 · 成长纪元时间线 + 叙事块
   ========================================================================== */
import { createStoreBindings } from 'mobx-miniprogram-bindings'
import { uiStore } from '../../../../core/stores/ui'
import { fetchAboutBlocks, fetchTimeline } from '../../../../core/services/resume'
import type { AboutBlock, TimelineEra } from '../../../../core/types/index'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'

interface AboutState {
  themeBindings?: { destroyStoreBindings: () => void }
  /** 页面销毁令牌：阻止异步装载回调在退出后继续 setData */
  destroyed: boolean
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
    blocks: [] as AboutBlock[],
    eras: [] as TimelineEra[],
    themeClass: '',
    loading: true,
  },

  onLoad() {
    const state = this as unknown as AboutState
    state.destroyed = false
    state.themeBindings = createStoreBindings(this, {
      store: uiStore,
      fields: {
        themeClass: () => uiStore.themeClass,
      },
      actions: [],
    })
    Promise.all([fetchAboutBlocks(), fetchTimeline()])
      .then(([blocksRes, erasRes]) => {
        if (state.destroyed) {
          return
        }
        this.setData({
          blocks: blocksRes.ok ? blocksRes.data : [],
          eras: erasRes.ok ? erasRes.data : [],
          loading: false,
        })
        if (!blocksRes.ok || !erasRes.ok) {
          uiStore.showToast('成长内容加载失败，请稍后重试')
        }
      })
      .catch(() => {
        if (state.destroyed) {
          return
        }
        this.setData({ loading: false })
        uiStore.showToast('成长内容加载失败，请稍后重试')
      })
  },

  onUnload() {
    const state = this as unknown as AboutState
    state.destroyed = true
    if (state.themeBindings) {
      state.themeBindings.destroyStoreBindings()
    }
  },
})
