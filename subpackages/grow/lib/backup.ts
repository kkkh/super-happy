/* ==========================================================================
   backup · 本机 JSON 备份与恢复
   - 备份写入 USER_DATA_PATH/backups，最多保留最近 1 份
   - 导入先全量校验，再按“先写新键、失败回滚”整体替换
   - 纯函数 buildBackup / validateBackup / applyBackupToStorage 可离线测试
   ========================================================================== */

import { STORAGE_KEYS } from '../../../core/constants/index'
import { TOOL_IDS } from '../../../core/toolbox/registry'
import {
  MAX_FAVORITES,
  MAX_RECENTS,
  MAX_SEARCH_HISTORY,
  TBX_KEYS,
  readIdList,
  readStorage,
  readTimestampMap,
  removeStorage,
  writeStorage,
} from '../../../core/toolbox/storage'
import { toolboxStore } from '../../../core/toolbox/store'
import { preferenceStore, type PreferenceSnapshot } from '../../../core/stores/preference'
import { logger } from '../../../core/utils/logger'
import { utf8ByteLength } from '../../../core/services/export'

export const BACKUP_APP = 'chao-huan-toolbox'
export const BACKUP_VERSION = 1
/** 单份备份 JSON 上限 */
export const BACKUP_MAX_BYTES = 256 * 1024
/** 备份内最多保留的城市数 */
export const BACKUP_MAX_CITIES = 5
/** 备份内最多保留的专注记录数 */
export const BACKUP_MAX_FOCUS_RECORDS = 50

const BACKUP_DIR = 'backups'
const WEATHER_CITIES_KEY = 'weather:cities:v1'
const WEATHER_CURRENT_KEY = 'weather:current:v1'
const FOCUS_KEY = 'focus:key:v1'
const FOCUS_LEDGER_KEY = 'focus:ledger:v1'
const FOCUS_STATS_KEY = 'focus:stats:v1'
const HEX_KEY_RE = /^[0-9a-f]{64}$/i
const SEARCH_TEXT_LIMIT = 24

export interface BackupWeatherData {
  cities: unknown[]
  current: string
}

export interface BackupFocusData {
  key?: string
  ledger?: unknown[]
  stats?: Record<string, unknown>
}

export interface BackupData {
  favorites: string[]
  recent: string[]
  recentAt: Record<string, number>
  searchHistory: string[]
  weather: BackupWeatherData
  focus: BackupFocusData
  prefs: Record<string, unknown>
}

export interface BackupFile {
  app: string
  v: number
  exportedAt: number
  data: BackupData
}

export type BackupFailReason =
  | 'empty'
  | 'invalid'
  | 'version'
  | 'too-large'
  | 'read-failed'
  | 'write-failed'
  | 'unsupported'
  | 'cancelled'

export interface BackupCounts {
  favorites: number
  recent: number
  searchHistory: number
  weatherCities: number
  focusRecords: number
}

export type BackupExportResult =
  | { ok: true; path: string; name: string; bytes: number; at: number }
  | { ok: false; reason: BackupFailReason }

export type BackupValidateResult =
  | { ok: true; file: BackupFile }
  | { ok: false; reason: BackupFailReason }

export type BackupPickResult =
  | { ok: true; file: BackupFile; name: string; bytes: number }
  | { ok: false; reason: BackupFailReason }

export type BackupApplyResult =
  | { ok: true; counts: BackupCounts }
  | { ok: false; reason: BackupFailReason }

export interface BackupDeleteResult {
  ok: boolean
  removed: number
}

/** 导入目标存储的最小适配器：便于 Node 单测精确控制写入失败 */
export interface BackupStorageAdapter {
  has(key: string): boolean
  read(key: string): unknown
  write(key: string, value: unknown): boolean
  remove(key: string): boolean
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string')
  }
  if (typeof value === 'string' && value) {
    try {
      const parsed = JSON.parse(value) as unknown
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string')
        : []
    } catch {
      return []
    }
  }
  return []
}

function sanitizeIds(value: unknown, limit: number): string[] {
  const seen = new Set<string>()
  const list: string[] = []
  for (const raw of toStringList(value)) {
    const id = raw.trim()
    if (!TOOL_IDS.has(id) || seen.has(id)) {
      continue
    }
    seen.add(id)
    list.push(id)
    if (list.length >= limit) {
      break
    }
  }
  return list
}

function sanitizeSearchHistory(value: unknown): string[] {
  const seen = new Set<string>()
  const list: string[] = []
  for (const raw of toStringList(value)) {
    const text = raw.trim().slice(0, SEARCH_TEXT_LIMIT)
    if (!text || seen.has(text)) {
      continue
    }
    seen.add(text)
    list.push(text)
    if (list.length >= MAX_SEARCH_HISTORY) {
      break
    }
  }
  return list
}

function sanitizeRecentAt(value: unknown, recent: string[]): Record<string, number> {
  const source = isPlainObject(value) ? value : {}
  const out: Record<string, number> = {}
  for (const id of recent) {
    const at = Number(source[id])
    if (Number.isFinite(at) && at > 0) {
      out[id] = Math.floor(at)
    }
  }
  return out
}

function sanitizeWeather(value: unknown): BackupWeatherData {
  const source = isPlainObject(value) ? value : {}
  const cities = Array.isArray(source.cities)
    ? source.cities.filter(isPlainObject).slice(0, BACKUP_MAX_CITIES)
    : []
  return {
    cities,
    current: typeof source.current === 'string' ? source.current.slice(0, 32) : '',
  }
}

function sanitizeFocus(value: unknown): BackupFocusData {
  const source = isPlainObject(value) ? value : {}
  const out: BackupFocusData = {}
  if (typeof source.key === 'string' && HEX_KEY_RE.test(source.key.trim())) {
    out.key = source.key.trim().toLowerCase()
  }
  if (Array.isArray(source.ledger)) {
    out.ledger = source.ledger.filter(isPlainObject).slice(0, BACKUP_MAX_FOCUS_RECORDS)
  }
  if (isPlainObject(source.stats)) {
    out.stats = source.stats
  }
  return out
}

/** 归一化任意来源，生成可写入文件的备份对象；未知字段全部丢弃 */
export function buildBackup(source: unknown, exportedAt = Date.now()): BackupFile {
  const raw = isPlainObject(source) ? source : {}
  const favorites = sanitizeIds(raw.favorites, MAX_FAVORITES)
  const recent = sanitizeIds(raw.recent, MAX_RECENTS)
  return {
    app: BACKUP_APP,
    v: BACKUP_VERSION,
    exportedAt: Math.max(0, Math.floor(Number(exportedAt) || 0)),
    data: {
      favorites,
      recent,
      recentAt: sanitizeRecentAt(raw.recentAt, recent),
      searchHistory: sanitizeSearchHistory(raw.searchHistory),
      weather: sanitizeWeather(raw.weather),
      focus: sanitizeFocus(raw.focus),
      prefs: isPlainObject(raw.prefs) ? raw.prefs : {},
    },
  }
}

/** 严格校验备份结构；通过后返回归一化结果，未知字段不会进入写入链路 */
export function validateBackup(raw: unknown): BackupValidateResult {
  if (!isPlainObject(raw)) {
    return { ok: false, reason: 'invalid' }
  }
  if (raw.app !== BACKUP_APP) {
    return { ok: false, reason: 'invalid' }
  }
  if (raw.v !== BACKUP_VERSION) {
    return { ok: false, reason: 'version' }
  }
  const exportedAt = Number(raw.exportedAt)
  if (!Number.isFinite(exportedAt) || exportedAt <= 0) {
    return { ok: false, reason: 'invalid' }
  }
  const data = raw.data
  if (!isPlainObject(data)) {
    return { ok: false, reason: 'invalid' }
  }
  if (
    !Array.isArray(data.favorites) ||
    !Array.isArray(data.recent) ||
    !Array.isArray(data.searchHistory)
  ) {
    return { ok: false, reason: 'invalid' }
  }
  if (!isPlainObject(data.recentAt) || !isPlainObject(data.prefs)) {
    return { ok: false, reason: 'invalid' }
  }
  if (!isPlainObject(data.weather)) {
    return { ok: false, reason: 'invalid' }
  }
  if (!Array.isArray(data.weather.cities) || typeof data.weather.current !== 'string') {
    return { ok: false, reason: 'invalid' }
  }
  if (data.focus !== undefined) {
    if (!isPlainObject(data.focus)) {
      return { ok: false, reason: 'invalid' }
    }
    if (data.focus.key !== undefined && typeof data.focus.key !== 'string') {
      return { ok: false, reason: 'invalid' }
    }
    if (data.focus.ledger !== undefined && !Array.isArray(data.focus.ledger)) {
      return { ok: false, reason: 'invalid' }
    }
    if (data.focus.stats !== undefined && !isPlainObject(data.focus.stats)) {
      return { ok: false, reason: 'invalid' }
    }
  }
  return { ok: true, file: buildBackup(data, exportedAt) }
}

/** 解析导入文本：先限制 256KB，再 JSON 解析与结构校验 */
export function parseBackupText(text: string): BackupValidateResult {
  const source = typeof text === 'string' ? text.trim() : ''
  if (!source) {
    return { ok: false, reason: 'empty' }
  }
  if (utf8ByteLength(source) > BACKUP_MAX_BYTES) {
    return { ok: false, reason: 'too-large' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(source) as unknown
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  return validateBackup(parsed)
}

export function serializeBackup(file: BackupFile): string {
  return JSON.stringify(file)
}

/** 固定文件名：超欢备份-YYYYMMDD.json */
export function backupFileName(now = Date.now()): string {
  const date = new Date(now)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `超欢备份-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}.json`
}

export function formatBackupAt(at: number): string {
  if (!Number.isFinite(at) || at <= 0) {
    return ''
  }
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

/** 读取当前本机数据，作为备份来源 */
export function readBackupSource(): Record<string, unknown> {
  return {
    favorites: readIdList(TBX_KEYS.favorites),
    recent: readIdList(TBX_KEYS.recent),
    recentAt: readTimestampMap(TBX_KEYS.recentAt),
    searchHistory: readStorage(TBX_KEYS.searchHistory),
    weather: {
      cities: readStorage(WEATHER_CITIES_KEY),
      current: readStorage(WEATHER_CURRENT_KEY),
    },
    focus: {
      key: readStorage(FOCUS_KEY),
      ledger: readStorage(FOCUS_LEDGER_KEY),
      stats: readStorage(FOCUS_STATS_KEY),
    },
    prefs: readStorage(STORAGE_KEYS.preference),
  }
}

function fsManager(): WechatMiniprogram.FileSystemManager | null {
  try {
    return wx.getFileSystemManager()
  } catch {
    return null
  }
}

function backupDirPath(): string {
  return `${wx.env.USER_DATA_PATH}/${BACKUP_DIR}`
}

function ensureBackupDir(manager: WechatMiniprogram.FileSystemManager): void {
  const dir = backupDirPath()
  try {
    manager.accessSync(dir)
  } catch {
    try {
      manager.mkdirSync(dir, true)
    } catch {
      /* 已存在或并发创建：写入阶段再兜底 */
    }
  }
}

function listBackupFiles(manager: WechatMiniprogram.FileSystemManager): string[] {
  const dir = backupDirPath()
  try {
    return manager
      .readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => `${dir}/${name}`)
  } catch {
    return []
  }
}

/** 本机是否已有备份文件 */
export function hasBackupFile(): boolean {
  const manager = fsManager()
  if (!manager) {
    return false
  }
  ensureBackupDir(manager)
  return listBackupFiles(manager).length > 0
}

/** 最近一次备份时间；无备份返回 0 */
export function readBackupAt(): number {
  const value = Number(readStorage(STORAGE_KEYS.backupAt))
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/** 导出备份：先清理旧备份，再写新文件；成功后记录 app:backup.at */
export function exportBackup(now = Date.now()): Promise<BackupExportResult> {
  const manager = fsManager()
  if (!manager) {
    return Promise.resolve({ ok: false, reason: 'unsupported' })
  }
  const file = buildBackup(readBackupSource(), now)
  const text = serializeBackup(file)
  const bytes = utf8ByteLength(text)
  if (bytes <= 0) {
    return Promise.resolve({ ok: false, reason: 'empty' })
  }
  if (bytes > BACKUP_MAX_BYTES) {
    return Promise.resolve({ ok: false, reason: 'too-large' })
  }

  ensureBackupDir(manager)
  for (const path of listBackupFiles(manager)) {
    try {
      manager.unlinkSync(path)
    } catch {
      /* 旧备份删除失败不阻断新备份 */
    }
  }

  const name = backupFileName(now)
  const path = `${backupDirPath()}/${name}`
  const at = Math.max(1, Math.floor(now))
  return new Promise((resolve) => {
    try {
      manager.writeFile({
        filePath: path,
        data: text,
        encoding: 'utf8',
        success: () => {
          if (!writeStorage(STORAGE_KEYS.backupAt, at)) {
            logger.warn('backup', '备份时间戳写入失败，文件已生成')
          }
          resolve({ ok: true, path, name, bytes, at })
        },
        fail: () => resolve({ ok: false, reason: 'write-failed' }),
      })
    } catch {
      resolve({ ok: false, reason: 'write-failed' })
    }
  })
}

/** 删除全部备份文件，并同步清除 app:backup.at */
export function deleteBackupFiles(): BackupDeleteResult {
  const manager = fsManager()
  if (!manager) {
    return { ok: false, removed: 0 }
  }
  ensureBackupDir(manager)
  const files = listBackupFiles(manager)
  let removed = 0
  for (const path of files) {
    try {
      manager.unlinkSync(path)
      removed += 1
    } catch {
      /* 单个文件删除失败不阻断其余清理 */
    }
  }
  const cleared = removeStorage(STORAGE_KEYS.backupAt)
  return { ok: removed === files.length && cleared, removed }
}

/** 从聊天文件选择 JSON 备份；先看 size，再读取与校验 */
export function pickBackupFile(): Promise<BackupPickResult> {
  const manager = fsManager()
  if (!manager) {
    return Promise.resolve({ ok: false, reason: 'unsupported' })
  }
  return new Promise((resolve) => {
    try {
      wx.chooseMessageFile({
        count: 1,
        type: 'file',
        extension: ['json'],
        success: (result) => {
          const file = result.tempFiles && result.tempFiles[0]
          if (!file || !file.path) {
            resolve({ ok: false, reason: 'read-failed' })
            return
          }
          const size = Number(file.size)
          if (Number.isFinite(size) && size > BACKUP_MAX_BYTES) {
            resolve({ ok: false, reason: 'too-large' })
            return
          }
          manager.readFile({
            filePath: file.path,
            encoding: 'utf8',
            success: (readResult) => {
              const text = typeof readResult.data === 'string' ? readResult.data : ''
              const parsed = parseBackupText(text)
              if (!parsed.ok) {
                resolve(parsed)
                return
              }
              resolve({
                ok: true,
                file: parsed.file,
                name: file.name || backupFileName(),
                bytes: Number.isFinite(size) ? size : utf8ByteLength(text),
              })
            },
            fail: () => resolve({ ok: false, reason: 'read-failed' }),
          })
        },
        fail: (error) => {
          const message = String((error && error.errMsg) || '')
          resolve({ ok: false, reason: /cancel/i.test(message) ? 'cancelled' : 'read-failed' })
        },
      })
    } catch {
      resolve({ ok: false, reason: 'unsupported' })
    }
  })
}

function rollbackWrites(
  written: string[],
  snapshots: Array<{ key: string; existed: boolean; value: unknown }>,
  adapter: BackupStorageAdapter,
): void {
  for (let index = written.length - 1; index >= 0; index -= 1) {
    const key = written[index]
    const snapshot = snapshots.find((item) => item.key === key)
    if (!snapshot) {
      continue
    }
    if (snapshot.existed) {
      adapter.write(key, snapshot.value)
    } else {
      adapter.remove(key)
    }
  }
}

/**
 * 原子导入：先快照旧值，逐键写入；任一失败按逆序回滚已写键。
 * 不依赖 wx，测试可注入内存适配器。
 */
export function applyBackupToStorage(
  file: BackupFile,
  adapter: BackupStorageAdapter,
): BackupApplyResult {
  const focus = file.data.focus
  const entries: Array<[string, unknown]> = [
    [TBX_KEYS.favorites, file.data.favorites],
    [TBX_KEYS.recent, file.data.recent],
    [TBX_KEYS.recentAt, file.data.recentAt],
    [TBX_KEYS.searchHistory, file.data.searchHistory],
    [WEATHER_CITIES_KEY, file.data.weather.cities],
    [WEATHER_CURRENT_KEY, file.data.weather.current],
    [STORAGE_KEYS.preference, file.data.prefs],
  ]
  if (focus.key) {
    entries.push([FOCUS_KEY, focus.key])
  }
  if (focus.ledger) {
    entries.push([FOCUS_LEDGER_KEY, focus.ledger])
  }
  if (focus.stats) {
    entries.push([FOCUS_STATS_KEY, focus.stats])
  }

  const snapshots = entries.map(([key]) => {
    const existed = adapter.has(key)
    return { key, existed, value: existed ? adapter.read(key) : undefined }
  })
  const written: string[] = []
  for (const [key, value] of entries) {
    if (!adapter.write(key, value)) {
      rollbackWrites(written, snapshots, adapter)
      return { ok: false, reason: 'write-failed' }
    }
    written.push(key)
  }

  return {
    ok: true,
    counts: {
      favorites: file.data.favorites.length,
      recent: file.data.recent.length,
      searchHistory: file.data.searchHistory.length,
      weatherCities: file.data.weather.cities.length,
      focusRecords: focus.ledger ? focus.ledger.length : 0,
    },
  }
}

const wxStorageAdapter: BackupStorageAdapter = {
  has(key: string): boolean {
    try {
      return wx.getStorageInfoSync().keys.includes(key)
    } catch {
      return false
    }
  },
  read(key: string): unknown {
    try {
      return wx.getStorageSync(key)
    } catch {
      return undefined
    }
  },
  write(key: string, value: unknown): boolean {
    try {
      wx.setStorageSync(key, value)
      return true
    } catch {
      return false
    }
  },
  remove(key: string): boolean {
    try {
      wx.removeStorageSync(key)
      return true
    } catch {
      return false
    }
  },
}

/**
 * 导入备份：结构校验 → 原子写入 Storage → 刷新内存 Store。
 * 写入失败时保留原数据；刷新失败只记录，不回滚已成功写入的数据。
 */
export function applyBackup(file: BackupFile): BackupApplyResult {
  const validated = validateBackup(file)
  if (!validated.ok) {
    return validated
  }
  const result = applyBackupToStorage(validated.file, wxStorageAdapter)
  if (!result.ok) {
    return result
  }
  try {
    toolboxStore.reload()
    preferenceStore.applySnapshot(
      validated.file.data.prefs as unknown as PreferenceSnapshot,
    )
    preferenceStore.persist()
  } catch (error) {
    logger.warn('backup', '导入后刷新内存状态失败', error)
  }
  return result
}
