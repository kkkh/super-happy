/* ==========================================================================
   和风天气 · 端点与 URL 构造
   - 覆盖已开通 8 组 API 的全部端点（含 v1 / v7）
   - 所有查询参数统一 URL 编码；坐标最多两位小数
   - cacheable/TTL 遵循官方最佳实践；Geo 只允许会话内使用
   ========================================================================== */

import { dateKeyForOffset } from './date'

export type QwEndpointGroup =
  | 'GeoAPI'
  | '天气预报'
  | '分钟预报'
  | '预警'
  | '天气指数'
  | '空气质量'
  | '时光机'
  | '天文'

export interface QwRequestSpec {
  key: string
  label: string
  group: QwEndpointGroup
  description: string
  path: string
  cacheable: boolean
  ttlMs: number
  cacheKey: string
}

export interface QwCityLike {
  id?: string
  parentId?: string
  name?: string
  adm2?: string
  utcOffset?: string
  source?: string
  lat: number
  lon: number
}

const HOUR = 60 * 60 * 1000

export const QW_TTL = {
  now: 10 * 60 * 1000,
  hourly: 30 * 60 * 1000,
  daily: 2 * HOUR,
  warning: 10 * 60 * 1000,
  indices: 6 * HOUR,
  minutely: 5 * 60 * 1000,
  airNow: 30 * 60 * 1000,
  airHourly: HOUR,
  airDaily: 8 * HOUR,
  astronomy: 6 * HOUR,
  history: 24 * HOUR,
} as const

function encode(value: string): string {
  return encodeURIComponent(value)
}

function number2(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error('坐标不是有效数字')
  }
  return String(Math.round(value * 100) / 100)
}

export function lngLat(lat: number, lon: number): string {
  return `${number2(lon)},${number2(lat)}`
}

export function latLonPath(lat: number, lon: number): string {
  return `${number2(lat)}/${number2(lon)}`
}

/** 和风天气 date 参数统一为 yyyyMMdd；页面传入 yyyy-MM-dd 也能兼容 */
function dateParam(value: string): string {
  return String(value || '').replace(/-/g, '')
}

function query(params: Record<string, string | number | boolean | undefined>): string {
  const parts: string[] = []
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === '') {
      return
    }
    parts.push(`${encode(key)}=${encode(String(value))}`)
  })
  return parts.length ? `?${parts.join('&')}` : ''
}

function cityKey(city: QwCityLike): string {
  return city.id || lngLat(city.lat, city.lon)
}

/**
 * 天气类接口的 location 参数：
 * - 城市 / 模糊定位用 LocationID；
 * - 景点 POI 的 LocationID 不被天气接口接受，必须退回经纬度。
 */
function locationOf(city: QwCityLike): string {
  if (city.id && city.source !== 'poi') {
    return city.id
  }
  return lngLat(city.lat, city.lon)
}

/**
 * 时光机接口只接受城市 LocationID：
 * 景点 POI 的 ID 与经纬度都会被拒绝，必须使用选中景点时解析出的所属城市 ID。
 */
function historyLocationOf(city: QwCityLike): string {
  if (city.source === 'poi' && city.parentId) {
    return city.parentId
  }
  return locationOf(city)
}

export function geoCityLookup(input: {
  location: string
  adm?: string
  range?: string
  number?: number
  lang?: string
}): QwRequestSpec {
  const path = `/geo/v2/city/lookup${query({
    location: input.location,
    adm: input.adm,
    range: input.range,
    number: input.number || 10,
    lang: input.lang || 'zh',
  })}`
  return {
    key: 'geo-city-lookup',
    label: '城市搜索',
    group: 'GeoAPI',
    description: '名称 / LocationID / 经纬度反查',
    path,
    cacheable: false,
    ttlMs: 0,
    cacheKey: `geo|city|${input.location}|${input.adm || ''}|${input.range || ''}|${input.number || 10}|${input.lang || 'zh'}`,
  }
}

export function geoTopCity(input: { range?: string; number?: number; lang?: string } = {}): QwRequestSpec {
  const path = `/geo/v2/city/top${query({
    range: input.range || 'cn',
    number: input.number || 10,
    lang: input.lang || 'zh',
  })}`
  return {
    key: 'geo-top-city',
    label: '热门城市',
    group: 'GeoAPI',
    description: '全球 / 指定国家热门城市',
    path,
    cacheable: false,
    ttlMs: 0,
    cacheKey: `geo|top|${input.range || 'cn'}|${input.number || 10}|${input.lang || 'zh'}`,
  }
}

export function geoPoiLookup(input: {
  location: string
  city?: string
  type?: 'scenic' | 'TSTA'
  number?: number
  lang?: string
}): QwRequestSpec {
  const path = `/geo/v2/poi/lookup${query({
    location: input.location,
    city: input.city,
    type: input.type || 'scenic',
    number: input.number || 10,
    lang: input.lang || 'zh',
  })}`
  return {
    key: 'geo-poi-lookup',
    label: 'POI 搜索',
    group: 'GeoAPI',
    description: '景点 / 潮汐站点搜索',
    path,
    cacheable: false,
    ttlMs: 0,
    cacheKey: `geo|poi|${input.location}|${input.city || ''}|${input.type || 'scenic'}|${input.number || 10}|${input.lang || 'zh'}`,
  }
}

export function geoPoiRange(input: {
  lat: number
  lon: number
  radius?: number
  type?: 'scenic' | 'TSTA'
  number?: number
  lang?: string
}): QwRequestSpec {
  const path = `/geo/v2/poi/range${query({
    location: lngLat(input.lat, input.lon),
    radius: input.radius || 10,
    type: input.type || 'scenic',
    number: input.number || 10,
    lang: input.lang || 'zh',
  })}`
  return {
    key: 'geo-poi-range',
    label: 'POI 范围',
    group: 'GeoAPI',
    description: '指定半径内全部兴趣点',
    path,
    cacheable: false,
    ttlMs: 0,
    cacheKey: `geo|range|${lngLat(input.lat, input.lon)}|${input.type || 'scenic'}|${input.radius || 10}|${input.number || 10}|${input.lang || 'zh'}`,
  }
}

export function weatherCurrent(city: QwCityLike): QwRequestSpec {
  const path = `/weather/v1/current/${latLonPath(city.lat, city.lon)}${query({
    localTime: true,
    lang: 'zh',
  })}`
  return {
    key: 'weather-current-v1',
    label: '实时天气 v1',
    group: '天气预报',
    description: '温度 / 体感 / 风 / 降水 / 气压 / 能见度 / 露点 / 云量 / UV',
    path,
    cacheable: true,
    ttlMs: QW_TTL.now,
    cacheKey: `weather|current|${cityKey(city)}`,
  }
}

export function weatherDailyV1(city: QwCityLike, days = 10): QwRequestSpec {
  const safeDays = Math.max(1, Math.min(10, Math.floor(days)))
  const path = `/weather/v1/daily/${latLonPath(city.lat, city.lon)}${query({
    days: safeDays,
    localTime: true,
    lang: 'zh',
  })}`
  return {
    key: `weather-daily-v1-${safeDays}`,
    label: `每日预报 v1 · ${safeDays} 天`,
    group: '天气预报',
    description: '昼 / 夜详情 / 天文 / 月相 / 温度均值',
    path,
    cacheable: true,
    ttlMs: QW_TTL.daily,
    cacheKey: `weather|daily|${cityKey(city)}|${safeDays}`,
  }
}

export function weatherHourlyV1(city: QwCityLike, hours = 24): QwRequestSpec {
  const safeHours = Math.max(1, Math.min(240, Math.floor(hours)))
  const path = `/weather/v1/hourly/${latLonPath(city.lat, city.lon)}${query({
    hours: safeHours,
    localTime: true,
    lang: 'zh',
  })}`
  return {
    key: `weather-hourly-v1-${safeHours}`,
    label: `小时预报 v1 · ${safeHours} 小时`,
    group: '天气预报',
    description: '逐小时温度 / 体感 / 风 / 降水 / UV',
    path,
    cacheable: true,
    ttlMs: QW_TTL.hourly,
    cacheKey: `weather|hourly|${cityKey(city)}|${safeHours}`,
  }
}

export function weatherNowV7(city: QwCityLike): QwRequestSpec {
  const path = `/v7/weather/now${query({
    location: locationOf(city),
    lang: 'zh',
  })}`
  return {
    key: 'weather-now-v7',
    label: '城市实时 v7',
    group: '天气预报',
    description: '昼夜图标 / 基础实况 / 对照',
    path,
    cacheable: true,
    ttlMs: QW_TTL.now,
    cacheKey: `weather|now-v7|${cityKey(city)}`,
  }
}

const DAILY_V7_RANGES = [3, 7, 10, 15, 30] as const

export function weatherDailyV7(city: QwCityLike, days: (typeof DAILY_V7_RANGES)[number]): QwRequestSpec {
  const path = `/v7/weather/${days}d${query({
    location: locationOf(city),
    lang: 'zh',
  })}`
  return {
    key: `weather-daily-v7-${days}d`,
    label: `城市每日 v7 · ${days} 天`,
    group: '天气预报',
    description: '3 / 7 / 10 / 15 / 30 天城市预报',
    path,
    cacheable: true,
    ttlMs: QW_TTL.daily,
    cacheKey: `weather|daily-v7|${cityKey(city)}|${days}`,
  }
}

const HOURLY_V7_RANGES = [24, 72, 168] as const

export function weatherHourlyV7(city: QwCityLike, hours: (typeof HOURLY_V7_RANGES)[number]): QwRequestSpec {
  const path = `/v7/weather/${hours}h${query({
    location: locationOf(city),
    lang: 'zh',
  })}`
  return {
    key: `weather-hourly-v7-${hours}h`,
    label: `城市小时 v7 · ${hours} 小时`,
    group: '天气预报',
    description: '24 / 72 / 168 小时城市预报',
    path,
    cacheable: true,
    ttlMs: QW_TTL.hourly,
    cacheKey: `weather|hourly-v7|${cityKey(city)}|${hours}`,
  }
}

export function minutely(city: QwCityLike): QwRequestSpec {
  const path = `/v7/minutely/5m${query({
    location: lngLat(city.lat, city.lon),
    lang: 'zh',
  })}`
  return {
    key: 'minutely',
    label: '分钟级降水',
    group: '分钟预报',
    description: '未来 2 小时 · 每 5 分钟',
    path,
    cacheable: true,
    ttlMs: QW_TTL.minutely,
    cacheKey: `minutely|${cityKey(city)}`,
  }
}

export function airCurrent(city: QwCityLike): QwRequestSpec {
  const path = `/airquality/v1/current/${latLonPath(city.lat, city.lon)}${query({
    localTime: true,
    lang: 'zh',
  })}`
  return {
    key: 'air-current',
    label: '实时空气质量',
    group: '空气质量',
    description: 'AQI / 污染物 / 健康建议',
    path,
    cacheable: true,
    ttlMs: QW_TTL.airNow,
    cacheKey: `air|current|${cityKey(city)}`,
  }
}

export function airHourly(city: QwCityLike): QwRequestSpec {
  const path = `/airquality/v1/hourly/${latLonPath(city.lat, city.lon)}${query({
    localTime: true,
    lang: 'zh',
  })}`
  return {
    key: 'air-hourly',
    label: '空气质量小时',
    group: '空气质量',
    description: '未来 24 小时 AQI',
    path,
    cacheable: true,
    ttlMs: QW_TTL.airHourly,
    cacheKey: `air|hourly|${cityKey(city)}`,
  }
}

export function airDaily(city: QwCityLike): QwRequestSpec {
  const path = `/airquality/v1/daily/${latLonPath(city.lat, city.lon)}${query({
    localTime: true,
    lang: 'zh',
  })}`
  return {
    key: 'air-daily',
    label: '空气质量每日',
    group: '空气质量',
    description: '未来 3 天 AQI',
    path,
    cacheable: true,
    ttlMs: QW_TTL.airDaily,
    cacheKey: `air|daily|${cityKey(city)}`,
  }
}

export function history(city: QwCityLike, date: string): QwRequestSpec {
  const day = dateParam(date)
  const path = `/v7/historical/weather${query({
    location: historyLocationOf(city),
    date: day,
    lang: 'zh',
    unit: 'm',
  })}`
  return {
    key: 'history',
    label: '天气时光机',
    group: '时光机',
    description: '最近 10 天历史再分析',
    path,
    cacheable: true,
    ttlMs: QW_TTL.history,
    cacheKey: `history|${cityKey(city)}|${day}`,
  }
}

export function weatherAlert(city: QwCityLike): QwRequestSpec {
  const path = `/weatheralert/v1/current/${latLonPath(city.lat, city.lon)}${query({
    localTime: true,
    lang: 'zh',
  })}`
  return {
    key: 'alert',
    label: '实时天气预警',
    group: '预警',
    description: '全球官方预警 / 详情 / 防御指南',
    path,
    cacheable: true,
    ttlMs: QW_TTL.warning,
    cacheKey: `alert|${cityKey(city)}`,
  }
}

export function indices(city: QwCityLike, days: 1 | 3): QwRequestSpec {
  const path = `/v7/indices/${days}d${query({
    type: 0,
    location: locationOf(city),
    lang: 'zh',
  })}`
  return {
    key: `indices-${days}d`,
    label: `天气指数 · ${days} 天`,
    group: '天气指数',
    description: '全部 16 类生活指数',
    path,
    cacheable: true,
    ttlMs: QW_TTL.indices,
    cacheKey: `indices|${cityKey(city)}|${days}`,
  }
}

export function astronomySun(city: QwCityLike, date: string): QwRequestSpec {
  const day = dateParam(date)
  const path = `/v7/astronomy/sun${query({
    location: locationOf(city),
    date: day,
    lang: 'zh',
  })}`
  return {
    key: 'astronomy-sun',
    label: '日出日落',
    group: '天文',
    description: '未来 60 天日出日落',
    path,
    cacheable: true,
    ttlMs: QW_TTL.astronomy,
    cacheKey: `astro|sun|${cityKey(city)}|${day}`,
  }
}

export function astronomyMoon(city: QwCityLike, date: string): QwRequestSpec {
  const day = dateParam(date)
  const path = `/v7/astronomy/moon${query({
    location: locationOf(city),
    date: day,
    lang: 'zh',
  })}`
  return {
    key: 'astronomy-moon',
    label: '月升月落 / 月相',
    group: '天文',
    description: '未来 60 天月相与月升月落',
    path,
    cacheable: true,
    ttlMs: QW_TTL.astronomy,
    cacheKey: `astro|moon|${cityKey(city)}|${day}`,
  }
}

export function astronomySolar(input: {
  city: QwCityLike
  date: string
  time: string
  tz: string
  alt: number
}): QwRequestSpec {
  const day = dateParam(input.date)
  const path = `/v7/astronomy/solar-elevation-angle${query({
    location: lngLat(input.city.lat, input.city.lon),
    date: day,
    time: input.time,
    tz: input.tz,
    alt: Math.max(-500, Math.round(input.alt)),
  })}`
  return {
    key: 'astronomy-solar',
    label: '太阳高度角',
    group: '天文',
    description: '指定时间的高度角 / 方位角',
    path,
    cacheable: true,
    ttlMs: QW_TTL.astronomy,
    cacheKey: `astro|solar|${cityKey(input.city)}|${day}|${input.time}|${input.tz}|${Math.round(input.alt)}`,
  }
}

/** API 覆盖抽屉使用的完整目录（含所有 v7 范围变体） */
export function endpointCatalog(city: QwCityLike, historyDate: string): QwRequestSpec[] {
  /* 历史只能查过去 10 天，天文只能查今天及未来 60 天，两者日期基准不同 */
  const astroDate = dateKeyForOffset(city.utcOffset).replace(/-/g, '')
  const list: QwRequestSpec[] = [
    geoCityLookup({ location: city.adm2 || city.name || '北京' }),
    geoTopCity({ range: 'cn' }),
    geoPoiLookup({ location: city.name || '北京' }),
    geoPoiRange({ lat: city.lat, lon: city.lon }),
    weatherCurrent(city),
    weatherDailyV1(city, 10),
    weatherHourlyV1(city, 24),
    weatherNowV7(city),
  ]
  DAILY_V7_RANGES.forEach((days) => list.push(weatherDailyV7(city, days)))
  HOURLY_V7_RANGES.forEach((hours) => list.push(weatherHourlyV7(city, hours)))
  list.push(
    minutely(city),
    airCurrent(city),
    airHourly(city),
    airDaily(city),
    history(city, historyDate),
    weatherAlert(city),
    indices(city, 1),
    indices(city, 3),
    astronomySun(city, astroDate),
    astronomyMoon(city, astroDate),
    astronomySolar({
      city,
      date: astroDate,
      time: '1200',
      tz: (city.utcOffset || '+08:00').replace(':', '').replace('+', ''),
      alt: 0,
    }),
  )
  return list
}
