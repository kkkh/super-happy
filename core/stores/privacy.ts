/* ==========================================================================
   隐私授权 Store · 全局 onNeedPrivacyAuthorization 的唯一收口
   - 监听由 app.ts 启动时注册一次
   - 多个隐私接口同时 pending 时全部入栈，同意/拒绝后统一 resolve
   - 不持久化任何状态，授权由微信基础库自行记忆
   ========================================================================== */
import { observable } from 'mobx-miniprogram'
import { logger } from '../utils/logger'

export type PrivacyResolveEvent = 'agree' | 'disagree' | 'exposureAuthorization'

export interface PrivacyResolveOption {
  event: PrivacyResolveEvent
  /** event=agree 时必填：同意按钮的 id */
  buttonId?: string
}

export type PrivacyResolve = (option: PrivacyResolveOption) => void

export interface PrivacyRequestInfo {
  referrer: string
}

export const privacyStore = observable({
  visible: false,
  referrer: '',
  pending: [] as PrivacyResolve[],

  /** onNeedPrivacyAuthorization 回调入口：同一时刻可堆积多个 pending 接口 */
  enqueue(resolve: PrivacyResolve, referrer = ''): void {
    if (typeof resolve !== 'function') {
      return
    }
    this.pending = [...this.pending, resolve]
    this.referrer = referrer || this.referrer
    this.visible = true
  },

  /** 用户点击 <button open-type="agreePrivacyAuthorization"> 后调用 */
  resolveAgree(buttonId: string): void {
    const list = this.pending
    this.pending = []
    this.visible = false
    list.forEach((resolve) => {
      try {
        resolve({ event: 'agree', buttonId })
      } catch (error) {
        logger.warn('privacy', 'resolve agree 失败', error)
      }
    })
  },

  /** 用户暂不同意；原隐私接口会 fail，调用方负责优雅提示 */
  resolveDisagree(): void {
    const list = this.pending
    this.pending = []
    this.visible = false
    list.forEach((resolve) => {
      try {
        resolve({ event: 'disagree' })
      } catch (error) {
        logger.warn('privacy', 'resolve disagree 失败', error)
      }
    })
  },

  /** 页面销毁等极端场景：清空可视状态，不误伤仍 pending 的原接口 */
  reset(): void {
    this.visible = false
    this.referrer = ''
    this.pending = []
  },
})

type PrivacyListener = (
  resolve: PrivacyResolve,
  eventInfo?: { referrer?: string },
) => void

/** App 启动调用一次；低版本基础库没有该 API 时静默跳过 */
export function installPrivacyGuard(): void {
  if (typeof wx.onNeedPrivacyAuthorization !== 'function') {
    return
  }
  try {
    /* 官方 d.ts 对该回调仍是旧签名，这里按真实运行时签名注册 */
    const register = wx.onNeedPrivacyAuthorization as unknown as (
      listener: PrivacyListener,
    ) => void
    register((resolve, eventInfo) => {
      privacyStore.enqueue(resolve, (eventInfo && eventInfo.referrer) || '')
    })
  } catch (error) {
    logger.warn('privacy', '隐私授权监听注册失败', error)
  }
}
