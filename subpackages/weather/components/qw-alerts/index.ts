/* ==========================================================================
   qw-alerts · 实时天气预警
   ========================================================================== */

Component({
  options: {
    virtualHost: true,
    styleIsolation: 'isolated',
  },

  properties: {
    alerts: { type: Array, value: [] },
    showEmpty: { type: Boolean, value: false },
    loading: { type: Boolean, value: false },
    error: { type: String, value: '' },
  },

  data: {
    expandedId: '',
  },

  methods: {
    onToggle(event: WechatMiniprogram.TouchEvent): void {
      const id = String(event.currentTarget.dataset.id || '')
      this.setData({ expandedId: this.data.expandedId === id ? '' : id })
    },
  },
})
