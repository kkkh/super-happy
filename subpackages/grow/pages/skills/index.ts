/* ==========================================================================
   技能矩阵 · 分段控件 + 量表重播
   ========================================================================== */
import { createStoreBindings } from 'mobx-miniprogram-bindings'
import { uiStore } from '../../../../core/stores/ui'
import { fontScaleClass, syncFontScaleClass } from '../../../../core/services/font-scale'
import { fetchSkills } from '../../../../core/services/resume'
import { tapTick } from '../../../../core/utils/haptics'
import type { SkillGroup } from '../../../../core/types/index'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'

interface SkillsState {
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
    groups: [] as SkillGroup[],
    /* 原实现：WXML 直接 groups[activeIndex].items / .kicker 动态取值
       现预计算当前分组，规避动态索引 */
    activeGroup: null as SkillGroup | null,
    activeIndex: 0,
    themeClass: '',
    fsClass: fontScaleClass(),
    loading: true,
  },

  onLoad() {
    const state = this as unknown as SkillsState
    state.destroyed = false
    state.themeBindings = createStoreBindings(this, {
      store: uiStore,
      fields: {
        themeClass: () => uiStore.themeClass,
      },
      actions: [],
    })
    fetchSkills()
      .then((result) => {
        if (state.destroyed) {
          return
        }
        const groups = result.ok ? result.data : []
        this.setData({
          groups,
          activeGroup: groups.length ? groups[0] : null,
          loading: false,
        })
        if (!result.ok) {
          uiStore.showToast('技能内容加载失败，请稍后重试')
        }
      })
      .catch(() => {
        if (state.destroyed) {
          return
        }
        this.setData({ loading: false })
        uiStore.showToast('技能内容加载失败，请稍后重试')
      })
  },

  onShow() {
    this.setData({ fsClass: syncFontScaleClass() })
  },

  onUnload() {
    const state = this as unknown as SkillsState
    state.destroyed = true
    if (state.themeBindings) {
      state.themeBindings.destroyStoreBindings()
    }
  },

  /* 分段切换：量表随切换重播 */
  onSwitch(event: WechatMiniprogram.TouchEvent) {
    const { index } = event.currentTarget.dataset as { index: number }
    const next = Number(index)
    if (next === this.data.activeIndex) {
      return
    }
    tapTick()
    this.setData({
      activeIndex: next,
      activeGroup: this.data.groups[next] ?? null,
    })
  },
})
