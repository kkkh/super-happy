/* ==========================================================================
   隐私与说明 · 单页静态文案
   - 隐私说明 / 本机数据 / 免责声明 / 开源许可
   - 不跳外链、不收集信息、只读
   ========================================================================== */
import { createStoreBindings } from 'mobx-miniprogram-bindings'
import { uiStore } from '../../../../core/stores/ui'
import { APP_VERSION, PRIVACY_VERSION, TIMING } from '../../../../core/constants/index'
import { TOOLS } from '../../../../core/toolbox/registry'
import { tapSuccess, tapTick, tapWarn } from '../../../../core/utils/haptics'
import { showGlassToast } from '../../../../components/glass-toast/toast'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'

const EMAIL = '56967916@qq.com'
const EFFECTIVE_DATE = '2026 年 11 月 9 日'

interface LegalSection {
  key: string
  title: string
  anchor: string
}

const SECTIONS: LegalSection[] = [
  { key: 'privacy', title: '隐私说明', anchor: 'legal-privacy' },
  { key: 'data', title: '本机数据', anchor: 'legal-data' },
  { key: 'disclaimer', title: '免责声明', anchor: 'legal-disclaimer' },
  { key: 'license', title: '开源许可', anchor: 'legal-license' },
]

interface LegalState {
  themeBindings?: { destroyStoreBindings: () => void }
  scrollTimer: number
  initialAnchor: string
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
    themeClass: uiStore.themeClass,
    sections: SECTIONS,
    active: 'privacy',
    scrollTarget: '',
    email: EMAIL,
    effectiveDate: EFFECTIVE_DATE,
    toolCount: TOOLS.length,
    version: APP_VERSION,
    privacyVersion: PRIVACY_VERSION,
  },

  onLoad(query: Record<string, string | undefined>) {
    const state = this as unknown as LegalState
    state.scrollTimer = 0
    state.initialAnchor = ''
    state.themeBindings = createStoreBindings(this, {
      store: uiStore,
      fields: {
        themeClass: () => uiStore.themeClass,
      },
      actions: [],
    })
    /* 兼容旧链接：既支持 section，也支持早期约定的 type */
    const section = query.section ?? query.type ?? 'privacy'
    const hit = SECTIONS.find((item) => item.key === section) ?? SECTIONS[0]
    state.initialAnchor = hit.key === 'privacy' ? '' : hit.anchor
    this.setData({ active: hit.key })
  },

  onShow() {
    uiStore.syncNativeChrome()
  },

  onReady() {
    const state = this as unknown as LegalState
    if (!state.initialAnchor) {
      return
    }
    this.setData({ scrollTarget: state.initialAnchor })
    state.scrollTimer = setTimeout(() => {
      this.setData({ scrollTarget: '' })
      state.scrollTimer = 0
    }, TIMING.LEGAL_SCROLL_RESET) as unknown as number
  },

  onUnload() {
    const state = this as unknown as LegalState
    if (state.scrollTimer) {
      clearTimeout(state.scrollTimer)
    }
    if (state.themeBindings) {
      state.themeBindings.destroyStoreBindings()
    }
  },

  onNav(event: WechatMiniprogram.TouchEvent) {
    const key = event.currentTarget.dataset.key as string
    const hit = SECTIONS.find((item) => item.key === key)
    if (!hit) {
      return
    }
    tapTick()
    const state = this as unknown as LegalState
    if (state.scrollTimer) {
      clearTimeout(state.scrollTimer)
    }
    this.setData({ active: hit.key, scrollTarget: hit.anchor })
    state.scrollTimer = setTimeout(() => {
      this.setData({ scrollTarget: '' })
      state.scrollTimer = 0
    }, TIMING.LEGAL_SCROLL_RESET) as unknown as number
  },

  onCopyEmail() {
    wx.setClipboardData({
      data: EMAIL,
      success: () => {
        /* 微信系统「内容已复制」无法关闭；按产品要求保留双提示，
           玻璃 Toast 放到屏幕下方 62% 处，避开系统居中提示与底部安全区 */
        wx.hideToast()
        tapSuccess()
        showGlassToast({
          message: '邮箱已复制',
          type: 'success',
          placement: 'lower-center',
          tapToDismiss: true,
        })
        /* 系统提示可能在 success 后才出现，延迟再收一次 */
        setTimeout(() => wx.hideToast(), 80)
      },
      fail: () => {
        tapWarn()
        showGlassToast({
          message: '复制失败，请稍后再试',
          type: 'error',
          placement: 'center',
        })
      },
    })
  },
})
