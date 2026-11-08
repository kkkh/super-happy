/* ==========================================================================
   触觉 + 点击音效 · 全链路唯一出口
   - 震动强度由 preferenceStore.haptics 三档接管：关闭 / 轻震 / 重震
   - 同一次点按同步触发语义音效（tap / success / warning），音效开关独立管控
   - 真机不支持震动 / 音频时静默降级，绝不抛错
   ========================================================================== */
import { preferenceStore } from '../stores/preference'
import { useSound } from '../services/sound'
import type { GlassSoundName } from '../../components/sound-hook'

export type HapticIntensity = 'none' | 'light' | 'medium' | 'heavy'
export type VibrateType = 'light' | 'medium' | 'heavy'

const SOUND_FOR_INTENSITY: Record<Exclude<HapticIntensity, 'none'>, GlassSoundName> = {
  light: 'tap',
  medium: 'success',
  heavy: 'warning',
}

/** 用户档位 × 语义强度 → 实际震感；off 返回 null */
export function resolveVibrateType(
  intensity: HapticIntensity,
  level = preferenceStore.haptics,
): VibrateType | null {
  if (intensity === 'none' || level === 'off') {
    return null
  }
  if (level === 'light') {
    return intensity === 'heavy' ? 'medium' : 'light'
  }
  /* heavy：轻触也抬到 medium，警告与成功保持 heavy */
  return intensity === 'light' ? 'medium' : 'heavy'
}

/** 低层入口：玻璃按钮等需要自定义强度时调用 */
export function vibrate(intensity: HapticIntensity): void {
  if (intensity === 'none') {
    return
  }

  const type = resolveVibrateType(intensity)
  if (type) {
    try {
      wx.vibrateShort({ type, fail: () => undefined })
    } catch {
      /* 不支持震动的环境静默降级 */
    }
  }

  /* 静震时仍保留音效：两个开关互不绑架 */
  void useSound().play(SOUND_FOR_INTENSITY[intensity])
}

/** 轻触：列表点按、入口进入 */
export function tapTick(): void {
  vibrate('light')
}

/** 成功：保存相册、收藏落定、复制成功 */
export function tapSuccess(): void {
  vibrate('medium')
}

/** 警示：删除确认、复制失败 */
export function tapWarn(): void {
  vibrate('heavy')
}

/** 全局接管 Hook：页面 / 组件可按需取用，内部始终读取最新偏好 */
export function useHaptics(): {
  vibrate: typeof vibrate
  tick: typeof tapTick
  success: typeof tapSuccess
  warn: typeof tapWarn
} {
  return {
    vibrate,
    tick: tapTick,
    success: tapSuccess,
    warn: tapWarn,
  }
}
