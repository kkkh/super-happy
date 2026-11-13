/* ==========================================================================
   useMotion · 动画强度 / 光效的全局读取器
   - full：完整视差 + 全量模糊 + 标准时长
   - lite：保留视差，降低模糊与过渡时长
   - saver：关闭陀螺仪阻尼、动态光效与大部分过渡，优先省电
   - 只读取 preferenceStore，不做任何 setData；页面 / 组件按需消费
   ========================================================================== */
import { preferenceStore } from '../stores/preference'
import { uiStore } from '../stores/ui'
import { effectiveMotion, type EffectiveMotion } from '../utils/device-tier'

export interface MotionProfile {
  level: EffectiveMotion
  label: string
  /** 是否允许陀螺仪 / 视差阻尼 */
  hologramEnabled: boolean
  /** 是否允许动态极光与光追 */
  lightEnabled: boolean
  /** 模糊倍率：saver 下组件可据此降低 backdrop-filter */
  blurScale: number
  /** 过渡时长倍率：saver 接近 0，lite 略慢于全效 */
  durationScale: number
  /** 新建玻璃组件统一使用的弹簧曲线 */
  springEasing: string
}

const PROFILES: Record<EffectiveMotion, MotionProfile> = {
  full: {
    level: 'full',
    label: '全效',
    hologramEnabled: true,
    lightEnabled: true,
    blurScale: 1,
    durationScale: 1,
    springEasing: 'cubic-bezier(0.25, 0.8, 0.25, 1)',
  },
  lite: {
    level: 'lite',
    label: '精简',
    hologramEnabled: true,
    lightEnabled: true,
    blurScale: 0.78,
    durationScale: 0.72,
    springEasing: 'cubic-bezier(0.25, 0.8, 0.25, 1)',
  },
  saver: {
    level: 'saver',
    label: '省电',
    hologramEnabled: false,
    lightEnabled: false,
    blurScale: 0.42,
    durationScale: 0.001,
    springEasing: 'linear',
  },
}

/** 全局接管入口：组件 / 页面每次调用都能拿到最新偏好与设备上限 */
export function useMotion(): MotionProfile {
  const level = effectiveMotion(preferenceStore.motion, uiStore.deviceTier)
  const profile = PROFILES[level] ?? PROFILES.full
  return {
    ...profile,
    /* 动态光效总开关优先级高于档位：关灯后任何档位都不跑极光 */
    lightEnabled: profile.lightEnabled && preferenceStore.lightEffects,
  }
}
