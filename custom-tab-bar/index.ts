/**
 * custom-tab-bar · 工具箱底部导航
 * - 原生 TabBar 在 Skyline 下无法稳定切换深色背景，改为轻量自定义
 * - 图标复用 g-icon 字体；胶囊昼夜两套材质：白昼纸面 / 夜航深玻璃
 * - 页面 onShow 通过 getTabBar().setData({ selected }) 同步选中态
 */
import { createStoreBindings } from 'mobx-miniprogram-bindings'
import { tapTick } from '../core/utils/haptics'
import { uiStore } from '../core/stores/ui'
import { ROUTES } from '../core/constants/index'

interface TabItem {
  pagePath: string
  text: string
  icon: string
}

interface TabBarState {
  /** 切换锁：防止疯狂连点 Tab 触发多次 switchTab */
  switching: boolean
  themeBindings?: { destroyStoreBindings: () => void }
}

const ITEMS: TabItem[] = [
  { pagePath: ROUTES.home, text: '工具', icon: 'grid' },
  { pagePath: ROUTES.favorites, text: '收藏', icon: 'heart' },
  { pagePath: ROUTES.mine, text: '我的', icon: 'user' },
]

Component({
  data: {
    items: ITEMS,
    selected: 0,
    isDark: uiStore.resolvedTheme === 'dark',
  },

  lifetimes: {
    attached() {
      const state = this as unknown as TabBarState
      state.switching = false
      state.themeBindings = createStoreBindings(this, {
        store: uiStore,
        fields: {
          isDark: () => uiStore.resolvedTheme === 'dark',
        },
        actions: [],
      })
      const pages = getCurrentPages()
      const route = pages.length ? pages[pages.length - 1].route : ''
      const index = ITEMS.findIndex((item) => item.pagePath === `/${route}`)
      if (index > 0) {
        this.setData({ selected: index })
      }
    },

    detached() {
      const state = this as unknown as TabBarState
      if (state.themeBindings) {
        state.themeBindings.destroyStoreBindings()
      }
    },
  },

  pageLifetimes: {
    show() {
      const state = this as unknown as TabBarState
      state.switching = false
    },
  },

  methods: {
    onTap(event: WechatMiniprogram.TouchEvent) {
      const index = Number(event.currentTarget.dataset.index)
      const item = ITEMS[index]
      if (!item || index === this.data.selected) {
        return
      }
      const state = this as unknown as TabBarState
      if (state.switching) {
        return
      }
      state.switching = true
      tapTick()
      const previous = this.data.selected
      this.setData({ selected: index })
      wx.switchTab({
        url: item.pagePath,
        fail: () => {
          this.setData({ selected: previous })
          uiStore.showToast('页面切换失败，请重试')
        },
        /* 自定义 tabBar 是全局单实例，pageLifetimes.show 不会随 switchTab 触发；
           锁必须在 complete 释放，否则首次切换后其余 Tab 全部被拦截 */
        complete: () => {
          state.switching = false
        },
      })
    },
  },
})
