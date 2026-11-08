/* ==========================================================================
   分享深链暂存 · 冷/热启动统一的待消费工具参数
   - App.onShow 收到的 query 先写入这里
   - 首页 onLoad / onShow 消费一次，避免热启动时 getEnterOptionsSync 滞后
   ========================================================================== */
import { observable } from 'mobx-miniprogram'

export const deepLinkStore = observable({
  pendingToolId: '',

  setPending(toolId: string): void {
    this.pendingToolId = typeof toolId === 'string' ? toolId : ''
  },

  /** 只允许消费一次 */
  takePending(): string {
    const toolId = this.pendingToolId
    this.pendingToolId = ''
    return toolId
  },
})
