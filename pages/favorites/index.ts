/* ==========================================================================
   收藏页 · 只显示工具收藏（作品收藏保留在简历模块内部）
   - 支持最近收藏 / 名称 / 分类三种排序，偏好写入 preferenceStore
   - 管理模式支持多选、全选、批量移除与二次确认清空
   - 顺序默认按收藏时间倒序；非管理态卡片星标可直接取消收藏
   ========================================================================== */
import { createStoreBindings } from 'mobx-miniprogram-bindings'
import { uiStore } from '../../core/stores/ui'
import { preferenceStore } from '../../core/stores/preference'
import { toolboxStore } from '../../core/toolbox/store'
import { getTool } from '../../core/toolbox/registry'
import { networkStore } from '../../core/stores/network'
import {
  FAVORITE_SORTS,
  FAVORITE_SORT_LABELS,
  isFavoriteSort,
  sortFavoriteTools,
} from '../../core/toolbox/favorites-sort'
import type { FavoriteSort } from '../../core/toolbox/types'
import { selectTabBar } from '../../core/toolbox/tabbar'
import { tapTick, tapWarn } from '../../core/utils/haptics'
import { logger } from '../../core/utils/logger'
import { ROUTES } from '../../core/constants/index'
import { showGlassToast } from '../../components/glass-toast/toast'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../core/toolbox/share'
import { fontScaleClass, syncFontScaleClass } from '../../core/services/font-scale'

interface FavoriteState {
  themeBindings?: { destroyStoreBindings: () => void }
  networkBindings?: { destroyStoreBindings: () => void }
  /** 导航锁：防止疯狂连点工具行产生重复页面栈 */
  navigating: boolean
}

const SORT_OPTIONS = FAVORITE_SORTS.map((key) => ({
  key,
  label: FAVORITE_SORT_LABELS[key],
}))

toolboxStore.init()
preferenceStore.init()

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
    fsClass: fontScaleClass(),
    offline: networkStore.offline,
    tools: sortFavoriteTools(toolboxStore.favoriteTools(), preferenceStore.favoriteSort),
    sort: preferenceStore.favoriteSort as FavoriteSort,
    sortOptions: SORT_OPTIONS,
    manageMode: false,
    selectedMap: {} as Record<string, boolean>,
    selectedCount: 0,
    allSelected: false,
    showClearConfirm: false,
  },

  onLoad() {
    const state = this as unknown as FavoriteState
    state.navigating = false
    toolboxStore.init()
    preferenceStore.init()
    state.themeBindings = createStoreBindings(this, {
      store: uiStore,
      fields: {
        themeClass: () => uiStore.themeClass,
        themeSwitching: () => uiStore.themeSwitching,
      },
      actions: [],
    })
    state.networkBindings = createStoreBindings(this, {
      store: networkStore,
      fields: {
        offline: () => networkStore.offline,
      },
      actions: [],
    })
    this.refreshTools()
  },

  onShow() {
    const state = this as unknown as FavoriteState
    state.navigating = false
    this.setData({
      fsClass: syncFontScaleClass(),
      manageMode: false,
      selectedMap: {},
      selectedCount: 0,
      allSelected: false,
      showClearConfirm: false,
    })
    this.refreshTools()
    selectTabBar(this, 1)
    uiStore.syncNativeChrome()
  },

  onUnload() {
    const state = this as unknown as FavoriteState
    if (state.themeBindings) {
      state.themeBindings.destroyStoreBindings()
    }
    if (state.networkBindings) {
      state.networkBindings.destroyStoreBindings()
    }
  },

  /** 重新计算排序结果与勾选状态；收藏变化后统一走这里 */
  refreshTools() {
    const tools = sortFavoriteTools(toolboxStore.favoriteTools(), preferenceStore.favoriteSort)
    const previous = this.data.selectedMap as Record<string, boolean>
    const selectedMap: Record<string, boolean> = {}
    let selectedCount = 0
    tools.forEach((tool) => {
      if (previous[tool.id]) {
        selectedMap[tool.id] = true
        selectedCount += 1
      }
    })
    this.setData({
      tools,
      sort: preferenceStore.favoriteSort,
      manageMode: this.data.manageMode && tools.length > 0,
      selectedMap,
      selectedCount,
      allSelected: tools.length > 0 && selectedCount === tools.length,
    })
  },

  onSort(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.key || '')
    if (!isFavoriteSort(key) || key === this.data.sort) {
      return
    }
    tapTick()
    if (!preferenceStore.setFavoriteSort(key)) {
      tapWarn()
      showGlassToast('排序偏好保存失败')
    }
    this.refreshTools()
  },

  onToggleManage() {
    if (!this.data.tools.length && !this.data.manageMode) {
      return
    }
    tapTick()
    const manageMode = !this.data.manageMode
    this.setData({
      manageMode,
      selectedMap: {},
      selectedCount: 0,
      allSelected: false,
      showClearConfirm: false,
    })
  },

  onRowTap(event: WechatMiniprogram.TouchEvent) {
    if (this.data.manageMode) {
      this.toggleSelected(String(event.currentTarget.dataset.id || ''))
      return
    }
    this.onOpenTool(event)
  },

  toggleSelected(id: string) {
    if (!id) {
      return
    }
    tapTick()
    const selectedMap = { ...(this.data.selectedMap as Record<string, boolean>) }
    if (selectedMap[id]) {
      delete selectedMap[id]
    } else {
      selectedMap[id] = true
    }
    const selectedCount = Object.keys(selectedMap).length
    this.setData({
      selectedMap,
      selectedCount,
      allSelected: selectedCount === this.data.tools.length && selectedCount > 0,
    })
  },

  onSelectAll() {
    if (!this.data.tools.length) {
      return
    }
    tapTick()
    if (this.data.allSelected) {
      this.setData({ selectedMap: {}, selectedCount: 0, allSelected: false })
      return
    }
    const selectedMap: Record<string, boolean> = {}
    this.data.tools.forEach((tool) => {
      selectedMap[tool.id] = true
    })
    this.setData({
      selectedMap,
      selectedCount: this.data.tools.length,
      allSelected: true,
    })
  },

  onRemoveSelected() {
    const ids = Object.keys(this.data.selectedMap as Record<string, boolean>)
    if (!ids.length) {
      tapWarn()
      showGlassToast('请先选择要移除的工具')
      return
    }
    if (!toolboxStore.removeFavorites(ids)) {
      tapWarn()
      showGlassToast('移除失败，请重试')
      return
    }
    tapTick()
    this.setData(
      {
        manageMode: this.data.tools.length - ids.length > 0,
        selectedMap: {},
        selectedCount: 0,
        allSelected: false,
      },
      () => this.refreshTools(),
    )
    showGlassToast(`已移除 ${ids.length} 个收藏`)
  },

  onAskClear() {
    if (!this.data.tools.length) {
      return
    }
    tapTick()
    this.setData({ showClearConfirm: true })
  },

  onCancelClear() {
    this.setData({ showClearConfirm: false })
  },

  onConfirmClear() {
    this.setData({ showClearConfirm: false })
    if (!toolboxStore.clearFavorites()) {
      tapWarn()
      showGlassToast('清空失败，请重试')
      return
    }
    tapTick()
    this.setData(
      {
        manageMode: false,
        selectedMap: {},
        selectedCount: 0,
        allSelected: false,
      },
      () => this.refreshTools(),
    )
    showGlassToast('已清空收藏')
  },

  onOpenTool(event: WechatMiniprogram.TouchEvent) {
    const dataset = event.currentTarget.dataset as { route?: string; id?: string }
    if (!dataset.route || !dataset.id) {
      return
    }
    const tool = getTool(dataset.id)
    if (tool && tool.network === 'required' && networkStore.offline) {
      tapWarn()
      showGlassToast('当前离线，联网后可打开')
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
    this.refreshTools()
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
