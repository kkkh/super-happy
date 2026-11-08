/**
 * g-gallery · 视觉档案 + 全屏查看器
 * - 分组缩略墙（懒加载 + 失败占位回退）
 * - 全屏模式：swiper 横滑 · 双击 1x/2.5x 缩放 · 按住拖拽平移 · 长按保存
 * 用法示例：
 *   <g-gallery groups="{{project.gallery}}" tone="{{project.accent}}" />
 */
import type { GalleryGroup } from '../../../../core/types/index'
import { tapSuccess, tapTick, tapWarn } from '../../../../core/utils/haptics'
import { albumFailureMessage, saveImageToAlbum } from '../../../../core/utils/album'
import { uiStore } from '../../../../core/stores/ui'
import { TIMING } from '../../../../core/constants/index'
import { asArray } from '../../../../core/utils/guards'

interface ViewerState {
  open: boolean
  index: number
  zoomed: boolean
  offsetX: number
  offsetY: number
}

interface GalleryRuntime {
  /** 拖拽帧合并定时器：避免每个 touchmove 都跨线程 setData */
  dragTimer: number
  pendingX: number
  pendingY: number
  destroyed: boolean
}

/** 平移边界 */
const PAN_LIMIT = 180

Component({
  properties: {
    groups: { type: Array, value: [] },
    tone: { type: String, value: 'iris' },
    /* 夜航下降低白底截图的亮度，避免缩略墙出现刺眼白块 */
    dark: { type: Boolean, value: false },
  },

  data: {
    viewer: { open: false, index: 0, zoomed: false, offsetX: 0, offsetY: 0 } as ViewerState,
    flatUrls: [] as string[],
    flatTitles: [] as string[],
    viewerCaption: '',
    /* 全屏大图加载失败态：素材缺失时给出明确说明而非空白 */
    viewerError: false,
    /* 防止长按重复触发并发保存 */
    saving: false,
    lastTap: 0,
    dragBaseX: 0,
    dragBaseY: 0,
    dragging: false,
    /* 查看器顶栏起始位置：避开微信胶囊（px） */
    barTop: 104,
  },

  observers: {
    groups() {
      this.syncGroups()
    },
  },

  lifetimes: {
    attached() {
      const state = this as unknown as GalleryRuntime
      state.dragTimer = 0
      state.pendingX = 0
      state.pendingY = 0
      state.destroyed = false
      this.syncGroups()
      const rect = wx.getMenuButtonBoundingClientRect()
      const barTop = Math.max(rect.bottom + 12, 104)
      this.setData({ barTop })
    },
    detached() {
      const state = this as unknown as GalleryRuntime
      state.destroyed = true
      if (state.dragTimer) {
        clearTimeout(state.dragTimer)
        state.dragTimer = 0
      }
    },
  },

  methods: {
    syncGroups() {
      if ((this as unknown as GalleryRuntime).destroyed) {
        return
      }
      const groups = asArray<GalleryGroup>(this.data.groups)
      const urls: string[] = []
      const titles: string[] = []
      for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
        const group = groups[groupIndex]
        const shots = asArray<GalleryGroup['shots'][number]>(group?.shots)
        const title = group?.title ?? `分组 ${groupIndex + 1}`
        for (let shotIndex = 0; shotIndex < shots.length; shotIndex += 1) {
          urls.push(shots[shotIndex]?.img ?? '')
          titles.push(`${groupIndex + 1}.${shotIndex + 1} ${title}`)
        }
      }
      this.setData({ flatUrls: urls, flatTitles: titles })
    },
    /** 打开全屏查看器（组号 × 组内序号 → 扁平下标） */
    openViewer(groupIndex: number, shotIndex: number) {
      const groups = asArray<GalleryGroup>(this.data.groups)
      let flat = 0
      for (let cursor = 0; cursor < groupIndex && cursor < groups.length; cursor += 1) {
        flat += asArray<GalleryGroup['shots'][number]>(groups[cursor]?.shots).length
      }
      flat += shotIndex
      tapTick()
      this.setData({
        viewer: { open: true, index: flat, zoomed: false, offsetX: 0, offsetY: 0 },
        viewerCaption: this.data.flatTitles[flat] ?? '',
        viewerError: false,
      })
    },

    onThumbTap(event: WechatMiniprogram.TouchEvent) {
      const { group, shot } = event.currentTarget.dataset as { group: number; shot: number }
      /* 原实现：直接 openViewer；现保持打开（素材缺失时查看器内给出明确空态，
         仍可左右滑动查看编目与标题，而不是禁用整个入口） */
      this.openViewer(group, shot)
    },

    closeViewer() {
      tapTick()
      this.setData({
        'viewer.open': false,
        'viewer.zoomed': false,
        'viewer.offsetX': 0,
        'viewer.offsetY': 0,
      })
    },

    onSwiperChange(event: WechatMiniprogram.SwiperChange) {
      /* 换页即复位缩放，并同步标题 */
      this.setData({
        'viewer.index': event.detail.current,
        'viewer.zoomed': false,
        'viewer.offsetX': 0,
        'viewer.offsetY': 0,
        viewerCaption: this.data.flatTitles[event.detail.current] ?? '',
        viewerError: false,
      })
    },

    /** 全屏大图加载失败：显示“素材待补”说明 */
    onViewerImageError() {
      this.setData({ viewerError: true })
    },

    /** 双击缩放切换 */
    onImageTap() {
      const now = Date.now()
      if (now - this.data.lastTap > TIMING.DOUBLE_TAP_WINDOW) {
        this.setData({ lastTap: now })
        return
      }
      this.setData({
        lastTap: 0,
        'viewer.zoomed': !this.data.viewer.zoomed,
        'viewer.offsetX': 0,
        'viewer.offsetY': 0,
      })
    },

    onDragStart(event: WechatMiniprogram.TouchEvent) {
      if (!this.data.viewer.zoomed) {
        return
      }
      const state = this as unknown as GalleryRuntime
      const touch = event.touches[0]
      state.pendingX = this.data.viewer.offsetX
      state.pendingY = this.data.viewer.offsetY
      this.setData({
        dragging: true,
        dragBaseX: touch.clientX - state.pendingX,
        dragBaseY: touch.clientY - state.pendingY,
      })
    },

    /**
     * 拖拽状态机：
     * - touchmove 只写 runtime pendingX/Y，不直接 setData，避免每帧跨线程通信；
     * - 首个 move 启动 16ms 定时器，一帧至多一次 setData；
     * - touchend 必须清定时器并 flush 最终偏移，否则最后一小段拖动会丢失；
     * - 定时器回调与 touchend 都检查 destroyed，页面退出后不再触碰 setData。
     */
    onDragMove(event: WechatMiniprogram.TouchEvent) {
      if (!this.data.dragging) {
        return
      }
      const state = this as unknown as GalleryRuntime
      const touch = event.touches[0]
      state.pendingX = Math.max(-PAN_LIMIT, Math.min(PAN_LIMIT, touch.clientX - this.data.dragBaseX))
      state.pendingY = Math.max(-PAN_LIMIT, Math.min(PAN_LIMIT, touch.clientY - this.data.dragBaseY))
      if (state.dragTimer) {
        return
      }
      /* 16ms 合并：一帧最多一次 setData，避免 touchmove 高频跨线程通信 */
      state.dragTimer = setTimeout(() => {
        state.dragTimer = 0
        if (state.destroyed) {
          return
        }
        this.setData({ 'viewer.offsetX': state.pendingX, 'viewer.offsetY': state.pendingY })
      }, TIMING.DRAG_FRAME) as unknown as number
    },

    onDragEnd() {
      const state = this as unknown as GalleryRuntime
      if (state.dragTimer) {
        clearTimeout(state.dragTimer)
        state.dragTimer = 0
      }
      if (state.destroyed) {
        return
      }
      this.setData({
        dragging: false,
        'viewer.offsetX': state.pendingX,
        'viewer.offsetY': state.pendingY,
      })
    },

    /**
     * 长按保存当前图
     * 原实现（保留以便回溯）：
     *   非云图直接 wx.saveImageToPhotosAlbum({ filePath: url, ... })
     *   云图 wx.cloud.downloadFile({ fileID: url, ... }) 后再保存
     * 现统一走 saveImageToAlbum：包内路径落地、云能力缺失提示、授权拒绝 showModal→openSetting→重试
     */
    async onLongPress() {
      if (this.data.saving) {
        return
      }
      const url = this.data.flatUrls[this.data.viewer.index] as string | undefined
      if (!url) {
        return
      }
      /* 长按识别即给轻震，保存完成后再给成功/失败震动 */
      tapTick()
      this.setData({ saving: true })
      const runtime = this as unknown as GalleryRuntime
      try {
        const result = await saveImageToAlbum(url)
        if (runtime.destroyed) {
          return
        }
        if (result.ok) {
          tapSuccess()
          uiStore.showToast('已保存到相册')
        } else {
          tapWarn()
          uiStore.showToast(albumFailureMessage(result))
        }
      } catch {
        if (runtime.destroyed) {
          return
        }
        tapWarn()
        uiStore.showToast('保存失败，请重试')
      } finally {
        if (!runtime.destroyed) {
          this.setData({ saving: false })
        }
      }
    },

    /** 缩略图加载失败：以 tone 色块优雅降级（保留占位不塌陷） */
    onShotError(event: WechatMiniprogram.TouchEvent) {
      if ((this as unknown as GalleryRuntime).destroyed) {
        return
      }
      const { gi, si } = event.currentTarget.dataset as { gi: number; si: number }
      this.setData({ [`groups[${gi}].shots[${si}].error`]: true })
    },
  },
})
