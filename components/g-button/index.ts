/**
 * g-button · 按钮原子
 * - primary：iris 渐变实底（反白字）
 * - ghost：玻璃描边
 * - danger：amber 警示
 * - loading：菊花态（防重复提交）
 * 用法示例：
 *   <g-button variant="primary" block loading="{{saving}}" bind:tap="onSave">保存到相册</g-button>
 */
import { tapTick } from '../../core/utils/haptics'

Component({
  properties: {
    variant: { type: String, value: 'primary' },
    block: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
    loading: { type: Boolean, value: false },
  },

  methods: {
    onTap() {
      if (this.data.disabled || this.data.loading) {
        return
      }
      tapTick()
      this.triggerEvent('tap')
    },
  },
})
