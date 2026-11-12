/* ==========================================================================
   和风天气 · 城市与 GeoAPI
   - 用户主动保存的城市最多 5 个，持久化 qweather:cities:v1
   - Geo 搜索结果只做会话内存缓存，不批量落盘（遵守官方许可限制）
   - 城市 / 景点 / 热门 / 坐标反查全部走 GeoAPI v2
   ========================================================================== */

import { readStorage, writeStorage } from '../../../../core/toolbox/storage'
import { requestQWeather } from './client'
import {
  geoCityLookup,
  geoPoiLookup,
  geoPoiRange,
  geoTopCity,
  lngLat,
} from './endpoints'
import type { QwCity, QwCitySource, QwGeoItem } from './types'

const CITIES_KEY = 'qweather:cities:v1'
const CURRENT_KEY = 'qweather:current:v1'
export const MAX_QW_CITIES = 5

const memoryGeo = new Map<string, QwGeoItem[]>()

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function num(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function geoItem(raw: unknown, source: QwCitySource): QwGeoItem | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const record = raw as Record<string, unknown>
  const name = text(record.name)
  if (!name) {
    return null
  }
  const lat = num(record.lat, NaN)
  const lon = num(record.lon, NaN)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null
  }
  return {
    id: text(record.id),
    name,
    adm1: text(record.adm1),
    adm2: text(record.adm2),
    country: text(record.country),
    lat,
    lon,
    tz: text(record.tz, 'Asia/Shanghai'),
    utcOffset: text(record.utcOffset, '+08:00'),
    type: text(record.type, 'city'),
    rank: num(record.rank, 0),
    fxLink: text(record.fxLink),
    source,
  }
}

function parseList(raw: unknown, key: string, source: QwCitySource): QwGeoItem[] {
  if (!raw || typeof raw !== 'object') {
    return []
  }
  const record = raw as Record<string, unknown>
  const list = record[key]
  if (!Array.isArray(list)) {
    return []
  }
  return list.map((item) => geoItem(item, source)).filter((item): item is QwGeoItem => Boolean(item))
}

async function geoRequest(
  spec: ReturnType<typeof geoCityLookup>,
  key: string,
  source: QwCitySource,
): Promise<QwGeoItem[]> {
  if (!spec.cacheable) {
    const cached = memoryGeo.get(spec.cacheKey)
    if (cached) {
      return cached
    }
  }
  const raw = await requestQWeather<unknown>(spec).promise
  const list = parseList(raw, key, source)
  memoryGeo.set(spec.cacheKey, list)
  /* Geo 结果只在会话内使用；限制条数，避免连续搜索导致内存增长 */
  if (memoryGeo.size > 30) {
    const oldest = memoryGeo.keys().next().value
    if (oldest) {
      memoryGeo.delete(oldest)
    }
  }
  return list
}

export function cityToQw(item: QwGeoItem): QwCity {
  return {
    id: item.id,
    name: item.name,
    adm1: item.adm1,
    adm2: item.adm2,
    country: item.country,
    lat: item.lat,
    lon: item.lon,
    tz: item.tz,
    utcOffset: item.utcOffset,
    source: item.source,
  }
}

export function cityToken(city: QwCity): string {
  return city.id || lngLat(city.lat, city.lon)
}

export function readQwCities(): QwCity[] {
  const raw = readStorage(CITIES_KEY)
  if (!Array.isArray(raw)) {
    return []
  }
  const list: QwCity[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const record = item as Record<string, unknown>
    const name = text(record.name)
    const lat = num(record.lat, NaN)
    const lon = num(record.lon, NaN)
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      continue
    }
    const source = text(record.source)
    list.push({
      id: text(record.id),
      parentId: text(record.parentId),
      name,
      adm1: text(record.adm1),
      adm2: text(record.adm2),
      country: text(record.country),
      lat,
      lon,
      tz: text(record.tz, 'Asia/Shanghai'),
      utcOffset: text(record.utcOffset, '+08:00'),
      source:
        source === 'fuzzy' || source === 'manual' || source === 'top' || source === 'poi'
          ? source
          : 'manual',
    })
    if (list.length >= MAX_QW_CITIES) {
      break
    }
  }
  return list
}

export function writeQwCities(cities: QwCity[]): QwCity[] {
  const next = cities.slice(0, MAX_QW_CITIES)
  writeStorage(CITIES_KEY, next)
  return next
}

export function readCurrentQwCity(): QwCity | null {
  const id = readStorage(CURRENT_KEY)
  const cities = readQwCities()
  if (!cities.length) {
    return null
  }
  if (typeof id === 'string' && id) {
    const found = cities.find((city) => cityToken(city) === id)
    if (found) {
      return found
    }
  }
  return cities[0]
}

export function writeCurrentQwCity(city: QwCity): QwCity {
  writeStorage(CURRENT_KEY, cityToken(city))
  return city
}

export function upsertQwCity(city: QwCity): QwCity[] {
  const cities = readQwCities()
  const token = cityToken(city)
  const index = cities.findIndex((item) => cityToken(item) === token)
  if (index >= 0) {
    cities[index] = city
  } else {
    cities.unshift(city)
  }
  const next = writeQwCities(cities)
  writeCurrentQwCity(city)
  return next
}

export function removeQwCity(city: QwCity): QwCity[] {
  const token = cityToken(city)
  const currentId = readStorage(CURRENT_KEY)
  const next = writeQwCities(readQwCities().filter((item) => cityToken(item) !== token))
  if (!next.length) {
    writeStorage(CURRENT_KEY, '')
  } else if (
    typeof currentId === 'string' &&
    currentId &&
    !next.some((item) => cityToken(item) === currentId)
  ) {
    writeCurrentQwCity(next[0])
  }
  return next
}

export async function searchCities(keyword: string, number = 10): Promise<QwGeoItem[]> {
  const value = keyword.trim()
  if (!value) {
    return []
  }
  return geoRequest(geoCityLookup({ location: value, number, lang: 'zh' }), 'location', 'manual')
}

export async function topCities(number = 10): Promise<QwGeoItem[]> {
  return geoRequest(geoTopCity({ range: 'cn', number, lang: 'zh' }), 'topCityList', 'top')
}

export async function searchScenic(keyword: string, cityId = '', number = 10): Promise<QwGeoItem[]> {
  const value = keyword.trim()
  if (!value) {
    return []
  }
  return geoRequest(
    geoPoiLookup({ location: value, city: cityId || undefined, type: 'scenic', number, lang: 'zh' }),
    'poi',
    'poi',
  )
}

export async function nearbyScenic(lat: number, lon: number, radius = 10): Promise<QwGeoItem[]> {
  return geoRequest(geoPoiRange({ lat, lon, radius, type: 'scenic', number: 10, lang: 'zh' }), 'poi', 'poi')
}

export async function cityFromPoint(lat: number, lon: number): Promise<QwCity | null> {
  const list = await geoRequest(
    geoCityLookup({ location: lngLat(lat, lon), number: 1, lang: 'zh' }),
    'location',
    'fuzzy',
  )
  return list.length ? cityToQw(list[0]) : null
}
