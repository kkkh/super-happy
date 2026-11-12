/* ==========================================================================
   qw-daily · 每日预报
   - 3 / 7 / 15 / 30 天（v7）/ 10 天增强（v1）
   - 点击展开昼/夜、风、湿度、气压、能见度、天文与月相
   ========================================================================== */

Component({
  options: {
    virtualHost: true,
    styleIsolation: 'isolated',
  },

  properties: {
    days: { type: Array, value: [] },
    range: { type: Number, value: 10 },
    loading: { type: Boolean, value: false },
    error: { type: String, value: '' },
  },

  data: {
    expandedDate: '',
    ranges: [3, 7, 10, 15, 30],
  },

  methods: {
    onRange(event: WechatMiniprogram.TouchEvent): void {
      const range = Number(event.currentTarget.dataset.range)
      if ([3, 7, 10, 15, 30].includes(range)) {
        this.triggerEvent('range', { range })
      }
    },
    onToggle(event: WechatMiniprogram.TouchEvent): void {
      const date = String(event.currentTarget.dataset.date || '')
      this.setData({ expandedDate: this.data.expandedDate === date ? '' : date })
    },
  },
})
