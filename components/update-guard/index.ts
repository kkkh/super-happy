/* ==========================================================================
   update-guard · 全局版本更新守门组件
   - 每个页面（含工具页壳）挂载一次，监听 globalData.hasUpdate
   - 首选 glass-modal，渲染未确认立刻降级 wx.showModal
   - 跨页面 / 跨实例互斥：globalData.promptState + promptOwner
   - blocked=true 时（AES 加密 / 长任务 / 页面自有弹窗）只排队不打断
   ========================================================================== */
import { ACTION_COLORS, ROUTES } from '../../core/constants/index'
import {
  clearUpdatePending,
  holdUpdatePrompt,
  markUpdatePending,
  notifyUpdateGuards,
  readUpdateGlobalData,
  releaseUpdatePrompt,
} from '../../core/services/update'
import { logger } from '../../core/utils/logger'

const UPDATE_MODAL_TITLE = '发现全新极光版本'
const UPDATE_MODAL_DESC = '需重启小程序加载最新引擎。新版本已静默下载完成，重启即可生效。'
const UPDATE_CONFIRM_TEXT = '立即重启'
const UPDATE_CANCEL_TEXT = '稍后'
const UPDATE_EXTRA_TEXT = '查看更新日志'
const UPDATE_MODAL_Z_INDEX = 1300

/** 页面 show 后先让 120ms：等页面 onShow 里的深链 / 弹窗状态先落地 */
const SHOW_SETTLE_MS = 120
/** 只判断“自定义弹窗是否真的渲染出来”，不因用户没点而打断 */
const RENDER_WATCHDOG_MS = 1500
/** glass-modal 退场 220ms + 40ms 余量，原生窗随后出现，绝不叠层 */
const MODAL_EXIT_MS = 260
/** 从未渲染成功时只需让 setData 落地 */
const ABORT_GRACE_MS = 40

let guardSequence = 0

interface UpdateGuardRuntime {
  token: string
  visible: boolean
  destroyed: boolean
  /** 当前实例是否持有全局弹窗锁；页面交棒后必须为 false，旧事件一律短路 */
  active: boolean
  confirmed: boolean
  /** 本次流程是否已收口；重复点击 / 迟到的 close 事件直接忽略 */
  resolved: boolean
  blockerHeld: boolean
  /** 原生弹窗仍在展示；页面隐藏或销毁后仍允许 App 级回调完成重启/稍后 */
  nativeOpen: boolean
  settleTimer: number
  watchdog: number
  fallbackTimer: number
  unsubscribe: (() => void) | null
}

Component({
  options: {
    virtualHost: true,
    styleIsolation: 'isolated',
  },

  properties: {
    /** 高危操作 / 页面自有弹窗：只排队，不呼出 */
    blocked: { type: Boolean, value: false },
  },

  data: {
    modalShow: false,
    modalTitle: UPDATE_MODAL_TITLE,
    modalDesc: UPDATE_MODAL_DESC,
    confirmText: UPDATE_CONFIRM_TEXT,
    cancelText: UPDATE_CANCEL_TEXT,
    extraText: UPDATE_EXTRA_TEXT,
    modalZIndex: UPDATE_MODAL_Z_INDEX,
  },

  lifetimes: {
    attached() {
      const runtime = this as unknown as UpdateGuardRuntime
      guardSequence += 1
      runtime.token = `update-guard-${guardSequence}`
      runtime.visible = false
      runtime.destroyed = false
      runtime.active = false
      runtime.confirmed = false
      runtime.resolved = false
      runtime.blockerHeld = false
      runtime.nativeOpen = false
      runtime.settleTimer = 0
      runtime.watchdog = 0
      runtime.fallbackTimer = 0
      runtime.unsubscribe = null

      this.bindHub()
    },

    detached() {
      const runtime = this as unknown as UpdateGuardRuntime
      runtime.destroyed = true
      runtime.visible = false
      if (runtime.unsubscribe) {
        runtime.unsubscribe()
        runtime.unsubscribe = null
      }
      this.releaseBlocker()
      this.clearTimers()
      if (runtime.active) {
        const hub = readUpdateGlobalData()
        if (hub && hub.promptOwner === runtime.token) {
          /* 页面销毁后回调已失效，必须把全局锁交还给下一个页面 */
          hub.promptState = 'idle'
          hub.promptOwner = ''
          notifyUpdateGuards(hub)
        }
        runtime.active = false
      }
    },
  },

  pageLifetimes: {
    show() {
      const runtime = this as unknown as UpdateGuardRuntime
      if (runtime.destroyed) {
        return
      }
      runtime.visible = true
      /* 极早启动时 getApp() 可能尚未就绪，页面 show 时补绑一次 */
      this.bindHub()
      this.syncBlocker()
      this.schedulePrompt(SHOW_SETTLE_MS)
    },

    hide() {
      this.pausePage()
    },
  },

  observers: {
    blocked() {
      this.syncBlocker()
      const runtime = this as unknown as UpdateGuardRuntime
      if (runtime.visible && !this.data.blocked) {
        /* 页面自有弹窗 / 抽屉需要 220–400ms 退场，等干净了再呼更新窗 */
        this.schedulePrompt(420)
      }
    },
  },

  methods: {
    /** 绑定全局状态广播；重复调用幂等 */
    bindHub(): void {
      const runtime = this as unknown as UpdateGuardRuntime
      if (runtime.destroyed || runtime.unsubscribe) {
        return
      }
      const hub = readUpdateGlobalData()
      if (!hub) {
        return
      }
      const listener = (): void => {
        if (runtime.destroyed || !runtime.visible) {
          return
        }
        this.maybePrompt()
      }
      hub.updateReadyListeners.push(listener)
      runtime.unsubscribe = () => {
        const index = hub.updateReadyListeners.indexOf(listener)
        if (index >= 0) {
          hub.updateReadyListeners.splice(index, 1)
        }
      }
    },

    /* ---- 全局互斥与排队 ---- */
    maybePrompt(): void {
      const runtime = this as unknown as UpdateGuardRuntime
      if (runtime.destroyed || !runtime.visible || runtime.active) {
        return
      }
      if (this.data.blocked) {
        return
      }
      const hub = readUpdateGlobalData()
      if (
        !hub ||
        !hub.hasUpdate ||
        hub.promptState !== 'idle' ||
        hub.blockers > 0 ||
        runtime.nativeOpen
      ) {
        return
      }
      /* 先抢锁，再 setData；任何其他页面随后看到 custom 都会直接退出 */
      hub.promptState = 'custom'
      hub.promptOwner = runtime.token
      runtime.active = true
      runtime.confirmed = false
      runtime.resolved = false
      try {
        this.setData({ modalShow: true })
      } catch (error) {
        logger.error('update-guard', '自定义更新弹窗唤出失败，立即降级原生', error)
        this.fallbackToNative('自定义弹窗唤出异常')
        return
      }
      this.armWatchdog()
    },

    schedulePrompt(delay: number): void {
      const runtime = this as unknown as UpdateGuardRuntime
      if (runtime.settleTimer) {
        clearTimeout(runtime.settleTimer)
      }
      runtime.settleTimer = setTimeout(() => {
        runtime.settleTimer = 0
        if (!runtime.destroyed && runtime.visible) {
          this.maybePrompt()
        }
      }, delay) as unknown as number
    },

    syncBlocker(): void {
      const runtime = this as unknown as UpdateGuardRuntime
      const hub = readUpdateGlobalData()
      if (!hub) {
        return
      }
      const shouldHold = runtime.visible && !runtime.destroyed && Boolean(this.data.blocked)
      if (shouldHold && !runtime.blockerHeld) {
        runtime.blockerHeld = true
        holdUpdatePrompt(hub)
        return
      }
      if (!shouldHold && runtime.blockerHeld) {
        this.releaseBlocker()
      }
    },

    releaseBlocker(): void {
      const runtime = this as unknown as UpdateGuardRuntime
      if (!runtime.blockerHeld) {
        return
      }
      runtime.blockerHeld = false
      const hub = readUpdateGlobalData()
      if (hub) {
        releaseUpdatePrompt(hub)
      }
    },

    /* ---- 自定义弹窗阶段 ---- */
    armWatchdog(): void {
      const runtime = this as unknown as UpdateGuardRuntime
      if (runtime.watchdog) {
        clearTimeout(runtime.watchdog)
      }
      runtime.watchdog = setTimeout(() => {
        runtime.watchdog = 0
        if (
          runtime.destroyed ||
          !runtime.visible ||
          runtime.resolved ||
          runtime.confirmed
        ) {
          return
        }
        this.fallbackToNative('自定义弹窗 1.5s 未确认渲染')
      }, RENDER_WATCHDOG_MS) as unknown as number
    },

    onOpened(): void {
      const runtime = this as unknown as UpdateGuardRuntime
      if (runtime.destroyed || runtime.resolved) {
        return
      }
      runtime.confirmed = true
      if (runtime.watchdog) {
        clearTimeout(runtime.watchdog)
        runtime.watchdog = 0
      }
    },

    onClose(event: WechatMiniprogram.CustomEvent<{ source?: string }>): void {
      const runtime = this as unknown as UpdateGuardRuntime
      /* 交棒给新页面后可能还有排队事件，非当前持有者一律忽略 */
      if (runtime.resolved || !runtime.active) {
        return
      }
      const source =
        event && event.detail && event.detail.source ? event.detail.source : 'unknown'
      /* 遮罩 / 系统关闭等同“稍后”，更新提醒绝不静默丢失 */
      logger.warn('update-guard', `更新弹窗被关闭：${source}`)
      this.deferUpdate()
    },

    /* ---- 原生降级阶段 ---- */
    fallbackToNative(reason: string): void {
      const runtime = this as unknown as UpdateGuardRuntime
      const hub = readUpdateGlobalData()
      if (
        !runtime.active ||
        runtime.resolved ||
        !hub ||
        hub.promptState !== 'custom' ||
        hub.promptOwner !== runtime.token
      ) {
        return
      }
      logger.warn('update-guard', `自定义更新弹窗降级为原生：${reason}`)
      hub.promptState = 'native'
      this.clearWatchdog()
      try {
        this.setData({ modalShow: false })
      } catch (error) {
        logger.warn('update-guard', '降级关闭自定义弹窗失败', error)
      }
      const delay = runtime.confirmed ? MODAL_EXIT_MS : ABORT_GRACE_MS
      runtime.fallbackTimer = setTimeout(() => {
        runtime.fallbackTimer = 0
        if (runtime.destroyed || runtime.resolved || !runtime.active) {
          return
        }
        this.openNative()
      }, delay) as unknown as number
    },

    openNative(): void {
      const runtime = this as unknown as UpdateGuardRuntime
      if (runtime.destroyed || runtime.resolved || runtime.nativeOpen) {
        return
      }
      runtime.nativeOpen = true
      try {
        wx.showModal({
          title: UPDATE_MODAL_TITLE,
          content: UPDATE_MODAL_DESC,
          confirmText: UPDATE_CONFIRM_TEXT,
          cancelText: UPDATE_CANCEL_TEXT,
          confirmColor: ACTION_COLORS.safe,
          success: (result) => {
            if (result.confirm) {
              this.restartForUpdate()
              return
            }
            this.deferUpdate()
          },
          fail: (error) => {
            runtime.nativeOpen = false
            logger.warn('update-guard', '原生更新弹窗呼出失败', error)
            this.dismissTerminal()
            markUpdatePending()
            this.nativeToast('新版本已就绪，请稍后重启小程序')
          },
          complete: () => {
            runtime.nativeOpen = false
          },
        })
      } catch (error) {
        runtime.nativeOpen = false
        logger.error('update-guard', '原生更新弹窗异常', error)
        this.dismissTerminal()
        markUpdatePending()
        this.nativeToast('新版本已就绪，请稍后重启小程序')
      }
    },

    /* ====================================================================
       用户最终选择 · 交棒边界
       - glass-modal 的 confirm/cancel/close/extra 事件可能晚于
         pageLifetimes.hide 到达；必须先校验 active 所有权，
         防止旧页面写红点、抢回锁或影响新页面正在展示的弹窗。
       - 原生 wx.showModal 是 App 级弹窗，页面隐藏/销毁后回调仍可能到达；
         因此 nativeOpen=true 时放行 restart / defer，保证用户点击不丢失。
       ==================================================================== */
    onConfirm(): void {
      this.restartForUpdate()
    },

    onCancel(): void {
      this.deferUpdate()
    },

    onExtra(): void {
      const runtime = this as unknown as UpdateGuardRuntime
      /* 交棒后排队到达的「查看日志」不得触发旧页面导航 */
      if (runtime.resolved || !runtime.active) {
        return
      }
      this.dismissTerminal()
      /* 查看日志同样留下红点，读完日志仍能记得重启 */
      markUpdatePending()
      this.openChangelog()
    },

    restartForUpdate(): void {
      const runtime = this as unknown as UpdateGuardRuntime
      /*
       * 原生弹窗回调在页面隐藏/销毁后仍可能到达：
       * active 已因交棒置 false，但只要 nativeOpen 仍为 true 就允许执行重启。
       */
      if (runtime.resolved || (!runtime.active && !runtime.nativeOpen)) {
        return
      }
      this.dismissTerminal()
      const hub = readUpdateGlobalData()
      const manager = hub ? hub.updateManager : null
      if (!manager) {
        logger.error('update-guard', '更新管理器缺失，无法应用新版本')
        markUpdatePending()
        this.nativeToast('新版本已就绪，请稍后重启小程序')
        return
      }
      clearUpdatePending()
      try {
        manager.applyUpdate()
      } catch (error) {
        logger.error('update-guard', '应用新版本失败', error)
        markUpdatePending()
        this.nativeToast('重启失败，请关闭小程序后重新打开')
      }
    },

    deferUpdate(): void {
      const runtime = this as unknown as UpdateGuardRuntime
      /* 自定义事件必须仍持有锁；原生事件允许在页面隐藏后凭 nativeOpen 收口 */
      if (runtime.resolved || (!runtime.active && !runtime.nativeOpen)) {
        return
      }
      this.dismissTerminal()
      if (!markUpdatePending()) {
        this.nativeToast('待更新提醒保存失败，请尽快重启小程序')
      }
    },

    /* ---- 状态收口 ---- */
    dismissTerminal(): void {
      const runtime = this as unknown as UpdateGuardRuntime
      const hub = readUpdateGlobalData()
      if (hub && hub.promptOwner === runtime.token) {
        hub.promptState = 'dismissed'
        hub.promptOwner = ''
      }
      runtime.active = false
      runtime.resolved = true
      runtime.confirmed = false
      this.clearTimers()
      try {
        this.setData({ modalShow: false })
      } catch (error) {
        logger.warn('update-guard', '关闭更新弹窗失败', error)
      }
    },

    pausePage(): void {
      const runtime = this as unknown as UpdateGuardRuntime
      runtime.visible = false
      this.releaseBlocker()
      const hub = readUpdateGlobalData()
      if (!hub) {
        this.clearTimers()
        return
      }
      /*
       * 原生弹窗仍在前台：不重置状态，等 App 级回调收口。
       * 自定义阶段切页：主动释放锁并交棒；本实例置 active=false，
       * 迟到的 confirm/cancel/close/extra 会在所有权校验处被丢弃。
       */
      if (runtime.active && !runtime.nativeOpen) {
        if (hub.promptOwner === runtime.token) {
          hub.promptState = 'idle'
          hub.promptOwner = ''
        }
        runtime.active = false
        runtime.resolved = false
        runtime.confirmed = false
        this.clearTimers()
        try {
          this.setData({ modalShow: false })
        } catch {
          /* 页面隐藏时关闭失败不影响下一页面重新接棒 */
        }
        notifyUpdateGuards(hub)
        return
      }
      this.clearTimers()
    },

    clearWatchdog(): void {
      const runtime = this as unknown as UpdateGuardRuntime
      if (runtime.watchdog) {
        clearTimeout(runtime.watchdog)
        runtime.watchdog = 0
      }
    },

    clearTimers(): void {
      const runtime = this as unknown as UpdateGuardRuntime
      if (!runtime) {
        return
      }
      this.clearWatchdog()
      if (runtime.settleTimer) {
        clearTimeout(runtime.settleTimer)
        runtime.settleTimer = 0
      }
      if (runtime.fallbackTimer) {
        clearTimeout(runtime.fallbackTimer)
        runtime.fallbackTimer = 0
      }
    },

    openChangelog(): void {
      const target = `${ROUTES.settings}?changelog=1`
      try {
        /* 始终 push 新设置页：当前页若已有输入（口令 / 备份码）不会被 reload 清空 */
        wx.navigateTo({
          url: target,
          fail: () => wx.redirectTo({ url: target }),
        })
      } catch (error) {
        logger.warn('update-guard', '打开更新日志失败', error)
        this.nativeToast('更新日志打开失败，请从设置页进入')
      }
    },

    nativeToast(message: string): void {
      try {
        wx.showToast({ title: message, icon: 'none', duration: 2600 })
      } catch (error) {
        logger.warn('update-guard', '更新兜底提示失败', error)
      }
    },
  },
})
