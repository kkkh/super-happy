/* ==========================================================================
   本地数据版本迁移 · 纯离线场景的防白屏层
   - 启动时先于 Store 初始化执行；任何一步失败都静默跳过，不阻塞业务
   - 当前 v0 → v1：兼容旧 JSON 字符串、清洗非法 id、去掉废弃键、限制条数
   - 未来结构变更：新增 if (version < N) 分支，最后统一写 CURRENT_VERSION
   ========================================================================== */
import { DIAGNOSTICS, STORAGE_KEYS } from '../constants/index'
import { TBX_KEYS } from '../toolbox/storage'

const STORAGE_SCHEMA_KEY = 'app:storage.version'
const STORAGE_SCHEMA_VERSION = 1

function readVersion(): number {
  try {
    const raw = wx.getStorageSync(STORAGE_SCHEMA_KEY) as unknown
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0
  } catch {
    return 0
  }
}

function writeVersion(version: number): void {
  try {
    wx.setStorageSync(STORAGE_SCHEMA_KEY, version)
  } catch {
    // 存储不可用时下次启动继续尝试迁移
  }
}

/** 只接受短字符串 id；trim、去重、限长 */
function sanitizeIds(raw: unknown, limit: number): string[] {
  if (!Array.isArray(raw)) {
    return []
  }
  const unique: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'string') {
      continue
    }
    const id = item.trim()
    if (!id || id.length > 64 || seen.has(id)) {
      continue
    }
    seen.add(id)
    unique.push(id)
    if (unique.length >= limit) {
      break
    }
  }
  return unique
}

/** 兼容旧版本写入的 JSON 字符串，统一迁移为数组 */
function migrateIdList(key: string, limit: number): void {
  try {
    const raw = wx.getStorageSync(key) as unknown
    if (typeof raw === 'string') {
      /* 合法收藏串远小于 64KB；超长脏串直接清空，避免启动时 JSON.parse 卡顿 */
      if (raw.length > 65536) {
        wx.setStorageSync(key, [])
        return
      }
      let parsed: unknown = []
      try {
        parsed = JSON.parse(raw)
      } catch {
        parsed = []
      }
      wx.setStorageSync(key, sanitizeIds(parsed, limit))
      return
    }
    if (Array.isArray(raw)) {
      wx.setStorageSync(key, sanitizeIds(raw, limit))
    }
  } catch {
    // 单个键失败不影响其它键
  }
}

function removeKey(key: string): void {
  try {
    wx.removeStorageSync(key)
  } catch {
    // 忽略删除失败
  }
}

export function runStorageMigrations(): void {
  const version = readVersion()
  if (version >= STORAGE_SCHEMA_VERSION) {
    return
  }

  if (version < 1) {
    /* v0 → v1：清洗收藏/最近使用，兼容旧 JSON 字符串；移除已下线的偏好键 */
    migrateIdList(STORAGE_KEYS.favorites, 200)
    migrateIdList(TBX_KEYS.favorites, 100)
    migrateIdList(TBX_KEYS.recent, 12)

    removeKey(TBX_KEYS.prefs)
    removeKey(TBX_KEYS.ackFinance)
    removeKey(TBX_KEYS.ackHealth)
    removeKey(TBX_KEYS.legacyTip)

    try {
      const raw = wx.getStorageSync(DIAGNOSTICS.storageKey) as unknown
      if (Array.isArray(raw)) {
        wx.setStorageSync(DIAGNOSTICS.storageKey, raw.slice(0, DIAGNOSTICS.maxEntries))
      }
    } catch {
      // 诊断日志损坏时保持原样，recordDiagnostic 会再次自愈
    }
  }

  writeVersion(STORAGE_SCHEMA_VERSION)
}
