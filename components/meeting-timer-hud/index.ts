/* ==========================================================================
   meeting-timer-hud · 全局会议倒计时胶囊
   - 挂在工具壳与主 Tab 页，离开会议倒计时页仍能看到剩余时间与状态
   - 支持自由拖动：位置跨页面与重新启动都会保留，拖完不会挡住内容
   - 计时页自身不显示；结束 20 秒后自动收起；点击回到计时页
   ========================================================================== */
import {
  meetingTimerStore,
  subscribeMeetingTimer,
  syncMeetingTimer,
  type MeetingTimerSnapshot,
} from '../../core/services/meetingTimer'
import { tapTick } from '../../core/utils/haptics'
import { STORAGE_KEYS } from '../../core/constants/index'

const TIMER_ROUTE = 'subpackages/tools-daily/pages/meeting-timer/index'
const FINISHED_HOLD_MS = 20000
const EDGE_PAD = 8
const MIN_TOP = 56
/** 拖动判定阈值：小于该位移视为点击 */
const DRAG_THRESHOLD = 6

/** 当前运行期的悬浮位置：跨页面共享 */
let savedLeft: number | null = null
let savedTop: number | null = null
/** 存储只读一次；之后以内存位置为准，避免每次挂载都读盘 */
let positionLoaded = false

/** 读取跨启动位置；损坏或字段非法时回退 null */
function readStoredPosition(): { left: number; top: number } | null {
  try {
    const raw = wx.getStorageSync(STORAGE_KEYS.meetingTimerHud)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return null
    }
    const record = raw as Record<string, unknown>
    const left = Number(record.left)
    const top = Number(record.top)
    if (!Number.isFinite(left) || !Number.isFinite(top)) {
      return null
    }
    return { left, top }
  } catch {
    return null
  }
}

/** 写跨启动位置；失败静默，不影响拖动 */
function writeStoredPosition(left: number, top: number): void {
  try {
    wx.setStorageSync(STORAGE_KEYS.meetingTimerHud, { left, top })
  } catch {
    /* 存储不可用时只保留当前运行期位置 */
  }
}

interface HudState {
  unsubscribe: (() => void) | null
  hideTimer: number
  dragging: boolean
  moved: boolean
  startX: number
  startY: number
  originLeft: number
  originTop: number
}

interface HudBounds {
  width: number
  height: number
  /** 底部安全区高度（home indicator） */
  safeBottom: number
}

function windowBounds(): HudBounds {
  try {
    const info = wx.getWindowInfo()
    const height = Number(info.windowHeight) || 667
    const safeBottom = info.safeArea
      ? Math.max(0, height - Number(info.safeArea.bottom))
      : 0
    return {
      width: Number(info.windowWidth) || 375,
      height,
      safeBottom,
    }
  } catch {
    return { width: 375, height: 667, safeBottom: 0 }
  }
}

Component({
  data: {
    phase: 'idle',
    remainingText: '00:00',
    visible: false,
    left: 0,
    top: 0,
  },

  lifetimes: {
    attached() {
      const state = this as unknown as HudState
      state.hideTimer = 0
      state.dragging = false
      state.moved = false

      const bounds = windowBounds()
      if (!positionLoaded) {
        positionLoaded = true
        const stored = readStoredPosition()
        if (stored) {
          savedLeft = stored.left
          savedTop = stored.top
        }
      }
      /*
       * 默认停靠左下、Dock 之上：
       * - 右上角是魔法棒 / 微信胶囊 / 主题切换，顶部左侧是返回键，均需避开
       * - 底部中间是自定义 TabBar，左下角保留 16px 边距并抬高到 Dock 上方
       */
      const defaultLeft = EDGE_PAD + 8
      const defaultTop = Math.max(MIN_TOP, bounds.height - bounds.safeBottom - 156)
      this.setData({
        left:
          savedLeft === null
            ? defaultLeft
            : Math.min(bounds.width - 72, Math.max(EDGE_PAD, savedLeft)),
        top:
          savedTop === null
            ? defaultTop
            : Math.min(bounds.height - 96, Math.max(MIN_TOP, savedTop)),
      })

      state.unsubscribe = subscribeMeetingTimer((snapshot) => {
        this.applySnapshot(snapshot)
      })
    },

    detached() {
      const state = this as unknown as HudState
      if (state.unsubscribe) {
        state.unsubscribe()
        state.unsubscribe = null
      }
      if (state.hideTimer) {
        clearTimeout(state.hideTimer)
        state.hideTimer = 0
      }
    },
  },

  pageLifetimes: {
    show() {
      syncMeetingTimer()
      this.refreshVisibility()
    },
  },

  methods: {
    applySnapshot(snapshot: MeetingTimerSnapshot) {
      const state = this as unknown as HudState
      if (snapshot.phase === 'finished') {
        if (!state.hideTimer) {
          state.hideTimer = setTimeout(() => {
            state.hideTimer = 0
            this.refreshVisibility()
          }, FINISHED_HOLD_MS) as unknown as number
        }
      } else if (state.hideTimer) {
        clearTimeout(state.hideTimer)
        state.hideTimer = 0
      }
      const visible = this.computeVisible(snapshot.phase)
      if (
        snapshot.phase !== this.data.phase ||
        snapshot.remainingText !== this.data.remainingText ||
        visible !== this.data.visible
      ) {
        this.setData({
          phase: snapshot.phase,
          remainingText: snapshot.remainingText,
          visible,
        })
      }
    },

    computeVisible(phase: string): boolean {
      if (phase === 'idle') {
        return false
      }
      const pages = getCurrentPages()
      const route = pages.length ? pages[pages.length - 1].route : ''
      if (route === TIMER_ROUTE) {
        return false
      }
      if (phase === 'finished') {
        const finishedAt = meetingTimerStore.finishedAt
        return finishedAt > 0 && Date.now() - finishedAt <= FINISHED_HOLD_MS
      }
      return true
    },

    refreshVisibility() {
      const visible = this.computeVisible(meetingTimerStore.phase)
      if (visible !== this.data.visible) {
        this.setData({ visible })
      }
    },

    onTouchStart(event: WechatMiniprogram.TouchEvent) {
      const touch = event.touches && event.touches[0]
      if (!touch) {
        return
      }
      const state = this as unknown as HudState
      state.dragging = true
      state.moved = false
      state.startX = Number(touch.clientX)
      state.startY = Number(touch.clientY)
      state.originLeft = Number(this.data.left)
      state.originTop = Number(this.data.top)
    },

    onTouchMove(event: WechatMiniprogram.TouchEvent) {
      const state = this as unknown as HudState
      if (!state.dragging) {
        return
      }
      const touch = event.touches && event.touches[0]
      if (!touch) {
        return
      }
      const dx = Number(touch.clientX) - state.startX
      const dy = Number(touch.clientY) - state.startY
      if (!state.moved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) {
        return
      }
      state.moved = true
      const bounds = windowBounds()
      const left = Math.min(
        bounds.width - 72,
        Math.max(EDGE_PAD, state.originLeft + dx),
      )
      const top = Math.min(
        bounds.height - 96,
        Math.max(MIN_TOP, state.originTop + dy),
      )
      this.setData({ left, top })
    },

    onTouchEnd() {
      const state = this as unknown as HudState
      if (!state.dragging) {
        return
      }
      state.dragging = false
      if (!state.moved) {
        this.onOpen()
        return
      }
      savedLeft = Number(this.data.left)
      savedTop = Number(this.data.top)
      writeStoredPosition(savedLeft, savedTop)
    },

    onTouchCancel() {
      const state = this as unknown as HudState
      if (!state.dragging) {
        return
      }
      state.dragging = false
    },

    onOpen() {
      tapTick()
      wx.navigateTo({
        url: `/${TIMER_ROUTE}`,
        fail: () => undefined,
      })
    },
  },
})
