/**
 * glass-input · 极光毛玻璃输入框
 * - 聚焦时边框转为语义强调色，并出现柔和双层光圈
 * - input / textarea 均固定 adjust-position="{{true}}"，保证键盘避让
 * - 支持 prefix / suffix 插槽、清空按钮、字数统计、错误 / 提示文案
 * - virtualHost + styleIsolation，样式不污染页面
 *
 * 用法：
 *   <glass-input
 *     label="搜索工具"
 *     placeholder="输入关键词"
 *     value="{{keyword}}"
 *     clearable
 *     bind:input="onInput"
 *   />
 */

export type GlassInputTone = 'neutral' | 'iris' | 'aurora' | 'amber' | 'danger'
export type GlassInputSize = 'sm' | 'md' | 'lg'

export interface GlassInputValueDetail {
  value: string
  source: 'input' | 'clear'
}

export interface GlassInputFocusDetail {
  value: string
}

export interface GlassInputBlurDetail {
  value: string
}

export interface GlassInputConfirmDetail {
  value: string
}

export interface GlassInputKeyboardDetail {
  height: number
  duration: number
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
    /** 当前值；受控使用时由页面 setData 回写 */
    value: {
      type: String,
      value: '',
    },
    /** 输入框类型：text / number / idcard / digit / safe-password / nickname */
    type: {
      type: String,
      value: 'text',
    },
    /** 密码模式 */
    password: {
      type: Boolean,
      value: false,
    },
    /** 多行文本域 */
    multiline: {
      type: Boolean,
      value: false,
    },
    /** textarea 自动增高 */
    autoHeight: {
      type: Boolean,
      value: true,
    },
    /** textarea 是否显示键盘上方确认栏 */
    showConfirmBar: {
      type: Boolean,
      value: true,
    },
    /** 占位文案 */
    placeholder: {
      type: String,
      value: '',
    },
    /** 最大长度；-1 表示不限制 */
    maxlength: {
      type: Number,
      value: 140,
    },
    /** 显示字数统计 */
    showCount: {
      type: Boolean,
      value: false,
    },
    /** 显示清空按钮 */
    clearable: {
      type: Boolean,
      value: true,
    },
    /** 顶部标签 */
    label: {
      type: String,
      value: '',
    },
    /** 正常态提示 */
    hint: {
      type: String,
      value: '',
    },
    /** 错误态文案；非空时进入 danger 边框 */
    error: {
      type: String,
      value: '',
    },
    /** 尺寸档位 */
    size: {
      type: String,
      value: 'md',
    },
    /** 语义色调：决定聚焦高光颜色 */
    tone: {
      type: String,
      value: 'neutral',
    },
    /** 禁用 */
    disabled: {
      type: Boolean,
      value: false,
    },
    /** 只读（仅单行 input 生效） */
    readonly: {
      type: Boolean,
      value: false,
    },
    /** 受控聚焦 */
    focus: {
      type: Boolean,
      value: false,
    },
    /** 键盘右下角按钮文案 */
    confirmType: {
      type: String,
      value: 'done',
    },
    /** 键盘与输入框间距 */
    cursorSpacing: {
      type: Number,
      value: 24,
    },
    /** 噪点层 */
    noise: {
      type: Boolean,
      value: true,
    },
    /** 流光层 */
    sheen: {
      type: Boolean,
      value: true,
    },
    /** 读屏标签 */
    ariaLabel: {
      type: String,
      value: '',
    },
    /** 外部布局样式 */
    customStyle: {
      type: String,
      value: '',
    },
  },

  data: {
    innerValue: '',
    currentLength: 0,
    focused: false,
  },

  observers: {
    value(value: string) {
      const next = typeof value === 'string' ? value : ''
      if (next === this.data.innerValue) {
        return
      }
      this.setData({
        innerValue: next,
        currentLength: Array.from(next).length,
      })
    },
  },

  lifetimes: {
    attached() {
      const value = this.data.value
      this.setData({
        innerValue: value,
        currentLength: Array.from(value).length,
      })
    },
  },

  methods: {
    onInput(event: WechatMiniprogram.Input): void {
      const value = event.detail.value
      this.setData({
        innerValue: value,
        currentLength: Array.from(value).length,
      })

      const detail: GlassInputValueDetail = {
        value,
        source: 'input',
      }
      this.triggerEvent('input', detail)
    },

    onFocus(): void {
      this.setData({ focused: true })
      const detail: GlassInputFocusDetail = {
        value: this.data.innerValue,
      }
      this.triggerEvent('focus', detail)
    },

    onBlur(): void {
      this.setData({ focused: false })
      const detail: GlassInputBlurDetail = {
        value: this.data.innerValue,
      }
      this.triggerEvent('blur', detail)
    },

    onConfirm(event: WechatMiniprogram.Input): void {
      const detail: GlassInputConfirmDetail = {
        value: event.detail.value,
      }
      this.triggerEvent('confirm', detail)
    },

    /**
     * 键盘高度变化只透传事件，不写 data：
     * 页面可据此调整外层 scroll-view / 底部按钮，组件自身不做重排。
     * input / textarea 仍固定 adjust-position=true 由原生负责避让。
     */
    onKeyboardHeightChange(
      event: WechatMiniprogram.CustomEvent<GlassInputKeyboardDetail>,
    ): void {
      const raw = event.detail
      const detail: GlassInputKeyboardDetail = {
        height:
          raw && typeof raw.height === 'number' && Number.isFinite(raw.height)
            ? raw.height
            : 0,
        duration:
          raw && typeof raw.duration === 'number' && Number.isFinite(raw.duration)
            ? raw.duration
            : 0,
      }
      this.triggerEvent('keyboardheight', detail)
    },

    onClear(): void {
      if (this.data.disabled || this.data.readonly) {
        return
      }
      this.setData({
        innerValue: '',
        currentLength: 0,
      })

      const detail: GlassInputValueDetail = {
        value: '',
        source: 'clear',
      }
      this.triggerEvent('input', detail)
      this.triggerEvent('clear', detail)
    },
  },
})
