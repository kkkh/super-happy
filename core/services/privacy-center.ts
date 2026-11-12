/* ==========================================================================
   privacy-center · 隐私中心数据层
   - 权限状态：定位 / 相册 / 隐私保护指引授权
   - 跳转：系统设置、微信隐私保护指引
   - 版本：PRIVACY_VERSION ↔ app:privacy.version
   - 重置全部：只删工具 / 天气 / 专注 / 诊断 / 快照与本机文件，保留 gallery 与存储版本
   ========================================================================== */
import { PRIVACY_VERSION, STORAGE_KEYS } from '../constants/index'
import { readStorage, removeStorage, writeStorage } from '../toolbox/storage'
import { deleteBackupFiles } from './backup'
import { cleanupAllExports } from './export'

export type PrivacyPermissionKey = 'location' | 'album' | 'privacy'
export type PrivacyPermissionStatus = 'granted' | 'denied' | 'unset' | 'unavailable'

export interface PrivacyPermissionItem {
  key: PrivacyPermissionKey
  label: string
  status: PrivacyPermissionStatus
  statusText: string
  detail: string
}

export interface PrivacySnapshot {
  permissions: PrivacyPermissionItem[]
  contractName: string
  version: number
  ackedVersion: number
  versionChanged: boolean
}

export interface ResetAllResult {
  removedKeys: number
  backups: number
}

/** 重置全部删除的命名空间：gallery.* 与 app:storage.version 不在其中 */
const RESET_PREFIXES = ['tbx:', 'toolbox:', 'weather:', 'qweather:', 'focus:', 'diag:', 'cyber:'] as const
const RESET_KEYS: string[] = [
  STORAGE_KEYS.preference,
  STORAGE_KEYS.preferenceLegacy,
  STORAGE_KEYS.backupAt,
  STORAGE_KEYS.privacyVersion,
]

function statusTextOf(status: PrivacyPermissionStatus): string {
  if (status === 'granted') {
    return '已授权'
  }
  if (status === 'denied') {
    return '已拒绝'
  }
  if (status === 'unset') {
    return '待确认'
  }
  return '当前版本不支持'
}

function authStatus(value: unknown): PrivacyPermissionStatus {
  if (value === true) {
    return 'granted'
  }
  if (value === false) {
    return 'denied'
  }
  return 'unset'
}

function readAuthSetting(): Promise<Record<string, unknown> | null> {
  if (typeof wx.getSetting !== 'function') {
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    try {
      wx.getSetting({
        success: (result) => {
          const auth = result.authSetting as unknown
          resolve(auth && typeof auth === 'object' ? (auth as Record<string, unknown>) : {})
        },
        fail: () => resolve(null),
      })
    } catch {
      resolve(null)
    }
  })
}

function readPrivacySetting(): Promise<{
  needAuthorization: boolean
  privacyContractName: string
} | null> {
  if (typeof wx.getPrivacySetting !== 'function') {
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    try {
      wx.getPrivacySetting({
        success: (result) =>
          resolve({
            needAuthorization: result.needAuthorization === true,
            privacyContractName:
              typeof result.privacyContractName === 'string' ? result.privacyContractName : '',
          }),
        fail: () => resolve(null),
      })
    } catch {
      resolve(null)
    }
  })
}

/** 读取系统授权与隐私指引状态；任一 API 不可用时降级为 unavailable */
export function permissionSnapshot(): Promise<PrivacySnapshot> {
  return Promise.all([readAuthSetting(), readPrivacySetting()]).then(([auth, privacy]) => {
    const authAvailable = auth !== null
    /* 全息气象只申请城市级模糊定位；旧版本可能只留下精确位置授权，做一次兼容回退 */
    const locationAuth =
      auth && typeof auth['scope.userFuzzyLocation'] !== 'undefined'
        ? auth['scope.userFuzzyLocation']
        : auth && auth['scope.userLocation']
    const locationStatus = authAvailable
      ? authStatus(locationAuth)
      : ('unavailable' as PrivacyPermissionStatus)
    const albumStatus = authAvailable
      ? authStatus(auth['scope.writePhotosAlbum'])
      : ('unavailable' as PrivacyPermissionStatus)
    const privacyStatus: PrivacyPermissionStatus = !privacy
      ? 'unavailable'
      : privacy.needAuthorization
        ? 'unset'
        : 'granted'
    const contractName = privacy ? privacy.privacyContractName : ''
    const ackedVersion = readPrivacyVersion()
    return {
      permissions: [
        {
          key: 'location',
          label: '定位',
          status: locationStatus,
          statusText: statusTextOf(locationStatus),
          detail: '全息气象与和风天气按需申请；仅城市级模糊定位，拒绝后可手动选城',
        },
        {
          key: 'album',
          label: '相册',
          status: albumStatus,
          statusText: statusTextOf(albumStatus),
          detail: '保存海报与图片时使用；读取图片由系统选图器单独授权',
        },
        {
          key: 'privacy',
          label: '隐私保护指引',
          status: privacyStatus,
          statusText: statusTextOf(privacyStatus),
          detail: contractName
            ? `《${contractName}》`
            : '首次使用敏感接口时会请求确认',
        },
      ] satisfies PrivacyPermissionItem[],
      contractName,
      version: PRIVACY_VERSION,
      ackedVersion,
      versionChanged: ackedVersion < PRIVACY_VERSION,
    }
  })
}

/** 打开小程序系统设置页；失败返回 false，由页面给出降级提示 */
export function openPrivacySetting(): Promise<boolean> {
  if (typeof wx.openSetting !== 'function') {
    return Promise.resolve(false)
  }
  return new Promise((resolve) => {
    try {
      wx.openSetting({
        success: () => resolve(true),
        fail: () => resolve(false),
      })
    } catch {
      resolve(false)
    }
  })
}

/** 打开微信隐私保护指引；低版本不可用时返回 false */
export function openPrivacyContract(): Promise<boolean> {
  if (typeof wx.openPrivacyContract !== 'function') {
    return Promise.resolve(false)
  }
  return new Promise((resolve) => {
    try {
      wx.openPrivacyContract({
        success: () => resolve(true),
        fail: () => resolve(false),
      })
    } catch {
      resolve(false)
    }
  })
}

export function readPrivacyVersion(): number {
  const value = Number(readStorage(STORAGE_KEYS.privacyVersion))
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

export function ackPrivacyVersion(version = PRIVACY_VERSION): boolean {
  if (!Number.isFinite(version) || version <= 0) {
    return false
  }
  return writeStorage(STORAGE_KEYS.privacyVersion, Math.floor(version))
}

export function privacyVersionChanged(version = PRIVACY_VERSION): boolean {
  return readPrivacyVersion() < version
}

/**
 * 重置全部本机数据。
 * - 删除 tbx: / weather: / qweather: / focus: / diag: / cyber: 与 app 偏好、备份时间、隐私版本
 * - 删除 USER_DATA_PATH/backups 与 exports
 * - 保留 gallery.*（主题与作品收藏）与 app:storage.version（迁移判断）
 */
export function resetAllLocalData(): ResetAllResult {
  let removedKeys = 0
  try {
    const keys = wx.getStorageInfoSync().keys
    for (const key of keys) {
      if (key === 'app:storage.version' || key.startsWith('gallery.')) {
        continue
      }
      const inScope =
        RESET_KEYS.includes(key) || RESET_PREFIXES.some((prefix) => key.startsWith(prefix))
      if (!inScope) {
        continue
      }
      if (removeStorage(key)) {
        removedKeys += 1
      }
    }
  } catch {
    /* 存储不可用时仍继续清理文件，最终由页面提示 */
  }
  const backups = deleteBackupFiles()
  cleanupAllExports()
  return { removedKeys, backups: backups.removed }
}
