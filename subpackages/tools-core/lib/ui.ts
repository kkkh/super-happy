/* ==========================================================================
   工具箱交互反馈 · tools-core 分包本地副本
   统一走 glass-toast，不使用 wx.showToast
   与 tools-media/lib/ui.ts 保持同步
   ========================================================================== */
import { showGlassToast } from '../../../components/glass-toast/toast'
import { tapSuccess, tapWarn } from '../../../core/utils/haptics'

export function copyText(text: string, message = '已复制'): void {
  if (!text) {
    return
  }
  wx.setClipboardData({
    data: text,
    success: () => {
      /* 部分平台会在复制成功后自动弹出「内容已复制」，先收起系统提示再走应用内 Toast */
      wx.hideToast()
      tapSuccess()
      showGlassToast({ message, type: 'success' })
    },
    fail: () => {
      tapWarn()
      showGlassToast({ message: '复制失败，请重试', type: 'error' })
    },
  })
}

export function toast(message: string): void {
  showGlassToast(message)
}
