/* ==========================================================================
   Glass Store 3.0 · 全局状态与旧数据迁移
   - 统一暴露主题、工具收藏、作品收藏、最近使用
   - 收藏 / 历史不新增第二套存储：作为现有 Store 的强类型门面
   - 启动迁移全部包在 try-catch 中，任何失败只记录，不阻塞首帧
   ========================================================================== */
import { observable } from 'mobx-miniprogram'
import { STORAGE_KEYS } from '../core/constants/index'
import { TOOL_IDS, TOOLS } from '../core/toolbox/registry'
import { toolboxStore } from '../core/toolbox/store'
import {
  MAX_FAVORITES,
  MAX_RECENTS,
  TBX_KEYS,
  writeIdList,
} from '../core/toolbox/storage'
import { historyStore } from '../core/stores/history'
import { resumeStore } from '../core/stores/resume'
import { uiStore } from '../core/stores/ui'
import { logger } from '../core/utils/logger'
import { runStorageMigrations } from '../core/utils/storage-migration'

/* ---- 对外类型 ---- */

export type GlassThemeMode = 'auto' | 'light' | 'dark'
export type GlassResolvedTheme = 'light' | 'dark'
export type GlassFavoriteKind = 'tool' | 'work'
export type GlassAmbientPreset = 'auto' | 'cold' | 'warm' | 'iris' | 'mint' | 'night'

export interface GlassFavoriteRef {
  kind: GlassFavoriteKind
  id: string
}

export interface GlassFavoriteItem extends GlassFavoriteRef {
  title: string
  subtitle: string
}

export interface GlassHistoryItem {
  id: string
  /** 0 为最近一次，依次递增 */
  order: number
  title: string
  subtitle: string
}

export interface GlassStoreMeta {
  version: number
  schema: 'spatial-glass-26'
  migratedAt: number
  themeMode: GlassThemeMode
  ambientPreset: GlassAmbientPreset
}

export interface GlassLegacyMigrationResult {
  migrated: boolean
  warnings: string[]
}

export interface GlassMigrationResult extends GlassLegacyMigrationResult {
  storeVersion: number
  storeMigrated: boolean
  meta: GlassStoreMeta | null
}

export interface GlassStorageListSpec {
  key: string
  limit: number
  label: string
}

/** 迁移完成后可被安全删除的旧键 */
export interface GlassObsoleteKeySpec {
  key: string
  label: string
}

/* ---- 常量 ---- */

/** 与 core/utils/storage-migration.ts 内的 STORAGE_SCHEMA_KEY 保持一致 */
const STORAGE_VERSION_KEY = 'app:storage.version'
const STORAGE_VERSION_CURRENT = 1

/** Spatial Glass 26 自有状态版本；独立于旧 Storage 版本 */
const GLASS_META_KEY = 'gallery.glass.meta'
const GLASS_STORE_VERSION = 2
const GLASS_STORE_SCHEMA = 'spatial-glass-26' as const

const AMBIENT_PRESETS: GlassAmbientPreset[] = [
  'auto',
  'cold',
  'warm',
  'iris',
  'mint',
  'night',
]

/** 三份真实存在的旧 id 列表；迁移只清洗，不改变命名空间 */
const LEGACY_ID_KEYS: GlassStorageListSpec[] = [
  { key: STORAGE_KEYS.favorites, limit: 200, label: '作品收藏' },
  { key: TBX_KEYS.favorites, limit: MAX_FAVORITES, label: '工具收藏' },
  { key: TBX_KEYS.recent, limit: MAX_RECENTS, label: '最近使用' },
]

/** v0 → v1 已删除的键，这里再做一次幂等清理 */
const OBSOLETE_KEYS: GlassObsoleteKeySpec[] = [
  { key: TBX_KEYS.prefs, label: '旧工具偏好' },
  { key: TBX_KEYS.ackFinance, label: '旧财务提示确认' },
  { key: TBX_KEYS.ackHealth, label: '旧健康提示确认' },
  { key: TBX_KEYS.legacyTip, label: '旧收藏提示' },
]

const THEME_MODES: GlassThemeMode[] = ['auto', 'light', 'dark']

const INITIAL_MIGRATION: GlassMigrationResult = {
  migrated: false,
  warnings: [],
  storeVersion: 0,
  storeMigrated: false,
  meta: null,
}

const DEFAULT_GLASS_META: GlassStoreMeta = {
  version: 0,
  schema: GLASS_STORE_SCHEMA,
  migratedAt: 0,
  themeMode: 'auto',
  ambientPreset: 'auto',
}

function isGlassAmbientPreset(value: unknown): value is GlassAmbientPreset {
  return typeof value === 'string' && AMBIENT_PRESETS.includes(value as GlassAmbientPreset)
}

/* ---- 类型守卫与纯函数 ---- */

function isGlassThemeMode(value: unknown): value is GlassThemeMode {
  return typeof value === 'string' && THEME_MODES.includes(value as GlassThemeMode)
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  try {
    return JSON.stringify(error)
  } catch {
    return '未知错误'
  }
}

function readStorageValue(key: string): unknown {
  try {
    return wx.getStorageSync(key)
  } catch (error) {
    throw new Error(`读取 ${key} 失败：${toErrorMessage(error)}`)
  }
}

function readStorageVersion(): number {
  try {
    const raw = wx.getStorageSync(STORAGE_VERSION_KEY) as unknown
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0
  } catch {
    return 0
  }
}

interface NormalizedIdList {
  ids: string[]
  changed: boolean
}

/**
 * 把任意旧数据收敛为 string[]：
 * - 只接受 string
 * - trim 后非空、长度 ≤64
 * - 去重、限长
 * - 兼容旧版 JSON 字符串
 */
function normalizeIdList(raw: unknown, limit: number): NormalizedIdList {
  if (raw === undefined || raw === null || raw === '') {
    return { ids: [], changed: false }
  }

  if (typeof raw === 'string') {
    if (raw.length > 65536) {
      return { ids: [], changed: true }
    }
    try {
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) {
        return { ids: [], changed: true }
      }
      return sanitizeIdArray(parsed, limit, true)
    } catch {
      return { ids: [], changed: true }
    }
  }

  if (!Array.isArray(raw)) {
    return { ids: [], changed: true }
  }

  return sanitizeIdArray(raw, limit, false)
}

function sanitizeIdArray(raw: unknown[], limit: number, fromString: boolean): NormalizedIdList {
  const ids: string[] = []
  const seen = new Set<string>()
  let changed = fromString

  for (const item of raw) {
    if (typeof item !== 'string') {
      changed = true
      continue
    }
    const id = item.trim()
    if (!id || id.length > 64) {
      changed = true
      continue
    }
    if (seen.has(id)) {
      changed = true
      continue
    }
    seen.add(id)
    ids.push(id)
    if (ids.length >= limit) {
      if (raw.length > ids.length) {
        changed = true
      }
      break
    }
  }

  if (!fromString) {
    const sameLength = raw.length === ids.length
    const sameOrder = raw.every((item, index) => {
      return typeof item === 'string' && item.trim() === ids[index]
    })
    if (!sameLength || !sameOrder) {
      changed = true
    }
  }

  return { ids, changed }
}

function removeStorageValue(key: string): boolean {
  try {
    const current = wx.getStorageSync(key) as unknown
    if (current === undefined || current === null || current === '') {
      return false
    }
    wx.removeStorageSync(key)
    return true
  } catch (error) {
    throw new Error(`删除 ${key} 失败：${toErrorMessage(error)}`)
  }
}

/* ---- Spatial Glass 26 元数据 ---- */

function readGlassMeta(): GlassStoreMeta | null {
  try {
    const raw = wx.getStorageSync(GLASS_META_KEY) as unknown
    let value: unknown = raw
    if (typeof raw === 'string') {
      if (raw.length > 4096) {
        return null
      }
      try {
        value = JSON.parse(raw) as unknown
      } catch {
        return null
      }
    }
    if (typeof value !== 'object' || value === null) {
      return null
    }
    const record = value as Record<string, unknown>
    const version =
      typeof record.version === 'number' && Number.isFinite(record.version)
        ? record.version
        : 0
    const migratedAt =
      typeof record.migratedAt === 'number' && Number.isFinite(record.migratedAt)
        ? record.migratedAt
        : 0
    const themeMode = isGlassThemeMode(record.themeMode) ? record.themeMode : 'auto'
    const ambientPreset = isGlassAmbientPreset(record.ambientPreset)
      ? record.ambientPreset
      : 'auto'
    return {
      version,
      schema: GLASS_STORE_SCHEMA,
      migratedAt,
      themeMode,
      ambientPreset,
    }
  } catch {
    return null
  }
}

function writeGlassMeta(meta: GlassStoreMeta): boolean {
  try {
    wx.setStorageSync(GLASS_META_KEY, meta)
    return true
  } catch {
    return false
  }
}

/**
 * v0/v1 → v2：
 * - 不复制收藏 / 历史，继续使用既有键；
 * - 写入 Spatial Glass 26 元数据，记录主题、环境光预设与迁移时间；
 * - 未来版本只追加 if (meta.version < N) 分支。
 */
function migrateGlassStore(): {
  migrated: boolean
  warnings: string[]
  meta: GlassStoreMeta
} {
  const warnings: string[] = []
  let migrated = false
  const current = readGlassMeta()
  let meta = current ?? { ...DEFAULT_GLASS_META }

  if (!current) {
    migrated = true
    warnings.push('Spatial Glass 元数据缺失，已写入默认值')
  } else if (current.version > GLASS_STORE_VERSION) {
    warnings.push(
      `Spatial Glass 元数据版本 ${current.version} 高于当前支持版本 ${GLASS_STORE_VERSION}，保持只读`,
    )
  }

  if (meta.version < GLASS_STORE_VERSION) {
    let themeMode: GlassThemeMode = meta.themeMode
    try {
      const rawTheme = wx.getStorageSync(STORAGE_KEYS.themeMode) as unknown
      if (isGlassThemeMode(rawTheme)) {
        themeMode = rawTheme
      }
    } catch {
      /* 读取失败沿用元数据或 auto */
    }

    meta = {
      version: GLASS_STORE_VERSION,
      schema: GLASS_STORE_SCHEMA,
      migratedAt: Date.now(),
      themeMode,
      ambientPreset: meta.ambientPreset,
    }
    migrated = true

    if (!writeGlassMeta(meta)) {
      warnings.push('Spatial Glass 元数据写入失败，下次启动重试')
    }
  }

  return { migrated, warnings, meta }
}

/* ---- 旧数据迁移（可独立测试） ---- */

/**
 * 旧 Storage 迁移：
 * 1. 调用既有 v0 → v1 迁移；
 * 2. 对作品收藏 / 工具收藏 / 最近使用做二次清洗；
 * 3. 非法外观偏好清理；
 * 4. 已废弃键幂等删除。
 *
 * 所有分支独立 try-catch：单个键失败不影响其它键，也不阻塞启动。
 */
export function migrateLegacyStorage(): GlassLegacyMigrationResult {
  const warnings: string[] = []
  let migrated = false

  const versionBefore = readStorageVersion()

  try {
    runStorageMigrations()
  } catch (error) {
    warnings.push(`本地数据版本迁移失败：${toErrorMessage(error)}`)
  }

  const versionAfter = readStorageVersion()
  if (versionBefore < STORAGE_VERSION_CURRENT) {
    migrated = true
  }
  if (versionAfter < STORAGE_VERSION_CURRENT) {
    warnings.push('本地数据版本仍低于 1，将在下次启动重试')
  }

  for (const spec of LEGACY_ID_KEYS) {
    try {
      const normalized = normalizeIdList(readStorageValue(spec.key), spec.limit)
      if (normalized.changed) {
        migrated = true
        const written = writeIdList(spec.key, normalized.ids, spec.limit)
        if (!written) {
          warnings.push(`${spec.label}写入失败：${spec.key}`)
        }
      }
    } catch (error) {
      warnings.push(`${spec.label}迁移失败：${toErrorMessage(error)}`)
    }
  }

  try {
    const rawTheme = readStorageValue(STORAGE_KEYS.themeMode)
    if (rawTheme !== undefined && rawTheme !== null && rawTheme !== '') {
      if (!isGlassThemeMode(rawTheme)) {
        wx.removeStorageSync(STORAGE_KEYS.themeMode)
        migrated = true
        warnings.push('非法外观偏好已移除，将回退为跟随系统')
      }
    }
  } catch (error) {
    warnings.push(`外观偏好迁移失败：${toErrorMessage(error)}`)
  }

  for (const spec of OBSOLETE_KEYS) {
    try {
      if (removeStorageValue(spec.key)) {
        migrated = true
      }
    } catch (error) {
      warnings.push(`${spec.label}清理失败：${toErrorMessage(error)}`)
    }
  }

  return { migrated, warnings }
}

/* ---- 纯查表函数 ---- */

function toolMetaOf(id: string): { title: string; subtitle: string } {
  const meta = TOOLS.find((tool) => tool.id === id)
  return {
    title: meta?.name ?? id,
    subtitle: meta?.desc ?? '工具',
  }
}

function workMetaOf(id: string): { title: string; subtitle: string } {
  const project = resumeStore.projectById(id)
  return {
    title: project?.title ?? id,
    subtitle: project?.subtitle ?? (project?.category === 'actual' ? '实际工程' : '个人作品'),
  }
}

function resolveFavoriteItem(ref: GlassFavoriteRef): GlassFavoriteItem {
  if (ref.kind === 'tool') {
    const meta = toolMetaOf(ref.id)
    return { ...ref, title: meta.title, subtitle: meta.subtitle }
  }
  const meta = workMetaOf(ref.id)
  return { ...ref, title: meta.title, subtitle: meta.subtitle }
}

/* ---- Glass Store ---- */

export const glassStore = observable({
  /* ---- 生命周期 ---- */
  inited: false,
  migration: INITIAL_MIGRATION,
  storeMeta: null as GlassStoreMeta | null,

  /**
   * 启动调用一次：
   * 迁移 → 工具 Store → 作品收藏 → 主题。
   * 所有被调用方自身均为幂等，重复调用安全。
   */
  init(): GlassMigrationResult {
    if (this.inited) {
      return this.migration
    }
    this.inited = true

    const legacy = migrateLegacyStorage()
    const store = migrateGlassStore()
    this.storeMeta = store.meta
    this.migration = {
      migrated: legacy.migrated || store.migrated,
      warnings: [...legacy.warnings, ...store.warnings],
      storeVersion: store.meta.version,
      storeMigrated: store.migrated,
      meta: store.meta,
    }

    toolboxStore.init()
    historyStore.init()
    resumeStore.restoreFavorites()
    uiStore.initTheme()

    if (this.migration.warnings.length > 0) {
      logger.warn(
        'glass-store',
        `旧数据迁移完成，存在 ${this.migration.warnings.length} 条告警`,
        this.migration.warnings,
      )
    } else {
      logger.info('glass-store', '全局状态初始化完成')
    }
    return this.migration
  },

  /** 简历域异步装载：需要作品标题 / 详情的新页面在 onLoad 调用 */
  bootstrap(): Promise<void> {
    this.init()
    return resumeStore.bootstrap()
  },

  /* ---- 主题 ---- */
  get themeMode(): GlassThemeMode {
    return uiStore.themeMode
  },

  get resolvedTheme(): GlassResolvedTheme {
    return uiStore.resolvedTheme
  },

  get themeClass(): string {
    return uiStore.themeClass
  },

  get themeLabel(): string {
    return uiStore.themeModeLabel
  },

  /** 昼夜真实翻转窗口：页面据此播放一次呼吸 */
  get themeSwitching(): boolean {
    return uiStore.themeSwitching
  },

  setThemeMode(mode: GlassThemeMode): void {
    if (!isGlassThemeMode(mode)) {
      return
    }
    uiStore.setThemeMode(mode)
    this.updateStoreMeta({ themeMode: mode })
  },

  cycleTheme(): void {
    uiStore.cycleTheme()
    this.updateStoreMeta({ themeMode: uiStore.themeMode })
  },

  /* ---- 环境光预设（ambient-theme 引擎接管前的基础状态） ---- */
  get ambientPreset(): GlassAmbientPreset {
    return this.storeMeta?.ambientPreset ?? 'auto'
  },

  setAmbientPreset(preset: GlassAmbientPreset): boolean {
    if (!isGlassAmbientPreset(preset)) {
      return false
    }
    if (!this.storeMeta) {
      return false
    }
    return this.updateStoreMeta({ ambientPreset: preset })
  },

  updateStoreMeta(patch: {
    themeMode?: GlassThemeMode
    ambientPreset?: GlassAmbientPreset
  }): boolean {
    if (!this.storeMeta) {
      return false
    }
    const next: GlassStoreMeta = {
      ...this.storeMeta,
      themeMode: patch.themeMode ?? this.storeMeta.themeMode,
      ambientPreset: patch.ambientPreset ?? this.storeMeta.ambientPreset,
    }
    if (!writeGlassMeta(next)) {
      logger.warn('glass-store', 'Spatial Glass 元数据写入失败')
      return false
    }
    this.storeMeta = next
    return true
  },

  /* ---- 轻提示 ---- */
  toast(message: string): void {
    if (!message) {
      return
    }
    uiStore.showToast(message)
  },

  hideToast(): void {
    uiStore.hideToast()
  },

  /* ---- 收藏 ---- */
  get toolFavorites(): string[] {
    return toolboxStore.favorites.slice()
  },

  get workFavorites(): string[] {
    return resumeStore.favorites.slice()
  },

  get favorites(): GlassFavoriteRef[] {
    const tools: GlassFavoriteRef[] = toolboxStore.favorites.map((id) => ({
      kind: 'tool',
      id,
    }))
    const works: GlassFavoriteRef[] = resumeStore.favorites.map((id) => ({
      kind: 'work',
      id,
    }))
    return [...tools, ...works]
  },

  get favoriteItems(): GlassFavoriteItem[] {
    return this.favorites.map((ref) => resolveFavoriteItem(ref))
  },

  get favoriteCount(): number {
    return toolboxStore.favorites.length + resumeStore.favorites.length
  },

  isFavorite(kind: GlassFavoriteKind, id: string): boolean {
    if (!id) {
      return false
    }
    if (kind === 'tool') {
      return toolboxStore.isFavorite(id)
    }
    if (kind === 'work') {
      return resumeStore.isFavorite(id)
    }
    return false
  },

  /**
   * 统一切换收藏：
   * - 工具：必须存在于 TOOL_IDS
   * - 作品：作品集已装载时必须存在
   * - 返回 null 表示落盘失败或 id 非法
   */
  toggleFavorite(kind: GlassFavoriteKind, id: string): boolean | null {
    if (!id) {
      return null
    }
    if (kind === 'tool') {
      if (!TOOL_IDS.has(id)) {
        return null
      }
      const result = toolboxStore.toggleFavorite(id)
      if (result === 'added') {
        return true
      }
      if (result === 'removed') {
        return false
      }
      return null
    }
    if (kind === 'work') {
      if (resumeStore.projects.length > 0 && !resumeStore.projectById(id)) {
        return null
      }
      return resumeStore.toggleFavorite(id)
    }
    return null
  },

  /* ---- 历史（最近使用） ---- */
  get history(): GlassHistoryItem[] {
    return toolboxStore.recents.map((id, order) => {
      const meta = toolMetaOf(id)
      return {
        id,
        order,
        title: meta.title,
        subtitle: meta.subtitle,
      }
    })
  },

  get historyCount(): number {
    return toolboxStore.recents.length
  },

  recordHistory(id: string): boolean {
    if (!TOOL_IDS.has(id)) {
      return false
    }
    toolboxStore.recordRecent(id)
    return true
  },

  /** 只清最近使用，不动收藏 */
  clearHistory(): boolean {
    return toolboxStore.clearRecents()
  },

  /** 清空全部工具数据：收藏 + 最近使用 + tbx:* 键 */
  clearAll(): number {
    return toolboxStore.clearAll()
  },
})

export type GlassStore = typeof glassStore
