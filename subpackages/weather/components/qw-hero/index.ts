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

  methods: {
    onCity(): void {
      this.triggerEvent('city')
    },
    onRefresh(): void {
      this.triggerEvent('refresh')
    },
    onAir(): void {
      this.triggerEvent('air')
    },
    onAlert(): void {
      this.triggerEvent('alert')
    },
  },
})
