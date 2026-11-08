/**
 * g-card · 液态玻璃卡（材质核心）
 * - glass：半透明 + 发丝描边 + 内高光（默认）
 * - solid：不透明实底（嵌套场景）
 * - sheen：高光扫过流光（英雄卡）
 * - hover：按压态 + tap 事件透传（触觉由页面处理器统一负责，避免双重震感）
 * 用法示例：
 *   <g-card padding="lg" sheen hover bind:tap="onOpen">...</g-card>
 */
/* 原实现：组件内直接触发 tapTick，会与页面处理器重复震动
   import { tapTick } from '../../core/utils/haptics'
   现改为仅透传 tap 事件，触觉归页面层统一编排 */

Component({
  options: {
    /* slot 内容允许消费页面级原子类 */
    multipleSlots: false,
  },

  properties: {
    padding: { type: String, value: 'md' },
    /** 不透明实底（嵌套层级更清晰） */
    solid: { type: Boolean, value: false },
    /** 高光扫过 */
    sheen: { type: Boolean, value: false },
    /** 可按压：按压态 + tap 事件透传（触觉由页面处理） */
    hover: { type: Boolean, value: false },
  },

  methods: {
    onTap() {
      if (this.data.hover) {
        this.triggerEvent('tap')
      }
    },
  },
})
