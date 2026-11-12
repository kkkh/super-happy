/* ==========================================================================
   draft · 工具草稿（继续上次）
   - 只保存用户主动输入与模式，绝不保存结果
   - 存储键 tbx:draft.<id>；单工具 4KB、最多 20 个、30 天自动淘汰
   - sensitive !== '' 或 draftExcluded === true 的工具一律不写
   - 页面通过 collectDraftInput / applyDraftInput 显式接入
   ========================================================================== */
import { TOOLS } from './registry'
import { readStorage, removeStorage, writeStorage } from './storage'

/** 计算 JSON 文本的 UTF-8 字节数：草稿存储按字节而不是字符计 */
function utf8Bytes(text: string): number {
  let bytes = 0
  for (const char of Array.from(text)) {
    const code = char.codePointAt(0) ?? 0
    if (code <= 0x7f) {
      bytes += 1
    } else if (code <= 0x7ff) {
      bytes += 2
    } else if (code <= 0xffff) {
      bytes += 3
    } else {
      bytes += 4
    }
  }
  return bytes
}

/** 草稿命名空间：清空工具数据时随 tbx: 前缀一起删除 */
export const DRAFT_NS = 'tbx:draft.'
/** 最多保留的工具草稿数 */
export const MAX_DRAFT_TOOLS = 20
/** 单工具草稿 JSON 的 UTF-8 字节上限 */
export const MAX_DRAFT_BYTES = 4096
/** 草稿有效期：30 天 */
export const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000
/** 模式字段最大长度，防止异常页面写入超长文本 */
const MAX_MODE_LENGTH = 64

export interface ToolDraft {
  v: 1
  mode: string
  input: Record<string, string>
  at: number
}

export type DraftSaveResult = 'saved' | 'skipped' | 'empty' | 'failed'

export interface DraftPruneResult {
  removed: number
  kept: number
}

/** 页面接入契约：外壳只依赖这三个可选方法 */
export interface DraftPageBridge {
  /** 返回当前输入快照；空对象表示无可保存输入 */
  collectDraftInput?(): Record<string, string>
  /** 回填输入并重新计算；页面必须自行保证结果由输入重算，不来自草稿 */
  applyDraftInput?(input: Record<string, string>, mode: string): void
  /** 当前模式；未实现时按空串处理 */
  draftMode?(): string
}

export function draftKey(toolId: string): string {
  return `${DRAFT_NS}${toolId}`
}

/** 工具是否允许写草稿：未知 id、敏感工具、声明排除的工具都不允许 */
export function draftAllowed(toolId: string): boolean {
  if (!toolId) {
    return false
  }
  const meta = TOOLS.find((tool) => tool.id === toolId)
  if (!meta) {
    return false
  }
  return meta.sensitive === '' && meta.draftExcluded !== true
}

function isExpired(at: number, now: number): boolean {
  return !Number.isFinite(at) || at <= 0 || now - at > DRAFT_TTL_MS
}

/** 存储可能是对象，也可能是历史 JSON 字符串；坏数据一律丢弃 */
function parseDraft(raw: unknown): ToolDraft | null {
  let value: unknown = raw
  if (typeof raw === 'string') {
    if (!raw) {
      return null
    }
    try {
      value = JSON.parse(raw) as unknown
    } catch {
      return null
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const record = value as Record<string, unknown>
  if (record.v !== 1) {
    return null
  }
  if (typeof record.mode !== 'string' || typeof record.at !== 'number') {
    return null
  }
  if (!record.input || typeof record.input !== 'object' || Array.isArray(record.input)) {
    return null
  }
  const input: Record<string, string> = {}
  for (const [key, item] of Object.entries(record.input as Record<string, unknown>)) {
    if (typeof key === 'string' && key && key.length <= 64 && typeof item === 'string') {
      input[key] = item
    }
  }
  return {
    v: 1,
    mode: record.mode.slice(0, MAX_MODE_LENGTH),
    input,
    at: record.at,
  }
}

/** 规范化输入：只接受字符串、丢弃空值；异常值不影响其余字段 */
function sanitizeInput(input: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return out
  }
  for (const [key, value] of Object.entries(input)) {
    if (typeof key === 'string' && key && key.length <= 64 && typeof value === 'string' && value !== '') {
      out[key] = value
    }
  }
  return out
}

function sanitizeMode(mode: string): string {
  return typeof mode === 'string' ? mode.slice(0, MAX_MODE_LENGTH) : ''
}

function draftBytes(mode: string, input: Record<string, string>, at: number): number {
  return utf8Bytes(JSON.stringify({ v: 1, mode, input, at }))
}

/** 超出 4KB 时确定性截断：先折半最长值，再丢弃末位字段；保证最终可写上 */
function fitBudget(
  mode: string,
  input: Record<string, string>,
  at: number,
): { mode: string; input: Record<string, string> } | null {
  let currentMode = sanitizeMode(mode)
  let entries = Object.entries(input)
  let guard = 0
  while (draftBytes(currentMode, Object.fromEntries(entries), at) > MAX_DRAFT_BYTES) {
    guard += 1
    if (guard > 200) {
      return null
    }
    let longest = -1
    let longestBytes = 0
    entries.forEach((entry, index) => {
      const bytes = utf8Bytes(entry[1])
      if (bytes > longestBytes) {
        longest = index
        longestBytes = bytes
      }
    })
    if (longest >= 0 && longestBytes > 1) {
      const chars = Array.from(entries[longest][1])
      const keep = Math.max(1, Math.floor(chars.length / 2))
      entries[longest] = [entries[longest][0], chars.slice(0, keep).join('')]
      continue
    }
    if (entries.length > 1) {
      entries = entries.slice(0, -1)
      continue
    }
    /* 单字段且已缩到 1 字符仍超限：只能继续压缩模式字段 */
    if (currentMode.length > 0) {
      currentMode = currentMode.slice(0, Math.floor(currentMode.length / 2))
      continue
    }
    return null
  }
  return { mode: currentMode, input: Object.fromEntries(entries) }
}

function draftStorageKeys(): string[] {
  try {
    return wx.getStorageInfoSync().keys.filter((key) => key.startsWith(DRAFT_NS))
  } catch {
    return []
  }
}

/** 读取草稿：过期、工具已敏感或结构损坏都会就地删除 */
export function readDraft(toolId: string, now = Date.now()): ToolDraft | null {
  const key = draftKey(toolId)
  const raw = readStorage(key)
  if (!draftAllowed(toolId)) {
    if (raw !== '' && raw !== undefined) {
      removeStorage(key)
    }
    return null
  }
  const draft = parseDraft(raw)
  if (!draft) {
    if (raw !== '' && raw !== undefined) {
      removeStorage(key)
    }
    return null
  }
  if (isExpired(draft.at, now)) {
    removeStorage(key)
    return null
  }
  return draft
}

/** 保存草稿；空输入会清除旧草稿，返回 empty */
export function saveDraft(
  toolId: string,
  payload: { mode?: string; input: Record<string, string> },
  now = Date.now(),
): DraftSaveResult {
  if (!draftAllowed(toolId)) {
    return 'skipped'
  }
  const input = sanitizeInput(payload.input)
  if (Object.keys(input).length === 0) {
    clearDraft(toolId)
    return 'empty'
  }
  const fitted = fitBudget(sanitizeMode(payload.mode ?? ''), input, now)
  if (!fitted) {
    return 'failed'
  }
  const draft: ToolDraft = { v: 1, mode: fitted.mode, input: fitted.input, at: now }
  if (!writeStorage(draftKey(toolId), draft)) {
    return 'failed'
  }
  pruneDrafts(now)
  return 'saved'
}

export function clearDraft(toolId: string): boolean {
  return removeStorage(draftKey(toolId))
}

/** 清理全部草稿：供“清空工具数据”的白名单路径显式调用 */
export function clearAllDrafts(): number {
  let removed = 0
  for (const key of draftStorageKeys()) {
    if (removeStorage(key)) {
      removed += 1
    }
  }
  return removed
}

/** 淘汰过期与超限草稿：按最近写入时间保留最新 20 个 */
export function pruneDrafts(now = Date.now()): DraftPruneResult {
  const alive: Array<{ key: string; at: number }> = []
  let removed = 0
  for (const key of draftStorageKeys()) {
    const draft = parseDraft(readStorage(key))
    const toolId = key.slice(DRAFT_NS.length)
    if (!draft || !draftAllowed(toolId) || isExpired(draft.at, now)) {
      if (removeStorage(key)) {
        removed += 1
      }
      continue
    }
    alive.push({ key, at: draft.at })
  }
  if (alive.length > MAX_DRAFT_TOOLS) {
    alive.sort((left, right) => left.at - right.at)
    const overflow = alive.length - MAX_DRAFT_TOOLS
    for (let index = 0; index < overflow; index += 1) {
      if (removeStorage(alive[index].key)) {
        removed += 1
      }
    }
    return { removed, kept: MAX_DRAFT_TOOLS }
  }
  return { removed, kept: alive.length }
}
