/* ==========================================================================
   qw-astronomy · 天文（日出日落 / 月相 / 太阳高度角）
   - 日期可切换，太阳高度角可指定时间
   - 日出日落进度条按当前时间计算；月相使用官方 800–807 图标
   - 「今天」必须按城市 utcOffset 判断，不能使用设备时区
   ========================================================================== */

import { todayKeyFor } from '../../lib/qweather/date'

interface SunView {
  sunriseText: string
  sunsetText: string
  dayLengthText: string
}

interface SolarView {
  elevation: number
  azimuth: number
  elevationText: string
  azimuthText: string
  solarHourText: string
  hourAngleText: string
}

function minutesOf(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(text || '').trim())
  if (!match) {
    return null
  }
  return Number(match[1]) * 60 + Number(match[2])
}

Component({
  options: {
    virtualHost: true,
    styleIsolation: 'isolated',
  },

  properties: {
    sun: { type: Object, value: null },
    moon: { type: Object, value: null },
    solar: { type: Object, value: null },
    dates: { type: Array, value: [] },
    activeDate: { type: String, value: '' },
    time: { type: String, value: '12:00' },
    altitude: { type: Number, value: 0 },
    utcOffset: { type: String, value: '+08:00' },
    loading: { type: Boolean, value: false },
    error: { type: String, value: '' },
  },

  data: {
    sunProgress: 0,
    isDay: true,
    isToday: true,
    elevationPercent: 0,
    azimuth: 0,
  },

  observers: {
    'sun, utcOffset, activeDate'() {
      const value = this.data.sun as SunView | null
      const now = new Date()
      const today = todayKeyFor(this.data.utcOffset)
      const active = String(this.data.activeDate || '')
      const isToday = !active || active === today
      const rise = value ? minutesOf(value.sunriseText) : null
      const set = value ? minutesOf(value.sunsetText) : null
      if (rise === null || set === null || set <= rise) {
        this.setData({ sunProgress: 0, isDay: true, isToday })
        return
      }
      const match = /^([+-])(\d{2}):(\d{2})$/.exec(String(this.data.utcOffset || ''))
      let current = now.getUTCHours() * 60 + now.getUTCMinutes()
      if (match) {
        const offset = Number(match[2]) * 60 + Number(match[3])
        current += match[1] === '-' ? -offset : offset
      } else {
        current += now.getTimezoneOffset() * -1
      }
      current = ((current % 1440) + 1440) % 1440
      const progress = ((current - rise) / (set - rise)) * 100
      this.setData({
        sunProgress: Math.max(0, Math.min(100, Math.round(progress))),
        isDay: current >= rise && current <= set,
        isToday,
      })
    },
    solar(value: SolarView | null) {
      if (!value) {
        this.setData({ elevationPercent: 0, azimuth: 0 })
        return
      }
      const elevation = Number(value.elevation)
      this.setData({
        elevationPercent: Number.isFinite(elevation)
          ? Math.max(0, Math.min(100, (elevation / 90) * 100))
          : 0,
        azimuth: Number.isFinite(Number(value.azimuth)) ? Number(value.azimuth) : 0,
      })
    },
  },

  methods: {
    onDate(event: WechatMiniprogram.TouchEvent): void {
      const date = String(event.currentTarget.dataset.date || '')
      if (date && date !== this.data.activeDate) {
        this.triggerEvent('datechange', { date })
      }
    },
    onTime(event: WechatMiniprogram.CustomEvent<{ value: string }>): void {
      const time = String(event.detail.value || '')
      if (time) {
        this.triggerEvent('timechange', { time })
      }
    },

    onAltitude(event: WechatMiniprogram.CustomEvent<{ value: string }>): void {
      const raw = Number(event.detail.value)
      const altitude = Number.isFinite(raw) ? Math.max(-500, Math.min(9000, Math.round(raw))) : 0
      if (altitude !== this.data.altitude) {
        this.triggerEvent('altchange', { altitude })
      }
    },
  },
})
