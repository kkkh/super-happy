/* ==========================================================================
   focus-level · 等级 / 累计时长 / 连续值
   - 只统计验签通过的记录；tainted 不加等级，keyLost 冻结等级
   - 等级阈值 L1 0h / L2 2h / L3 8h / L4 20h / L5 50h / L6 100h
   - 纯函数：不调用 wx / DOM；stats 每次变更后重新签名
   ========================================================================== */
import type {
  FocusRecordCheck,
  FocusRecordReason,
  FocusStats,
} from './focus-types'
import {
  isValidKeyHex,
  signStats,
} from './focus-crypto'
import { MAX_PHASE_MS } from './focus-fsm'

export const LEVEL_THRESHOLDS_MS = [
  0,
  2 * 60 * 60 * 1000,
  8 * 60 * 60 * 1000,
  20 * 60 * 60 * 1000,
  50 * 60 * 60 * 1000,
  100 * 60 * 60 * 1000,
] as const

export const LEVEL_LABELS = [
  '初识心流',
  '渐入佳境',
  '稳定心流',
  '深度专注',
  '心流大师',
  '心流传奇',
] as const

export const MAX_LEVEL = 6

/** 单条记录的有效专注上限：与 phase 上限一致，超过即视为异常 */
export const MAX_RECORD_FOCUS_MS = MAX_PHASE_MS

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function finiteNonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : 0
}

export function levelFromFocusMs(totalFocusMs: number): number {
  const total = finiteNonNegative(totalFocusMs)
  let level = 1
  for (let index = 1; index < LEVEL_THRESHOLDS_MS.length; index += 1) {
    if (total >= LEVEL_THRESHOLDS_MS[index]) {
      level = index + 1
    }
  }
  return level
}

export function levelLabel(level: number): string {
  const safe = Math.min(MAX_LEVEL, Math.max(1, Math.round(finiteNonNegative(level))))
  return LEVEL_LABELS[safe - 1]
}

/** 下一级门槛；已满级返回 null */
export function nextLevelAt(level: number): number | null {
  const safe = Math.min(MAX_LEVEL, Math.max(1, Math.round(finiteNonNegative(level))))
  if (safe >= MAX_LEVEL) {
    return null
  }
  return LEVEL_THRESHOLDS_MS[safe]
}

/** 本地时区 YYYY-MM-DD；非法时间返回空串 */
export function formatLocalDate(timestamp: number): string {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    return ''
  }
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** 日期键平移；非法键返回空串 */
export function shiftLocalDate(dateKey: string, deltaDays: number): string {
  if (!DATE_KEY_PATTERN.test(dateKey)) {
    return ''
  }
  const [year, month, day] = dateKey.split('-').map((part) => Number(part))
  const date = new Date(year, month - 1, day)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  date.setDate(date.getDate() + deltaDays)
  return formatLocalDate(date.getTime())
}

/**
 * 连续天数规则：
 * - 昨天完成 → +1
 * - 今天已完成 → 不变（至少保持 1）
 * - 其他 → 1
 */
export function nextStreakDays(
  streakDays: number,
  lastCompletedDate: string,
  todayDate: string,
): number {
  if (!todayDate) {
    return 1
  }
  const current = Math.max(1, Math.floor(finiteNonNegative(streakDays)))
  if (lastCompletedDate === todayDate) {
    return current
  }
  if (lastCompletedDate === shiftLocalDate(todayDate, -1)) {
    return current + 1
  }
  return 1
}

export function createEmptyFocusStats(now: number, keyHex: string): FocusStats {
  const stats: FocusStats = {
    version: 1,
    totalFocusMs: 0,
    completedCount: 0,
    level: 1,
    streakDays: 0,
    lastCompletedDate: '',
    todayDate: formatLocalDate(now),
    todayFocusMs: 0,
    continuousFocusMs: 0,
    lastAppliedRecordId: '',
    updatedAt: now,
    signature: '',
  }
  stats.signature = signStats(stats, keyHex)
  return stats
}

export interface ApplyFocusRecordOptions {
  now: number
  keyHex: string
  /** session 结算时的连续专注累计；缺省按旧值 + focusedMs */
  continuousFocusMs?: number
}

export interface ApplyFocusRecordResult {
  stats: FocusStats
  applied: boolean
  reason: FocusRecordReason
}

function unchanged(
  stats: FocusStats,
  reason: FocusRecordReason,
): ApplyFocusRecordResult {
  return { stats, applied: false, reason }
}

/**
 * 把一条已验签记录写入 stats。
 * - key 缺失 / 验签失败 / 记录异常 / 同 id 重复 → 原样返回
 * - 成功则累加终身 / 今日 / 完成数，更新连续天数与等级，并重新签名
 */
export function applyFocusRecordToStats(
  stats: FocusStats,
  check: FocusRecordCheck,
  options: ApplyFocusRecordOptions,
): ApplyFocusRecordResult {
  const record = check.record

  if (!isValidKeyHex(options.keyHex)) {
    return unchanged(stats, 'keyLost')
  }
  if (!check.verified) {
    return unchanged(
      stats,
      check.reason === 'ok' ? 'signature' : check.reason,
    )
  }
  if (!record.id) {
    return unchanged(stats, 'corrupt')
  }
  if (stats.lastAppliedRecordId === record.id) {
    return unchanged(stats, 'ok')
  }

  const startedAt = record.startedAt
  const endedAt = record.endedAt
  const focusedMs = record.focusedMs
  if (
    typeof startedAt !== 'number' ||
    !Number.isFinite(startedAt) ||
    startedAt <= 0 ||
    typeof endedAt !== 'number' ||
    !Number.isFinite(endedAt) ||
    endedAt <= 0 ||
    typeof focusedMs !== 'number' ||
    !Number.isFinite(focusedMs) ||
    focusedMs < 0 ||
    focusedMs > MAX_RECORD_FOCUS_MS
  ) {
    return unchanged(stats, 'corrupt')
  }
  if (endedAt < startedAt) {
    return unchanged(stats, 'clock')
  }
  /* 专注时长不得超过墙钟跨度；容忍 1s 的取整误差 */
  if (focusedMs > endedAt - startedAt + 1000) {
    return unchanged(stats, 'clock')
  }

  const now = options.now
  if (typeof now !== 'number' || !Number.isFinite(now) || now <= 0) {
    return unchanged(stats, 'corrupt')
  }

  const todayDate = formatLocalDate(now)
  if (!todayDate) {
    return unchanged(stats, 'corrupt')
  }

  const alreadyToday = stats.todayDate === todayDate
  const nextTodayFocusMs =
    (alreadyToday ? finiteNonNegative(stats.todayFocusMs) : 0) + focusedMs
  const nextTotalFocusMs = finiteNonNegative(stats.totalFocusMs) + focusedMs
  const nextCompletedCount = Math.floor(finiteNonNegative(stats.completedCount)) + 1
  const nextStreak = nextStreakDays(
    stats.streakDays,
    stats.lastCompletedDate,
    todayDate,
  )
  const continuous =
    typeof options.continuousFocusMs === 'number' &&
    Number.isFinite(options.continuousFocusMs) &&
    options.continuousFocusMs >= 0
      ? options.continuousFocusMs
      : finiteNonNegative(stats.continuousFocusMs) + focusedMs

  const next: FocusStats = {
    version: 1,
    totalFocusMs: nextTotalFocusMs,
    completedCount: nextCompletedCount,
    level: levelFromFocusMs(nextTotalFocusMs),
    streakDays: nextStreak,
    lastCompletedDate: todayDate,
    todayDate,
    todayFocusMs: nextTodayFocusMs,
    continuousFocusMs: continuous,
    lastAppliedRecordId: record.id,
    updatedAt: now,
    signature: '',
  }
  next.signature = signStats(next, options.keyHex)

  return { stats: next, applied: true, reason: 'ok' }
}
