/* ==========================================================================
   作品详情 · 英雄封面飞跃 + 量化指标 + 收藏 + 视觉档案
   飞跃承接：列表页封面（share-key: fly-work-{id}）→ 本页英雄区
   ========================================================================== */
import { createStoreBindings } from 'mobx-miniprogram-bindings'
import { resumeStore } from '../../../../core/stores/resume'
import { uiStore } from '../../../../core/stores/ui'
import { fetchProjectById, galleryCount } from '../../../../core/services/resume'
import { tapSuccess, tapTick, tapWarn } from '../../../../core/utils/haptics'
import type { Project } from '../../../../core/types/index'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'

interface DetailState {
  storeBindings?: { destroyStoreBindings: () => void }
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
    project: null as Project | null,
    notFound: false,
    isFavorite: false,
    shotCount: 0,
    themeClass: '',
    isDark: uiStore.resolvedTheme === 'dark',
    coverError: false,
  },

  onLoad(query: Record<string, string | undefined>) {
    const state = this as unknown as DetailState
    state.destroyed = false
    const id = query.id ?? ''
    state.storeBindings = createStoreBindings(this, {
      store: resumeStore,
      fields: {
        isFavorite: () => resumeStore.isFavorite(id),
      },
      actions: [],
    })
    state.themeBindings = createStoreBindings(this, {
      store: uiStore,
      fields: {
        themeClass: () => uiStore.themeClass,
        isDark: () => uiStore.resolvedTheme === 'dark',
      },
      actions: [],
    })
    fetchProjectById(id)
      .then((result) => {
        if (state.destroyed) {
          return
        }
        if (result.ok) {
          this.setData({
            project: result.data,
            shotCount: galleryCount(result.data.gallery),
          })
        } else {
          this.setData({ notFound: true })
          uiStore.showToast('作品详情加载失败，请稍后重试')
        }
      })
      .catch(() => {
        if (state.destroyed) {
          return
        }
        this.setData({ notFound: true })
        uiStore.showToast('作品详情加载失败，请稍后重试')
      })
  },

  onUnload() {
    const state = this as unknown as DetailState
    state.destroyed = true
    if (state.storeBindings) {
      state.storeBindings.destroyStoreBindings()
    }
    if (state.themeBindings) {
      state.themeBindings.destroyStoreBindings()
    }
  },

  /* ---- 收藏切换（可撤销：toast 提示 + 再点即恢复） ---- */
  onToggleFavorite() {
    const project = this.data.project
    if (!project) {
      return
    }
    const added = resumeStore.toggleFavorite(project.id)
    if (added === null) {
      tapWarn()
      uiStore.showToast('收藏失败，请重试')
      return
    }
    this.setData({ isFavorite: added })
    if (added) {
      tapSuccess()
      uiStore.showToast('已收入囊中')
    } else {
      tapTick()
      uiStore.showToast('已移出收藏')
    }
  },

  /* ---- 封面加载失败回退 ---- */
  onCoverError() {
    this.setData({ coverError: true })
  },
})
