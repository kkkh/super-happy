/* ==========================================================================
   和风天气 · 响应解析与视图模型
   - 全部字段按「可能缺失」处理；未知枚举回退，不假设数组长度
   - v1 / v7 字段差异在这里收口，页面只消费统一 ViewModel
   ========================================================================== */

import {
  compassText,
  normalizeIconCode,
  uvText,
  windScaleText,
} from './icons'
import { dateKeyForOffset, todayKeyFor } from './date'
import type {
  QwAirDayView,
  QwAirHealthView,
  QwAirHourView,
  QwAirIndexView,
  QwAirView,
  QwAlertView,
  QwCurrentView,
  QwDailyPartView,
  QwDailyRange,
  QwDailyView,
  QwHistoryView,
  QwHourlyRange,
  QwHourlyView,
  QwIndicesView,
  QwMinutelyView,
  QwMoonPhasePoint,
  QwMoonView,
  QwPollutantView,
  QwRainPoint,
  QwSolarView,
  QwSunView,
  QwWindView,
} from './types'

/* ---- 基础取值 ---- */

function obj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function str(value: unknown, fallback = ''): string {
  if (typeof value === 'string') {
    const text = value.trim()
    return text || fallback
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  return fallback
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === 'string' && !value.trim()) {
    return null
  }
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function num(value: unknown, fallback = 0): number {
  const parsed = toNumber(value)
  return parsed === null ? fallback : parsed
}

function nullableNum(value: unknown): number | null {
  return toNumber(value)
}

function unitValue(value: unknown): { value: number; unit: string; has: boolean } {
  const record = obj(value)
  const parsed = nullableNum(record?.value)
  return {
    value: parsed === null ? 0 : parsed,
    unit: str(record?.unit),
    has: parsed !== null,
  }
}

/** 时间缺失时不要生成 ':00' 这类半截标签 */
function hourTextOf(value: unknown): string {
  const time = isoParts(value).time
  return /^\d{2}:\d{2}$/.test(time) ? `${time.slice(0, 2)}:00` : '—'
}

function isoParts(value: unknown): { date: string; time: string } {
  const raw = str(value)
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(raw)
  if (!match) {
    return { date: raw.slice(0, 10), time: raw.slice(11, 16) }
  }
  return { date: `${match[1]}-${match[2]}-${match[3]}`, time: `${match[4]}:${match[5]}` }
}

export function dateText(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  return match ? `${match[2]}-${match[3]}` : value || '—'
}

export function weekText(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) {
    return ''
  }
  const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getDay()
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][day] || ''
}

export function timeText(value: unknown): string {
  return isoParts(value).time || '—'
}

export function dateOnly(value: unknown): string {
  return isoParts(value).date || ''
}

function isToday(value: string, today = todayKey()): boolean {
  return dateOnly(value) === today
}

export function todayKey(): string {
  const date = new Date()
  const pad = (v: number): string => String(v).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export { dateKeyForOffset, todayKeyFor }

function tempText(value: number): string {
  return Number.isFinite(value) ? `${Math.round(value)}°` : '—'
}

function percentText(value: number): string {
  return Number.isFinite(value) ? `${Math.round(value)}%` : '—'
}

/** 缺失值只显示「—」，避免出现「— hPa」这类半截单位 */
function unitText(value: unknown, unit: string): string {
  const text = str(value, '')
  return text ? `${text} ${unit}` : '—'
}

function degreeText(value: unknown): string {
  const text = str(value, '')
  return text ? `${text}°` : '—'
}

function humidityText(value: unknown, isRatio = true): string {
  const raw = num(value, NaN)
  if (!Number.isFinite(raw)) {
    return '—'
  }
  return percentText(isRatio && raw >= 0 && raw <= 1 ? raw * 100 : raw)
}

function cloudText(value: unknown, isRatio = true): string {
  const raw = num(value, NaN)
  if (!Number.isFinite(raw)) {
    return '—'
  }
  return percentText(isRatio && raw >= 0 && raw <= 1 ? raw * 100 : raw)
}

function visibilityText(value: unknown, unit: 'm' | 'km'): string {
  const raw = num(value, NaN)
  if (!Number.isFinite(raw)) {
    return '—'
  }
  if (unit === 'm') {
    return raw >= 1000 ? `${(raw / 1000).toFixed(1)} km` : `${Math.round(raw)} m`
  }
  return `${raw} km`
}

function precipTypeText(type: string): string {
  const map: Record<string, string> = {
    rain: '雨',
    snow: '雪',
    ice: '冰粒 / 冻雨',
    mixed: '混合降水',
    none: '无降水',
    unknown: '未知',
  }
  return map[type] || type || '—'
}

function severityText(severity: string): string {
  const map: Record<string, string> = {
    minor: '轻微',
    moderate: '中等',
    severe: '严重',
    extreme: '极端',
    unknown: '未知',
  }
  return map[severity] || severity || '未知'
}

function urgencyText(value: string): string {
  const map: Record<string, string> = {
    immediate: '立即',
    expected: '预计',
    future: '未来',
    past: '过去',
    unknown: '未知',
  }
  return map[value] || value || ''
}

function certaintyText(value: string): string {
  const map: Record<string, string> = {
    observed: '已观测',
    likely: '很可能',
    possible: '有可能',
    unlikely: '不太可能',
    unknown: '未知',
  }
  return map[value] || value || ''
}

function messageTypeText(value: string): string {
  const map: Record<string, string> = {
    alert: '发布',
    update: '更新',
    cancel: '解除',
  }
  return map[value] || ''
}

function colorText(code: string): string {
  const map: Record<string, string> = {
    white: '白色',
    gray: '灰色',
    green: '绿色',
    blue: '蓝色',
    yellow: '黄色',
    amber: '琥珀色',
    orange: '橙色',
    red: '红色',
    purple: '紫色',
    black: '黑色',
  }
  return map[code] || code || '未知'
}

function rgba(value: unknown, fallback = 'rgba(120,136,255,0.9)'): string {
  const record = obj(value)
  if (!record) {
    return fallback
  }
  const r = Math.round(num(record.red, 120))
  const g = Math.round(num(record.green, 136))
  const b = Math.round(num(record.blue, 255))
  const a = num(record.alpha, 1)
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`
}

function moonPhaseText(value: string): string {
  const map: Record<string, string> = {
    'new-moon': '新月',
    'waxing-crescent': '娥眉月',
    'first-quarter': '上弦月',
    'waxing-gibbous': '盈凸月',
    'full-moon': '满月',
    'waning-gibbous': '亏凸月',
    'last-quarter': '下弦月',
    'waning-crescent': '残月',
  }
  return map[value] || value || '—'
}

function moonIcon(value: string): string {
  const map: Record<string, string> = {
    'new-moon': '800',
    'waxing-crescent': '801',
    'first-quarter': '802',
    'waxing-gibbous': '803',
    'full-moon': '804',
    'waning-gibbous': '805',
    'last-quarter': '806',
    'waning-crescent': '807',
  }
  return map[value] || '9999'
}

function windView(value: unknown, legacy = false): QwWindView {
  const record = obj(value)
  if (!record) {
    return { degree: null, compass: '', speed: 0, speedText: '—', scale: null, text: '—', heroText: '—' }
  }
  if (legacy) {
    const dir = str(record.windDir, '')
    const rawScale = str(record.windScale, '')
    const scaleMatch = /^(\d+(?:\.\d+)?)(?:\s*[-~至]\s*(\d+(?:\.\d+)?))?$/.exec(rawScale)
    const scale = scaleMatch
      ? Number(scaleMatch[2] || scaleMatch[1])
      : nullableNum(record.windScale)
    const scaleLabel = scaleMatch
      ? `${scaleMatch[2] ? `${scaleMatch[1]}-${scaleMatch[2]}` : scaleMatch[1]} 级`
      : scale !== null
        ? windScaleText(scale)
        : ''
    const heroScale = scaleMatch
      ? `${scaleMatch[2] ? `${scaleMatch[1]}-${scaleMatch[2]}` : scaleMatch[1]}级`
      : scale !== null
        ? `${Math.round(scale)}级`
        : ''
    const speed = num(record.windSpeed, NaN)
    const compactDir = dir.replace(/风$/, '')
    return {
      degree: nullableNum(record.wind360),
      compass: dir,
      speed: Number.isFinite(speed) ? speed : 0,
      speedText: Number.isFinite(speed) ? `${speed} km/h` : '—',
      scale,
      text: [dir, scaleLabel, Number.isFinite(speed) ? `${speed} km/h` : '']
        .filter(Boolean)
        .join(' · ') || '—',
      heroText:
        [compactDir, heroScale, Number.isFinite(speed) ? `${speed}km/h` : '']
          .filter(Boolean)
          .join(' ') || '—',
    }
  }
  const direction = obj(record.direction)
  const speed = unitValue(record.speed)
  const scale = nullableNum(record.scale)
  const compass = str(direction?.compass, '')
  const dirText = compassText(compass, '风向')
  const speedText = speed.has ? `${speed.value} ${speed.unit || 'm/s'}` : ''
  const hasAny = Boolean(compass) || scale !== null || speed.has
  return {
    degree: nullableNum(direction?.degree),
    compass,
    speed: speed.value,
    speedText: speedText || '—',
    scale,
    text: hasAny
      ? [dirText, scale !== null ? windScaleText(scale) : '', speedText].filter(Boolean).join(' · ')
      : '—',
    heroText: hasAny
      ? [
          dirText.replace(/风$/, ''),
          scale !== null ? `${Math.round(scale)}级` : '',
          speed.has ? `${speed.value}${speed.unit || 'm/s'}` : '',
        ]
          .filter(Boolean)
          .join(' ')
      : '—',
  }
}

/* ---- v1 实时 ---- */

export function parseCurrentV1(raw: unknown, iconOverride = '', obsTime = ''): QwCurrentView {
  const record = obj(raw) || {}
  const condition = obj(record.condition)
  const wind = obj(record.wind)
  const gust = unitValue(record.windGust)
  const precip = obj(record.precipitation)
  const amount = unitValue(precip?.amount)
  const intensity = unitValue(precip?.intensity)
  const temp = unitValue(record.temperature)
  const feels = unitValue(record.feelsLike)
  const pressure = unitValue(record.pressure)
  const visibility = unitValue(record.visibility)
  const dew = unitValue(record.dewPoint)
  const code = str(condition?.code)
  const iconCode = iconOverride && iconOverride !== '9999' ? iconOverride : code
  const humidity = num(record.humidity, NaN)
  const cloud = num(record.cloudCover, NaN)
  const uv = num(record.uvIndex, NaN)
  const validTime = str(record.validTime) || str(obsTime)
  return {
    validTime,
    validTimeText: timeText(validTime),
    icon: normalizeIconCode(iconCode, false),
    condition: str(condition?.text, '—'),
    temp: temp.value,
    tempText: temp.has ? tempText(temp.value) : '—',
    feelsLike: feels.value,
    feelsLikeText: feels.has ? tempText(feels.value) : '—',
    humidity: Number.isFinite(humidity) ? humidity * 100 : 0,
    humidityText: humidityText(humidity, true),
    wind: windView(wind, false),
    gust: gust.value,
    gustText: gust.has ? `${gust.value} ${gust.unit || 'm/s'}` : '—',
    precip: amount.value,
    precipText: amount.has ? `${amount.value} ${amount.unit || 'mm'}` : '—',
    precipType: str(precip?.type, 'none'),
    precipTypeText: precipTypeText(str(precip?.type, 'none')),
    precipIntensityText: intensity.has ? `${intensity.value} ${intensity.unit || 'mm/h'}` : '—',
    pressure: pressure.value,
    pressureText: pressure.has ? `${Math.round(pressure.value)} ${pressure.unit || 'hPa'}` : '—',
    visibility: visibility.value,
    visibilityText: visibility.has ? visibilityText(visibility.value, visibility.unit === 'km' ? 'km' : 'm') : '—',
    dewPoint: dew.value,
    dewPointText: dew.has ? tempText(dew.value) : '—',
    cloud: Number.isFinite(cloud) ? cloud * 100 : 0,
    cloudText: cloudText(cloud, true),
    uv: Number.isFinite(uv) ? uv : 0,
    uvText: Number.isFinite(uv) ? uvText(uv) : '—',
    source: '和风天气 QWeather',
  }
}

export function parseNowV7(raw: unknown): { icon: string; condition: string; obsTime: string; tempText: string } {
  const record = obj(raw) || {}
  const now = obj(record.now) || {}
  return {
    icon: normalizeIconCode(str(now.icon), false),
    condition: str(now.text, '—'),
    obsTime: str(now.obsTime),
    tempText: str(now.temp, '—'),
  }
}

/* ---- v1 每日 ---- */

function parseDailyPart(value: unknown, isNight: boolean): QwDailyPartView {
  const record = obj(value) || {}
  const condition = obj(record.condition)
  const wind = windView(record.wind, false)
  const gust = unitValue(record.windGustMax)
  const precip = obj(record.precipitation)
  const amount = unitValue(precip?.amount)
  const pop = num(precip?.probability, NaN)
  const start = timeText(record.forecastStartTime)
  const end = timeText(record.forecastEndTime)
  const tempMax = unitValue(record.temperatureMax)
  const tempMin = unitValue(record.temperatureMin)
  return {
    icon: normalizeIconCode(str(condition?.code), isNight),
    condition: str(condition?.text, '—'),
    periodText: start !== '—' && end !== '—' ? `${start}–${end}` : '',
    tempMaxText: tempMax.has ? tempText(tempMax.value) : '—',
    tempMinText: tempMin.has ? tempText(tempMin.value) : '—',
    windText: wind.text,
    gustText: gust.has ? `${gust.value} ${gust.unit || 'm/s'}` : '—',
    precipText: amount.has ? `${amount.value} ${amount.unit || 'mm'}` : '—',
    precipTypeText: precipTypeText(str(precip?.type, 'none')),
    popText: Number.isFinite(pop) ? percentText(pop * 100) : '—',
    humidityText: humidityText(record.humidity, true),
    cloudText: cloudText(record.cloudCover, true),
  }
}

export function parseDailyV1(raw: unknown, range: QwDailyRange = 10, today = todayKey()): QwDailyView[] {
  const record = obj(raw) || {}
  return list(record.days).map((item) => {
    const day = obj(item) || {}
    const astro = obj(day.astro) || {}
    const dayPart = parseDailyPart(day.daytime, false)
    const nightPart = parseDailyPart(day.nighttime, true)
    const dayPrecipAmount = unitValue(obj(obj(day.daytime)?.precipitation)?.amount)
    const date = dateOnly(day.forecastStartTime)
    const moonPhase = str(astro.moonPhase)
    const tempMax = unitValue(day.temperatureMax)
    const tempMin = unitValue(day.temperatureMin)
    const tempAvg = unitValue(day.temperatureAvg)
    return {
      date,
      dateText: dateText(date),
      weekText: isToday(date, today) ? '今天' : weekText(date),
      iconDay: dayPart.icon,
      iconNight: nightPart.icon,
      textDay: dayPart.condition,
      textNight: nightPart.condition,
      tempMax: tempMax.value,
      tempMin: tempMin.value,
      tempAvg: tempAvg.value,
      tempMaxText: tempMax.has ? tempText(tempMax.value) : '—',
      tempMinText: tempMin.has ? tempText(tempMin.value) : '—',
      tempAvgText: tempAvg.has ? tempText(tempAvg.value) : '—',
      humidityText: dayPart.humidityText,
      precip: dayPrecipAmount.value,
      precipText: dayPart.precipText,
      popText: dayPart.popText,
      pressureText: '—',
      visibilityText: '—',
      cloudText: dayPart.cloudText,
      uvText: uvText(num(day.uvIndexMax, NaN)),
      windDayText: dayPart.windText,
      windNightText: nightPart.windText,
      sunriseText: timeText(astro.sunrise),
      sunsetText: timeText(astro.sunset),
      moonriseText: timeText(astro.moonrise),
      moonsetText: timeText(astro.moonset),
      moonPhase: moonPhaseText(moonPhase),
      moonIcon: moonIcon(moonPhase),
      astro: {
        sunrise: str(astro.sunrise),
        sunset: str(astro.sunset),
        astronomicalDawn: timeText(astro.astronomicalDawn),
        nauticalDawn: timeText(astro.nauticalDawn),
        dawn: timeText(astro.civilDawn),
        astronomicalDusk: timeText(astro.astronomicalDusk),
        nauticalDusk: timeText(astro.nauticalDusk),
        dusk: timeText(astro.civilDusk),
        solarNoon: timeText(astro.solarNoon),
        solarMidnight: timeText(astro.solarMidnight),
        moonrise: str(astro.moonrise),
        moonset: str(astro.moonset),
        moonTransit: timeText(astro.moonTransit),
        moonUnderfoot: timeText(astro.moonUnderfoot),
        moonPhase: moonPhaseText(moonPhase),
      },
      daytime: dayPart,
      nighttime: nightPart,
      range,
    }
  })
}

/* ---- v7 每日 ---- */

export function parseDailyV7(raw: unknown, range: QwDailyRange = 15, today = todayKey()): QwDailyView[] {
  const record = obj(raw) || {}
  return list(record.daily).map((item) => {
    const day = obj(item) || {}
    const date = str(day.fxDate)
    const windDay = windView(
      { windDir: day.windDirDay, wind360: day.wind360Day, windScale: day.windScaleDay, windSpeed: day.windSpeedDay },
      true,
    )
    const windNight = windView(
      { windDir: day.windDirNight, wind360: day.wind360Night, windScale: day.windScaleNight, windSpeed: day.windSpeedNight },
      true,
    )
    const dayPart: QwDailyPartView = {
      icon: normalizeIconCode(str(day.iconDay), false),
      condition: str(day.textDay, '—'),
      periodText: '',
      /* v7 只提供全天最高/最低，没有独立的昼/夜温度，避免昼夜显示成同一组数 */
      tempMaxText: '—',
      tempMinText: '—',
      windText: windDay.text,
      gustText: '—',
      /* v7 只有全天降水，没有昼/夜拆分，避免把全天值伪装成夜间值 */
      precipText: '—',
      precipTypeText: '—',
      popText: '—',
      humidityText: humidityText(day.humidity, false),
      cloudText: cloudText(day.cloud, false),
    }
    const nightPart: QwDailyPartView = {
      icon: normalizeIconCode(str(day.iconNight), true),
      condition: str(day.textNight, '—'),
      periodText: '',
      tempMaxText: '—',
      tempMinText: '—',
      windText: windNight.text,
      gustText: '—',
      precipText: '—',
      precipTypeText: '—',
      popText: '—',
      humidityText: humidityText(day.humidity, false),
      cloudText: cloudText(day.cloud, false),
    }
    const tempMax = num(day.tempMax, NaN)
    const tempMin = num(day.tempMin, NaN)
    const tempAvg =
      Number.isFinite(tempMax) && Number.isFinite(tempMin) ? (tempMax + tempMin) / 2 : NaN
    const pop = str(day.pop, '')
    return {
      date,
      dateText: dateText(date),
      weekText: isToday(date, today) ? '今天' : weekText(date),
      iconDay: dayPart.icon,
      iconNight: nightPart.icon,
      textDay: dayPart.condition,
      textNight: nightPart.condition,
      tempMax,
      tempMin,
      tempAvg: Number.isFinite(tempAvg) ? tempAvg : 0,
      /* v7 昼夜没有独立温度，顶层仍使用接口返回的全天最高/最低 */
      tempMaxText: tempText(tempMax),
      tempMinText: tempText(tempMin),
      tempAvgText: tempText(tempAvg),
      humidityText: dayPart.humidityText,
      precip: num(day.precip, 0),
      precipText: unitText(day.precip, 'mm'),
      popText: pop ? `${pop}%` : '—',
      pressureText: unitText(day.pressure, 'hPa'),
      visibilityText: unitText(day.vis, 'km'),
      cloudText: dayPart.cloudText,
      uvText: uvText(num(day.uvIndex, NaN)),
      windDayText: windDay.text,
      windNightText: windNight.text,
      sunriseText: str(day.sunrise) || '—',
      sunsetText: str(day.sunset) || '—',
      moonriseText: str(day.moonrise) || '—',
      moonsetText: str(day.moonset) || '—',
      moonPhase: str(day.moonPhase) || '—',
      moonIcon: normalizeIconCode(str(day.moonPhaseIcon), false),
      astro: {
        sunrise: str(day.sunrise),
        sunset: str(day.sunset),
        astronomicalDawn: '—',
        nauticalDawn: '—',
        dawn: '—',
        astronomicalDusk: '—',
        nauticalDusk: '—',
        dusk: '—',
        solarNoon: '—',
        solarMidnight: '—',
        moonrise: str(day.moonrise),
        moonset: str(day.moonset),
        moonTransit: '—',
        moonUnderfoot: '—',
        moonPhase: str(day.moonPhase, '—'),
      },
      daytime: dayPart,
      nighttime: nightPart,
      range,
    }
  })
}

/* ---- 逐小时 ---- */

export function parseHourlyV1(raw: unknown, range: QwHourlyRange = 24): QwHourlyView[] {
  const record = obj(raw) || {}
  return list(record.hours).map((item) => {
    const hour = obj(item) || {}
    const condition = obj(hour.condition)
    const wind = windView(hour.wind, false)
    const gust = unitValue(hour.windGust)
    const precip = obj(hour.precipitation)
    const amount = unitValue(precip?.amount)
    const intensity = unitValue(precip?.intensity)
    const pop = num(precip?.probability, NaN)
    const pressure = unitValue(hour.pressure)
    const visibility = unitValue(hour.visibility)
    const dew = unitValue(hour.dewPoint)
    const temp = unitValue(hour.temperature)
    const feels = unitValue(hour.feelsLike)
    return {
      time: str(hour.forecastTime),
      timeText: timeText(hour.forecastTime),
      hourText: hourTextOf(hour.forecastTime),
      icon: normalizeIconCode(str(condition?.code), false),
      condition: str(condition?.text, '—'),
      temp: temp.has ? temp.value : NaN,
      tempText: temp.has ? tempText(temp.value) : '—',
      feelsLikeText: feels.has ? tempText(feels.value) : '—',
      humidityText: humidityText(hour.humidity, true),
      windText: wind.text,
      gustText: gust.has ? `${gust.value} ${gust.unit || 'm/s'}` : '—',
      precip: amount.value,
      precipText: amount.has ? `${amount.value} ${amount.unit || 'mm'}` : '—',
      precipTypeText: precipTypeText(str(precip?.type, 'none')),
      precipIntensityText: intensity.has ? `${intensity.value} ${intensity.unit || 'mm/h'}` : '—',
      pop: Number.isFinite(pop) ? pop * 100 : 0,
      popText: Number.isFinite(pop) ? percentText(pop * 100) : '—',
      pressureText: pressure.has ? `${Math.round(pressure.value)} ${pressure.unit || 'hPa'}` : '—',
      visibilityText: visibility.has ? visibilityText(visibility.value, visibility.unit === 'km' ? 'km' : 'm') : '—',
      dewPointText: dew.has ? tempText(dew.value) : '—',
      cloudText: cloudText(hour.cloudCover, true),
      uvText: uvText(num(hour.uvIndex, NaN)),
      range,
    }
  })
}

export function parseHourlyV7(raw: unknown, range: QwHourlyRange = 24): QwHourlyView[] {
  const record = obj(raw) || {}
  return list(record.hourly).map((item) => {
    const hour = obj(item) || {}
    const wind = windView(
      { windDir: hour.windDir, wind360: hour.wind360, windScale: hour.windScale, windSpeed: hour.windSpeed },
      true,
    )
    const pop = str(hour.pop, '')
    return {
      time: str(hour.fxTime),
      timeText: timeText(hour.fxTime),
      hourText: hourTextOf(hour.fxTime),
      icon: normalizeIconCode(str(hour.icon), false),
      condition: str(hour.text, '—'),
      temp: num(hour.temp, NaN),
      tempText: tempText(num(hour.temp, NaN)),
      feelsLikeText: '—',
      humidityText: humidityText(hour.humidity, false),
      windText: wind.text,
      gustText: '—',
      precip: num(hour.precip, 0),
      precipText: unitText(hour.precip, 'mm'),
      precipTypeText: '—',
      precipIntensityText: '—',
      pop: num(hour.pop, 0),
      popText: pop ? `${pop}%` : '—',
      pressureText: unitText(hour.pressure, 'hPa'),
      visibilityText: unitText(hour.vis, 'km'),
      dewPointText: degreeText(hour.dew),
      cloudText: cloudText(hour.cloud, false),
      uvText: uvText(num(hour.uvIndex, NaN)),
      range,
    }
  })
}

/* ---- 分钟降水 ---- */

export function parseMinutely(raw: unknown): QwMinutelyView {
  const record = obj(raw) || {}
  const points: QwRainPoint[] = list(record.minutely).map((item) => {
    const point = obj(item) || {}
    const precip = num(point.precip, 0)
    return {
      time: str(point.fxTime),
      timeText: timeText(point.fxTime),
      precip,
      type: str(point.type, 'rain'),
      typeText: precipTypeText(str(point.type, 'rain')),
    }
  })
  const maxPrecip = points.reduce((max, point) => Math.max(max, point.precip), 0)
  const totalPrecip = points.reduce((sum, point) => sum + point.precip, 0)
  const hasRain = points.some((point) => point.precip > 0)
  const peakPoint = points.reduce<QwRainPoint | null>(
    (peak, point) => (!peak || point.precip > peak.precip ? point : peak),
    null,
  )
  const peakType = points.find((point) => point.precip > 0)?.typeText || ''
  const empty = !points.length
  return {
    summary: str(record.summary, empty ? '暂无分钟级降水数据' : '未来两小时暂无降水'),
    updateTimeText: timeText(record.updateTime),
    points,
    maxPrecip,
    totalPrecip,
    maxPrecipText: empty ? '—' : `${maxPrecip.toFixed(2)} mm`,
    totalPrecipText: empty ? '—' : `${totalPrecip.toFixed(2)} mm`,
    hasRain,
    peakText: empty ? '—' : maxPrecip > 0 ? `峰值 ${maxPrecip.toFixed(2)} mm / 5 分钟` : '无降水',
    typeText: hasRain ? peakType : empty ? '暂无数据' : '无降水',
    peakTimeText: hasRain && peakPoint ? peakPoint.timeText : '—',
  }
}

/* ---- 空气质量 ---- */

/* 接口文案可能自带「一般人群」/「敏感人群」前缀，视图已用标签展示，避免重复 */
function stripPopulationPrefix(value: string): string {
  return value.replace(/^一般人群[：:]?\s*/, '').replace(/^敏感人群[：:]?\s*/, '')
}

function airHealth(value: unknown): QwAirHealthView {
  const record = obj(value) || {}
  const advice = obj(record.advice) || {}
  return {
    effect: str(record.effect, ''),
    general: stripPopulationPrefix(str(advice.generalPopulation, '')),
    sensitive: stripPopulationPrefix(str(advice.sensitivePopulation, '')),
  }
}

function airIndex(value: unknown): QwAirIndexView | null {
  const record = obj(value)
  if (!record) {
    return null
  }
  const primary = obj(record.primaryPollutant)
  return {
    code: str(record.code),
    name: str(record.name, 'AQI'),
    aqi: num(record.aqi, 0),
    aqiDisplay: str(record.aqiDisplay, '—'),
    level: str(record.level, ''),
    category: str(record.category, ''),
    color: rgba(record.color),
    primaryPollutant: str(primary?.name, '—'),
    health: airHealth(record.health),
  }
}

function pickPrimary(indexes: QwAirIndexView[]): QwAirIndexView | null {
  return (
    indexes.find((index) => index.code === 'cn-mee') ||
    indexes.find((index) => index.code === 'us-epa') ||
    indexes[0] ||
    null
  )
}

function pollutants(value: unknown): QwPollutantView[] {
  return list(value)
    .map((item) => {
      const record = obj(item)
      if (!record) {
        return null
      }
      const concentration = obj(record.concentration) || {}
      const value = nullableNum(concentration.value)
      const subIndexes = list(record.subIndexes)
        .map((sub) => {
          const entry = obj(sub)
          return entry ? `${str(entry.code)} ${str(entry.aqiDisplay)}` : ''
        })
        .filter(Boolean)
      return {
        code: str(record.code),
        name: str(record.name),
        fullName: str(record.fullName),
        value: value === null ? 0 : value,
        valueText: value === null ? '—' : `${value} ${str(concentration.unit, '')}`,
        unit: str(concentration.unit),
        subIndexText: subIndexes.join(' · '),
      }
    })
    .filter((item): item is QwPollutantView => Boolean(item))
}

function airStations(value: unknown): string[] {
  return list(value)
    .map((item) => str(obj(item)?.name))
    .filter(Boolean)
}

export function parseAirCurrent(raw: unknown): QwAirView {
  const record = obj(raw) || {}
  const indexes = list(record.indexes)
    .map(airIndex)
    .filter((item): item is QwAirIndexView => Boolean(item))
  const primary = pickPrimary(indexes)
  return {
    indexes,
    primary,
    pollutants: pollutants(record.pollutants),
    stations: airStations(record.stations),
    stationsText: airStations(record.stations).join(' · '),
    hourly: [],
    daily: [],
    generalAdvice: primary?.health.general || '',
    sensitiveAdvice: primary?.health.sensitive || '',
  }
}

export function parseAirHourly(raw: unknown): QwAirHourView[] {
  const record = obj(raw) || {}
  return list(record.hours)
    .map((item) => {
      const hour = obj(item)
      if (!hour) {
        return null
      }
      const indexes = list(hour.indexes)
        .map(airIndex)
        .filter((entry): entry is QwAirIndexView => Boolean(entry))
      const primary = pickPrimary(indexes)
      if (!primary) {
        return null
      }
      return {
        timeText: timeText(hour.forecastTime),
        hourText: hourTextOf(hour.forecastTime),
        aqi: primary.aqi,
        aqiDisplay: primary.aqiDisplay,
        category: primary.category,
        color: primary.color,
        primaryPollutant: primary.primaryPollutant,
        indexes: [primary, ...indexes.filter((entry) => entry.code !== primary.code)],
        pollutants: pollutants(hour.pollutants),
      }
    })
    .filter((item): item is QwAirHourView => Boolean(item))
}

export function parseAirDaily(raw: unknown, today = todayKey()): QwAirDayView[] {
  const record = obj(raw) || {}
  return list(record.days)
    .map((item) => {
      const day = obj(item)
      if (!day) {
        return null
      }
      const indexes = list(day.indexes)
        .map(airIndex)
        .filter((entry): entry is QwAirIndexView => Boolean(entry))
      const primary = pickPrimary(indexes)
      if (!primary) {
        return null
      }
      const date = dateOnly(day.forecastStartTime)
      return {
        dateText: dateText(date),
        weekText: isToday(date, today) ? '今天' : weekText(date),
        aqi: primary.aqi,
        aqiDisplay: primary.aqiDisplay,
        category: primary.category,
        color: primary.color,
        primaryPollutant: primary.primaryPollutant,
        indexes: [primary, ...indexes.filter((entry) => entry.code !== primary.code)],
        pollutants: pollutants(day.pollutants),
      }
    })
    .filter((item): item is QwAirDayView => Boolean(item))
}

/* ---- 预警 ---- */

export function parseAlerts(raw: unknown): QwAlertView[] {
  const record = obj(raw) || {}
  return list(record.alerts)
    .map((item) => {
      const alert = obj(item)
      if (!alert) {
        return null
      }
      const event = obj(alert.eventType) || {}
      const color = obj(alert.color) || {}
      const message = obj(alert.messageType) || {}
      const colorCode = str(color.code)
      const responseTypes = list(alert.responseTypes)
        .map((entry) => str(obj(entry)?.name) || str(entry))
        .filter(Boolean)
      return {
        id: str(alert.id),
        event: str(event.name, '天气预警'),
        severity: str(alert.severity, 'unknown'),
        severityText: `${severityText(str(alert.severity))}${colorCode ? ` · ${colorText(colorCode)}` : ''}`,
        color: rgba(alert.color),
        headline: str(alert.headline, str(event.name, '天气预警')),
        description: str(alert.description),
        instruction: str(alert.instruction),
        sender: str(alert.senderName),
        issuedText: timeText(alert.issuedTime),
        effectiveText: timeText(alert.effectiveTime),
        expireText: timeText(alert.expireTime),
        icon: str(alert.icon, '1006'),
        urgency: urgencyText(str(alert.urgency)),
        certainty: certaintyText(str(alert.certainty)),
        eventCode: str(event.code),
        messageTypeText: messageTypeText(str(message.code)),
        onsetText: timeText(alert.onsetTime),
        criteria: str(alert.criteria),
        responseTypesText: responseTypes.join(' · '),
      }
    })
    .filter((item): item is QwAlertView => Boolean(item))
}

/* ---- 生活指数 ---- */

export function parseIndices(raw: unknown, today = todayKey()): QwIndicesView[] {
  const record = obj(raw) || {}
  const groups = new Map<string, QwIndicesView['items']>()
  list(record.daily).forEach((item) => {
    const entry = obj(item)
    if (!entry) {
      return
    }
    const date = str(entry.date)
    const items = groups.get(date) || []
    items.push({
      type: str(entry.type),
      name: str(entry.name, '生活指数'),
      level: str(entry.level),
      category: str(entry.category),
      text: str(entry.text),
    })
    groups.set(date, items)
  })
  return Array.from(groups.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, items]) => ({
      date,
      dateText: dateText(date),
      weekText: isToday(date, today) ? '今天' : weekText(date),
      items: items.sort((left, right) => Number(left.type) - Number(right.type)),
    }))
}

/* ---- 天文 ---- */

export function parseSun(raw: unknown): QwSunView {
  const record = obj(raw) || {}
  const sunrise = str(record.sunrise)
  const sunset = str(record.sunset)
  const parts = (value: string): { h: number; m: number } | null => {
    const match = /T(\d{2}):(\d{2})/.exec(value)
    return match ? { h: Number(match[1]), m: Number(match[2]) } : null
  }
  const rise = parts(sunrise)
  const set = parts(sunset)
  const minutes = rise && set ? Math.max(0, set.h * 60 + set.m - (rise.h * 60 + rise.m)) : 0
  return {
    date: dateOnly(sunrise),
    sunrise,
    sunset,
    sunriseText: timeText(sunrise),
    sunsetText: timeText(sunset),
    dayLengthText: minutes ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分` : '—',
  }
}

export function parseMoon(raw: unknown, today = todayKey()): QwMoonView {
  const record = obj(raw) || {}
  const source = list(record.moonPhase)
  const times = source.map((item) => Date.parse(str((obj(item) || {}).fxTime)))
  const all: QwMoonPhasePoint[] = source.map((item) => {
    const point = obj(item) || {}
    const illumination = str(point.illumination, '')
    return {
      timeText: timeText(point.fxTime),
      name: str(point.name, '—'),
      icon: normalizeIconCode(str(point.icon), false),
      illumination: num(point.illumination, 0),
      illuminationText: illumination ? `${illumination}%` : '—',
    }
  })
  /* 官方返回逐小时月相，同一相位会重复 24 次；按相位去重，避免渲染 24 张相同卡片 */
  const phases: QwMoonPhasePoint[] = []
  const seen = new Set<string>()
  all.forEach((point) => {
    const key = `${point.icon}|${point.name}`
    if (!seen.has(key)) {
      seen.add(key)
      phases.push(point)
    }
  })
  /* 用完整时间戳找最接近 updateTime 的月相，跨午夜也不会错位 */
  const updateAt = Date.parse(str(record.updateTime))
  let nearest: QwMoonPhasePoint | null = all[0] || null
  if (Number.isFinite(updateAt)) {
    let best = Number.POSITIVE_INFINITY
    times.forEach((time, index) => {
      if (!Number.isFinite(time)) {
        return
      }
      const distance = Math.abs(time - updateAt)
      if (distance < best) {
        best = distance
        nearest = all[index]
      }
    })
  }
  const current = nearest ? { ...nearest } : null
  if (current) {
    const index = phases.findIndex((point) => point.icon === current.icon && point.name === current.name)
    if (index >= 0) {
      phases[index] = current
    }
  }
  return {
    date: dateOnly(record.moonrise) || today,
    moonriseText: timeText(record.moonrise),
    moonsetText: timeText(record.moonset),
    phases,
    current,
  }
}

export function parseSolar(raw: unknown): QwSolarView {
  const record = obj(raw) || {}
  const solarHour = str(record.solarHour, '')
  const solarHourText = /^\d{3,4}$/.test(solarHour)
    ? `${solarHour.slice(0, -2).padStart(2, '0')}:${solarHour.slice(-2)}`
    : solarHour || '—'
  return {
    elevation: num(record.solarElevationAngle, NaN),
    azimuth: num(record.solarAzimuthAngle, NaN),
    elevationText: degreeText(record.solarElevationAngle),
    azimuthText: degreeText(record.solarAzimuthAngle),
    solarHourText,
    hourAngleText: degreeText(record.hourAngle),
  }
}

/* ---- 时光机 ---- */

function historyDaily(raw: unknown): QwDailyView | null {
  const day = obj(raw)
  if (!day) {
    return null
  }
  const date = str(day.date)
  if (!date) {
    return null
  }
  const emptyPart: QwDailyPartView = {
    icon: '9999',
    condition: '—',
    periodText: '',
    tempMaxText: '—',
    tempMinText: '—',
    windText: '—',
    gustText: '—',
    precipText: '—',
    precipTypeText: '—',
    popText: '—',
    humidityText: '—',
    cloudText: '—',
  }
  const moonPhase = str(day.moonPhase, '—')
  const tempMax = num(day.tempMax, NaN)
  const tempMin = num(day.tempMin, NaN)
  const tempAvg =
    Number.isFinite(tempMax) && Number.isFinite(tempMin) ? (tempMax + tempMin) / 2 : NaN
  return {
    date,
    dateText: dateText(date),
    weekText: weekText(date),
    iconDay: '9999',
    iconNight: '9999',
    textDay: '历史再分析',
    textNight: '历史再分析',
    tempMax,
    tempMin,
    tempAvg: Number.isFinite(tempAvg) ? tempAvg : 0,
    tempMaxText: tempText(tempMax),
    tempMinText: tempText(tempMin),
    tempAvgText: tempText(tempAvg),
    humidityText: humidityText(day.humidity, false),
    precip: num(day.precip, 0),
    precipText: unitText(day.precip, 'mm'),
    popText: '—',
    pressureText: unitText(day.pressure, 'hPa'),
    visibilityText: '—',
    cloudText: '—',
    uvText: '—',
    windDayText: '—',
    windNightText: '—',
    sunriseText: str(day.sunrise, '—'),
    sunsetText: str(day.sunset, '—'),
    moonriseText: str(day.moonrise, '—'),
    moonsetText: str(day.moonset, '—'),
    moonPhase,
    moonIcon: normalizeIconCode(str(day.moonPhaseIcon), false),
    astro: {
      sunrise: str(day.sunrise),
      sunset: str(day.sunset),
      astronomicalDawn: '—',
      nauticalDawn: '—',
      dawn: '—',
      astronomicalDusk: '—',
      nauticalDusk: '—',
      dusk: '—',
      solarNoon: '—',
      solarMidnight: '—',
      moonrise: str(day.moonrise),
      moonset: str(day.moonset),
      moonTransit: '—',
      moonUnderfoot: '—',
      moonPhase,
    },
    daytime: emptyPart,
    nighttime: emptyPart,
    range: 10,
  }
}

function historyHourly(raw: unknown): QwHourlyView[] {
  return list(raw).map((item) => {
    const hour = obj(item) || {}
    const wind = windView(
      { windDir: hour.windDir, wind360: hour.wind360, windScale: hour.windScale, windSpeed: hour.windSpeed },
      true,
    )
    return {
      time: str(hour.time),
      timeText: timeText(hour.time),
      hourText: hourTextOf(hour.time),
      icon: normalizeIconCode(str(hour.icon), false),
      condition: str(hour.text, '—'),
      temp: num(hour.temp, NaN),
      tempText: tempText(num(hour.temp, NaN)),
      feelsLikeText: '—',
      humidityText: humidityText(hour.humidity, false),
      windText: wind.text,
      gustText: '—',
      precip: num(hour.precip, 0),
      precipText: unitText(hour.precip, 'mm'),
      precipTypeText: '—',
      precipIntensityText: '—',
      pop: 0,
      popText: '—',
      pressureText: unitText(hour.pressure, 'hPa'),
      visibilityText: unitText(hour.vis, 'km'),
      dewPointText: degreeText(hour.dew),
      cloudText: cloudText(hour.cloud, false),
      uvText: '—',
      range: 24,
    }
  })
}

export function parseHistory(raw: unknown): QwHistoryView {
  const record = obj(raw) || {}
  const dailyRaw = obj(record.weatherDaily) || {}
  const date = str(dailyRaw.date)
  return {
    date,
    dateText: dateText(date),
    daily: historyDaily(dailyRaw),
    hourly: historyHourly(record.weatherHourly),
  }
}
