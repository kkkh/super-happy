/**
 * g-navbar · 自定义导航栏
 * - 沉浸式玻璃材质；右上角与微信胶囊严格对齐
 * - back 模式：系统级返回键，长按弹出返回历史菜单
 * - theme 按钮：三态循环（auto 星光 / light 日 / dark 月），点击有触觉反馈
 * 用法示例：
 *   <g-navbar title="我的项目" back />
 *   <g-navbar transparent theme />
 */
import { createStoreBindings } from 'mobx-miniprogram-bindings'
import { uiStore } from '../../core/stores/ui'
import { tapTick } from '../../core/utils/haptics'
import { ROUTES, ROUTE_TITLES } from '../../core/constants/index'

interface NavbarState {
  storeBindings?: { destroyStoreBindings: () => void }
  /** 长按菜单关闭后的轻触防抖截止时间（ms） */
  tapGuardUntil: number
}

/** 返回历史菜单单项 */
interface HistoryItem {
  title: string
  delta: number
  home: boolean
}

/** 页面栈标题：路由表优先，其次页面的动态标题 */
function titleOfPage(page: WechatMiniprogram.Page.TrivialInstance): string {
  const route = `/${page.route ?? ''}`
  const data = page.data as { project?: { title?: string }; toolName?: string }
  /* 工具箱页面：数据层提供当前工具名，历史菜单可读 */
  if (data.toolName) {
    return data.toolName
  }
  if ((route === ROUTES.worksDetail || route === ROUTES.campusDetail) && data.project?.title) {
    return data.project.title
  }
  if (route === ROUTES.worksList) {
    /* 列表页标题随分类变化：个人作品 / 实际工程 */
    const category = (page.options as Record<string, string> | undefined)?.category
    return category === 'personal' ? '个人作品' : '实际工程'
  }
  return ROUTE_TITLES[route] ?? '上一页'
}

Component({
  properties: {
    title: { type: String, value: '' },
    /** 返回键模式 */
    back: { type: Boolean, value: false },
    /** 透明沉浸（无底材质，叠于英雄图上） */
    transparent: { type: Boolean, value: false },
    /** 只保留状态栏占位，不渲染导航栏（V3 首页 / 工具页自绘导航） */
    bare: { type: Boolean, value: false },
    /** 右侧主题切换钮 */
    theme: { type: Boolean, value: false },
  },

  data: {
    statusBarHeight: 44,
    navHeight: 44,
    themeGlyph: 'spark',
    themeLabel: '外观 · 跟随系统',
  },

  lifetimes: {
    attached() {
      const windowInfo = wx.getWindowInfo()
      const rect = wx.getMenuButtonBoundingClientRect()
      /* 导航内容区高度 = 胶囊高度 + (胶囊顶 - 状态栏) × 2 的呼吸空间 */
      const navHeight = rect.height + (rect.top - windowInfo.statusBarHeight) * 2
      this.setData({
        statusBarHeight: windowInfo.statusBarHeight,
        navHeight,
      })
      const state = this as unknown as NavbarState
      state.tapGuardUntil = 0
      state.storeBindings = createStoreBindings(this, {
        store: uiStore,
        fields: {
          /* 主题模式 → 图形：auto=spark 星光 / light=sun / dark=moon */
          themeGlyph: () => {
            if (uiStore.themeMode === 'light') {
              return 'sun'
            }
            return uiStore.themeMode === 'dark' ? 'moon' : 'spark'
          },
          /* 主题模式 → 无障碍标签（读屏可感知当前外观状态） */
          themeLabel: () => uiStore.themeModeLabel,
        },
        actions: [],
      })
    },
    detached() {
      const state = this as unknown as NavbarState
      if (state.storeBindings) {
        state.storeBindings.destroyStoreBindings()
      }
    },
  },

  pageLifetimes: {
    show() {
      uiStore.syncNativeChrome()
    },
  },

  methods: {
    /*
     * 原实现：轻触直接 tapTick + wx.navigateBack（fail 时 reLaunch '/pages/home/index'）
     * 现保留轻触返回，增加长按菜单防抖，并统一使用 ROUTES 常量
     */
    onBack() {
      const state = this as unknown as NavbarState
      /* 长按菜单结束后系统仍可能补发 tap，防抖避免二次返回 */
      if (Date.now() < state.tapGuardUntil) {
        return
      }
      tapTick()
      wx.navigateBack({
        fail: () => {
          /* 无上级页面时回到前厅 */
          wx.reLaunch({ url: ROUTES.home })
        },
      })
    },

    /** 长按返回键：弹出可读的页面历史菜单 */
    onBackLong() {
      const state = this as unknown as NavbarState
      state.tapGuardUntil = Date.now() + 800
      tapTick()
      const pages = getCurrentPages()
      const currentIndex = pages.length - 1
      if (currentIndex <= 0) {
        uiStore.showToast('已在首页，没有更早的页面')
        return
      }
      const history: HistoryItem[] = []
      for (let i = currentIndex - 1; i >= 0 && history.length < 6; i -= 1) {
        history.push({
          title: titleOfPage(pages[i]),
          delta: currentIndex - i,
          home: i === 0,
        })
      }
      wx.showActionSheet({
        itemList: history.map((item) => `返回「${item.title}」`),
        success: (res) => {
          const target = history[res.tapIndex]
          if (!target) {
            return
          }
          tapTick()
          wx.navigateBack({
            delta: target.delta,
            fail: () => {
              if (target.home) {
                wx.reLaunch({ url: ROUTES.home })
              }
            },
          })
        },
        fail: () => undefined,
      })
    },

    onTheme() {
      tapTick()
      uiStore.cycleTheme()
    },
  },
})
