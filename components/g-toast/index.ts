/**
 * g-toast · 全局轻提示（uiStore.showToast 驱动）
 * - 挂载于页面根节点末尾即可：<g-toast />
 * - 自动消隐；同一时刻仅一条（后到覆盖）
 */
import { createStoreBindings } from 'mobx-miniprogram-bindings'
import { uiStore } from '../../core/stores/ui'

interface ToastState {
  storeBindings?: { destroyStoreBindings: () => void }
}

Component({
  data: {
    toastShow: false,
    toastMessage: '',
  },

  lifetimes: {
    attached() {
      const state = this as unknown as ToastState
      state.storeBindings = createStoreBindings(this, {
        store: uiStore,
        fields: {
          toastShow: () => uiStore.toastShow,
          toastMessage: () => uiStore.toastMessage,
        },
        actions: [],
      })
    },
    detached() {
      const state = this as unknown as ToastState
      if (state.storeBindings) {
        state.storeBindings.destroyStoreBindings()
      }
    },
  },

  methods: {
    /* 吞掉透传点击 */
    noop() {
      /* intentional */
    },
  },
})
