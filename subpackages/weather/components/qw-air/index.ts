/* ==========================================================================
   qw-air · 空气质量（实时 / 24h / 3 天）
   ========================================================================== */

interface AirHourBar {
  hourText: string
  aqi: number
  aqiDisplay: string
  category: string
  color: string
  height: number
}

Component({
  options: {
    virtualHost: true,
    styleIsolation: 'isolated',
  },

  properties: {
    air: { type: Object, value: null },
    loading: { type: Boolean, value: false },
    error: { type: String, value: '' },
  },

  data: {
    hourlyBars: [] as AirHourBar[],
    expandedDate: '',
    expandedHour: '',
  },

  observers: {
    air(value: { hourly?: AirHourBar[]; daily?: Array<{ dateText?: string }> } | null) {
      const hours = value && Array.isArray(value.hourly) ? value.hourly : []
      const days = value && Array.isArray(value.daily) ? value.daily : []
      const max = Math.max(1, ...hours.map((item) => Number(item.aqi) || 0))
      const expandedDate = days.some((item) => item.dateText === this.data.expandedDate)
        ? this.data.expandedDate
        : ''
      const expandedHour = hours.some((item) => item.hourText === this.data.expandedHour)
        ? this.data.expandedHour
        : ''
      this.setData({
        expandedDate,
        expandedHour,
        hourlyBars: hours.map((item) => ({
          hourText: item.hourText,
          aqi: item.aqi,
          aqiDisplay: item.aqiDisplay,
          category: item.category,
          color: item.color,
          height: Math.max(8, Math.min(100, ((Number(item.aqi) || 0) / max) * 100)),
        })),
      })
    },
  },

  methods: {
    onHourToggle(event: WechatMiniprogram.TouchEvent): void {
      const hour = String(event.currentTarget.dataset.hour || '')
      if (!hour) {
        return
      }
      this.setData({ expandedHour: this.data.expandedHour === hour ? '' : hour })
    },

    onDayToggle(event: WechatMiniprogram.TouchEvent): void {
      const date = String(event.currentTarget.dataset.date || '')
      if (!date) {
        return
      }
      this.setData({ expandedDate: this.data.expandedDate === date ? '' : date })
    },
  },
})
