/* ==========================================================================
   本机存储治理 · 缓存展示 + 最近使用自动清理
   - 只读 wx.getStorageInfoSync，不扫描内容、不上报
   - 自动清理只裁剪 tbx:recent 与时间戳，绝不触碰收藏 / 简历 / 外观
   ========================================================================== */
import { preferenceStore } from '../stores/preference'
import { toolboxStore } from '../toolbox/store'
import { logger } from '../utils/logger'

export interface CacheSummary {
  text: string
  detail: string
  currentKb: number
  keys: number
}

function formatSize(currentKb: number): string {
  if (!Number.isFinite(currentKb) || currentKb <= 0) {
    return '0 KB'
  }
  if (currentKb >= 1024) {
    return `${(currentKb / 1024).toFixed(1)} MB`
  }
  return `${Math.round(currentKb)} KB`
}

/** 设置中心「本机缓存」展示；任何异常都返回可读占位 */
export function readCacheSummary(): CacheSummary {
  try {
    const info = wx.getStorageInfoSync()
    const currentKb =
      typeof info.currentSize === 'number' && Number.isFinite(info.currentSize)
        ? info.currentSize
        : 0
    const keys = Array.isArray(info.keys) ? info.keys.length : 0
    return {
      text: formatSize(currentKb),
      detail: `${keys} 个本机键 · 仅存 id 与偏好`,
      currentKb,
      keys,
    }
  } catch (error) {
    logger.warn('storage', '读取本机缓存信息失败', error)
    return {
      text: '—',
      detail: '存储信息暂不可用',
      currentKb: 0,
      keys: 0,
    }
  }
}

/**
 * 按偏好阈值清理最近使用：
 * - 7 / 30 天：删除超过阈值的记录；
 * - 0：永不清理。
 * 启动、热启动与阈值变更时调用，幂等。
 */
export function applyAutoClean(now: number = Date.now()): number {
  const days = preferenceStore.autoCleanDays
  if (!(days > 0)) {
    return 0
  }
  try {
    const removed = toolboxStore.pruneRecents(days, now)
    if (removed > 0) {
      logger.info('storage', `自动清理最近使用 ${removed} 条（阈值 ${days} 天）`)
    }
    return removed
  } catch (error) {
    logger.warn('storage', '自动清理最近使用失败', error)
    return 0
  }
}
