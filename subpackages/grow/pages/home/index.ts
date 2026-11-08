/* ==========================================================================
   简历首页 · 展馆前厅（由主包迁移至 grow 分包）
   入口：我的 → 关于作者；返回键可回工具箱
   飞跃策略：入口「您好」的图标环 share-element（fly-entry-greeting）
   → 序厅页顶徽章；其余入口直切（目标页无徽章承接）
   ========================================================================== */
import { createStoreBindings } from 'mobx-miniprogram-bindings'
import { resumeStore } from '../../../../core/stores/resume'
import { uiStore } from '../../../../core/stores/ui'
import { fetchStats } from '../../../../core/services/resume'
import { tapTick } from '../../../../core/utils/haptics'
import type { HomeEntry, StatItem } from '../../../../core/types/index'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'

interface HomeState {
  storeBindings?: { destroyStoreBindings: () => void }
  themeBindings?: { destroyStoreBindings: () => void }
  /** 导航锁：防止疯狂连点入口卡产生重复页面栈 */
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
    entries: [] as HomeEntry[],
    profileName: '秦超',
    profileAlias: '净忻',
    profileMotto: '有志者事竟成。',
    heroLine: '秦超 · 作品集 2026',
    locationText: '山西 · 太原 · 迎泽',
    stats: [] as StatItem[],
    indexCount: '05',
    themeClass: '',
  },

  onLoad() {
    const state = this as unknown as HomeState
    state.navigating = false
    state.destroyed = false
    state.storeBindings = createStoreBindings(this, {
      store: resumeStore,
      fields: {
        entries: () => resumeStore.entries,
        profileName: () => resumeStore.profile?.name ?? '秦超',
        profileAlias: () => resumeStore.profile?.alias ?? '净忻',
        profileMotto: () => resumeStore.profile?.motto ?? '有志者事竟成。',
        heroLine: () => resumeStore.profile?.heroLine ?? '秦超 · 作品集 2026',
        locationText: () =>
          resumeStore.profile ? resumeStore.profile.location.join(' · ') : '山西 · 太原 · 迎泽',
        indexCount: () => {
          const count = resumeStore.entries.length
          if (!count) {
            return '05'
          }
          return count < 10 ? `0${count}` : String(count)
        },
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
    /* 数字速览：独立域接口，本地瞬回 */
    fetchStats()
      .then((result) => {
        if (state.destroyed) {
          return
        }
        if (result.ok) {
          this.setData({ stats: result.data })
        } else {
          uiStore.showToast('数字速览加载失败')
        }
      })
      .catch(() => {
        if (state.destroyed) {
          return
        }
        uiStore.showToast('数字速览加载失败')
      })
  },

  onShow() {
    const state = this as unknown as HomeState
    state.navigating = false
  },

  onUnload() {
    const state = this as unknown as HomeState
    state.destroyed = true
    if (state.storeBindings) {
      state.storeBindings.destroyStoreBindings()
    }
    if (state.themeBindings) {
      state.themeBindings.destroyStoreBindings()
    }
  },

  onEnter(event: WechatMiniprogram.TouchEvent) {
    const state = this as unknown as HomeState
    if (state.navigating) {
      return
    }
    state.navigating = true
    tapTick()
    const route = event.currentTarget.dataset.route as string
    wx.navigateTo({
      url: route,
      fail: () => {
        state.navigating = false
        uiStore.showToast('页面加载失败，请稍后重试')
      },
    })
  },
})
