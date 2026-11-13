/* ==========================================================================
   作品宇宙 · 分类入口
   飞跃策略：分类卡 kicker（share-key: fly-cat-{category}）→ 列表页头 kicker
   ========================================================================== */
import { createStoreBindings } from 'mobx-miniprogram-bindings'
import { resumeStore } from '../../../../core/stores/resume'
import { uiStore } from '../../../../core/stores/ui'
import { fontScaleClass, syncFontScaleClass } from '../../../../core/services/font-scale'
import { fetchCategories } from '../../../../core/services/resume'
import { routeTo } from '../../../../core/constants/index'
import { tapTick } from '../../../../core/utils/haptics'
import type { CategoryMeta } from '../../../../core/types/index'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'

interface HubState {
  storeBindings?: { destroyStoreBindings: () => void }
  themeBindings?: { destroyStoreBindings: () => void }
  /** 导航锁：防止疯狂连点分类卡产生重复列表页 */
  navigating: boolean
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
    metas: [] as CategoryMeta[],
    counts: { actual: 0, personal: 0 } as Record<string, number>,
    favoriteCount: 0,
    themeClass: '',
    fsClass: fontScaleClass(),
    loading: true,
  },

  onLoad() {
    const state = this as unknown as HubState
    state.navigating = false
    state.destroyed = false
    state.storeBindings = createStoreBindings(this, {
      store: resumeStore,
      fields: {
        counts: () => ({
          actual: resumeStore.projectsByCategory('actual').length,
          personal: resumeStore.projectsByCategory('personal').length,
        }),
        favoriteCount: () => resumeStore.favoriteCount,
      },
      actions: [],
    })
    state.themeBindings = createStoreBindings(this, {
      store: uiStore,
      fields: {
        themeClass: () => uiStore.themeClass,
      },
      actions: [],
    })
    fetchCategories()
      .then((result) => {
        if (state.destroyed) {
          return
        }
        this.setData({
          metas: result.ok ? result.data : [],
          loading: false,
        })
        if (!result.ok) {
          uiStore.showToast('作品分类加载失败，请稍后重试')
        }
      })
      .catch(() => {
        if (state.destroyed) {
          return
        }
        this.setData({ loading: false })
        uiStore.showToast('作品分类加载失败，请稍后重试')
      })
  },

  onShow() {
    this.setData({ fsClass: syncFontScaleClass() })
    const state = this as unknown as HubState
    state.navigating = false
  },

  onUnload() {
    const state = this as unknown as HubState
    state.destroyed = true
    if (state.storeBindings) {
      state.storeBindings.destroyStoreBindings()
    }
    if (state.themeBindings) {
      state.themeBindings.destroyStoreBindings()
    }
  },

  onEnter(event: WechatMiniprogram.TouchEvent) {
    const state = this as unknown as HubState
    if (state.navigating) {
      return
    }
    state.navigating = true
    tapTick()
    const { category } = event.currentTarget.dataset as { category: string }
    wx.navigateTo({
      url: routeTo(category),
      fail: () => {
        state.navigating = false
        uiStore.showToast('作品列表加载失败，请稍后重试')
      },
    })
  },
})
