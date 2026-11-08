/* ==========================================================================
   focus-fsm · 全息专注状态机
   - focusing / paused / breaking / overheat 四态；idle / preparing 不落库
   - 时间戳唯一真相：禁止 setInterval 递减，剩余时间永远由 phaseEndsAt 推导
   - 长休 15min、短休 5min、Overheat 连续 2h 锁 30min
   - 纯函数：不调用 wx / DOM / crypto；签名由 focus-storage 统一负责
   ========================================================================== */
import type {
  FocusAudioPrefs,
  FocusConfidence,
  FocusSession,
  FocusStats,
} from './focus-types'

export const FOCUS_DURATION_MS = 25 * 60 * 1000
export const SHORT_BREAK_MS = 5 * 60 * 1000
export const LONG_BREAK_MS = 15 * 60 * 1000
export const OVERHEAT_THRESHOLD_MS = 2 * 60 * 60 * 1000
export const OVERHEAT_LOCK_MS = 30 * 60 * 1000
/** 单个 phase 的硬上限：仅用于合法性校验，不用会话年龄判断损坏 */
export const MAX_PHASE_MS = 6 * 60 * 60 * 1000
export const HEARTBEAT_STALE_MS = 180 * 1000

const MIN_PHASE_MS = 60 * 1000

function nonNegativeInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0
}

function validNow(now: number): boolean {
  return typeof now === 'number' && Number.isFinite(now) && now > 0
}

export function cloneFocusAudio(audio: FocusAudioPrefs): FocusAudioPrefs {
  return {
    rain: audio.rain === true,
    fire: audio.fire === true,
    keyboard: audio.keyboard === true,
    volumes: {
      rain: audio.volumes?.rain ?? 0.45,
      fire: audio.volumes?.fire ?? 0.3,
      keyboard: audio.volumes?.keyboard ?? 0.25,
    },
    masterVolume: audio.masterVolume ?? 0.55,
    bgm: audio.bgm === true,
  }
}

export interface CreateFocusSessionInput {
  id: string
  tag: string
  audio: FocusAudioPrefs
  stats: Pick<FocusStats, 'completedCount' | 'continuousFocusMs'>
  now: number
  confidence?: FocusConfidence
  /** 默认 25min；仅测试或后续自定义时长使用 */
  phaseTotalMs?: number
}

/**
 * 新 session 从 stats 初始化：
 * completedFocus = stats.completedCount
 * cycle = (completedFocus % 4) + 1
 * continuousFocusMs = stats.continuousFocusMs
 */
export function createFocusSession(input: CreateFocusSessionInput): FocusSession {
  const id = String(input.id || '').trim()
  if (!id) {
    throw new Error('focus session id 不能为空')
  }
  if (!validNow(input.now)) {
    throw new Error('focus session now 不合法')
  }
  const completedFocus = nonNegativeInt(input.stats.completedCount)
  const continuousFocusMs = nonNegativeInt(input.stats.continuousFocusMs)
  const phaseTotalMs =
    typeof input.phaseTotalMs === 'number' &&
    Number.isFinite(input.phaseTotalMs) &&
    input.phaseTotalMs >= MIN_PHASE_MS &&
    input.phaseTotalMs <= MAX_PHASE_MS
      ? Math.floor(input.phaseTotalMs)
      : FOCUS_DURATION_MS

  return {
    version: 1,
    id: id.slice(0, 80),
    fsm: 'focusing',
    tag: String(input.tag || '').trim().slice(0, 40),
    startedAt: input.now,
    phaseStartedAt: input.now,
    phaseEndsAt: input.now + phaseTotalMs,
    phaseTotalMs,
    remainingMs: 0,
    cycle: (completedFocus % 4) + 1,
    completedFocus,
    continuousFocusMs,
    breaches: 0,
    audio: cloneFocusAudio(input.audio),
    updatedAt: input.now,
    lastHeartbeatAt: input.now,
    confidence: input.confidence === 'low' ? 'low' : 'high',
    signature: '',
  }
}

/** 当前 phase 剩余；focusing / breaking 由时间戳推导，paused 用冻结值，overheat 用锁到期 */
export function focusRemainingMs(session: FocusSession, now: number): number {
  const at = validNow(now) ? now : 0
  if (session.fsm === 'paused') {
    return Math.min(
      Math.max(0, Math.floor(session.remainingMs)),
      Math.max(0, session.phaseTotalMs),
    )
  }
  if (session.fsm === 'overheat') {
    return Math.max(0, Math.floor((session.lockUntil ?? 0) - at))
  }
  return Math.max(0, Math.floor(session.phaseEndsAt - at))
}

export function isOverheatActive(session: FocusSession, now: number): boolean {
  return session.fsm === 'overheat' && focusRemainingMs(session, now) > 0
}

export function isLongBreakSession(session: FocusSession): boolean {
  return session.fsm === 'breaking' && session.phaseTotalMs >= LONG_BREAK_MS
}

/** 心跳缺失超过 180s → low；只降低星云饱和度，不判作弊 */
export function refreshFocusConfidence(
  session: FocusSession,
  now: number,
): FocusSession {
  if (!validNow(now)) {
    return session
  }
  const last = session.lastHeartbeatAt
  const stale =
    typeof last !== 'number' ||
    !Number.isFinite(last) ||
    now - last > HEARTBEAT_STALE_MS
  const confidence: FocusConfidence = stale ? 'low' : 'high'
  if (session.confidence === confidence) {
    return session
  }
  return { ...session, confidence, updatedAt: now }
}

/** 暂停：冻结 remainingMs；计时停止 */
export function pauseFocusSession(
  session: FocusSession,
  now: number,
): FocusSession {
  if (session.fsm !== 'focusing' || !validNow(now)) {
    return session
  }
  return {
    ...session,
    fsm: 'paused',
    remainingMs: focusRemainingMs(session, now),
    updatedAt: now,
  }
}

/**
 * 继续：phaseEndsAt = now + remainingMs。
 * phaseStartedAt 回推 elapsed，使 phaseEndsAt ≈ phaseStartedAt + phaseTotalMs
 * 仍成立；focusedMs 仍按 phaseTotalMs 结算，pause 不吞专注时长。
 */
export function resumeFocusSession(
  session: FocusSession,
  now: number,
): FocusSession {
  if (session.fsm !== 'paused' || !validNow(now)) {
    return session
  }
  const remaining = focusRemainingMs(session, now)
  const elapsed = Math.max(0, session.phaseTotalMs - remaining)
  const phaseStartedAt = now - elapsed
  const next = refreshFocusConfidence(
    {
      ...session,
      fsm: 'focusing',
      phaseStartedAt,
      phaseEndsAt: phaseStartedAt + session.phaseTotalMs,
      remainingMs: 0,
      updatedAt: now,
    },
    now,
  )
  return next
}

/** Glitch：只记破功，不暂停计时、不切换持久化 fsm */
export function markFocusBreach(
  session: FocusSession,
  now: number,
): FocusSession {
  if (session.fsm !== 'focusing') {
    return session
  }
  return {
    ...session,
    breaches: nonNegativeInt(session.breaches) + 1,
    updatedAt: validNow(now) ? now : session.updatedAt,
  }
}

/** 可见期间 60s 心跳：写入 lastHeartbeatAt 并恢复 high */
export function markFocusHeartbeat(
  session: FocusSession,
  now: number,
): FocusSession {
  if (!validNow(now)) {
    return session
  }
  return {
    ...session,
    lastHeartbeatAt: now,
    confidence: 'high',
    updatedAt: now,
  }
}

export type FocusBreakKind = 'short' | 'long' | 'overheat'

export interface FocusCompletion {
  session: FocusSession
  kind: FocusBreakKind
  record: {
    startedAt: number
    endedAt: number
    focusedMs: number
    breaches: number
    tag: string
    confidence: FocusConfidence
  }
}

/**
 * 完成一轮专注：
 * completedFocus +1；continuousFocusMs += focusedMs；
 * Overheat 优先于长休；completedFocus % 4 === 0 → 长休。
 */
export function completeFocusSession(
  session: FocusSession,
  now: number,
): FocusCompletion | null {
  if (session.fsm !== 'focusing' || !validNow(now)) {
    return null
  }
  const refreshed = refreshFocusConfidence(session, now)
  const focusedMs = session.phaseTotalMs
  const nextCompleted = nonNegativeInt(session.completedFocus) + 1
  const nextContinuous =
    nonNegativeInt(session.continuousFocusMs) + focusedMs

  let kind: FocusBreakKind
  let phaseTotalMs: number
  let lockUntil: number | undefined
  if (nextContinuous >= OVERHEAT_THRESHOLD_MS) {
    kind = 'overheat'
    phaseTotalMs = OVERHEAT_LOCK_MS
    lockUntil = now + OVERHEAT_LOCK_MS
  } else if (nextCompleted % 4 === 0) {
    kind = 'long'
    phaseTotalMs = LONG_BREAK_MS
    lockUntil = undefined
  } else {
    kind = 'short'
    phaseTotalMs = SHORT_BREAK_MS
    lockUntil = undefined
  }

  const fsm = kind === 'overheat' ? 'overheat' : 'breaking'
  const next: FocusSession = {
    ...refreshed,
    fsm,
    phaseStartedAt: now,
    phaseEndsAt: now + phaseTotalMs,
    phaseTotalMs,
    remainingMs: 0,
    completedFocus: nextCompleted,
    continuousFocusMs: nextContinuous,
    updatedAt: now,
    lockUntil,
  }

  return {
    session: next,
    kind,
    record: {
      startedAt: session.startedAt,
      /* 结束时间取计划终点，不把“延迟发现完成”的墙钟时间写进战报 */
      endedAt: Math.max(session.startedAt, session.phaseEndsAt),
      focusedMs,
      breaches: nonNegativeInt(refreshed.breaches),
      tag: refreshed.tag,
      confidence: refreshed.confidence ?? 'high',
    },
  }
}

export interface BreakFinishResult {
  kind: 'short' | 'long'
  /** 长休结束 / 跳过 → 需要把 stats.continuousFocusMs 归零 */
  resetContinuous: boolean
}

/** 休息到期；force=true 表示用户确认跳过 */
export function finishBreakSession(
  session: FocusSession,
  now: number,
  force = false,
): BreakFinishResult | null {
  if (session.fsm !== 'breaking') {
    return null
  }
  if (!force && (!validNow(now) || now < session.phaseEndsAt)) {
    return null
  }
  const long = isLongBreakSession(session)
  return { kind: long ? 'long' : 'short', resetContinuous: long }
}

/** Overheat 解锁到期；force=true 表示强制返回 */
export function finishOverheatSession(
  session: FocusSession,
  now: number,
  force = false,
): { resetContinuous: boolean } | null {
  if (session.fsm !== 'overheat') {
    return null
  }
  const lockUntil = session.lockUntil ?? 0
  if (!force && (!validNow(now) || now < lockUntil)) {
    return null
  }
  return { resetContinuous: true }
}

export type FocusRestoreAction =
  | 'focusing'
  | 'paused'
  | 'breaking'
  | 'cooling'
  | 'complete'
  | 'idle'

export interface FocusRestoreResult {
  session: FocusSession | null
  action: FocusRestoreAction
  /** 非空表示刚完成一轮，页面需要生成 record 并结算 */
  completion: FocusCompletion | null
  /** 长休 / Overheat 结束需要同步 stats.continuousFocusMs = 0 */
  resetContinuous: boolean
}

/**
 * 冷启动 / onShow 恢复：
 * - focusing 到期 → 自动完成 → breaking / overheat，并返回 completion
 * - breaking / overheat 到期 → idle
 * - 6h 只由 storage 校验 phase 合法性，本函数不按会话年龄误杀
 */
export function restoreFocusSession(
  session: FocusSession,
  now: number,
): FocusRestoreResult {
  if (!validNow(now)) {
    return { session: null, action: 'idle', completion: null, resetContinuous: false }
  }

  if (session.fsm === 'focusing') {
    if (focusRemainingMs(session, now) > 0) {
      return {
        session: refreshFocusConfidence(session, now),
        action: 'focusing',
        completion: null,
        resetContinuous: false,
      }
    }
    const completion = completeFocusSession(session, now)
    if (completion) {
      return {
        session: completion.session,
        action: 'complete',
        completion,
        resetContinuous: false,
      }
    }
    return { session: null, action: 'idle', completion: null, resetContinuous: false }
  }

  if (session.fsm === 'paused') {
    return {
      session: refreshFocusConfidence(session, now),
      action: 'paused',
      completion: null,
      resetContinuous: false,
    }
  }

  if (session.fsm === 'breaking') {
    if (session.phaseEndsAt <= now) {
      return {
        session: null,
        action: 'idle',
        completion: null,
        resetContinuous: isLongBreakSession(session),
      }
    }
    return {
      session: refreshFocusConfidence(session, now),
      action: 'breaking',
      completion: null,
      resetContinuous: false,
    }
  }

  if (session.fsm === 'overheat') {
    if ((session.lockUntil ?? 0) <= now) {
      return {
        session: null,
        action: 'idle',
        completion: null,
        resetContinuous: true,
      }
    }
    return {
      session,
      action: 'cooling',
      completion: null,
      resetContinuous: false,
    }
  }

  return { session: null, action: 'idle', completion: null, resetContinuous: false }
}
