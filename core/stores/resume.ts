/* ==========================================================================
   简历域 Store · 领域状态唯一真相源
   - 数据经 Service 原子接口装载（页面禁止直连数据层）
   - 收藏态持久化至本地存储；启动恢复
   ========================================================================== */
import { observable } from 'mobx-miniprogram'
import type { HomeEntry, Profile, Project, ProjectCategory } from '../types/index'
import { STORAGE_KEYS } from '../constants/index'
import {
  fetchHomeEntries,
  fetchProfile,
  fetchProjects,
} from '../services/resume'
import { logger } from '../utils/logger'
import { asArray } from '../utils/guards'

/** 启动装载去重：并发调用共享同一 Promise，成功后再调用直接命中缓存 */
let bootPromise: Promise<void> | null = null
let booted = false
/** 作品收藏上限：防止本地存储被写入超长数组拖慢渲染 */
const MAX_WORK_FAVORITES = 200

export const resumeStore = observable({
  /* ---- 领域数据 ---- */
  profile: null as Profile | null,
  entries: [] as HomeEntry[],
  projects: [] as Project[],

  /* ---- 收藏（id 集合，持久化） ---- */
  favorites: [] as string[],
  favoritesInited: false,

  /** 启动装载：profile + 入口星表 + 作品全集（本地数据瞬回）
   *  并发调用共享同一 Promise；全部成功后命中缓存，失败清空以便重试 */
  bootstrap(): Promise<void> {
    if (booted) {
      return Promise.resolve()
    }
    if (bootPromise) {
      return bootPromise
    }
    bootPromise = (async () => {
      this.restoreFavorites()
      const [profileRes, entriesRes, projectsRes] = await Promise.all([
        fetchProfile(),
        fetchHomeEntries(),
        fetchProjects(),
      ])
      if (profileRes.ok) {
        this.profile = profileRes.data
      } else {
        logger.error('store', 'profile 装载失败', profileRes.error)
      }
      if (entriesRes.ok) {
        this.entries = entriesRes.data
      }
      if (projectsRes.ok) {
        this.projects = projectsRes.data
      }
      booted = profileRes.ok && entriesRes.ok && projectsRes.ok
    })().finally(() => {
      bootPromise = null
    })
    return bootPromise
  },

  /** 按分类取作品 */
  projectsByCategory(category: ProjectCategory): Project[] {
    return asArray<Project>(this.projects).filter((p) => p?.category === category)
  },

  /** 按 id 取作品 */
  projectById(id: string): Project | null {
    return asArray<Project>(this.projects).find((p) => p?.id === id) ?? null
  },

  /* ---- 收藏能力 ---- */
  /**
   * 收藏本地缓存的信任边界：
   * 1. Storage 视为不可信输入（可能被篡改、旧版本写坏或类型漂移）：
   *    只接受 string、trim 后非空、长度 ≤64、去重、最多 200 条；
   * 2. toggle 先改 observable，让 UI 立即响应，再同步写 setStorageSync；
   * 3. 写入抛错时回滚到 previous 并返回 null，调用方负责震动+提示，
   *    保证 UI 不会停留在“看起来收藏成功、实际没落盘”的错误状态。
   */
  restoreFavorites(): void {
    if (this.favoritesInited) {
      return
    }
    this.favoritesInited = true
    try {
      const saved = wx.getStorageSync(STORAGE_KEYS.favorites) as unknown
      if (Array.isArray(saved)) {
        /* 不信任本地缓存：只接受短字符串 id，去重并限长 */
        const unique: string[] = []
        const seen = new Set<string>()
        for (const item of saved) {
          if (typeof item !== 'string') {
            continue
          }
          const id = item.trim()
          if (!id || id.length > 64 || seen.has(id)) {
            continue
          }
          seen.add(id)
          unique.push(id)
          if (unique.length >= MAX_WORK_FAVORITES) {
            break
          }
        }
        this.favorites = unique
      }
    } catch {
      // 存储不可用时仅会话内生效
    }
  },

  isFavorite(id: string): boolean {
    return this.favorites.includes(id)
  },

  /** 收藏计数（hub 页徽标） */
  get favoriteCount(): number {
    return this.favorites.length
  },

  toggleFavorite(id: string): boolean | null {
    const previous = this.favorites
    const hit = previous.includes(id)
    this.favorites = hit
      ? previous.filter((f) => f !== id)
      : [id, ...previous].slice(0, MAX_WORK_FAVORITES)
    try {
      wx.setStorageSync(STORAGE_KEYS.favorites, this.favorites)
    } catch {
      /* 乐观更新失败回滚，UI 保持切换前状态 */
      this.favorites = previous
      return null
    }
    logger.info('store', `收藏 ${id} → ${hit ? '移除' : '落定'}`)
    return !hit
  },
})
