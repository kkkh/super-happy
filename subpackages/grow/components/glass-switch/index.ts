/* ==========================================================================
   glass-switch · 极光毛玻璃开关
   - 1rpx 渐变高光边框 + 双层滑块，开启时滑块内部极光色散
   - 只抛事件，不维护选中态；由父级偏好 Store 驱动，保证全局一致
   - catchtap 阻断行点击，避免「点开关又触发整行」
   ========================================================================== */
import { tapTick } from '../../../../core/utils/haptics'

Component({
  options: {
    virtualHost: true,
    styleIsolation: 'isolated',
  },

  properties: {
    checked: {
      type: Boolean,
      value: false,
    },
    disabled: {
      type: Boolean,
      value: false,
    },
    ariaLabel: {
      type: String,
      value: '开关',
    },
  },

  methods: {
    onToggle(): void {
      if (this.data.disabled) {
        return
      }
      tapTick()
      this.triggerEvent('change', { value: !this.data.checked })
    },
  },
})
