/**
 * glass-card · 极光毛玻璃卡片
 * - 1rpx 渐变高光边框：外层渐变 + 1rpx 内边距实现，避免 mask 兼容问题
 * - 噪点层 / 流光层 / 极光染色层全部为独立绝对定位层，不拦截交互
 * - 支持默认插槽、header 插槽、footer 插槽
 * - virtualHost + styleIsolation，样式不污染页面
 * - 所有视觉令牌来自 app.wxss 的 --glass-*
 *
 * 用法：
 *   <glass-card tone="iris" depth="deep" show-header show-footer>
 *     <view slot="header">标题</view>
 *     <view>正文</view>
 *     <view slot="footer">底部</view>
 *   </glass-card>
 */

export type GlassCardTone = 'neutral' | 'iris' | 'aurora' | 'amber'
export type GlassCardRadius = 'sm' | 'md' | 'lg' | 'xl'
export type GlassCardPadding = 'none' | 'sm' | 'md' | 'lg'
export type GlassCardDepth = 'flat' | 'soft' | 'deep'

export interface GlassCardTapDetail {
  tone: GlassCardTone
  source: 'glass-card'
}

export interface GlassCardLongPressDetail {
  tone: GlassCardTone
  source: 'glass-card'
}

Component({
  options: {
    virtualHost: true,
    multipleSlots: true,
    styleIsolation: 'isolated',
    addGlobalClass: false,
  },

  externalClasses: ['card-class'],

  properties: {
    /** 语义色调：决定卡片左上角的极光染色 */
    tone: {
      type: String,
      value: 'neutral',
    },
    /** 圆角档位 */
    radius: {
      type: String,
      value: 'lg',
    },
    /** 内边距档位 */
    padding: {
      type: String,
      value: 'md',
    },
    /** 厚度阴影档位 */
    depth: {
      type: String,
      value: 'soft',
    },
    /** 是否绘制 1rpx 渐变高光边框 */
    bordered: {
      type: Boolean,
      value: true,
    },
    /** 是否绘制噪点层 */
    noise: {
      type: Boolean,
      value: true,
    },
    /** 是否绘制静态流光层 */
    sheen: {
      type: Boolean,
      value: true,
    },
    /** 是否绘制次表面散射内阴影 */
    sss: {
      type: Boolean,
      value: true,
    },
    /** 是否绘制红蓝分离色散边缘 */
    dispersion: {
      type: Boolean,
      value: true,
    },
    /** 是否启用 WXS 触控光追 */
    lightTracking: {
      type: Boolean,
      value: true,
    },
    /** 光追层不透明度 */
    lightOpacity: {
      type: Number,
      value: 0.55,
    },
    /** 是否响应点按 / 长按 */
    interactive: {
      type: Boolean,
      value: false,
    },
    /** 是否渲染 header 插槽 */
    showHeader: {
      type: Boolean,
      value: false,
    },
    /** 是否渲染 footer 插槽 */
    showFooter: {
      type: Boolean,
      value: false,
    },
    /** 读屏标签；interactive 时建议必填 */
    ariaLabel: {
      type: String,
      value: '玻璃卡片',
    },
    /** 透传到卡片根节点的内联样式，用于外部控制 margin 等布局 */
    customStyle: {
      type: String,
      value: '',
    },
  },

  data: {
    cardW: 0,
    cardH: 0,
  },

  lifetimes: {
    ready() {
      this.measureCard()
    },
  },

  pageLifetimes: {
    show() {
      this.measureCard()
    },
  },

  methods: {
    /** WXS 需要卡片尺寸做百分比归一；只在尺寸变化时写一次 data */
    measureCard(): void {
      if (!this.data.lightTracking) {
        return
      }
      this.createSelectorQuery()
        .select('.glass-card')
        .boundingClientRect((rect: WechatMiniprogram.BoundingClientRectCallbackResult | null) => {
          if (!rect || rect.width <= 0 || rect.height <= 0) {
            return
          }
          const width = Math.round(rect.width)
          const height = Math.round(rect.height)
          if (
            Math.abs(width - this.data.cardW) < 1 &&
            Math.abs(height - this.data.cardH) < 1
          ) {
            return
          }
          this.setData({ cardW: width, cardH: height })
        })
        .exec()
    },

    onTap(): void {
      if (!this.data.interactive) {
        return
      }
      const detail: GlassCardTapDetail = {
        tone: this.data.tone as GlassCardTone,
        source: 'glass-card',
      }
      this.triggerEvent('tap', detail)
    },

    onLongPress(): void {
      if (!this.data.interactive) {
        return
      }
      const detail: GlassCardLongPressDetail = {
        tone: this.data.tone as GlassCardTone,
        source: 'glass-card',
      }
      this.triggerEvent('longpress', detail)
    },
  },
})
