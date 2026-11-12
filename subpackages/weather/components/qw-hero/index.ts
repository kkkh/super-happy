/* ==========================================================================
   qw-hero · 和风天气当前实况 Hero
   ========================================================================== */

Component({
  options: {
    virtualHost: true,
    styleIsolation: 'isolated',
  },

  properties: {
    city: { type: Object, value: null },
    current: { type: Object, value: null },
    today: { type: Object, value: null },
    air: { type: Object, value: null },
    alerts: { type: Array, value: [] },
    loading: { type: Boolean, value: false },
    fromCache: { type: Boolean, value: false },
    error: { type: String, value: '' },
  },

  data: {
    sourceText: '',
  },

  observers: {
    city(value: { source?: string } | null) {
      const map: Record<string, string> = {
        fuzzy: '定位',
        manual: '手动',
        top: '热门',
        poi: '景点',
      }
      const sourceText = value && value.source ? map[value.source] || '' : ''
      if (sourceText !== this.data.sourceText) {
        this.setData({ sourceText })
      }
    },
  },

  methods: {
    onCity(): void {
      this.triggerEvent('city')
    },
    onRefresh(): void {
      this.triggerEvent('refresh')
    },
    onFlow(): void {
      this.triggerEvent('flow')
    },
    onAir(): void {
      this.triggerEvent('air')
    },
    onAlert(): void {
      this.triggerEvent('alert')
    },
  },
})
