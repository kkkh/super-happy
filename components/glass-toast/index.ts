/**
 * glass-toast · 全局毛玻璃轻提示
 * - 绑定 toastStore，单例渲染，自动排队
 * - 不使用 wx.showToast，不弹系统提示
 * - 支持 top / center / bottom 三种位置与 loading 遮罩
 * - virtualHost + styleIsolation，样式不污染页面
 *
 * 页面根节点挂载一次：
 *   <glass-toast />
 */
import { createStoreBindings } from 'mobx-miniprogram-bindings'
import {
  hideGlassToast,
  toastStore,
  type GlassToastItem,
} from './toast'

interface ToastRuntime {
  bindings?: { destroyStoreBindings: () => void }
  /** 动作时间锁：300ms 内重复点击直接丢弃 */
  actionLockUntil: number
  /** 已消费动作的 toast id：同一提示只允许执行一次 */
  consumedActionId: string
}

/** 撤销类动作必须一击即止，防止手抖连点二次消费 sessionId */
const ACTION_LOCK_MS = 300

Component({
  options: {
    virtualHost: true,
    styleIsolation: 'isolated',
    addGlobalClass: false,
  },

  externalClasses: ['custom-class'],

  properties: {
    /** 层级；默认高于底部抽屉 */
    zIndex: {
      type: Number,
      value: 300,
    },
    /** 外部布局样式 */
    customStyle: {
      type: String,
      value: '',
    },
  },

  data: {
    current: null as GlassToastItem | null,
    visible: false,
    /** 动作已触发：按钮立刻置灰，视觉与逻辑双重防抖 */
    actionBusy: false,
  },

  observers: {
    /** toast 切换时复位动作锁，避免下一条提示被上一条的锁误伤 */
    current() {
      const runtime = this as unknown as ToastRuntime
      runtime.actionLockUntil = 0
      runtime.consumedActionId = ''
      this.setData({ actionBusy: false })
    },
  },

  lifetimes: {
    attached() {
      const runtime = this as unknown as ToastRuntime
      runtime.actionLockUntil = 0
      runtime.consumedActionId = ''
      runtime.bindings = createStoreBindings(this, {
        store: toastStore,
        fields: {
          current: () => toastStore.current,
          visible: () => toastStore.visible,
        },
        actions: [],
      })
    },

    detached() {
      const runtime = this as unknown as ToastRuntime
      if (runtime.bindings) {
        runtime.bindings.destroyStoreBindings()
      }
    },
  },

  methods: {
    onToastTap(): void {
      const current = this.data.current as GlassToastItem | null
      if (!current || !current.tapToDismiss) {
        return
      }
      hideGlassToast(current.id)
    },

    /**
     * 动作按钮：
     * 1. 300ms 时间锁
     * 2. 同 toast id 只执行一次
     * 3. 点击立刻置灰
     * 4. 回调异常隔离，绝不影响 toast 队列
     */
    onActionTap(): void {
      const current = this.data.current as GlassToastItem | null
      if (!current || !current.actionLabel || typeof current.onAction !== 'function') {
        return
      }
      if (this.data.actionBusy) {
        return
      }
      const runtime = this as unknown as ToastRuntime
      const now = Date.now()
      if (now < runtime.actionLockUntil) {
        return
      }
      if (runtime.consumedActionId === current.id) {
        return
      }
      runtime.actionLockUntil = now + ACTION_LOCK_MS
      runtime.consumedActionId = current.id
      this.setData({ actionBusy: true })
      const action = current.onAction
      /* 先关闭提示再执行回调：避免回调内再次弹 toast 时出现层叠 */
      hideGlassToast(current.id)
      try {
        action()
      } catch {
        /* 动作回调异常不影响后续队列 */
      }
    },

    noop(): void {
      /* 阻断遮罩滚动与点击穿透 */
    },
  },
})
