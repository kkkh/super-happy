/* ==========================================================================
   工具箱 Store · 收藏 / 最近使用（会话态 + 本地持久化）
   - 只存工具 id；读取时过滤下线 id
   - 与 resumeStore 完全独立，互不读写
   ========================================================================== */
import { observable } from 'mobx-miniprogram'
import { TOOL_IDS, toolsFromIds } from './registry'
import { pruneRecentIds } from './retention'
import { historyStore } from '../stores/history'
import { purgeHistoryFromSnapshots } from './history-snapshots'
import {
  MAX_FAVORITES,
  MAX_RECENTS,
  TBX_KEYS,
  clearToolboxData,
  readCount,
  readIdList,
  readTimestampMap,
  writeCount,
  writeIdList,
  writeTimestampMap,
} from './storage'
import type { FavoriteToggleResult, ToolMeta } from './types'

function sanitize(ids: string[]): string[] {
  const seen = new Set<string>()
  return ids.filter((id) => {
    if (!TOOL_IDS.has(id) || seen.has(id)) {
      return false
    }
    seen.add(id)
    return true
  })
}

export const toolboxStore = observable({
  favorites: [] as string[],
  recents: [] as string[],
  /** 最近使用时间戳；缺失时按启动时间补齐，升级不误删 */
  recentAt: {} as Record<string, number>,
  /** 累计打开工具次数：不受最近列表 12 个上限影响 */
  usageCount: 0,
  inited: false,

  /** 启动调用一次：恢复收藏与最近使用 */
  init(): void {
    if (this.inited) {
      return
    }
    this.inited = true
    this.favorites = sanitize(readIdList(TBX_KEYS.favorites)).slice(0, MAX_FAVORITES)
    this.recents = sanitize(readIdList(TBX_KEYS.recent)).slice(0, MAX_RECENTS)
    this.usageCount = readCount(TBX_KEYS.usage)

    const stored = readTimestampMap(TBX_KEYS.recentAt)
    const now = Date.now()
    const next: Record<string, number> = {}
    let changed = false

    for (const id of this.recents) {
      const at = stored[id]
      if (typeof at === 'number' && Number.isFinite(at) && at > 0) {
        next[id] = at
      } else {
        next[id] = now
        changed = true
      }
    }
    if (Object.keys(stored).length !== Object.keys(next).length) {
      changed = true
    }
    this.recentAt = next
    if (changed) {
      writeTimestampMap(TBX_KEYS.recentAt, next)
    }
  },

  isFavorite(id: string): boolean {
    return this.favorites.includes(id)
  },

  /** 新收藏置顶；满额返回 full，不挤出旧项；落盘失败回滚并返回 failed */
  toggleFavorite(id: string): FavoriteToggleResult {
    if (!TOOL_IDS.has(id)) {
      return 'invalid'
    }
    const previous = this.favorites
    const hit = previous.includes(id)
    if (!hit && previous.length >= MAX_FAVORITES) {
      return 'full'
    }
    this.favorites = hit
      ? previous.filter((item) => item !== id)
      : [id, ...previous]
    if (!writeIdList(TBX_KEYS.favorites, this.favorites, MAX_FAVORITES)) {
      this.favorites = previous
      return 'failed'
    }
    return hit ? 'removed' : 'added'
  },

  /** 批量移除收藏；返回是否落盘成功 */
  removeFavorites(ids: string[]): boolean {
    if (ids.length === 0) {
      return true
    }
    const next = this.favorites.filter((item) => !ids.includes(item))
    if (next.length === this.favorites.length) {
      return true
    }
    const previous = this.favorites
    this.favorites = next
    if (!writeIdList(TBX_KEYS.favorites, next, MAX_FAVORITES)) {
      this.favorites = previous
      return false
    }
    return true
  },

  /** 清空收藏；返回是否落盘成功 */
  clearFavorites(): boolean {
    if (this.favorites.length === 0) {
      return true
    }
    const previous = this.favorites
    this.favorites = []
    if (!writeIdList(TBX_KEYS.favorites, [], MAX_FAVORITES)) {
      this.favorites = previous
      return false
    }
    return true
  },

  recordRecent(id: string): void {
    if (!TOOL_IDS.has(id)) {
      return
    }
    const now = Date.now()
    this.recents = [id, ...this.recents.filter((item) => item !== id)].slice(0, MAX_RECENTS)
    this.recentAt = {
      ...this.recentAt,
      [id]: now,
    }
    /* 时间戳只保留当前列表内的 id，避免历史键无限膨胀 */
    const nextTimes: Record<string, number> = {}
    this.recents.forEach((item) => {
      nextTimes[item] = item === id ? now : (this.recentAt[item] ?? now)
    })
    this.recentAt = nextTimes
    writeIdList(TBX_KEYS.recent, this.recents, MAX_RECENTS)
    writeTimestampMap(TBX_KEYS.recentAt, this.recentAt)
  },

  /** 工具页真正打开一次：累计打开 +1，再刷新最近列表 */
  recordOpen(id: string): void {
    if (!TOOL_IDS.has(id)) {
      return
    }
    this.usageCount += 1
    writeCount(TBX_KEYS.usage, this.usageCount)
    this.recordRecent(id)
  },

  /** 只清空最近使用与时间戳，不动收藏 */
  clearRecents(): boolean {
    this.recents = []
    this.recentAt = {}
    const listOk = writeIdList(TBX_KEYS.recent, [], MAX_RECENTS)
    const timeOk = writeTimestampMap(TBX_KEYS.recentAt, {})
    return listOk && timeOk
  },

  /** 按偏好阈值裁剪过期记录；返回删除条数 */
  pruneRecents(days: number, now: number = Date.now()): number {
    const result = pruneRecentIds(this.recents, this.recentAt, days, now)
    if (result.removed.length === 0) {
      return 0
    }
    this.recents = result.ids
    this.recentAt = result.recentAt
    writeIdList(TBX_KEYS.recent, this.recents, MAX_RECENTS)
    writeTimestampMap(TBX_KEYS.recentAt, this.recentAt)
    return result.removed.length
  },

  favoriteTools(): ToolMeta[] {
    return toolsFromIds(this.favorites)
  },

  recentTools(): ToolMeta[] {
    return toolsFromIds(this.recents)
  },

  get favoriteCount(): number {
    return this.favorites.length
  },

  /** 一键清空：只删 tbx:*，同步清空会话态与快照中的历史副本 */
  clearAll(): number {
    /* 先取消历史轨迹的在途防抖写入并清内存，再由 storage 层统一删 tbx:* */
    historyStore.clearMemory()
    purgeHistoryFromSnapshots()
    this.favorites = []
    this.recents = []
    this.recentAt = {}
    this.usageCount = 0
    return clearToolboxData()
  },
})
