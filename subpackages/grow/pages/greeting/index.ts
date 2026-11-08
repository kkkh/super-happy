/* ==========================================================================
   问候序厅 · 飞跃承接页
   飞跃策略：主页入口「您好」图标环 → 本页 CSS 轨道徽章（share-key: fly-entry-greeting）
   ========================================================================== */
import { createStoreBindings } from 'mobx-miniprogram-bindings'
import { uiStore } from '../../../../core/stores/ui'
import { fetchGreetingCards } from '../../../../core/services/resume'
import type { GreetingCard } from '../../../../core/types/index'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'

interface GreetingState {
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
    cards: [] as GreetingCard[],
    themeClass: '',
  },

  onLoad() {
    const state = this as unknown as GreetingState
    state.destroyed = false
    state.themeBindings = createStoreBindings(this, {
      store: uiStore,
      fields: {
        themeClass: () => uiStore.themeClass,
      },
      actions: [],
    })
    fetchGreetingCards()
      .then((result) => {
        if (state.destroyed) {
          return
        }
        if (result.ok) {
          this.setData({ cards: result.data })
        } else {
          uiStore.showToast('问候内容加载失败，请稍后重试')
        }
      })
      .catch(() => {
        if (state.destroyed) {
          return
        }
        uiStore.showToast('问候内容加载失败，请稍后重试')
      })
  },

  onUnload() {
    const state = this as unknown as GreetingState
    state.destroyed = true
    if (state.themeBindings) {
      state.themeBindings.destroyStoreBindings()
    }
  },
})
