/* ==========================================================================
   个人简介 · 身份 · 信条 · 社交坐标 · 名片生成器
   名片：Canvas 2D 手绘曜石质感卡片（渐变光斑/圆角胶囊/二维码/头像圆形裁剪）
   ========================================================================== */
import { createStoreBindings } from 'mobx-miniprogram-bindings'
import { uiStore } from '../../../../core/stores/ui'
import { fontScaleClass, syncFontScaleClass } from '../../../../core/services/font-scale'
import { resumeStore } from '../../../../core/stores/resume'
import { fetchContactLinks } from '../../../../core/services/resume'
import { paletteFor, TIMING } from '../../../../core/constants/index'
import {
  CARD_H,
  CARD_W,
  computeCardDisplaySize,
  drawAvatar,
  drawAvatarFallback,
  drawCardBase,
  maxCardHeightFor,
  type CardDrawHooks,
  type DrawCtx,
} from '../../lib/card'
import { logger } from '../../../../core/utils/logger'
import { copyText } from '../../../../core/services/feedback'
import { isDevtools } from '../../../../core/utils/platform'
import { tapSuccess, tapTick, tapWarn } from '../../../../core/utils/haptics'
import { albumFailureMessage, saveImageToAlbum } from '../../../../core/utils/album'
import type { ContactLink, Profile } from '../../../../core/types/index'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'

interface ProfileState {
  themeBindings?: { destroyStoreBindings: () => void }
  cardNode?: WechatMiniprogram.Canvas | null
  cardReady?: boolean
  /** 弹层布局完成后延迟取 Canvas 节点；页面卸载 / 关闭弹层时必须清理 */
  cardTimer?: number
  /** 页面是否已卸载：阻止异步 Canvas 回调在销毁后继续 setData */
  destroyed?: boolean
  /* 页面方法签名（Page 泛型的 CustomInstance 契约） */
  onCopyEmail(): void
  onOpenCard(): void
  onCloseCard(): void
  noop(): void
  renderCard(): void
  handleCardError(error: unknown): void
  onSaveCard(): void
  onOpenQr(event: WechatMiniprogram.TouchEvent): void
  onCloseQr(): void
  onPreviewQr(): void
  onSaveQr(): void
}

interface ProfileData {
  profile: Profile | null
  links: ContactLink[]
  themeClass: string
  fsClass: string
  cardShow: boolean
  cardRendering: boolean
  cardSaving: boolean
  cardCanvasH: number
  cardCanvasW: number
  /** 开发者工具不支持 Skyline Canvas，名片预览降级为提示 */
  cardDevtools: boolean
  qrShow: boolean
  qrUrl: string
  qrTitle: string
  qrSaving: boolean
}

/** 静默删除临时文件，避免导出文件在用户目录堆积 */
function unlinkQuietly(filePath: string): void {
  if (!filePath) {
    return
  }
  try {
    wx.getFileSystemManager().unlink({ filePath, fail: () => undefined })
  } catch {
    // 文件系统不可用时忽略清理
  }
}

Page<ProfileData, ProfileState>({
  /* 此处是处理全局分享与深链参数校验的边界 */
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    profile: null,
    links: [] as ContactLink[],
    themeClass: '',
    fsClass: fontScaleClass(),
    cardShow: false,
    cardRendering: false,
    cardSaving: false,
    cardCanvasH: 0,
    cardCanvasW: 0,
    cardDevtools: false,
    qrShow: false,
    qrUrl: '',
    qrTitle: '',
    qrSaving: false,
  },

  onLoad() {
    const state = this as unknown as ProfileState
    state.cardNode = null
    state.cardReady = false
    state.cardTimer = 0
    state.destroyed = false
    state.themeBindings = createStoreBindings(this, {
      store: uiStore,
      fields: {
        themeClass: () => uiStore.themeClass,
      },
      actions: [],
    })
    /* 兜底确保领域数据就绪（主页启动已预取，此处幂等） */
    resumeStore
      .bootstrap()
      .then(() => {
        if (state.destroyed) {
          return
        }
        this.setData({ profile: resumeStore.profile })
      })
      .catch((error) => {
        logger.error('profile', '简历数据装载失败', error)
        if (state.destroyed) {
          return
        }
        uiStore.showToast('简历数据加载失败，请稍后重试')
      })
    fetchContactLinks()
      .then((result: { ok: boolean; data?: ContactLink[] }) => {
        if (state.destroyed) {
          return
        }
        if (result.ok && result.data) {
          this.setData({ links: result.data })
        } else {
          uiStore.showToast('联系信息加载失败，请稍后重试')
        }
      })
      .catch((error) => {
        logger.error('profile', '联系信息装载失败', error)
        if (state.destroyed) {
          return
        }
        uiStore.showToast('联系信息加载失败，请稍后重试')
      })
  },

  onShow() {
    this.setData({ fsClass: syncFontScaleClass() })
  },

  onUnload() {
    const state = this as unknown as ProfileState
    state.destroyed = true
    if (state.cardTimer) {
      clearTimeout(state.cardTimer)
      state.cardTimer = 0
    }
    state.cardNode = null
    state.cardReady = false
    if (state.themeBindings) {
      state.themeBindings.destroyStoreBindings()
    }
  },

  /* ---- 邮箱复制 ---- */
  onCopyEmail() {
    if (!this.data.profile) {
      return
    }
    tapTick()
    void copyText(this.data.profile.email, '邮箱已复制')
  },

  /* ---- 名片生成 ---- */
  onOpenCard() {
    tapTick()
    const state = this as unknown as ProfileState
    /* 每次打开都重置就绪态，避免沿用上一次已销毁的画布节点 */
    state.cardReady = false
    if (state.cardTimer) {
      clearTimeout(state.cardTimer)
      state.cardTimer = 0
    }
    const devtools = isDevtools()
    const size = computeCardDisplaySize()
    this.setData({
      cardShow: true,
      cardRendering: !devtools,
      cardDevtools: devtools,
      cardCanvasW: size.width,
      cardCanvasH: size.height,
    })
    if (devtools) {
      /* 提示已在弹层内呈现，避免 toast 与保存按钮重叠 */
      return
    }
    /* 等弹层布局完成再取节点；计时器由 onCloseCard / onUnload 清理 */
    state.cardTimer = setTimeout(() => {
      state.cardTimer = 0
      this.renderCard()
    }, TIMING.CARD_RENDER_DELAY) as unknown as number
  },

  onCloseCard() {
    const state = this as unknown as ProfileState
    if (state.cardTimer) {
      clearTimeout(state.cardTimer)
      state.cardTimer = 0
    }
    state.cardNode = null
    state.cardReady = false
    this.setData({ cardShow: false, cardRendering: false })
  },

  /** 阻断弹层内容点击冒泡 */
  noop() {
    /* intentional */
  },

  renderCard() {
    /* 弹层已关闭则跳过绘制，避免操作已销毁的画布节点 */
    if (!this.data.cardShow) {
      return
    }
    const profile = this.data.profile
    if (!profile) {
      this.setData({ cardRendering: false })
      return
    }
    this.createSelectorQuery()
      .select('#card-canvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        const first = res[0] as { node?: WechatMiniprogram.Canvas; width: number; height: number } | null
        if (!first || !first.node) {
          this.setData({ cardRendering: false })
          logger.warn('profile', '名片画布不可用')
          return
        }
        const state = this as unknown as ProfileState
        if (state.destroyed || !this.data.cardShow) {
          return
        }
        const canvas = first.node
        const ctx = canvas.getContext('2d') as unknown as DrawCtx | null
        if (!ctx) {
          state.cardNode = null
          state.cardReady = false
          this.setData({ cardRendering: false })
          logger.warn('profile', '名片画布上下文不可用')
          uiStore.showToast('名片画布不可用，请稍后重试')
          return
        }
        state.cardNode = canvas
        const dpr = wx.getWindowInfo().pixelRatio
        /* 等比适配：显示宽取画布节点宽度，显示高按 340:540 推导；
           同时限制在窗口高度 52% 内，避免名片撑满整屏
           绘制坐标恒为逻辑 340×540 */
        const cssW = first.width || this.data.cardCanvasW || 300
        const maxH = maxCardHeightFor(wx.getWindowInfo().windowHeight)
        const rawH = (cssW * CARD_H) / CARD_W
        const cssH = Math.min(rawH, maxH)
        const finalW = rawH > maxH ? (cssH * CARD_W) / CARD_H : cssW
        this.setData({
          cardCanvasH: Math.round(cssH),
          cardCanvasW: Math.round(finalW),
        })
        canvas.width = Math.round(finalW * dpr)
        canvas.height = Math.round(cssH * dpr)
        ctx.scale((finalW / CARD_W) * dpr, (cssH / CARD_H) * dpr)

        /* 名片固定曜石深色（品牌件，与应用主题解耦） */
        const palette = paletteFor('dark')
        const hooks: CardDrawHooks = {
          isDestroyed: () => state.destroyed || !this.data.cardShow,
          onReady: () => {
            this.setData({ cardRendering: false })
            state.cardReady = true
          },
          onError: (error) => this.handleCardError(error),
        }
        drawCardBase(ctx, palette)

        /* 头像（圆形裁剪 + 光环；缺失时渐变圆替代） */
        try {
          const avatarImg = canvas.createImage()
          avatarImg.onload = () => {
            if (hooks.isDestroyed()) {
              return
            }
            try {
              drawAvatar(ctx, palette, avatarImg, profile, canvas, hooks)
            } catch (error) {
              this.handleCardError(error)
            }
          }
          avatarImg.onerror = () => {
            if (hooks.isDestroyed()) {
              return
            }
            try {
              drawAvatarFallback(ctx, palette, profile, canvas, hooks)
            } catch (error) {
              this.handleCardError(error)
            }
          }
          avatarImg.src = profile.avatar || '/subpackages/grow/assets/img/avatar.jpg'
        } catch (error) {
          this.handleCardError(error)
        }
      })
  },

  /** 名片绘制失败：统一收口，避免 Promise / Canvas 回调异常逃逸 */
  handleCardError(error: unknown) {
    const state = this as unknown as ProfileState
    if (state.destroyed) {
      return
    }
    state.cardReady = false
    this.setData({ cardRendering: false })
    logger.error('profile', '名片绘制失败', error)
    uiStore.showToast('名片生成失败，请重试')
  },

  /* ---- 名片保存 ---- */
  /*
   * 原实现：wx.canvasToTempFilePath → wx.saveImageToPhotosAlbum；
   * 授权失败时直接 wx.openSetting（缺少 showModal 说明与授权后自动重试）。
   * 现统一走 saveImageToAlbum，补齐授权补救链路。
   */
  onSaveCard() {
    const state = this as unknown as ProfileState
    if (this.data.cardDevtools) {
      uiStore.showToast('名片导出需在真机预览')
      return
    }
    if (this.data.cardSaving || this.data.cardRendering || !state.cardReady) {
      return
    }
    this.setData({ cardSaving: true })
    const canvas = state.cardNode
    if (!canvas) {
      this.setData({ cardSaving: false })
      uiStore.showToast('画布不可用')
      return
    }
    wx.canvasToTempFilePath({
      canvas,
      success: (exportedCard) => {
        if (state.destroyed) {
          unlinkQuietly(exportedCard.tempFilePath)
          return
        }
        saveImageToAlbum(exportedCard.tempFilePath)
          .then((result) => {
            unlinkQuietly(exportedCard.tempFilePath)
            if (state.destroyed) {
              return
            }
            this.setData({ cardSaving: false })
            if (result.ok) {
              tapSuccess()
              uiStore.showToast('名片已保存到相册')
            } else {
              tapWarn()
              uiStore.showToast(albumFailureMessage(result))
            }
          })
          .catch((error) => {
            unlinkQuietly(exportedCard.tempFilePath)
            if (state.destroyed) {
              return
            }
            this.setData({ cardSaving: false })
            logger.error('profile', '名片保存异常', error)
            tapWarn()
            uiStore.showToast('名片保存失败，请重试')
          })
      },
      fail: () => {
        if (state.destroyed) {
          return
        }
        this.setData({ cardSaving: false })
        tapWarn()
        uiStore.showToast('导出未完成')
      },
    })
  },

  /* ---- 二维码 ---- */
  onOpenQr(event: WechatMiniprogram.TouchEvent) {
    tapTick()
    const { id } = event.currentTarget.dataset as { id: string }
    const link = this.data.links.find((l) => l.id === id)
    if (!link) {
      return
    }
    this.setData({ qrShow: true, qrUrl: link.qr, qrTitle: link.label })
  },

  onCloseQr() {
    this.setData({ qrShow: false })
  },

  onPreviewQr() {
    if (!this.data.qrUrl) {
      return
    }
    tapTick()
    wx.previewImage({
      urls: [this.data.qrUrl],
      fail: () => {
        tapWarn()
        uiStore.showToast('二维码预览失败，请重试')
      },
    })
  },

  /* 原实现：直接 wx.saveImageToPhotosAlbum({ filePath: this.data.qrUrl })，
     包内路径与授权拒绝场景均会失败；现统一走 saveImageToAlbum */
  onSaveQr() {
    const state = this as unknown as ProfileState
    if (this.data.qrSaving || !this.data.qrUrl) {
      return
    }
    this.setData({ qrSaving: true })
    saveImageToAlbum(this.data.qrUrl)
      .then((result) => {
        if (state.destroyed) {
          return
        }
        this.setData({ qrSaving: false })
        if (result.ok) {
          tapSuccess()
          uiStore.showToast('已保存到相册')
        } else {
          tapWarn()
          uiStore.showToast(albumFailureMessage(result))
        }
      })
      .catch((error) => {
        if (state.destroyed) {
          return
        }
        this.setData({ qrSaving: false })
        logger.error('profile', '二维码保存异常', error)
        tapWarn()
        uiStore.showToast('二维码保存失败，请重试')
      })
  },
})
