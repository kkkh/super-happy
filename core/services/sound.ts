/* ==========================================================================
   useSound · 全局音效接管
   - 所有播放都必须经过 preferenceStore.sound 闸门
   - 开关切换立即同步 soundHook.enabled；开启后异步预加载，不阻塞首帧
   - 首次启动延迟预热，避免与首页渲染争抢 IO
   ========================================================================== */
import { preferenceStore } from '../stores/preference'
import { soundHook, type GlassSoundName } from '../../components/sound-hook'

export interface SoundController {
  readonly enabled: boolean
  play(name?: GlassSoundName): Promise<boolean>
  preload(): Promise<boolean>
  /** 写偏好 + 同步引擎 + 开启时预热；返回是否成功落盘 */
  setEnabled(enabled: boolean): boolean
  dispose(): void
}

export function useSound(): SoundController {
  return {
    get enabled(): boolean {
      return preferenceStore.sound
    },

    play(name: GlassSoundName = 'tap'): Promise<boolean> {
      if (!preferenceStore.sound) {
        return Promise.resolve(false)
      }
      return soundHook.play(name)
    },

    preload(): Promise<boolean> {
      if (!preferenceStore.sound) {
        return Promise.resolve(false)
      }
      return soundHook.preload()
    },

    setEnabled(enabled: boolean): boolean {
      const persisted = preferenceStore.setSound(enabled)
      soundHook.setEnabled(enabled)
      if (enabled) {
        /* fire-and-forget：写文件失败只影响音效，不影响交互 */
        void soundHook.preload()
      }
      return persisted
    },

    dispose(): void {
      soundHook.dispose()
    },
  }
}

/** App.onLaunch 调用：偏好初始化之后、首帧之后延迟预热 */
export function warmUpSound(delayMs = 700): void {
  soundHook.setEnabled(preferenceStore.sound)
  if (!preferenceStore.sound) {
    return
  }
  setTimeout(() => {
    void soundHook.preload()
  }, Math.max(0, delayMs)) as unknown as number
}
