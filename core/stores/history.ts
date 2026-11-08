/* ==========================================================================
   historyStore · 全局本机计算轨迹
   - 最多 100 条，超限淘汰最旧；只存摘要，不存原始图片，不上传
   - 写入 wx.setStorageSync 前 350ms 防抖，避免主线程被高频 setData 拖慢
   - 读取时逐条校验坏数据；容量异常时自动裁剪，绝不让坏存档拖垮启动
   - 清空工具数据时先 clearMemory 取消在途写入，再由 storage 层删除 tbx:*
   ========================================================================== */
import { observable } from 'mobx-miniprogram'
import { readStorage, writeStorage, removeStorage, TBX_KEYS } from '../toolbox/storage'
import type { ToolCategory } from '../toolbox/types'
import { logger } from '../utils/logger'

export const HISTORY_MAX = 100
const WRITE_DEBOUNCE_MS = 350
const MAX_TOOL_NAME = 24
const MAX_CATEGORY_LABEL = 12
const MAX_INPUT = 140
const MAX_OUTPUT = 160
const MAX_ICON = 4

export interface HistoryRecord {
  id: string
  toolId: string
  toolName: string
  category: ToolCategory
  categoryLabel: string
  icon: string
  timestamp: number
  /** 结果产生时是否为夜航模式 */
  night: boolean
  /** 白昼 / 夜航（历史值，不随当前主题变化） */
  themeLabel: string
  inputSummary: string
  outputSummary: string
  /** 埋点阶段按字段 label 预计算的脱敏摘要；旧存档可能缺失 */
  inputMasked?: string
  outputMasked?: string
}

export interface HistoryDraft {
  toolId: string
  toolName: string
  category: ToolCategory
  categoryLabel?: string
  icon?: string
  night: boolean
  themeLabel?: string
  inputSummary?: string
  outputSummary?: string
  inputMasked?: string
  outputMasked?: string
}

interface HistoryRuntime {
  timer: number
  dirty: boolean
  seq: number
  inited: boolean
}

const runtime: HistoryRuntime = {
  timer: 0,
  dirty: false,
  seq: 0,
  inited: false,
}

function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return ''
  }
  const text = String(value).replace(/\s+/g, ' ').trim()
  if (!text) {
    return ''
  }
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function isValidCategory(value: unknown): value is ToolCategory {
  return value === 'calc' || value === 'date' || value === 'text' || value === 'media' || value === 'life' || value === 'work'
}

function parseStored(raw: unknown): HistoryRecord[] {
  let value = raw
  if (typeof raw === 'string') {
    if (!raw) {
      return []
    }
    try {
      value = JSON.parse(raw) as unknown
    } catch {
      return []
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    value = Array.isArray(record.records) ? record.records : []
  }
  if (!Array.isArray(value)) {
    return []
  }

  const records: HistoryRecord[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue
    }
    const record = item as Record<string, unknown>
    const toolId = cleanText(record.toolId, 40)
    const toolName = cleanText(record.toolName, MAX_TOOL_NAME)
    const timestamp = Number(record.timestamp)
    if (!toolId || !toolName || !Number.isFinite(timestamp) || timestamp <= 0) {
      continue
    }
    const category = isValidCategory(record.category) ? record.category : 'calc'
    records.push({
      id: cleanText(record.id, 48) || `h-restored-${Math.round(timestamp)}-${records.length}`,
      toolId,
      toolName,
      category,
      categoryLabel: cleanText(record.categoryLabel, MAX_CATEGORY_LABEL) || '效率工具',
      icon: cleanText(record.icon, MAX_ICON) || '·',
      timestamp,
      night: record.night === true,
      themeLabel: record.themeLabel === '夜航' ? '夜航' : '白昼',
      inputSummary: cleanText(record.inputSummary, MAX_INPUT),
      outputSummary: cleanText(record.outputSummary, MAX_OUTPUT),
      inputMasked: cleanText(record.inputMasked, MAX_INPUT) || undefined,
      outputMasked: cleanText(record.outputMasked, MAX_OUTPUT) || undefined,
    })
    if (records.length >= HISTORY_MAX) {
      break
    }
  }
  return records
}

function setWriteFailed(failed: boolean): void {
  if (historyStore.writeFailed === failed) {
    return
  }
  historyStore.writeFailed = failed
  /* 让可见中的驾驶舱立即刷新“存储空间不足”提示 */
  historyStore.version += 1
}

function writeNow(records: HistoryRecord[]): boolean {
  const ok = writeStorage(TBX_KEYS.history, records)
  setWriteFailed(!ok)
  if (ok) {
    return true
  }
  /* 配额 / 存储异常：先砍半再试一次，保住最近轨迹 */
  const half = records.slice(0, Math.max(20, Math.floor(records.length / 2)))
  const retry = writeStorage(TBX_KEYS.history, half)
  if (!retry) {
    logger.warn('history', '轨迹写入失败，已保留内存数据等待下次重试')
  }
  /* 首次整表写入失败即已发生降级：即使半表重试成功，也保留提示，
     下一次整表写入成功时再自动清除 */
  return retry
}

export const historyStore = observable({
  records: [] as HistoryRecord[],
  /** 供驾驶舱绑定的轻量版本号：避免把 100 条原始数据反复 setData */
  version: 0,
  /** 最近一次落盘是否失败：驾驶舱据此提示“部分轨迹可能未保存” */
  writeFailed: false,

  get count(): number {
    return this.records.length
  },

  init(): void {
    if (runtime.inited) {
      return
    }
    runtime.inited = true
    const loaded = parseStored(readStorage(TBX_KEYS.history))
    /* 新记录优先：旧存档若时间顺序异常，按时间倒序修正 */
    loaded.sort((a, b) => b.timestamp - a.timestamp)
    this.records = loaded.slice(0, HISTORY_MAX)
    this.version += 1
  },

  record(draft: HistoryDraft): HistoryRecord | null {
    this.init()
    if (!draft || !draft.toolId) {
      return null
    }
    runtime.seq += 1
    const timestamp = Date.now()
    const record: HistoryRecord = {
      id: `h-${timestamp}-${runtime.seq}`,
      toolId: cleanText(draft.toolId, 40),
      toolName: cleanText(draft.toolName, MAX_TOOL_NAME) || '效率工具',
      category: isValidCategory(draft.category) ? draft.category : 'calc',
      categoryLabel: cleanText(draft.categoryLabel, MAX_CATEGORY_LABEL) || '效率工具',
      icon: cleanText(draft.icon, MAX_ICON) || '·',
      timestamp,
      night: draft.night === true,
      themeLabel: draft.themeLabel === '夜航' ? '夜航' : '白昼',
      inputSummary: cleanText(draft.inputSummary, MAX_INPUT),
      outputSummary: cleanText(draft.outputSummary, MAX_OUTPUT),
      inputMasked: cleanText(draft.inputMasked, MAX_INPUT) || undefined,
      outputMasked: cleanText(draft.outputMasked, MAX_OUTPUT) || undefined,
    }
    this.records = [record, ...this.records].slice(0, HISTORY_MAX)
    this.version += 1
    runtime.dirty = true
    this.scheduleWrite()
    return record
  },

  /** 删除单条轨迹：立即落盘，供驾驶舱单条删除使用 */
  remove(id: string): boolean {
    const target = String(id || '')
    if (!target) {
      return false
    }
    const next = this.records.filter((record) => record.id !== target)
    if (next.length === this.records.length) {
      return false
    }
    this.records = next
    this.version += 1
    runtime.dirty = true
    this.flush()
    return true
  },

  scheduleWrite(): void {
    if (runtime.timer) {
      clearTimeout(runtime.timer)
      runtime.timer = 0
    }
    runtime.timer = setTimeout(() => {
      runtime.timer = 0
      this.flush()
    }, WRITE_DEBOUNCE_MS) as unknown as number
  },

  /** 立即落盘：App.onHide 与页面卸载时调用 */
  flush(): void {
    if (runtime.timer) {
      clearTimeout(runtime.timer)
      runtime.timer = 0
    }
    if (!runtime.dirty) {
      return
    }
    runtime.dirty = false
    writeNow(this.records)
  },

  /** 清空轨迹：取消在途写入并删除本机键 */
  clear(): void {
    if (runtime.timer) {
      clearTimeout(runtime.timer)
      runtime.timer = 0
    }
    runtime.dirty = false
    this.records = []
    this.writeFailed = false
    this.version += 1
    removeStorage(TBX_KEYS.history)
  },

  /** 清空工具数据前调用：只清内存并取消在途写入，storage 层统一删 tbx:* */
  clearMemory(): void {
    if (runtime.timer) {
      clearTimeout(runtime.timer)
      runtime.timer = 0
    }
    runtime.dirty = false
    this.records = []
    this.writeFailed = false
    this.version += 1
    runtime.inited = true
  },
})
