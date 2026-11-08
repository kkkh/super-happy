/* ==========================================================================
   隐私授权前置拦截 · 敏感 API 调用前的唯一入口
   - 已同意：wx.requirePrivacyAuthorize 立即 success
   - 未同意：触发全局 onNeedPrivacyAuthorization → privacy-guard 弹窗
   - 低版本基础库没有该 API：按已授权处理，保持原有能力
   ========================================================================== */
import { logger } from './logger'

/**
 * 确保用户已同意隐私保护指引。
 * 返回 false 表示用户拒绝或授权流程失败，调用方必须优雅降级。
 */
export function ensurePrivacyAuthorized(): Promise<boolean> {
  if (typeof wx.requirePrivacyAuthorize !== 'function') {
    return Promise.resolve(true)
  }

  return new Promise((resolve) => {
    try {
      wx.requirePrivacyAuthorize({
        success: () => resolve(true),
        fail: (error) => {
          logger.warn('privacy', '用户未同意隐私保护指引', error)
          resolve(false)
        },
      })
    } catch (error) {
      logger.warn('privacy', '隐私授权前置调用异常', error)
      resolve(false)
    }
  })
}
