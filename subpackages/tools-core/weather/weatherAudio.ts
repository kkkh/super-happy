/* ==========================================================================
   weather/weatherAudio · WebAudio 合成环境白噪音
   - 零音频文件：2 秒噪声 Buffer 循环 + 滤波
   - 必须由用户点击开启；默认关闭；页面 hide 立即 suspend
   - 雨声 = 低通噪声，风声 = 带通噪声；切换场景只改滤波与增益
   ========================================================================== */
import type { AmbientScene } from './types'

interface AudioNodeLike {
  connect: (node: AudioNodeLike) => void
  disconnect: () => void
}

interface AudioParamLike {
  value: number
}

export interface AudioBufferLike {
  getChannelData: (channel: number) => Float32Array
}

export interface AudioBufferSourceLike {
  buffer: AudioBufferLike | null
  loop: boolean
  start: (when?: number) => void
  stop: (when?: number) => void
  connect: (node: AudioNodeLike) => void
  disconnect: () => void
}

export interface BiquadFilterLike extends AudioNodeLike {
  type: string
  frequency: AudioParamLike
  Q: AudioParamLike
}

export interface GainLike extends AudioNodeLike {
  gain: AudioParamLike
}

export interface WebAudioContextLike {
  sampleRate: number
  destination: AudioNodeLike
  state?: string
  createBuffer: (channels: number, length: number, sampleRate: number) => AudioBufferLike
  createBufferSource: () => AudioBufferSourceLike
  createBiquadFilter: () => BiquadFilterLike
  createGain: () => GainLike
  resume: () => Promise<void> | void
  suspend: () => Promise<void> | void
  close: () => Promise<void> | void
}

export interface WeatherAudioOptions {
  createContext?: () => WebAudioContextLike | null
}

interface SceneProfile {
  type: string
  frequency: number
  q: number
  gain: number
}

const SCENE_PROFILES: Record<'rain' | 'wind', SceneProfile> = {
  rain: { type: 'lowpass', frequency: 1500, q: 0.5, gain: 0.13 },
  wind: { type: 'bandpass', frequency: 520, q: 0.8, gain: 0.1 },
}

function defaultCreateContext(): WebAudioContextLike | null {
  const api = wx as unknown as {
    createWebAudioContext?: () => WebAudioContextLike
  }
  if (typeof api.createWebAudioContext !== 'function') {
    return null
  }
  try {
    return api.createWebAudioContext()
  } catch {
    return null
  }
}

export function isWeatherAudioSupported(): boolean {
  const api = wx as unknown as { createWebAudioContext?: unknown }
  return typeof api.createWebAudioContext === 'function'
}

export class WeatherAmbientAudio {
  private readonly createContext: () => WebAudioContextLike | null
  private context: WebAudioContextLike | null = null
  private source: AudioBufferSourceLike | null = null
  private filter: BiquadFilterLike | null = null
  private gain: GainLike | null = null
  private enabled = false
  private scene: AmbientScene = null
  private started = false
  private disposed = false

  constructor(options: WeatherAudioOptions = {}) {
    this.createContext = options.createContext ?? defaultCreateContext
  }

  isAvailable(): boolean {
    return isWeatherAudioSupported() || this.createContext !== defaultCreateContext
  }

  isEnabled(): boolean {
    return this.enabled
  }

  /** 必须由用户手势触发；关闭时立即静音 */
  setEnabled(value: boolean): void {
    if (this.disposed) {
      return
    }
    if (!value) {
      this.enabled = false
      this.silence()
      return
    }
    if (!this.ensureGraph()) {
      this.enabled = false
      return
    }
    this.enabled = true
    this.applyScene()
    this.resume()
    if (!this.started && this.source) {
      try {
        this.source.start(0)
        this.started = true
      } catch {
        this.enabled = false
      }
    }
  }

  /** 场景只影响滤波与增益；未开启时不创建上下文 */
  setScene(scene: AmbientScene): void {
    this.scene = scene
    if (this.enabled) {
      this.applyScene()
    }
  }

  suspend(): void {
    if (!this.context) {
      return
    }
    try {
      const result = this.context.suspend()
      if (result && typeof result.catch === 'function') {
        result.catch(() => undefined)
      }
    } catch {
      /* 已关闭 / 不支持 suspend 时忽略 */
    }
  }

  resume(): void {
    if (!this.enabled || !this.context) {
      return
    }
    try {
      const result = this.context.resume()
      if (result && typeof result.catch === 'function') {
        result.catch(() => undefined)
      }
    } catch {
      /* 恢复失败保持静音，不阻塞页面 */
    }
  }

  dispose(): void {
    this.disposed = true
    this.enabled = false
    this.silence()
    if (this.source) {
      try {
        this.source.stop(0)
      } catch {
        /* 未启动的 source stop 可能抛错 */
      }
      try {
        this.source.disconnect()
      } catch {
        /* 已断开 */
      }
    }
    if (this.filter) {
      try {
        this.filter.disconnect()
      } catch {
        /* 已断开 */
      }
    }
    if (this.gain) {
      try {
        this.gain.disconnect()
      } catch {
        /* 已断开 */
      }
    }
    if (this.context) {
      try {
        const result = this.context.close()
        if (result && typeof result.catch === 'function') {
          result.catch(() => undefined)
        }
      } catch {
        /* 已关闭 */
      }
    }
    this.context = null
    this.source = null
    this.filter = null
    this.gain = null
    this.started = false
  }

  private ensureGraph(): boolean {
    if (this.context && this.source && this.filter && this.gain) {
      return true
    }
    const context = this.createContext()
    if (!context) {
      return false
    }
    try {
      const buffer = context.createBuffer(1, Math.max(1, Math.round(context.sampleRate * 2)), context.sampleRate)
      const channel = buffer.getChannelData(0)
      for (let index = 0; index < channel.length; index += 1) {
        channel[index] = Math.random() * 2 - 1
      }
      const source = context.createBufferSource()
      source.buffer = buffer
      source.loop = true
      const filter = context.createBiquadFilter()
      const gain = context.createGain()
      source.connect(filter)
      filter.connect(gain)
      gain.connect(context.destination)
      gain.gain.value = 0
      this.context = context
      this.source = source
      this.filter = filter
      this.gain = gain
      return true
    } catch {
      this.context = null
      this.source = null
      this.filter = null
      this.gain = null
      return false
    }
  }

  private applyScene(): void {
    if (!this.filter || !this.gain) {
      return
    }
    if (!this.scene) {
      this.gain.gain.value = 0
      return
    }
    const profile = SCENE_PROFILES[this.scene]
    this.filter.type = profile.type
    this.filter.frequency.value = profile.frequency
    this.filter.Q.value = profile.q
    this.gain.gain.value = profile.gain
  }

  private silence(): void {
    if (this.gain) {
      this.gain.gain.value = 0
    }
  }
}
