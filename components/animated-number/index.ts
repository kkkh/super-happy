/**
 * animated-number · WXS 阻尼滚动数字
 * - WXS 通过 change:prop 监听动画配置，requestAnimationFrame 逐帧计算
 * - 阻尼曲线 easeOutQuint，从 0 滚向目标值，形成老虎机式落定
 * - 千分位 / 小数位 / 前后缀全部在 WXS 中格式化
 * - JS 只接收帧文本并 setData，不参与缓动计算
 * - virtualHost + styleIsolation，样式不污染页面
 *
 * 用法：
 *   <animated-number value="{{total}}" decimals="2" prefix="¥" size="lg" />
 */

export type AnimatedNumberSize = 'sm' | 'md' | 'lg' | 'xl'
export type AnimatedNumberTone = 'neutral' | 'iris' | 'aurora' | 'amber'

export interface AnimatedNumberConfig {
  value: number
  from: number
  duration: number
  decimals: number
  separator: string
  prefix: string
  suffix: string
  epoch: number
  animated: boolean
}

export interface AnimatedNumberFrame {
  text: string
  value: number
  epoch: number
  done?: boolean
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function normalizeNumber(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function formatFixed(
  value: number,
  decimals: number,
  separator: string,
  prefix: string,
  suffix: string,
): string {
  const numberValue = normalizeNumber(value)
  const places = clamp(Math.floor(decimals), 0, 4)
  const factor = Math.pow(10, places)
  const rounded = Math.round(numberValue * factor) / factor

  if (!Number.isFinite(rounded)) {
    return '—'
  }

  const negative = rounded < 0
  const fixed = Math.abs(rounded).toFixed(places)
  const parts = fixed.split('.')
  const integer = parts[0] ?? '0'
  const decimal = parts[1] ?? ''

  let grouped = ''
  let count = 0
  for (let index = integer.length - 1; index >= 0; index -= 1) {
    grouped = integer.charAt(index) + grouped
    count += 1
    if (separator && count % 3 === 0 && index > 0) {
      grouped = separator + grouped
    }
  }

  const decimalText = decimal ? `.${decimal}` : ''
  const sign = negative && rounded !== 0 ? '-' : ''
  return `${sign}${prefix}${grouped}${decimalText}${suffix}`
}

const INITIAL_CONFIG: AnimatedNumberConfig = {
  value: 0,
  from: 0,
  duration: 1000,
  decimals: 0,
  separator: ',',
  prefix: '',
  suffix: '',
  epoch: 0,
  animated: true,
}

interface AnimatedNumberRuntime {
  /** WXS 帧丢失时的兜底定时器，确保任何运行时都能落定终值 */
  settleTimer: number
}

Component({
  options: {
    virtualHost: true,
    styleIsolation: 'isolated',
    addGlobalClass: false,
  },

  externalClasses: ['custom-class'],

  properties: {
    /** 目标数值 */
    value: {
      type: Number,
      value: 0,
    },
    /** 动画时长，ms */
    duration: {
      type: Number,
      value: 1000,
    },
    /** 小数位，0–4 */
    decimals: {
      type: Number,
      value: 0,
    },
    /** 千分位分隔符，传空字符串可关闭 */
    separator: {
      type: String,
      value: ',',
    },
    /** 前缀，如 ¥ */
    prefix: {
      type: String,
      value: '',
    },
    /** 后缀，如 % */
    suffix: {
      type: String,
      value: '',
    },
    /** 字号档位 */
    size: {
      type: String,
      value: 'md',
    },
    /** 语义色调 */
    tone: {
      type: String,
      value: 'neutral',
    },
    /** 是否启用 WXS 动画；false 直接显示终值 */
    animated: {
      type: Boolean,
      value: true,
    },
    /** 外部布局样式 */
    customStyle: {
      type: String,
      value: '',
    },
  },

  data: {
    displayText: '0',
    finalText: '0',
    epoch: 0,
    animating: false,
    animConfig: INITIAL_CONFIG,
  },

  observers: {
    'value, duration, decimals, separator, prefix, suffix, animated'() {
      this.syncConfig()
    },
  },

  lifetimes: {
    attached() {
      const runtime = this as unknown as AnimatedNumberRuntime
      runtime.settleTimer = 0
      this.syncConfig()
    },
    detached() {
      const runtime = this as unknown as AnimatedNumberRuntime
      if (runtime.settleTimer) {
        clearTimeout(runtime.settleTimer)
        runtime.settleTimer = 0
      }
    },
  },

  methods: {
    /** 兜底：WXS 帧未送达时，按目标时长后直接落定 */
    scheduleSettle(finalText: string, duration: number): void {
      const runtime = this as unknown as AnimatedNumberRuntime
      if (runtime.settleTimer) {
        clearTimeout(runtime.settleTimer)
        runtime.settleTimer = 0
      }
      if (duration <= 0) {
        return
      }
      runtime.settleTimer = setTimeout(() => {
        runtime.settleTimer = 0
        if (!this.data.animating) {
          return
        }
        this.setData({ displayText: finalText, animating: false })
      }, duration + 400) as unknown as number
    },

    syncConfig(): void {
      const value = normalizeNumber(this.data.value)
      const decimals = clamp(Math.floor(this.data.decimals), 0, 4)
      const duration = clamp(Math.floor(this.data.duration), 0, 3000)
      const separator = this.data.separator
      const prefix = this.data.prefix
      const suffix = this.data.suffix
      const animated = this.data.animated
      const epoch = this.data.epoch + 1

      const finalText = formatFixed(value, decimals, separator, prefix, suffix)
      const config: AnimatedNumberConfig = {
        value,
        from: 0,
        duration,
        decimals,
        separator,
        prefix,
        suffix,
        epoch,
        animated,
      }

      if (animated && duration > 0) {
        this.scheduleSettle(finalText, duration)
      }

      this.setData({
        epoch,
        finalText,
        animConfig: config,
        displayText: animated ? this.data.displayText : finalText,
        animating: animated && duration > 0,
      })
    },

    /** WXS 每帧回调：只接受当前 epoch，过期动画帧直接丢弃 */
    applyFrame(frame: AnimatedNumberFrame): void {
      if (!frame || frame.epoch !== this.data.epoch) {
        return
      }
      if (typeof frame.text !== 'string') {
        return
      }
      if (frame.done) {
        const runtime = this as unknown as AnimatedNumberRuntime
        if (runtime.settleTimer) {
          clearTimeout(runtime.settleTimer)
          runtime.settleTimer = 0
        }
      }
      this.setData({
        displayText: frame.text,
        finalText: frame.done ? frame.text : this.data.finalText,
        animating: frame.done ? false : this.data.animating,
      })
    },
  },
})
