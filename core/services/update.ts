/* ==========================================================================
   版本更新 · 跨层共享状态
   - app.ts 只负责下载与暂存，绝不直接弹窗
   - 所有页面挂载 update-guard，由它承接极光弹窗并负责原生降级
   - “稍后 / 查看日志”只写一个布尔标记，设置页据此显示红点
   ========================================================================== */
import { logger } from '../utils/logger'

const UPDATE_PENDING_KEY = 'hasPendingUpdate'

/**
 * 全局弹窗状态：
 * - idle     可展示
 * - custom   某个 update-guard 正在展示极光弹窗
 * - native   正在等待自定义层退场 / 原生弹窗展示中
 * - dismissed 本次会话已处理（稍后 / 重启 / 查看日志 / 原生失败）
 */
export type UpdatePromptState = 'idle' | 'custom' | 'native' | 'dismissed'

/** 挂载在 App.globalData 上的更新运行时 */
export interface AppUpdateGlobalData {
  updateManager: WechatMiniprogram.UpdateManager | null
  hasUpdate: boolean
  /** 全局状态监听器；更新就绪、高危阻塞解除、弹窗交棒都会广播 */
  updateReadyListeners: Array<() => void>
  /** 跨页面互斥状态：同一时刻只允许一个更新弹窗 */
  promptState: UpdatePromptState
  /** 当前持有极光弹窗的 update-guard 实例 token */
  promptOwner: string
  /** 高危操作计数；> 0 时所有 update-guard 暂停推进 */
  blockers: number
}

/** 广播给所有 update-guard；单个宿主异常不影响其他页面 */
export function notifyUpdateGuards(hub: AppUpdateGlobalData): void {
  hub.updateReadyListeners.slice().forEach((listener) => {
    try {
      listener()
    } catch (error) {
      logger.warn('update', '更新状态回调异常', error)
    }
  })
}

/** 进入高危操作（AES 加密 / 长任务 / 页面自有弹窗）：暂停全局更新弹窗 */
export function holdUpdatePrompt(hub: AppUpdateGlobalData): void {
  hub.blockers += 1
}

/** 弹窗退场通常 220–400ms；等干净后再广播，避免更新窗叠在正在关闭的抽屉上 */
const UPDATE_WAKE_DELAY = 420

let updateWakeTimer = 0

/**
 * 离开高危操作。
 * 计数归零后延迟广播：既有页面自己的 blocked 观察器兜底，
 * 也覆盖隐私授权这类没有 blocked 属性的全局遮罩。
 */
export function releaseUpdatePrompt(hub: AppUpdateGlobalData): void {
  hub.blockers = Math.max(0, hub.blockers - 1)
  if (hub.blockers > 0) {
    return
  }
  if (updateWakeTimer) {
    clearTimeout(updateWakeTimer)
  }
  updateWakeTimer = setTimeout(() => {
    updateWakeTimer = 0
    if (hub.blockers === 0) {
      notifyUpdateGuards(hub)
    }
  }, UPDATE_WAKE_DELAY) as unknown as number
}

/** 记录用户选择“稍后”：设置页红点的唯一真相源 */
export function markUpdatePending(): boolean {
  try {
    wx.setStorageSync(UPDATE_PENDING_KEY, true)
    return true
  } catch (error) {
    logger.warn('update', '写入待更新标记失败', error)
    return false
  }
}

/** 新版本真正生效或确认无更新时清除红点，避免跨版本残留 */
export function clearUpdatePending(): void {
  try {
    wx.removeStorageSync(UPDATE_PENDING_KEY)
  } catch (error) {
    logger.warn('update', '清除待更新标记失败', error)
  }
}

export function readUpdatePending(): boolean {
  try {
    return wx.getStorageSync(UPDATE_PENDING_KEY) === true
  } catch (error) {
    logger.warn('update', '读取待更新标记失败', error)
    return false
  }
}

/** 页面侧读取 globalData；App 尚未就绪时返回 null，不影响首屏 */
export function readUpdateGlobalData(): AppUpdateGlobalData | null {
  try {
    const app = getApp() as unknown as { globalData?: AppUpdateGlobalData }
    return app && app.globalData ? app.globalData : null
  } catch {
    return null
  }
}
