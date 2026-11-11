/* ==========================================================================
   图片工具公共能力 · 选图 / 文件信息 / 相册保存
   - 只从相册选择，不申请相机
   - 保存到相册仅写入，不读取相册
   ========================================================================== */
import { showGlassToast } from '../../../components/glass-toast/toast'
import { tapSuccess } from '../../../core/utils/haptics'
import { ensurePrivacyAuthorized } from '../../../core/utils/privacy'
import { albumFailureMessage, saveImageToAlbum as saveAlbum } from '../../../core/utils/album'

export interface PickedImage {
  path: string
  size: number
  width: number
  height: number
  fileType: string
}

/** 从相册选择单张图片；用户取消返回 null */
export async function chooseSingleImage(): Promise<PickedImage | null> {
  /* 此处是处理隐私授权前置拦截的边界 */
  if (!(await ensurePrivacyAuthorized())) {
    throw new Error('未同意隐私保护指引，无法访问相册')
  }
  return new Promise((resolve, reject) => {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album'],
      sizeType: ['original'],
      success: (result) => {
        const file = result.tempFiles[0]
        if (!file) {
          resolve(null)
          return
        }
        resolve({
          path: file.tempFilePath,
          size: file.size,
          width: file.width ?? 0,
          height: file.height ?? 0,
          fileType: file.fileType ?? 'image',
        })
      },
      fail: (error) => {
        const message = error.errMsg ?? ''
        if (message.includes('cancel')) {
          resolve(null)
          return
        }
        if (/privacy|auth|authorize/i.test(message)) {
          reject(new Error('需要相册权限或隐私授权，请在设置中开启后再试'))
          return
        }
        reject(new Error(message || '选择图片失败'))
      },
    })
  })
}

/** 从相册选择多张图片（拼图 / 批量处理）；取消返回空数组 */
export async function chooseImages(count = 9): Promise<PickedImage[]> {
  /* 此处是处理隐私授权前置拦截的边界 */
  if (!(await ensurePrivacyAuthorized())) {
    throw new Error('未同意隐私保护指引，无法访问相册')
  }
  const limit = Math.max(1, Math.min(9, Math.floor(count) || 1))
  return new Promise((resolve, reject) => {
    wx.chooseMedia({
      count: limit,
      mediaType: ['image'],
      sourceType: ['album'],
      sizeType: ['original'],
      success: (result) => {
        resolve(
          (result.tempFiles || []).map((file) => ({
            path: file.tempFilePath,
            size: file.size,
            width: file.width ?? 0,
            height: file.height ?? 0,
            fileType: file.fileType ?? 'image',
          })),
        )
      },
      fail: (error) => {
        const message = error.errMsg ?? ''
        if (message.includes('cancel')) {
          resolve([])
          return
        }
        if (/privacy|auth|authorize/i.test(message)) {
          reject(new Error('需要相册权限或隐私授权，请在设置中开启后再试'))
          return
        }
        reject(new Error(message || '选择图片失败'))
      },
    })
  })
}

/** 本地文件体积（字节） */
export function getFileSize(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    wx.getFileSystemManager().getFileInfo({
      filePath,
      success: (result) => resolve(result.size),
      fail: () => resolve(0),
    })
  })
}

/** 图片尺寸信息 */
export function getImageInfo(
  src: string,
): Promise<{ width: number; height: number; orientation: string }> {
  return new Promise((resolve, reject) => {
    wx.getImageInfo({
      src,
      success: (result) => {
        resolve({
          width: result.width,
          height: result.height,
          orientation: result.orientation ?? 'up',
        })
      },
      fail: (error) => reject(new Error(error.errMsg || '读取图片信息失败')),
    })
  })
}

/** 字节 → 可读体积 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '—'
  }
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

/** 保存单张图片到相册；授权拒绝时由 core 统一完成说明 → 设置 → 重试 */
export async function saveImageToAlbum(filePath: string): Promise<boolean> {
  const result = await saveAlbum(filePath)
  if (result.ok) {
    tapSuccess()
    return true
  }
  showGlassToast({
    message: albumFailureMessage(result),
    type: result.failure === 'failed' ? 'error' : 'warning',
    placement: 'lower-center',
  })
  return false
}
