/* ==========================================================================
   我的 · 关于作者 / 外观 / 数据与隐私 / 版本
   - 不读取简历 Store；关于作者仅做路由跳转
   - 清空只删 tbx:*，保留简历、作品收藏与外观设置
   ========================================================================== */
import { createStoreBindings } from 'mobx-miniprogram-bindings'
import { uiStore } from '../../core/stores/ui'
import { toolboxStore } from '../../core/toolbox/store'
import { selectTabBar } from '../../core/toolbox/tabbar'
import { tapSuccess, tapTick, tapWarn } from '../../core/utils/haptics'
import { ROUTES, ACTION_COLORS, APP_VERSION } from '../../core/constants/index'
import { TOOLS } from '../../core/toolbox/registry'
import { showGlassToast } from '../../components/glass-toast/toast'
import type { ThemeMode } from '../../core/types/index'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../core/toolbox/share'
import { fontScaleClass, syncFontScaleClass } from '../../core/services/font-scale'

const FEEDBACK_EMAIL = '56967916@qq.com'

type MineToastType = 'info' | 'success' | 'error'

/** 我的页有底部 Dock，Toast 统一下移到 Dock 上方、系统提示下方 */
function showMineToast(message: string, type: MineToastType = 'info'): void {
  showGlassToast({ message, type, placement: 'lower-center', tapToDismiss: true })
}

interface MineState {
  themeBindings?: { destroyStoreBindings: () => void }
  storeBindings?: { destroyStoreBindings: () => void }
}

interface ThemeOption {
  key: ThemeMode
  label: string
}

const THEME_INDEX: Record<ThemeMode, number> = { light: 0, dark: 1, auto: 2 }

/** 分段下方的解释文案：自动模式必须交代当前实际生效的外观 */
function themeHintOf(): string {
  if (uiStore.themeMode === 'auto') {
    return `跟随系统 · 当前${uiStore.resolvedThemeLabel}`
  }
  return uiStore.themeMode === 'dark' ? '已锁定夜航' : '已锁定白昼'
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
    fsClass: fontScaleClass(),
    isDark: uiStore.resolvedTheme === 'dark',
    themeMode: uiStore.themeMode,
    themeIndex: THEME_INDEX[uiStore.themeMode],
    themeHint: themeHintOf(),
    favoriteCount: toolboxStore.favoriteCount,
    toolCount: TOOLS.length,
    version: APP_VERSION,
    email: FEEDBACK_EMAIL,
    themes: [
      { key: 'light', label: '白昼' },
      { key: 'dark', label: '夜航' },
      { key: 'auto', label: '自动' },
    ] as ThemeOption[],
  },

  onLoad() {
    const state = this as unknown as MineState
    toolboxStore.init()
    state.themeBindings = createStoreBindings(this, {
      store: uiStore,
      fields: {
        themeClass: () => uiStore.themeClass,
        themeSwitching: () => uiStore.themeSwitching,
        isDark: () => uiStore.resolvedTheme === 'dark',
        themeMode: () => uiStore.themeMode,
        themeIndex: () => THEME_INDEX[uiStore.themeMode],
        themeHint: () => themeHintOf(),
      },
      actions: [],
    })
    state.storeBindings = createStoreBindings(this, {
      store: toolboxStore,
      fields: {
        favoriteCount: () => toolboxStore.favoriteCount,
      },
      actions: [],
    })
  },

  onShow() {
    this.setData({ fsClass: syncFontScaleClass() })
    selectTabBar(this, 2)
    uiStore.syncNativeChrome()
  },

  onUnload() {
    const state = this as unknown as MineState
    if (state.themeBindings) {
      state.themeBindings.destroyStoreBindings()
    }
    if (state.storeBindings) {
      state.storeBindings.destroyStoreBindings()
    }
  },

  onTheme(event: WechatMiniprogram.TouchEvent) {
    const mode = event.currentTarget.dataset.mode as ThemeMode
    if (!mode || mode === this.data.themeMode) {
      return
    }
    tapTick()
    uiStore.setThemeMode(mode)
  },

  onOpenAuthor() {
    tapTick()
    wx.navigateTo({
      url: ROUTES.growHome,
      fail: () => {
        showMineToast('简历加载失败，请稍后重试', 'error')
      },
    })
  },

  onOpenLegal(event: WechatMiniprogram.TouchEvent) {
    const section = (event.currentTarget.dataset.section as string) || 'privacy'
    tapTick()
    wx.navigateTo({
      url: `${ROUTES.legal}?section=${section}`,
      fail: () => {
        showMineToast('页面打开失败，请稍后重试', 'error')
      },
    })
  },

  /* 此处是处理设置中心入口与分包路由失败的边界 */
  onOpenSettings() {
    tapTick()
    wx.navigateTo({
      url: ROUTES.settings,
      fail: () => {
        showMineToast('设置中心加载失败，请稍后重试', 'error')
      },
    })
  },

  onOpenCockpit() {
    tapTick()
    wx.navigateTo({
      url: ROUTES.cockpit,
      fail: () => {
        showMineToast('数据驾驶舱加载失败，请稍后重试', 'error')
      },
    })
  },

  onOpenHelp() {
    tapTick()
    wx.navigateTo({
      url: ROUTES.help,
      fail: () => {
        showMineToast('使用指南加载失败，请稍后重试', 'error')
      },
    })
  },

  onCopyEmail() {
    wx.setClipboardData({
      data: FEEDBACK_EMAIL,
      success: () => {
        /* 收起系统自带的「内容已复制」，避免与品牌 Toast 叠层 */
        wx.hideToast()
        tapSuccess()
        showMineToast('邮箱已复制', 'success')
        setTimeout(() => wx.hideToast(), 80)
      },
      fail: () => {
        showMineToast('复制失败，请稍后再试', 'error')
      },
    })
  },

  onClearData() {
    tapWarn()
    wx.showModal({
      title: '清空工具数据',
      content: '将清空最近使用、工具收藏、打开次数、当前计算轨迹、快照中的历史轨迹、快捷管道与提示状态，操作不可恢复；专注记录、天气缓存、简历、作品收藏、外观与偏好设置不受影响。',
      confirmText: '确认清空',
      confirmColor: ACTION_COLORS.danger,
      cancelText: '取消',
      cancelColor: ACTION_COLORS.safe,
      success: (result) => {
        if (!result.confirm) {
          return
        }
        const removed = toolboxStore.clearAll()
        showMineToast(
          removed > 0 ? '本机工具数据已清空' : '暂无工具数据可清空',
          removed > 0 ? 'success' : 'info',
        )
      },
    })
  },
})
