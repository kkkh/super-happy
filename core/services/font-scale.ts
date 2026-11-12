/* ==========================================================================
   字号档服务 · 全局字号偏好的读写与类名映射
   - Store 只负责持久化；本服务负责页面 / 组件可直接消费的类名与选项
   - 只影响字号与行高：间距、图标、Canvas 尺寸不参与缩放
   - 不依赖页面，可在 Page / Component / 测试中安全调用
   ========================================================================== */
import {
  FONT_SCALE_FACTORS,
  FONT_SCALE_LABELS,
  parseFontScale,
  preferenceStore,
  type FontScale,
} from '../stores/preference'

export type { FontScale }

export interface FontScaleOption {
  value: FontScale
  label: string
  desc: string
}

export interface FontScaleApplyResult {
  scale: FontScale
  persisted: boolean
  className: string
  label: string
}

/** 设置页半屏 Picker 的数据源：结构与 settings 的 PickerOption 兼容 */
export const FONT_SCALE_OPTIONS: FontScaleOption[] = [
  {
    value: 'standard',
    label: FONT_SCALE_LABELS.standard,
    desc: '默认字号，信息密度最高',
  },
  {
    value: 'large',
    label: FONT_SCALE_LABELS.large,
    desc: '正文与按钮更易读，布局基本不变',
  },
  {
    value: 'xlarge',
    label: FONT_SCALE_LABELS.xlarge,
    desc: '适合弱视或长辈，文字最大',
  },
]

const FONT_SCALE_CLASS_NAMES: Record<FontScale, string> = {
  standard: 'fs-standard',
  large: 'fs-large',
  xlarge: 'fs-xlarge',
}

export function scaleFor(scale: FontScale): number {
  return FONT_SCALE_FACTORS[scale] ?? FONT_SCALE_FACTORS.standard
}

/** 当前字号档：Store 未初始化或值异常时按标准档兜底 */
export function currentFontScale(): FontScale {
  return parseFontScale(preferenceStore.fontScale) ?? 'standard'
}

export function fontScaleClass(scale: FontScale = currentFontScale()): string {
  return FONT_SCALE_CLASS_NAMES[scale] ?? FONT_SCALE_CLASS_NAMES.standard
}

/** 页面 onShow / 组件 pageLifetimes.show 的一行同步入口 */
export function syncFontScaleClass(): string {
  return fontScaleClass(currentFontScale())
}

/**
 * 应用字号档：
 * - 非法值保持当前档，persisted=false；
 * - 合法值写入 Store；写入失败仍返回新档位，由调用方提示“仅本次会话生效”。
 */
export function applyFontScale(value: unknown): FontScaleApplyResult {
  const current = currentFontScale()
  const scale = parseFontScale(value)
  if (!scale) {
    return {
      scale: current,
      persisted: false,
      className: fontScaleClass(current),
      label: FONT_SCALE_LABELS[current],
    }
  }
  const persisted = preferenceStore.setFontScale(scale)
  return {
    scale,
    persisted,
    className: fontScaleClass(scale),
    label: FONT_SCALE_LABELS[scale],
  }
}
