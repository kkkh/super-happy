/* ==========================================================================
   history-snapshots · 清理 Cyber 快照 / 热备 / 时间轴帧中的历史轨迹副本
   - 驾驶舱「清除快照轨迹」、单条删除与「清空工具数据」共用
   - 只改 snapshot.history / frame.history，保留主题 / 收藏 / 偏好等其他字段
   - 修改后重算 CRC32，保证 Time Travel 仍能正常解码
   ========================================================================== */
import { crc32Hex } from './crc32'
import { readStorage, writeStorage } from './storage'

const SNAPSHOT_KEYS = ['cyber:auto:v1', 'cyber:hot:v1'] as const
/** 时间轴帧以裸数组保存，结构与 auto/hot 的 slot payload 不同，单独处理 */
const FRAME_KEY = 'cyber:frames:v1'

interface SnapshotSlot {
  id: string
  label?: string
  createdAt?: number
  time?: string
  bytes?: number
  payload: string
}

interface SnapshotEnvelope {
  version?: number
  createdAt?: number
  label?: string
  checksum?: string
  snapshot?: {
    history?: unknown[]
    [key: string]: unknown
  }
}

interface SnapshotMutationResult {
  slots: number
  records: number
}

function parseSlots(raw: unknown): SnapshotSlot[] {
  if (!Array.isArray(raw)) {
    return []
  }
  const slots: SnapshotSlot[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue
    }
    const record = item as Record<string, unknown>
    if (typeof record.payload !== 'string' || !record.payload) {
      continue
    }
    slots.push({
      id: typeof record.id === 'string' ? record.id : '',
      label: typeof record.label === 'string' ? record.label : undefined,
      createdAt: typeof record.createdAt === 'number' ? record.createdAt : undefined,
      time: typeof record.time === 'string' ? record.time : undefined,
      bytes: typeof record.bytes === 'number' ? record.bytes : undefined,
      payload: record.payload,
    })
  }
  return slots
}

function parseEnvelope(payload: string): SnapshotEnvelope | null {
  try {
    const value = JSON.parse(payload) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null
    }
    const envelope = value as SnapshotEnvelope
    if (envelope.version !== 1 || !envelope.snapshot || typeof envelope.snapshot !== 'object') {
      return null
    }
    return envelope
  } catch {
    return null
  }
}

function historyOf(envelope: SnapshotEnvelope): unknown[] {
  const history = envelope.snapshot && envelope.snapshot.history
  return Array.isArray(history) ? history : []
}

function rewriteSlot(slot: SnapshotSlot, envelope: SnapshotEnvelope, history: unknown[]): void {
  if (!envelope.snapshot) {
    return
  }
  const snapshot = { ...envelope.snapshot, history }
  const nextEnvelope: SnapshotEnvelope = {
    ...envelope,
    snapshot,
  }
  nextEnvelope.checksum = crc32Hex(JSON.stringify(snapshot))
  slot.payload = JSON.stringify(nextEnvelope)
  slot.bytes = slot.payload.length
}

function mutateSnapshots(
  mutator: (history: unknown[], slot: SnapshotSlot) => { next: unknown[]; removed: number } | null,
): SnapshotMutationResult {
  let slotsChanged = 0
  let recordsRemoved = 0

  for (const key of SNAPSHOT_KEYS) {
    const slots = parseSlots(readStorage(key))
    if (!slots.length) {
      continue
    }
    let changed = false
    for (const slot of slots) {
      const envelope = parseEnvelope(slot.payload)
      if (!envelope) {
        continue
      }
      const history = historyOf(envelope)
      const result = mutator(history, slot)
      if (!result) {
        continue
      }
      rewriteSlot(slot, envelope, result.next)
      recordsRemoved += result.removed
      changed = true
    }
    if (changed) {
      writeStorage(key, slots)
      slotsChanged += 1
    }
  }

  return { slots: slotsChanged, records: recordsRemoved }
}

interface FrameRecord {
  history?: unknown[]
  [key: string]: unknown
}

function parseFrames(raw: unknown): FrameRecord[] {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.filter(
    (item): item is FrameRecord =>
      Boolean(item) && typeof item === 'object' && !Array.isArray(item),
  )
}

function countHistoryInFrames(): number {
  return parseFrames(readStorage(FRAME_KEY)).reduce(
    (total, frame) => total + (Array.isArray(frame.history) ? frame.history.length : 0),
    0,
  )
}

function mutateFrameHistory(
  mutator: (history: unknown[]) => unknown[] | null,
): { changed: boolean; removed: number } {
  const frames = parseFrames(readStorage(FRAME_KEY))
  if (!frames.length) {
    return { changed: false, removed: 0 }
  }
  let changed = false
  let removed = 0
  const next = frames.map((frame) => {
    const history = Array.isArray(frame.history) ? frame.history : []
    const result = mutator(history)
    if (!result) {
      return frame
    }
    changed = true
    removed += history.length - result.length
    return { ...frame, history: result }
  })
  if (changed) {
    writeStorage(FRAME_KEY, next)
  }
  return { changed, removed }
}

/** 自动快照 + 热备 + 时间轴帧里一共还存着多少条历史轨迹副本 */
export function countHistoryInSnapshots(): number {
  let total = 0
  for (const key of SNAPSHOT_KEYS) {
    for (const slot of parseSlots(readStorage(key))) {
      const envelope = parseEnvelope(slot.payload)
      if (envelope) {
        total += historyOf(envelope).length
      }
    }
  }
  return total + countHistoryInFrames()
}

/** 清除所有快照 / 热备 / 时间轴帧中的历史轨迹，保留其他快照字段 */
export function purgeHistoryFromSnapshots(): SnapshotMutationResult {
  const result = mutateSnapshots((history) => {
    if (!history.length) {
      return null
    }
    return { next: [], removed: history.length }
  })
  const frames = mutateFrameHistory((history) =>
    history.length ? [] : null,
  )
  return {
    slots: result.slots + (frames.changed ? 1 : 0),
    records: result.records + frames.removed,
  }
}

/** 从所有快照 / 热备 / 时间轴帧中移除指定 id 的轨迹 */
export function purgeHistoryRecordFromSnapshots(id: string): number {
  const target = String(id || '')
  if (!target) {
    return 0
  }
  const result = mutateSnapshots((history) => {
    const next = history.filter((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return true
      }
      const record = item as Record<string, unknown>
      return typeof record.id === 'string' ? record.id !== target : true
    })
    if (next.length === history.length) {
      return null
    }
    return { next, removed: history.length - next.length }
  })
  const frames = mutateFrameHistory((history) => {
    const next = history.filter((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return true
      }
      const record = item as Record<string, unknown>
      return typeof record.id === 'string' ? record.id !== target : true
    })
    return next.length === history.length ? null : next
  })
  return result.records + frames.removed
}
