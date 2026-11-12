/* ==========================================================================
   qw-minutely · 未来 2 小时分钟级降水
   ========================================================================== */

interface RainBar {
  timeText: string
  precip: number
  typeText: string
  height: number
  active: boolean
}

Component({
  options: {
    virtualHost: true,
    styleIsolation: 'isolated',
  },

  properties: {
    minutely: { type: Object, value: null },
    loading: { type: Boolean, value: false },
    error: { type: String, value: '' },
  },

  data: {
    bars: [] as RainBar[],
  },

  observers: {
    minutely(value: { points?: RainBar[]; maxPrecip?: number } | null) {
      const points = value && Array.isArray(value.points) ? value.points : []
      const max = Math.max(0.01, Number(value?.maxPrecip || 0))
      const bars = points.map((point) => ({
        timeText: point.timeText,
        precip: point.precip,
        typeText: point.typeText,
        height: point.precip > 0 ? Math.max(8, Math.min(100, (point.precip / max) * 100)) : 2,
        active: point.precip > 0,
      }))
      this.setData({ bars })
    },
  },
})
