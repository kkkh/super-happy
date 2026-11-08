/* ==========================================================================
   Glass Toast 3.0 · 全局轻提示服务
   - 单例 toastStore：当前消息 + 队列 + 自动消隐
   - 不使用 wx.showToast；由 glass-toast 组件渲染毛玻璃提示
   - 支持 info / success / warning / error / loading
   - 位置支持 top / center / lower-center / bottom
   - 提供 showGlassToast / hideGlassToast / clearGlassToasts
   - 提供 mountGlassToast 与 glassToastBehavior 两种 this.$toast() 挂载方式
   ========================================================================== */
import { observable } from 'mobx-miniprogram'

export type GlassToastType = 'info' | 'success' | 'warning' | 'error' | 'loading'
export type GlassToastPlacement = 'top' | 'center' | 'lower-center' | 'bottom'

export interface GlassToastOptions {
  /** 必填：提示文案 */
  message: string
  /** 语义类型 */
  type?: GlassToastType
  /** 显示时长，0 表示不自动关闭；loading 默认 0 */
  duration?: number
  /** 屏幕位置 */
  placement?: GlassToastPlacement
  /** 是否显示全屏遮罩，loading 默认 true */
  mask?: boolean
  /** 是否允许点击提示关闭 */
  tapToDismiss?: boolean
  /** 自定义图标字符；loading 仍使用菊花 */
  icon?: string
  /** 自定义 id，用于定向关闭 */
  id?: string
  /** 关闭完成后的回调 */
  onClose?: () => void
  /** 动作按钮文案，如「撤销」；与 onAction 必须同时提供 */
  actionLabel?: string
  /** 动作回调：仅在用户点击动作按钮时触发，超时关闭不会触发 */
  onAction?: () => void
}

export interface GlassToastItem {
  id: string
  message: string
  type: GlassToastType
  duration: number
  placement: GlassToastPlacement
  mask: boolean
  tapToDismiss: boolean
  icon: string
  createdAt: number
  onClose?: () => void
  actionLabel: string
  onAction?: () => void
}

export interface GlassToastHost {
  $toast: (options: string | GlassToastOptions) => string
  $hideToast: (id?: string) => void
  $clearToast: () => void
}

const DEFAULT_DURATION = 2200
const MAX_DURATION = 8000
const EXIT_DURATION = 260
const MAX_QUEUE = 5
/** 动作文案最多 6 字，防止长文案撑爆胶囊 */
const MAX_ACTION_LABEL = 6

const TYPE_ICONS: Record<GlassToastType, string> = {
  info: 'i',
  success: '✓',
  warning: '!',
  error: '×',
  loading: '',
}

const TOAST_TYPES: GlassToastType[] = ['info', 'success', 'warning', 'error', 'loading']
const PLACEMENTS: GlassToastPlacement[] = ['top', 'center', 'lower-center', 'bottom']

let toastSequence = 0

function isToastType(value: unknown): value is GlassToastType {
  return typeof value === 'string' && TOAST_TYPES.includes(value as GlassToastType)
}

function isPlacement(value: unknown): value is GlassToastPlacement {
  return typeof value === 'string' && PLACEMENTS.includes(value as GlassToastPlacement)
}

function normalizeToast(input: string | GlassToastOptions): GlassToastItem | null {
  const options: GlassToastOptions = typeof input === 'string' ? { message: input } : input
  const message = options.message.trim()

  if (!message) {
    return null
  }

  const type: GlassToastType = options.type && isToastType(options.type) ? options.type : 'info'
  const placement: GlassToastPlacement =
    options.placement && isPlacement(options.placement)
      ? options.placement
      : type === 'loading'
        ? 'center'
        : 'bottom'

  const rawDuration =
    typeof options.duration === 'number' && Number.isFinite(options.duration)
      ? options.duration
      : type === 'loading'
        ? 0
        : DEFAULT_DURATION
  const duration = Math.max(0, Math.min(MAX_DURATION, Math.floor(rawDuration)))

  /* 动作按钮必须同时具备文案与回调，否则视为普通 toast */
  const actionLabel =
    typeof options.onAction === 'function' && typeof options.actionLabel === 'string'
      ? Array.from(options.actionLabel.trim()).slice(0, MAX_ACTION_LABEL).join('')
      : ''

  return {
    id: options.id && options.id.trim() ? options.id.trim() : `glass-toast-${toastSequence += 1}`,
    message,
    type,
    duration,
    placement,
    mask: typeof options.mask === 'boolean' ? options.mask : type === 'loading',
    tapToDismiss: typeof options.tapToDismiss === 'boolean' ? options.tapToDismiss : false,
    icon: typeof options.icon === 'string' && options.icon ? options.icon : TYPE_ICONS[type],
    createdAt: Date.now(),
    onClose: options.onClose,
    actionLabel,
    onAction: actionLabel ? options.onAction : undefined,
  }
}

function notifyClose(item: GlassToastItem | null): void {
  if (!item || typeof item.onClose !== 'function') {
    return
  }
  try {
    item.onClose()
  } catch {
    /* 关闭回调异常不影响后续队列 */
  }
}

export const toastStore = observable({
  current: null as GlassToastItem | null,
  queue: [] as GlassToastItem[],
  visible: false,
  timer: 0,
  exitTimer: 0,

  get hasToast(): boolean {
    return this.current !== null
  },

  /** 入队并返回 toast id；空文案返回空字符串 */
  show(input: string | GlassToastOptions): string {
    const item = normalizeToast(input)
    if (!item) {
      return ''
    }

    if (this.current && this.current.id === item.id) {
      return item.id
    }
    if (this.queue.some((queued) => queued.id === item.id)) {
      return item.id
    }

    if (!this.current) {
      this.play(item)
      return item.id
    }

    this.queue.push(item)
    if (this.queue.length > MAX_QUEUE) {
      const dropped = this.queue.shift()
      notifyClose(dropped ?? null)
    }
    return item.id
  },

  play(item: GlassToastItem): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = 0
    }
    if (this.exitTimer) {
      clearTimeout(this.exitTimer)
      this.exitTimer = 0
    }

    this.current = item
    this.visible = true

    if (item.duration > 0) {
      this.timer = setTimeout(() => {
        this.timer = 0
        this.hide(item.id)
      }, item.duration) as unknown as number
    }
  },

  /**
   * 关闭当前或指定 toast：
   * - 不带 id：关闭当前
   * - 带 id 且匹配当前：关闭当前
   * - 带 id 但只在队列：从队列移除
   */
  hide(id?: string): void {
    if (!this.current) {
      return
    }

    if (id && this.current.id !== id) {
      this.queue = this.queue.filter((queued) => queued.id !== id)
      return
    }

    if (this.exitTimer) {
      return
    }

    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = 0
    }

    const finished = this.current
    this.visible = false

    this.exitTimer = setTimeout(() => {
      this.exitTimer = 0
      this.current = null
      this.visible = false
      notifyClose(finished)

      const next = this.queue.shift()
      if (next) {
        this.play(next)
      }
    }, EXIT_DURATION) as unknown as number
  },

  /** 清空队列并关闭当前 */
  clear(): void {
    this.queue = []
    this.hide()
  },
})

export function showGlassToast(input: string | GlassToastOptions): string {
  return toastStore.show(input)
}

export function hideGlassToast(id?: string): void {
  toastStore.hide(id)
}

export function clearGlassToasts(): void {
  toastStore.clear()
}

/** 把 $toast 方法挂到页面 / 组件实例上；在 onLoad / attached 调用一次 */
export function mountGlassToast(target: GlassToastHost): GlassToastHost {
  target.$toast = showGlassToast
  target.$hideToast = hideGlassToast
  target.$clearToast = clearGlassToasts
  return target
}
