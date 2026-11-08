/* ==========================================================================
   sound-hook · 物理音效引擎
   - 基于 wx.createInnerAudioContext，不依赖 WebAudio 兼容性
   - 4 个内置极短 WAV 以 Base64 内嵌，首次 preload 写入 USER_DATA_PATH
   - 通道池并发播放，onEnded / onError 自动回收，避免监听器累积
   - 支持全局静音、音量、iOS 静音开关策略、销毁清理
   ========================================================================== */
import { logger } from '../core/utils/logger'
import { preferenceStore } from '../core/stores/preference'

export type GlassSoundName = 'tap' | 'success' | 'warning' | 'error'

export interface GlassSoundConfig {
  /** 全局开关，默认 true */
  enabled?: boolean
  /** 音量 0–1，默认 0.6 */
  volume?: number
  /** 同时播放通道数 1–6，默认 4 */
  poolSize?: number
  /** iOS 是否服从系统静音开关，默认 true */
  respectMuteSwitch?: boolean
  /** 自定义音频落地目录，默认 wx.env.USER_DATA_PATH */
  basePath?: string
}

export interface GlassSoundHook {
  play(name?: GlassSoundName): Promise<boolean>
  preload(): Promise<boolean>
  setEnabled(enabled: boolean): void
  isEnabled(): boolean
  setVolume(volume: number): void
  setRespectMuteSwitch(value: boolean): void
  dispose(): void
}

interface SoundChannel {
  ctx: WechatMiniprogram.InnerAudioContext
  busy: boolean
}

/** 内置音效 Base64，运行时由脚本填充 */
const TAP_WAV_BASE64 = 'UklGRowCAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YWgCAAAAACMC0AcLDxkVPRd1ExcJJvlD5kDUW8dUw6TOM+Kx+voT0SmMOLk9gjjSKSoUNfsl4wbQCcX+wwnNm9649XgOsiStNL87wDg8LFYYbACI6KzUK8gXxevLedsa8SYJkh+bMGg5iTgqLhUcWQXP7WjZksuXxkfLzdjc7A4EexpgLL824jegL2Yf9Qnu8i/eMs93yBbLl9YB6Tf/dxUIKM0z0zagMEgiPA7g9/biAdOrylPL09SL5aX6jxCdI50wZTUwMb0kKRKb/LTn9dYszffLgNN84l/2ywspHzctnzNVMcQmuRUZAV/sBNvxz/vMmtLU32nyMwe1GqYpijEUMWAo6xhWBfDwJN/v0lfOHNKT3cfuzgJKFvQlLy90MJMpvRtMCV71S+Md1gXQAtK423zro/7xESoilix6L2IqLx73DKL5cudz2fzRR9JA2onotfqyDVEeyCkuLs8qQiBTELf9j+vn3DPU49Ip2e/lCfeUCXEazSaYLOAq9SFfE5YBm+9x4KTW09Nw2K/jpPOcBZMWriO+KpkqTCMYFjsFjvMJ5EXZDtUR2MjhiPDSAb4SdCCoKAAqSSR+GKIIY/em5xDcjtYJ2Dngt+07/voOJR1eJhsp7iSQGscLEvtA6/veTdhR2ADfNOva+k0LyxnmI+8nPyVQHKcOl/7S7v/hQ9rm2Bze/uiz974HbRZJIYQmQSW9HUER7AFT8hXlatzB2YjdFufJ9FEEEROPHt8k9yTZHpMTDgW+9Tbout7e2kPde+Ug8g0Bvg+9GwYjZySoH50V+gei+cvu4egk6L/rF/I4+VL/HgMkBMAC'
const SUCCESS_WAV_BASE64 = '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'
const WARNING_WAV_BASE64 = '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'
const ERROR_WAV_BASE64 = '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'

const SOUND_BASE64: Record<GlassSoundName, string> = {
  tap: TAP_WAV_BASE64,
  success: SUCCESS_WAV_BASE64,
  warning: WARNING_WAV_BASE64,
  error: ERROR_WAV_BASE64,
}

const SOUND_FILE: Record<GlassSoundName, string> = {
  tap: 'glass-sound-tap.wav',
  success: 'glass-sound-success.wav',
  warning: 'glass-sound-warning.wav',
  error: 'glass-sound-error.wav',
}

const SOUND_NAMES: GlassSoundName[] = ['tap', 'success', 'warning', 'error']
const DEFAULT_POOL_SIZE = 4
const DEFAULT_VOLUME = 0.6

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  try {
    return JSON.stringify(error)
  } catch {
    return '未知错误'
  }
}

function writeBase64File(filePath: string, base64: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      wx.getFileSystemManager().writeFile({
        filePath,
        data: base64,
        encoding: 'base64',
        success: () => resolve(),
        fail: (error) => reject(new Error(error.errMsg || '音效文件写入失败')),
      })
    } catch (error) {
      reject(new Error(toErrorMessage(error)))
    }
  })
}

function unlinkQuietly(filePath: string): void {
  try {
    wx.getFileSystemManager().unlink({
      filePath,
      fail: () => undefined,
    })
  } catch {
    /* 文件系统不可用时忽略 */
  }
}

export class GlassSoundEngine implements GlassSoundHook {
  private channels: SoundChannel[] = []
  private paths: Partial<Record<GlassSoundName, string>> = {}
  private preloadPromise: Promise<boolean> | null = null
  private enabled: boolean
  private volume: number
  private poolSize: number
  private respectMuteSwitch: boolean
  private basePath: string

  constructor(config: GlassSoundConfig = {}) {
    this.enabled = config.enabled !== false
    this.volume = clamp(
      typeof config.volume === 'number' && Number.isFinite(config.volume)
        ? config.volume
        : DEFAULT_VOLUME,
      0,
      1,
    )
    this.poolSize = clamp(
      typeof config.poolSize === 'number' && Number.isFinite(config.poolSize)
        ? Math.floor(config.poolSize)
        : DEFAULT_POOL_SIZE,
      1,
      6,
    )
    this.respectMuteSwitch = config.respectMuteSwitch !== false
    this.basePath =
      config.basePath ||
      (typeof wx.env !== 'undefined' && wx.env.USER_DATA_PATH
        ? wx.env.USER_DATA_PATH
        : '')
  }

  /** 预加载全部音效；失败只记录，不抛给调用方 */
  preload(): Promise<boolean> {
    if (this.preloadPromise) {
      return this.preloadPromise
    }
    this.preloadPromise = this.prepare()
    return this.preloadPromise
  }

  /** 播放内置音效；返回是否真正进入播放态 */
  async play(name: GlassSoundName = 'tap'): Promise<boolean> {
    /* 双闸门：引擎自身开关 + 全局偏好；未来任何直接调用也无法绕过静音 */
    if (!this.enabled || !preferenceStore.sound) {
      return false
    }
    const ready = await this.preload()
    if (!ready) {
      return false
    }
    const filePath = this.paths[name]
    if (!filePath) {
      return false
    }
    return this.playPath(filePath)
  }

  setEnabled(enabled: boolean): void {
    this.enabled = Boolean(enabled)
  }

  isEnabled(): boolean {
    return this.enabled
  }

  setVolume(volume: number): void {
    if (!Number.isFinite(volume)) {
      return
    }
    this.volume = clamp(volume, 0, 1)
  }

  setRespectMuteSwitch(value: boolean): void {
    this.respectMuteSwitch = Boolean(value)
  }

  /** 释放全部通道与落地文件；再次播放需重新 preload */
  dispose(): void {
    this.channels.forEach((channel) => {
      try {
        channel.ctx.stop()
      } catch {
        /* 已停止时忽略 */
      }
      try {
        channel.ctx.destroy()
      } catch {
        /* 已销毁时忽略 */
      }
      channel.busy = false
    })
    this.channels = []

    SOUND_NAMES.forEach((name) => {
      const filePath = this.paths[name]
      if (filePath) {
        unlinkQuietly(filePath)
      }
    })
    this.paths = {}
    this.preloadPromise = null
  }

  private async prepare(): Promise<boolean> {
    if (!this.basePath) {
      logger.warn('sound', 'USER_DATA_PATH 不可用，音效降级')
      return false
    }
    if (typeof wx.getFileSystemManager !== 'function') {
      logger.warn('sound', '文件系统不可用，音效降级')
      return false
    }

    try {
      await Promise.all(
        SOUND_NAMES.map(async (name) => {
          const filePath = `${this.basePath}/${SOUND_FILE[name]}`
          await writeBase64File(filePath, SOUND_BASE64[name])
          this.paths[name] = filePath
        }),
      )
      return true
    } catch (error) {
      logger.warn('sound', `音效预加载失败：${toErrorMessage(error)}`)
      return false
    }
  }

  private acquireChannel(): SoundChannel | null {
    const idle = this.channels.find((channel) => !channel.busy)
    if (idle) {
      idle.busy = true
      return idle
    }

    if (this.channels.length < this.poolSize && typeof wx.createInnerAudioContext === 'function') {
      const ctx = wx.createInnerAudioContext()
      const channel: SoundChannel = { ctx, busy: true }
      this.channels.push(channel)
      return channel
    }

    const fallback = this.channels[0]
    if (!fallback) {
      return null
    }

    try {
      fallback.ctx.stop()
    } catch {
      /* 未播放时忽略 */
    }
    fallback.busy = true
    return fallback
  }

  private playPath(filePath: string): Promise<boolean> {
    const channel = this.acquireChannel()
    if (!channel) {
      return Promise.resolve(false)
    }

    return new Promise<boolean>((resolve) => {
      const ctx = channel.ctx
      let settled = false

      const finish = (ok: boolean): void => {
        if (settled) {
          return
        }
        settled = true
        channel.busy = false
        try {
          ctx.offEnded(onEnded)
          ctx.offError(onError)
        } catch {
          /* 极旧版本无 off 接口时忽略 */
        }
        resolve(ok)
      }

      const onEnded = (): void => {
        finish(true)
      }

      const onError = (): void => {
        logger.warn('sound', '音效播放失败')
        finish(false)
      }

      ctx.onEnded(onEnded)
      ctx.onError(onError)

      try {
        ctx.stop()
        ctx.volume = this.volume
        ctx.obeyMuteSwitch = this.respectMuteSwitch
        ctx.src = filePath
        ctx.play()
      } catch (error) {
        logger.warn('sound', `音效播放异常：${toErrorMessage(error)}`)
        finish(false)
      }
    })
  }
}

export function createGlassSoundEngine(config: GlassSoundConfig = {}): GlassSoundHook {
  return new GlassSoundEngine(config)
}

/** 全局单例：页面直接 import { soundHook } */
export const soundHook: GlassSoundHook = new GlassSoundEngine()
