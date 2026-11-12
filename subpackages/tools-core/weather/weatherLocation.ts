/* ==========================================================================
   weather/weatherLocation · 模糊定位 → 逆地理 → IP → 手动搜索
   - 只申请 getFuzzyLocation（城市级），不申请精确 getLocation
   - 隐私授权前置；拒绝、低版本、IPv6/局域网全部优雅降级
   ========================================================================== */
import { ensurePrivacyAuthorized } from '../../../core/utils/privacy'
import type { CityCandidate, GeoPoint, RegeoResult, SavedCity } from './types'
import type { WeatherService } from './weatherService'
import type { IpLocationResult } from './weatherParse'

export type LocationFailureReason = 'denied' | 'privacy' | 'unavailable' | 'failed'

export type FuzzyLocationResult =
  | { ok: true; point: GeoPoint }
  | { ok: false; reason: LocationFailureReason }

export type FuzzyPermissionStatus = 'granted' | 'denied' | 'unset' | 'unavailable'

export type LocateCityResult =
  | { ok: true; city: SavedCity }
  | { ok: false; reason: LocationFailureReason }

interface SettingApi {
  getSetting?: (options: {
    success?: (result: { authSetting?: Record<string, unknown> }) => void
    fail?: () => void
  }) => void
}

/** 读取城市级模糊定位授权状态；getSetting 不可用时交给 getFuzzyLocation 自行尝试 */
export async function readFuzzyLocationPermission(): Promise<FuzzyPermissionStatus> {
  const api = wx as unknown as SettingApi
  if (typeof api.getSetting !== 'function') {
    return 'unavailable'
  }
  return new Promise((resolve) => {
    try {
      api.getSetting?.({
        success: (result) => {
          const auth = (result && result.authSetting) || {}
          const value = auth['scope.userFuzzyLocation']
          resolve(value === true ? 'granted' : value === false ? 'denied' : 'unset')
        },
        fail: () => resolve('unavailable'),
      })
    } catch {
      resolve('unavailable')
    }
  })
}

interface FuzzyLocationApi {
  getFuzzyLocation?: (options: {
    type?: 'wgs84' | 'gcj02'
    success?: (result: { latitude: number; longitude: number }) => void
    fail?: (error: { errMsg?: string }) => void
  }) => void
}

function fuzzyReason(message: string): LocationFailureReason {
  const text = String(message || '').toLowerCase()
  if (text.includes('privacy')) {
    return 'privacy'
  }
  if (
    text.includes('deny') ||
    text.includes('auth den') ||
    text.includes('authorize') ||
    text.includes('permission')
  ) {
    return 'denied'
  }
  return 'failed'
}

function normalizePoint(latitude: number, longitude: number): GeoPoint | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return null
  }
  return { lng: longitude, lat: latitude }
}

/** 城市级模糊定位：足够天气使用，隐私与审核摩擦更低 */
export async function getFuzzyLocation(): Promise<FuzzyLocationResult> {
  const api = wx as unknown as FuzzyLocationApi
  if (typeof api.getFuzzyLocation !== 'function') {
    return { ok: false, reason: 'unavailable' }
  }
  const authorized = await ensurePrivacyAuthorized()
  if (!authorized) {
    return { ok: false, reason: 'privacy' }
  }
  /* 已明确拒绝时微信不会再弹窗，提前返回，由页面给出“去设置 / 手动选城”引导 */
  const permission = await readFuzzyLocationPermission()
  if (permission === 'denied') {
    return { ok: false, reason: 'denied' }
  }
  return new Promise((resolve) => {
    try {
      api.getFuzzyLocation?.({
        type: 'gcj02',
        success: (result) => {
          const point = normalizePoint(result.latitude, result.longitude)
          resolve(point ? { ok: true, point } : { ok: false, reason: 'failed' })
        },
        fail: (error) => {
          resolve({ ok: false, reason: fuzzyReason(error?.errMsg || '') })
        },
      })
    } catch {
      resolve({ ok: false, reason: 'failed' })
    }
  })
}

export function regeoToCity(
  result: RegeoResult,
  point: GeoPoint | undefined,
  now: number,
): SavedCity {
  const city = result.city || result.province
  return {
    adcode: result.adcode,
    name: result.district || city || '当前位置',
    province: result.province,
    city,
    source: 'fuzzy',
    ...(point ? { center: point } : {}),
    updatedAt: now,
  }
}

export function ipToCity(result: IpLocationResult, now: number): SavedCity {
  return {
    adcode: result.adcode,
    name: result.city,
    province: result.province,
    city: result.city,
    source: 'ip',
    ...(result.center ? { center: result.center } : {}),
    updatedAt: now,
  }
}

export function candidateToCity(
  candidate: CityCandidate,
  source: 'manual',
  now: number,
): SavedCity {
  return {
    adcode: candidate.adcode,
    name: candidate.name,
    province: candidate.province,
    city: candidate.city || candidate.name,
    source,
    ...(candidate.center ? { center: candidate.center } : {}),
    updatedAt: now,
  }
}

/** 定位 + 逆地理：返回失败原因，由调用方决定降级到 IP 还是引导授权 */
export async function locateCity(
  service: WeatherService,
  now: number,
): Promise<LocateCityResult> {
  const located = await getFuzzyLocation()
  if (!located.ok) {
    return { ok: false, reason: located.reason }
  }
  try {
    const result = await service.fetchRegeo(located.point.lng, located.point.lat).promise
    return { ok: true, city: regeoToCity(result, located.point, now) }
  } catch {
    return { ok: false, reason: 'failed' }
  }
}

/** IP 兜底：局域网、空 city、IPv6-only、国外 IP 全部返回 null */
export async function locateByIp(
  service: WeatherService,
  now: number,
): Promise<SavedCity | null> {
  try {
    const result = await service.fetchIpLocation().promise
    return ipToCity(result, now)
  } catch {
    return null
  }
}
