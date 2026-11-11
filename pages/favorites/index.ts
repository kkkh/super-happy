/* ==========================================================================
   收藏页 · 只显示工具收藏（作品收藏保留在简历模块内部）
   - 顺序按收藏时间倒序；卡片星标直接取消收藏
   ========================================================================== */
import { createStoreBindings } from 'mobx-miniprogram-bindings'
import { uiStore } from '../../core/stores/ui'
import { toolboxStore } from '../../core/toolbox/store'
import { selectTabBar } from '../../core/toolbox/tabbar'
import { tapTick, tapWarn } from '../../core/utils/haptics'
import { logger } from '../../core/utils/logger'
import { ROUTES } from '../../core/constants/index'
import { showGlassToast } from '../../components/glass-toast/toast'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../core/toolbox/share'

interface FavoriteState {
  themeBindings?: { destroyStoreBindings: () => void }
  storeBindings?: { destroyStoreBindings: () => void }
  /** 导航锁：防止疯狂连点工具行产生重复页面栈 */
  navigating: boolean
}

toolboxStore.init()

Page({
  /* 此处是处理全局分享与深链参数校验的边界 */
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    themeClass: uiStore.themeClass,
    themeSwitching: false,
    tools: toolboxStore.favoriteTools(),
  },

  onLoad() {
    const state = this as unknown as FavoriteState
    state.navigating = false
    toolboxStore.init()
    state.themeBindings = createStoreBindings(this, {
      store: uiStore,
      fields: {
        themeClass: () => uiStore.themeClass,
        themeSwitching: () => uiStore.themeSwitching,
      },
      actions: [],
    })
    state.storeBindings = createStoreBindings(this, {
      store: toolboxStore,
      fields: {
        tools: () => toolboxStore.favoriteTools(),
      },
      actions: [],
    })
  },

  onShow() {
    const state = this as unknown as FavoriteState
    state.navigating = false
    selectTabBar(this, 1)
    uiStore.syncNativeChrome()
  },

  onUnload() {
    const state = this as unknown as FavoriteState
    if (state.themeBindings) {
      state.themeBindings.destroyStoreBindings()
    }
    if (state.storeBindings) {
      state.storeBindings.destroyStoreBindings()
    }
  },

  onOpenTool(event: WechatMiniprogram.TouchEvent) {
    const dataset = event.currentTarget.dataset as { route?: string; id?: string }
    if (!dataset.route || !dataset.id) {
      return
    }
    const state = this as unknown as FavoriteState
    if (state.navigating) {
      return
    }
    state.navigating = true
    tapTick()
    wx.navigateTo({
      url: dataset.route,
      success: () => {
        /* 页面真正打开后才计入最近使用，避免弱网下打开失败污染记录 */
        toolboxStore.recordRecent(dataset.id as string)
      },
      fail: (error) => {
        state.navigating = false
        logger.warn('toolbox', `工具打开失败：${dataset.route}`, error)
        showGlassToast('工具加载失败，请稍后重试')
      },
    })
  },

  onFavorite(event: WechatMiniprogram.CustomEvent<{ id: string }>) {
    const id = event.detail?.id
    if (!id) {
      return
    }
    const result = toolboxStore.toggleFavorite(id)
    if (result === 'full') {
      tapWarn()
      showGlassToast('收藏已满（最多 100 个）')
      return
    }
    if (result === 'failed' || result === 'invalid') {
      tapWarn()
      showGlassToast('收藏失败，请重试')
      return
    }
    showGlassToast(result === 'added' ? '已收藏工具' : '已取消收藏')
  },

  onUnfavorite(event: WechatMiniprogram.TouchEvent) {
    const id = event.currentTarget.dataset.id as string
    if (!id) {
      return
    }
    tapTick()
    const result = toolboxStore.toggleFavorite(id)
    if (result === 'failed' || result === 'invalid') {
      tapWarn()
      showGlassToast('收藏失败，请重试')
      return
    }
    showGlassToast('已取消收藏')
  },

  onGoHome() {
    const state = this as unknown as FavoriteState
    if (state.navigating) {
      return
    }
    state.navigating = true
    tapTick()
    wx.switchTab({
      url: ROUTES.home,
      fail: () => {
        state.navigating = false
        showGlassToast('页面切换失败，请重试')
      },
    })
  },
})
