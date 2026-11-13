/* ==========================================================================
   subpackages/life/pages/focus · 全息专注引擎页面
   - 纯时间戳计时：setTimeout 250ms 重算，绝不递减累计
   - FSM / 存储 / 音频 / 星云全部由 lib 纯模块承载，页面只做编排
   - 亮度 original / owned 兜底；onHide / onUnload 幂等恢复
   - update-guard 在专注 / 抽屉 / 战报 / 海报期间 blocked
   ========================================================================== */
import { createStoreBindings } from 'mobx-miniprogram-bindings'
import { reaction } from 'mobx-miniprogram'
import { uiStore } from '../../../../core/stores/ui'
import { preferenceStore } from '../../../../core/stores/preference'
import { useMotion } from '../../../../core/services/motion'
import { historyStore } from '../../../../core/stores/history'
import { ROUTES } from '../../../../core/constants/index'
import { logger } from '../../../../core/utils/logger'
import { isDevtools } from '../../../../core/utils/platform'
import { tapSuccess, tapTick, tapWarn } from '../../../../core/utils/haptics'
import { showGlassToast } from '../../../../components/glass-toast/toast'
import type { PosterPayload } from '../../../../components/poster-generator/index'
import {
  completeFocusSession,
  createFocusSession,
  finishBreakSession,
  finishOverheatSession,
  focusRemainingMs,
  isLongBreakSession,
  markFocusBreach,
  markFocusHeartbeat,
  pauseFocusSession,
  restoreFocusSession,
  resumeFocusSession,
  type FocusCompletion,
} from '../../lib/focus-fsm'
import {
  appendFocusRecord,
  buildFocusRecord,
  clearFocusBrightness,
  clearFocusSession,
  createEmptyFocusStats,
  defaultFocusPrefs,
  ensureFocusKeyAsync,
  loadFocusBrightness,
  loadFocusLedger,
  loadFocusPrefs,
  loadFocusSession,
  loadFocusStats,
  readFocusKey,
  saveFocusBrightness,
  saveFocusPrefs,
  saveFocusSession,
  saveFocusStats,
  settleFocusRecord,
} from '../../lib/focus-storage'
import {
  formatLocalDate,
  levelFromFocusMs,
  levelLabel,
} from '../../lib/focus-level'
import {
  FocusAudioEngine,
  FocusBgmController,
} from '../../lib/focus-audio'
import {
  createNebulaScene,
  nebulaSummary,
  renderNebulaScene,
  type NebulaContextLike,
  type NebulaScene,
} from '../../lib/focus-nebula'
import type {
  FocusPrefs,
  FocusRecord,
  FocusSession,
  FocusStats,
  FocusTrack,
} from '../../lib/focus-types'

type ToastType = 'info' | 'success' | 'warning' | 'error' | 'loading'
type ModalAction = 'give-up' | 'skip-break' | null

interface StoreBindingsLike {
  destroyStoreBindings: () => void
}

interface FocusRingContext {
  globalAlpha: number
  fillStyle: unknown
  strokeStyle: unknown
  lineWidth: number
  lineCap: string
  setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => void
  clearRect: (x: number, y: number, width: number, height: number) => void
  beginPath: () => void
  moveTo: (x: number, y: number) => void
  lineTo: (x: number, y: number) => void
  arc: (x: number, y: number, radius: number, start: number, end: number) => void
  stroke: () => void
  createLinearGradient: (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ) => { addColorStop: (offset: number, color: string) => void }
}

interface FocusCanvasNode {
  width: number
  height: number
  getContext: (type: '2d') => FocusRingContext | null
  requestAnimationFrame?: (callback: (time: number) => void) => number
  cancelAnimationFrame?: (handle: number) => void
}

interface CanvasQueryEntry {
  node?: FocusCanvasNode
  width?: number
  height?: number
}

interface CanvasBoxRect {
  width?: number
  height?: number
}

interface NetworkChangeResult {
  isConnected: boolean
  networkType: string
}

interface MotionChangeResult {
  alpha: number
  beta: number
  gamma: number
}

interface FocusPageRuntime {
  destroyed: boolean
  visible: boolean
  ready: boolean
  booted: boolean
  key: string
  stats: FocusStats | null
  evidenceBroken: boolean
  prefs: FocusPrefs
  session: FocusSession | null
  reportOpen: boolean
  reportRecord: FocusRecord | null
  reportStats: FocusStats | null
  nebulaScene: NebulaScene | null
  lastTag: string
  themeBindings: StoreBindingsLike | null
  uiReactions: Array<() => void>

  ticker: number
  lastPersistAt: number
  lastHeartbeatAt: number
  lastAriaKey: string
  settlementToastAt: number
  clockAnchorWall: number
  clockAnchorPerf: number

  modalAction: ModalAction
  pendingBack: boolean

  audio: FocusAudioEngine
  bgm: FocusBgmController
  audioToastShown: boolean
  bgmToastShown: boolean

  networkHandler: ((res: NetworkChangeResult) => void) | null
  networkTimer: number
  networkOffline: boolean

  motionHandler: ((res: MotionChangeResult) => void) | null
  motionStarted: boolean
  motionAvailable: boolean
  faceDown: boolean
  faceDownSince: number
  pickupSince: number
  lastGlitchAt: number
  glitchTimer: number
  blackScreen: boolean

  brightnessDimmed: boolean
  originalBrightness: number
  brightnessBusy: boolean
  unloadAlertOn: boolean

  ringCanvas: FocusCanvasNode | null
  ringCtx: FocusRingContext | null
  ringSize: number
  ringDpr: number
  ringRaf: number
  ringLoopTimer: number
  ringLastDrawAt: number
  ringActive: boolean
  ringGradient: {
    tone: string
    theme: string
    size: number
    gradient: unknown
  } | null
  ringQueryTimer: number
  ringQueryAttempts: number

  nebulaQueryTimer: number
  nebulaExportTimer: number
  canvasTask: '' | 'nebula' | 'poster'
  posterRequestToken: number
  reportTaintedNoticeShown: boolean
}

const DEFAULT_TAG = '深度工作'
const MAX_TAG_CHARS = 12
const TICK_MS = 250
const PERSIST_INTERVAL_MS = 30 * 1000
const HEARTBEAT_INTERVAL_MS = 60 * 1000
const ARIA_BUCKET_MS = 30 * 1000
const FACE_DOWN_RAD = 2.35
const PICKUP_RAD = 1.2
const FACE_DOWN_HOLD_MS = 600
const PICKUP_HOLD_MS = 300
const GLITCH_COOLDOWN_MS = 5000
const GLITCH_DURATION_MS = 1000
const CLOCK_DRIFT_LIMIT_MS = 5000
const BADGE_RECOVER_MS = 3000
const RING_FRAME_MS = 33
const RING_QUERY_TIMEOUT = 700
const RING_QUERY_RETRY = 2

let sessionSequence = 0

function clamp01(value: number, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  return Math.min(1, Math.max(0, value))
}

/* 类型收口：NaN / undefined / 字符串一律回退，防止进入 UI 与 Canvas */
function safeNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function formatClock(ms: number): string {
  const seconds = Math.max(0, Math.ceil(safeNumber(ms) / 1000))
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

function formatAria(ms: number, title: string): string {
  const seconds = Math.max(0, Math.ceil(safeNumber(ms) / 1000))
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${title}，剩余 ${minutes} 分 ${rest} 秒`
}

function cleanTagChars(raw: string): string {
  return Array.from(
    String(raw || '').replace(/[\u0000-\u001f\u007f]/g, ''),
  )
    .slice(0, MAX_TAG_CHARS)
    .join('')
}

function sanitizeTag(raw: string): string {
  return cleanTagChars(raw).trim() || DEFAULT_TAG
}

function padDate(dateKey: string): string {
  return dateKey ? dateKey.replace(/-/g, '.') : '----.--.--'
}

function readMonotonicNow(): number {
  try {
    if (typeof wx === 'undefined') {
      return -1
    }
    const api = (wx as unknown as {
      getPerformance?: () => { now?: () => number }
    }).getPerformance
    if (typeof api !== 'function') {
      return -1
    }
    const value = api().now?.()
    return typeof value === 'number' && Number.isFinite(value) ? value : -1
  } catch {
    return -1
  }
}

function pixelRatio(): number {
  try {
    const info = wx.getWindowInfo()
    return info && info.pixelRatio > 0 ? info.pixelRatio : 2
  } catch {
    return 2
  }
}

function toneForSession(session: FocusSession | null): 'cool' | 'warm' | 'danger' {
  if (!session) {
    return 'cool'
  }
  if (session.fsm === 'breaking') {
    return 'warm'
  }
  if (session.fsm === 'overheat') {
    return 'danger'
  }
  return 'cool'
}

function newSessionId(): string {
  sessionSequence += 1
  return `focus-${Date.now()}-${sessionSequence}`
}

function readVolumePercent(value: number): number {
  return Math.round(Math.min(1, Math.max(0, safeNumber(value))) * 100)
}

function audioFromPrefs(prefs: FocusPrefs) {
  return {
    rain: prefs.rain,
    fire: prefs.fire,
    keyboard: prefs.keyboard,
    volumes: {
      rain: prefs.volumes.rain,
      fire: prefs.volumes.fire,
      keyboard: prefs.volumes.keyboard,
    },
    masterVolume: prefs.masterVolume,
    bgm: prefs.bgm,
  }
}

Page({
  data: {
    themeClass: '',
    lowMemory: false,
    devtools: false,
    ready: false,

    fsmView: 'idle',
    kicker: 'READY',
    statusTitle: '准备进入心流',
    statusSub: '25 分钟 · 翻转黑屏 · 星云战报',
    clock: '25:00',
    clockAria: '准备进入心流，剩余 25 分 0 秒',
    progress: 1,
    progressDeg: 360,
    ringTone: 'cool',
    breathOn: false,
    ringDim: false,
    ringCanvasMounted: false,
    ringCanvasActive: false,
    ringCanvasPx: 0,
    canvasReady: false,

    chipLabel: 'READY',
    chipTone: 'cool',
    cycleText: '',
    tagDisplay: DEFAULT_TAG,
    primaryLabel: '开始专注',
    /* boot 完成前不允许开始，避免异步 key 生成期间误触 */
    primaryDisabled: true,
    secondaryLabel: '设置',
    /* boot 完成前隐藏次操作，避免异步 key 生成期间误触 */
    secondaryHidden: true,

    setupOpen: false,
    tagDraft: DEFAULT_TAG,
    tracks: { rain: true, fire: false, keyboard: false },
    volumes: { rain: 45, fire: 30, keyboard: 25 },
    masterVolume: 55,
    bgm: true,
    flipDetection: true,
    flipAvailable: true,
    motionSaver: false,
    audioDisabled: false,

    networkBadge: '',
    networkOffline: false,
    glitchActive: false,
    glitchStatic: false,
    glitchCount: 0,
    blackScreen: false,

    modalShow: false,
    modalTitle: '',
    modalDesc: '',
    modalConfirm: '',
    modalCancel: '',
    modalDanger: false,

    evidenceBroken: false,
    guardBlocked: false,

    reportOpen: false,
    reportMinutes: 0,
    reportBreaches: 0,
    reportLevel: 1,
    reportLevelLabel: '初识心流',
    reportStreak: 0,
    reportTag: DEFAULT_TAG,
    reportDate: '----.--.--',
    reportConfidence: 'high',
    reportTainted: false,
    reportTaintText: '',
    nebulaPath: '',
    nebulaCanvasMounted: false,
    nebulaFallbackText: '',

    posterVisible: false,
    posterPath: '',
    posterLoading: false,
  },

  onLoad() {
    const runtime = this as unknown as FocusPageRuntime
    runtime.destroyed = false
    runtime.visible = true
    runtime.ready = false
    runtime.booted = false
    runtime.key = ''
    runtime.stats = null
    runtime.evidenceBroken = false
    runtime.prefs = defaultFocusPrefs()
    runtime.session = null
    runtime.reportOpen = false
    runtime.reportRecord = null
    runtime.reportStats = null
    runtime.nebulaScene = null
    runtime.lastTag = DEFAULT_TAG
    runtime.themeBindings = null
    runtime.uiReactions = []
    runtime.ticker = 0
    runtime.lastPersistAt = 0
    runtime.lastHeartbeatAt = 0
    runtime.lastAriaKey = ''
    runtime.settlementToastAt = 0
    runtime.clockAnchorWall = 0
    runtime.clockAnchorPerf = -1
    runtime.modalAction = null
    runtime.pendingBack = false
    runtime.audio = new FocusAudioEngine()
    runtime.bgm = new FocusBgmController({
      onWarn: (message) => {
        logger.warn('focus', message)
        if (!runtime.bgmToastShown) {
          runtime.bgmToastShown = true
          this.toast('后台保活不可用，倒计时仍会精准继续', 'warning')
        }
      },
    })
    runtime.audioToastShown = false
    runtime.bgmToastShown = false
    runtime.networkHandler = null
    runtime.networkTimer = 0
    runtime.networkOffline = false
    runtime.motionHandler = null
    runtime.motionStarted = false
    runtime.motionAvailable = false
    runtime.faceDown = false
    runtime.faceDownSince = 0
    runtime.pickupSince = 0
    runtime.lastGlitchAt = 0
    runtime.glitchTimer = 0
    runtime.blackScreen = false
    runtime.brightnessDimmed = false
    runtime.originalBrightness = -1
    runtime.brightnessBusy = false
    runtime.unloadAlertOn = false
    runtime.ringCanvas = null
    runtime.ringCtx = null
    runtime.ringSize = 0
    runtime.ringDpr = 2
    runtime.ringRaf = 0
    runtime.ringLoopTimer = 0
    runtime.ringLastDrawAt = 0
    runtime.ringActive = false
    runtime.ringGradient = null
    runtime.ringQueryTimer = 0
    runtime.ringQueryAttempts = 0
    runtime.nebulaQueryTimer = 0
    runtime.nebulaExportTimer = 0
    runtime.canvasTask = ''
    runtime.posterRequestToken = 0
    runtime.reportTaintedNoticeShown = false

    const devtools = isDevtools()
    /* 自定义导航页：进入时同步状态栏文字颜色，避免主题切换后残留 */
    uiStore.syncNativeChrome()
    runtime.motionAvailable =
      !devtools &&
      typeof wx.startDeviceMotionListening === 'function' &&
      typeof wx.onDeviceMotionChange === 'function'
    const prefs = loadFocusPrefs()
    runtime.prefs = prefs

    this.setData(
      {
        themeClass: uiStore.themeClass,
        lowMemory: uiStore.lowMemory,
        devtools,
        flipAvailable: runtime.motionAvailable,
        motionSaver: useMotion().level === 'saver',
        ringCanvasMounted: !devtools && !uiStore.lowMemory,
        tagDraft: DEFAULT_TAG,
        tagDisplay: DEFAULT_TAG,
        statusSub: runtime.motionAvailable
          ? '25 分钟 · 翻转黑屏 · 星云战报'
          : '25 分钟 · 环境音 · 星云战报',
        ...this.prefsView(prefs),
      },
      () => {
        if (this.data.ringCanvasMounted) {
          this.queryRingCanvas()
        }
      },
    )

    runtime.themeBindings = createStoreBindings(this, {
      store: uiStore,
      fields: {
        themeClass: () => uiStore.themeClass,
        lowMemory: () => uiStore.lowMemory,
      },
      actions: [],
    })

    /* Page 不支持 observers：主题 / 低内存副作用用 reaction 显式接管 */
    runtime.uiReactions.push(
      reaction(
        () => uiStore.resolvedTheme,
        () => {
          if (runtime.destroyed || !runtime.ringCanvas) {
            return
          }
          runtime.ringGradient = null
          if (
            runtime.visible &&
            this.data.canvasReady &&
            !runtime.reportOpen &&
            !this.data.setupOpen &&
            !runtime.blackScreen &&
            !this.data.glitchActive &&
            useMotion().level !== 'saver' &&
            !uiStore.lowMemory
          ) {
            this.safeDrawRing()
          }
        },
      ),
    )

    runtime.uiReactions.push(
      reaction(
        () => uiStore.lowMemory,
        (low: boolean) => {
          if (runtime.destroyed) {
            return
          }
          if (low) {
            this.stopRingLoop(false)
            this.setData({
              ringCanvasMounted: false,
              canvasReady: false,
              ringCanvasActive: false,
            })
            return
          }
          if (isDevtools()) {
            return
          }
          /* 低内存解除后重新查询 Canvas；失败仍回 CSS 静态环 */
          runtime.ringQueryAttempts = 0
          runtime.ringCanvas = null
          runtime.ringCtx = null
          this.setData(
            { ringCanvasMounted: true, canvasReady: false },
            () => {
              if (!runtime.destroyed) {
                this.queryRingCanvas()
              }
            },
          )
        },
      ),
    )

    this.installNetworkListener()
    this.installMotionListener()
    this.boot()
  },

  onShow() {
    const runtime = this as unknown as FocusPageRuntime
    uiStore.syncNativeChrome()
    runtime.visible = true
    if (!runtime.ready) {
      return
    }
    /* 设置页可能在本页隐藏期间清空全部 focus:*：缺 key 必须回 idle，不得复活旧会话 */
    if (!readFocusKey()) {
      /* 仍有未验证数据：保持 keyLost 冻结，等待用户去设置页清空 */
      if (this.hasUnverifiableFocusData()) {
        this.clearNetworkBadge()
        this.stopGlitch()
        if (runtime.session) {
          runtime.session = null
          runtime.reportOpen = false
          runtime.posterRequestToken += 1
          runtime.reportRecord = null
          runtime.reportStats = null
          runtime.nebulaScene = null
          this.clearNebulaTimers()
          clearFocusSession()
          this.closeDecisionModal()
          this.stopAfterSession()
          this.restoreBrightness()
          this.setKeepScreenOn(false)
          this.setData({
            ready: true,
            reportOpen: false,
            nebulaCanvasMounted: false,
            nebulaPath: '',
            posterVisible: false,
            posterLoading: false,
            blackScreen: false,
          })
          this.paint()
          this.syncGuard()
          this.syncUnloadAlert()
        }
        if (!runtime.evidenceBroken) {
          runtime.key = ''
          runtime.evidenceBroken = true
          this.setData({ ready: true, evidenceBroken: true, setupOpen: false })
          this.paint()
          this.syncGuard()
          this.syncUnloadAlert()
          this.toast(
            '本机记录暂时无法验证，历史等级已冻结；可清空专注数据后重新开始',
            'warning',
          )
        }
        return
      }
      const prefs = loadFocusPrefs()
      runtime.key = ''
      runtime.stats = null
      runtime.session = null
      runtime.reportOpen = false
      runtime.posterRequestToken += 1
      runtime.reportRecord = null
      runtime.reportStats = null
      runtime.nebulaScene = null
      runtime.prefs = prefs
      runtime.lastTag = DEFAULT_TAG
      runtime.booted = false
      runtime.ready = false
      runtime.evidenceBroken = false
      runtime.blackScreen = false
      runtime.faceDown = false
      runtime.pickupSince = 0
      runtime.lastPersistAt = 0
      runtime.lastHeartbeatAt = 0
      runtime.lastAriaKey = ''
      runtime.modalAction = null
      runtime.pendingBack = false
      this.clearNebulaTimers()
      this.stopGlitch()
      this.clearNetworkBadge()
      this.stopAfterSession()
      this.restoreBrightness()
      this.setKeepScreenOn(false)
      this.disableUnloadAlert()
      this.setData({
        ready: false,
        guardBlocked: false,
        setupOpen: false,
        reportOpen: false,
        evidenceBroken: false,
        nebulaCanvasMounted: false,
        nebulaPath: '',
        posterVisible: false,
        posterLoading: false,
        modalShow: false,
        modalTitle: '',
        modalDesc: '',
        modalConfirm: '',
        modalCancel: '',
        modalDanger: false,
        networkBadge: '',
        networkOffline: false,
        glitchActive: false,
        glitchCount: 0,
        blackScreen: false,
        audioDisabled: false,
        tagDraft: DEFAULT_TAG,
        tagDisplay: DEFAULT_TAG,
        fsmView: 'idle',
        kicker: 'READY',
        statusTitle: '准备进入心流',
        statusSub: '25 分钟 · 翻转黑屏 · 星云战报',
        clock: '25:00',
        primaryLabel: '开始专注',
        primaryDisabled: true,
        secondaryLabel: '设置',
        secondaryHidden: true,
        cycleText: '',
        chipLabel: 'READY',
        chipTone: 'cool',
        ...this.prefsView(prefs),
      })
      this.toast('专注数据已清空', 'info')
      void this.boot()
      return
    }
    if (runtime.reportOpen) {
      this.syncGuard()
      return
    }
    if (!runtime.session) {
      this.paint()
      return
    }
    const stored = loadFocusSession(runtime.key)
    if (stored.reason === 'none') {
      /* 会话已被外部删除：不得用内存对象复活，必须回 idle（契约 B.4） */
      const lostSession = runtime.session
      runtime.session = null
      if (
        lostSession &&
        (lostSession.fsm === 'overheat' ||
          (lostSession.fsm === 'breaking' && isLongBreakSession(lostSession)))
      ) {
        this.resetContinuousFocus()
      }
      this.closeDecisionModal()
      this.stopAfterSession()
      this.stopGlitch()
      this.restoreBrightness()
      this.setKeepScreenOn(false)
      this.setData({ blackScreen: false })
      this.paint()
      this.syncGuard()
      this.syncUnloadAlert()
      this.toast('专注会话已失效，已回到待机', 'warning')
      return
    }
    if (
      stored.reason === 'corrupt' ||
      stored.reason === 'signature' ||
      stored.reason === 'keyLost'
    ) {
      runtime.session = null
      clearFocusSession()
      this.closeDecisionModal()
      this.stopAfterSession()
      this.clearNetworkBadge()
      this.stopGlitch()
      this.setData({ blackScreen: false })
      this.restoreBrightness()
      this.toast('专注数据异常，已回到待机', 'warning')
      this.paint()
      this.syncGuard()
      this.syncUnloadAlert()
      return
    }
    const restored = restoreFocusSession(runtime.session, Date.now())
    if (restored.action === 'complete' && restored.completion) {
      this.handleCompletion(restored.completion, runtime.session.id)
      return
    }
    if (restored.action === 'idle') {
      runtime.session = null
      clearFocusSession()
      this.closeDecisionModal()
      if (restored.resetContinuous) {
        this.resetContinuousFocus()
      }
      this.paint()
      this.syncGuard()
      this.syncUnloadAlert()
      return
    }
    if (restored.session) {
      runtime.session = restored.session
      this.paint()
      this.applyVisibility()
      /* onShow 强制回写：补上上一次暂停 / 心跳 / 写盘失败留下的断点 */
      this.persistSession(true)
    }
  },

  onHide() {
    const runtime = this as unknown as FocusPageRuntime
    runtime.visible = false
    this.stopTicker()
    this.stopRingLoop(true)
    this.stopMotionListening()
    /* 页面隐藏时姿态不可信：清掉黑屏层，避免 onShow 把“拿起”误判成破功 */
    runtime.blackScreen = false
    runtime.pickupSince = 0
    this.setData({ blackScreen: false })
    this.persistSession(true)
    this.restoreBrightness()
    this.setKeepScreenOn(false)
    runtime.audio.suspend()
    if (this.shouldRunBgm()) {
      if (!runtime.bgm.start() && !runtime.bgmToastShown) {
        runtime.bgmToastShown = true
        this.toast('后台保活不可用，倒计时仍会精准继续', 'warning')
      }
    }
  },

  onUnload() {
    const runtime = this as unknown as FocusPageRuntime
    runtime.destroyed = true
    runtime.visible = false
    this.stopTicker()
    this.stopRingLoop(true)
    this.stopGlitch()
    this.stopNetworkTimer()
    this.stopNetworkListener()
    this.clearNebulaTimers()
    if (runtime.ringQueryTimer) {
      clearTimeout(runtime.ringQueryTimer)
      runtime.ringQueryTimer = 0
    }
    this.stopMotionListener()
    this.stopMotionListening()
    this.persistSession(true)
    this.restoreBrightness()
    this.setKeepScreenOn(false)
    this.disableUnloadAlert()
    /* 卸载后断开 Canvas 引用，交给 GC 释放大图与上下文 */
    runtime.ringCanvas = null
    runtime.ringCtx = null
    runtime.ringGradient = null
    runtime.ringSize = 0
    runtime.nebulaScene = null
    runtime.reportRecord = null
    runtime.reportStats = null
    runtime.audio.dispose()
    runtime.bgm.dispose()
    for (const dispose of runtime.uiReactions) {
      try {
        dispose()
      } catch {
        /* 已销毁 */
      }
    }
    runtime.uiReactions = []
    if (runtime.themeBindings) {
      runtime.themeBindings.destroyStoreBindings()
      runtime.themeBindings = null
    }
  },

  /* ------------------------------------------------------------------------ */
  /* 启动与数据装载                                                            */
  /* ------------------------------------------------------------------------ */

  hasUnverifiableFocusData(): boolean {
    try {
      const statsProbe = loadFocusStats('')
      const sessionProbe = loadFocusSession('')
      const ledgerProbe = loadFocusLedger('')
      return (
        statsProbe.reason === 'keyLost' ||
        sessionProbe.reason === 'keyLost' ||
        ledgerProbe.entries.length > 0
      )
    } catch {
      /* 存储读取异常时保守冻结，避免生成新 key 覆盖旧记录 */
      return true
    }
  },

  async boot(): Promise<void> {
    const runtime = this as unknown as FocusPageRuntime
    if (runtime.booted) {
      return
    }
    runtime.booted = true
    /* key 缺失但有账本 / 统计 / 会话：必须判 keyLost，绝不生成新 key 把旧记录打成 tainted */
    if (!readFocusKey()) {
      const statsProbe = loadFocusStats('')
      if (this.hasUnverifiableFocusData()) {
        if (loadFocusSession('').reason !== 'none') {
          clearFocusSession()
        }
        runtime.stats = statsProbe.stats
        runtime.evidenceBroken = true
        runtime.ready = true
        this.setData({ ready: true, evidenceBroken: true })
        this.toast(
          '本机记录暂时无法验证，历史等级已冻结；可清空专注数据后重新开始',
          'warning',
        )
        this.paint()
        return
      }
    }
    const key = readFocusKey() || (await ensureFocusKeyAsync())
    if (runtime.destroyed) {
      return
    }
    if (!key) {
      runtime.evidenceBroken = true
      this.toast('本机校验记录不可用，暂时无法开始专注', 'error')
      runtime.ready = true
      this.setData({ ready: true, evidenceBroken: true })
      this.paint()
      return
    }
    runtime.key = key

    const loadedStats = loadFocusStats(key)
    if (loadedStats.reason === 'none') {
      const stats = createEmptyFocusStats(Date.now(), key)
      if (stats) {
        runtime.stats = stats
        if (!saveFocusStats(stats, key)) {
          this.toast('专注数据暂时无法落盘，结算时会重试', 'warning')
        }
      } else {
        runtime.evidenceBroken = true
      }
    } else if (loadedStats.reason === 'ok' && loadedStats.stats) {
      runtime.stats = loadedStats.stats
    } else if (
      (loadedStats.reason === 'keyLost' || loadedStats.reason === 'signature') &&
      loadedStats.stats
    ) {
      runtime.stats = loadedStats.stats
      runtime.evidenceBroken = true
      this.toast(
        loadedStats.reason === 'keyLost'
          ? '本机记录暂时无法验证，历史等级已冻结；可清空专注数据后重新开始'
          : '本机记录校验失败，历史等级已冻结；可清空专注数据后重新开始',
        'warning',
      )
    } else if (loadedStats.reason === 'corrupt') {
      const stats = createEmptyFocusStats(Date.now(), key)
      if (stats) {
        runtime.stats = stats
        if (!saveFocusStats(stats, key)) {
          this.toast('专注数据异常且暂时无法落盘，结算时会重试', 'warning')
        } else {
          this.toast('专注数据异常，已回到待机', 'warning')
        }
      } else {
        runtime.evidenceBroken = true
      }
    }

    if (runtime.evidenceBroken) {
      /* 统计签名失败 / key 不可用：按契约回 idle，不恢复无法结算的旧会话 */
      runtime.session = null
      clearFocusSession()
    } else {
      this.restoreStoredSession()
    }
    runtime.ready = true
    this.setData({ ready: true, evidenceBroken: runtime.evidenceBroken })
    this.paint()
    this.applyVisibility()
    this.syncGuard()
    this.syncUnloadAlert()
  },

  restoreStoredSession(): void {
    const runtime = this as unknown as FocusPageRuntime
    if (!runtime.key) {
      return
    }
    const loaded = loadFocusSession(runtime.key)
    if (loaded.reason === 'none') {
      return
    }
    if (loaded.reason === 'corrupt' || loaded.reason === 'signature') {
      clearFocusSession()
      this.toast('专注数据异常，已回到待机', 'warning')
      return
    }
    if (loaded.reason === 'keyLost') {
      clearFocusSession()
      runtime.evidenceBroken = true
      this.toast('本机记录暂时无法验证，历史等级已冻结', 'warning')
      return
    }
    const stored = loaded.session
    if (!stored) {
      return
    }
    const restored = restoreFocusSession(stored, Date.now())
    if (restored.action === 'complete' && restored.completion) {
      /* 先落内存：结算写失败时保留 focusing 断点，onShow 用同一 record.id 重试 */
      runtime.session = stored
      this.handleCompletion(restored.completion, stored.id)
      return
    }
    if (restored.action === 'idle') {
      clearFocusSession()
      if (restored.resetContinuous) {
        this.resetContinuousFocus()
      }
      return
    }
    if (restored.session) {
      runtime.session = restored.session
      if (
        restored.session.updatedAt !== stored.updatedAt ||
        restored.session.confidence !== stored.confidence
      ) {
        saveFocusSession(restored.session, runtime.key)
      }
    }
  },

  /* ------------------------------------------------------------------------ */
  /* 视图状态                                                                  */
  /* ------------------------------------------------------------------------ */

  prefsView(prefs: FocusPrefs) {
    return {
      tracks: {
        rain: prefs.rain,
        fire: prefs.fire,
        keyboard: prefs.keyboard,
      },
      volumes: {
        rain: readVolumePercent(prefs.volumes.rain),
        fire: readVolumePercent(prefs.volumes.fire),
        keyboard: readVolumePercent(prefs.volumes.keyboard),
      },
      masterVolume: readVolumePercent(prefs.masterVolume),
      bgm: prefs.bgm,
      flipDetection: prefs.flipDetection,
    }
  },

  currentPrefsFromView(): FocusPrefs {
    const tracks = this.data.tracks as {
      rain: boolean
      fire: boolean
      keyboard: boolean
    }
    const volumes = this.data.volumes as {
      rain: number
      fire: number
      keyboard: number
    }
    return {
      version: 1,
      rain: Boolean(tracks.rain),
      fire: Boolean(tracks.fire),
      keyboard: Boolean(tracks.keyboard),
      volumes: {
        rain: Math.min(1, Math.max(0, safeNumber(volumes.rain) / 100)),
        fire: Math.min(1, Math.max(0, safeNumber(volumes.fire) / 100)),
        keyboard: Math.min(1, Math.max(0, safeNumber(volumes.keyboard) / 100)),
      },
      masterVolume: Math.min(1, Math.max(0, safeNumber(this.data.masterVolume) / 100)),
      bgm: Boolean(this.data.bgm),
      flipDetection: Boolean(this.data.flipDetection),
    }
  },

  savePrefsFromView(): void {
    const runtime = this as unknown as FocusPageRuntime
    const prefs = this.currentPrefsFromView()
    runtime.prefs = prefs
    if (!saveFocusPrefs(prefs)) {
      this.toast('专注偏好保存失败，请稍后重试', 'error')
    }
  },

  paint(): void {
    const runtime = this as unknown as FocusPageRuntime
    const session = runtime.session
    const now = Date.now()
    const setupOpen = Boolean(this.data.setupOpen)
    const reportOpen = runtime.reportOpen

    let fsmView: string = 'idle'
    let kicker = 'READY'
    let statusTitle = '准备进入心流'
    let statusSub = runtime.evidenceBroken
      ? '本机记录暂时无法验证，请在设置中清空专注数据'
      : this.data.flipAvailable
        ? '25 分钟 · 翻转黑屏 · 星云战报'
        : '25 分钟 · 环境音 · 星云战报'
    let clock = formatClock(25 * 60 * 1000)
    let progress = 1
    let ringTone: 'cool' | 'warm' | 'danger' = 'cool'
    let breathOn = useMotion().level !== 'saver' && !uiStore.lowMemory
    let ringDim = false
    let chipLabel = 'READY'
    let chipTone: 'cool' | 'warm' | 'danger' = 'cool'
    let cycleText = ''
    let tagDisplay = runtime.lastTag || DEFAULT_TAG
    let primaryLabel = '开始专注'
    let primaryDisabled =
      !runtime.ready || runtime.evidenceBroken || !runtime.stats || !runtime.key
    let secondaryLabel = '设置'
    let secondaryHidden = false

    if (reportOpen) {
      fsmView = 'report'
      kicker = 'REPORT'
      statusTitle = '心流战报'
      statusSub = '本机生成 · 不上传'
      clock = formatClock(0)
      progress = 0
      breathOn = false
      chipLabel = 'REPORT'
      primaryLabel = ''
      primaryDisabled = true
      secondaryHidden = true
    } else if (setupOpen) {
      fsmView = 'preparing'
      kicker = 'SETUP'
      statusTitle = '专注设置'
      statusSub = ''
      cycleText = ''
      ringDim = true
      breathOn = false
      chipLabel = 'SETUP'
      primaryLabel = ''
      secondaryHidden = true
    } else if (!session) {
      fsmView = 'idle'
      breathOn = false
      chipLabel = 'READY'
    } else if (session.fsm === 'focusing') {
      fsmView = 'focusing'
      kicker = 'FOCUSING'
      statusTitle = '心流中'
      statusSub = ''
      clock = formatClock(focusRemainingMs(session, now))
      progress = clamp01(focusRemainingMs(session, now) / session.phaseTotalMs, 1)
      ringTone = 'cool'
      chipLabel = 'LIVE'
      chipTone = 'cool'
      cycleText = `第 ${session.cycle} / 4 轮`
      tagDisplay = session.tag || DEFAULT_TAG
      primaryLabel = '暂停'
      primaryDisabled = false
      secondaryLabel = '放弃'
      secondaryHidden = false
    } else if (session.fsm === 'paused') {
      fsmView = 'paused'
      kicker = 'PAUSED'
      statusTitle = '已暂停'
      statusSub = '计时已冻结'
      clock = formatClock(focusRemainingMs(session, now))
      progress = clamp01(focusRemainingMs(session, now) / session.phaseTotalMs, 1)
      ringTone = 'cool'
      /* 暂停只压暗圆环，计时数字与标题保持满对比度 */
      ringDim = false
      breathOn = false
      chipLabel = 'PAUSED'
      chipTone = 'warm'
      cycleText = `第 ${session.cycle} / 4 轮`
      tagDisplay = session.tag || DEFAULT_TAG
      primaryLabel = '继续'
      primaryDisabled = false
      secondaryLabel = '放弃'
      secondaryHidden = false
    } else if (session.fsm === 'breaking') {
      fsmView = 'breaking'
      kicker = 'BREAK'
      statusTitle = isLongBreakSession(session) ? '长休' : '短休'
      statusSub = '站起来，看看远处'
      clock = formatClock(focusRemainingMs(session, now))
      progress = clamp01(focusRemainingMs(session, now) / session.phaseTotalMs, 1)
      ringTone = 'warm'
      chipLabel = 'BREAK'
      chipTone = 'warm'
      cycleText = isLongBreakSession(session)
        ? '长休 15 分钟'
        : '短休 5 分钟'
      tagDisplay = session.tag || DEFAULT_TAG
      primaryLabel = '跳过休息'
      primaryDisabled = false
      secondaryHidden = true
    } else {
      fsmView = 'overheat'
      kicker = 'COOLDOWN'
      statusTitle = '冷却中'
      statusSub = '连续专注 2 小时，先休息 30 分钟'
      clock = formatClock(focusRemainingMs(session, now))
      progress = clamp01(focusRemainingMs(session, now) / session.phaseTotalMs, 1)
      ringTone = 'danger'
      breathOn = false
      chipLabel = 'COOLDOWN'
      chipTone = 'danger'
      tagDisplay = session.tag || DEFAULT_TAG
      primaryLabel = '冷却中'
      primaryDisabled = true
      secondaryLabel = '返回'
      secondaryHidden = false
    }

    const remaining = session
      ? focusRemainingMs(session, now)
      : 25 * 60 * 1000
    const ariaKey = `${fsmView}|${statusTitle}|${Math.floor(remaining / ARIA_BUCKET_MS)}`
    let clockAria = this.data.clockAria as string
    if (ariaKey !== runtime.lastAriaKey) {
      runtime.lastAriaKey = ariaKey
      clockAria = formatAria(remaining, statusTitle)
    }
    const progressDeg = Math.round(progress * 3600) / 10
    const guardBlocked = Boolean(session) || setupOpen || reportOpen || Boolean(this.data.posterVisible)

    this.setData({
      fsmView,
      kicker,
      statusTitle,
      statusSub,
      clock,
      clockAria,
      progress,
      progressDeg,
      ringTone,
      breathOn,
      ringDim,
      chipLabel,
      chipTone,
      cycleText,
      tagDisplay,
      primaryLabel,
      primaryDisabled,
      secondaryLabel,
      secondaryHidden,
      guardBlocked,
      lowMemory: uiStore.lowMemory,
      motionSaver: useMotion().level === 'saver',
    })

    const animate =
      Boolean(session) &&
      !reportOpen &&
      !setupOpen &&
      !runtime.blackScreen &&
      !this.data.glitchActive &&
      useMotion().level !== 'saver' &&
      !uiStore.lowMemory
    if (animate && (session?.fsm === 'focusing' || session?.fsm === 'breaking')) {
      this.startRingLoop()
    } else {
      this.stopRingLoop(false)
      /* saver / lowMemory 只保留 CSS 静态环；被全屏层遮住时不做无用重绘 */
      if (
        useMotion().level !== 'saver' &&
        !uiStore.lowMemory &&
        !reportOpen &&
        !setupOpen &&
        !runtime.blackScreen &&
        !this.data.glitchActive
      ) {
        this.safeDrawRing()
      }
    }
  },

  /* ------------------------------------------------------------------------ */
  /* 计时                                                                      */
  /* ------------------------------------------------------------------------ */

  startTicker(delay = TICK_MS): void {
    const runtime = this as unknown as FocusPageRuntime
    this.stopTicker()
    runtime.ticker = setTimeout(() => {
      runtime.ticker = 0
      this.tick()
    }, delay) as unknown as number
  },

  stopTicker(): void {
    const runtime = this as unknown as FocusPageRuntime
    if (runtime.ticker) {
      clearTimeout(runtime.ticker)
      runtime.ticker = 0
    }
  },

  /** 每次进入前台 / 开始 / 继续：同一可见周期内记录 wall + monotonic 双锚点 */
  setClockAnchor(now = Date.now()): void {
    const runtime = this as unknown as FocusPageRuntime
    if (typeof now !== 'number' || !Number.isFinite(now) || now <= 0) {
      return
    }
    runtime.clockAnchorWall = now
    runtime.clockAnchorPerf = readMonotonicNow()
  },

  /** Date.now 跳变超过 5s 视为时钟作弊；monotonic 不可用时不做误判 */
  detectClockDrift(now: number): boolean {
    const runtime = this as unknown as FocusPageRuntime
    if (
      typeof now !== 'number' ||
      !Number.isFinite(now) ||
      runtime.clockAnchorWall <= 0
    ) {
      return false
    }
    const wallElapsed = now - runtime.clockAnchorWall
    if (wallElapsed < -CLOCK_DRIFT_LIMIT_MS) {
      return true
    }
    const perfNow = readMonotonicNow()
    if (perfNow < 0 || runtime.clockAnchorPerf < 0) {
      return false
    }
    const perfElapsed = perfNow - runtime.clockAnchorPerf
    /* perf.now 不前进 / 被重置时不误判；否则墙钟与单调时钟的差值才是真实漂移 */
    if (perfElapsed <= 0) {
      return false
    }
    return Math.abs(wallElapsed - perfElapsed) > CLOCK_DRIFT_LIMIT_MS
  },

  tick(): void {
    const runtime = this as unknown as FocusPageRuntime
    if (runtime.destroyed || !runtime.visible || runtime.reportOpen) {
      return
    }
    const session = runtime.session
    if (!session || Boolean(this.data.setupOpen)) {
      return
    }
    const now = Date.now()

    /* 弹窗决策期间不自动完成 / 不自动结束休息，避免报告在弹窗背后打开 */
    if (this.data.modalShow) {
      this.paint()
      if (session.fsm !== 'paused') {
        this.startTicker(session.fsm === 'overheat' ? 1000 : TICK_MS)
      }
      return
    }

    if (session.fsm === 'focusing') {
      if (now - runtime.lastPersistAt >= PERSIST_INTERVAL_MS) {
        runtime.lastPersistAt = now
        saveFocusSession(session, runtime.key)
      }
      if (now - runtime.lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
        runtime.lastHeartbeatAt = now
        runtime.session = markFocusHeartbeat(session, now)
        saveFocusSession(runtime.session, runtime.key)
      }
      if (focusRemainingMs(runtime.session || session, now) <= 0) {
        const completion = completeFocusSession(runtime.session || session, now)
        if (completion) {
          this.handleCompletion(
            completion,
            (runtime.session || session).id,
            this.detectClockDrift(now),
          )
          return
        }
      }
    } else if (session.fsm === 'breaking') {
      if (now >= session.phaseEndsAt) {
        const finished = finishBreakSession(session, now)
        if (finished) {
          if (finished.resetContinuous) {
            this.resetContinuousFocus()
          }
          runtime.session = null
          clearFocusSession()
          this.stopAfterSession()
          this.toast('休息结束，可以开始下一轮', 'info')
          this.closeDecisionModal()
          this.paint()
          this.syncGuard()
          this.syncUnloadAlert()
          return
        }
      }
    } else if (session.fsm === 'overheat') {
      if (now >= (session.lockUntil ?? 0)) {
        const finished = finishOverheatSession(session, now)
        if (finished) {
          this.resetContinuousFocus()
          runtime.session = null
          clearFocusSession()
          this.stopAfterSession()
          this.toast('冷却结束，可以继续', 'success')
          this.closeDecisionModal()
          this.paint()
          this.syncGuard()
          this.syncUnloadAlert()
          return
        }
      }
    } else {
      this.paint()
      return
    }

    this.paint()
    this.startTicker(session.fsm === 'overheat' ? 1000 : TICK_MS)
  },

  persistSession(force = false): void {
    const runtime = this as unknown as FocusPageRuntime
    if (!runtime.session || !runtime.key) {
      return
    }
    if (!force && Date.now() - runtime.lastPersistAt < PERSIST_INTERVAL_MS) {
      return
    }
    runtime.lastPersistAt = Date.now()
    if (!saveFocusSession(runtime.session, runtime.key)) {
      logger.warn('focus', '会话断点写入失败，将在下一次 onShow 重试')
    }
  },

  resetContinuousFocus(): void {
    const runtime = this as unknown as FocusPageRuntime
    if (!runtime.stats || !runtime.key) {
      return
    }
    if (runtime.stats.continuousFocusMs === 0) {
      return
    }
    const next: FocusStats = {
      ...runtime.stats,
      continuousFocusMs: 0,
      updatedAt: Date.now(),
      signature: '',
    }
    if (saveFocusStats(next, runtime.key)) {
      const loaded = loadFocusStats(runtime.key)
      if (loaded.stats) {
        runtime.stats = loaded.stats
      }
    } else {
      /* 落盘失败也要先清内存连续值，避免下一轮被旧值立刻再次 Overheat */
      runtime.stats = next
      this.toast('连续专注重置失败，将在下次结算时重试', 'warning')
    }
  },

  /* ------------------------------------------------------------------------ */
  /* 会话操作                                                                  */
  /* ------------------------------------------------------------------------ */

  openSetup(): void {
    if (!this.data.ready) {
      return
    }
    this.feedback('tick')
    const runtime = this as unknown as FocusPageRuntime
    this.setData({
      setupOpen: true,
      tagDraft: runtime.lastTag || DEFAULT_TAG,
      ...this.prefsView(runtime.prefs),
    })
    this.paint()
    this.syncGuard()
  },

  onSetupClose(): void {
    const runtime = this as unknown as FocusPageRuntime
    this.savePrefsFromView()
    runtime.prefs = this.currentPrefsFromView()
    this.setData({ setupOpen: false })
    this.paint()
    this.syncGuard()
  },

  onTagInput(event: WechatMiniprogram.CustomEvent<{ value: string }>): void {
    /* 编辑中允许空值；只有点“开始心流”时才回退默认标签 */
    this.setData({ tagDraft: cleanTagChars(event.detail?.value || '') })
  },

  onTrackToggle(event: WechatMiniprogram.SwitchChange): void {
    const track = event.currentTarget.dataset.track as FocusTrack | undefined
    if (!track) {
      return
    }
    const patch: Record<string, unknown> = {}
    patch[`tracks.${track}`] = Boolean(event.detail.value)
    this.setData(patch, () => {
      this.savePrefsFromView()
      this.paint()
    })
  },

  onVolumeInput(event: WechatMiniprogram.CustomEvent<{ value: number }>): void {
    const track = event.currentTarget.dataset.track as FocusTrack | undefined
    if (!track) {
      return
    }
    const patch: Record<string, unknown> = {}
    patch[`volumes.${track}`] = safeNumber(event.detail?.value)
    this.setData(patch)
  },

  onVolumeChange(event: WechatMiniprogram.CustomEvent<{ value: number }>): void {
    const track = event.currentTarget.dataset.track as FocusTrack | undefined
    if (!track) {
      return
    }
    const patch: Record<string, unknown> = {}
    patch[`volumes.${track}`] = safeNumber(event.detail?.value)
    this.setData(patch, () => {
      this.savePrefsFromView()
    })
  },

  onMasterInput(event: WechatMiniprogram.CustomEvent<{ value: number }>): void {
    this.setData({ masterVolume: safeNumber(event.detail?.value) })
  },

  onMasterChange(event: WechatMiniprogram.CustomEvent<{ value: number }>): void {
    this.setData({ masterVolume: safeNumber(event.detail?.value) }, () => {
      this.savePrefsFromView()
    })
  },

  onBgmToggle(event: WechatMiniprogram.SwitchChange): void {
    this.setData({ bgm: Boolean(event.detail.value) }, () => {
      this.savePrefsFromView()
    })
  },

  onFlipToggle(event: WechatMiniprogram.SwitchChange): void {
    this.setData({ flipDetection: Boolean(event.detail.value) }, () => {
      this.savePrefsFromView()
    })
    if (!event.detail.value) {
      this.stopMotionListening()
    }
  },

  onStartFocus(): void {
    const runtime = this as unknown as FocusPageRuntime
    if (!runtime.ready || !runtime.stats || !runtime.key || runtime.evidenceBroken) {
      this.toast('专注数据暂不可用，请先清空专注数据', 'error')
      return
    }
    const storedKey = readFocusKey()
    if (!storedKey || storedKey !== runtime.key) {
      runtime.key = ''
      runtime.evidenceBroken = true
      this.setData({ evidenceBroken: true, setupOpen: false })
      this.paint()
      this.toast('本机校验记录丢失，请先清空专注数据', 'error')
      return
    }
    const tag = sanitizeTag(this.data.tagDraft as string)
    const prefs = this.currentPrefsFromView()
    runtime.prefs = prefs
    saveFocusPrefs(prefs)
    const session = createFocusSession({
      id: newSessionId(),
      tag,
      audio: audioFromPrefs(prefs),
      stats: runtime.stats,
      now: Date.now(),
    })
    if (!saveFocusSession(session, runtime.key)) {
      this.toast('本地存储不可用，无法开始专注', 'error')
      return
    }
    runtime.session = session
    runtime.lastTag = tag
    runtime.lastPersistAt = Date.now()
    runtime.lastHeartbeatAt = Date.now()
    this.setData({
      setupOpen: false,
      tagDraft: tag,
      tagDisplay: tag,
    })
    this.feedback('success')
    this.paint()
    this.applyVisibility()
    this.syncGuard()
    this.syncUnloadAlert()
  },

  pauseFocus(): void {
    const runtime = this as unknown as FocusPageRuntime
    if (!runtime.session || runtime.session.fsm !== 'focusing') {
      return
    }
    runtime.session = pauseFocusSession(runtime.session, Date.now())
    saveFocusSession(runtime.session, runtime.key)
    runtime.blackScreen = false
    this.setData({ blackScreen: false })
    this.stopAfterSession()
    this.restoreBrightness()
    this.setKeepScreenOn(false)
    this.feedback('tick')
    this.paint()
    this.syncUnloadAlert()
  },

  resumeFocus(): void {
    const runtime = this as unknown as FocusPageRuntime
    if (!runtime.session || runtime.session.fsm !== 'paused') {
      return
    }
    runtime.session = resumeFocusSession(runtime.session, Date.now())
    saveFocusSession(runtime.session, runtime.key)
    runtime.lastPersistAt = Date.now()
    runtime.lastHeartbeatAt = Date.now()
    this.feedback('tick')
    this.paint()
    this.applyVisibility()
    this.syncUnloadAlert()
  },

  stopAfterSession(): void {
    const runtime = this as unknown as FocusPageRuntime
    this.stopTicker()
    this.stopRingLoop(false)
    this.stopMotionListening()
    this.clearNetworkBadge()
    runtime.audio.setTracks([])
    runtime.bgm.stop()
  },

  openGiveUpModal(): void {
    const runtime = this as unknown as FocusPageRuntime
    runtime.modalAction = 'give-up'
    this.setData({
      modalShow: true,
      modalTitle: '放弃这次心流？',
      modalDesc: '当前专注将不会计入战报与等级。',
      modalConfirm: '放弃',
      modalCancel: '继续专注',
      modalDanger: true,
    })
    this.syncGuard()
  },

  openSkipBreakModal(): void {
    const runtime = this as unknown as FocusPageRuntime
    runtime.modalAction = 'skip-break'
    this.setData({
      modalShow: true,
      modalTitle: '跳过休息？',
      modalDesc: '直接回到待机，下一轮可以稍后开始。',
      modalConfirm: '跳过',
      modalCancel: '继续休息',
      modalDanger: false,
    })
    this.syncGuard()
  },

  onModalConfirm(): void {
    const runtime = this as unknown as FocusPageRuntime
    const action = runtime.modalAction
    const pendingBack = runtime.pendingBack
    runtime.modalAction = null
    runtime.pendingBack = false
    this.setData({ modalShow: false })
    if (action === 'give-up') {
      this.abandonFocus(pendingBack)
    } else if (action === 'skip-break') {
      this.skipBreak(pendingBack)
    }
  },

  onModalCancel(): void {
    const runtime = this as unknown as FocusPageRuntime
    runtime.modalAction = null
    runtime.pendingBack = false
    this.setData({ modalShow: false })
    this.syncGuard()
  },

  closeDecisionModal(): void {
    const runtime = this as unknown as FocusPageRuntime
    runtime.modalAction = null
    runtime.pendingBack = false
    if (this.data.modalShow) {
      this.setData({ modalShow: false })
    }
  },

  abandonFocus(navigateBack: boolean): void {
    const runtime = this as unknown as FocusPageRuntime
    runtime.session = null
    clearFocusSession()
    this.stopAfterSession()
    this.restoreBrightness()
    this.setKeepScreenOn(false)
    this.setData({ blackScreen: false })
    this.feedback('warn')
    this.paint()
    this.syncGuard()
    this.syncUnloadAlert()
    if (navigateBack) {
      this.leavePage()
    }
  },

  skipBreak(navigateBack: boolean): void {
    const runtime = this as unknown as FocusPageRuntime
    if (!runtime.session) {
      return
    }
    const finished = finishBreakSession(runtime.session, Date.now(), true)
    if (finished?.resetContinuous) {
      this.resetContinuousFocus()
    }
    runtime.session = null
    clearFocusSession()
    this.stopAfterSession()
    this.setData({ blackScreen: false })
    this.feedback('tick')
    this.paint()
    this.syncGuard()
    this.syncUnloadAlert()
    if (navigateBack) {
      this.leavePage()
    }
  },

  /* ------------------------------------------------------------------------ */
  /* 按钮 / 返回                                                               */
  /* ------------------------------------------------------------------------ */

  onPrimaryTap(): void {
    const runtime = this as unknown as FocusPageRuntime
    switch (this.data.fsmView) {
      case 'idle':
        this.openSetup()
        break
      case 'focusing':
        this.pauseFocus()
        break
      case 'paused':
        this.resumeFocus()
        break
      case 'breaking':
        this.openSkipBreakModal()
        break
      case 'overheat':
        break
      default:
        break
    }
    this.syncGuard()
    if (runtime.destroyed) {
      return
    }
  },

  onSecondaryTap(): void {
    switch (this.data.fsmView) {
      case 'idle':
        this.openSetup()
        break
      case 'focusing':
      case 'paused':
        this.openGiveUpModal()
        break
      case 'overheat':
        this.leavePage()
        break
      default:
        break
    }
  },

  onBackTap(): void {
    const runtime = this as unknown as FocusPageRuntime
    if (this.data.modalShow) {
      return
    }
    if (this.data.setupOpen) {
      this.onSetupClose()
      return
    }
    if (runtime.reportOpen) {
      this.closeReport()
      return
    }
    if (!runtime.session) {
      this.leavePage()
      return
    }
    if (runtime.session.fsm === 'overheat') {
      this.leavePage()
      return
    }
    runtime.pendingBack = true
    if (runtime.session.fsm === 'breaking') {
      this.openSkipBreakModal()
    } else {
      this.openGiveUpModal()
    }
  },

  leavePage(): void {
    this.disableUnloadAlert()
    wx.navigateBack({
      fail: () => {
        wx.reLaunch({ url: ROUTES.home })
      },
    })
  },

  /* ------------------------------------------------------------------------ */
  /* 完成 / 战报                                                               */
  /* ------------------------------------------------------------------------ */

  handleCompletion(
    completion: FocusCompletion,
    sessionId: string,
    clockTainted = false,
  ): void {
    const runtime = this as unknown as FocusPageRuntime
    const key = runtime.key
    const stats = runtime.stats
    if (!key || !stats || runtime.evidenceBroken) {
      if (!key) {
        runtime.key = ''
        runtime.evidenceBroken = true
      }
      this.stopTicker()
      runtime.session = null
      clearFocusSession()
      this.closeDecisionModal()
      this.stopAfterSession()
      this.restoreBrightness()
      this.setKeepScreenOn(false)
      this.setData({
        blackScreen: false,
        evidenceBroken: runtime.evidenceBroken,
      })
      this.paint()
      this.syncGuard()
      this.syncUnloadAlert()
      this.toast('专注数据暂不可用，已回到待机', 'error')
      return
    }
    if (clockTainted) {
      this.handleClockTaintedCompletion(completion, sessionId, key, stats)
      return
    }
    const now = Date.now()
    const recordId = `rec-${sessionId}`
    /* 崩溃恢复重放时 stats 可能已包含该 record，等级不得二次累加 */
    const alreadyApplied = stats.lastAppliedRecordId === recordId
    const level = levelFromFocusMs(
      stats.totalFocusMs + (alreadyApplied ? 0 : completion.record.focusedMs),
    )
    const record = buildFocusRecord(
      {
        sessionId,
        tag: completion.record.tag,
        startedAt: completion.record.startedAt,
        endedAt: completion.record.endedAt,
        focusedMs: completion.record.focusedMs,
        breaches: completion.record.breaches,
        level,
        confidence: completion.record.confidence,
      },
      key,
    )
    if (!record) {
      this.stopTicker()
      this.paint()
      this.toast('战报生成失败，本次专注保留在会话中', 'error')
      return
    }
    const result = settleFocusRecord(record, {
      keyHex: key,
      stats,
      continuousFocusMs: completion.session.continuousFocusMs,
      now,
    })
    if (!result.ok) {
      if (
        result.reason === 'signature' ||
        result.reason === 'keyLost' ||
        result.reason === 'clock'
      ) {
        this.handleRejectedCompletion(record, result.stats, result.reason)
        return
      }
      /* 纯写失败不空转：保留 session，下一次 onShow / 暂停继续时用同一 record.id 重试 */
      this.stopTicker()
      this.paint()
      if (now - runtime.settlementToastAt > 5000) {
        runtime.settlementToastAt = now
        this.toast('专注数据写入失败，切后台再回来重试', 'warning')
      }
      return
    }

    runtime.stats = result.stats
    runtime.reportRecord = record
    runtime.reportStats = result.stats
    runtime.session = completion.session
    if (!saveFocusSession(completion.session, key)) {
      logger.warn('focus', '战报会话写入失败，将在 onHide 重试')
    }
    /* 崩溃重放：stats 已包含该 record 时不再重复写轨迹 */
    if (!alreadyApplied) {
      try {
        this.writeCompletionHistory(record)
      } catch (error) {
        logger.warn('focus', '专注历史写入失败', error)
      }
    }
    this.openReport(record, result.stats, !result.check.verified)
  },

  /** 时钟漂移：战报仍展示，但 stats 不更新、不写历史、不给休息/等级 */
  handleClockTaintedCompletion(
    completion: FocusCompletion,
    sessionId: string,
    key: string,
    stats: FocusStats,
  ): void {
    const runtime = this as unknown as FocusPageRuntime
    const record = buildFocusRecord(
      {
        sessionId,
        tag: completion.record.tag,
        startedAt: completion.record.startedAt,
        endedAt: completion.record.endedAt,
        focusedMs: completion.record.focusedMs,
        breaches: completion.record.breaches,
        level: levelFromFocusMs(stats.totalFocusMs),
        confidence: completion.record.confidence,
      },
      key,
    )
    runtime.session = null
    clearFocusSession()
    this.closeDecisionModal()
    this.stopTicker()
    this.stopAfterSession()
    this.restoreBrightness()
    this.setKeepScreenOn(false)
    this.setData({ blackScreen: false })

    if (!record) {
      this.paint()
      this.syncGuard()
      this.syncUnloadAlert()
      this.toast('检测到本机时钟异常，本次专注不计入等级', 'warning')
      return
    }
    if (!appendFocusRecord(record).ok) {
      logger.warn('focus', '时钟异常战报写入账本失败')
    }
    this.openReport(record, stats, true, 'clock', false)
    this.feedback('warn')
    this.toast('检测到本机时钟异常，本次专注不计入等级', 'warning')
  },

  /** 验签 / 时钟异常：战报展示但 stats 不更新，避免同一 record 无限重试 */
  handleRejectedCompletion(
    record: FocusRecord,
    stats: FocusStats,
    reason: 'signature' | 'keyLost' | 'clock',
  ): void {
    const runtime = this as unknown as FocusPageRuntime
    runtime.session = null
    clearFocusSession()
    this.closeDecisionModal()
    this.stopTicker()
    this.stopAfterSession()
    this.restoreBrightness()
    this.setKeepScreenOn(false)
    this.setData({ blackScreen: false })
    this.openReport(
      record,
      stats,
      true,
      reason,
      false,
      stats.level,
    )
    this.feedback('warn')
    if (reason === 'clock') {
      this.toast('检测到本机时钟异常，本次专注不计入等级', 'warning')
      return
    }
    if (reason === 'keyLost') {
      this.toast('本机校验记录丢失，本次专注不计入等级', 'warning')
      return
    }
    this.toast('本机记录校验失败，本次专注不计入等级', 'warning')
  },

  writeCompletionHistory(record: FocusRecord): void {
    if (!preferenceStore.isHistoryTrackingEnabled) {
      return
    }
    const minutes = Math.max(1, Math.round(record.focusedMs / 60000))
    historyStore.record({
      toolId: 'focus',
      toolName: '全息专注',
      category: 'life',
      categoryLabel: '专注',
      icon: '专',
      night: uiStore.resolvedTheme === 'dark',
      inputSummary: `标签 ${record.tag || DEFAULT_TAG} · ${minutes} 分钟`,
      outputSummary: `完成 ${minutes} 分钟 · 中断 ${record.breaches} 次 · Lv.${record.level}`,
    })
  },

  openReport(
    record: FocusRecord,
    stats: FocusStats,
    tainted: boolean,
    taintReason: 'signature' | 'clock' | 'keyLost' = 'signature',
    successFeedback = true,
    displayLevel = record.level,
  ): void {
    const runtime = this as unknown as FocusPageRuntime
    this.closeDecisionModal()
    runtime.reportOpen = true
    runtime.posterRequestToken += 1
    runtime.reportRecord = record
    runtime.reportStats = stats
    runtime.reportTaintedNoticeShown = false
    const minutes = Math.max(1, Math.round(record.focusedMs / 60000))
    const scene = createNebulaScene(record.seed, {
      tainted,
      confidence: record.confidence,
      palette:
        uiStore.resolvedTheme === 'light'
          ? {
              core: '#5367ff',
              inner: '#0fb59a',
              outer: '#d99a32',
              danger: '#e85b43',
            }
          : undefined,
    })
    runtime.nebulaScene = scene
    this.stopTicker()
    this.stopRingLoop(false)
    this.stopMotionListening()
    runtime.blackScreen = false
    this.setData({ blackScreen: false })
    runtime.audio.setTracks([])
    runtime.bgm.stop()
    this.restoreBrightness()
    this.setKeepScreenOn(false)
    if (successFeedback) {
      this.feedback('success')
    }

    const canCanvas = !isDevtools() && !uiStore.lowMemory
    this.setData(
      {
        reportOpen: true,
        reportMinutes: minutes,
        reportBreaches: record.breaches,
        reportLevel: displayLevel,
        reportLevelLabel: levelLabel(displayLevel),
        reportStreak: stats.streakDays,
        reportTag: record.tag || DEFAULT_TAG,
        reportDate: padDate(formatLocalDate(record.endedAt)),
        reportConfidence: record.confidence,
        reportTainted: tainted,
        reportTaintText: tainted
          ? taintReason === 'clock'
            ? '检测到本机时钟异常，本次不计入等级，星云已枯萎'
            : taintReason === 'keyLost'
              ? '本机校验记录丢失，本次不计入等级，星云已枯萎'
              : '本机记录校验失败，本次不计入等级，星云已枯萎'
          : '',
        nebulaPath: '',
        nebulaCanvasMounted: canCanvas,
        nebulaFallbackText: canCanvas ? '星云生成中' : '简化动效 · 星云未渲染',
      },
      () => {
        if (canCanvas) {
          this.generateNebula()
        }
      },
    )
    this.paint()
    this.syncGuard()
    this.syncUnloadAlert()
  },

  onCloseReport(): void {
    const runtime = this as unknown as FocusPageRuntime
    if (runtime.destroyed || !runtime.reportOpen) {
      return
    }
    this.closeReport()
  },

  closeReport(): void {
    const runtime = this as unknown as FocusPageRuntime
    runtime.reportOpen = false
    runtime.posterRequestToken += 1
    runtime.nebulaScene = null
    this.clearNebulaTimers()
    this.setData({
      reportOpen: false,
      nebulaCanvasMounted: false,
      nebulaPath: '',
      posterVisible: false,
      posterLoading: false,
    })
    this.feedback('tick')
    if (runtime.session) {
      this.paint()
      this.applyVisibility()
    } else {
      this.paint()
    }
    this.syncGuard()
    this.syncUnloadAlert()
    this.tick()
  },

  clearNebulaTimers(): void {
    const runtime = this as unknown as FocusPageRuntime
    if (runtime.nebulaQueryTimer) {
      clearTimeout(runtime.nebulaQueryTimer)
      runtime.nebulaQueryTimer = 0
    }
    if (runtime.nebulaExportTimer) {
      clearTimeout(runtime.nebulaExportTimer)
      runtime.nebulaExportTimer = 0
    }
    runtime.canvasTask = ''
  },

  generateNebula(): void {
    const runtime = this as unknown as FocusPageRuntime
    const scene = runtime.nebulaScene
    if (!scene || runtime.destroyed || !runtime.reportOpen) {
      return
    }
    runtime.canvasTask = 'nebula'
    runtime.nebulaQueryTimer = setTimeout(() => {
      runtime.nebulaQueryTimer = 0
      this.failNebula('星云生成超时 · 已保留文字战报')
    }, RING_QUERY_TIMEOUT) as unknown as number

    this.createSelectorQuery()
      .select('#nebula-canvas')
      .fields({ node: true, size: true })
      .exec((result: unknown[]) => {
        if (runtime.nebulaQueryTimer) {
          clearTimeout(runtime.nebulaQueryTimer)
          runtime.nebulaQueryTimer = 0
        }
        if (runtime.destroyed || !runtime.reportOpen) {
          return
        }
        const entry =
          result && result[0] ? (result[0] as CanvasQueryEntry) : null
        const node = entry?.node
        if (!node) {
          this.failNebula('星云渲染不可用 · 已保留文字战报')
          return
        }
        try {
          node.width = 750
          node.height = 1000
          const ctx = node.getContext('2d') as unknown as NebulaContextLike | null
          if (!ctx) {
            this.failNebula('星云渲染不可用 · 已保留文字战报')
            return
          }
          renderNebulaScene(ctx, scene)
          runtime.nebulaExportTimer = setTimeout(() => {
            runtime.nebulaExportTimer = 0
            this.failNebula('星云导出超时 · 已保留文字战报')
          }, 4000) as unknown as number
          wx.canvasToTempFilePath({
            canvas: node as unknown as WechatMiniprogram.Canvas,
            x: 0,
            y: 0,
            width: 750,
            height: 1000,
            destWidth: 750,
            destHeight: 1000,
            fileType: 'png',
            quality: 1,
            success: (res) => {
              if (runtime.nebulaExportTimer) {
                clearTimeout(runtime.nebulaExportTimer)
                runtime.nebulaExportTimer = 0
              }
              runtime.canvasTask = ''
              if (runtime.destroyed || !runtime.reportOpen) {
                return
              }
              this.setData({
                nebulaPath: res.tempFilePath,
                nebulaCanvasMounted: false,
                nebulaFallbackText: nebulaSummary(scene),
              })
            },
            fail: (error) => {
              logger.warn('focus', '星云导出失败', error)
              this.failNebula('星云生成失败 · 已保留文字战报')
            },
          })
        } catch (error) {
          logger.warn('focus', '星云绘制异常', error)
          this.failNebula('星云生成失败 · 已保留文字战报')
        }
      })
  },

  failNebula(message: string): void {
    const runtime = this as unknown as FocusPageRuntime
    if (runtime.nebulaExportTimer) {
      clearTimeout(runtime.nebulaExportTimer)
      runtime.nebulaExportTimer = 0
    }
    runtime.canvasTask = ''
    if (runtime.destroyed) {
      return
    }
    if (!runtime.reportOpen) {
      return
    }
    this.setData({
      nebulaCanvasMounted: false,
      nebulaPath: '',
      nebulaFallbackText: message,
    })
    if (!runtime.reportTaintedNoticeShown) {
      runtime.reportTaintedNoticeShown = true
      this.toast('已切换为简化动效', 'warning')
    }
  },

  onNebulaImageError(): void {
    const runtime = this as unknown as FocusPageRuntime
    if (runtime.destroyed) {
      return
    }
    this.setData({
      nebulaPath: '',
      nebulaFallbackText: '星云显示失败 · 已保留文字战报',
    })
  },

  /* ------------------------------------------------------------------------ */
  /* 海报                                                                      */
  /* ------------------------------------------------------------------------ */

  buildPosterPayload(): PosterPayload | null {
    const runtime = this as unknown as FocusPageRuntime
    const record = runtime.reportRecord
    if (!record) {
      return null
    }
    const minutes = Math.max(1, Math.round(record.focusedMs / 60000))
    const stats = runtime.reportStats || runtime.stats
    const level = stats?.level ?? record.level
    const extras = [
      `中断 ${record.breaches} 次`,
      `Lv.${level} ${levelLabel(level)}`,
      `连续 ${stats?.streakDays ?? 0} 天`,
    ]
    if (this.data.reportTainted) {
      extras.push('本次不计入等级')
    }
    return {
      toolId: 'focus',
      toolName: '全息专注',
      category: '专注',
      mainResult: String(minutes),
      resultLabel: '专注时长',
      params: [
        { label: '标签', value: record.tag || DEFAULT_TAG },
        { label: '日期', value: formatLocalDate(record.endedAt) },
      ],
      extras,
      theme: uiStore.resolvedTheme,
      date: formatLocalDate(record.endedAt),
    }
  },

  async onSavePoster(): Promise<void> {
    const runtime = this as unknown as FocusPageRuntime
    if (runtime.canvasTask === 'poster' || this.data.posterLoading) {
      return
    }
    if (runtime.canvasTask === 'nebula') {
      this.toast('星云生成中，请稍候', 'info')
      return
    }
    const payload = this.buildPosterPayload()
    if (!payload) {
      return
    }
    const generator = this.selectComponent('#focus-poster-generator') as unknown as {
      generate: (data: PosterPayload) => Promise<string>
    } | null
    if (!generator) {
      this.toast('海报组件不可用，请稍后重试', 'error')
      return
    }
    runtime.canvasTask = 'poster'
    runtime.posterRequestToken += 1
    const requestToken = runtime.posterRequestToken
    const requestRecord = runtime.reportRecord
    this.setData({ posterLoading: true })
    try {
      const path = await generator.generate(payload)
      if (requestToken !== runtime.posterRequestToken) {
        return
      }
      runtime.canvasTask = ''
      if (runtime.destroyed) {
        return
      }
      if (!runtime.reportOpen || runtime.reportRecord !== requestRecord) {
        this.setData({ posterLoading: false })
        return
      }
      if (!path) {
        throw new Error('empty poster path')
      }
      this.setData({
        posterPath: path,
        posterVisible: true,
        posterLoading: false,
      })
      this.syncGuard()
    } catch (error) {
      if (requestToken !== runtime.posterRequestToken || runtime.destroyed) {
        return
      }
      runtime.canvasTask = ''
      logger.warn('focus', '海报生成失败', error)
      this.setData({ posterLoading: false })
      this.toast('海报生成失败，请稍后重试', 'error')
    }
  },

  onPosterClosed(): void {
    const runtime = this as unknown as FocusPageRuntime
    if (runtime.destroyed) {
      return
    }
    this.setData({ posterVisible: false })
    this.syncGuard()
  },

  /* ------------------------------------------------------------------------ */
  /* 音频 / 亮度 / 传感器                                                       */
  /* ------------------------------------------------------------------------ */

  shouldRunBgm(): boolean {
    const runtime = this as unknown as FocusPageRuntime
    return (
      Boolean(runtime.session) &&
      runtime.session?.fsm === 'focusing' &&
      focusRemainingMs(runtime.session as FocusSession, Date.now()) > 0 &&
      Boolean(runtime.session?.audio.bgm) &&
      preferenceStore.sound &&
      useMotion().level !== 'saver'
    )
  },

  applyAudioForFocus(): void {
    const runtime = this as unknown as FocusPageRuntime
    if (!preferenceStore.sound || useMotion().level === 'saver') {
      runtime.audio.setTracks([])
      runtime.bgm.stop()
      return
    }
    const audio = runtime.session?.audio || audioFromPrefs(runtime.prefs)
    const tracks: FocusTrack[] = []
    if (audio.rain) {
      tracks.push('rain')
    }
    if (audio.fire) {
      tracks.push('fire')
    }
    if (audio.keyboard) {
      tracks.push('keyboard')
    }
    runtime.audio.setTracks(tracks, {
      volumes: audio.volumes,
      masterVolume: audio.masterVolume,
    })
    const disabled = runtime.audio.disabled
    if (disabled && !runtime.audioToastShown && tracks.length > 0) {
      runtime.audioToastShown = true
      this.setData({ audioDisabled: true })
      this.toast('环境音不可用，已切换为静音专注', 'warning')
    }
  },

  applyVisibility(): void {
    const runtime = this as unknown as FocusPageRuntime
    if (!runtime.ready || runtime.reportOpen) {
      return
    }
    const session = runtime.session
    if (!session) {
      return
    }
    if (session.fsm === 'focusing') {
      if (runtime.visible) {
        this.setClockAnchor()
        this.enterFocusBrightness()
        /* 即使亮度读取失败，也要在专注期间保持常亮 */
        this.setKeepScreenOn(true)
        const bgmPaused = runtime.bgm.isPlaying && runtime.bgm.paused
        runtime.bgm.stop()
        if (bgmPaused) {
          this.toast('保活音频已暂停，倒计时仍精准', 'info')
        }
        runtime.audio.resume()
        this.applyAudioForFocus()
        this.startMotionListening()
        this.refreshNetworkBadge()
        this.startTicker()
      }
      return
    }
    this.restoreBrightness()
    this.setKeepScreenOn(false)
    runtime.audio.setTracks([])
    runtime.bgm.stop()
    this.stopMotionListening()
    this.clearNetworkBadge()
    if (session.fsm === 'breaking' || session.fsm === 'overheat') {
      this.startTicker(session.fsm === 'overheat' ? 1000 : TICK_MS)
    }
  },

  enterFocusBrightness(): void {
    const runtime = this as unknown as FocusPageRuntime
    if (runtime.brightnessDimmed || runtime.brightnessBusy) {
      return
    }
    if (
      typeof wx.getScreenBrightness !== 'function' ||
      typeof wx.setScreenBrightness !== 'function'
    ) {
      return
    }
    runtime.brightnessBusy = true
    try {
      /* 已有 owned 原始值优先复用，避免上次恢复失败后把暗态误存为新 original */
      const stored = loadFocusBrightness()
      if (stored && stored.owned && stored.original >= 0) {
        runtime.brightnessBusy = false
        if (
          !runtime.destroyed &&
          runtime.visible &&
          runtime.session &&
          runtime.session.fsm === 'focusing'
        ) {
          runtime.originalBrightness = stored.original
          runtime.brightnessDimmed = true
          this.applyDimBrightness()
          this.setKeepScreenOn(true)
        }
        return
      }
      wx.getScreenBrightness({
        success: (res) => {
          runtime.brightnessBusy = false
          if (
            runtime.destroyed ||
            !runtime.visible ||
            !runtime.session ||
            runtime.session.fsm !== 'focusing'
          ) {
            return
          }
          const original = safeNumber(res.value, -1)
          if (original < 0) {
            return
          }
          runtime.originalBrightness = original
          /* stale key 写失败时绝不调暗，避免崩溃后无法恢复原始亮度 */
          if (saveFocusBrightness(original)) {
            runtime.brightnessDimmed = true
            this.applyDimBrightness()
          } else {
            runtime.originalBrightness = -1
            logger.warn('focus', '亮度兜底标记写入失败，跳过调暗')
          }
          this.setKeepScreenOn(true)
        },
        fail: () => {
          runtime.brightnessBusy = false
        },
      })
    } catch (error) {
      runtime.brightnessBusy = false
      logger.warn('focus', '读取原始亮度失败', error)
    }
  },

  applyDimBrightness(): void {
    const runtime = this as unknown as FocusPageRuntime
    /* 没有成功读到 original 时绝不改亮度，避免退出后无法恢复 */
    if (!runtime.brightnessDimmed) {
      return
    }
    const value = runtime.blackScreen ? 0.05 : 0.2
    try {
      wx.setScreenBrightness({ value, fail: () => undefined })
    } catch (error) {
      logger.warn('focus', '设置专注亮度失败', error)
    }
  },

  restoreBrightness(): void {
    const runtime = this as unknown as FocusPageRuntime
    let original = runtime.originalBrightness
    if (!(original >= 0)) {
      const stored = loadFocusBrightness()
      if (stored && stored.owned) {
        original = stored.original
      }
    }
    let restoreFailed = false
    if (original >= 0 && typeof wx.setScreenBrightness === 'function') {
      try {
        wx.setScreenBrightness({
          value: original,
          /* 恢复失败时重写 stale key，下次 onLaunch 继续兜底 */
          fail: () => {
            restoreFailed = true
            saveFocusBrightness(original)
          },
        })
      } catch {
        restoreFailed = true
        saveFocusBrightness(original)
      }
    }
    if (!restoreFailed) {
      clearFocusBrightness()
    }
    runtime.brightnessDimmed = false
    runtime.originalBrightness = -1
    runtime.brightnessBusy = false
  },

  setKeepScreenOn(on: boolean): void {
    if (typeof wx.setKeepScreenOn !== 'function') {
      return
    }
    try {
      wx.setKeepScreenOn({ keepScreenOn: on, fail: () => undefined })
    } catch {
      /* 低版本不支持时保持系统默认 */
    }
  },

  installMotionListener(): void {
    const runtime = this as unknown as FocusPageRuntime
    if (
      typeof wx.onDeviceMotionChange !== 'function' ||
      typeof wx.offDeviceMotionChange !== 'function'
    ) {
      return
    }
    const handler = (res: MotionChangeResult): void => {
      this.onMotionChange(res)
    }
    runtime.motionHandler = handler
    try {
      wx.onDeviceMotionChange(handler)
    } catch (error) {
      runtime.motionAvailable = false
      logger.warn('focus', 'DeviceMotion 监听失败', error)
    }
  },

  startMotionListening(): void {
    const runtime = this as unknown as FocusPageRuntime
    if (
      runtime.motionStarted ||
      !runtime.motionAvailable ||
      !runtime.prefs.flipDetection ||
      !runtime.visible ||
      !runtime.session ||
      runtime.session.fsm !== 'focusing'
    ) {
      return
    }
    try {
      wx.startDeviceMotionListening({
        interval: 'ui',
        success: () => {
          runtime.motionStarted = true
          /* 启动回调可能晚于暂停 / 隐藏 / 战报：立即收口，避免传感器空转 */
          if (
            runtime.destroyed ||
            !runtime.visible ||
            !runtime.session ||
            runtime.session.fsm !== 'focusing' ||
            !runtime.prefs.flipDetection
          ) {
            this.stopMotionListening()
          }
        },
        fail: (error) => {
          runtime.motionStarted = false
          runtime.motionAvailable = false
          if (runtime.destroyed) {
            return
          }
          this.setData({ flipAvailable: false })
          logger.warn('focus', 'DeviceMotion 不可用', error)
        },
      })
    } catch (error) {
      runtime.motionAvailable = false
      this.setData({ flipAvailable: false })
      logger.warn('focus', 'DeviceMotion 启动异常', error)
    }
  },

  stopMotionListening(): void {
    const runtime = this as unknown as FocusPageRuntime
    if (!runtime.motionStarted) {
      return
    }
    runtime.motionStarted = false
    runtime.faceDown = false
    runtime.faceDownSince = 0
    runtime.pickupSince = 0
    try {
      wx.stopDeviceMotionListening({ fail: () => undefined })
    } catch {
      /* 已停止 */
    }
  },

  stopMotionListener(): void {
    const runtime = this as unknown as FocusPageRuntime
    if (
      runtime.motionHandler &&
      typeof wx.offDeviceMotionChange === 'function'
    ) {
      try {
        wx.offDeviceMotionChange(
          runtime.motionHandler as unknown as () => void,
        )
      } catch {
        /* 已解绑 */
      }
      runtime.motionHandler = null
    }
  },

  onMotionChange(res: MotionChangeResult): void {
    const runtime = this as unknown as FocusPageRuntime
    if (
      runtime.destroyed ||
      !runtime.visible ||
      !runtime.session ||
      runtime.session.fsm !== 'focusing' ||
      !runtime.motionStarted ||
      !runtime.prefs.flipDetection
    ) {
      return
    }
    const now = Date.now()
    const beta = safeNumber(res.beta)
    const faceDown = Math.abs(beta) > FACE_DOWN_RAD

    if (faceDown) {
      if (!runtime.faceDown) {
        runtime.faceDown = true
        runtime.faceDownSince = now
      }
      runtime.pickupSince = 0
      if (
        !runtime.blackScreen &&
        now - runtime.faceDownSince >= FACE_DOWN_HOLD_MS
      ) {
        runtime.blackScreen = true
        this.setData({ blackScreen: true })
        this.applyDimBrightness()
        this.stopRingLoop(true)
        this.setData({ ringCanvasActive: false })
      }
      return
    }

    runtime.faceDown = false
    runtime.faceDownSince = 0
    if (!runtime.blackScreen) {
      return
    }
    if (Math.abs(beta) < PICKUP_RAD) {
      if (!runtime.pickupSince) {
        runtime.pickupSince = now
      }
      if (now - runtime.pickupSince >= PICKUP_HOLD_MS) {
        runtime.blackScreen = false
        runtime.pickupSince = 0
        this.setData({ blackScreen: false })
        this.applyDimBrightness()
        this.restartRingAfterBlack()
        if (now - runtime.lastGlitchAt >= GLITCH_COOLDOWN_MS) {
          runtime.lastGlitchAt = now
          this.triggerGlitch()
        }
      }
    } else {
      runtime.pickupSince = 0
    }
  },

  restartRingAfterBlack(): void {
    const runtime = this as unknown as FocusPageRuntime
    if (!runtime.session || runtime.session.fsm !== 'focusing') {
      return
    }
    /* saver / lowMemory 只保留 CSS 静态环，避免露出未重绘的 Canvas 旧帧 */
    if (useMotion().level === 'saver' || uiStore.lowMemory) {
      this.setData({ ringCanvasActive: false })
      return
    }
    this.setData({ ringCanvasActive: true })
    this.startRingLoop()
  },

  triggerGlitch(): void {
    const runtime = this as unknown as FocusPageRuntime
    if (!runtime.session || runtime.session.fsm !== 'focusing') {
      return
    }
    runtime.session = markFocusBreach(runtime.session, Date.now())
    saveFocusSession(runtime.session, runtime.key)
    const staticMode =
      !preferenceStore.lightEffects ||
      useMotion().level === 'saver' ||
      uiStore.lowMemory
    this.stopRingLoop(true)
    this.setData({
      glitchActive: true,
      glitchStatic: staticMode,
      glitchCount: runtime.session.breaches,
      ringCanvasActive: false,
    })
    this.feedback('warn')
    if (runtime.glitchTimer) {
      clearTimeout(runtime.glitchTimer)
    }
    runtime.glitchTimer = setTimeout(() => {
      runtime.glitchTimer = 0
      if (runtime.destroyed) {
        return
      }
      this.setData({ glitchActive: false })
      if (
        runtime.session &&
        runtime.session.fsm === 'focusing' &&
        !runtime.blackScreen
      ) {
        if (useMotion().level === 'saver' || uiStore.lowMemory) {
          this.setData({ ringCanvasActive: false })
        } else {
          this.setData({ ringCanvasActive: true })
          this.startRingLoop()
        }
      }
    }, GLITCH_DURATION_MS) as unknown as number
    this.paint()
  },

  stopGlitch(): void {
    const runtime = this as unknown as FocusPageRuntime
    if (runtime.glitchTimer) {
      clearTimeout(runtime.glitchTimer)
      runtime.glitchTimer = 0
    }
    if (this.data.glitchActive && !runtime.destroyed) {
      this.setData({ glitchActive: false })
    }
  },

  /* ------------------------------------------------------------------------ */
  /* 网络徽章                                                                  */
  /* ------------------------------------------------------------------------ */

  installNetworkListener(): void {
    const runtime = this as unknown as FocusPageRuntime
    if (
      typeof wx.onNetworkStatusChange !== 'function' ||
      typeof wx.offNetworkStatusChange !== 'function'
    ) {
      return
    }
    const handler = (res: NetworkChangeResult): void => {
      this.onNetworkChange(res)
    }
    runtime.networkHandler = handler
    try {
      wx.onNetworkStatusChange(handler)
    } catch (error) {
      logger.warn('focus', '网络状态监听失败', error)
    }
  },

  onNetworkChange(res: NetworkChangeResult): void {
    const runtime = this as unknown as FocusPageRuntime
    if (
      runtime.destroyed ||
      !runtime.visible ||
      !runtime.session ||
      runtime.session.fsm !== 'focusing'
    ) {
      return
    }
    if (!res.isConnected) {
      this.stopNetworkTimer()
      runtime.networkOffline = true
      this.setData({
        networkOffline: true,
        networkBadge: '已离线 · 心流继续',
      })
      return
    }
    if (runtime.networkOffline) {
      runtime.networkOffline = false
      this.setData({
        networkOffline: false,
        networkBadge: '网络已恢复',
      })
      this.stopNetworkTimer()
      runtime.networkTimer = setTimeout(() => {
        runtime.networkTimer = 0
        if (!runtime.destroyed) {
          this.setData({ networkBadge: '' })
        }
      }, BADGE_RECOVER_MS) as unknown as number
    }
  },

  refreshNetworkBadge(): void {
    const runtime = this as unknown as FocusPageRuntime
    if (!runtime.session || runtime.session.fsm !== 'focusing') {
      this.clearNetworkBadge()
      return
    }
    if (typeof wx.getNetworkType !== 'function') {
      return
    }
    try {
      wx.getNetworkType({
        success: (res) => {
          if (
            runtime.destroyed ||
            !runtime.visible ||
            !runtime.session ||
            runtime.session.fsm !== 'focusing'
          ) {
            return
          }
          /* 先清掉旧的“恢复”自动隐藏定时器，避免覆盖新的离线状态 */
          this.stopNetworkTimer()
          if (res.networkType === 'none') {
            runtime.networkOffline = true
            this.setData({
              networkOffline: true,
              networkBadge: '已离线 · 心流继续',
            })
          } else {
            runtime.networkOffline = false
            this.setData({ networkOffline: false, networkBadge: '' })
          }
        },
        fail: () => undefined,
      })
    } catch {
      /* 网络能力缺失时隐藏徽章 */
    }
  },

  clearNetworkBadge(): void {
    const runtime = this as unknown as FocusPageRuntime
    this.stopNetworkTimer()
    runtime.networkOffline = false
    if (this.data.networkBadge || this.data.networkOffline) {
      this.setData({ networkBadge: '', networkOffline: false })
    }
  },

  stopNetworkTimer(): void {
    const runtime = this as unknown as FocusPageRuntime
    if (runtime.networkTimer) {
      clearTimeout(runtime.networkTimer)
      runtime.networkTimer = 0
    }
  },

  stopNetworkListener(): void {
    const runtime = this as unknown as FocusPageRuntime
    if (
      runtime.networkHandler &&
      typeof wx.offNetworkStatusChange === 'function'
    ) {
      try {
        wx.offNetworkStatusChange(
          runtime.networkHandler as unknown as () => void,
        )
      } catch {
        /* 已解绑 */
      }
    }
    runtime.networkHandler = null
  },

  /* ------------------------------------------------------------------------ */
  /* 呼吸环 Canvas                                                             */
  /* ------------------------------------------------------------------------ */

  queryRingCanvas(): void {
    const runtime = this as unknown as FocusPageRuntime
    const devtools = isDevtools()
    if (runtime.destroyed || devtools || uiStore.lowMemory) {
      this.setData({ ringCanvasMounted: false, canvasReady: false })
      return
    }
    runtime.ringQueryAttempts += 1
    if (runtime.ringQueryTimer) {
      clearTimeout(runtime.ringQueryTimer)
      runtime.ringQueryTimer = 0
    }
    runtime.ringQueryTimer = setTimeout(() => {
      runtime.ringQueryTimer = 0
      if (runtime.destroyed) {
        return
      }
      if (runtime.ringQueryAttempts < RING_QUERY_RETRY) {
        this.queryRingCanvas()
        return
      }
      logger.warn('focus', 'Canvas 节点查询超时，使用 CSS 静态环')
      this.setData({ canvasReady: false, ringCanvasMounted: false })
    }, RING_QUERY_TIMEOUT) as unknown as number

    this.createSelectorQuery()
      .select('#focus-ring')
      .fields({ node: true, size: true })
      .select('.focus-ring-wrap')
      .boundingClientRect()
      .exec((result: unknown[]) => {
        if (runtime.ringQueryTimer) {
          clearTimeout(runtime.ringQueryTimer)
          runtime.ringQueryTimer = 0
        }
        if (runtime.destroyed || uiStore.lowMemory) {
          return
        }
        const entry =
          result && result[0] ? (result[0] as CanvasQueryEntry) : null
        const box =
          result && result[1] ? (result[1] as CanvasBoxRect) : null
        const node = entry?.node
        /* 以环盒宽度为准：canvas 的 CSS 盒子必须严格等于 520rpx 环盒，
           不能依赖 canvas 自身的内禀尺寸 */
        const width = safeNumber(box?.width) || safeNumber(entry?.width)
        if (!node || width <= 0) {
          if (runtime.ringQueryAttempts < RING_QUERY_RETRY) {
            this.queryRingCanvas()
          } else {
            this.setData({ canvasReady: false, ringCanvasMounted: false })
          }
          return
        }
        const ctx = node.getContext('2d')
        if (!ctx) {
          this.setData({ canvasReady: false, ringCanvasMounted: false })
          return
        }
        runtime.ringCanvas = node
        runtime.ringCtx = ctx
        runtime.ringSize = width
        runtime.ringDpr = pixelRatio()
        runtime.ringGradient = null
        this.setData(
          {
            canvasReady: true,
            ringCanvasActive: true,
            ringCanvasPx: Math.round(width),
          },
          () => {
            this.safeDrawRing()
            if (
              runtime.visible &&
              runtime.session &&
              runtime.session.fsm === 'focusing' &&
              !runtime.blackScreen &&
              !this.data.glitchActive
            ) {
              this.startRingLoop()
            }
          },
        )
      })
  },

  ringToneNow(): 'cool' | 'warm' | 'danger' {
    return toneForSession((this as unknown as FocusPageRuntime).session)
  },

  ringProgressNow(): number {
    const runtime = this as unknown as FocusPageRuntime
    const session = runtime.session
    if (!session) {
      return 1
    }
    return clamp01(focusRemainingMs(session, Date.now()) / session.phaseTotalMs, 1)
  },

  safeDrawRing(): void {
    const runtime = this as unknown as FocusPageRuntime
    try {
      this.drawRingOnce()
    } catch (error) {
      logger.warn('focus', '呼吸环绘制异常，回退 CSS 静态环', error)
      runtime.ringCanvas = null
      runtime.ringCtx = null
      this.stopRingLoop(false)
      if (!runtime.destroyed) {
        this.setData({ canvasReady: false, ringCanvasMounted: false })
      }
    }
  },

  drawRingOnce(): void {
    const runtime = this as unknown as FocusPageRuntime
    const node = runtime.ringCanvas
    const ctx = runtime.ringCtx
    if (!this.data.canvasReady || !node || !ctx || runtime.ringSize <= 0) {
      return
    }
    const size = runtime.ringSize
    const dpr = runtime.ringDpr
    const pixel = Math.max(1, Math.round(size * dpr))
    if (node.width !== pixel || node.height !== pixel) {
      node.width = pixel
      node.height = pixel
      runtime.ringGradient = null
    }
    /* 每帧重置变换矩阵：避免 canvas 重挂载 / 尺寸变化后残留 scale(dpr)，
       否则圆心会被再次放大偏移，和 CSS 静态环错位 */
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const theme = uiStore.resolvedTheme
    const tone = this.ringToneNow()
    const center = size / 2
    const radius = center - 2
    ctx.clearRect(0, 0, size, size)
    ctx.globalAlpha = 1
    ctx.lineCap = 'round'

    ctx.strokeStyle =
      theme === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(21,26,36,0.12)'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(center, center, radius, 0, Math.PI * 2)
    ctx.stroke()

    ctx.strokeStyle =
      theme === 'dark' ? 'rgba(138,148,171,0.32)' : 'rgba(124,134,154,0.28)'
    ctx.lineWidth = 1
    for (let index = 0; index < 60; index += 1) {
      const angle = (index * Math.PI * 2) / 60 - Math.PI / 2
      const inner = radius - (index % 5 === 0 ? 10 : 6)
      const outer = radius - 2
      ctx.beginPath()
      ctx.moveTo(center + Math.cos(angle) * inner, center + Math.sin(angle) * inner)
      ctx.lineTo(center + Math.cos(angle) * outer, center + Math.sin(angle) * outer)
      ctx.stroke()
    }

    const progress = this.ringProgressNow()
    if (progress > 0) {
      if (
        !runtime.ringGradient ||
        runtime.ringGradient.tone !== tone ||
        runtime.ringGradient.theme !== theme ||
        runtime.ringGradient.size !== size
      ) {
        const gradient = ctx.createLinearGradient(0, 0, size, size)
        if (tone === 'danger') {
          gradient.addColorStop(0, theme === 'dark' ? '#ff7a63' : '#e85b43')
          gradient.addColorStop(1, theme === 'dark' ? '#ff5a7a' : '#c9432f')
        } else if (tone === 'warm') {
          gradient.addColorStop(0, theme === 'dark' ? '#ffcf8a' : '#d99a32')
          gradient.addColorStop(1, theme === 'dark' ? '#ff9e64' : '#b57a20')
        } else {
          gradient.addColorStop(0, theme === 'dark' ? '#8f9bff' : '#5367ff')
          gradient.addColorStop(1, theme === 'dark' ? '#6ee7c8' : '#0fb59a')
        }
        runtime.ringGradient = { tone, theme, size, gradient }
      }
      ctx.strokeStyle = runtime.ringGradient.gradient
      ctx.lineWidth = 4
      ctx.beginPath()
      ctx.arc(
        center,
        center,
        radius,
        -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * progress,
      )
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  },

  startRingLoop(): void {
    const runtime = this as unknown as FocusPageRuntime
    if (!runtime.ringCanvas || runtime.ringRaf || runtime.ringLoopTimer) {
      return
    }
    if (
      !runtime.visible ||
      !this.data.canvasReady ||
      useMotion().level === 'saver' ||
      uiStore.lowMemory ||
      runtime.blackScreen ||
      this.data.glitchActive ||
      runtime.reportOpen ||
      Boolean(this.data.setupOpen)
    ) {
      return
    }
    runtime.ringActive = true
    if (!this.data.ringCanvasActive) {
      this.setData({ ringCanvasActive: true })
    }
    const node = runtime.ringCanvas
    const canRaf = typeof node.requestAnimationFrame === 'function'
    const loop = (time: number): void => {
      if (
        runtime.destroyed ||
        !runtime.visible ||
        !runtime.session ||
        !runtime.ringCanvas ||
        runtime.blackScreen ||
        this.data.glitchActive ||
        runtime.reportOpen ||
        Boolean(this.data.setupOpen) ||
        useMotion().level === 'saver' ||
        uiStore.lowMemory
      ) {
        this.stopRingLoop(false)
        return
      }
      if (time - runtime.ringLastDrawAt >= RING_FRAME_MS) {
        runtime.ringLastDrawAt = time
        this.safeDrawRing()
      }
      if (canRaf) {
        runtime.ringRaf = node.requestAnimationFrame
          ? node.requestAnimationFrame(loop)
          : 0
      } else {
        runtime.ringLoopTimer = setTimeout(
          () => loop(Date.now()),
          RING_FRAME_MS,
        ) as unknown as number
      }
    }
    if (canRaf) {
      runtime.ringRaf = node.requestAnimationFrame
        ? node.requestAnimationFrame(loop)
        : 0
    } else {
      runtime.ringLoopTimer = setTimeout(
        () => loop(Date.now()),
        RING_FRAME_MS,
      ) as unknown as number
    }
  },

  stopRingLoop(clear: boolean): void {
    const runtime = this as unknown as FocusPageRuntime
    if (runtime.ringRaf && runtime.ringCanvas?.cancelAnimationFrame) {
      runtime.ringCanvas.cancelAnimationFrame(runtime.ringRaf)
    }
    runtime.ringRaf = 0
    if (runtime.ringLoopTimer) {
      clearTimeout(runtime.ringLoopTimer)
      runtime.ringLoopTimer = 0
    }
    runtime.ringActive = false
    if (this.data.ringCanvasActive && !runtime.destroyed) {
      this.setData({ ringCanvasActive: false })
    }
    if (clear && runtime.ringCtx && runtime.ringSize > 0) {
      try {
        const pixel = Math.round(runtime.ringSize * runtime.ringDpr)
        runtime.ringCtx.setTransform(1, 0, 0, 1, 0, 0)
        runtime.ringCtx.clearRect(0, 0, pixel, pixel)
      } catch {
        runtime.ringCtx = null
        runtime.ringCanvas = null
      }
    }
  },

  /* ------------------------------------------------------------------------ */
  /* 更新守卫 / 返回拦截                                                        */
  /* ------------------------------------------------------------------------ */

  syncGuard(): void {
    const runtime = this as unknown as FocusPageRuntime
    const blocked =
      Boolean(runtime.session) ||
      Boolean(this.data.setupOpen) ||
      runtime.reportOpen ||
      Boolean(this.data.posterVisible)
    if (blocked !== this.data.guardBlocked) {
      this.setData({ guardBlocked: blocked })
    }
  },

  syncUnloadAlert(): void {
    const runtime = this as unknown as FocusPageRuntime
    const active =
      Boolean(runtime.session) &&
      !runtime.reportOpen &&
      (runtime.session?.fsm === 'focusing' ||
        runtime.session?.fsm === 'paused' ||
        runtime.session?.fsm === 'breaking')
    if (active && !runtime.unloadAlertOn) {
      try {
        wx.enableAlertBeforeUnload({
          message: '心流正在建立，确定放弃？',
          fail: () => undefined,
        })
        runtime.unloadAlertOn = true
      } catch {
        /* 低版本不支持时保留自定义返回确认 */
      }
      return
    }
    if (!active && runtime.unloadAlertOn) {
      this.disableUnloadAlert()
    }
  },

  disableUnloadAlert(): void {
    const runtime = this as unknown as FocusPageRuntime
    runtime.unloadAlertOn = false
    try {
      wx.disableAlertBeforeUnload({ fail: () => undefined })
    } catch {
      /* 已禁用 */
    }
  },

  /* ------------------------------------------------------------------------ */
  /* 工具                                                                      */
  /* ------------------------------------------------------------------------ */

  toast(message: string, type: ToastType = 'info'): void {
    showGlassToast({
      message,
      type,
      placement: 'lower-center',
      tapToDismiss: true,
    })
  },

  /** saver 模式不震动；其余走全局 haptics / sound 接管 */
  feedback(kind: 'tick' | 'success' | 'warn'): void {
    if (useMotion().level === 'saver') {
      return
    }
    if (kind === 'success') {
      tapSuccess()
    } else if (kind === 'warn') {
      tapWarn()
    } else {
      tapTick()
    }
  },

  noop(): void {
    /* 战报 / Glitch 遮罩拦截滚动，不触发业务 */
  },
})
