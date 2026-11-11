/* ==========================================================================
   weather/weatherHourly · 4 天预报 → 24 小时温度曲线
   - 锚点：每天 14:00 白天温度、次日 02:00 夜间温度
   - 余弦插值，结果四舍五入；UI 必须标注「基于预报推算」
   - 缺温度时跳过锚点，绝不补 0
   ========================================================================== */
import { isNightHour } from './weatherParse'
import type { ForecastDay, HourlyPoint } from './types'

interface DateParts {
  year: number
  month: number
  day: number
}

interface Anchor {
  time: number
  temp: number
  weather: string
}

function parseDateKey(value: string): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) {
    return null
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null
  }
  return { year, month, day }
}

function at(parts: DateParts, hour: number, dayOffset = 0): number {
  return new Date(parts.year, parts.month - 1, parts.day + dayOffset, hour, 0, 0, 0).getTime()
}

function anchorsFromDays(days: ForecastDay[]): Anchor[] {
  const anchors: Anchor[] = []
  days.forEach((day, index) => {
    const parts = parseDateKey(day.date)
    if (!parts) {
      return
    }
    if (day.daytemp !== null) {
      anchors.push({
        time: at(parts, 14),
        temp: day.daytemp,
        weather: day.dayweather,
      })
    }
    if (day.nighttemp !== null) {
      anchors.push({
        time: at(parts, 2, 1),
        temp: day.nighttemp,
        weather: day.nightweather,
      })
      /* 首日清晨没有「前一天夜间温度」，用当日夜间温度做近似，
         并在 UI 明确标注推算；绝不伪造真实观测 */
      if (index === 0) {
        anchors.push({
          time: at(parts, 2),
          temp: day.nighttemp,
          weather: day.nightweather,
        })
      }
    }
  })
  const byTime = new Map<number, Anchor>()
  anchors.forEach((anchor) => {
    byTime.set(anchor.time, anchor)
  })
  return Array.from(byTime.values()).sort((left, right) => left.time - right.time)
}

function interpolate(anchors: Anchor[], time: number): Anchor | null {
  if (anchors.length === 0) {
    return null
  }
  if (time <= anchors[0].time) {
    return anchors[0]
  }
  const last = anchors[anchors.length - 1]
  if (time >= last.time) {
    return last
  }
  for (let index = 0; index < anchors.length - 1; index += 1) {
    const left = anchors[index]
    const right = anchors[index + 1]
    if (time >= left.time && time <= right.time) {
      const span = right.time - left.time
      if (span <= 0) {
        return left
      }
      const ratio = (time - left.time) / span
      const weight = 0.5 - 0.5 * Math.cos(Math.PI * ratio)
      return {
        time,
        temp: left.temp + (right.temp - left.temp) * weight,
        weather: ratio < 0.5 ? left.weather : right.weather,
      }
    }
  }
  return last
}

function padHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}

export function buildHourlyForecast(days: ForecastDay[], now: Date): HourlyPoint[] {
  if (!Array.isArray(days) || days.length === 0) {
    return []
  }
  const anchors = anchorsFromDays(days)
  if (anchors.length === 0) {
    return []
  }
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    now.getHours(),
    0,
    0,
    0,
  )
  const points: HourlyPoint[] = []
  for (let index = 0; index < 24; index += 1) {
    const time = start.getTime() + index * 3600000
    const date = new Date(time)
    const hour = date.getHours()
    const anchor = interpolate(anchors, time)
    if (!anchor) {
      continue
    }
    points.push({
      hour,
      label: padHour(hour),
      temp: Math.round(anchor.temp),
      isNight: isNightHour(hour),
      weather: anchor.weather,
    })
  }
  return points
}

export function hourlyAriaText(points: HourlyPoint[]): string {
  if (points.length === 0) {
    return '暂无可推算的 24 小时温度'
  }
  const temps = points.map((point) => point.temp)
  const max = Math.max(...temps)
  const min = Math.min(...temps)
  return `24 小时温度推算：现在 ${points[0].temp}℃，最高 ${max}℃，最低 ${min}℃；数据基于官方 4 天预报插值，仅供参考。`
}
