/* ==========================================================================
   glass-slider · 极光玻璃滑轨
   - catchtouchmove 拦截冒泡：拖拽时页面绝不跟着滚动
   - 移动端 32ms 节流，只在值真正变化时 setData；松手才抛 change 供落盘
   - 松手后 thumb / fill 使用弹簧曲线吸附；拖动过程中关闭过渡跟手
   - 刻度与数值全部由父级传入，组件不持有业务状态
   ========================================================================== */
import { tapTick } from '../../core/utils/haptics'

interface SliderRuntime {
  left: number
  width: number
  current: number
  lastMoveAt: number
  pendingX: number
  dragging: boolean
}

const MOVE_THROTTLE_MS = 32

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

Component({
  options: {
    virtualHost: true,
    styleIsolation: 'isolated',
  },

  properties: {
    value: {
      type: Number,
      value: 0,
    },
    min: {
      type: Number,
      value: 0,
    },
    max: {
      type: Number,
      value: 2,
    },
    step: {
      type: Number,
      value: 1,
    },
    disabled: {
      type: Boolean,
      value: false,
    },
    marks: {
      type: Array,
      value: [],
    },
    showValue: {
      type: Boolean,
      value: false,
    },
    caption: {
      type: String,
      value: '',
    },
    unit: {
      type: String,
      value: '',
    },
    ariaLabel: {
      type: String,
      value: '滑轨',
    },
  },

  data: {
    percent: 0,
    displayValue: '0',
    activeIndex: 0,
    dragging: false,
  },

  observers: {
    'value, min, max, step'() {
      const runtime = this as unknown as SliderRuntime
      if (!runtime.dragging) {
        this.syncFromValue(this.data.value)
      }
    },
  },

  lifetimes: {
    attached() {
      const runtime = this as unknown as SliderRuntime
      runtime.left = 0
      runtime.width = 0
      runtime.current = this.data.value
      runtime.lastMoveAt = 0
      runtime.pendingX = 0
      runtime.dragging = false
    },

    ready() {
      this.measureTrack()
      this.syncFromValue(this.data.value)
    },

    detached() {
      const runtime = this as unknown as SliderRuntime
      runtime.dragging = false
      runtime.pendingX = 0
    },
  },

  pageLifetimes: {
    show() {
      this.measureTrack()
    },
  },

  methods: {
    /** 只在 ready / 页面显示 / 触摸开始时测量，避免滚动中反复查询 */
    measureTrack(): void {
      this.createSelectorQuery()
        .select('.glass-slider__track')
        .boundingClientRect((rect: WechatMiniprogram.BoundingClientRectCallbackResult | null) => {
          const runtime = this as unknown as SliderRuntime
          if (!rect || rect.width <= 0) {
            return
          }
          runtime.left = rect.left
          runtime.width = rect.width
        })
        .exec()
    },

    clampValue(raw: number): number {
      const min = Number.isFinite(this.data.min) ? this.data.min : 0
      const max = Number.isFinite(this.data.max) ? this.data.max : 2
      const step = Number.isFinite(this.data.step) && this.data.step > 0 ? this.data.step : 1
      if (max <= min) {
        return min
      }
      const snapped = Math.round((raw - min) / step) * step + min
      return clamp(snapped, min, max)
    },

    percentOf(value: number): number {
      const min = this.data.min
      const max = this.data.max
      if (!(max > min)) {
        return 0
      }
      return clamp(((value - min) / (max - min)) * 100, 0, 100)
    },

    valueFromX(clientX: number): number {
      const runtime = this as unknown as SliderRuntime
      if (!(runtime.width > 0)) {
        return runtime.current
      }
      const ratio = clamp((clientX - runtime.left) / runtime.width, 0, 1)
      const raw = this.data.min + ratio * (this.data.max - this.data.min)
      return this.clampValue(raw)
    },

    syncFromValue(value: number): void {
      const runtime = this as unknown as SliderRuntime
      const safe = this.clampValue(value)
      const percent = this.percentOf(safe)
      const step = this.data.step > 0 ? this.data.step : 1
      const activeIndex = Math.round((safe - this.data.min) / step)
      runtime.current = safe
      const displayValue = `${Number.isInteger(safe) ? safe : safe.toFixed(1)}${this.data.unit}`
      if (
        Math.abs(percent - this.data.percent) < 0.1 &&
        activeIndex === this.data.activeIndex &&
        displayValue === this.data.displayValue
      ) {
        return
      }
      this.setData({ percent, displayValue, activeIndex })
    },

    applyValue(value: number, commit: boolean): void {
      const runtime = this as unknown as SliderRuntime
      const safe = this.clampValue(value)
      const percent = this.percentOf(safe)
      const step = this.data.step > 0 ? this.data.step : 1
      const activeIndex = Math.round((safe - this.data.min) / step)
      const displayValue = `${Number.isInteger(safe) ? safe : safe.toFixed(1)}${this.data.unit}`

      runtime.current = safe
      if (
        Math.abs(percent - this.data.percent) >= 0.1 ||
        displayValue !== this.data.displayValue
      ) {
        this.setData({ percent, displayValue, activeIndex })
      }

      if (commit) {
        this.triggerEvent('change', { value: safe })
      } else {
        this.triggerEvent('input', { value: safe })
      }
    },

    onTouchStart(event: WechatMiniprogram.TouchEvent): void {
      if (this.data.disabled) {
        return
      }
      const touch = event.touches[0]
      if (!touch) {
        return
      }
      const runtime = this as unknown as SliderRuntime
      runtime.dragging = true
      runtime.lastMoveAt = 0
      runtime.pendingX = touch.clientX
      tapTick()
      this.setData({ dragging: true })
      this.measureTrack()
      this.applyValue(this.valueFromX(touch.clientX), false)
    },

    onTouchMove(event: WechatMiniprogram.TouchEvent): void {
      const runtime = this as unknown as SliderRuntime
      if (!runtime.dragging || this.data.disabled) {
        return
      }
      const touch = event.touches[0]
      if (!touch) {
        return
      }
      const now = Date.now()
      runtime.pendingX = touch.clientX
      if (now - runtime.lastMoveAt < MOVE_THROTTLE_MS) {
        return
      }
      runtime.lastMoveAt = now
      this.applyValue(this.valueFromX(runtime.pendingX), false)
    },

    onTouchEnd(event: WechatMiniprogram.TouchEvent): void {
      const runtime = this as unknown as SliderRuntime
      if (!runtime.dragging) {
        return
      }
      const touch = event.changedTouches && event.changedTouches[0]
      const finalX = touch ? touch.clientX : runtime.pendingX
      runtime.dragging = false
      this.setData({ dragging: false })
      this.applyValue(this.valueFromX(finalX), true)
    },

    onTouchCancel(): void {
      const runtime = this as unknown as SliderRuntime
      if (!runtime.dragging) {
        return
      }
      runtime.dragging = false
      this.setData({ dragging: false })
      this.applyValue(runtime.current, true)
    },
  },
})
