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

/** 原生 / 授权回调缺失时，避免页面永久停在定位中 */
function withTimeout<T>(promise: Promise<T>, fallback: T, ms = 15000): Promise<T> {
  return new Promise((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        resolve(fallback)
      }
    }, ms) as unknown as number
    promise.then(
      (value) => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          resolve(value)
        }
      },
      () => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          resolve(fallback)
        }
      },
    )
  })
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
  const authorized = await withTimeout(ensurePrivacyAuthorized(), false)
  if (!authorized) {
    return { ok: false, reason: 'privacy' }
  }
  const permission = await withTimeout(readFuzzyPermission(), 'unavailable')
  if (permission === 'denied') {
    return { ok: false, reason: 'denied' }
  }
  return new Promise((resolve) => {
    let settled = false
    let timer: number | null = null
    const finish = (result: QwFuzzyResult): void => {
      if (settled) {
        return
      }
      settled = true
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      resolve(result)
    }
    timer = setTimeout(() => finish({ ok: false, reason: 'failed' }), 15000) as unknown as number
    try {
      api.getFuzzyLocation?.({
        type: 'gcj02',
        success: (result) => {
          const lat = Number(result.latitude)
          const lon = Number(result.longitude)
          if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
            finish({ ok: false, reason: 'failed' })
            return
          }
          finish({ ok: true, lat, lon })
        },
        fail: (error) => finish({ ok: false, reason: reasonOf(error?.errMsg || '') }),
      })
    } catch {
      finish({ ok: false, reason: 'failed' })
    }
  })
}

export function openFuzzySetting(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof wx.openSetting !== 'function') {
      resolve(false)
      return
    }
    let settled = false
    let timer: number | null = null
    const finish = (value: boolean): void => {
      if (settled) {
        return
      }
      settled = true
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      resolve(value)
    }
    timer = setTimeout(() => finish(false), 15000) as unknown as number
    try {
      wx.openSetting({
        success: (result) => {
          const auth = (result.authSetting || {}) as Record<string, unknown>
          finish(auth['scope.userFuzzyLocation'] === true)
        },
        fail: () => finish(false),
      })
    } catch {
      finish(false)
    }
  })
}
