/* ==========================================================================
   全局偏好 Store · 设置中心唯一真相源
   - 所有字段先经白名单收敛，再由默认值兜底；Storage 损坏也不会中断启动
   - 只负责状态与持久化，音效 / 震动 / 动效副作用由 services 层接管
   - Feature Flags 采用白名单表：未来新增开关只需扩展 DEFAULT_PREFERENCE.flags
   ========================================================================== */
import { observable } from 'mobx-miniprogram'
import { STORAGE_KEYS } from '../constants/index'
import { logger } from '../utils/logger'

export type HapticLevel = 'off' | 'light' | 'heavy'
export type MotionLevel = 'full' | 'lite' | 'saver'
/** 0 表示永不清理；7 / 30 为天数阈值 */
export type AutoCleanDays = 0 | 7 | 30
export type FeatureFlagKey = 'enable_ai_assist'

export interface PreferenceFlags {
  enable_ai_assist: boolean
}

export interface PreferenceSnapshot {
  version: 1
  haptics: HapticLevel
  sound: boolean
  lightEffects: boolean
  motion: MotionLevel
  autoCleanDays: AutoCleanDays
  /** 数据驾驶舱默认开启隐私脱敏；记忆用户上次选择 */
  isPrivacyMasked: boolean
  /** 计算轨迹记录总开关：默认开启，暂停后新计算不再写入 */
  isHistoryTrackingEnabled: boolean
  flags: PreferenceFlags
}

export const HAPTIC_LEVELS: HapticLevel[] = ['off', 'light', 'heavy']
export const MOTION_LEVELS: MotionLevel[] = ['full', 'lite', 'saver']
export const AUTO_CLEAN_LEVELS: AutoCleanDays[] = [7, 30, 0]

export const HAPTIC_LABELS: Record<HapticLevel, string> = {
  off: '关闭',
  light: '轻震',
  heavy: '重震',
}

export const MOTION_LABELS: Record<MotionLevel, string> = {
  full: '全效',
  lite: '精简',
  saver: '省电',
}

export const AUTO_CLEAN_LABELS: Record<AutoCleanDays, string> = {
  7: '7 天',
  30: '30 天',
  0: '永不清理',
}

/** 唯一默认值：任何异常路径最终都会回到这里 */
export const DEFAULT_PREFERENCE: PreferenceSnapshot = {
  version: 1,
  haptics: 'light',
  sound: true,
  lightEffects: true,
  motion: 'full',
  autoCleanDays: 30,
  isPrivacyMasked: true,
  isHistoryTrackingEnabled: true,
  flags: {
    enable_ai_assist: false,
  },
}

const KNOWN_FLAGS = Object.keys(DEFAULT_PREFERENCE.flags)

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function clonePreference(snapshot: PreferenceSnapshot): PreferenceSnapshot {
  return {
    ...snapshot,
    flags: { ...snapshot.flags },
  }
}

function isHapticLevel(value: unknown): value is HapticLevel {
  return typeof value === 'string' && HAPTIC_LEVELS.includes(value as HapticLevel)
}

function isMotionLevel(value: unknown): value is MotionLevel {
  return typeof value === 'string' && MOTION_LEVELS.includes(value as MotionLevel)
}

function isAutoCleanDays(value: unknown): value is AutoCleanDays {
  return value === 0 || value === 7 || value === 30
}

/** 兼容布尔 / 数字 / 旧字符串三套历史写法 */
function normalizeHaptics(value: unknown, fallback: HapticLevel): HapticLevel {
  if (isHapticLevel(value)) {
    return value
  }
  if (typeof value === 'boolean') {
    return value ? 'light' : 'off'
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value <= 0) {
      return 'off'
    }
    return value >= 2 ? 'heavy' : 'light'
  }
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase()
    if (text === 'off' || text === 'none' || text === 'false' || text === '静震') {
      return 'off'
    }
    if (text === 'heavy' || text === 'strong' || text === '重震') {
      return 'heavy'
    }
    if (text === 'light' || text === 'medium' || text === 'on' || text === 'true' || text === '轻震') {
      return 'light'
    }
  }
  return fallback
}

function normalizeMotion(value: unknown, fallback: MotionLevel): MotionLevel {
  if (isMotionLevel(value)) {
    return value
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value <= 0) {
      return 'full'
    }
    return value >= 2 ? 'saver' : 'lite'
  }
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase()
    if (text === 'full' || text === 'all' || text === '全效') {
      return 'full'
    }
    if (text === 'lite' || text === 'reduced' || text === 'reduce' || text === '精简') {
      return 'lite'
    }
    if (text === 'saver' || text === 'power' || text === '省电') {
      return 'saver'
    }
  }
  return fallback
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value
  }
  if (value === 1 || value === 0) {
    return value === 1
  }
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase()
    if (text === 'true' || text === 'on' || text === '1') {
      return true
    }
    if (text === 'false' || text === 'off' || text === '0') {
      return false
    }
  }
  return fallback
}

function normalizeAutoClean(value: unknown, fallback: AutoCleanDays): AutoCleanDays {
  if (isAutoCleanDays(value)) {
    return value
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const days = Math.floor(value)
    if (isAutoCleanDays(days)) {
      return days
    }
  }
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase()
    if (text === 'never' || text === 'off' || text === '永不' || text === '永不清理') {
      return 0
    }
    const days = Number.parseInt(text, 10)
    if (isAutoCleanDays(days)) {
      return days
    }
  }
  return fallback
}

function normalizeFlags(raw: Record<string, unknown> | null, fallback: PreferenceFlags): PreferenceFlags {
  const next: PreferenceFlags = { ...fallback }
  if (!raw) {
    return next
  }
  for (const key of KNOWN_FLAGS) {
    const value = raw[key]
    if (typeof value === 'boolean') {
      next[key as FeatureFlagKey] = value
    }
  }
  return next
}

/**
 * 任意来源 → 合法偏好：
 * 1. 字段级白名单，非法值保留 fallback；
 * 2. 兼容 v0 的 vibrate / reduceMotion / autoClearDays 命名；
 * 3. 未知 Feature Flag 不会注入运行时。
 */
export function normalizePreference(
  input: unknown,
  fallback: PreferenceSnapshot = DEFAULT_PREFERENCE,
): PreferenceSnapshot {
  const record = asRecord(input)
  const base = clonePreference(fallback)
  if (!record) {
    return base
  }

  const nestedFlags = asRecord(record.flags)
  const flagsSource = nestedFlags ?? record
  const hapticsSource =
    record.haptics ?? record.vibration ?? record.vibrate ?? record.haptic
  const motionSource =
    record.motion ??
    record.motionLevel ??
    record.animation ??
    (normalizeBoolean(record.reduceMotion, false) ? 'lite' : undefined)
  const cleanSource =
    record.autoCleanDays ?? record.autoClearDays ?? record.cleanDays ?? record.retentionDays

  return {
    version: 1,
    haptics: normalizeHaptics(hapticsSource, base.haptics),
    sound: normalizeBoolean(record.sound ?? record.soundEnabled, base.sound),
    lightEffects: normalizeBoolean(
      record.lightEffects ?? record.dynamicLight ?? record.effects,
      base.lightEffects,
    ),
    motion: normalizeMotion(motionSource, base.motion),
    autoCleanDays: normalizeAutoClean(cleanSource, base.autoCleanDays),
    isPrivacyMasked: normalizeBoolean(
      record.isPrivacyMasked ?? record.privacyMasked ?? record.maskSensitive,
      base.isPrivacyMasked,
    ),
    isHistoryTrackingEnabled: normalizeBoolean(
      record.isHistoryTrackingEnabled ?? record.historyTracking ?? record.trackingEnabled,
      base.isHistoryTrackingEnabled,
    ),
    flags: normalizeFlags(flagsSource, base.flags),
  }
}

/** Storage 里可能是对象，也可能是旧版 JSON 字符串；任何异常都回退默认值 */
export function parsePreference(
  raw: unknown,
  fallback: PreferenceSnapshot = DEFAULT_PREFERENCE,
): PreferenceSnapshot {
  if (typeof raw === 'string') {
    const text = raw.trim()
    if (!text) {
      return clonePreference(fallback)
    }
    try {
      return normalizePreference(JSON.parse(text) as unknown, fallback)
    } catch {
      return clonePreference(fallback)
    }
  }
  return normalizePreference(raw, fallback)
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== ''
}

function readRaw(key: string): unknown {
  try {
    return wx.getStorageSync(key)
  } catch (error) {
    logger.warn('preference', `读取偏好失败：${key}`, error)
    return undefined
  }
}

/** v1 → v0 → tbx:prefs，逐级回退；全部缺失时使用默认值 */
function loadFromStorage(): PreferenceSnapshot {
  const current = readRaw(STORAGE_KEYS.preference)
  if (hasValue(current)) {
    return parsePreference(current)
  }

  const legacy = readRaw(STORAGE_KEYS.preferenceLegacy)
  if (hasValue(legacy)) {
    return parsePreference(legacy)
  }

  /* 早期版本把偏好混在 tbx:prefs 里，只读取、不删除 */
  const toolboxLegacy = readRaw('tbx:prefs')
  if (hasValue(toolboxLegacy)) {
    return parsePreference(toolboxLegacy)
  }

  return clonePreference(DEFAULT_PREFERENCE)
}

export const preferenceStore = observable({
  inited: false,
  version: DEFAULT_PREFERENCE.version as 1,
  haptics: DEFAULT_PREFERENCE.haptics as HapticLevel,
  sound: DEFAULT_PREFERENCE.sound,
  lightEffects: DEFAULT_PREFERENCE.lightEffects,
  motion: DEFAULT_PREFERENCE.motion as MotionLevel,
  autoCleanDays: DEFAULT_PREFERENCE.autoCleanDays as AutoCleanDays,
  isPrivacyMasked: DEFAULT_PREFERENCE.isPrivacyMasked,
  isHistoryTrackingEnabled: DEFAULT_PREFERENCE.isHistoryTrackingEnabled,
  flags: { ...DEFAULT_PREFERENCE.flags } as PreferenceFlags,

  /** 启动调用一次；任何异常都保留默认值，绝不抛给 App */
  init(): void {
    if (this.inited) {
      return
    }
    this.inited = true
    try {
      this.applySnapshot(loadFromStorage())
      this.persist()
    } catch (error) {
      this.applySnapshot(DEFAULT_PREFERENCE)
      logger.warn('preference', '偏好初始化失败，已回退默认值', error)
    }
  },

  applySnapshot(snapshot: PreferenceSnapshot): void {
    const safe = normalizePreference(snapshot)
    this.version = safe.version
    this.haptics = safe.haptics
    this.sound = safe.sound
    this.lightEffects = safe.lightEffects
    this.motion = safe.motion
    this.autoCleanDays = safe.autoCleanDays
    this.isPrivacyMasked = safe.isPrivacyMasked
    this.isHistoryTrackingEnabled = safe.isHistoryTrackingEnabled
    this.flags = { ...safe.flags }
  },

  snapshot(): PreferenceSnapshot {
    return {
      version: 1,
      haptics: this.haptics,
      sound: this.sound,
      lightEffects: this.lightEffects,
      motion: this.motion,
      autoCleanDays: this.autoCleanDays,
      isPrivacyMasked: this.isPrivacyMasked,
      isHistoryTrackingEnabled: this.isHistoryTrackingEnabled,
      flags: { ...this.flags },
    }
  },

  /** 写入失败只记录，不中断会话内生效 */
  persist(): boolean {
    try {
      wx.setStorageSync(STORAGE_KEYS.preference, this.snapshot())
      return true
    } catch (error) {
      logger.warn('preference', '偏好写入失败，本次仅会话生效', error)
      return false
    }
  },

  setHaptics(level: HapticLevel): boolean {
    if (!isHapticLevel(level)) {
      return false
    }
    if (this.haptics === level) {
      return true
    }
    this.haptics = level
    return this.persist()
  },

  setSound(enabled: boolean): boolean {
    const next = Boolean(enabled)
    if (this.sound === next) {
      return true
    }
    this.sound = next
    return this.persist()
  },

  setLightEffects(enabled: boolean): boolean {
    const next = Boolean(enabled)
    if (this.lightEffects === next) {
      return true
    }
    this.lightEffects = next
    return this.persist()
  },

  setMotion(level: MotionLevel): boolean {
    if (!isMotionLevel(level)) {
      return false
    }
    if (this.motion === level) {
      return true
    }
    this.motion = level
    return this.persist()
  },

  setMotionIndex(index: number): boolean {
    const level = MOTION_LEVELS[index]
    return level ? this.setMotion(level) : false
  },

  setAutoCleanDays(days: AutoCleanDays): boolean {
    if (!isAutoCleanDays(days)) {
      return false
    }
    if (this.autoCleanDays === days) {
      return true
    }
    this.autoCleanDays = days
    return this.persist()
  },

  /** 驾驶舱隐私盾：默认开启，切换后立即持久化，下次进入沿用 */
  setPrivacyMasked(masked: boolean): boolean {
    const next = Boolean(masked)
    if (this.isPrivacyMasked === next) {
      return true
    }
    this.isPrivacyMasked = next
    return this.persist()
  },

  togglePrivacyMasked(): boolean {
    return this.setPrivacyMasked(!this.isPrivacyMasked)
  },

  /** 暂停 / 恢复计算轨迹记录：只影响后续写入，已有轨迹保留 */
  setHistoryTrackingEnabled(enabled: boolean): boolean {
    const next = Boolean(enabled)
    if (this.isHistoryTrackingEnabled === next) {
      return true
    }
    this.isHistoryTrackingEnabled = next
    return this.persist()
  },

  setFlag(key: string, value: boolean): boolean {
    if (!KNOWN_FLAGS.includes(key)) {
      return false
    }
    const next = Boolean(value)
    if (this.flags[key as FeatureFlagKey] === next) {
      return true
    }
    this.flags = { ...this.flags, [key]: next }
    return this.persist()
  },

  get hapticsLabel(): string {
    return HAPTIC_LABELS[this.haptics]
  },

  get motionLabel(): string {
    return MOTION_LABELS[this.motion]
  },

  get motionIndex(): number {
    return MOTION_LEVELS.indexOf(this.motion)
  },

  get autoCleanLabel(): string {
    return AUTO_CLEAN_LABELS[this.autoCleanDays]
  },

  get autoCleanValue(): string {
    return String(this.autoCleanDays)
  },

  /** 顶部运行状态：任何一项变化都会触发 MobX 重算 */
  get statusText(): string {
    /* 省电模式会强制关闭光效，状态文案必须呈现真实生效值 */
    const lightOn = this.lightEffects && this.motion !== 'saver'
    return [
      `${this.motionLabel}模式`,
      lightOn ? '光效开启' : '光效关闭',
      this.sound ? '音效开启' : '音效静音',
    ].join(' · ')
  },
})
