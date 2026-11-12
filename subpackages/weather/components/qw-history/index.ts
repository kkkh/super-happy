/* ==========================================================================
   qw-history · 天气时光机（历史再分析）
   - 日期选择（最近 10 天）+ 快捷日期
   - 当日概况 + 与今日最高 / 最低 / 降水对照 + 24 小时逐时历史
   ========================================================================== */

interface HistoryDailyLike {
  tempMax?: number
  tempMin?: number
  precip?: number
}

function delta(value: number, unit: string): string {
  if (!Number.isFinite(value)) {
    return '—'
  }
  const rounded = Math.round(value * 10) / 10
  return `${rounded > 0 ? '+' : ''}${rounded}${unit}`
}

Component({
  options: {
    virtualHost: true,
    styleIsolation: 'isolated',
  },

  properties: {
    history: { type: Object, value: null },
    date: { type: String, value: '' },
    minDate: { type: String, value: '' },
    maxDate: { type: String, value: '' },
    quick: { type: Array, value: [] },
    today: { type: Object, value: null },
    loading: { type: Boolean, value: false },
    error: { type: String, value: '' },
  },

  data: {
    compareText: '',
  },

  observers: {
    'history, today'(
      history: { daily?: HistoryDailyLike | null } | null,
      today: HistoryDailyLike | null,
    ) {
      const daily = history && history.daily ? history.daily : null
      const base = today || null
      if (!daily || !base) {
        this.setData({ compareText: '' })
        return
      }
      const parts: string[] = []
      const max = typeof daily.tempMax === 'number' ? daily.tempMax : NaN
      const min = typeof daily.tempMin === 'number' ? daily.tempMin : NaN
      const precip = typeof daily.precip === 'number' ? daily.precip : NaN
      if (Number.isFinite(max) && typeof base.tempMax === 'number') {
        parts.push(`最高 ${delta(max - base.tempMax, '°')}`)
      }
      if (Number.isFinite(min) && typeof base.tempMin === 'number') {
        parts.push(`最低 ${delta(min - base.tempMin, '°')}`)
      }
      if (Number.isFinite(precip) && typeof base.precip === 'number') {
        parts.push(`降水 ${delta(precip - base.precip, ' mm')}`)
      }
      this.setData({ compareText: parts.length ? `较今日 ${parts.join(' · ')}` : '' })
    },
  },

  methods: {
    onPicker(event: WechatMiniprogram.CustomEvent<{ value: string }>): void {
      const date = String(event.detail.value || '')
      if (date && date !== this.data.date) {
        this.triggerEvent('datechange', { date })
      }
    },

    onQuick(event: WechatMiniprogram.TouchEvent): void {
      const date = String(event.currentTarget.dataset.date || '')
      if (date && date !== this.data.date) {
        this.triggerEvent('datechange', { date })
      }
    },
  },
})
