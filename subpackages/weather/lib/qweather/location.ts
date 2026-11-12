/* ==========================================================================
   和风天气 · 城市级模糊定位
   - 只申请 scope.userFuzzyLocation，不申请精确位置
   - 隐私授权前置；已拒绝 / 低版本 / 无权限全部交回页面引导
   ========================================================================== */

import { ensurePrivacyAuthorized } from '../../../../core/utils/privacy'

export type QwLocationFailure = 'denied' | 'privacy' | 'unavailable' | 'failed'
export type QwFuzzyPermission = 'granted' | 'denied' | 'unset' | 'unavailable'

export type QwFuzzyResult =
  | { ok: true; lat: number; lon: number }
  | { ok: false; reason: QwLocationFailure }

interface FuzzyApi {
  getFuzzyLocation?: (options: {
    type?: 'wgs84' | 'gcj02'
    success?: (result: { latitude: number; longitude: number }) => void
    fail?: (error: { errMsg?: string }) => void
  }) => void
}

interface SettingApi {
  getSetting?: (options: {
    success?: (result: { authSetting?: Record<string, unknown> }) => void
    fail?: () => void
  }) => void
}

function reasonOf(message: string): QwLocationFailure {
  const text = String(message || '').toLowerCase()
  if (text.includes('privacy')) {
    return 'privacy'
  }
  if (text.includes('deny') || text.includes('auth den') || text.includes('permission') || text.includes('authorize')) {
    return 'denied'
  }
  return 'failed'
}

export async function readFuzzyPermission(): Promise<QwFuzzyPermission> {
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

export async function getFuzzyLocation(): Promise<QwFuzzyResult> {
  const api = wx as unknown as FuzzyApi
  if (typeof api.getFuzzyLocation !== 'function') {
    return { ok: false, reason: 'unavailable' }
  }
  const authorized = await ensurePrivacyAuthorized()
  if (!authorized) {
    return { ok: false, reason: 'privacy' }
  }
  const permission = await readFuzzyPermission()
  if (permission === 'denied') {
    return { ok: false, reason: 'denied' }
  }
  return new Promise((resolve) => {
    try {
      api.getFuzzyLocation?.({
        type: 'gcj02',
        success: (result) => {
          const lat = Number(result.latitude)
          const lon = Number(result.longitude)
          if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
            resolve({ ok: false, reason: 'failed' })
            return
          }
          resolve({ ok: true, lat, lon })
        },
        fail: (error) => resolve({ ok: false, reason: reasonOf(error?.errMsg || '') }),
      })
    } catch {
      resolve({ ok: false, reason: 'failed' })
    }
  })
}

export function openFuzzySetting(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof wx.openSetting !== 'function') {
      resolve(false)
      return
    }
    wx.openSetting({
      success: (result) => {
        const auth = (result.authSetting || {}) as Record<string, unknown>
        resolve(auth['scope.userFuzzyLocation'] === true)
      },
      fail: () => resolve(false),
    })
  })
}
