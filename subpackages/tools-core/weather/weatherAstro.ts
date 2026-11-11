/* ==========================================================================
   weather/weatherAstro · 日出日落本地计算（NOAA 近似算法）
   - 仅依赖经纬度与日期，不请求任何第三方接口
   - 极昼 / 极夜显式返回，绝不输出 NaN
   - 精度约 ±2 分钟，UI 标注「本地计算 · 仅供参考」
   ========================================================================== */
import type { SunTimes } from './types'

const ZENITH_DEG = 90.833
const RAD = Math.PI / 180

function dayOfYear(year: number, month: number, day: number): number {
  const start = Date.UTC(year, 0, 1)
  const current = Date.UTC(year, month - 1, day)
  return Math.floor((current - start) / 86400000) + 1
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function formatClock(date: Date): string {
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${hour}:${minute}`
}

function placeholder(): SunTimes {
  return {
    kind: 'normal',
    sunrise: '—',
    sunset: '—',
    sunriseMinutes: null,
    sunsetMinutes: null,
  }
}

/**
 * 计算某日某经纬度的日出日落。
 * @param lat 纬度（-90..90）
 * @param lng 经度（-180..180，东经为正）
 * @param date 本地日期
 */
export function computeSunTimes(lat: number, lng: number, date: Date): SunTimes {
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return placeholder()
  }
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()
  const n = dayOfYear(year, month, day)

  const gamma = (2 * Math.PI / 365) * (n - 1)
  const eqtime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma))
  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma)

  const latRad = lat * RAD
  const cosHa =
    Math.cos(ZENITH_DEG * RAD) / (Math.cos(latRad) * Math.cos(decl)) -
    Math.tan(latRad) * Math.tan(decl)

  if (cosHa > 1) {
    return {
      kind: 'polar-night',
      sunrise: '极夜',
      sunset: '极夜',
      sunriseMinutes: null,
      sunsetMinutes: null,
    }
  }
  if (cosHa < -1) {
    return {
      kind: 'polar-day',
      sunrise: '极昼',
      sunset: '极昼',
      sunriseMinutes: null,
      sunsetMinutes: null,
    }
  }

  const ha = Math.acos(clamp(cosHa, -1, 1))
  const haDeg = ha / RAD
  const sunriseUtcMinutes = 720 - 4 * (lng + haDeg) - eqtime
  const sunsetUtcMinutes = 720 - 4 * (lng - haDeg) - eqtime
  if (!Number.isFinite(sunriseUtcMinutes) || !Number.isFinite(sunsetUtcMinutes)) {
    return placeholder()
  }

  const baseUtc = Date.UTC(year, month - 1, day)
  const sunrise = new Date(baseUtc + sunriseUtcMinutes * 60000)
  const sunset = new Date(baseUtc + sunsetUtcMinutes * 60000)
  return {
    kind: 'normal',
    sunrise: formatClock(sunrise),
    sunset: formatClock(sunset),
    sunriseMinutes: sunriseUtcMinutes,
    sunsetMinutes: sunsetUtcMinutes,
  }
}
