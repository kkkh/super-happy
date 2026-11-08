/* ==========================================================================
   Settings Center · 企业级全局配置与管控中枢
   - 所有开关只写 preferenceStore，页面不持有业务真相
   - 选项列表直接渲染在设置页抽屉内，避免嵌套组件高度塌陷导致选项丢失
   - 高频滑块仅在 touchend 落盘；页面 onInput 只做文案预览
   - 清理 / 阈值 / Feature Flag 全部有边界兜底与玻璃 Toast 反馈
   - 分享走统一 share.ts，保持分享闭环一致
   ========================================================================== */
import { createStoreBindings } from 'mobx-miniprogram-bindings'
import { uiStore } from '../../../../core/stores/ui'
import {
  MOTION_LABELS,
  MOTION_LEVELS,
  preferenceStore,
  type AutoCleanDays,
  type HapticLevel,
} from '../../../../core/stores/preference'
import { toolboxStore } from '../../../../core/toolbox/store'
import { tapSuccess, tapTick, tapWarn } from '../../../../core/utils/haptics'
import { showGlassToast } from '../../../../components/glass-toast/toast'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import { applyAutoClean, readCacheSummary } from '../../../../core/services/storage-governor'
import { useSound } from '../../../../core/services/sound'
import { ambientTheme } from '../../../../core/theme/ambient-theme'
import { APP_VERSION, ROUTES } from '../../../../core/constants/index'
import { readUpdatePending } from '../../../../core/services/update'
import { historyStore } from '../../../../core/stores/history'
import {
  buildGalaxyNodes,
  GalaxyEngine,
  type GalaxyCtx,
} from '../../utils/canvasGalaxy'
import {
  CRON_PRESETS,
  CronScheduler,
  parseCron,
  type CronSchedulerState,
} from '../../utils/cronParser'
import {
  appendTransferPart,
  createTransfer,
  type TransferPackage,
  type TransferState,
} from '../../utils/slicedTransfer'
import {
  EventLog,
  TimeTravelEngine,
  encodeBackup,
  readAutoSnapshots,
  readHotSlots,
  restoreBackupPayload,
  writeAutoSnapshot,
  writeHotSlot,
  type BackupSlot,
  type CyberEvent,
  type TimeTravelFrameView,
} from '../../utils/timeTravelEngine'
import {
  decryptVault,
  encryptVault,
  isVaultText,
  validatePassphrase,
} from '../../utils/aesVault'

type SettingsToastType = 'info' | 'success' | 'error' | 'warning'
type PickerKind = 'haptics' | 'clean' | ''

interface PickerOption {
  value: string
  label: string
  desc: string
}

/** 抽屉里的可视图元：active 由当前 Store 值实时计算 */
interface PickerOptionView extends PickerOption {
  active: boolean
}

interface SettingsChangeDetail<T> {
  value: T
}

interface SettingsRuntime {
  themeBindings?: { destroyStoreBindings: () => void }
  preferenceBindings?: { destroyStoreBindings: () => void }
  toolboxBindings?: { destroyStoreBindings: () => void }
  pickerKind: PickerKind
  lastScrollAt: number
  /** Cyber Space OS 运行时：全部在页面卸载时清理 */
  cyberDestroyed: boolean
  galaxy?: GalaxyEngine
  galaxyCtx?: GalaxyCtx
  galaxyCanvas?: CyberCanvasNode
  galaxyRaf: number
  galaxyTimer: number
  galaxyLastFrame: number
  galaxyLastHudAt: number
  galaxyPaused: boolean
  galaxyRect: { left: number; top: number; width: number; height: number }
  galaxyStartX: number
  galaxyStartY: number
  galaxyLastX: number
  galaxyLastY: number
  galaxyPinch: number
  galaxyStartedAt: number
  galaxyMoved: boolean
  pilot?: CronScheduler
  pilotRunning: boolean
  pilotSeq: number
  timeTravel?: TimeTravelEngine
  eventLog?: EventLog
  restoreStorageHook?: () => void
  eventFlushTimer: number
  transferPackage?: TransferPackage
  transferState?: TransferState | null
  locks: Record<string, number>
  vaultFile: string
  vaultShared: boolean
  disasterChecked: boolean
}

interface CyberCanvasNode {
  width: number
  height: number
  getContext(type: '2d'): GalaxyCtx | null
  requestAnimationFrame?: (callback: (time: number) => void) => number
  cancelAnimationFrame?: (handle: number) => void
}

interface SlotView extends BackupSlot {
  sizeText: string
}

interface GalaxySelectedView {
  id: string
  label: string
  kind: string
  value: string
}

interface GalaxyFallbackView {
  id: string
  label: string
  kind: string
  value: string
  color: string
}

interface CyberTouch {
  clientX?: number
  clientY?: number
  pageX?: number
  pageY?: number
  x?: number
  y?: number
}

interface CyberTouchEvent {
  touches?: CyberTouch[]
  changedTouches?: CyberTouch[]
}

function touchPoint(
  touch: CyberTouch | undefined,
  rect: { left: number; top: number },
): { x: number; y: number } {
  if (!touch) {
    return { x: 0, y: 0 }
  }
  /* Canvas 触摸事件通常带相对画布的 x / y；缺失时再回退 client/page 坐标 */
  if (typeof touch.x === 'number' && typeof touch.y === 'number') {
    return { x: touch.x, y: touch.y }
  }
  const clientX =
    typeof touch.clientX === 'number'
      ? touch.clientX
      : typeof touch.pageX === 'number'
        ? touch.pageX
        : 0
  const clientY =
    typeof touch.clientY === 'number'
      ? touch.clientY
      : typeof touch.pageY === 'number'
        ? touch.pageY
        : 0
  return { x: clientX - rect.left, y: clientY - rect.top }
}

const CYBER_PILOT_KEY = 'cyber:pilot:v1'
const CYBER_ACTION_LOCK = 300

const KIND_LABELS: Record<string, string> = {
  favorite: '收藏星球',
  history: '历史星球',
  preference: '偏好星球',
  snapshot: '快照星球',
}

const KIND_COLORS: Record<string, string> = {
  favorite: '#FFD166',
  history: '#7FE0C8',
  preference: '#A97BFF',
  snapshot: '#5FD0FF',
}

function formatClock(timestamp: number | null): string {
  if (!timestamp || !Number.isFinite(timestamp)) {
    return '—'
  }
  const date = new Date(timestamp)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`
}

function formatBytesText(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B'
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${bytes} B`
}

function bytesToHex(bytes: Uint8Array): string {
  let output = ''
  for (let index = 0; index < bytes.length; index += 1) {
    output += bytes[index].toString(16).padStart(2, '0')
  }
  return output
}

/** wx.getRandomValues 不可用时的 IV 兜底；IV 只要求唯一性，不承载密钥 */
function fallbackIvHex(): string {
  const bytes = new Uint8Array(16)
  const seed = Date.now()
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256)
  }
  bytes[0] ^= seed & 0xff
  bytes[1] ^= (seed >>> 8) & 0xff
  bytes[2] ^= (seed >>> 16) & 0xff
  bytes[3] ^= (seed >>> 24) & 0xff
  return bytesToHex(bytes)
}

function slotViews(slots: BackupSlot[]): SlotView[] {
  return slots.map((slot) => ({
    ...slot,
    sizeText: formatBytesText(slot.bytes),
  }))
}

function pilotStatusLabel(state: CronSchedulerState | null): string {
  if (!state) {
    return '未启动'
  }
  if (state.status === 'running') {
    return '自动任务执行中'
  }
  if (state.status === 'error') {
    return `异常 · ${state.lastError || '未知'}`
  }
  if (state.status === 'idle') {
    return '已武装 · 等待触发'
  }
  return '未启动'
}

interface ChangelogEntry {
  version: string
  date: string
  title: string
  notes: string[]
}

const CHANGELOG: ChangelogEntry[] = [
  {
    version: 'v1.1.0',
    date: '2026-11-06',
    title: '控制中枢上线',
    notes: [
      '新增全局设置中心：感官、光效、动画与存储策略统一管控',
      '新增玻璃开关 / 滑轨 / 选择抽屉，全部消费液态玻璃令牌',
      '最近使用新增时间戳与自动清理阈值，默认保留 30 天',
      '音效引擎完成接管，静音与静震互不绑架',
    ],
  },
  {
    version: 'v1.0.0',
    date: '2026-10-20',
    title: '工具箱首发',
    notes: [
      '20 个纯本机工具，覆盖计算、日期、文本与图片',
      '全局隐私授权、最近使用与分享深链闭环',
      'Skyline + glass-easel 液态玻璃视觉体系',
    ],
  },
]

/** 震动选项数据源 */
const HAPTIC_OPTIONS: PickerOption[] = [
  { value: 'off', label: '关闭', desc: '完全静震，仅保留音效与视觉反馈' },
  { value: 'light', label: '轻震', desc: '点按轻触，成功与警示自动抬一档' },
  { value: 'heavy', label: '重震', desc: '所有反馈提升到中高强度，适合嘈杂环境' },
]

/** 自动清理选项数据源 */
const CLEAN_OPTIONS: PickerOption[] = [
  { value: '7', label: '7 天', desc: '每周自动遗忘，适合轻量使用' },
  { value: '30', label: '30 天', desc: '默认节奏，兼顾回忆与清爽' },
  { value: '0', label: '永不清理', desc: '最近使用一直保留，直到手动清空' },
]

function resolveMotionLabel(index: number): string {
  const level = MOTION_LEVELS[index]
  return level ? MOTION_LABELS[level] : preferenceStore.motionLabel
}

/** 由当前选中值生成带高亮状态的选项数组 */
function buildPickerOptions(options: PickerOption[], selected: string): PickerOptionView[] {
  return options.map((option) => ({
    ...option,
    active: option.value === selected,
  }))
}

Page({
  /* 此处是处理全局分享与深链参数校验的边界 */
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    themeClass: uiStore.themeClass,
    themeSwitching: false,
    sound: preferenceStore.sound,
    lightEffects: preferenceStore.lightEffects,
    hapticsLabel: preferenceStore.hapticsLabel,
    motionIndex: preferenceStore.motionIndex,
    motionLabel: preferenceStore.motionLabel,
    motionPreview: preferenceStore.motionLabel,
    autoCleanLabel: preferenceStore.autoCleanLabel,
    statusText: preferenceStore.statusText,
    flagAi: preferenceStore.flags.enable_ai_assist,
    recentCount: toolboxStore.recents.length,
    cacheText: '—',
    cacheDetail: '读取中',
    version: APP_VERSION,
    hasPendingUpdate: false,
    /** 从更新弹窗「查看更新日志」进入时，滚动定位到版本区块 */
    scrollTarget: '',
    navTop: 44,
    navRight: 16,
    contentTop: 96,
    heroStyle: '',
    motionMarks: [{ label: '全效' }, { label: '精简' }, { label: '省电' }],
    changelogOpen: false,
    changelog: CHANGELOG,
    pickerShow: false,
    pickerTitle: '',
    pickerDesc: '',
    pickerOptions: [] as PickerOptionView[],
    confirmShow: false,

    /* ---- Cyber Space OS · 数据星系 ---- */
    geekLabOpen: false,
    geekGuideOpen: false,
    cyberCanvasReady: false,
    cyberFallback: false,
    galaxyNodeCount: 0,
    galaxyDegraded: false,
    galaxyZoomText: '100%',
    galaxySelected: null as GalaxySelectedView | null,
    galaxyFallbackNodes: [] as GalaxyFallbackView[],

    /* ---- Auto-Pilot ---- */
    pilotEnabled: false,
    pilotExpression: '0 3 * * 1',
    pilotPreset: 'weekly',
    pilotPresets: CRON_PRESETS,
    pilotStatusText: '未启动',
    pilotNextText: '—',
    pilotLastText: '尚未运行',
    pilotRunCount: 0,
    pilotProgress: 0,
    pilotRunning: false,
    pilotError: '',

    /* ---- Time Travel ---- */
    timelineFrames: [] as TimeTravelFrameView[],
    timelineIndex: 0,
    timelineMax: 0,
    timelinePreviewLabel: '尚未选择帧',
    timelinePreviewText: '左右滑动时间轴，预览任意一秒的完整状态。',
    travelBusy: false,

    /* ---- Sliced Transport ---- */
    transportText: '',
    transportTotal: 0,
    transportIndex: 0,
    transportCurrent: '',
    transportProgress: '0 / 0',
    transportSignature: '',
    transportInput: '',
    transportStatus: 'idle',
    transportMessage: '等待生成分片',
    transportResult: '',
    transportBusy: false,

    /* ---- Vault ---- */
    vaultPass: 'chaohuan-cyber',
    vaultText: '',
    vaultFile: '',
    vaultMessage: '冷备使用 AES-256-CBC；口令至少 6 位。',
    vaultBusy: false,

    /* ---- Backups ---- */
    hotSlots: [] as SlotView[],
    autoSlots: [] as SlotView[],

    /* ---- Event Log ---- */
    eventLog: [] as CyberEvent[],
    eventCount: 0,
  },

  onLoad(query: Record<string, string | undefined>) {
    preferenceStore.init()
    toolboxStore.init()
    historyStore.init()
    if (query && query.changelog === '1') {
      /* 更新弹窗的第三操作：直接展开并定位更新日志 */
      this.setData({ changelogOpen: true, scrollTarget: 'settings-changelog' })
    }
    const runtime = this as unknown as SettingsRuntime
    runtime.pickerKind = ''
    runtime.lastScrollAt = 0
    runtime.cyberDestroyed = false
    runtime.galaxyRaf = 0
    runtime.galaxyTimer = 0
    runtime.galaxyLastFrame = 0
    runtime.galaxyLastHudAt = 0
    runtime.galaxyPaused = false
    runtime.galaxyRect = { left: 0, top: 0, width: 0, height: 0 }
    runtime.galaxyStartX = 0
    runtime.galaxyStartY = 0
    runtime.galaxyLastX = 0
    runtime.galaxyLastY = 0
    runtime.galaxyPinch = 0
    runtime.galaxyStartedAt = 0
    runtime.galaxyMoved = false
    runtime.pilotRunning = false
    runtime.pilotSeq = 0
    runtime.eventFlushTimer = 0
    runtime.transferState = null
    runtime.locks = {}
    runtime.vaultFile = ''
    runtime.vaultShared = false
    runtime.disasterChecked = false
    this.setupInsets()

    runtime.themeBindings = createStoreBindings(this, {
      store: uiStore,
      fields: {
        themeClass: () => uiStore.themeClass,
        themeSwitching: () => uiStore.themeSwitching,
      },
      actions: [],
    })

    runtime.preferenceBindings = createStoreBindings(this, {
      store: preferenceStore,
      fields: {
        sound: () => preferenceStore.sound,
        lightEffects: () => preferenceStore.lightEffects,
        hapticsLabel: () => preferenceStore.hapticsLabel,
        motionIndex: () => preferenceStore.motionIndex,
        motionLabel: () => preferenceStore.motionLabel,
        autoCleanLabel: () => preferenceStore.autoCleanLabel,
        statusText: () => preferenceStore.statusText,
        flagAi: () => preferenceStore.flags.enable_ai_assist,
      },
      actions: [],
    })

    runtime.toolboxBindings = createStoreBindings(this, {
      store: toolboxStore,
      fields: {
        recentCount: () => toolboxStore.recents.length,
      },
      actions: [],
    })

    this.refreshCache()
    this.refreshPendingUpdate()
    this.initCyberSpace()
  },

  onShow() {
    uiStore.syncNativeChrome()
    this.refreshCache()
    this.refreshPendingUpdate()
    this.pushCyberEvent('lifecycle', 'onShow', '设置页回到前台 · 恢复渲染与调度')
    this.startGalaxyLoop()
    const runtime = this as unknown as SettingsRuntime
    if (runtime.pilot) {
      runtime.pilot.tick()
    }
    this.refreshPilotStatus()
    this.refreshSlots()
  },

  onHide() {
    this.pushCyberEvent('lifecycle', 'onHide', '页面隐藏 · 暂停 Canvas 渲染循环')
    this.stopGalaxyLoop()
  },

  onUnload() {
    const runtime = this as unknown as SettingsRuntime
    this.teardownCyberSpace()
    if (runtime.themeBindings) {
      runtime.themeBindings.destroyStoreBindings()
    }
    if (runtime.preferenceBindings) {
      runtime.preferenceBindings.destroyStoreBindings()
    }
    if (runtime.toolboxBindings) {
      runtime.toolboxBindings.destroyStoreBindings()
    }
  },

  /* ---- 顶部导航 / 内容安全区 ---- */
  setupInsets(): void {
    try {
      const windowInfo = wx.getWindowInfo()
      const capsule = wx.getMenuButtonBoundingClientRect()
      const navTop = Math.max(0, capsule.top || windowInfo.statusBarHeight || 20)
      this.setData({
        navTop,
        navRight: Math.max(16, (windowInfo.windowWidth || 375) - capsule.left + 8),
        contentTop: Math.max(72, (capsule.bottom || navTop + 48) + 16),
      })
    } catch {
      this.setData({ navTop: 44, navRight: 16, contentTop: 96 })
    }
  },

  onBack(): void {
    tapTick()
    wx.navigateBack({
      fail: () => {
        wx.reLaunch({ url: ROUTES.home })
      },
    })
  },

  onOpenCockpit(): void {
    tapTick()
    wx.navigateTo({
      url: ROUTES.cockpit,
      fail: () => {
        this.showToast('数据驾驶舱加载失败，请稍后重试', 'error')
      },
    })
  },

  /* ---- Cyber Space OS · 生命周期与总装 ---- */
  initCyberSpace(): void {
    const runtime = this as unknown as SettingsRuntime
    runtime.timeTravel = new TimeTravelEngine(20)
    runtime.eventLog = new EventLog(50)
    runtime.restoreStorageHook = runtime.eventLog.installStorageHook(wx)
    this.pushCyberEvent('lifecycle', 'onLaunch', this.launchDetail())
    this.captureFrame('系统启动')
    this.restorePilotConfig()
    this.refreshSlots()
    this.refreshTimeline()
    this.runDisasterCheck()
  },

  teardownCyberSpace(): void {
    const runtime = this as unknown as SettingsRuntime
    runtime.cyberDestroyed = true
    this.stopGalaxyLoop()
    if (runtime.galaxy) {
      runtime.galaxy.clear()
      runtime.galaxy = undefined
    }
    runtime.galaxyCtx = undefined
    runtime.galaxyCanvas = undefined
    if (runtime.pilot) {
      runtime.pilot.destroy()
      runtime.pilot = undefined
    }
    if (runtime.eventFlushTimer) {
      clearTimeout(runtime.eventFlushTimer)
      runtime.eventFlushTimer = 0
    }
    if (runtime.restoreStorageHook) {
      runtime.restoreStorageHook()
      runtime.restoreStorageHook = undefined
    }
    if (runtime.eventLog) {
      runtime.eventLog.clear()
      runtime.eventLog = undefined
    }
    if (runtime.timeTravel) {
      runtime.timeTravel.clear()
      runtime.timeTravel = undefined
    }
    runtime.transferPackage = undefined
    runtime.transferState = null
  },

  launchDetail(): string {
    try {
      const options = wx.getLaunchOptionsSync()
      return `scene ${options.scene || 0} · ${options.path || 'unknown'}`
    } catch {
      return 'launch options unavailable'
    }
  },

  pushCyberEvent(
    kind: 'lifecycle' | 'storage' | 'action' | 'error',
    name: string,
    detail = '',
  ): void {
    const runtime = this as unknown as SettingsRuntime
    if (!runtime.eventLog) {
      return
    }
    runtime.eventLog.push(kind, name, detail)
    if (runtime.eventFlushTimer) {
      return
    }
    runtime.eventFlushTimer = setTimeout(() => {
      runtime.eventFlushTimer = 0
      if (runtime.cyberDestroyed || !runtime.eventLog) {
        return
      }
      const events = runtime.eventLog.list(50)
      this.setData({ eventLog: events, eventCount: events.length })
    }, 300) as unknown as number
  },

  /* ---- 极客实验室折叠面板 ---- */
  onToggleGeekLab(): void {
    const runtime = this as unknown as SettingsRuntime
    tapTick()
    if (this.data.geekLabOpen) {
      this.stopGalaxyLoop()
      if (runtime.galaxy) {
        runtime.galaxy.clear()
        runtime.galaxy = undefined
      }
      runtime.galaxyCtx = undefined
      runtime.galaxyCanvas = undefined
      runtime.galaxyRect = { left: 0, top: 0, width: 0, height: 0 }
      this.setData({
        geekLabOpen: false,
        cyberCanvasReady: false,
        cyberFallback: false,
        galaxyNodeCount: 0,
        galaxySelected: null,
      })
      this.pushCyberEvent('action', 'geek-lab', 'collapsed')
      return
    }

    this.setData(
      {
        geekLabOpen: true,
        cyberCanvasReady: false,
        cyberFallback: false,
      },
      () => {
        this.pushCyberEvent('action', 'geek-lab', 'expanded')
        const mount = (): void => {
          if (this.data.geekLabOpen) {
            this.mountGalaxy()
          }
        }
        if (typeof wx.nextTick === 'function') {
          wx.nextTick(() => setTimeout(mount, 90))
        } else {
          setTimeout(mount, 140)
        }
      },
    )
  },

  onToggleGeekGuide(): void {
    tapTick()
    this.setData({ geekGuideOpen: !this.data.geekGuideOpen })
  },

  /* ---- 数据星系 Canvas ---- */
  mountGalaxy(attempt = 0): void {
    const runtime = this as unknown as SettingsRuntime
    if (
      runtime.cyberDestroyed ||
      !this.data.geekLabOpen ||
      typeof this.createSelectorQuery !== 'function'
    ) {
      return
    }
    if (runtime.galaxy) {
      this.startGalaxyLoop()
      return
    }
    try {
      this.createSelectorQuery()
        .select('#galaxyCanvas')
        .fields({ node: true, size: true })
        .exec((result: unknown[]) => {
          if (runtime.cyberDestroyed || !this.data.geekLabOpen) {
            return
          }
          const entry = (result && result[0]) as
            | {
                node?: CyberCanvasNode
                width?: number
                height?: number
              }
            | undefined
          const width = entry && typeof entry.width === 'number' ? entry.width : 0
          const height = entry && typeof entry.height === 'number' ? entry.height : 0
          const node = entry && entry.node
          if (!node || width <= 0 || height <= 0) {
            this.retryMountGalaxy(attempt, 'Canvas 节点或尺寸尚未就绪')
            return
          }
          const canvas = node
          let dpr = 2
          try {
            const info = wx.getWindowInfo()
            const cap = uiStore.lowMemory || preferenceStore.motion === 'saver' ? 2 : 3
            dpr = Math.max(1, Math.min(cap, info.pixelRatio || 2))
          } catch {
            dpr = 2
          }
          canvas.width = Math.round(width * dpr)
          canvas.height = Math.round(height * dpr)
          const ctx = canvas.getContext('2d')
          if (!ctx) {
            this.retryMountGalaxy(attempt, 'Canvas 2D 上下文不可用')
            return
          }
          ctx.scale(dpr, dpr)
          const engine = new GalaxyEngine({
            width,
            height,
            degraded: uiStore.lowMemory || preferenceStore.motion === 'saver',
            theme: uiStore.resolvedTheme,
          })
          this.fillGalaxyNodes(engine)
          runtime.galaxy = engine
          runtime.galaxyCtx = ctx
          runtime.galaxyCanvas = canvas
          runtime.galaxyRect = { left: 0, top: 0, width, height }
          this.setData({
            cyberCanvasReady: true,
            cyberFallback: false,
            galaxyNodeCount: engine.getParticles().length,
            galaxyDegraded: engine.isDegraded(),
            galaxyZoomText: '100%',
          })
          this.startGalaxyLoop()
          this.pushCyberEvent('action', 'galaxy', `Canvas 引擎启动 · ${width}×${height}`)
        })
    } catch (error) {
      this.retryMountGalaxy(
        attempt,
        error instanceof Error ? error.message : 'Canvas 查询异常',
      )
    }
  },

  retryMountGalaxy(attempt: number, reason: string): void {
    if (attempt >= 5) {
      this.activateGalaxyFallback(reason)
      return
    }
    setTimeout(() => {
      if (this.data.geekLabOpen && !(this as unknown as SettingsRuntime).cyberDestroyed) {
        this.mountGalaxy(attempt + 1)
      }
    }, 120)
  },

  fillGalaxyNodes(engine: GalaxyEngine): void {
    const nodes = buildGalaxyNodes({
      favorites: toolboxStore.favorites,
      history: historyStore.records,
      preferenceCount: Object.keys(preferenceStore.snapshot().flags).length + 4,
      snapshotCount: readAutoSnapshots().length,
    })
    engine.setNodes(nodes)
    this.setData({
      galaxyNodeCount: nodes.length,
      galaxyFallbackNodes: nodes.map((node) => ({
        id: node.id,
        label: node.label,
        kind: node.kind,
        value: node.value || '',
        color: KIND_COLORS[node.kind] || KIND_COLORS.snapshot,
      })),
    })
  },

  activateGalaxyFallback(reason: string): void {
    this.setData({ cyberCanvasReady: false, cyberFallback: true, galaxyDegraded: true })
    this.pushCyberEvent('error', 'galaxy', `已降级为静态星球列表：${reason}`)
  },

  syncGalaxyDegrade(): void {
    const runtime = this as unknown as SettingsRuntime
    if (!runtime.galaxy) {
      return
    }
    const degraded = uiStore.lowMemory || preferenceStore.motion === 'saver'
    runtime.galaxy.setDegraded(degraded)
    if (this.data.galaxyDegraded !== degraded) {
      this.setData({ galaxyDegraded: degraded })
    }
  },

  startGalaxyLoop(): void {
    const runtime = this as unknown as SettingsRuntime
    if (runtime.galaxy) {
      runtime.galaxy.setTheme(uiStore.resolvedTheme)
    }
    if (
      runtime.cyberDestroyed ||
      !this.data.geekLabOpen ||
      !runtime.galaxy ||
      !runtime.galaxyCanvas ||
      runtime.galaxyRaf ||
      runtime.galaxyTimer
    ) {
      return
    }
    this.syncGalaxyDegrade()
    runtime.galaxyPaused = false
    runtime.galaxyLastFrame = 0
    let schedule: () => void = () => undefined
    const frame = (time: number): void => {
      if (runtime.cyberDestroyed || runtime.galaxyPaused) {
        return
      }
      const engine = runtime.galaxy
      if (!engine) {
        return
      }
      const last = runtime.galaxyLastFrame
      runtime.galaxyLastFrame = time
      const dt = last ? Math.min(32, Math.max(1, time - last)) : 16
      engine.step(dt)
      engine.draw(runtime.galaxyCtx || null)
      if (time - runtime.galaxyLastHudAt > 420) {
        runtime.galaxyLastHudAt = time
        const zoomText = `${Math.round(engine.getView().zoom * 100)}%`
        if (zoomText !== this.data.galaxyZoomText) {
          this.setData({ galaxyZoomText: zoomText })
        }
      }
      schedule()
    }
    schedule = (): void => {
      if (runtime.cyberDestroyed || runtime.galaxyPaused || !runtime.galaxy) {
        return
      }
      const canvas = runtime.galaxyCanvas
      if (canvas && typeof canvas.requestAnimationFrame === 'function') {
        runtime.galaxyRaf = canvas.requestAnimationFrame(frame)
      } else {
        runtime.galaxyTimer = setTimeout(() => frame(Date.now()), 16) as unknown as number
      }
    }
    schedule()
  },

  stopGalaxyLoop(): void {
    const runtime = this as unknown as SettingsRuntime
    runtime.galaxyPaused = true
    if (runtime.galaxyRaf && runtime.galaxyCanvas?.cancelAnimationFrame) {
      runtime.galaxyCanvas.cancelAnimationFrame(runtime.galaxyRaf)
    }
    if (runtime.galaxyTimer) {
      clearTimeout(runtime.galaxyTimer)
    }
    runtime.galaxyRaf = 0
    runtime.galaxyTimer = 0
    runtime.galaxyLastFrame = 0
  },

  onGalaxyTouchStart(event: CyberTouchEvent): void {
    const runtime = this as unknown as SettingsRuntime
    const engine = runtime.galaxy
    const touches = event && Array.isArray(event.touches) ? event.touches : []
    if (!engine || touches.length === 0) {
      return
    }
    const first = touchPoint(touches[0], runtime.galaxyRect)
    runtime.galaxyStartX = first.x
    runtime.galaxyStartY = first.y
    runtime.galaxyLastX = first.x
    runtime.galaxyLastY = first.y
    runtime.galaxyStartedAt = Date.now()
    runtime.galaxyMoved = false
    if (touches.length >= 2) {
      const second = touchPoint(touches[1], runtime.galaxyRect)
      runtime.galaxyPinch = Math.max(
        1,
        Math.sqrt(
          (second.x - first.x) * (second.x - first.x) +
            (second.y - first.y) * (second.y - first.y),
        ),
      )
    } else {
      runtime.galaxyPinch = 0
    }
  },

  onGalaxyTouchMove(event: CyberTouchEvent): void {
    const runtime = this as unknown as SettingsRuntime
    const engine = runtime.galaxy
    const touches = event && Array.isArray(event.touches) ? event.touches : []
    if (!engine || touches.length === 0) {
      return
    }
    if (touches.length >= 2) {
      const first = touchPoint(touches[0], runtime.galaxyRect)
      const second = touchPoint(touches[1], runtime.galaxyRect)
      const distance = Math.max(
        1,
        Math.sqrt(
          (second.x - first.x) * (second.x - first.x) +
            (second.y - first.y) * (second.y - first.y),
        ),
      )
      const centerX = (first.x + second.x) / 2
      const centerY = (first.y + second.y) / 2
      if (runtime.galaxyPinch > 0) {
        engine.zoomAt(distance / runtime.galaxyPinch, centerX, centerY)
      }
      runtime.galaxyPinch = distance
      runtime.galaxyMoved = true
      const zoomText = `${Math.round(engine.getView().zoom * 100)}%`
      if (zoomText !== this.data.galaxyZoomText) {
        this.setData({ galaxyZoomText: zoomText })
      }
      return
    }

    const point = touchPoint(touches[0], runtime.galaxyRect)
    const dx = point.x - runtime.galaxyLastX
    const dy = point.y - runtime.galaxyLastY
    runtime.galaxyLastX = point.x
    runtime.galaxyLastY = point.y
    engine.pan(dx, dy)
    if (
      Math.abs(point.x - runtime.galaxyStartX) > 7 ||
      Math.abs(point.y - runtime.galaxyStartY) > 7
    ) {
      runtime.galaxyMoved = true
    }
  },

  onGalaxyTouchEnd(event: CyberTouchEvent): void {
    const runtime = this as unknown as SettingsRuntime
    const engine = runtime.galaxy
    if (!engine) {
      return
    }
    const changed =
      event && Array.isArray(event.changedTouches) && event.changedTouches.length > 0
        ? event.changedTouches[0]
        : undefined
    const point = touchPoint(changed, runtime.galaxyRect)
    const local = { x: point.x, y: point.y }
    const elapsed = Date.now() - runtime.galaxyStartedAt
    runtime.galaxyPinch = 0
    if (runtime.galaxyMoved || elapsed > 300) {
      runtime.galaxyMoved = false
      return
    }
    const particle = engine.hitTest(local.x, local.y)
    this.setData({
      galaxySelected: particle
        ? {
            id: particle.id,
            label: particle.label,
            kind: KIND_LABELS[particle.kind] || '数据星球',
            value: particle.value,
          }
        : null,
    })
  },

  onGalaxyTouchCancel(): void {
    const runtime = this as unknown as SettingsRuntime
    runtime.galaxyPinch = 0
    runtime.galaxyMoved = false
  },

  onGalaxyZoomIn(): void {
    const runtime = this as unknown as SettingsRuntime
    if (!runtime.galaxy) {
      return
    }
    runtime.galaxy.zoomBy(1.18)
    this.setData({ galaxyZoomText: `${Math.round(runtime.galaxy.getView().zoom * 100)}%` })
  },

  onGalaxyZoomOut(): void {
    const runtime = this as unknown as SettingsRuntime
    if (!runtime.galaxy) {
      return
    }
    runtime.galaxy.zoomBy(0.84)
    this.setData({ galaxyZoomText: `${Math.round(runtime.galaxy.getView().zoom * 100)}%` })
  },

  onGalaxyReset(): void {
    const runtime = this as unknown as SettingsRuntime
    if (!runtime.galaxy) {
      return
    }
    runtime.galaxy.resetView()
    runtime.galaxy.select('')
    this.setData({ galaxyZoomText: '100%', galaxySelected: null })
  },

  /* ---- 300ms 统一动作锁 ---- */
  lockAction(key: string): boolean {
    const runtime = this as unknown as SettingsRuntime
    const now = Date.now()
    const last = runtime.locks[key] || 0
    if (now - last < CYBER_ACTION_LOCK) {
      return false
    }
    runtime.locks[key] = now
    return true
  },

  /* ---- Auto-Pilot ---- */
  restorePilotConfig(): void {
    try {
      const raw = wx.getStorageSync(CYBER_PILOT_KEY)
      if (!raw || typeof raw !== 'object') {
        return
      }
      const config = raw as { enabled?: boolean; expression?: string }
      const expression =
        typeof config.expression === 'string' ? config.expression.trim() : ''
      if (!expression || !parseCron(expression)) {
        return
      }
      const preset = CRON_PRESETS.find((item) => item.expression === expression)
      this.setData({
        pilotExpression: expression,
        pilotPreset: preset ? preset.key : 'custom',
      })
      if (config.enabled === true) {
        this.startPilot(expression, true)
      }
    } catch {
      this.pushCyberEvent('error', 'pilot', '自动任务配置读取失败')
    }
  },

  savePilotConfig(enabled: boolean, expression: string): void {
    try {
      wx.setStorageSync(CYBER_PILOT_KEY, { enabled, expression })
    } catch {
      this.pushCyberEvent('error', 'pilot', '自动任务配置写入失败')
    }
  },

  onPilotToggle(event: WechatMiniprogram.CustomEvent<SettingsChangeDetail<boolean>>): void {
    const value = Boolean(event.detail && event.detail.value)
    if (value) {
      const ok = this.startPilot(this.data.pilotExpression)
      if (!ok) {
        this.setData({ pilotEnabled: false })
      }
      return
    }
    this.stopPilot()
    this.showToast('Auto-Pilot 已停止', 'info')
  },

  onPilotPresetTap(event: WechatMiniprogram.TouchEvent): void {
    const key = String(event.currentTarget.dataset.key || '')
    const preset = CRON_PRESETS.find((item) => item.key === key)
    if (!preset) {
      return
    }
    tapTick()
    this.setData({
      pilotExpression: preset.expression,
      pilotPreset: preset.key,
      pilotError: '',
    })
    if (this.data.pilotEnabled) {
      this.startPilot(preset.expression, true)
    }
  },

  onPilotExpressionInput(event: WechatMiniprogram.Input): void {
    this.setData({ pilotExpression: String(event.detail.value || '') })
  },

  onPilotApply(): void {
    if (!this.lockAction('pilot')) {
      return
    }
    const expression = this.data.pilotExpression.trim().replace(/\s+/g, ' ')
    const parsed = parseCron(expression)
    if (!parsed) {
      this.setData({ pilotError: '表达式不合法：需要 5 段，如 0 3 * * 1' })
      showGlassToast({ message: 'Cron 表达式不合法', type: 'error' })
      tapWarn()
      return
    }
    const preset = CRON_PRESETS.find((item) => item.expression === parsed.source)
    this.setData({
      pilotExpression: parsed.source,
      pilotPreset: preset ? preset.key : 'custom',
      pilotError: '',
    })
    if (this.data.pilotEnabled) {
      this.startPilot(parsed.source, true)
    } else {
      this.savePilotConfig(false, parsed.source)
    }
    this.showToast(`Cron 已就绪 · ${parsed.source}`, 'success')
    this.pushCyberEvent('action', 'pilot', `表达式 ${parsed.source}`)
  },

  onPilotRunNow(): void {
    if (!this.lockAction('pilot-run')) {
      return
    }
    if (this.data.pilotRunning) {
      this.showToast('自动任务正在执行，请稍候', 'warning')
      return
    }
    tapTick()
    void this.runAutoPilot()
  },

  startPilot(expression: string, silent = false): boolean {
    const runtime = this as unknown as SettingsRuntime
    const parsed = parseCron(expression)
    if (!parsed) {
      this.setData({ pilotError: 'Cron 表达式不合法' })
      return false
    }
    if (!runtime.pilot) {
      runtime.pilot = new CronScheduler({
        onRun: () => this.runAutoPilot(),
        tickMs: 15000,
      })
    }
    const ok = runtime.pilot.start(parsed.source)
    if (!ok) {
      this.setData({ pilotError: runtime.pilot.state().lastError || '调度器启动失败' })
      return false
    }
    const preset = CRON_PRESETS.find((item) => item.expression === parsed.source)
    this.setData({
      pilotEnabled: true,
      pilotExpression: parsed.source,
      pilotPreset: preset ? preset.key : 'custom',
      pilotError: '',
    })
    this.savePilotConfig(true, parsed.source)
    this.refreshPilotStatus()
    if (!silent) {
      this.showToast(`Auto-Pilot 已武装 · ${parsed.source}`, 'success')
    }
    this.pushCyberEvent('action', 'pilot', `armed ${parsed.source}`)
    return true
  },

  stopPilot(): void {
    const runtime = this as unknown as SettingsRuntime
    if (runtime.pilot) {
      runtime.pilot.stop()
    }
    this.setData({
      pilotEnabled: false,
      pilotRunning: false,
      pilotStatusText: '未启动',
      pilotNextText: '—',
      pilotProgress: 0,
    })
    this.savePilotConfig(false, this.data.pilotExpression)
  },

  refreshPilotStatus(): void {
    const runtime = this as unknown as SettingsRuntime
    const state = runtime.pilot ? runtime.pilot.state() : null
    this.setData({
      pilotStatusText: pilotStatusLabel(state),
      pilotNextText: state && state.nextRunAt ? formatClock(state.nextRunAt) : '—',
      pilotLastText:
        state && state.lastRunAt ? formatClock(state.lastRunAt) : this.data.pilotLastText,
      pilotRunCount: state ? state.runCount : this.data.pilotRunCount,
      pilotError: state ? state.lastError : this.data.pilotError,
      pilotRunning: (state && state.status === 'running') || runtime.pilotRunning,
    })
  },

  async runAutoPilot(): Promise<void> {
    const runtime = this as unknown as SettingsRuntime
    if (runtime.pilotRunning || runtime.cyberDestroyed) {
      return
    }
    runtime.pilotRunning = true
    runtime.pilotSeq += 1
    const seq = runtime.pilotSeq
    const alive = (): boolean => !runtime.cyberDestroyed && seq === runtime.pilotSeq
    this.setData({ pilotRunning: true, pilotProgress: 6, pilotError: '' })
    const advance = (progress: number, delay: number): Promise<void> =>
      new Promise((resolve) => {
        setTimeout(() => {
          if (alive()) {
            this.setData({ pilotProgress: progress })
          }
          resolve()
        }, delay)
      })

    try {
      await advance(18, 60)
      const frame =
        runtime.timeTravel?.capture('自动快照') ||
        runtime.timeTravel?.getFrames().slice(-1)[0]
      if (!frame) {
        throw new Error('无法生成本机快照')
      }
      const payload = encodeBackup(frame, '自动快照')
      await advance(46, 80)
      writeAutoSnapshot(payload, '自动快照')
      writeHotSlot(payload, '自动热备')
      await advance(78, 80)
      this.refreshSlots()
      this.refreshGalaxyNodes()
      if (!alive()) {
        return
      }
      this.setData({
        pilotProgress: 100,
        pilotLastText: formatClock(Date.now()),
      })
      this.pushCyberEvent('action', 'auto-pilot', `快照 ${payload.length} chars · FIFO 5`)
      this.captureFrame('自动备份完成')
      this.showToast('自动快照完成 · 最旧槽位已 FIFO 淘汰', 'success')
      await advance(0, 180)
    } catch (error) {
      const message = error instanceof Error ? error.message : '自动备份失败'
      if (alive()) {
        this.setData({ pilotError: message })
      }
      this.pushCyberEvent('error', 'auto-pilot', message)
      this.showToast(`自动备份失败：${message}`, 'error')
    } finally {
      runtime.pilotRunning = false
      if (!runtime.cyberDestroyed) {
        this.setData({ pilotRunning: false, pilotProgress: 0 })
        this.refreshPilotStatus()
      }
    }
  },

  /* ---- Time Travel ---- */
  captureFrame(label: string): void {
    const runtime = this as unknown as SettingsRuntime
    if (!runtime.timeTravel) {
      return
    }
    const frame = runtime.timeTravel.capture(label)
    if (frame) {
      this.refreshTimeline(runtime.timeTravel.size() - 1)
    }
  },

  refreshTimeline(activeIndex?: number): void {
    const runtime = this as unknown as SettingsRuntime
    const frames = runtime.timeTravel ? runtime.timeTravel.views(activeIndex) : []
    const max = Math.max(0, frames.length - 1)
    const target =
      typeof activeIndex === 'number' ? activeIndex : this.data.timelineIndex
    const index = frames.length ? Math.min(Math.max(0, target), max) : 0
    this.setData({
      timelineFrames: frames,
      timelineMax: max,
      timelineIndex: index,
    })
    if (frames.length > 0) {
      this.previewTimeline(index)
    } else {
      this.setData({
        timelinePreviewLabel: '尚未选择帧',
        timelinePreviewText: '左右滑动时间轴，预览任意一秒的完整状态。',
      })
    }
  },

  previewTimeline(index: number): void {
    const runtime = this as unknown as SettingsRuntime
    const frame = runtime.timeTravel ? runtime.timeTravel.preview(index) : null
    if (!frame) {
      return
    }
    const preference = frame.preference
    const preview = [
      `主题 ${frame.themeMode}`,
      `动画 ${preference.motion}`,
      `震感 ${preference.haptics}`,
      `音效${preference.sound ? '开' : '关'}`,
      `光效${preference.lightEffects ? '开' : '关'}`,
      `收藏 ${frame.toolbox.favorites.length}`,
      `最近 ${frame.toolbox.recents.length}`,
      `使用 ${frame.toolbox.usageCount}`,
      `轨迹 ${frame.history.length} 条`,
    ].join(' · ')
    this.setData({
      timelineIndex: index,
      timelinePreviewLabel: `${frame.label} · ${formatClock(frame.createdAt)}`,
      timelinePreviewText: preview,
    })
  },

  onTimelineSlide(
    event: WechatMiniprogram.CustomEvent<SettingsChangeDetail<number>>,
  ): void {
    const index = Number(event.detail && event.detail.value)
    if (Number.isFinite(index)) {
      this.previewTimeline(Math.floor(index))
    }
  },

  onTimelineTap(event: WechatMiniprogram.TouchEvent): void {
    const index = Number(event.currentTarget.dataset.index)
    if (Number.isFinite(index)) {
      tapTick()
      this.previewTimeline(Math.floor(index))
    }
  },

  onTimeTravel(): void {
    const runtime = this as unknown as SettingsRuntime
    if (!runtime.timeTravel || !this.lockAction('travel')) {
      return
    }
    this.setData({ travelBusy: true })
    const index = this.data.timelineIndex
    setTimeout(() => {
      if (runtime.cyberDestroyed || !runtime.timeTravel) {
        return
      }
      const result = runtime.timeTravel.travel(index)
      this.setData({ travelBusy: false })
      if (!result.ok) {
        tapWarn()
        this.showToast(result.message, 'error')
        return
      }
      this.refreshCache()
      this.refreshGalaxyNodes()
      this.refreshTimeline(index)
      this.captureFrame('穿越回滚')
      ambientTheme.refresh()
      tapSuccess()
      this.showToast(result.message, 'success')
      this.pushCyberEvent('action', 'time-travel', result.message)
    }, 60)
  },

  /* ---- Sliced Transport ---- */
  onTransportTextInput(event: WechatMiniprogram.TextareaInput): void {
    this.setData({ transportText: String(event.detail.value || '') })
  },

  onTransportGenerate(): void {
    if (!this.lockAction('transport')) {
      return
    }
    const text = this.data.transportText
    if (!text) {
      this.showToast('请先粘贴需要传输的备份码', 'warning')
      return
    }
    const runtime = this as unknown as SettingsRuntime
    const pkg = createTransfer(text, { chunkSize: 700 })
    if (!pkg) {
      this.setData({
        transportStatus: 'error',
        transportMessage: '文本为空或超过 64 片上限',
      })
      tapWarn()
      return
    }
    runtime.transferPackage = pkg
    runtime.transferState = null
    this.setData({
      transportTotal: pkg.total,
      transportIndex: 1,
      transportCurrent: pkg.parts[0] || '',
      transportProgress: `1 / ${pkg.total}`,
      transportSignature: pkg.signature,
      transportStatus: 'ready',
      transportMessage: `已切分为 ${pkg.total} 片 · 逐片复制给对方`,
      transportResult: '',
    })
    this.pushCyberEvent('action', 'transport', `split ${pkg.total} parts`)
    this.showToast(`已切分 ${pkg.total} 片`, 'success')
  },

  setTransportPart(index: number): void {
    const runtime = this as unknown as SettingsRuntime
    const pkg = runtime.transferPackage
    if (!pkg) {
      return
    }
    const safe = Math.min(Math.max(1, Math.floor(index)), pkg.total)
    this.setData({
      transportIndex: safe,
      transportCurrent: pkg.parts[safe - 1] || '',
      transportProgress: `${safe} / ${pkg.total}`,
    })
  },

  onTransportPrev(): void {
    if (this.data.transportIndex <= 1) {
      return
    }
    tapTick()
    this.setTransportPart(this.data.transportIndex - 1)
  },

  onTransportNext(): void {
    if (this.data.transportIndex >= this.data.transportTotal) {
      return
    }
    tapTick()
    this.setTransportPart(this.data.transportIndex + 1)
  },

  onTransportCopy(): void {
    if (!this.lockAction('transport-copy') || !this.data.transportCurrent) {
      return
    }
    const index = this.data.transportIndex
    const total = this.data.transportTotal
    wx.setClipboardData({
      data: this.data.transportCurrent,
      success: () => {
        this.showToast(`第 ${index}/${total} 片已复制`, 'success')
        this.pushCyberEvent('action', 'transport', `copy ${index}/${total}`)
        if (index < total) {
          setTimeout(() => {
            if (!this.data.transportBusy && !(this as unknown as SettingsRuntime).cyberDestroyed) {
              this.setTransportPart(index + 1)
            }
          }, 260)
        }
      },
      fail: () => {
        this.showToast('复制失败，请手动长按选择', 'error')
      },
    })
  },

  onTransportInput(event: WechatMiniprogram.TextareaInput): void {
    this.setData({ transportInput: String(event.detail.value || '') })
  },

  onTransportAppend(): void {
    if (!this.lockAction('transport-append')) {
      return
    }
    const text = this.data.transportInput.trim()
    if (!text) {
      this.showToast('请先粘贴一个分片', 'warning')
      return
    }
    const runtime = this as unknown as SettingsRuntime
    const appended = appendTransferPart(runtime.transferState || null, text)
    runtime.transferState = appended.state
    const result = appended.result
    const missingText = result.missing.length
      ? ` · 缺少 ${result.missing.join(',')}`
      : ''
    this.setData({
      transportStatus: result.status,
      transportMessage: `${result.message}${missingText}`,
      transportProgress: `${result.received} / ${result.total || this.data.transportTotal}`,
      transportInput: result.status === 'error' ? this.data.transportInput : '',
      transportResult: result.status === 'complete' ? result.payload : '',
      vaultText:
        result.status === 'complete' && isVaultText(result.payload)
          ? result.payload
          : this.data.vaultText,
    })
    if (result.status === 'complete') {
      tapSuccess()
      this.showToast('全部分片已验签并重组', 'success')
      this.pushCyberEvent('action', 'transport', `reassembled ${result.payload.length} chars`)
    } else if (result.status === 'error') {
      tapWarn()
      this.showToast(result.message, 'error')
    } else {
      this.showToast(result.message, 'info')
    }
  },

  onTransportPaste(): void {
    wx.getClipboardData({
      success: (res) => {
        const text = String((res && res.data) || '').trim()
        if (!text) {
          this.showToast('剪贴板为空', 'warning')
          return
        }
        this.setData({ transportInput: text })
        this.onTransportAppend()
      },
      fail: () => {
        this.showToast('读取剪贴板失败', 'error')
      },
    })
  },

  onTransportReset(): void {
    const runtime = this as unknown as SettingsRuntime
    runtime.transferPackage = undefined
    runtime.transferState = null
    this.setData({
      transportTotal: 0,
      transportIndex: 0,
      transportCurrent: '',
      transportProgress: '0 / 0',
      transportSignature: '',
      transportInput: '',
      transportStatus: 'idle',
      transportMessage: '等待生成分片',
      transportResult: '',
    })
    tapTick()
  },

  /* ---- Vault / Disaster Recovery ---- */
  onVaultPassInput(event: WechatMiniprogram.Input): void {
    this.setData({ vaultPass: String(event.detail.value || '') })
  },

  onVaultTextInput(event: WechatMiniprogram.TextareaInput): void {
    this.setData({ vaultText: String(event.detail.value || '') })
  },

  onVaultExport(): void {
    if (!this.lockAction('vault-export')) {
      return
    }
    const error = validatePassphrase(this.data.vaultPass)
    if (error) {
      this.showToast(error, 'warning')
      return
    }
    const runtime = this as unknown as SettingsRuntime
    const frame =
      runtime.timeTravel?.capture('冷备导出') || runtime.timeTravel?.getFrames().slice(-1)[0]
    if (!frame) {
      this.showToast('没有可导出的本机快照', 'error')
      return
    }
    const plain = encodeBackup(frame, '冷备导出')
    this.setData({ vaultBusy: true })

    const finish = (ivHex: string): void => {
      if (runtime.cyberDestroyed) {
        return
      }
      const cipher = encryptVault(plain, this.data.vaultPass, ivHex)
      if (!cipher) {
        this.setData({ vaultBusy: false })
        this.showToast('AES 加密失败，请检查口令', 'error')
        return
      }
      const fs = wx.getFileSystemManager()
      const filePath = `${wx.env.USER_DATA_PATH}/chaohuan-cyber-${Date.now()}.txt`
      try {
        this.removeVaultFile(runtime.vaultFile)
        fs.writeFile({
          filePath,
          data: cipher,
          encoding: 'utf8',
          success: () => {
            runtime.vaultFile = filePath
            runtime.vaultShared = false
            this.setData({
              vaultFile: filePath,
              vaultText: cipher,
              vaultMessage: `已生成 AES-256-CBC 冷备 · ${formatBytesText(cipher.length)} · 备份码已填入下方，可直接复制`,
              vaultBusy: false,
            })
            this.pushCyberEvent('action', 'vault', `encrypted ${cipher.length} chars`)
            this.showToast('加密备份已写入本机 TXT', 'success')
            this.onVaultShareFile()
          },
          fail: (failure) => {
            this.setData({ vaultBusy: false })
            this.showToast(`文件写入失败：${failure.errMsg || '未知错误'}`, 'error')
          },
        })
      } catch (failure) {
        this.setData({ vaultBusy: false })
        this.showToast('当前环境不支持文件系统', 'error')
      }
    }

    if (typeof wx.getRandomValues === 'function') {
      wx.getRandomValues({
        length: 16,
        success: (result) => {
          finish(bytesToHex(new Uint8Array(result.randomValues)))
        },
        fail: () => {
          finish(fallbackIvHex())
        },
      })
      return
    }
    finish(fallbackIvHex())
  },

  onVaultShareFile(): void {
    const runtime = this as unknown as SettingsRuntime
    if (!this.lockAction('vault-share') || !runtime.vaultFile) {
      this.showToast('请先生成加密备份文件', 'warning')
      return
    }
    const share = (wx as unknown as {
      shareFileMessage?: (options: {
        filePath: string
        fileName?: string
        success?: () => void
        fail?: (error: { errMsg?: string }) => void
      }) => void
    }).shareFileMessage
    if (typeof share !== 'function') {
      this.showToast('当前版本不支持文件分享，请从文件系统取出 TXT', 'warning')
      return
    }
    share({
      filePath: runtime.vaultFile,
      fileName: 'chaohuan-cyber-backup.txt',
      success: () => {
        runtime.vaultShared = true
        this.showToast('已调起分享，请选择「文件传输助手」', 'success')
        this.pushCyberEvent('action', 'vault', 'shareFileMessage')
      },
      fail: (failure) => {
        if (failure && String(failure.errMsg || '').includes('cancel')) {
          return
        }
        this.showToast('分享被取消或失败，可稍后重试', 'warning')
      },
    })
  },

  onVaultCopy(): void {
    if (!this.lockAction('vault-copy')) {
      return
    }
    const text = this.data.vaultText
    if (!text) {
      this.showToast('还没有备份码，请先加密导出或粘贴', 'warning')
      return
    }
    wx.setClipboardData({
      data: text,
      success: () => {
        this.showToast('AES 备份码已复制', 'success')
        this.pushCyberEvent('action', 'vault', `copy ${text.length} chars`)
      },
      fail: () => {
        this.showToast('复制失败，请长按文本框手动选择', 'error')
      },
    })
  },

  onVaultRestore(): void {
    if (!this.lockAction('vault-restore')) {
      return
    }
    const error = validatePassphrase(this.data.vaultPass)
    if (error) {
      this.showToast(error, 'warning')
      return
    }
    const plain = decryptVault(this.data.vaultText, this.data.vaultPass)
    if (!plain) {
      this.showToast('解密失败：口令错误或密文损坏', 'error')
      tapWarn()
      return
    }
    const restored = restoreBackupPayload(plain)
    if (!restored.ok) {
      this.showToast(restored.message, 'error')
      tapWarn()
      return
    }
    this.refreshAfterRestore()
    this.refreshTimeline()
    this.captureFrame('冷备还原')
    this.showToast('冷备已验签并静默还原', 'success')
    this.pushCyberEvent('action', 'vault', 'restore ok')
  },

  onWriteHotSlot(): void {
    if (!this.lockAction('hot-slot')) {
      return
    }
    const runtime = this as unknown as SettingsRuntime
    const frame =
      runtime.timeTravel?.capture('手动热备') || runtime.timeTravel?.getFrames().slice(-1)[0]
    if (!frame) {
      this.showToast('没有可热备的状态', 'error')
      return
    }
    const payload = encodeBackup(frame, '手动热备')
    writeHotSlot(payload, '手动热备')
    this.refreshSlots()
    this.refreshGalaxyNodes()
    this.showToast('已写入热备槽 · 3 槽轮转', 'success')
    this.pushCyberEvent('action', 'vault', 'hot slot written')
  },

  onRestoreSlot(event: WechatMiniprogram.TouchEvent): void {
    if (!this.lockAction('slot-restore')) {
      return
    }
    const id = String(event.currentTarget.dataset.id || '')
    const kind = String(event.currentTarget.dataset.kind || '')
    const slots = kind === 'auto' ? this.data.autoSlots : this.data.hotSlots
    const slot = slots.find((item) => item.id === id)
    if (!slot) {
      this.showToast('快照槽位不存在', 'warning')
      return
    }
    const result = restoreBackupPayload(slot.payload)
    if (!result.ok) {
      this.showToast(result.message, 'error')
      tapWarn()
      return
    }
    this.refreshAfterRestore()
    this.refreshTimeline()
    this.captureFrame('槽位还原')
    this.showToast(`已还原「${slot.label}」`, 'success')
    this.pushCyberEvent('action', 'vault', `restore slot ${slot.id}`)
  },

  refreshSlots(): void {
    this.setData({
      hotSlots: slotViews(readHotSlots()),
      autoSlots: slotViews(readAutoSnapshots()),
    })
  },

  refreshGalaxyNodes(): void {
    const runtime = this as unknown as SettingsRuntime
    if (runtime.galaxy) {
      this.fillGalaxyNodes(runtime.galaxy)
      return
    }
    const nodes = buildGalaxyNodes({
      favorites: toolboxStore.favorites,
      history: historyStore.records,
      preferenceCount: Object.keys(preferenceStore.snapshot().flags).length + 4,
      snapshotCount: readAutoSnapshots().length,
    })
    this.setData({
      galaxyNodeCount: nodes.length,
      galaxyFallbackNodes: nodes.map((node) => ({
        id: node.id,
        label: node.label,
        kind: node.kind,
        value: node.value || '',
        color: KIND_COLORS[node.kind] || KIND_COLORS.snapshot,
      })),
    })
  },

  runDisasterCheck(): void {
    const runtime = this as unknown as SettingsRuntime
    if (runtime.disasterChecked) {
      return
    }
    runtime.disasterChecked = true
    const healthy =
      Array.isArray(toolboxStore.favorites) &&
      Array.isArray(toolboxStore.recents) &&
      Array.isArray(historyStore.records) &&
      Boolean(preferenceStore.snapshot().version)
    if (healthy) {
      this.pushCyberEvent('lifecycle', 'store-health', 'OK')
      return
    }
    const hot = readHotSlots()[0]
    if (!hot) {
      this.pushCyberEvent('error', 'store-health', '结构损坏且无热备')
      this.showToast('检测到本机状态损坏，且没有可用热备', 'warning')
      return
    }
    const result = restoreBackupPayload(hot.payload)
    if (result.ok) {
      this.refreshAfterRestore()
      this.refreshTimeline()
      this.pushCyberEvent('error', 'store-health', `已从热备自愈 · ${hot.label}`)
      this.showToast('Store 结构损坏，已从最新热备静默还原', 'success')
    } else {
      this.pushCyberEvent('error', 'store-health', result.message)
      this.showToast(`自愈失败：${result.message}`, 'error')
    }
  },

  removeVaultFile(filePath: string): void {
    if (!filePath) {
      return
    }
    try {
      wx.getFileSystemManager().unlink({ filePath, fail: () => undefined })
    } catch {
      /* 旧文件清理失败不影响新备份 */
    }
  },

  /* ---- 感官 ---- */
  onSoundChange(event: WechatMiniprogram.CustomEvent<SettingsChangeDetail<boolean>>): void {
    const value = Boolean(event.detail && event.detail.value)
    const persisted = useSound().setEnabled(value)
    this.setData({ sound: value })
    if (value) {
      tapSuccess()
    } else {
      tapTick()
    }
    this.showToast(
      persisted ? (value ? '音效已开启' : '音效已静音') : '偏好仅在本次会话生效',
      persisted ? 'success' : 'warning',
    )
    this.captureFrame('音效切换')
  },

  onHapticsTap(): void {
    const runtime = this as unknown as SettingsRuntime
    runtime.pickerKind = 'haptics'
    tapTick()
    this.setData({
      pickerShow: true,
      pickerTitle: '物理震动',
      pickerDesc: '选择全局震感档位；音效开关独立生效。',
      /* 选项数据源：进入抽屉时按当前 Store 值算好高亮 */
      pickerOptions: buildPickerOptions(HAPTIC_OPTIONS, preferenceStore.haptics),
    })
  },

  /* ---- 视觉与性能 ---- */
  onLightEffectsChange(event: WechatMiniprogram.CustomEvent<SettingsChangeDetail<boolean>>): void {
    const value = Boolean(event.detail && event.detail.value)
    const persisted = preferenceStore.setLightEffects(value)
    this.setData({ lightEffects: value })
    tapTick()
    /* 当前页与常驻页面共用同一引擎，refresh 会同步已订阅页面 */
    ambientTheme.refresh()
    this.showToast(
      persisted
        ? value
          ? preferenceStore.motion === 'saver'
            ? '已记录偏好 · 省电模式下光效仍保持关闭'
            : '动态光效已开启'
          : '动态光效已关闭，模糊采样同步降低'
        : '偏好仅在本次会话生效',
      persisted ? 'success' : 'warning',
    )
    this.captureFrame('光效切换')
  },

  onMotionInput(event: WechatMiniprogram.CustomEvent<SettingsChangeDetail<number>>): void {
    const index = Number(event.detail && event.detail.value)
    if (!Number.isFinite(index)) {
      return
    }
    /* 拖动中只更新文案，不写 Storage、不触发全局重绘 */
    this.setData({ motionPreview: resolveMotionLabel(index) })
  },

  onMotionChange(event: WechatMiniprogram.CustomEvent<SettingsChangeDetail<number>>): void {
    const index = Number(event.detail && event.detail.value)
    if (!Number.isFinite(index)) {
      return
    }
    const label = resolveMotionLabel(index)
    const persisted = preferenceStore.setMotionIndex(index)
    this.setData({ motionPreview: label })
    tapTick()
    ambientTheme.refresh()
    this.syncGalaxyDegrade()
    this.showToast(
      persisted ? `动画强度已切换为${label}` : '偏好仅在本次会话生效',
      persisted ? 'success' : 'warning',
    )
    this.captureFrame('动画强度切换')
  },

  /* ---- 存储 ---- */
  onCleanTap(): void {
    const runtime = this as unknown as SettingsRuntime
    runtime.pickerKind = 'clean'
    tapTick()
    this.setData({
      pickerShow: true,
      pickerTitle: '自动清理最近使用',
      pickerDesc: '只清理超过阈值的最近打开记录，不影响收藏与设置。',
      /* 选项数据源：进入抽屉时按当前 Store 值算好高亮 */
      pickerOptions: buildPickerOptions(CLEAN_OPTIONS, preferenceStore.autoCleanValue),
    })
  },

  /* 这里是点击选中后的状态更新与关闭抽屉逻辑 */
  onPickerOptionTap(event: WechatMiniprogram.TouchEvent): void {
    const runtime = this as unknown as SettingsRuntime
    const value =
      event.currentTarget && event.currentTarget.dataset
        ? String(event.currentTarget.dataset.value ?? '')
        : ''
    if (!value || !runtime.pickerKind) {
      return
    }

    /* 只接受当前抽屉数据源内的值，防止脏 dataset 改变 Store */
    const source = runtime.pickerKind === 'haptics' ? HAPTIC_OPTIONS : CLEAN_OPTIONS
    if (!source.some((option) => option.value === value)) {
      return
    }

    if (runtime.pickerKind === 'haptics') {
      const level = value as HapticLevel
      const persisted = preferenceStore.setHaptics(level)
      /* 先把抽屉选项高亮刷新，再触发关闭动画；主页面文案由 MobX 同步更新 */
      this.setData({
        pickerOptions: buildPickerOptions(HAPTIC_OPTIONS, level),
        pickerShow: false,
      })
      runtime.pickerKind = ''
      tapTick()
      this.showToast(
        persisted ? `震感已调整为${preferenceStore.hapticsLabel}` : '偏好仅在本次会话生效',
        persisted ? 'success' : 'warning',
      )
      this.captureFrame('震感切换')
      return
    }

    if (runtime.pickerKind === 'clean') {
      const days = Number(value)
      if (days !== 0 && days !== 7 && days !== 30) {
        return
      }
      const persisted = preferenceStore.setAutoCleanDays(days as AutoCleanDays)
      const removed = applyAutoClean()
      this.refreshCache()
      this.setData({
        pickerOptions: buildPickerOptions(CLEAN_OPTIONS, String(days)),
        pickerShow: false,
      })
      runtime.pickerKind = ''
      const suffix = removed > 0 ? `，已清理 ${removed} 条过期记录` : ''
      this.showToast(
        persisted
          ? `自动清理已设为${preferenceStore.autoCleanLabel}${suffix}`
          : '偏好仅在本次会话生效',
        persisted ? 'success' : 'warning',
      )
      this.captureFrame('清理阈值切换')
    }
  },

  onPickerClose(): void {
    const runtime = this as unknown as SettingsRuntime
    runtime.pickerKind = ''
    this.setData({ pickerShow: false })
  },

  onClearRecentsTap(): void {
    tapTick()
    this.setData({ confirmShow: true })
  },

  onConfirmCancel(): void {
    tapTick()
    this.setData({ confirmShow: false })
  },

  onConfirmSheetClose(): void {
    this.setData({ confirmShow: false })
  },

  onConfirmClear(): void {
    const ok = toolboxStore.clearRecents()
    this.setData({ confirmShow: false })
    this.refreshCache()
    if (ok) {
      tapSuccess()
      this.showToast('最近使用已清空', 'success')
      this.captureFrame('清空最近使用')
    } else {
      this.showToast('清空失败，请稍后重试', 'error')
    }
  },

  /* ---- 实验室 ---- */
  onAiFlagChange(event: WechatMiniprogram.CustomEvent<SettingsChangeDetail<boolean>>): void {
    const value = Boolean(event.detail && event.detail.value)
    const persisted = preferenceStore.setFlag('enable_ai_assist', value)
    this.setData({ flagAi: value })
    tapTick()
    this.showToast(
      persisted
        ? value
          ? '实验席位已预留 · 功能上线后自动生效'
          : '已退出实验席位'
        : '偏好仅在本次会话生效',
      persisted ? (value ? 'success' : 'info') : 'warning',
    )
    this.captureFrame('实验开关切换')
  },

  /* ---- 更新日志 ---- */
  onToggleChangelog(): void {
    tapTick()
    this.setData({ changelogOpen: !this.data.changelogOpen })
  },

  /* ---- 顶部 3D 视差：滚动驱动，50ms 节流，不抢手势 ---- */
  onScroll(event: WechatMiniprogram.ScrollViewScroll): void {
    const runtime = this as unknown as SettingsRuntime
    const now = Date.now()
    if (now - runtime.lastScrollAt < 50) {
      return
    }
    runtime.lastScrollAt = now

    const scrollTop =
      event.detail && typeof event.detail.scrollTop === 'number' ? event.detail.scrollTop : 0
    const depth = Math.min(Math.max(scrollTop, 0), 180)
    const rotateX = Math.min(depth * 0.045, 7)
    const scale = 1 - Math.min(depth / 2400, 0.04)
    this.setData({
      heroStyle: `transform: perspective(1000rpx) translate3d(0, ${(-depth * 0.22).toFixed(
        2,
      )}px, 0) rotateX(${rotateX.toFixed(2)}deg) scale(${scale.toFixed(3)});`,
    })
  },

  refreshCache(): void {
    const summary = readCacheSummary()
    this.setData({ cacheText: summary.text, cacheDetail: summary.detail })
  },

  /** 首页选择“稍后”后写入的标记：设置页只读，不在本地猜测更新状态 */
  refreshPendingUpdate(): void {
    const pending = readUpdatePending()
    if (pending !== this.data.hasPendingUpdate) {
      this.setData({ hasPendingUpdate: pending })
    }
  },

  /** Store 被时间旅行 / 冷备 / 热备写回后的统一刷新入口 */
  refreshAfterRestore(): void {
    this.refreshCache()
    this.refreshGalaxyNodes()
    this.refreshSlots()
    ambientTheme.refresh()
    this.startGalaxyLoop()
    this.setData({
      sound: preferenceStore.sound,
      lightEffects: preferenceStore.lightEffects,
      hapticsLabel: preferenceStore.hapticsLabel,
      motionIndex: preferenceStore.motionIndex,
      motionLabel: preferenceStore.motionLabel,
      motionPreview: preferenceStore.motionLabel,
      autoCleanLabel: preferenceStore.autoCleanLabel,
      statusText: preferenceStore.statusText,
      flagAi: preferenceStore.flags.enable_ai_assist,
      recentCount: toolboxStore.recents.length,
    })
  },

  showToast(message: string, type: SettingsToastType = 'info'): void {
    showGlassToast({
      message,
      type,
      placement: 'lower-center',
      tapToDismiss: true,
    })
  },
})
