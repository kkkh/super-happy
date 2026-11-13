/* ==========================================================================
   全局网络状态 · 联网工具置灰与离线提示的唯一真相源
   - unknown 视为在线（fail-open），只有明确 offline 才影响功能
   - 监听器全局只注册一次；页面 / 组件可安全重复 init
   - getNetworkType 的旧快照会被 eventSeq 丢弃，避免覆盖更新的断网事件
   ========================================================================== */
import { observable } from 'mobx-miniprogram'
import { logger } from '../utils/logger'

export type NetworkStatus = 'unknown' | 'online' | 'offline'

/** 热启动补检节流：避免 onShow 频繁触发系统调用 */
const CHECK_THROTTLE_MS = 1500
let installed = false
let eventSeq = 0

function resolveStatus(isConnected: boolean | undefined, networkType: string): NetworkStatus {
  if (isConnected === false || networkType === 'none') {
    return 'offline'
  }
  return 'online'
}

export const networkStore = observable({
  status: 'unknown' as NetworkStatus,
  inited: false,
  lastCheckAt: 0,

  /** 未知 / 读取失败一律按在线处理，避免误伤本地工具 */
  get online(): boolean {
    return this.status !== 'offline'
  },

  get offline(): boolean {
    return this.status === 'offline'
  },

  init(): void {
    if (installed) {
      this.inited = true
      return
    }
    installed = true
    this.inited = true

    this.check()

    try {
      if (typeof wx.onNetworkStatusChange !== 'function') {
        return
      }
      wx.onNetworkStatusChange((result) => {
        eventSeq += 1
        this.status = resolveStatus(result.isConnected, result.networkType)
        this.lastCheckAt = Date.now()
      })
    } catch (error) {
      logger.warn('network', '网络状态监听注册失败', error)
    }
  },

  /** 回前台补一次；与启动检查共用节流，避免重复请求 */
  refresh(): void {
    if (!installed) {
      this.init()
      return
    }
    if (Date.now() - this.lastCheckAt < CHECK_THROTTLE_MS) {
      return
    }
    this.check()
  },

  check(): void {
    if (typeof wx.getNetworkType !== 'function') {
      return
    }
    const seq = eventSeq
    try {
      wx.getNetworkType({
        success: (result) => {
          /* 事件已经更新过状态时，旧快照直接丢弃 */
          if (seq !== eventSeq) {
            return
          }
          this.status = resolveStatus(undefined, result.networkType)
          this.lastCheckAt = Date.now()
        },
        fail: () => {
          /* 读取失败保持 fail-open */
        },
      })
    } catch (error) {
      logger.warn('network', '网络状态读取失败', error)
    }
  },
})
