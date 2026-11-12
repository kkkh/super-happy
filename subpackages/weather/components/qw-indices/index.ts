/* ==========================================================================
   qw-indices · 生活指数（天气指数 API）
   - 1 天 / 3 天切换，全部 16 类指数
   - 每条直接展示完整建议，不做“展开但无新增内容”的假交互
   ========================================================================== */

interface IndexItem {
  type: string
  name: string
  level: string
  category: string
  text: string
}

interface IndexDay {
  date: string
  dateText: string
  weekText: string
  items: IndexItem[]
}

Component({
  options: {
    virtualHost: true,
    styleIsolation: 'isolated',
  },

  properties: {
    days: { type: Array, value: [] },
    loading: { type: Boolean, value: false },
    error: { type: String, value: '' },
    range: { type: Number, value: 3 },
    showRange: { type: Boolean, value: false },
  },

  data: {
    activeDate: '',
    countText: '',
    ranges: [1, 3] as Array<1 | 3>,
  },

  observers: {
    days(value: IndexDay[]) {
      const list = Array.isArray(value) ? value : []
      const activeDate = list.some((day) => day.date === this.data.activeDate)
        ? this.data.activeDate
        : list.length
          ? list[0].date
          : ''
      const active = list.find((day) => day.date === activeDate)
      this.setData({
        activeDate,
        countText: active ? `${active.items.length} 项` : '',
      })
    },
  },

  methods: {
    onRange(event: WechatMiniprogram.TouchEvent): void {
      const range = Number(event.currentTarget.dataset.range)
      if ((range !== 1 && range !== 3) || range === this.data.range) {
        return
      }
      this.triggerEvent('range', { range })
    },

    onDate(event: WechatMiniprogram.TouchEvent): void {
      const date = String(event.currentTarget.dataset.date || '')
      if (!date || date === this.data.activeDate) {
        return
      }
      const day = (this.data.days as IndexDay[]).find((item) => item.date === date)
      this.setData({
        activeDate: date,
        countText: day ? `${day.items.length} 项` : '',
      })
    },
  },
})
