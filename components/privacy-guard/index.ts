/* ==========================================================================
   privacy-guard · 全局隐私授权弹窗
   - 由 app.ts 注册的 wx.onNeedPrivacyAuthorization 驱动
   - 同意按钮必须是原生 <button open-type="agreePrivacyAuthorization">
   - 同意/拒绝后统一 resolve privacyStore 中所有 pending 接口
   ========================================================================== */
import { createStoreBindings } from 'mobx-miniprogram-bindings'
import { privacyStore } from '../../core/stores/privacy'
import {
  holdUpdatePrompt,
  readUpdateGlobalData,
  releaseUpdatePrompt,
} from '../../core/services/update'
import { tapTick } from '../../core/utils/haptics'

interface GuardRuntime {
  bindings?: { destroyStoreBindings: () => void }
  /** 隐私弹窗打开期间，暂停全局更新弹窗 */
  blockerHeld: boolean
}

Component({
  options: {
    virtualHost: true,
    styleIsolation: 'isolated',
  },

  data: {
    visible: false,
    referrer: '',
  },

  lifetimes: {
    attached() {
      const runtime = this as unknown as GuardRuntime
      if (typeof runtime.blockerHeld !== 'boolean') {
        runtime.blockerHeld = false
      }
      runtime.bindings = createStoreBindings(this, {
        store: privacyStore,
        fields: {
          visible: () => privacyStore.visible,
          referrer: () => privacyStore.referrer,
        },
        actions: [],
      })
    },

    detached() {
      const runtime = this as unknown as GuardRuntime
      if (runtime.bindings) {
        runtime.bindings.destroyStoreBindings()
      }
      if (runtime.blockerHeld) {
        runtime.blockerHeld = false
        const hub = readUpdateGlobalData()
        if (hub) {
          releaseUpdatePrompt(hub)
        }
      }
    },
  },

  observers: {
    visible(value: boolean) {
      const runtime = this as unknown as GuardRuntime
      const hub = readUpdateGlobalData()
      if (!hub) {
        return
      }
      if (value && !runtime.blockerHeld) {
        runtime.blockerHeld = true
        holdUpdatePrompt(hub)
        return
      }
      if (!value && runtime.blockerHeld) {
        runtime.blockerHeld = false
        releaseUpdatePrompt(hub)
      }
    },
  },

  methods: {
    /** 原生同意按钮的回调：此时才允许 resolve({ event: 'agree' }) */
    onAgree(): void {
      tapTick()
      privacyStore.resolveAgree('privacy-agree-btn')
    },

    /** 拒绝不会关闭原接口，调用方会收到 fail 并给出优雅降级 */
    onDisagree(): void {
      tapTick()
      privacyStore.resolveDisagree()
    },

    /** 阻止遮罩滚动穿透与误触关闭；必须显式同意或拒绝 */
    noop(): void {
      /* 阻止滚动穿透 */
    },
  },
})
