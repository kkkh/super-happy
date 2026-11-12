/* ==========================================================================
   qw-hourly · 逐小时预报
   - 24 / 72 / 168 / 240 小时
   - 温度柱高度归一化，点击卡片展开完整字段
   ========================================================================== */

interface HourView {
  [key: string]: unknown
  temp: number
}

Component({
  options: {
    virtualHost: true,
    styleIsolation: 'isolated',
  },

  properties: {
    hours: { type: Array, value: [] },
    range: { type: Number, value: 24 },
    loading: { type: Boolean, value: false },
    error: { type: String, value: '' },
  },

  data: {
    viewHours: [] as Array<HourView & { barHeight: number; selected: boolean }>,
    selectedIndex: 0,
    ranges: [24, 72, 168, 240],
  },

  observers: {
    hours(value: HourView[]) {
      const list = Array.isArray(value) ? value : []
      const temps = list.map((item) => Number(item.temp)).filter((item) => Number.isFinite(item))
      const min = temps.length ? Math.min(...temps) : 0
      const max = temps.length ? Math.max(...temps) : 1
      const span = Math.max(1, max - min)
      const selectedIndex = Math.min(this.data.selectedIndex, Math.max(0, list.length - 1))
      this.setData({
        selectedIndex,
        viewHours: list.map((item, index) => ({
          ...item,
          barHeight: Math.max(14, Math.min(100, ((Number(item.temp) - min) / span) * 86 + 14)),
          selected: index === selectedIndex,
        })),
      })
    },
  },

  methods: {
    onRange(event: WechatMiniprogram.TouchEvent): void {
      const range = Number(event.currentTarget.dataset.range)
      if ([24, 72, 168, 240].includes(range)) {
        this.triggerEvent('range', { range })
      }
    },
    onSelect(event: WechatMiniprogram.TouchEvent): void {
      const index = Number(event.currentTarget.dataset.index)
      if (!Number.isFinite(index)) {
        return
      }
      this.setData({
        selectedIndex: index,
        viewHours: this.data.viewHours.map(
          (item: HourView & { barHeight: number; selected: boolean }, i: number) => ({
            ...item,
            selected: i === index,
          }),
        ),
      })
    },
  },
})
