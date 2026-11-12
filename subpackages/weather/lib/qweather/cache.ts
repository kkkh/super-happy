/* ==========================================================================
   和风天气 · 本地缓存
   - 按官方推荐 TTL；所有缓存跨本地自然日失效，避免 23:00→00:00 的日预报错位
   - 单键 JSON 存储，最多 40 条；按 UTF-8 字节估算体积，写入时清理过期项
   - Geo 搜索结果不落盘，只允许会话内存
   ========================================================================== */

import { readStorage, removeStorage, writeStorage } from '../../../../core/toolbox/storage'
import { dateKeyForOffset } from './date'

const CACHE_KEY = 'qweather:cache:v2'
const LEGACY_CACHE_KEY = 'qweather:cache:v1'
const MAX_ENTRIES = 40
/** 单键存储上限约 1MB；留出余量，避免长小时预报把整包缓存写爆 */
const MAX_BYTES = 650 * 1024

interface CacheEntry {
  at: number
  day: string
  ttl: number
  /** 写入时城市时区；读取时按同一时区判断是否跨日 */
  utcOffset?: string
  data: unknown
}

type CacheStore = Record<string, CacheEntry>

function today(utcOffset?: string): string {
  return dateKeyForOffset(utcOffset, 0)
}

/** JSON 字符串的 UTF-8 字节数（中文按 3 字节计，代理对偏保守），避免中文缓存超出单键上限 */
function utf8Size(value: string): number {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : 3
  }
  return bytes
}

function readStore(): CacheStore {
  const raw = readStorage(CACHE_KEY)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {}
  }
  return raw as CacheStore
}

function valid(entry: CacheEntry | undefined): entry is CacheEntry {
  if (!entry || typeof entry !== 'object') {
    return false
  }
  if (typeof entry.at !== 'number' || typeof entry.ttl !== 'number') {
    return false
  }
  const offset = typeof entry.utcOffset === 'string' ? entry.utcOffset : ''
  if (entry.day !== today(offset)) {
    return false
  }
  return Date.now() - entry.at <= entry.ttl
}

export function readQwCache<T>(key: string): T | null {
  const store = readStore()
  const entry = store[key]
  if (!valid(entry)) {
    return null
  }
  return entry.data as T
}

export function writeQwCache(key: string, data: unknown, ttl: number, utcOffset = ''): void {
  if (!key || ttl <= 0) {
    return
  }
  const store = readStore()
  const nextEntry: CacheEntry = { at: Date.now(), day: today(utcOffset), ttl, utcOffset, data }
  /* 单条就超过上限时不写入，避免撑爆单个 storage key 后静默丢缓存 */
  if (utf8Size(JSON.stringify(nextEntry)) > MAX_BYTES) {
    return
  }
  store[key] = nextEntry
  const now = Date.now()
  const entries = Object.entries(store)
    .filter(([, entry]) => {
      if (!entry || typeof entry.at !== 'number' || typeof entry.ttl !== 'number') {
        return false
      }
      /* 旧 v2 条目可能没有 utcOffset：按设备日兼容，避免升级后整批误删 */
      const offset = typeof entry.utcOffset === 'string' ? entry.utcOffset : ''
      return entry.day === today(offset) && now - entry.at <= entry.ttl
    })
    .sort((left, right) => right[1].at - left[1].at)
    .slice(0, MAX_ENTRIES)
    .map(([entryKey, entry]) => ({ key: entryKey, entry, size: utf8Size(JSON.stringify(entry)) }))

  let total = entries.reduce((sum, item) => sum + item.size, 0)
  while (entries.length > 1 && total > MAX_BYTES) {
    const dropped = entries.pop()
    if (dropped) {
      total -= dropped.size
    }
  }
  writeStorage(
    CACHE_KEY,
    Object.fromEntries(entries.map((item) => [item.key, item.entry])),
  )
}

export function clearQwCache(): void {
  writeStorage(CACHE_KEY, {})
}

/** 清理旧版 v1 缓存键，避免升级后长期残留约 650KB 数据 */
export function clearLegacyQwCache(): void {
  removeStorage(LEGACY_CACHE_KEY)
}

/** 城市切换时清理该城市相关缓存；cacheKey 中包含城市 id / 坐标 */
export function clearQwCacheForCity(cityToken: string): void {
  if (!cityToken) {
    return
  }
  const store = readStore()
  const next: CacheStore = {}
  Object.entries(store).forEach(([key, entry]) => {
    /* 按 `|` 分段精确匹配，避免城市 ID 误伤同前缀的景点缓存 */
    if (!key.split('|').includes(cityToken)) {
      next[key] = entry
    }
  })
  writeStorage(CACHE_KEY, next)
}
