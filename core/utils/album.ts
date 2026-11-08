/* ==========================================================================
   相册保存 · 包内图 / 临时文件解析 + 授权补救链路
   - 先尝试保存；授权被拒时 showModal 说明 → openSetting → 自动重试
   - 纯离线：不解析 cloud://，遇到时直接 unavailable，不发起任何网络请求
   ========================================================================== */
import { logger } from './logger'
import { ensurePrivacyAuthorized } from './privacy'

export type AlbumFailure = 'denied' | 'failed' | 'privacy' | 'unavailable'

export interface AlbumSaveResult {
  ok: boolean
  failure?: AlbumFailure
}

/** 任意来源 → 本地可保存路径（包内路径需先落地；临时文件直接复用） */
function resolveLocalPath(src: string): Promise<string | null> {
  if (/(wxfile:|http:\/\/tmp|https:\/\/tmp|\/tmp\/)/.test(src)) {
    return Promise.resolve(src)
  }
  return new Promise((resolve) => {
    wx.getImageInfo({
      src,
      success: (res) => resolve(res.path || null),
      fail: () => resolve(null),
    })
  })
}

function isAuthError(message: string): boolean {
  return /auth|authorize|deny|denied|permission|权限/i.test(message)
}

function saveOnce(filePath: string): Promise<{ ok: true } | { ok: false; errMsg: string }> {
  return new Promise((resolve) => {
    wx.saveImageToPhotosAlbum({
      filePath,
      success: () => resolve({ ok: true }),
      fail: (error) => resolve({ ok: false, errMsg: error.errMsg || '' }),
    })
  })
}

function confirmOpenSetting(): Promise<boolean> {
  return new Promise((resolve) => {
    wx.showModal({
      title: '需要相册权限',
      content: '保存图片需要访问相册。请在设置中开启「保存到相册」后重试。',
      confirmText: '去设置',
      cancelText: '暂不',
      success: (res) => resolve(Boolean(res.confirm)),
      fail: () => resolve(false),
    })
  })
}

function openSettingForAlbum(): Promise<boolean> {
  return new Promise((resolve) => {
    wx.openSetting({
      success: (res) => resolve(Boolean(res.authSetting['scope.writePhotosAlbum'])),
      fail: () => resolve(false),
    })
  })
}

/** 统一保存入口：成功/失败均归一化 */
export async function saveImageToAlbum(src: string): Promise<AlbumSaveResult> {
  if (!src) {
    return { ok: false, failure: 'unavailable' }
  }
  /* 纯离线：云文件不可解析，直接本地兜底，绝不发起网络请求 */
  if (src.startsWith('cloud://')) {
    return { ok: false, failure: 'unavailable' }
  }
  /* 此处是处理隐私授权被拒绝的边界 */
  if (!(await ensurePrivacyAuthorized())) {
    return { ok: false, failure: 'privacy' }
  }
  const localPath = await resolveLocalPath(src)
  if (!localPath) {
    return { ok: false, failure: 'unavailable' }
  }

  const first = await saveOnce(localPath)
  if (first.ok) {
    return { ok: true }
  }
  if (!isAuthError(first.errMsg)) {
    logger.warn('album', '保存失败', first.errMsg)
    return { ok: false, failure: 'failed' }
  }

  /* 授权被拒：说明 → 设置 → 自动重试 */
  if (!(await confirmOpenSetting())) {
    return { ok: false, failure: 'denied' }
  }
  if (!(await openSettingForAlbum())) {
    return { ok: false, failure: 'denied' }
  }
  const retry = await saveOnce(localPath)
  if (retry.ok) {
    return { ok: true }
  }
  logger.warn('album', '授权后保存仍未完成', retry.errMsg)
  return { ok: false, failure: isAuthError(retry.errMsg) ? 'denied' : 'failed' }
}

/** 失败态 → 用户可读提示 */
export function albumFailureMessage(result: AlbumSaveResult): string {
  if (result.failure === 'denied') {
    return '未获得相册权限'
  }
  if (result.failure === 'privacy') {
    return '未同意隐私保护指引'
  }
  if (result.failure === 'unavailable') {
    return '图片暂不可用'
  }
  return '保存未完成'
}
