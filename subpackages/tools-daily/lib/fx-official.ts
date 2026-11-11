/* ==========================================================================
   官方汇率中间价 · 中国外汇交易中心（CFETS）
   - 只在打开汇率页时请求一次，缓存 6 小时；失败回退最近一次缓存
   - 不发送金额、币种选择或任何用户输入
   - 官方中间价按交易日 9:15 发布，不是逐秒行情
   ========================================================================== */
import { STORAGE_KEYS } from '../../../core/constants/index'
import { parseCfetsRates, type FxOfficialRates } from './fx'

/** 中国外汇交易中心人民币汇率中间价 JSON */
export const FX_OFFICIAL_URL =
  'https://www.chinamoney.com.cn/r/cms/www/chinamoney/data/fx/ccpr.json'

const CACHE_TTL_MS = 6 * 60 * 60 * 1000

export interface FxOfficialResponse {
  rates: FxOfficialRates
  fromCache: boolean
  stale: boolean
}

interface CacheRecord {
  savedAt: number
  rates: FxOfficialRates
}

function readCache(): CacheRecord | null {
  try {
    const raw = wx.getStorageSync(STORAGE_KEYS.fxOfficialRates)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return null
    }
    const record = raw as Record<string, unknown>
    const savedAt = Number(record.savedAt)
    const rates = record.rates
    if (!Number.isFinite(savedAt) || !rates || typeof rates !== 'object') {
      return null
    }
    const parsed = rates as FxOfficialRates
    if (
      typeof parsed.date !== 'string' ||
      typeof parsed.updatedAt !== 'string' ||
      !parsed.rates ||
      typeof parsed.rates !== 'object'
    ) {
      return null
    }
    return { savedAt, rates: parsed }
  } catch {
    return null
  }
}

function writeCache(rates: FxOfficialRates): void {
  try {
    wx.setStorageSync(STORAGE_KEYS.fxOfficialRates, { savedAt: Date.now(), rates })
  } catch {
    /* 存储不可用时只保留本次内存结果 */
  }
}

function requestOfficialRates(): Promise<FxOfficialRates> {
  return new Promise((resolve, reject) => {
    try {
      wx.request({
        url: FX_OFFICIAL_URL,
        method: 'GET',
        timeout: 8000,
        header: { 'Content-Type': 'application/json' },
        success: (result) => {
          if (result.statusCode !== 200) {
            reject(new Error('官方中间价服务暂不可用'))
            return
          }
          let payload: unknown = result.data
          if (typeof payload === 'string') {
            try {
              payload = JSON.parse(payload)
            } catch {
              reject(new Error('官方中间价格式异常'))
              return
            }
          }
          const parsed = parseCfetsRates(payload)
          if (!parsed) {
            reject(new Error('官方中间价格式异常'))
            return
          }
          resolve(parsed)
        },
        fail: (error) => {
          reject(new Error(error.errMsg || '网络请求失败'))
        },
      })
    } catch {
      reject(new Error('网络请求失败'))
    }
  })
}

/**
 * 获取官方中间价：优先 6 小时内缓存；强制刷新失败时回退旧缓存并标记 stale。
 */
export async function fetchOfficialRates(force = false): Promise<FxOfficialResponse> {
  const cached = readCache()
  if (!force && cached && Date.now() - cached.savedAt < CACHE_TTL_MS) {
    return { rates: cached.rates, fromCache: true, stale: false }
  }
  try {
    const rates = await requestOfficialRates()
    writeCache(rates)
    return { rates, fromCache: false, stale: false }
  } catch (error) {
    if (cached) {
      return { rates: cached.rates, fromCache: true, stale: true }
    }
    throw error
  }
}
