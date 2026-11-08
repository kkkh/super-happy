/**
 * glass-bottom-sheet · 极光底部抽屉
 * - 超大顶部圆角 + 弹簧滑出 / 收起
 * - 遮罩 catchtouchmove 防滚动穿透
 * - 拖拽手势由 WXS 采样并直接 setStyle，松手后按阈值决定关闭或回弹
 * - 安全区：底部自动追加 env(safe-area-inset-bottom)
 * - virtualHost + styleIsolation，样式不污染页面
 *
 * 用法：
 *   <glass-bottom-sheet
 *     show="{{sheetShow}}"
 *     title="选择工具"
 *     bind:close="onSheetClose"
 *   >
 *     <view>抽屉内容</view>
 *   </glass-bottom-sheet>
 */

export type GlassSheetSize = 'auto' | 'half' | 'tall' | 'full'
export type GlassSheetCloseSource = 'mask' | 'close' | 'swipe' | 'programmatic'

export interface GlassSheetCloseDetail {
  source: GlassSheetCloseSource
}

export interface GlassSheetClosedDetail {
  source: GlassSheetCloseSource
}

interface SheetRuntime {
  openTimer: number
  closeTimer: number
  openedTimer: number
}

const OPEN_DELAY = 30
const OPEN_DURATION = 420
const CLOSE_DURATION = 400

Component({
  options: {
    virtualHost: true,
    multipleSlots: true,
    styleIsolation: 'isolated',
    addGlobalClass: false,
  },

  externalClasses: ['custom-class'],

  properties: {
    /** 受控显示 */
    show: {
      type: Boolean,
      value: false,
    },
    /** 标题 */
    title: {
      type: String,
      value: '',
    },
    /** 副标题 / 说明 */
    description: {
      type: String,
      value: '',
    },
    /** 高度策略 */
    size: {
      type: String,
      value: 'auto',
    },
    /** 点击遮罩关闭 */
    maskClosable: {
      type: Boolean,
      value: true,
    },
    /** 显示关闭按钮 */
    showClose: {
      type: Boolean,
      value: true,
    },
    /** 显示拖拽把手 */
    showHandle: {
      type: Boolean,
      value: true,
    },
    /** 显示 footer 插槽 */
    showFooter: {
      type: Boolean,
      value: false,
    },
    /** 下滑关闭阈值，px */
    dismissThreshold: {
      type: Number,
      value: 120,
    },
    /** 层级 */
    zIndex: {
      type: Number,
      value: 200,
    },
    /** 读屏标签 */
    ariaLabel: {
      type: String,
      value: '底部面板',
    },
    /** 外部布局样式 */
    customStyle: {
      type: String,
      value: '',
    },
  },

  data: {
    visible: false,
    active: false,
    closing: false,
    startY: 0,
  },

  observers: {
    show(value: boolean) {
      if (value) {
        this.openSheet(false)
      } else {
        this.closeSheet('programmatic', false)
      }
    },
  },

  lifetimes: {
    attached() {
      const runtime = this as unknown as SheetRuntime
      runtime.openTimer = 0
      runtime.closeTimer = 0
      runtime.openedTimer = 0

      if (this.data.show) {
        this.openSheet(false)
      }
    },

    detached() {
      const runtime = this as unknown as SheetRuntime
      if (runtime.openTimer) {
        clearTimeout(runtime.openTimer)
        runtime.openTimer = 0
      }
      if (runtime.closeTimer) {
        clearTimeout(runtime.closeTimer)
        runtime.closeTimer = 0
      }
      if (runtime.openedTimer) {
        clearTimeout(runtime.openedTimer)
        runtime.openedTimer = 0
      }
    },
  },

  methods: {
    openSheet(emit: boolean): void {
      const runtime = this as unknown as SheetRuntime

      if (runtime.openTimer) {
        clearTimeout(runtime.openTimer)
        runtime.openTimer = 0
      }
      if (runtime.openedTimer) {
        clearTimeout(runtime.openedTimer)
        runtime.openedTimer = 0
      }
      if (runtime.closeTimer) {
        clearTimeout(runtime.closeTimer)
        runtime.closeTimer = 0
      }

      if (this.data.visible && !this.data.closing) {
        return
      }

      this.setData({
        visible: true,
        active: false,
        closing: false,
        startY: 0,
      })

      runtime.openTimer = setTimeout(() => {
        runtime.openTimer = 0
        this.setData({ active: true })

        if (emit) {
          this.triggerEvent('open')
        }

        runtime.openedTimer = setTimeout(() => {
          runtime.openedTimer = 0
          this.triggerEvent('opened')
        }, OPEN_DURATION) as unknown as number
      }, OPEN_DELAY) as unknown as number
    },

    closeSheet(source: GlassSheetCloseSource, emit: boolean): void {
      const runtime = this as unknown as SheetRuntime

      if (!this.data.visible || this.data.closing) {
        return
      }

      if (runtime.openTimer) {
        clearTimeout(runtime.openTimer)
        runtime.openTimer = 0
      }
      if (runtime.openedTimer) {
        clearTimeout(runtime.openedTimer)
        runtime.openedTimer = 0
      }

      this.setData({
        active: false,
        closing: true,
      })

      if (emit) {
        const detail: GlassSheetCloseDetail = { source }
        this.triggerEvent('close', detail)
      }

      runtime.closeTimer = setTimeout(() => {
        runtime.closeTimer = 0
        this.setData({
          visible: false,
          active: false,
          closing: false,
          startY: 0,
        })

        const detail: GlassSheetClosedDetail = { source }
        this.triggerEvent('closed', detail)
      }, CLOSE_DURATION) as unknown as number
    },

    onMaskTap(): void {
      if (!this.data.maskClosable) {
        return
      }
      this.closeSheet('mask', true)
    },

    onCloseTap(): void {
      this.closeSheet('close', true)
    },

    onDragStart(event: WechatMiniprogram.TouchEvent): void {
      /* WXS 已在 onDragStart 内记录起点；此方法保留给旧调用方兼容 */
      const touch = event.touches[0]
      if (!touch) {
        return
      }
    },

    /** WXS 判定：下滑超过阈值 */
    onSheetSwipeClose(): void {
      this.closeSheet('swipe', true)
    },

    /** WXS 判定：未超过阈值，已由 WXS 回弹 */
    onSheetSwipeCancel(): void {
      this.setData({ startY: 0 })
    },

    noop(): void {
      /* 阻断滚动穿透 */
    },
  },
})
