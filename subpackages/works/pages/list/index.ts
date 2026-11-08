/* ==========================================================================
   作品列表 · 搜索过滤 + 收藏角标 + 封面飞跃
   飞跃策略：作品封面（share-key: fly-work-{id}）→ 详情页英雄封面
   ========================================================================== */
import { createStoreBindings } from 'mobx-miniprogram-bindings'
import { resumeStore } from '../../../../core/stores/resume'
import { uiStore } from '../../../../core/stores/ui'
import { searchProjects } from '../../../../core/services/resume'
import { routeDetail, TIMING } from '../../../../core/constants/index'
import { tapTick } from '../../../../core/utils/haptics'
import { asArray } from '../../../../core/utils/guards'
import type { Project, ProjectCategory } from '../../../../core/types/index'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'

interface ListState {
  storeBindings?: { destroyStoreBindings: () => void }
  themeBindings?: { destroyStoreBindings: () => void }
  searchTimer: number
  /** 搜索请求序号：后发请求覆盖先发请求，丢弃过期结果 */
  searchSeq: number
  /** 导航锁：防止疯狂连点作品卡产生重复详情页 */
  navigating: boolean
}

/** 列表视图模型：收藏/封面失败态预计算，规避 WXML 动态索引与方法调用 */
interface ProjectCard extends Project {
  isFav: boolean
  coverError: boolean
}

function toCards(projects: Project[], favorites: string[]): ProjectCard[] {
  const favs = asArray<string>(favorites)
  return asArray<Project>(projects)
    .filter((project): project is Project => Boolean(project))
    .map((project) => ({
      ...project,
      isFav: favs.includes(project.id),
      coverError: false,
    }))
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
    projects: [] as ProjectCard[],
    keyword: '',
    category: 'actual' as ProjectCategory,
    themeClass: '',
    notFound: false,
    loading: true,
  },

  onLoad(query: Record<string, string | undefined>) {
    const state = this as unknown as ListState
    state.searchTimer = 0
    state.searchSeq = 0
    state.navigating = false
    const category = (query.category === 'personal' ? 'personal' : 'actual') as ProjectCategory
    this.setData({ category })
    state.storeBindings = createStoreBindings(this, {
      store: resumeStore,
      fields: {
        /* 原实现：projects: () => resumeStore.projectsByCategory(category)
           现直接映射为视图模型，收藏态随 Store 变化自动刷新 */
        projects: () =>
          toCards(resumeStore.projectsByCategory(category), resumeStore.favorites),
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
  },

  onReady() {
    /* Store 绑定完成后再撤掉骨架，避免首帧误闪“暂无作品”空态 */
    this.setData({ loading: false })
  },

  onShow() {
    const state = this as unknown as ListState
    state.navigating = false
  },

  onUnload() {
    const state = this as unknown as ListState
    if (state.storeBindings) {
      state.storeBindings.destroyStoreBindings()
    }
    if (state.themeBindings) {
      state.themeBindings.destroyStoreBindings()
    }
    if (state.searchTimer) {
      clearTimeout(state.searchTimer)
    }
    state.searchSeq += 1
  },

  /* ---- 搜索（防抖 + 域接口过滤） ---- */
  onSearchInput(event: WechatMiniprogram.CustomEvent) {
    const keyword = ((event.detail as Record<string, unknown>).value as string) ?? ''
    this.setData({ keyword })
    const state = this as unknown as ListState
    if (state.searchTimer) {
      clearTimeout(state.searchTimer)
    }
    const seq = (state.searchSeq += 1)
    state.searchTimer = setTimeout(() => {
      searchProjects(keyword)
        .then((result) => {
          if (seq !== state.searchSeq) {
            return
          }
          if (!result.ok) {
            uiStore.showToast('搜索失败，请稍后重试')
            return
          }
          /* 搜索结果限定在当前分类内，并补齐收藏/失败态视图字段 */
          const filtered = toCards(
            result.data.filter((p) => p.category === this.data.category),
            resumeStore.favorites,
          )
          this.setData({
            projects: filtered,
            notFound: filtered.length === 0 && keyword.trim() !== '',
          })
        })
        .catch(() => {
          if (seq !== state.searchSeq) {
            return
          }
          uiStore.showToast('搜索失败，请稍后重试')
        })
    }, TIMING.WORKS_SEARCH_DEBOUNCE) as unknown as number
  },

  onClearSearch() {
    tapTick()
    const state = this as unknown as ListState
    if (state.searchTimer) {
      clearTimeout(state.searchTimer)
      state.searchTimer = 0
    }
    state.searchSeq += 1
    this.setData({ keyword: '', notFound: false })
    const category = this.data.category
    this.setData({
      projects: toCards(resumeStore.projectsByCategory(category), resumeStore.favorites),
    })
  },

  /* ---- 打开详情 ---- */
  onOpen(event: WechatMiniprogram.TouchEvent) {
    const state = this as unknown as ListState
    if (state.navigating) {
      return
    }
    state.navigating = true
    tapTick()
    const { id } = event.currentTarget.dataset as { id: string }
    wx.navigateTo({
      url: routeDetail(id),
      fail: () => {
        state.navigating = false
        uiStore.showToast('作品详情加载失败，请稍后重试')
      },
    })
  },

  /* ---- 封面加载失败回退 ---- */
  onCoverError(event: WechatMiniprogram.TouchEvent) {
    const { id } = event.currentTarget.dataset as { id: string }
    /* 原实现：this.setData({ [`coverErrors.${id}`]: true })，依赖 WXML 动态索引
       现直接定位视图模型下标，失败态挂到卡片自身 */
    const index = this.data.projects.findIndex((project) => project.id === id)
    if (index < 0) {
      return
    }
    this.setData({ [`projects[${index}].coverError`]: true })
  },
})
