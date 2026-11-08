/* ==========================================================================
   focus-audio · 环境音引擎 + 后台保活
   - 3 轨白噪（雨 / 篝火 / 键盘），BufferSource + Gain，主 Gain 汇总
   - 轨道切换 300ms 淡入淡出；暂停 / 休息淡出，focusing 淡入
   - WebAudio 不可用 → audioDisabled，不再重试
   - BGM：运行时生成 1s 低振幅 WAV 到 USER_DATA_PATH，后台循环保活
   - 依赖可注入：单测不触碰真实 wx / WebAudio
   ========================================================================== */
import type { FocusTrack } from './focus-types'

/** 单轨噪声 1s / 16kHz / mono，约 64KB Float32 */
export const AUDIO_SAMPLE_RATE = 16000
export const AUDIO_TRACK_SECONDS = 1
export const AUDIO_FADE_MS = 300
export const TRACK_LIMIT = 3

export const TRACK_ORDER: FocusTrack[] = ['rain', 'fire', 'keyboard']

export interface FocusAudioParamLike {
  value: number
  linearRampToValueAtTime?(value: number, endTime: number): unknown
  setTargetAtTime?(target: number, startTime: number, timeConstant: number): unknown
}

export interface FocusGainNodeLike {
  gain: FocusAudioParamLike
  connect(node: unknown): unknown
  disconnect?(): void
}

export interface FocusAudioBufferLike {
  getChannelData(channel: number): Float32Array
}

export interface FocusBufferSourceLike {
  buffer: unknown
  loop: boolean
  connect(node: unknown): unknown
  start(when?: number): void
  stop(when?: number): void
  disconnect?(): void
}

export interface FocusAudioContextLike {
  destination: unknown
  currentTime: number
  state?: string
  createBuffer(channels: number, length: number, sampleRate: number): FocusAudioBufferLike
  createBufferSource(): FocusBufferSourceLike
  createGain(): FocusGainNodeLike
  suspend?(): unknown
  resume?(): unknown
  close?(): unknown
}

export interface FocusAudioDeps {
  createContext?: () => FocusAudioContextLike | null
  fadeMs?: number
  random?: () => number
  schedule?: (handler: () => void, delayMs: number) => number
  cancel?: (timer: number) => void
}

interface ActiveTrack {
  source: FocusBufferSourceLike
  gain: FocusGainNodeLike
  timer: number
}

function clamp01(value: number, fallback = 0): number {
  if (!Number.isFinite(value)) {
    return fallback
  }
  return Math.min(1, Math.max(0, value))
}

/** 固定种子 PRNG：同一轨每次生成的噪声一致，避免每次启动音色漂移 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function trackSeed(track: FocusTrack): number {
  if (track === 'rain') {
    return 0x51ed270b
  }
  if (track === 'fire') {
    return 0x9e3779b9
  }
  return 0x85ebca6b
}

/**
 * 生成 1s mono PCM 浮点噪声。
 * 雨 = 高频白噪；火 = 棕色噪声 + 稀疏爆裂；键盘 = 稀疏瞬态点击。
 */
export function createNoiseSamples(
  track: FocusTrack,
  sampleRate = AUDIO_SAMPLE_RATE,
  seconds = AUDIO_TRACK_SECONDS,
): Float32Array {
  const length = Math.max(1, Math.floor(sampleRate * seconds))
  const samples = new Float32Array(length)
  const random = mulberry32(trackSeed(track))

  if (track === 'rain') {
    for (let index = 0; index < length; index += 1) {
      samples[index] = (random() * 2 - 1) * 0.55
    }
    return samples
  }

  if (track === 'fire') {
    let brown = 0
    for (let index = 0; index < length; index += 1) {
      brown = (brown + (random() * 2 - 1) * 0.02) / 1.02
      let value = brown * 0.9
      /* 爆裂：低频概率 + 快速指数衰减 */
      if (random() < 0.0007) {
        value += (random() * 2 - 1) * 0.55
      }
      samples[index] = Math.min(1, Math.max(-1, value))
    }
    return samples
  }

  /* keyboard：稀疏点击，每 8–30ms 一个衰减包络 */
  let envelope = 0
  let nextClick = Math.floor(random() * sampleRate * 0.03)
  for (let index = 0; index < length; index += 1) {
    if (index >= nextClick) {
      envelope = 0.65
      nextClick = index + Math.floor(sampleRate * (0.008 + random() * 0.022))
    }
    samples[index] = (random() * 2 - 1) * envelope
    envelope *= 0.985
  }
  return samples
}

function defaultCreateContext(): FocusAudioContextLike | null {
  if (typeof wx === 'undefined') {
    return null
  }
  const api = (wx as unknown as { createWebAudioContext?: () => unknown })
    .createWebAudioContext
  if (typeof api !== 'function') {
    return null
  }
  return api() as FocusAudioContextLike | null
}

export interface FocusAudioSetTracksOptions {
  volumes?: Record<FocusTrack, number>
  masterVolume?: number
}

/**
 * 环境音单例（每个页面实例持有一个）。
 * 所有失败都收敛为 disabled=true；页面据此隐藏环境音，不重试。
 */
export class FocusAudioEngine {
  private readonly createContext: () => FocusAudioContextLike | null
  private readonly fadeMs: number
  private readonly schedule: (handler: () => void, delayMs: number) => number
  private readonly cancel: (timer: number) => void

  private context: FocusAudioContextLike | null = null
  private master: FocusGainNodeLike | null = null
  private active = new Map<FocusTrack, ActiveTrack>()
  private desired: FocusTrack[] = []
  private volumes: Record<FocusTrack, number> = {
    rain: 0.45,
    fire: 0.3,
    keyboard: 0.25,
  }
  private masterVolume = 0.55
  private disabledFlag = false
  private disposed = false
  private suspended = false

  constructor(deps: FocusAudioDeps = {}) {
    this.createContext = deps.createContext ?? defaultCreateContext
    this.fadeMs =
      typeof deps.fadeMs === 'number' && deps.fadeMs >= 0
        ? deps.fadeMs
        : AUDIO_FADE_MS
    this.schedule =
      deps.schedule ??
      ((handler, delayMs) =>
        setTimeout(handler, delayMs) as unknown as number)
    this.cancel =
      deps.cancel ??
      ((timer) => clearTimeout(timer as unknown as ReturnType<typeof setTimeout>))
  }

  get disabled(): boolean {
    return this.disabledFlag || this.disposed
  }

  get isSuspended(): boolean {
    return this.suspended
  }

  get activeTracks(): FocusTrack[] {
    return TRACK_ORDER.filter((track) => this.active.has(track))
  }

  get currentMasterVolume(): number {
    return this.masterVolume
  }

  /** 仅在真正需要发声时创建上下文；失败后永久降级 */
  ensureContext(): boolean {
    if (this.disabled) {
      return false
    }
    if (this.context) {
      return true
    }
    try {
      const context = this.createContext()
      if (!context) {
        this.disabledFlag = true
        return false
      }
      const master = context.createGain()
      master.gain.value = this.masterVolume
      master.connect(context.destination)
      this.context = context
      this.master = master
      return true
    } catch {
      this.disabledFlag = true
      this.context = null
      this.master = null
      return false
    }
  }

  /**
   * 设置目标轨道 / 每轨音量 / 主音量。
   * 轨道去重并按 rain → fire → keyboard 排序，最多 3 轨。
   */
  setTracks(
    tracks: FocusTrack[],
    options: FocusAudioSetTracksOptions = {},
  ): void {
    if (this.disposed) {
      return
    }
    const unique = new Set<FocusTrack>()
    for (const track of tracks) {
      if (TRACK_ORDER.includes(track)) {
        unique.add(track)
      }
      if (unique.size >= TRACK_LIMIT) {
        break
      }
    }
    this.desired = TRACK_ORDER.filter((track) => unique.has(track))

    if (options.volumes) {
      this.volumes = {
        rain: clamp01(options.volumes.rain, this.volumes.rain),
        fire: clamp01(options.volumes.fire, this.volumes.fire),
        keyboard: clamp01(options.volumes.keyboard, this.volumes.keyboard),
      }
    }
    if (typeof options.masterVolume === 'number') {
      this.masterVolume = clamp01(options.masterVolume, this.masterVolume)
    }
    this.applyMasterVolume()

    if (this.desired.length === 0) {
      for (const track of this.activeTracks) {
        this.stopTrack(track)
      }
      return
    }
    if (!this.ensureContext()) {
      return
    }
    for (const track of TRACK_ORDER) {
      const wanted = this.desired.includes(track)
      if (wanted && !this.active.has(track)) {
        this.startTrack(track)
      } else if (!wanted && this.active.has(track)) {
        this.stopTrack(track)
      }
    }
  }

  setMasterVolume(value: number): void {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return
    }
    this.masterVolume = clamp01(value, this.masterVolume)
    this.applyMasterVolume()
  }

  suspend(): void {
    if (this.disposed || this.suspended) {
      return
    }
    this.suspended = true
    try {
      this.context?.suspend?.()
    } catch {
      /* 页面隐藏时 suspend 失败不影响时间戳计时 */
    }
  }

  resume(): void {
    if (this.disposed) {
      return
    }
    this.suspended = false
    try {
      this.context?.resume?.()
    } catch {
      /* 恢复失败保留 disabled=false，下一次 setTracks 可重建 */
    }
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    for (const track of this.activeTracks) {
      this.stopTrack(track, true)
    }
    this.active.clear()
    if (this.master?.disconnect) {
      try {
        this.master.disconnect()
      } catch {
        /* 已断开 */
      }
    }
    this.master = null
    try {
      this.context?.close?.()
    } catch {
      /* 已关闭 */
    }
    this.context = null
    this.desired = []
    this.disposed = true
  }

  private applyMasterVolume(): void {
    if (!this.master) {
      return
    }
    const gain = this.master.gain
    const target = this.masterVolume
    if (gain.linearRampToValueAtTime && this.context) {
      try {
        gain.linearRampToValueAtTime(
          target,
          this.context.currentTime + Math.max(0.05, this.fadeMs / 1000),
        )
        return
      } catch {
        /* 回退直接赋值 */
      }
    }
    gain.value = target
  }

  private startTrack(track: FocusTrack): void {
    const context = this.context
    const master = this.master
    if (!context || !master) {
      return
    }
    let source: FocusBufferSourceLike | null = null
    let gain: FocusGainNodeLike | null = null
    try {
      const buffer = context.createBuffer(
        1,
        AUDIO_SAMPLE_RATE * AUDIO_TRACK_SECONDS,
        AUDIO_SAMPLE_RATE,
      )
      buffer.getChannelData(0).set(createNoiseSamples(track))
      source = context.createBufferSource()
      gain = context.createGain()
      source.buffer = buffer
      source.loop = true
      gain.gain.value = 0
      source.connect(gain)
      gain.connect(master)
      source.start()
      this.active.set(track, { source, gain, timer: 0 })
      this.fadeGain(gain, this.volumes[track])
    } catch {
      /* 单轨失败不影响其它轨；确保已创建的节点被停止 */
      try {
        source?.stop()
      } catch {
        /* 未启动 */
      }
      if (gain?.disconnect) {
        try {
          gain.disconnect()
        } catch {
          /* 未连接 */
        }
      }
      this.active.delete(track)
      this.disabledFlag = this.active.size === 0
    }
  }

  private fadeGain(gain: FocusGainNodeLike, target: number): void {
    const value = clamp01(target, 0)
    if (this.fadeMs <= 0 || !gain.gain.linearRampToValueAtTime || !this.context) {
      gain.gain.value = value
      return
    }
    try {
      gain.gain.linearRampToValueAtTime(
        value,
        this.context.currentTime + this.fadeMs / 1000,
      )
    } catch {
      gain.gain.value = value
    }
  }

  private stopTrack(track: FocusTrack, immediate = false): void {
    const node = this.active.get(track)
    if (!node) {
      return
    }
    this.active.delete(track)
    if (node.timer) {
      this.cancel(node.timer)
      node.timer = 0
    }
    if (immediate || this.fadeMs <= 0) {
      this.stopSource(node)
      return
    }
    this.fadeGain(node.gain, 0)
    node.timer = this.schedule(() => {
      node.timer = 0
      this.stopSource(node)
    }, this.fadeMs + 20)
  }

  private stopSource(node: ActiveTrack): void {
    try {
      node.source.stop()
    } catch {
      /* 已停止 */
    }
    try {
      node.source.disconnect?.()
    } catch {
      /* 已断开 */
    }
    try {
      node.gain.disconnect?.()
    } catch {
      /* 已断开 */
    }
  }
}

/* -------------------------------------------------------------------------- */
/* BGM 后台保活                                                                */
/* -------------------------------------------------------------------------- */

export const BGM_TITLE = '超欢 · 心流白噪音'
export const BGM_FILE_NAME = 'focus-bgm-v1.wav'
export const BGM_SAMPLE_RATE = 8000
export const BGM_DURATION_MS = 1000

function writeAscii(bytes: Uint8Array, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    bytes[offset + index] = text.charCodeAt(index)
  }
}

function writeUint32LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >>> 8) & 0xff
  bytes[offset + 2] = (value >>> 16) & 0xff
  bytes[offset + 3] = (value >>> 24) & 0xff
}

function writeUint16LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >>> 8) & 0xff
}

/**
 * 生成 1s 16-bit mono WAV：220Hz 低振幅，首尾 50ms 淡入淡出防爆音。
 * 只用于后台音频保活，不作为用户可听内容。
 */
export function buildBgmWav(
  sampleRate = BGM_SAMPLE_RATE,
  durationMs = BGM_DURATION_MS,
  amplitude = 0.035,
): Uint8Array {
  const frames = Math.max(1, Math.floor((sampleRate * durationMs) / 1000))
  const dataSize = frames * 2
  const bytes = new Uint8Array(44 + dataSize)
  writeAscii(bytes, 0, 'RIFF')
  writeUint32LE(bytes, 4, 36 + dataSize)
  writeAscii(bytes, 8, 'WAVE')
  writeAscii(bytes, 12, 'fmt ')
  writeUint32LE(bytes, 16, 16)
  writeUint16LE(bytes, 20, 1)
  writeUint16LE(bytes, 22, 1)
  writeUint32LE(bytes, 24, sampleRate)
  writeUint32LE(bytes, 28, sampleRate * 2)
  writeUint16LE(bytes, 32, 2)
  writeUint16LE(bytes, 34, 16)
  writeAscii(bytes, 36, 'data')
  writeUint32LE(bytes, 40, dataSize)

  const fadeFrames = Math.max(1, Math.floor(sampleRate * 0.05))
  for (let index = 0; index < frames; index += 1) {
    const time = index / sampleRate
    let envelope = 1
    if (index < fadeFrames) {
      envelope = index / fadeFrames
    } else if (index > frames - fadeFrames) {
      envelope = Math.max(0, (frames - index) / fadeFrames)
    }
    const sample = Math.sin(2 * Math.PI * 220 * time) * amplitude * envelope
    const value = Math.max(-1, Math.min(1, sample))
    const pcm = Math.round(value * 0x7fff)
    writeUint16LE(bytes, 44 + index * 2, pcm & 0xffff)
  }
  return bytes
}

export interface FocusBgmManagerLike {
  title?: string
  src?: string
  play?(): void
  stop?(): void
  seek?(time: number): void
  onEnded?(handler: () => void): void
  offEnded?(handler: () => void): void
  onError?(handler: (error: unknown) => void): void
  offError?(handler: (error: unknown) => void): void
}

export interface FocusBgmFileSystemLike {
  writeFileSync(path: string, data: ArrayBuffer | Uint8Array): void
}

export interface FocusBgmDeps {
  getManager?: () => FocusBgmManagerLike | null
  getFileSystem?: () => FocusBgmFileSystemLike | null
  userDataPath?: () => string
  onWarn?: (message: string) => void
}

function defaultGetManager(): FocusBgmManagerLike | null {
  if (typeof wx === 'undefined') {
    return null
  }
  const api = (wx as unknown as { getBackgroundAudioManager?: () => unknown })
    .getBackgroundAudioManager
  if (typeof api !== 'function') {
    return null
  }
  return api() as FocusBgmManagerLike | null
}

function defaultGetFileSystem(): FocusBgmFileSystemLike | null {
  if (typeof wx === 'undefined') {
    return null
  }
  const api = (wx as unknown as { getFileSystemManager?: () => unknown })
    .getFileSystemManager
  if (typeof api !== 'function') {
    return null
  }
  return api() as FocusBgmFileSystemLike | null
}

function defaultUserDataPath(): string {
  if (typeof wx === 'undefined') {
    return ''
  }
  return wx.env?.USER_DATA_PATH || ''
}

/**
 * 后台保活控制器：
 * - 只负责生成 WAV / 启停 / onEnded 循环；是否允许播放由页面按 fsm + 偏好判断
 * - 任何一步失败 → disabled，倒计时继续，不重试
 */
export class FocusBgmController {
  private readonly getManager: () => FocusBgmManagerLike | null
  private readonly getFileSystem: () => FocusBgmFileSystemLike | null
  private readonly userDataPath: () => string
  private readonly onWarn: (message: string) => void

  private manager: FocusBgmManagerLike | null = null
  private src = ''
  private started = false
  private disabledFlag = false
  private disposed = false
  private endedHandler: (() => void) | null = null
  private errorHandler: ((error: unknown) => void) | null = null

  constructor(deps: FocusBgmDeps = {}) {
    this.getManager = deps.getManager ?? defaultGetManager
    this.getFileSystem = deps.getFileSystem ?? defaultGetFileSystem
    this.userDataPath = deps.userDataPath ?? defaultUserDataPath
    this.onWarn = deps.onWarn ?? (() => undefined)
  }

  get disabled(): boolean {
    return this.disabledFlag || this.disposed
  }

  get isPlaying(): boolean {
    return this.started
  }

  ensureSource(): string {
    if (this.disabled) {
      return ''
    }
    if (this.src) {
      return this.src
    }
    try {
      const files = this.getFileSystem()
      const base = this.userDataPath()
      if (!files || !base) {
        throw new Error('文件系统不可用')
      }
      const path = `${base}/${BGM_FILE_NAME}`
      files.writeFileSync(path, buildBgmWav())
      this.src = path
      return path
    } catch (error) {
      this.disabledFlag = true
      this.onWarn(`后台保活音频生成失败：${error instanceof Error ? error.message : '未知错误'}`)
      return ''
    }
  }

  start(): boolean {
    if (this.disabled || this.started) {
      return false
    }
    try {
      const manager = this.manager || (this.manager = this.getManager())
      if (!manager) {
        throw new Error('后台音频管理器不可用')
      }
      const src = this.ensureSource()
      if (!src) {
        return false
      }
      this.bindManager(manager)
      this.started = true
      manager.title = BGM_TITLE
      manager.src = src
      manager.play?.()
      if (this.disabledFlag) {
        this.started = false
        return false
      }
      return true
    } catch (error) {
      this.started = false
      this.disabledFlag = true
      this.onWarn(`后台保活启动失败：${error instanceof Error ? error.message : '未知错误'}`)
      return false
    }
  }

  stop(): void {
    if (!this.started) {
      return
    }
    this.started = false
    try {
      this.manager?.stop?.()
    } catch {
      /* 已停止 */
    }
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.stop()
    if (this.manager && this.endedHandler) {
      try {
        this.manager.offEnded?.(this.endedHandler)
      } catch {
        /* 已解绑 */
      }
    }
    if (this.manager && this.errorHandler) {
      try {
        this.manager.offError?.(this.errorHandler)
      } catch {
        /* 已解绑 */
      }
    }
    this.endedHandler = null
    this.errorHandler = null
    this.manager = null
    this.disposed = true
  }

  private bindManager(manager: FocusBgmManagerLike): void {
    if (this.endedHandler) {
      return
    }
    const handler = (): void => {
      if (!this.started || this.disposed) {
        return
      }
      try {
        manager.seek?.(0)
        manager.play?.()
      } catch (error) {
        this.disabledFlag = true
        this.onWarn(`后台保活循环失败：${error instanceof Error ? error.message : '未知错误'}`)
      }
    }
    this.endedHandler = handler
    const errHandler = (error: unknown): void => {
      if (this.disposed || !this.started) {
        return
      }
      this.disabledFlag = true
      this.started = false
      this.onWarn(
        `后台保活中断：${error instanceof Error ? error.message : '播放器异常'}`,
      )
    }
    this.errorHandler = errHandler
    try {
      manager.onEnded?.(handler)
    } catch {
      /* 部分基础库不支持循环回调；页面仍可用 WebAudio 计时 */
    }
    try {
      manager.onError?.(errHandler)
    } catch {
      /* 部分基础库不支持错误回调 */
    }
  }
}
