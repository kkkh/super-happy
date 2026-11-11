/* ==========================================================================
   feedback · 全项目交互反馈唯一实现
   - copyText 统一前置隐私授权、剪贴板写入、失败提示与触感
   - toast 统一走 glass-toast，不使用 wx.showToast
   - 三个工具分包的 lib/ui.ts 只做薄 re-export，禁止第四份副本
   ========================================================================== */
import { showGlassToast } from '../../components/glass-toast/toast'
import { tapSuccess, tapWarn } from '../utils/haptics'
import { ensurePrivacyAuthorized } from '../utils/privacy'

/**
 * 复制用户内容。返回 false 表示空内容、用户拒绝授权或写入失败。
 * 调用方可在失败时做额外降级，但不得再次弹全局错误。
 */
export async function copyText(text: string, message = '已复制'): Promise<boolean> {
  if (!text) {
    return false
  }
  const authorized = await ensurePrivacyAuthorized()
  if (!authorized) {
    tapWarn()
    showGlassToast({ message: '需同意隐私保护指引后复制', type: 'warning' })
    return false
  }
  return new Promise((resolve) => {
    try {
      wx.setClipboardData({
        data: text,
        success: () => {
          /* 部分平台会弹系统「内容已复制」，先收起再走应用内 Toast */
          try {
            wx.hideToast()
          } catch {
            /* 旧基础库无 hideToast 时忽略 */
          }
          tapSuccess()
          showGlassToast({ message, type: 'success' })
          resolve(true)
        },
        fail: () => {
          tapWarn()
          showGlassToast({ message: '复制失败，请重试', type: 'error' })
          resolve(false)
        },
      })
    } catch {
      tapWarn()
      showGlassToast({ message: '复制失败，请重试', type: 'error' })
      resolve(false)
    }
  })
}

/** 轻提示统一出口；不涉及剪贴板，不需要隐私授权 */
export function toast(message: string): void {
  showGlassToast(message)
}
