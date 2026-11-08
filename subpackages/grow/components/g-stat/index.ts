/**
 * g-stat · 数字速览（滚动计数 + 弹跳落定）
 * 用法示例：
 *   <g-stat value="{{stat.value}}" suffix="+" label="作品" kicker="累计" />
 */
import { uiStore } from '../../../../core/stores/ui'

interface StatState {
  ticker: number
  display: number
}

const TICK_MS = 26
/** 计数时长（毫秒） */
const DURATION = 900

Component({
  properties: {
    value: { type: Number, value: 0 },
    suffix: { type: String, value: '' },
    label: { type: String, value: '' },
    kicker: { type: String, value: '' },
  },

  data: {
    display: 0,
  },

  lifetimes: {
    attached() {
      this.startCount()
    },
    detached() {
      const state = this as unknown as StatState
      if (state.ticker) {
        clearInterval(state.ticker)
      }
    },
  },

  observers: {
    value() {
      this.startCount()
    },
  },

  methods: {
    /** 从 0 平滑滚至目标值（ease-out 分段） */
    startCount() {
      const state = this as unknown as StatState
      if (state.ticker) {
        clearInterval(state.ticker)
      }
      const target = Math.max(0, Math.floor(this.data.value))
      /* 低内存模式直接落定终值，不再启动 setInterval 滚动 */
      if (uiStore.lowMemory) {
        this.setData({ display: target })
        return
      }
      const startedAt = Date.now()
      state.ticker = setInterval(() => {
        const progress = Math.min(1, (Date.now() - startedAt) / DURATION)
        /* ease-out cubic */
        const eased = 1 - (1 - progress) ** 3
        this.setData({ display: Math.round(target * eased) })
        if (progress >= 1) {
          clearInterval(state.ticker)
          state.ticker = 0
        }
      }, TICK_MS) as unknown as number
    },
  },
})
