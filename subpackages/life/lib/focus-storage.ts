/* ==========================================================================
   focus-storage · 专注会话 / 偏好 / 存证 / 统计 / 亮度
   - 6 个 focus:* key 与《最终版方案》附录 B.4 一致
   - 读取全部 try-catch + 白名单字段复制；坏数据绝不抛到页面
   - 写入前统一重算 HMAC 签名；结算按 record.id 幂等
   ========================================================================== */
import { readStorage, writeStorage, removeStorage } from '../../../core/toolbox/storage'
import type {
  FocusAudioPrefs,
  FocusBrightness,
  FocusConfidence,
  FocusPrefs,
  FocusRecord,
  FocusRecordCheck,
  FocusRecordReason,
  FocusSession,
  FocusStats,
} from './focus-types'
import {
  isValidKeyHex,
  keyHexFromBytes,
  seedFromBytes,
  sha256Bytes,
  signRecord,
  signSession,
  signStats,
  utf8Bytes,
  verifyRecord,
  verifySessionSignature,
  verifyStatsSignature,
} from './focus-crypto'
import {
  applyFocusRecordToStats,
  createEmptyFocusStats as buildEmptyFocusStats,
  formatLocalDate,
} from './focus-level'
import { MAX_PHASE_MS } from './focus-fsm'

export const FOCUS_KEYS = {
  session: 'focus:session:v1',
  prefs: 'focus:prefs:v1',
  key: 'focus:key:v1',
  ledger: 'focus:ledger:v1',
  stats: 'focus:stats:v1',
  brightness: 'focus:brightness:v1',
} as const

export const FOCUS_LEDGER_MAX = 50
export const FOCUS_TAG_MAX = 40
export const FOCUS_ID_MAX = 96

const SESSION_ID_MAX = 80
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MAX_SEED = 0xffffffff

export function defaultFocusAudio(): FocusAudioPrefs {
  return {
    rain: true,
    fire: false,
    keyboard: false,
    volumes: {
      rain: 0.45,
      fire: 0.3,
      keyboard: 0.25,
    },
    masterVolume: 0.55,
    bgm: true,
  }
}

export function defaultFocusPrefs(): FocusPrefs {
  return {
    version: 1,
    ...defaultFocusAudio(),
    flipDetection: true,
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** 区分「键不存在」与「键存在但 JSON 损坏」；后者必须报 corrupt，不能静默当空 */
interface StoredEntry {
  present: boolean
  corrupt: boolean
  value: unknown
}

function readStoredEntry(key: string): StoredEntry {
  const raw = readStorage(key)
  if (raw === undefined || raw === null || raw === '') {
    return { present: false, corrupt: false, value: null }
  }
  if (typeof raw !== 'string') {
    return { present: true, corrupt: false, value: raw }
  }
  const text = raw.trim()
  if (!text) {
    return { present: false, corrupt: false, value: null }
  }
  try {
    return { present: true, corrupt: false, value: JSON.parse(text) as unknown }
  } catch {
    return { present: true, corrupt: true, value: null }
  }
}

function finitePositive(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null
  }
  return Math.floor(value)
}

function finiteNonNegative(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null
  }
  return Math.floor(value)
}

function finiteNonNegativeInt(value: unknown): number {
  return finiteNonNegative(value) ?? 0
}

function clamp01(value: unknown, fallback: number): number {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) {
    return fallback
  }
  return Math.min(1, Math.max(0, number))
}

function sanitizeFocusAudio(raw: unknown): FocusAudioPrefs {
  const source = isPlainObject(raw) ? raw : {}
  const volumes = isPlainObject(source.volumes) ? source.volumes : {}
  const defaults = defaultFocusAudio()
  return {
    rain: source.rain === false ? false : defaults.rain,
    fire: source.fire === true,
    keyboard: source.keyboard === true,
    volumes: {
      rain: clamp01(volumes.rain, defaults.volumes.rain),
      fire: clamp01(volumes.fire, defaults.volumes.fire),
      keyboard: clamp01(volumes.keyboard, defaults.volumes.keyboard),
    },
    masterVolume: clamp01(source.masterVolume, defaults.masterVolume),
    bgm: source.bgm === false ? false : defaults.bgm,
  }
}

function sanitizeFocusPrefs(raw: unknown): FocusPrefs {
  const source = isPlainObject(raw) ? raw : {}
  return {
    version: 1,
    ...sanitizeFocusAudio(source),
    flipDetection: source.flipDetection === false ? false : true,
  }
}

export function loadFocusPrefs(): FocusPrefs {
  const entry = readStoredEntry(FOCUS_KEYS.prefs)
  if (
    !entry.present ||
    entry.corrupt ||
    !isPlainObject(entry.value) ||
    entry.value.version !== 1
  ) {
    return defaultFocusPrefs()
  }
  return sanitizeFocusPrefs(entry.value)
}

export function saveFocusPrefs(prefs: FocusPrefs): boolean {
  if (!isPlainObject(prefs)) {
    return false
  }
  return writeStorage(FOCUS_KEYS.prefs, sanitizeFocusPrefs(prefs))
}

/* -------------------------------------------------------------------------- */
/* Key                                                                        */
/* -------------------------------------------------------------------------- */

function readRawKeyText(raw: unknown): string {
  if (typeof raw !== 'string') {
    return ''
  }
  let text = raw.trim()
  if (text.startsWith('"') && text.endsWith('"')) {
    try {
      const parsed = JSON.parse(text) as unknown
      text = typeof parsed === 'string' ? parsed.trim() : ''
    } catch {
      return ''
    }
  }
  return text.toLowerCase()
}

export function readFocusKey(): string {
  const value = readRawKeyText(readStorage(FOCUS_KEYS.key))
  return isValidKeyHex(value) ? value : ''
}

export function writeFocusKey(keyHex: string): boolean {
  const value = String(keyHex || '').trim().toLowerCase()
  if (!isValidKeyHex(value)) {
    return false
  }
  return writeStorage(FOCUS_KEYS.key, value)
}

/**
 * key 首次生成优先走 wx.getRandomValues；不可用时用 Math.random 兜底。
 * 注意：key 丢失后的验签绝不回退 Math.random（见 focus-crypto.verifyRecord）。
 */
function fallbackRandomBytes(): Uint8Array {
  const bytes = new Uint8Array(32)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256)
  }
  return bytes
}

export function ensureFocusKey(seedBytes?: Uint8Array): string {
  const existing = readFocusKey()
  if (existing) {
    return existing
  }
  const bytes =
    seedBytes && seedBytes.length === 32 ? seedBytes : fallbackRandomBytes()
  let key = ''
  try {
    key = keyHexFromBytes(bytes)
  } catch {
    key = keyHexFromBytes(fallbackRandomBytes())
  }
  return writeFocusKey(key) ? key : ''
}

interface RandomValuesResult {
  randomValues: ArrayBuffer | Uint8Array
}

type RandomValuesApi = (option: {
  length: number
  success?: (result: RandomValuesResult) => void
  fail?: () => void
  complete?: () => void
}) => void

function getRandomValuesApi(): RandomValuesApi | null {
  if (typeof wx === 'undefined') {
    return null
  }
  const api = (wx as unknown as { getRandomValues?: RandomValuesApi }).getRandomValues
  return typeof api === 'function' ? api : null
}

export function ensureFocusKeyAsync(): Promise<string> {
  const existing = readFocusKey()
  if (existing) {
    return Promise.resolve(existing)
  }
  const api = getRandomValuesApi()
  if (!api) {
    return Promise.resolve(ensureFocusKey())
  }
  return new Promise<string>((resolve) => {
    let settled = false
    let timer = 0
    const finish = (value: string): void => {
      if (settled) {
        return
      }
      settled = true
      if (timer) {
        clearTimeout(timer)
        timer = 0
      }
      resolve(value)
    }
    /* 极端情况下 success / fail 都不回调：2s 后用本地兜底，页面绝不卡在启动 */
    timer = setTimeout(() => finish(ensureFocusKey()), 2000) as unknown as number
    try {
      api({
        length: 32,
        success: (result) => {
          const values =
            result.randomValues instanceof Uint8Array
              ? result.randomValues
              : new Uint8Array(result.randomValues)
          finish(ensureFocusKey(values))
        },
        fail: () => finish(ensureFocusKey()),
        complete: () => {
          if (!settled) {
            finish(ensureFocusKey())
          }
        },
      })
    } catch {
      finish(ensureFocusKey())
    }
  })
}

/* -------------------------------------------------------------------------- */
/* Session                                                                    */
/* -------------------------------------------------------------------------- */

export type FocusSessionLoadReason =
  | 'ok'
  | 'none'
  | 'corrupt'
  | 'signature'
  | 'keyLost'

export interface FocusSessionLoadResult {
  session: FocusSession | null
  reason: FocusSessionLoadReason
}

function sanitizeOptionalTimestamp(value: unknown): number | undefined {
  const number = finitePositive(value)
  return number ?? undefined
}

export function sanitizeFocusSession(raw: unknown): FocusSession | null {
  if (!isPlainObject(raw) || raw.version !== 1) {
    return null
  }
  const fsm = raw.fsm
  if (
    fsm !== 'focusing' &&
    fsm !== 'paused' &&
    fsm !== 'breaking' &&
    fsm !== 'overheat'
  ) {
    return null
  }
  const id = typeof raw.id === 'string' ? raw.id.trim().slice(0, SESSION_ID_MAX) : ''
  if (!id) {
    return null
  }
  const tag = typeof raw.tag === 'string' ? raw.tag.trim().slice(0, FOCUS_TAG_MAX) : ''
  const startedAt = finitePositive(raw.startedAt)
  const phaseStartedAt = finitePositive(raw.phaseStartedAt)
  const phaseEndsAt = finitePositive(raw.phaseEndsAt)
  const phaseTotalMs = finitePositive(raw.phaseTotalMs)
  const remainingMs = finiteNonNegative(raw.remainingMs)
  const updatedAt = finitePositive(raw.updatedAt)
  if (
    startedAt === null ||
    phaseStartedAt === null ||
    phaseEndsAt === null ||
    phaseTotalMs === null ||
    remainingMs === null ||
    updatedAt === null
  ) {
    return null
  }
  if (phaseTotalMs > MAX_PHASE_MS) {
    return null
  }
  /* 时间戳一致性；6h 只校验 phase，不用 startedAt 会话年龄误杀长暂停 */
  if (Math.abs(phaseEndsAt - phaseStartedAt - phaseTotalMs) > 1000) {
    return null
  }
  if (remainingMs > phaseTotalMs) {
    return null
  }
  const cycle = finiteNonNegative(raw.cycle)
  if (cycle === null || cycle < 1 || cycle > 4) {
    return null
  }
  const completedFocus = finiteNonNegative(raw.completedFocus)
  const continuousFocusMs = finiteNonNegative(raw.continuousFocusMs)
  if (completedFocus === null || continuousFocusMs === null) {
    return null
  }
  const breaches = finiteNonNegative(raw.breaches)
  if (breaches === null) {
    return null
  }
  const lockUntil = sanitizeOptionalTimestamp(raw.lockUntil)
  if (fsm === 'overheat' && !lockUntil) {
    return null
  }
  const lastHeartbeatAt = sanitizeOptionalTimestamp(raw.lastHeartbeatAt)
  const confidence: FocusConfidence = raw.confidence === 'low' ? 'low' : 'high'
  const signature = typeof raw.signature === 'string' ? raw.signature : ''

  return {
    version: 1,
    id,
    fsm,
    tag,
    startedAt,
    phaseStartedAt,
    phaseEndsAt,
    phaseTotalMs,
    remainingMs,
    cycle,
    completedFocus,
    continuousFocusMs,
    breaches,
    audio: sanitizeFocusAudio(raw.audio),
    updatedAt,
    lockUntil,
    lastHeartbeatAt,
    confidence,
    signature,
  }
}

export function loadFocusSession(keyHex: string): FocusSessionLoadResult {
  const entry = readStoredEntry(FOCUS_KEYS.session)
  if (!entry.present) {
    return { session: null, reason: 'none' }
  }
  if (entry.corrupt) {
    return { session: null, reason: 'corrupt' }
  }
  const session = sanitizeFocusSession(entry.value)
  if (!session) {
    return { session: null, reason: 'corrupt' }
  }
  if (!isValidKeyHex(keyHex)) {
    return { session: null, reason: 'keyLost' }
  }
  if (!verifySessionSignature(session, keyHex)) {
    return { session: null, reason: 'signature' }
  }
  return { session, reason: 'ok' }
}

export function saveFocusSession(session: FocusSession, keyHex: string): boolean {
  if (!isValidKeyHex(keyHex)) {
    return false
  }
  const clean = sanitizeFocusSession(session)
  if (!clean) {
    return false
  }
  const signed: FocusSession = {
    ...clean,
    signature: signSession(clean, keyHex),
  }
  return writeStorage(FOCUS_KEYS.session, signed)
}

/** 进入 idle：只删当前会话，保留 stats / ledger */
export function clearFocusSession(): boolean {
  return removeStorage(FOCUS_KEYS.session)
}

/* -------------------------------------------------------------------------- */
/* Brightness                                                                 */
/* -------------------------------------------------------------------------- */

export function loadFocusBrightness(): FocusBrightness | null {
  const entry = readStoredEntry(FOCUS_KEYS.brightness)
  if (!entry.present || entry.corrupt || !isPlainObject(entry.value)) {
    return null
  }
  const raw = entry.value
  if (raw.version !== 1) {
    return null
  }
  const original = raw.original
  if (
    typeof original !== 'number' ||
    !Number.isFinite(original) ||
    original < 0 ||
    original > 1
  ) {
    return null
  }
  return { version: 1, original, owned: raw.owned === true }
}

export function saveFocusBrightness(original: number): boolean {
  if (
    typeof original !== 'number' ||
    !Number.isFinite(original) ||
    original < 0 ||
    original > 1
  ) {
    return false
  }
  return writeStorage(FOCUS_KEYS.brightness, {
    version: 1,
    original,
    owned: true,
  } satisfies FocusBrightness)
}

export function clearFocusBrightness(): boolean {
  return removeStorage(FOCUS_KEYS.brightness)
}

/* -------------------------------------------------------------------------- */
/* Ledger                                                                     */
/* -------------------------------------------------------------------------- */

export function sanitizeFocusRecord(raw: unknown): FocusRecord | null {
  if (!isPlainObject(raw) || raw.version !== 1) {
    return null
  }
  const id = typeof raw.id === 'string' ? raw.id.trim().slice(0, FOCUS_ID_MAX) : ''
  if (!id) {
    return null
  }
  const tag = typeof raw.tag === 'string' ? raw.tag.trim().slice(0, FOCUS_TAG_MAX) : ''
  const startedAt = finitePositive(raw.startedAt)
  const endedAt = finitePositive(raw.endedAt)
  const focusedMs = finiteNonNegative(raw.focusedMs)
  const breaches = finiteNonNegative(raw.breaches)
  const seed = finiteNonNegative(raw.seed)
  const level = finiteNonNegative(raw.level)
  if (
    startedAt === null ||
    endedAt === null ||
    focusedMs === null ||
    breaches === null ||
    seed === null ||
    level === null
  ) {
    return null
  }
  if (endedAt < startedAt) {
    return null
  }
  if (focusedMs > MAX_PHASE_MS) {
    return null
  }
  if (focusedMs > endedAt - startedAt + 1000) {
    return null
  }
  if (seed > MAX_SEED || level < 1 || level > 6) {
    return null
  }
  const confidence: FocusConfidence = raw.confidence === 'low' ? 'low' : 'high'
  const signature = typeof raw.signature === 'string' ? raw.signature : ''

  return {
    version: 1,
    id,
    tag,
    startedAt,
    endedAt,
    focusedMs,
    breaches,
    seed,
    level,
    confidence,
    signature,
  }
}

interface LedgerParseResult {
  records: FocusRecord[]
  corrupt: number
}

function readLedgerRecords(): LedgerParseResult {
  const entry = readStoredEntry(FOCUS_KEYS.ledger)
  if (!entry.present) {
    return { records: [], corrupt: 0 }
  }
  if (entry.corrupt) {
    return { records: [], corrupt: 1 }
  }
  const raw = entry.value
  const list = isPlainObject(raw) && Array.isArray(raw.records) ? raw.records : raw
  if (!Array.isArray(list)) {
    return { records: [], corrupt: 1 }
  }

  const records: FocusRecord[] = []
  const seen = new Set<string>()
  let corrupt = 0
  for (const item of list) {
    const record = sanitizeFocusRecord(item)
    if (!record || seen.has(record.id)) {
      corrupt += 1
      continue
    }
    seen.add(record.id)
    records.push(record)
    if (records.length >= FOCUS_LEDGER_MAX) {
      break
    }
  }
  records.sort((left, right) => right.endedAt - left.endedAt)
  return { records, corrupt }
}

export interface FocusLedgerLoadResult {
  entries: FocusRecordCheck[]
  keyLost: boolean
  corruptCount: number
}

export function loadFocusLedger(keyHex: string): FocusLedgerLoadResult {
  const parsed = readLedgerRecords()
  const keyLost = !isValidKeyHex(keyHex)
  return {
    entries: parsed.records.map((record) => verifyRecord(record, keyHex)),
    keyLost,
    corruptCount: parsed.corrupt,
  }
}

export interface AppendFocusRecordResult {
  ok: boolean
  duplicate: boolean
  records: FocusRecord[]
  corruptCount: number
}

/** 按 record.id 幂等追加；最多 50 条，最新在前 */
export function appendFocusRecord(record: FocusRecord): AppendFocusRecordResult {
  const parsed = readLedgerRecords()
  const clean = sanitizeFocusRecord(record)
  if (!clean) {
    return {
      ok: false,
      duplicate: false,
      records: parsed.records,
      corruptCount: parsed.corrupt + 1,
    }
  }
  if (parsed.records.some((item) => item.id === clean.id)) {
    return {
      ok: true,
      duplicate: true,
      records: parsed.records,
      corruptCount: parsed.corrupt,
    }
  }
  const next = [clean, ...parsed.records]
    .sort((left, right) => right.endedAt - left.endedAt)
    .slice(0, FOCUS_LEDGER_MAX)
  const ok = writeStorage(FOCUS_KEYS.ledger, next)
  return {
    ok,
    duplicate: false,
    records: ok ? next : parsed.records,
    corruptCount: parsed.corrupt,
  }
}

export interface FocusRecordInput {
  sessionId: string
  tag: string
  startedAt: number
  endedAt: number
  focusedMs: number
  breaches: number
  level: number
  confidence: FocusConfidence
  seed?: number
}

/** 生成 record：id = rec-session.id；seed 可由调用方指定，否则确定性派生 */
export function buildFocusRecord(
  input: FocusRecordInput,
  keyHex: string,
): FocusRecord | null {
  const sessionId = String(input.sessionId || '').trim().slice(0, SESSION_ID_MAX)
  if (!sessionId) {
    return null
  }
  const startedAt = finitePositive(input.startedAt)
  const endedAt = finitePositive(input.endedAt)
  const focusedMs = finiteNonNegative(input.focusedMs)
  const breaches = finiteNonNegative(input.breaches)
  if (
    startedAt === null ||
    endedAt === null ||
    focusedMs === null ||
    breaches === null ||
    endedAt < startedAt ||
    focusedMs > MAX_PHASE_MS ||
    focusedMs > endedAt - startedAt + 1000
  ) {
    return null
  }

  const id = `rec-${sessionId}`.slice(0, FOCUS_ID_MAX)
  const tag = String(input.tag || '').trim().slice(0, FOCUS_TAG_MAX)
  let seed =
    typeof input.seed === 'number' && Number.isInteger(input.seed) && input.seed >= 0 && input.seed <= MAX_SEED
      ? input.seed
      : -1
  if (seed < 0) {
    const digest = sha256Bytes(utf8Bytes(`${id}|${endedAt}|${tag}`))
    seed = seedFromBytes(digest.subarray(0, 4))
  }
  const level = Math.min(6, Math.max(1, Math.round(finiteNonNegativeInt(input.level) || 1)))
  const confidence: FocusConfidence = input.confidence === 'low' ? 'low' : 'high'

  const record: FocusRecord = {
    version: 1,
    id,
    tag,
    startedAt,
    endedAt,
    focusedMs,
    breaches,
    seed,
    level,
    confidence,
    signature: '',
  }
  if (isValidKeyHex(keyHex)) {
    record.signature = signRecord(record, keyHex)
  }
  return record
}

/* -------------------------------------------------------------------------- */
/* Stats                                                                      */
/* -------------------------------------------------------------------------- */

export type FocusStatsLoadReason = 'ok' | 'none' | 'corrupt' | 'signature' | 'keyLost'

export interface FocusStatsLoadResult {
  stats: FocusStats | null
  reason: FocusStatsLoadReason
  tainted: boolean
}

export function sanitizeFocusStats(raw: unknown): FocusStats | null {
  if (!isPlainObject(raw) || raw.version !== 1) {
    return null
  }
  const totalFocusMs = finiteNonNegative(raw.totalFocusMs)
  const completedCount = finiteNonNegative(raw.completedCount)
  const level = finiteNonNegative(raw.level)
  const streakDays = finiteNonNegative(raw.streakDays)
  const todayFocusMs = finiteNonNegative(raw.todayFocusMs)
  const continuousFocusMs = finiteNonNegative(raw.continuousFocusMs)
  const updatedAt = finitePositive(raw.updatedAt)
  if (
    totalFocusMs === null ||
    completedCount === null ||
    level === null ||
    streakDays === null ||
    todayFocusMs === null ||
    continuousFocusMs === null ||
    updatedAt === null ||
    level < 1 ||
    level > 6
  ) {
    return null
  }
  const lastCompletedDate =
    typeof raw.lastCompletedDate === 'string' ? raw.lastCompletedDate : ''
  const todayDate = typeof raw.todayDate === 'string' ? raw.todayDate : ''
  if (
    (lastCompletedDate && !DATE_KEY_PATTERN.test(lastCompletedDate)) ||
    (todayDate && !DATE_KEY_PATTERN.test(todayDate))
  ) {
    return null
  }
  const lastAppliedRecordId =
    typeof raw.lastAppliedRecordId === 'string'
      ? raw.lastAppliedRecordId.slice(0, FOCUS_ID_MAX)
      : ''
  const signature = typeof raw.signature === 'string' ? raw.signature : ''

  return {
    version: 1,
    totalFocusMs,
    completedCount,
    level,
    streakDays,
    lastCompletedDate,
    todayDate,
    todayFocusMs,
    continuousFocusMs,
    lastAppliedRecordId,
    updatedAt,
    signature,
  }
}

export function loadFocusStats(keyHex: string): FocusStatsLoadResult {
  const entry = readStoredEntry(FOCUS_KEYS.stats)
  if (!entry.present) {
    return { stats: null, reason: 'none', tainted: false }
  }
  if (entry.corrupt) {
    return { stats: null, reason: 'corrupt', tainted: false }
  }
  const stats = sanitizeFocusStats(entry.value)
  if (!stats) {
    return { stats: null, reason: 'corrupt', tainted: false }
  }
  if (!isValidKeyHex(keyHex)) {
    return { stats, reason: 'keyLost', tainted: false }
  }
  if (!verifyStatsSignature(stats, keyHex)) {
    return { stats, reason: 'signature', tainted: true }
  }
  return { stats, reason: 'ok', tainted: false }
}

export function saveFocusStats(stats: FocusStats, keyHex: string): boolean {
  if (!isValidKeyHex(keyHex)) {
    return false
  }
  const clean = sanitizeFocusStats(stats)
  if (!clean) {
    return false
  }
  const signed: FocusStats = {
    ...clean,
    signature: signStats(clean, keyHex),
  }
  return writeStorage(FOCUS_KEYS.stats, signed)
}

export function createEmptyFocusStats(now: number, keyHex: string): FocusStats | null {
  if (!isValidKeyHex(keyHex) || !formatLocalDate(now)) {
    return null
  }
  return buildEmptyFocusStats(now, keyHex)
}

export interface SettleFocusRecordOptions {
  keyHex: string
  stats: FocusStats
  continuousFocusMs: number
  now: number
}

export interface SettleFocusRecordResult {
  ok: boolean
  applied: boolean
  stats: FocusStats
  check: FocusRecordCheck
  records: FocusRecord[]
  entries: FocusRecordCheck[]
  reason: FocusRecordReason
}

/**
 * 结算顺序：验签 → 写 ledger（按 id 幂等）→ 更新 stats（lastAppliedRecordId 去重）。
 * 写失败返回 ok=false，调用方保留 session，下一次 onShow 用同一 record.id 重试。
 */
export function settleFocusRecord(
  record: FocusRecord,
  options: SettleFocusRecordOptions,
): SettleFocusRecordResult {
  const clean = sanitizeFocusRecord(record)
  if (!clean) {
    const parsed = readLedgerRecords()
    const corruptCheck: FocusRecordCheck = {
      record,
      verified: false,
      tainted: true,
      reason: 'corrupt',
    }
    return {
      ok: false,
      applied: false,
      stats: options.stats,
      check: corruptCheck,
      records: parsed.records,
      entries: parsed.records.map((item) => verifyRecord(item, options.keyHex)),
      reason: 'corrupt',
    }
  }

  const check = verifyRecord(clean, options.keyHex)
  const appended = appendFocusRecord(clean)
  const entries = appended.records.map((item) =>
    verifyRecord(item, options.keyHex),
  )

  if (!appended.ok) {
    return {
      ok: false,
      applied: false,
      stats: options.stats,
      check,
      records: appended.records,
      entries,
      reason: check.reason,
    }
  }
  if (!check.verified) {
    /* tainted / keyLost 可写入 ledger 供展示，但绝不增加等级 / 连续天数 / 今日专注 */
    return {
      ok: false,
      applied: false,
      stats: options.stats,
      check,
      records: appended.records,
      entries,
      reason: check.reason,
    }
  }

  const applied = applyFocusRecordToStats(options.stats, check, {
    now: options.now,
    keyHex: options.keyHex,
    continuousFocusMs: options.continuousFocusMs,
  })
  if (applied.applied) {
    const saved = saveFocusStats(applied.stats, options.keyHex)
    if (!saved) {
      return {
        ok: false,
        applied: false,
        stats: options.stats,
        check,
        records: appended.records,
        entries,
        reason: 'ok',
      }
    }
  }

  return {
    ok: applied.applied || applied.reason === 'ok',
    applied: applied.applied,
    stats: applied.applied ? applied.stats : options.stats,
    check,
    records: appended.records,
    entries,
    reason: applied.reason,
  }
}

/* -------------------------------------------------------------------------- */
/* Clear                                                                      */
/* -------------------------------------------------------------------------- */

/** 清空全部 6 个 focus key；等级归零、账本重置、亮度 stale flag 一并清除 */
export function clearFocusData(): number {
  let removed = 0
  for (const key of Object.values(FOCUS_KEYS)) {
    if (removeStorage(key)) {
      removed += 1
    }
  }
  return removed
}
