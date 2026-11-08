/**
 * g-modal · 底部升起的玻璃抽屉（半屏 sheet）
 * - 弹性入场 + 遮罩点击关闭 + 遮罩滑动锁定
 * - 交互铁律：破坏性操作必须经此二次确认
 * 用法示例：
 *   <g-modal show="{{qrShow}}" title="二维码" bind:close="onClose">...</g-modal>
 */
import { tapTick } from '../../../../core/utils/haptics'

Component({
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '' },
  },

  methods: {
    onScrim() {
      tapTick()
      this.triggerEvent('close')
    },

    /** 明确关闭按钮：读屏用户无法依赖遮罩点击 */
    onClose() {
      tapTick()
      this.triggerEvent('close')
    },

    onStop() {
      /* 阻断冒泡 */
    },
  },
})
