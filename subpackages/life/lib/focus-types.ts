/* ==========================================================================
   focus-types · 全息专注引擎 P0 数据契约
   - 与《全息专注引擎-最终版方案》附录 B.1 / B.2 同步
   - 纯类型文件：不依赖 wx / DOM / 任何运行时库
   ========================================================================== */

export type FocusFsm = 'focusing' | 'paused' | 'breaking' | 'overheat'
export type FocusTrack = 'rain' | 'fire' | 'keyboard'
export type FocusConfidence = 'high' | 'low'

export interface FocusAudioPrefs {
  rain: boolean
  fire: boolean
  keyboard: boolean
  /** 0..1，每轨独立 */
  volumes: Record<FocusTrack, number>
  /** 0..1，主增益 */
  masterVolume: number
  bgm: boolean
}

export interface FocusPrefs extends FocusAudioPrefs {
  version: 1
  flipDetection: boolean
}

export interface FocusBrightness {
  version: 1
  original: number
  owned: boolean
}

export interface FocusSession {
  version: 1
  id: string
  fsm: FocusFsm
  tag: string
  startedAt: number
  phaseStartedAt: number
  phaseEndsAt: number
  phaseTotalMs: number
  /** 仅 paused 使用；overheat 用 lockUntil */
  remainingMs: number
  /** 当前第几轮，1..4 */
  cycle: number
  /** 累计完成专注数（从 stats.completedCount 初始化） */
  completedFocus: number
  /** 连续专注累计（从 stats.continuousFocusMs 初始化） */
  continuousFocusMs: number
  breaches: number
  audio: FocusAudioPrefs
  updatedAt: number
  /** overheat 锁定到期时间 */
  lockUntil?: number
  /** 最后一次 60s 心跳 */
  lastHeartbeatAt?: number
  confidence?: FocusConfidence
  signature: string
}

export interface FocusRecord {
  version: 1
  /** 'rec-' + session.id，保证结算重试幂等 */
  id: string
  tag: string
  startedAt: number
  endedAt: number
  focusedMs: number
  breaches: number
  /** 32-bit 无符号；星云 PRNG 种子 */
  seed: number
  level: number
  confidence: FocusConfidence
  signature: string
}

export type FocusRecordReason =
  | 'ok'
  | 'signature'
  | 'clock'
  | 'keyLost'
  | 'corrupt'

export interface FocusRecordCheck {
  record: FocusRecord
  verified: boolean
  tainted: boolean
  reason: FocusRecordReason
}

export interface FocusStats {
  version: 1
  totalFocusMs: number
  completedCount: number
  level: number
  streakDays: number
  /** YYYY-MM-DD，本地时区 */
  lastCompletedDate: string
  /** YYYY-MM-DD，本地时区 */
  todayDate: string
  todayFocusMs: number
  continuousFocusMs: number
  /** 最近一次已计入 stats 的 record.id，防重复结算 */
  lastAppliedRecordId: string
  updatedAt: number
  signature: string
}
