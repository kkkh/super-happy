/* ==========================================================================
   timeTravelEngine · Redux DevTools 级状态快照与时间旅行
   - 捕获 preference / toolbox / history / theme 四组真实 MobX 状态
   - 环形缓冲最多 20 帧，相同状态自动去重
   - travel() 字段级写回 Store 与 Storage，失败不破坏当前状态
   - 事件追踪为内存环形缓冲，最多 50 条，绝不落盘
   - 热备 3 槽 / 自动快照 5 槽，全部走现有 main 包 Storage 封装
   ========================================================================== */

import { FONT_SCALE_LABELS, preferenceStore } from '../../../core/stores/preference'
import type { PreferenceSnapshot } from '../../../core/stores/preference'
import { uiStore } from '../../../core/stores/ui'
import { toolboxStore } from '../../../core/toolbox/store'
import { historyStore } from '../../../core/stores/history'
import type { HistoryRecord } from '../../../core/stores/history'
import {
  MAX_FAVORITES,
  MAX_RECENTS,
  TBX_KEYS,
  readStorage,
  writeCount,
  writeIdList,
  writeStorage,
  writeTimestampMap,
} from '../../../core/toolbox/storage'
import type { ThemeMode } from '../../../core/types/index'
import { crc32Hex } from '../../../core/toolbox/crc32'

export interface ToolboxSnapshot {
  favorites: string[]
  recents: string[]
  recentAt: Record<string, number>
  usageCount: number
}

export interface CyberSnapshot {
  id: string
  createdAt: number
  label: string
  preference: PreferenceSnapshot
  themeMode: ThemeMode
  toolbox: ToolboxSnapshot
  history: HistoryRecord[]
}

export interface TimeTravelFrameView {
  id: string
  index: number
  label: string
  createdAt: number
  time: string
  preferenceText: string
  toolboxText: string
  historyText: string
  active: boolean
}

interface TravelResult {
  ok: boolean
  message: string
  frame?: CyberSnapshot
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function snapshotStores(): Omit<CyberSnapshot, 'id' | 'createdAt' | 'label'> {
  return {
    preference: preferenceStore.snapshot(),
    themeMode: uiStore.themeMode,
    toolbox: {
      favorites: [...toolboxStore.favorites],
      recents: [...toolboxStore.recents],
      recentAt: { ...toolboxStore.recentAt },
      usageCount: toolboxStore.usageCount,
    },
    history: clone(historyStore.records),
  }
}

function timeLabel(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function preferenceSummary(snapshot: PreferenceSnapshot): string {
  const flagCount = Object.keys(snapshot.flags).filter(
    (key) => key === 'enable_ai_assist' && snapshot.flags.enable_ai_assist,
  ).length
  const fontLabel = FONT_SCALE_LABELS[snapshot.fontScale] || '标准'
  return `${snapshot.motion} · ${snapshot.haptics} · 音效${snapshot.sound ? '开' : '关'} · 光效${
    snapshot.lightEffects ? '开' : '关'
  } · 字号${fontLabel} · ${flagCount} flag`
}

export class TimeTravelEngine {
  private frames: CyberSnapshot[] = []
  private seq = 0
  private maxFrames: number

  constructor(maxFrames = 20) {
    this.maxFrames = Math.max(3, Math.min(50, Math.floor(maxFrames)))
  }

  capture(label: string): CyberSnapshot | null {
    const base = snapshotStores()
    const signature = JSON.stringify(base)
    const last = this.frames[this.frames.length - 1]
    if (last) {
      const lastSignature = JSON.stringify({
        preference: last.preference,
        themeMode: last.themeMode,
        toolbox: last.toolbox,
        history: last.history,
      })
      if (lastSignature === signature) {
        return null
      }
    }
    this.seq += 1
    const snapshot: CyberSnapshot = {
      ...base,
      id: `tt-${this.seq}-${Date.now().toString(36)}`,
      createdAt: Date.now(),
      label: String(label || '手动快照').slice(0, 24),
    }
    this.frames.push(snapshot)
    if (this.frames.length > this.maxFrames) {
      this.frames = this.frames.slice(this.frames.length - this.maxFrames)
    }
    return snapshot
  }

  getFrames(): CyberSnapshot[] {
    return this.frames.map((frame) => clone(frame))
  }

  size(): number {
    return this.frames.length
  }

  /** 时间轴视图：只输出 UI 需要的轻量字段 */
  views(activeIndex = -1): TimeTravelFrameView[] {
    return this.frames.map((frame, index) => ({
      id: frame.id,
      index,
      label: frame.label,
      createdAt: frame.createdAt,
      time: timeLabel(frame.createdAt),
      preferenceText: preferenceSummary(frame.preference),
      toolboxText: `收藏 ${frame.toolbox.favorites.length} · 最近 ${frame.toolbox.recents.length} · 使用 ${frame.toolbox.usageCount}`,
      historyText: `${frame.history.length} 条轨迹`,
      active: index === activeIndex,
    }))
  }

  preview(index: number): CyberSnapshot | null {
    if (!Number.isInteger(index) || index < 0 || index >= this.frames.length) {
      return null
    }
    return clone(this.frames[index])
  }

  travel(index: number): TravelResult {
    const target = this.preview(index)
    if (!target) {
      return { ok: false, message: '目标快照不存在或已失效' }
    }
    try {
      preferenceStore.applySnapshot(target.preference)
      preferenceStore.persist()
      uiStore.setThemeMode(target.themeMode)

      toolboxStore.favorites = target.toolbox.favorites.slice(0, MAX_FAVORITES)
      toolboxStore.recents = target.toolbox.recents.slice(0, MAX_RECENTS)
      toolboxStore.recentAt = { ...target.toolbox.recentAt }
      toolboxStore.usageCount = Math.max(0, Math.floor(target.toolbox.usageCount))
      writeIdList(TBX_KEYS.favorites, toolboxStore.favorites, MAX_FAVORITES)
      writeIdList(TBX_KEYS.recent, toolboxStore.recents, MAX_RECENTS)
      writeTimestampMap(TBX_KEYS.recentAt, toolboxStore.recentAt)
      writeCount(TBX_KEYS.usage, toolboxStore.usageCount)

      historyStore.records = clone(target.history).slice(0, 100)
      historyStore.version += 1
      writeStorage(TBX_KEYS.history, historyStore.records)

      return {
        ok: true,
        message: `已穿越到 ${timeLabel(target.createdAt)} · ${target.label}`,
        frame: target,
      }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : '时间旅行失败',
      }
    }
  }

  clear(): void {
    this.frames = []
    this.seq = 0
  }
}

/* ==========================================================================
   热备 / 自动快照：本地槽位
   ========================================================================== */

export interface BackupSlot {
  id: string
  label: string
  createdAt: number
  time: string
  bytes: number
  payload: string
}

export interface BackupEnvelope {
  version: 1
  createdAt: number
  label: string
  checksum: string
  snapshot: CyberSnapshot
}

const HOT_KEY = 'cyber:hot:v1'
const AUTO_KEY = 'cyber:auto:v1'

export const HOT_SLOTS = 3
export const AUTO_SLOTS = 5

export function encodeBackup(snapshot: CyberSnapshot, label = '手动快照'): string {
  const body: BackupEnvelope = {
    version: 1,
    createdAt: Date.now(),
    label: String(label || '手动快照').slice(0, 24),
    checksum: '',
    snapshot,
  }
  body.checksum = crc32Hex(JSON.stringify(body.snapshot))
  return JSON.stringify(body)
}

export function decodeBackup(text: string): {
  ok: boolean
  message: string
  envelope?: BackupEnvelope
} {
  try {
    const raw = JSON.parse(text) as Partial<BackupEnvelope>
    if (!raw || raw.version !== 1 || !raw.snapshot) {
      return { ok: false, message: '备份格式不受支持' }
    }
    const checksum = crc32Hex(JSON.stringify(raw.snapshot))
    if (checksum !== raw.checksum) {
      return { ok: false, message: '备份校验失败，数据可能损坏' }
    }
    return {
      ok: true,
      message: '备份校验通过',
      envelope: {
        version: 1,
        createdAt: Number(raw.createdAt) || Date.now(),
        label: String(raw.label || '备份').slice(0, 24),
        checksum,
        snapshot: raw.snapshot as CyberSnapshot,
      },
    }
  } catch {
    return { ok: false, message: '备份不是合法 JSON' }
  }
}

function readSlots(key: string): BackupSlot[] {
  const raw = readStorage(key)
  if (!Array.isArray(raw)) {
    return []
  }
  const slots: BackupSlot[] = []
  raw.forEach((item) => {
    if (!item || typeof item !== 'object') {
      return
    }
    const record = item as Record<string, unknown>
    if (
      typeof record.id !== 'string' ||
      typeof record.payload !== 'string' ||
      !record.payload
    ) {
      return
    }
    const createdAt = typeof record.createdAt === 'number' ? record.createdAt : 0
    slots.push({
      id: record.id,
      label: typeof record.label === 'string' ? record.label : '历史快照',
      createdAt,
      time: timeLabel(createdAt),
      bytes: record.payload.length,
      payload: record.payload,
    })
  })
  return slots.sort((left, right) => right.createdAt - left.createdAt)
}

function writeSlots(key: string, slots: BackupSlot[], max: number): BackupSlot[] {
  const next = slots
    .filter(
      (slot) =>
        slot &&
        typeof slot.id === 'string' &&
        typeof slot.payload === 'string' &&
        slot.payload.length > 0,
    )
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, max)
  writeStorage(key, next)
  return next
}

export function readHotSlots(): BackupSlot[] {
  return readSlots(HOT_KEY)
}

export function writeHotSlot(payload: string, label = '热备'): BackupSlot[] {
  const next: BackupSlot[] = [
    {
      id: `hot-${Date.now().toString(36)}`,
      label: String(label || '热备').slice(0, 24),
      createdAt: Date.now(),
      time: timeLabel(Date.now()),
      bytes: payload.length,
      payload,
    },
    ...readHotSlots(),
  ]
  return writeSlots(HOT_KEY, next, HOT_SLOTS)
}

export function readAutoSnapshots(): BackupSlot[] {
  return readSlots(AUTO_KEY)
}

export function writeAutoSnapshot(payload: string, label = '自动快照'): BackupSlot[] {
  const next: BackupSlot[] = [
    {
      id: `auto-${Date.now().toString(36)}`,
      label: String(label || '自动快照').slice(0, 24),
      createdAt: Date.now(),
      time: timeLabel(Date.now()),
      bytes: payload.length,
      payload,
    },
    ...readAutoSnapshots(),
  ]
  return writeSlots(AUTO_KEY, next, AUTO_SLOTS)
}

export function restoreBackupPayload(payload: string): {
  ok: boolean
  message: string
  snapshot?: CyberSnapshot
} {
  const parsed = decodeBackup(payload)
  if (!parsed.ok || !parsed.envelope) {
    return { ok: false, message: parsed.message }
  }
  /* 直接写回目标快照，不依赖当前内存帧 */
  try {
    const snapshot = parsed.envelope.snapshot
    preferenceStore.applySnapshot(snapshot.preference)
    preferenceStore.persist()
    uiStore.setThemeMode(snapshot.themeMode)
    toolboxStore.favorites = (snapshot.toolbox.favorites || []).slice(0, MAX_FAVORITES)
    toolboxStore.recents = (snapshot.toolbox.recents || []).slice(0, MAX_RECENTS)
    toolboxStore.recentAt = { ...(snapshot.toolbox.recentAt || {}) }
    toolboxStore.usageCount = Math.max(0, Math.floor(snapshot.toolbox.usageCount || 0))
    writeIdList(TBX_KEYS.favorites, toolboxStore.favorites, MAX_FAVORITES)
    writeIdList(TBX_KEYS.recent, toolboxStore.recents, MAX_RECENTS)
    writeTimestampMap(TBX_KEYS.recentAt, toolboxStore.recentAt)
    writeCount(TBX_KEYS.usage, toolboxStore.usageCount)
    historyStore.records = clone(snapshot.history || []).slice(0, 100)
    historyStore.version += 1
    writeStorage(TBX_KEYS.history, historyStore.records)
    return { ok: true, message: '备份已还原', snapshot }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : '还原失败',
    }
  }
}

/* ==========================================================================
   事件追踪：onLaunch / onShow / Storage 读写
   ========================================================================== */

export type CyberEventKind = 'lifecycle' | 'storage' | 'action' | 'error'

export interface CyberEvent {
  id: string
  at: number
  time: string
  kind: CyberEventKind
  name: string
  detail: string
}

interface StorageLike {
  getStorageSync?: (key: string) => unknown
  setStorageSync?: (key: string, value: unknown) => void
  removeStorageSync?: (key: string) => void
}

export class EventLog {
  private events: CyberEvent[] = []
  private seq = 0
  private max: number
  private hooked = false

  constructor(max = 50) {
    this.max = Math.max(10, Math.min(200, Math.floor(max)))
  }

  push(kind: CyberEventKind, name: string, detail = ''): CyberEvent {
    this.seq += 1
    const at = Date.now()
    const event: CyberEvent = {
      id: `ev-${this.seq}`,
      at,
      time: timeLabel(at),
      kind,
      name: String(name || 'event').slice(0, 32),
      detail: String(detail || '').slice(0, 120),
    }
    this.events.push(event)
    if (this.events.length > this.max) {
      this.events = this.events.slice(this.events.length - this.max)
    }
    return event
  }

  list(limit = this.max): CyberEvent[] {
    const count = Math.max(0, Math.floor(limit))
    return this.events.slice(-count).reverse()
  }

  clear(): void {
    this.events = []
  }

  /** 运行时包裹 wx Storage；页面 onUnload 必须调用返回的 restore */
  installStorageHook(target: StorageLike | undefined): () => void {
    if (!target || this.hooked) {
      return () => undefined
    }
    const originalGet = target.getStorageSync
    const originalSet = target.setStorageSync
    const originalRemove = target.removeStorageSync
    if (
      typeof originalGet !== 'function' ||
      typeof originalSet !== 'function' ||
      typeof originalRemove !== 'function'
    ) {
      return () => undefined
    }
    this.hooked = true
    let reentrant = false

    try {
      target.getStorageSync = (key: string) => {
        if (!reentrant) {
          reentrant = true
          try {
            const value = originalGet.call(target, key)
            const hit = value !== undefined && value !== ''
            this.push('storage', 'getStorageSync', `${key} · ${hit ? 'HIT' : 'MISS'}`)
            return value
          } finally {
            reentrant = false
          }
        }
        return originalGet.call(target, key)
      }

      target.setStorageSync = (key: string, value: unknown) => {
        if (!reentrant) {
          reentrant = true
          try {
            let size = 0
            try {
              size = JSON.stringify(value).length
            } catch {
              size = 0
            }
            this.push('storage', 'setStorageSync', `${key} · ${size} chars`)
            return originalSet.call(target, key, value)
          } finally {
            reentrant = false
          }
        }
        return originalSet.call(target, key, value)
      }

      target.removeStorageSync = (key: string) => {
        if (!reentrant) {
          reentrant = true
          try {
            this.push('storage', 'removeStorageSync', key)
            return originalRemove.call(target, key)
          } finally {
            reentrant = false
          }
        }
        return originalRemove.call(target, key)
      }
    } catch {
      /* 某些宿主把 wx 方法定义为只读：放弃 Hook，保证页面仍可正常读取 Storage */
      target.getStorageSync = originalGet
      target.setStorageSync = originalSet
      target.removeStorageSync = originalRemove
      this.hooked = false
      return () => undefined
    }

    return () => {
      if (!this.hooked) {
        return
      }
      target.getStorageSync = originalGet
      target.setStorageSync = originalSet
      target.removeStorageSync = originalRemove
      this.hooked = false
    }
  }
}
