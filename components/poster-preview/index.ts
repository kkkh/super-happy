/* ==========================================================================
   poster-preview · 极光海报全屏预览
   - 点击即入场：先展示玻璃骨架，Canvas 绘制延后到入场动画落位
   - 图片解码后骨架与海报交叉淡入，不闪黑；成功反馈与揭示同步
   - 保存成功覆盖层停留 1.3 秒，再以 560ms 退场动画平滑关闭
   - 省电模式 / 减少动态只保留透明度渐变
   - 长按图片唤起 ActionSheet；保存前置隐私授权
   ========================================================================== */
import { ensurePrivacyAuthorized } from '../../core/utils/privacy'
import { useHaptics } from '../../core/utils/haptics'
import { showGlassToast } from '../glass-toast/toast'

interface PreviewRuntime {
  openTimer: number
  closeTimer: number
  autoCloseTimer: number
  imageTimer: number
  closeSource: string
}

interface PreviewCloseDetail {
  source: string
}

const CLOSE_DURATION = 560
const IMAGE_FALLBACK_DELAY = 700
/* 让图片先用 opacity:0 实际绘制一帧，再切 ready，保证淡入过渡一定发生 */
const IMAGE_REVEAL_DELAY = 24

Component({
  options: {
    virtualHost: true,
    styleIsolation: 'isolated',
  },

  properties: {
    show: {
      type: Boolean,
      value: false,
    },
    imagePath: {
      type: String,
      value: '',
    },
    /** 生成中：先展示玻璃骨架，避免等待后硬弹出 */
    loading: {
      type: Boolean,
      value: false,
    },
    /** 生成失败提示；为空时使用默认文案 */
    error: {
      type: String,
      value: '',
    },
    /** 省电模式：只做透明度渐变，禁用弹簧位移 */
    saver: {
      type: Boolean,
      value: false,
    },
    zIndex: {
      type: Number,
      value: 1200,
    },
    ariaLabel: {
      type: String,
      value: '极光海报预览',
    },
  },

  data: {
    mounted: false,
    active: false,
    closing: false,
    saving: false,
    imageReady: false,
    saved: false,
  },

  observers: {
    show(value: boolean) {
      if (value) {
        this.openPreview()
      } else if (this.data.mounted && !this.data.closing) {
        this.closePreview()
      }
    },

    imagePath(value: string) {
      const runtime = this as unknown as PreviewRuntime
      if (runtime.imageTimer) {
        clearTimeout(runtime.imageTimer)
        runtime.imageTimer = 0
      }
      this.setData({ imageReady: false, saved: false })
      if (!value) {
        return
      }

      /* 图片 bindload 正常情况下会更快触发；这里是极端兜底，避免骨架永驻 */
      runtime.imageTimer = setTimeout(() => {
        runtime.imageTimer = 0
        this.markImageReady()
      }, IMAGE_FALLBACK_DELAY) as unknown as number
    },
  },

  lifetimes: {
    attached() {
      const runtime = this as unknown as PreviewRuntime
      runtime.openTimer = 0
      runtime.closeTimer = 0
      runtime.autoCloseTimer = 0
      runtime.imageTimer = 0
      runtime.closeSource = 'programmatic'
    },

    detached() {
      const runtime = this as unknown as PreviewRuntime
      if (runtime.openTimer) {
        clearTimeout(runtime.openTimer)
      }
      if (runtime.closeTimer) {
        clearTimeout(runtime.closeTimer)
      }
      if (runtime.autoCloseTimer) {
        clearTimeout(runtime.autoCloseTimer)
      }
      if (runtime.imageTimer) {
        clearTimeout(runtime.imageTimer)
      }
      runtime.openTimer = 0
      runtime.closeTimer = 0
      runtime.autoCloseTimer = 0
      runtime.imageTimer = 0
    },
  },

  methods: {
    openPreview(): void {
      const runtime = this as unknown as PreviewRuntime
      if (runtime.openTimer) {
        clearTimeout(runtime.openTimer)
      }
      if (runtime.closeTimer) {
        clearTimeout(runtime.closeTimer)
        runtime.closeTimer = 0
      }
      if (runtime.autoCloseTimer) {
        clearTimeout(runtime.autoCloseTimer)
        runtime.autoCloseTimer = 0
      }

      this.setData({
        mounted: true,
        active: false,
        closing: false,
        saving: false,
        imageReady: Boolean(this.data.imagePath) && !this.data.loading,
        saved: false,
      })

      runtime.openTimer = setTimeout(() => {
        runtime.openTimer = 0
        this.setData({ active: true })
        /* 已有现成图片时才在打开时反馈；生成流程等图片 onload 再反馈 */
        if (this.data.imageReady) {
          useHaptics().success()
        }
      }, 30) as unknown as number
    },

    closePreview(): void {
      const runtime = this as unknown as PreviewRuntime
      if (!this.data.mounted || this.data.closing) {
        return
      }
      if (runtime.openTimer) {
        clearTimeout(runtime.openTimer)
        runtime.openTimer = 0
      }
      if (runtime.autoCloseTimer) {
        clearTimeout(runtime.autoCloseTimer)
        runtime.autoCloseTimer = 0
      }
      if (runtime.imageTimer) {
        clearTimeout(runtime.imageTimer)
        runtime.imageTimer = 0
      }

      this.setData({ active: false, closing: true })

      runtime.closeTimer = setTimeout(() => {
        runtime.closeTimer = 0
        this.setData({
          mounted: false,
          active: false,
          closing: false,
          saving: false,
          imageReady: false,
          saved: false,
        })
        const detail: PreviewCloseDetail = { source: runtime.closeSource }
        this.triggerEvent('closed', detail)
        runtime.closeSource = 'programmatic'
      }, CLOSE_DURATION) as unknown as number
    },

    requestClose(source: string): void {
      if (!this.data.mounted || this.data.closing) {
        return
      }
      const runtime = this as unknown as PreviewRuntime
      runtime.closeSource = source
      if (source !== 'saved') {
        useHaptics().tick()
      }
      this.triggerEvent('close', { source })
      this.closePreview()
    },

    onMaskTap(): void {
      this.requestClose('mask')
    },

    onCloseTap(): void {
      this.requestClose('close')
    },

    /** 长按海报：直接唤起系统 ActionSheet，再进入统一保存链路 */
    onLongPress(): void {
      if (!this.data.imagePath) {
        return
      }
      wx.showActionSheet({
        itemList: ['保存到相册'],
        success: (result) => {
          if (result.tapIndex === 0) {
            this.savePoster()
          }
        },
        fail: () => {
          /* 用户取消不打扰 */
        },
      })
    },

    onSaveTap(): void {
      this.savePoster()
    },

    /** 分享海报：调起微信原生图片分享面板，分享当前本地海报 */
    onShareTap(): void {
      const path = this.data.imagePath
      if (!path) {
        return
      }
      if (typeof wx.showShareImageMenu !== 'function') {
        useHaptics().warn()
        showGlassToast({
          message: '当前微信版本不支持图片分享，请保存到相册',
          type: 'warning',
          placement: 'lower-center',
        })
        return
      }
      try {
        wx.showShareImageMenu({
          path,
          success: () => {
            /* 原生分享面板由系统接管，不再叠加 Toast */
          },
          fail: (error) => {
            const message = error && error.errMsg ? error.errMsg : ''
            if (message.includes('cancel')) {
              return
            }
            useHaptics().warn()
            showGlassToast({
              message: '分享失败，请稍后重试',
              type: 'error',
              placement: 'lower-center',
            })
          },
        })
      } catch {
        useHaptics().warn()
        showGlassToast({
          message: '分享失败，请稍后重试',
          type: 'error',
          placement: 'lower-center',
        })
      }
    },

    /** 图片真正解码完成：延后一帧切 ready，让骨架与海报完成交叉淡入 */
    onImageLoad(): void {
      const runtime = this as unknown as PreviewRuntime
      if (runtime.imageTimer) {
        clearTimeout(runtime.imageTimer)
        runtime.imageTimer = 0
      }
      runtime.imageTimer = setTimeout(() => {
        runtime.imageTimer = 0
        this.markImageReady()
      }, IMAGE_REVEAL_DELAY) as unknown as number
    },

    /** 统一的揭示入口：骨架淡出、海报淡入、成功反馈 */
    markImageReady(): void {
      if (!this.data.imagePath || this.data.imageReady) {
        return
      }
      this.setData({ imageReady: true })
      if (this.data.mounted) {
        useHaptics().success()
      }
    },

    savePoster(): void {
      /* saved 期间拦截重复保存，让成功覆盖层独占到自动关闭 */
      if (this.data.saving || this.data.saved || !this.data.imagePath) {
        return
      }

      this.setData({ saving: true })
      ensurePrivacyAuthorized()
        .then((authorized) => {
          if (!authorized) {
            this.setData({ saving: false })
            this.showPermissionModal()
            return
          }
          this.writeAlbum()
        })
        .catch(() => {
          this.setData({ saving: false })
          useHaptics().warn()
          showGlassToast({
            message: '保存失败，请稍后重试',
            type: 'error',
            placement: 'lower-center',
          })
        })
    },

    writeAlbum(): void {
      const runtime = this as unknown as PreviewRuntime
      wx.saveImageToPhotosAlbum({
        filePath: this.data.imagePath,
        success: () => {
          this.setData({ saving: false, saved: true })
          useHaptics().success()
          showGlassToast({
            message: '已保存到相册',
            type: 'success',
            placement: 'lower-center',
            tapToDismiss: true,
          })
          runtime.autoCloseTimer = setTimeout(() => {
            runtime.autoCloseTimer = 0
            this.requestClose('saved')
          }, 1300) as unknown as number
        },
        fail: (error) => {
          this.setData({ saving: false })
          const message = error && error.errMsg ? error.errMsg : ''
          if (message.includes('auth') || message.includes('authorize') || message.includes('deny')) {
            this.showPermissionModal()
            return
          }
          useHaptics().warn()
          showGlassToast({
            message: '保存失败，请稍后重试',
            type: 'error',
            placement: 'lower-center',
          })
        },
      })
    },

    /** 相册权限被拒：原生弹窗引导用户去设置页恢复 */
    showPermissionModal(): void {
      useHaptics().warn()
      wx.showModal({
        title: '需要相册权限',
        content: '保存海报需要访问你的相册。请在设置中允许“添加到相册”后重试。',
        confirmText: '去设置',
        cancelText: '暂不',
        success: (result) => {
          if (result.confirm) {
            wx.openSetting({
              fail: () => {
                useHaptics().warn()
                showGlassToast({
                  message: '设置页打开失败',
                  type: 'warning',
                  placement: 'lower-center',
                })
              },
            })
          }
        },
      })
    },

    noop(): void {
      /* 阻断遮罩滚动穿透 */
    },
  },
})
