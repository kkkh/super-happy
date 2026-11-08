/**
 * glass-button · 极光毛玻璃按钮
 * - 物理弹簧回弹：CSS spring 曲线，按下快、回弹慢
 * - 触觉反馈：统一走 haptics 接管层，受全局震感档位与音效开关管控
 * - loading：菊花态 + 文案切换，loading / disabled 时拦截重复触发
 * - 变体：primary / aurora / warm / tint / ghost / danger
 * - virtualHost + styleIsolation，样式不污染页面
 *
 * 用法：
 *   <glass-button variant="primary" size="lg" loading="{{saving}}" bind:tap="onSave">
 *     保存到相册
 *   </glass-button>
 */
import { vibrate } from '../../core/utils/haptics'

export type GlassButtonVariant = 'primary' | 'aurora' | 'warm' | 'tint' | 'ghost' | 'danger'
export type GlassButtonSize = 'sm' | 'md' | 'lg'
export type GlassButtonShape = 'capsule' | 'rounded'
export type GlassButtonHaptic = 'none' | 'light' | 'medium' | 'heavy'

export interface GlassButtonTapDetail {
  source: 'glass-button'
  variant: GlassButtonVariant
  size: GlassButtonSize
  loading: false
}

export interface GlassButtonLongPressDetail {
  source: 'glass-button'
  variant: GlassButtonVariant
  size: GlassButtonSize
  loading: false
}

function playHaptic(mode: GlassButtonHaptic): void {
  /* 全局接管：偏好为「关闭」时不再触发任何震动，但仍可播放点击音效 */
  vibrate(mode)
}

Component({
  options: {
    virtualHost: true,
    multipleSlots: true,
    styleIsolation: 'isolated',
    addGlobalClass: false,
  },

  externalClasses: ['custom-class'],

  properties: {
    /** 视觉变体 */
    variant: {
      type: String,
      value: 'primary',
    },
    /** 尺寸档位 */
    size: {
      type: String,
      value: 'md',
    },
    /** 圆角形态 */
    shape: {
      type: String,
      value: 'capsule',
    },
    /** 撑满父容器宽度 */
    block: {
      type: Boolean,
      value: false,
    },
    /** 加载态：显示菊花，拦截点击 */
    loading: {
      type: Boolean,
      value: false,
    },
    /** loading 时替换默认文案；为空则保留原插槽文案 */
    loadingText: {
      type: String,
      value: '',
    },
    /** 加载呼吸光晕：用于海报生成 / 保存这类主 CTA */
    aura: {
      type: Boolean,
      value: false,
    },
    /** 成功态：勾选 + 薄荷光环，用于保存完成等瞬时结果 */
    success: {
      type: Boolean,
      value: false,
    },
    /** 成功态文案；为空时只显示勾选 */
    successText: {
      type: String,
      value: '',
    },
    /** 禁用态：降低透明度，拦截点击 */
    disabled: {
      type: Boolean,
      value: false,
    },
    /** 触觉强度 */
    haptic: {
      type: String,
      value: 'light',
    },
    /** WXS 物理弹簧；关闭后使用 CSS transition */
    spring: {
      type: Boolean,
      value: true,
    },
    /** 顶部流光层 */
    sheen: {
      type: Boolean,
      value: true,
    },
    /** 读屏标签；纯图标按钮建议必填 */
    ariaLabel: {
      type: String,
      value: '',
    },
    /** 读屏语义：普通按钮 / switch / tab 等 */
    ariaRole: {
      type: String,
      value: 'button',
    },
    /** 开关语义的选中态；默认空字符串时不会改变普通按钮 */
    ariaChecked: {
      type: String,
      value: '',
    },
    /** 外部布局样式，如 margin / width */
    customStyle: {
      type: String,
      value: '',
    },
  },

  methods: {
    onTap(): void {
      if (this.data.disabled || this.data.loading || this.data.success) {
        return
      }

      playHaptic(this.data.haptic as GlassButtonHaptic)

      const detail: GlassButtonTapDetail = {
        source: 'glass-button',
        variant: this.data.variant as GlassButtonVariant,
        size: this.data.size as GlassButtonSize,
        loading: false,
      }
      this.triggerEvent('tap', detail)
    },

    onLongPress(): void {
      if (this.data.disabled || this.data.loading || this.data.success) {
        return
      }

      const detail: GlassButtonLongPressDetail = {
        source: 'glass-button',
        variant: this.data.variant as GlassButtonVariant,
        size: this.data.size as GlassButtonSize,
        loading: false,
      }
      this.triggerEvent('longpress', detail)
    },
  },
})
