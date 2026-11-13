/* ==========================================================================
   device-tier · 设备性能档位与动效上限
   - 档位来源优先级：调试强制 > 本地缓存 > 同步内存启发 > 默认高档
   - 异步部分用 wx.getDeviceBenchmarkInfo（3.4.5+，iOS/Android 均支持）精修
   - 检测失败、档位未知一律回退高档：绝不误降级正常设备
   - 只读设备信息，不写业务数据，不改用户偏好
   ========================================================================== */
import type { MotionLevel } from '../stores/preference'

export type DeviceTier = 'high' | 'mid' | 'low'
export type EffectiveMotion = 'full' | 'lite' | 'saver'

export const TIER_CACHE_KEY = 'device:tier.v1'
export const TIER_FORCE_KEY = 'device:forceTier'
export const TIER_HINT_DISMISS_KEY = 'device:tier.hintDismissed.v1'

const MOTION_RANK: Record<EffectiveMotion, number> = { saver: 1, lite: 2, full: 3 }

function readStorage<T>(key: string, fallback: T): T {
  try {
    if (typeof wx === 'undefined') {
      return fallback
    }
    const raw: unknown = wx.getStorageSync(key)
    return raw === '' || raw === undefined || raw === null ? fallback : (raw as T)
  } catch {
    return fallback
  }
}

function writeStorage(key: string, value: unknown): void {
  try {
    if (typeof wx === 'undefined') {
      return
    }
    wx.setStorage({ key, data: value, fail: () => undefined })
  } catch {
    /* 缓存失败不影响业务 */
  }
}

/** 机型档位：1 高档 / 2 中档 / 3 低档；0 或未知返回 null */
export function tierFromModelLevel(level: number): DeviceTier | null {
  if (level === 1) {
    return 'high'
  }
  if (level === 2) {
    return 'mid'
  }
  if (level === 3) {
    return 'low'
  }
  return null
}

/** 性能分兜底：≥20 高，10–19 中，1–9 低；-1/0 未知 */
export function tierFromBenchmark(level: number): DeviceTier | null {
  if (!Number.isFinite(level) || level <= 0) {
    return null
  }
  if (level >= 20) {
    return 'high'
  }
  if (level >= 10) {
    return 'mid'
  }
  return 'low'
}

/** 内存兜底（MB）：≥4096 高，3072–4095 中，<3072 低 */
export function tierFromMemory(memorySizeMb: number): DeviceTier | null {
  if (!Number.isFinite(memorySizeMb) || memorySizeMb <= 0) {
    return null
  }
  if (memorySizeMb >= 4096) {
    return 'high'
  }
  if (memorySizeMb >= 3072) {
    return 'mid'
  }
  return 'low'
}

/** 档位对应的动效上限 */
export function motionCeiling(tier: DeviceTier): EffectiveMotion {
  if (tier === 'low') {
    return 'saver'
  }
  if (tier === 'mid') {
    return 'lite'
  }
  return 'full'
}

/**
 * 实际生效动效：auto 直接取设备上限；显式档位不得高于设备上限。
 * 用户选择更省电的档位始终被尊重。
 */
export function effectiveMotion(preference: MotionLevel, tier: DeviceTier): EffectiveMotion {
  const ceiling = motionCeiling(tier)
  if (preference === 'auto') {
    return ceiling
  }
  return MOTION_RANK[preference] <= MOTION_RANK[ceiling] ? preference : ceiling
}

/** 是否发生了「设备限档」：auto 被压到非全效，或显式选择的档位高于上限 */
export function isMotionCapped(preference: MotionLevel, tier: DeviceTier): boolean {
  const ceiling = motionCeiling(tier)
  if (preference === 'auto') {
    return ceiling !== 'full'
  }
  return MOTION_RANK[preference] > MOTION_RANK[ceiling]
}

export function readForcedTier(): DeviceTier | null {
  const value = readStorage<string>(TIER_FORCE_KEY, '')
  return value === 'high' || value === 'mid' || value === 'low' ? value : null
}

export function readCachedTier(): DeviceTier | null {
  const value = readStorage<string>(TIER_CACHE_KEY, '')
  return value === 'high' || value === 'mid' || value === 'low' ? value : null
}

export function cacheTier(tier: DeviceTier): void {
  writeStorage(TIER_CACHE_KEY, tier)
}

/**
 * 启动同步档位：
 * 1) 调试强制值优先
 * 2) 上次缓存（已由机型档位精修过）
 * 3) 同步内存启发（首启即可用，避免低端机首屏跑全效）
 * 4) devtools / 未知 → 高档
 */
export function bootstrapDeviceTier(): DeviceTier {
  const forced = readForcedTier()
  if (forced) {
    return forced
  }
  const cached = readCachedTier()
  if (cached) {
    return cached
  }
  try {
    if (typeof wx !== 'undefined' && typeof wx.getDeviceInfo === 'function') {
      const info = wx.getDeviceInfo()
      if (info.platform === 'devtools') {
        return 'high'
      }
      const byMemory = tierFromMemory(Number(info.memorySize))
      if (byMemory) {
        cacheTier(byMemory)
        return byMemory
      }
    }
  } catch {
    /* 读取失败按高档处理 */
  }
  return 'high'
}

/** 异步精修：机型档位 > 性能分；结果写入缓存并通过回调通知 */
export function startDeviceTierDetection(onChange?: (tier: DeviceTier) => void): void {
  try {
    const forced = readForcedTier()
    if (forced) {
      onChange?.(forced)
      return
    }
    if (typeof wx === 'undefined' || typeof wx.getDeviceBenchmarkInfo !== 'function') {
      return
    }
    wx.getDeviceBenchmarkInfo({
      success: (res) => {
        const tier = tierFromModelLevel(res.modelLevel) ?? tierFromBenchmark(res.benchmarkLevel)
        if (!tier) {
          return
        }
        cacheTier(tier)
        onChange?.(tier)
      },
      fail: () => undefined,
    })
  } catch {
    /* API 不可用时保留同步档位 */
  }
}

export function readMotionHintDismissed(): boolean {
  return readStorage<boolean>(TIER_HINT_DISMISS_KEY, false) === true
}

export function dismissMotionHint(): void {
  writeStorage(TIER_HINT_DISMISS_KEY, true)
}
