/* ==========================================================================
   工具箱本地存储 · tbx: 命名空间
   - 与简历的 gallery.* 完全隔离；清空只删 tbx: 前缀
   - 工具 id / 偏好 / 提示关闭状态 / 本机计算轨迹摘要
   - 轨迹只存摘要（最多 100 条），不存原始图片，不上传
   ========================================================================== */
import { STORAGE_KEYS } from '../constants/index'

const NS = 'tbx:'

export const TBX_KEYS = {
  recent: `${NS}recent`,
  /** 最近使用时间戳：id → 毫秒；只用于自动清理，不参与 UI */
  recentAt: `${NS}recent.at`,
  favorites: `${NS}favorites`,
  /** 累计打开工具次数：只增不减，用于首页数据看板 */
  usage: `${NS}usage`,
  /** 本机计算轨迹：最多 100 条摘要，用于数据驾驶舱 */
  history: `${NS}history`,
  /** Workflow 快捷管道记忆：A → B 成功流转次数 */
  workflowPipes: `${NS}workflow.pipes`,
  /** Workflow 孤儿图片回收队列：跨启动恢复，防止 saveFile 产物永久残留 */
  workflowGarbage: `${NS}workflow.garbage`,
  prefs: `${NS}prefs`,
  /** 搜索历史：最多 8 条纯文本关键词，仅本机 */
  searchHistory: `${NS}searchHistory`,
  /** 首页使用指南横幅关闭状态 */
  helpBannerDismissed: `${NS}helpBannerDismissed`,
  ackFinance: `${NS}ack.finance.v1`,
  ackHealth: `${NS}ack.health.v1`,
  legacyTip: `${NS}legacy-tip`,
  legacyTipHome: `${NS}legacy-tip-home`,
} as const

/** 收藏上限 */
export const MAX_FAVORITES = 100
/** 最近使用上限 */
export const MAX_RECENTS = 12
/** 搜索历史上限 */
export const MAX_SEARCH_HISTORY = 8

export function readStorage(key: string): unknown {
  try {
    return wx.getStorageSync(key)
  } catch {
    return undefined
  }
}

export function writeStorage(key: string, value: unknown): boolean {
  try {
    wx.setStorageSync(key, value)
    return true
  } catch {
    // 存储不可用时由调用方回滚
    return false
  }
}

/** 删除单个键；历史轨迹在清空工具数据时需要即时取消在途写入 */
export function removeStorage(key: string): boolean {
  try {
    wx.removeStorageSync(key)
    return true
  } catch {
    return false
  }
}

/** 读取字符串数组；兼容历史字符串 JSON，坏数据直接丢弃 */
export function readIdList(key: string): string[] {
  const raw = readStorage(key)
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === 'string')
  }
  if (typeof raw === 'string' && raw) {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === 'string')
      }
    } catch {
      return []
    }
  }
  return []
}

export function writeIdList(key: string, ids: string[], limit: number): boolean {
  return writeStorage(key, ids.slice(0, limit))
}

/** 读取时间戳映射；坏值逐项丢弃，整体失败返回空对象 */
export function readTimestampMap(key: string): Record<string, number> {
  const raw = readStorage(key)
  let parsed: unknown = raw
  if (typeof raw === 'string') {
    if (!raw) {
      return {}
    }
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      return {}
    }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {}
  }

  const out: Record<string, number> = {}
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof id === 'string' && id && typeof value === 'number' && Number.isFinite(value) && value > 0) {
      out[id] = value
    }
  }
  return out
}

export function writeTimestampMap(key: string, map: Record<string, number>): boolean {
  return writeStorage(key, map)
}

/** 读取非负整型计数；坏数据 / 负数 / 非数字一律回 0 */
export function readCount(key: string): number {
  const raw = readStorage(key)
  const value = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

export function writeCount(key: string, value: number): boolean {
  return writeStorage(key, Math.max(0, Math.floor(value)))
}

function readFlag(key: string): boolean {
  return readStorage(key) === true
}

function writeFlag(key: string, value: boolean): boolean {
  return writeStorage(key, value)
}

/** 旧作品收藏数量（只读 gallery.*，绝不改写） */
function legacyFavoriteCount(): number {
  const raw = readStorage(STORAGE_KEYS.favorites)
  if (Array.isArray(raw)) {
    return raw.length
  }
  return 0
}

/** 首页一次性提示：检测到旧作品收藏且用户尚未关闭 */
export function shouldShowLegacyHomeTip(): boolean {
  return legacyFavoriteCount() > 0 && !readFlag(TBX_KEYS.legacyTipHome)
}

export function dismissLegacyHomeTip(): void {
  writeFlag(TBX_KEYS.legacyTipHome, true)
}

/** 本机工具数据键（清空与调试展示用） */
function toolboxStorageKeys(): string[] {
  try {
    return wx.getStorageInfoSync().keys.filter((key) => key.startsWith(NS))
  } catch {
    return []
  }
}

/** 一键清空：只删除 tbx:*，不触碰 gallery.* */
export function clearToolboxData(): number {
  const keys = toolboxStorageKeys()
  let removed = 0
  keys.forEach((key) => {
    try {
      wx.removeStorageSync(key)
      removed += 1
    } catch {
      // 单个键失败不影响其它键
    }
  })
  return removed
}
