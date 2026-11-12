/* ==========================================================================
   subpackages/tools-core/pages/weather · 全息气象站
   - 严格消费高德标准天气字段：实况 8 项 + 4 天预报 10 项
   - 模糊定位 → 逆地理 → IP → 手动搜索；失败绝不伪造数据
   - 双 Canvas：全屏天气粒子 + 静态预报图表；全部在分包内
   - onHide 中止请求 / 停动画 / 挂起音频；onUnload 彻底释放
   ========================================================================== */
import { createStoreBindings } from 'mobx-miniprogram-bindings'
import { reaction } from 'mobx-miniprogram'
import { uiStore } from '../../../../core/stores/ui'
import { preferenceStore } from '../../../../core/stores/preference'
import { ROUTES } from '../../../../core/constants/index'
import { logger } from '../../../../core/utils/logger'
import { isDevtools } from '../../../../core/utils/platform'
import { tapSuccess, tapTick, tapWarn } from '../../../../core/utils/haptics'
import { showGlassToast } from '../../../../components/glass-toast/toast'
import { sharePayloadForTool, timelinePayloadForCurrentPage } from '../../../../core/toolbox/share'
import {
  WeatherError,
  WeatherService,
  type WeatherRequest,
} from '../../weather/weatherService'
import {
  MAX_CITIES,
  MANUAL_REFRESH_CD_MS,
  createWxWeatherStorage,
  findCity,
  hasRecentFailure,
  readCities,
  readCurrentAdcode,
  readForecastCache,
  readLabEnabled,
  readLiveCache,
  readManualRefreshAt,
  removeCityCache,
  writeCities,
  writeCurrentAdcode,
  writeForecastCache,
  writeLabEnabled,
  writeLiveCache,
  writeManualRefreshAt,
  writeNegativeCache,
  type WeatherStorage,
} from '../../weather/weatherCache'
import {
  buildWeatherSummary,
  formatReportTime,
  formatReportTimeAria,
  formatTemperature,
  isNightHour,
} from '../../weather/weatherParse'
import {
  ambientSceneFor,
  resolveWeather,
} from '../../weather/weatherCode'
import {
  WeatherRequestLog,
  buildDiagnosticText,
  describeInfoCode,
  formatAge,
} from '../../weather/weatherDiagnostics'
import {
  drawForecastChart,
  drawHourlyChart,
  forecastAriaText,
  type ChartContext,
} from '../../weather/weatherChart'
import {
  WeatherFxEngine,
  type FxCanvasNode,
} from '../../weather/weatherFx'
import {
  WeatherAmbientAudio,
  isWeatherAudioSupported,
} from '../../weather/weatherAudio'
import {
  buildHourlyForecast,
  hourlyAriaText,
} from '../../weather/weatherHourly'
import { computeSunTimes } from '../../weather/weatherAstro'
import {
  candidateToCity,
  locateByIp,
  locateCity,
  readFuzzyLocationPermission,
  type LocationFailureReason,
} from '../../weather/weatherLocation'
import type {
  AmbientScene,
  CityCandidate,
  ForecastDayView,
  ForecastWeather,
  HourlyPoint,
  LiveWeather,
  RequestLogEntry,
  SavedCity,
  SunKind,
  WeatherFamily,
} from '../../weather/types'

type ToastType = 'info' | 'success' | 'warning' | 'error' | 'loading'

interface StoreBindingsLike {
  destroyStoreBindings: () => void
}

interface CanvasNodeLike {
  width: number
  height: number
  getContext: (type: '2d') => unknown
}

interface CanvasQueryEntry {
  node?: CanvasNodeLike
  width?: number
  height?: number
}

interface ChartCanvasNode extends CanvasNodeLike {
  getContext: (type: '2d') => ChartContext | null
}

interface WeatherPageRuntime {
  destroyed: boolean
  visible: boolean
  booted: boolean
  booting: boolean
  locating: boolean
  /** 首启自动弹出的定位引导：取消时需回退到 IP 定位 */
  locationPromptAuto: boolean

  service: WeatherService | null
  storage: WeatherStorage | null
  log: WeatherRequestLog
  fx: WeatherFxEngine
  audio: WeatherAmbientAudio
  themeBindings: StoreBindingsLike | null
  reactions: Array<() => void>

  currentCity: SavedCity | null
  liveMeta: { fetchedAt: number; stale: boolean; reporttime: string } | null
  forecastMeta: { fetchedAt: number; stale: boolean; reporttime: string } | null

  liveTask: WeatherRequest<LiveWeather> | null
  forecastTask: WeatherRequest<ForecastWeather> | null
  searchTask: WeatherRequest<CityCandidate[]> | null
  liveSeq: number
  forecastSeq: number
  searchSeq: number

  fxReady: boolean
  fxUnsupported: boolean
  chartReady: boolean
  chartUnsupported: boolean
  hourlyReady: boolean
  hourlyUnsupported: boolean
  chartNode: ChartCanvasNode | null
  chartCtx: ChartContext | null
  hourlyNode: ChartCanvasNode | null
  hourlyCtx: ChartContext | null
  chartWidth: number
  chartHeight: number
  hourlyWidth: number
  hourlyHeight: number
  chartDpr: number
  hourlyDpr: number
  canvasTimers: number[]

  searchDebounce: number
  hiddenAt: number
  lastManualRefreshAt: number

  tapCount: number
  tapLastAt: number
  tapResetTimer: number
  doubleTapTimer: number

  touchStartX: number
  touchStartY: number
  touchLastX: number
  touchLastY: number
  touchOnStrip: boolean

  networkHandler: ((result: { isConnected: boolean; networkType: string }) => void) | null
  audioBeginHandler: (() => void) | null
  audioEndHandler: (() => void) | null
  windowResizeHandler: (() => void) | null
}

interface HourlyPointView extends HourlyPoint {
  tempText: string
}

const DEFAULT_CITY_NAME = '定位中…'

function safeNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function pixelRatio(): number {
  try {
    const info = wx.getWindowInfo()
    const value = info && typeof info.pixelRatio === 'number' ? info.pixelRatio : 2
    return Math.min(Math.max(1, value), 2)
  } catch {
    return 2
  }
}

function eventDataset(event: unknown): Record<string, unknown> {
  if (!event || typeof event !== 'object') {
    return {}
  }
  const currentTarget = (event as { currentTarget?: unknown }).currentTarget
  if (!currentTarget || typeof currentTarget !== 'object') {
    return {}
  }
  const dataset = (currentTarget as { dataset?: unknown }).dataset
  return dataset && typeof dataset === 'object'
    ? (dataset as Record<string, unknown>)
    : {}
}

function eventInputValue(event: unknown): string {
  if (!event || typeof event !== 'object') {
    return ''
  }
  const detail = (event as { detail?: unknown }).detail
  if (!detail || typeof detail !== 'object') {
    return ''
  }
  const value = (detail as { value?: unknown }).value
  return typeof value === 'string' ? value : ''
}

function firstTouch(event: unknown): { x: number; y: number } | null {
  if (!event || typeof event !== 'object') {
    return null
  }
  const object = event as Record<string, unknown>
  const candidates = [object.changedTouches, object.touches]
  for (const candidate of candidates) {
    if (!Array.isArray(candidate) || candidate.length === 0) {
      continue
    }
    const touch = candidate[0]
    if (!touch || typeof touch !== 'object') {
      continue
    }
    const item = touch as Record<string, unknown>
    const x = safeNumber(item.pageX, safeNumber(item.clientX, NaN))
    const y = safeNumber(item.pageY, safeNumber(item.clientY, NaN))
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return { x, y }
    }
  }
  return null
}

function sourceLabel(source: SavedCity['source']): string {
  if (source === 'fuzzy') {
    return '模糊定位'
  }
  if (source === 'ip') {
    return 'IP 定位'
  }
  return '手动选择'
}

function clockMinutes(text: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(text)
  if (!match) {
    return null
  }
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) {
    return null
  }
  return hour * 60 + minute
}

function describeWeatherFailure(error: unknown): {
  message: string
  hint: string
  infocode: string
} {
  if (error instanceof WeatherError) {
    const info = describeInfoCode(error.infocode)
    if (error.kind === 'config') {
      return {
        message: '未配置高德 Web服务 Key',
        hint: '请在 subpackages/tools-core/weather/config.local.ts 填入 Web服务 Key',
        infocode: error.infocode,
      }
    }
    if (error.kind === 'timeout') {
      return {
        message: '天气请求超时',
        hint: '检查网络后点击重试；已展示的缓存数据仍可查看',
        infocode: error.infocode,
      }
    }
    if (error.kind === 'network') {
      return {
        message: '网络不可用，天气暂未更新',
        hint: error.statusCode ? `HTTP ${error.statusCode}` : '请检查网络连接后重试',
        infocode: error.infocode,
      }
    }
    if (error.kind === 'parse') {
      return {
        message: '天气数据格式异常',
        hint: '高德返回字段不完整，请稍后重试',
        infocode: error.infocode,
      }
    }
    if (error.kind === 'aborted') {
      return { message: '请求已取消', hint: '', infocode: '' }
    }
    if (error.infocode === '10009') {
      return {
        message: 'Key 平台不符，无法请求天气',
        hint: '请在高德控制台创建「Web服务」Key；微信小程序 / JS API Key 不能直连 REST',
        infocode: error.infocode,
      }
    }
    if (error.infocode === '10001') {
      return {
        message: '高德 Key 不正确或已过期',
        hint: '请检查 Web服务 Key 是否有效',
        infocode: error.infocode,
      }
    }
    if (error.infocode === '10003') {
      return {
        message: '今日天气额度已用完',
        hint: '次日 0:00 自动恢复；缓存数据仍可查看',
        infocode: error.infocode,
      }
    }
    if (error.infocode === '10004') {
      return {
        message: '请求过于频繁',
        hint: '请稍后再试，避免连续刷新',
        infocode: error.infocode,
      }
    }
    const hintParts = [info.label, info.advice].filter(Boolean)
    return {
      message: '天气服务返回错误',
      hint: error.infocode
        ? `错误码 ${error.infocode} · ${hintParts.join(' · ')}`
        : hintParts.join(' · ') || error.message,
      infocode: error.infocode,
    }
  }
  return {
    message: '天气服务暂时不可用',
    hint: '请稍后重试',
    infocode: '',
  }
}

Page({
  data: {
    themeClass: '',
    themeTone: 'dark' as 'dark' | 'light',
    lowMemory: false,
    ready: false,
    loading: false,
    refreshing: false,
    hasResult: false,
    weatherSummary: '',

    /* 胶囊安全区：onLoad / onShow / resize 时测量，禁止写死 padding */
    navTopPx: 52,
    navRowHeightPx: 44,
    navRightInsetPx: 112,

    cityName: DEFAULT_CITY_NAME,
    province: '',
    adcode: '',
    citySourceLabel: '',
    reporttimeText: '—',
    reporttimeAria: '数据发布时间未知',
    stale: false,
    cacheAgeText: '',
    offline: false,

    weatherName: '—',
    weatherFamily: 'unknown' as WeatherFamily,
    temperatureText: '—',
    temperatureUnit: '',
    winddirection: '—',
    windpower: '—',
    humidityText: '—',
    humidityUnit: '',
    adcodeText: '—',
    isNight: false,

    forecastTitle: '未来天气',
    forecastDays: [] as ForecastDayView[],
    forecastEmpty: true,
    forecastReport: '—',
    chartAria: '暂无预报数据',
    chartCanvasMounted: false,
    chartReady: false,
    chartPxW: 0,
    chartPxH: 0,

    hourlyPoints: [] as HourlyPointView[],
    hourlyAria: '暂无可推算的 24 小时温度',
    hourlyCanvasMounted: false,
    hourlyReady: false,
    hourlyPxW: 0,
    hourlyPxH: 0,

    sunKind: 'normal' as SunKind,
    sunrise: '—',
    sunset: '—',
    sunNote: '依据经纬度本地计算 · 仅供参考',

    aqiText: '标准天气 API 不含该数据 · 高级能力需商务授权',
    alertText: '预警数据未接入，请以官方发布为准',
    labEnabled: false,
    minutelyVisible: false,
    minutelyText: '高级能力需商务咨询',

    cities: [] as SavedCity[],
    currentIndex: 0,
    cityCountText: '0/5',
    citySheetOpen: false,
    locationPermissionText: '未申请 · 点击后按引导开启',
    locationActionText: '去开启',
    locationAttention: true,
    locationPromptShow: false,
    locationPromptMode: '' as
      | ''
      | 'request'
      | 'privacy'
      | 'denied'
      | 'unavailable'
      | 'failed',
    locationPromptTitle: '',
    locationPromptDesc: '',
    locationPromptConfirmText: '允许并定位',
    locationPromptCancelText: '暂不开启',
    locationPromptExtraText: '',
    locationPromptShowCancel: true,
    searchOpen: false,
    searchFocus: false,
    searchKeyword: '',
    searchLoading: false,
    searchResults: [] as CityCandidate[],
    searchEmpty: false,
    searchError: '',

    ambientEnabled: false,
    ambientAvailable: false,
    ambientScene: '' as '' | 'rain' | 'wind',
    ambientSceneLabel: '当前天气无匹配环境音',
    ambientHint: '雨声 / 风声 · 默认关闭',

    diagnosticsOpen: false,
    diagnosticsText: '',
    diagnosticsLogs: [] as RequestLogEntry[],
    diagnosticsKey: '未配置',

    errorText: '',
    errorHint: '',
    showRetry: false,
    workflowPanelVisible: false,

    fxCanvasMounted: false,
    fxPxW: 0,
    fxPxH: 0,
  },

  onLoad(): void {
    const runtime = this as unknown as WeatherPageRuntime
    runtime.destroyed = false
    runtime.visible = true
    runtime.booted = false
    runtime.booting = false
    runtime.locating = false
    runtime.locationPromptAuto = false
    runtime.service = new WeatherService()
    const storage = createWxWeatherStorage()
    runtime.storage = storage
    runtime.log = new WeatherRequestLog()
    runtime.fx = new WeatherFxEngine()
    runtime.audio = new WeatherAmbientAudio()
    runtime.themeBindings = null
    runtime.reactions = []
    runtime.currentCity = null
    runtime.liveMeta = null
    runtime.forecastMeta = null
    runtime.liveTask = null
    runtime.forecastTask = null
    runtime.searchTask = null
    runtime.liveSeq = 0
    runtime.forecastSeq = 0
    runtime.searchSeq = 0
    runtime.fxReady = false
    runtime.fxUnsupported = false
    runtime.chartReady = false
    runtime.chartUnsupported = false
    runtime.hourlyReady = false
    runtime.hourlyUnsupported = false
    runtime.chartNode = null
    runtime.chartCtx = null
    runtime.hourlyNode = null
    runtime.hourlyCtx = null
    runtime.chartWidth = 0
    runtime.chartHeight = 0
    runtime.hourlyWidth = 0
    runtime.hourlyHeight = 0
    runtime.chartDpr = 1
    runtime.hourlyDpr = 1
    runtime.canvasTimers = []
    runtime.searchDebounce = 0
    runtime.hiddenAt = 0
    runtime.lastManualRefreshAt = readManualRefreshAt(storage)
    runtime.tapCount = 0
    runtime.tapLastAt = 0
    runtime.tapResetTimer = 0
    runtime.doubleTapTimer = 0
    runtime.touchStartX = 0
    runtime.touchStartY = 0
    runtime.touchLastX = 0
    runtime.touchLastY = 0
    runtime.touchOnStrip = false
    runtime.networkHandler = null
    runtime.audioBeginHandler = null
    runtime.audioEndHandler = null
    runtime.windowResizeHandler = null

    const labEnabled = readLabEnabled(runtime.storage)
    this.setData({
      themeClass: uiStore.themeClass,
      themeTone: uiStore.resolvedTheme,
      lowMemory: uiStore.lowMemory,
      labEnabled,
      minutelyVisible: labEnabled,
      ambientAvailable: isWeatherAudioSupported(),
      /* 环境音必须用户手势开启，恢复上次开关时不自动播放 */
      ambientEnabled: false,
      fxCanvasMounted: !isDevtools(),
    })
    this.measureNavBar()

    runtime.themeBindings = createStoreBindings(this, {
      store: uiStore,
      fields: {
        themeClass: () => uiStore.themeClass,
        themeTone: () => uiStore.resolvedTheme,
        lowMemory: () => uiStore.lowMemory,
      },
      actions: [],
    })

    runtime.reactions.push(
      reaction(
        () => uiStore.themeClass,
        () => {
          if (runtime.destroyed) {
            return
          }
          this.configureFx()
          this.drawCharts()
        },
      ),
    )
    runtime.reactions.push(
      reaction(
        () => uiStore.lowMemory,
        () => {
          if (runtime.destroyed) {
            return
          }
          this.setData({ lowMemory: uiStore.lowMemory })
          this.configureFx()
        },
      ),
    )

    const networkApi = wx as unknown as {
      onNetworkStatusChange?: (
        handler: (result: { isConnected: boolean; networkType: string }) => void,
      ) => void
      offNetworkStatusChange?: (
        handler: (result: { isConnected: boolean; networkType: string }) => void,
      ) => void
    }
    if (typeof networkApi.onNetworkStatusChange === 'function') {
      const handler = (result: { isConnected: boolean; networkType: string }): void => {
        if (runtime.destroyed) {
          return
        }
        this.setData({ offline: !result.isConnected })
      }
      runtime.networkHandler = handler
      networkApi.onNetworkStatusChange(handler)
    }

    const audioApi = wx as unknown as {
      onAudioInterruptionBegin?: (handler: () => void) => void
      offAudioInterruptionBegin?: (handler: () => void) => void
      onAudioInterruptionEnd?: (handler: () => void) => void
      offAudioInterruptionEnd?: (handler: () => void) => void
    }
    if (typeof audioApi.onAudioInterruptionBegin === 'function') {
      const begin = (): void => {
        runtime.audio.suspend()
      }
      const end = (): void => {
        if (this.data.ambientEnabled && runtime.visible) {
          runtime.audio.resume()
        }
      }
      runtime.audioBeginHandler = begin
      runtime.audioEndHandler = end
      audioApi.onAudioInterruptionBegin(begin)
      if (typeof audioApi.onAudioInterruptionEnd === 'function') {
        audioApi.onAudioInterruptionEnd(end)
      }
    }

    const resizeApi = wx as unknown as {
      onWindowResize?: (handler: () => void) => void
      offWindowResize?: (handler: () => void) => void
    }
    if (typeof resizeApi.onWindowResize === 'function') {
      const handler = (): void => {
        if (runtime.destroyed) {
          return
        }
        runtime.fxReady = false
        runtime.chartReady = false
        runtime.hourlyReady = false
        this.measureNavBar()
        this.mountFx()
        if (this.data.forecastDays.length > 0) {
          this.mountCharts()
        }
      }
      runtime.windowResizeHandler = handler
      resizeApi.onWindowResize(handler)
    }

    wx.nextTick(() => {
      this.mountFx()
      void this.boot()
    })
  },

  async boot(): Promise<void> {
    const runtime = this as unknown as WeatherPageRuntime
    if (runtime.booted || runtime.booting) {
      return
    }
    runtime.booting = true
    const storage = runtime.storage
    if (!storage) {
      runtime.booting = false
      return
    }
    const cities = readCities(storage)
    const currentAdcode = readCurrentAdcode(storage)
    const current = findCity(cities, currentAdcode) || (cities.length > 0 ? cities[0] : null)
    this.setData({
      cities,
      cityCountText: `${cities.length}/${MAX_CITIES}`,
      currentIndex: current ? Math.max(0, cities.findIndex((city) => city.adcode === current.adcode)) : 0,
    })
    if (current) {
      runtime.booted = true
      runtime.booting = false
      this.activateCity(current, false)
      this.setData({ ready: true })
      return
    }
    await this.beginLocationFlow(true)
    runtime.booted = true
    runtime.booting = false
    this.setData({ ready: true })
  },

  /**
   * 胶囊安全区：用原生胶囊的真实 top / height / left 计算
   * - navTopPx：导航行顶部，使行中心与胶囊中心对齐
   * - navRowHeightPx：导航行高度，至少 44px，容纳两行标题
   * - navRightInsetPx：屏幕右侧到胶囊左缘的安全距离，城市按钮落在胶囊左侧
   * 任何一项都来自运行时测量，绝不写死 padding-top
   */
  measureNavBar(): void {
    const runtime = this as unknown as WeatherPageRuntime
    if (runtime.destroyed) {
      return
    }

    let windowWidth = 375
    let statusBarHeight = 20
    try {
      const info = wx.getWindowInfo()
      windowWidth = safeNumber(info && info.windowWidth, 375)
      statusBarHeight = Math.max(0, safeNumber(info && info.statusBarHeight, 20))
    } catch {
      /* 极端环境：使用保守回退值 */
    }

    let capsuleTop = 0
    let capsuleHeight = 0
    let capsuleLeft = 0
    try {
      const rect = wx.getMenuButtonBoundingClientRect()
      capsuleTop = safeNumber(rect && rect.top, 0)
      capsuleHeight = safeNumber(rect && rect.height, 0)
      capsuleLeft = safeNumber(rect && rect.left, 0)
    } catch {
      /* 低版本或开发者工具异常：走保守回退 */
    }

    const hasCapsule = capsuleTop > 0 && capsuleHeight > 0 && capsuleLeft > 0
    const rowHeight = Math.max(44, hasCapsule ? Math.round(capsuleHeight + 8) : 44)
    const navTop = hasCapsule
      ? Math.max(
          Math.round(statusBarHeight),
          Math.round(capsuleTop - (rowHeight - capsuleHeight) / 2),
        )
      : Math.max(Math.round(statusBarHeight + 6), 44)
    const rightInset = hasCapsule
      ? Math.max(0, Math.round(windowWidth - capsuleLeft + 8))
      : 112

    if (
      navTop !== this.data.navTopPx ||
      rowHeight !== this.data.navRowHeightPx ||
      rightInset !== this.data.navRightInsetPx
    ) {
      this.setData({
        navTopPx: navTop,
        navRowHeightPx: rowHeight,
        navRightInsetPx: rightInset,
      })
    }
  },

  onShow(): void {
    const runtime = this as unknown as WeatherPageRuntime
    if (runtime.destroyed) {
      return
    }
    runtime.visible = true
    this.measureNavBar()
    void this.refreshLocationPermission()
    const hiddenFor = runtime.hiddenAt ? Date.now() - runtime.hiddenAt : 0
    runtime.hiddenAt = 0
    this.mountFx()
    this.configureFx()
    if (this.data.forecastDays.length > 0) {
      this.mountCharts()
    }
    if (this.data.ambientEnabled) {
      runtime.audio.resume()
    }
    const city = runtime.currentCity
    if (city && !this.data.hasResult && !runtime.liveTask) {
      void this.loadLive(city.adcode, false)
      void this.loadForecast(city.adcode, false)
    } else if (
      city &&
      runtime.liveMeta &&
      runtime.liveMeta.stale &&
      !this.data.offline &&
      !runtime.liveTask
    ) {
      void this.loadLive(city.adcode, hiddenFor > 60 * 1000)
    }
  },

  onHide(): void {
    const runtime = this as unknown as WeatherPageRuntime
    runtime.visible = false
    runtime.hiddenAt = Date.now()
    this.abortRequests()
    runtime.fx.stop()
    runtime.audio.suspend()
    this.clearTapTimers()
    if (runtime.searchDebounce) {
      clearTimeout(runtime.searchDebounce)
      runtime.searchDebounce = 0
    }
  },

  onUnload(): void {
    const runtime = this as unknown as WeatherPageRuntime
    runtime.destroyed = true
    runtime.visible = false
    this.abortRequests()
    runtime.fx.dispose()
    runtime.audio.dispose()
    runtime.canvasTimers.forEach((timer) => clearTimeout(timer))
    runtime.canvasTimers = []
    this.clearTapTimers()
    if (runtime.searchDebounce) {
      clearTimeout(runtime.searchDebounce)
      runtime.searchDebounce = 0
    }
    if (runtime.themeBindings) {
      runtime.themeBindings.destroyStoreBindings()
      runtime.themeBindings = null
    }
    runtime.reactions.forEach((dispose) => {
      try {
        dispose()
      } catch {
        /* 已释放 */
      }
    })
    runtime.reactions = []
    const networkApi = wx as unknown as {
      offNetworkStatusChange?: (
        handler: (result: { isConnected: boolean; networkType: string }) => void,
      ) => void
    }
    if (runtime.networkHandler && typeof networkApi.offNetworkStatusChange === 'function') {
      networkApi.offNetworkStatusChange(runtime.networkHandler)
    }
    runtime.networkHandler = null
    const audioApi = wx as unknown as {
      offAudioInterruptionBegin?: (handler: () => void) => void
      offAudioInterruptionEnd?: (handler: () => void) => void
    }
    if (runtime.audioBeginHandler && typeof audioApi.offAudioInterruptionBegin === 'function') {
      audioApi.offAudioInterruptionBegin(runtime.audioBeginHandler)
    }
    if (runtime.audioEndHandler && typeof audioApi.offAudioInterruptionEnd === 'function') {
      audioApi.offAudioInterruptionEnd(runtime.audioEndHandler)
    }
    runtime.audioBeginHandler = null
    runtime.audioEndHandler = null
    const resizeApi = wx as unknown as {
      offWindowResize?: (handler: () => void) => void
    }
    if (runtime.windowResizeHandler && typeof resizeApi.offWindowResize === 'function') {
      resizeApi.offWindowResize(runtime.windowResizeHandler)
    }
    runtime.windowResizeHandler = null
    runtime.chartNode = null
    runtime.chartCtx = null
    runtime.hourlyNode = null
    runtime.hourlyCtx = null
  },

  abortRequests(): void {
    const runtime = this as unknown as WeatherPageRuntime
    ;[runtime.liveTask, runtime.forecastTask, runtime.searchTask].forEach((task) => {
      if (!task) {
        return
      }
      try {
        task.abort()
      } catch {
        /* 已结束 */
      }
    })
    runtime.liveTask = null
    runtime.forecastTask = null
    runtime.searchTask = null
    runtime.liveSeq += 1
    runtime.forecastSeq += 1
    runtime.searchSeq += 1
  },

  onBackTap(): void {
    wx.navigateBack({
      delta: 1,
      fail: () => {
        wx.reLaunch({ url: ROUTES.home })
      },
    })
  },

  onShareAppMessage() {
    return sharePayloadForTool('weather')
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  /* ------------------------------------------------------------------------ */
  /* 定位 / 城市                                                               */
  /* ------------------------------------------------------------------------ */

  async locateCurrent(options: {
    silent: boolean
    allowIp?: boolean
    openSearchOnFail?: boolean
  }): Promise<{ ok: boolean; reason?: LocationFailureReason }> {
    const runtime = this as unknown as WeatherPageRuntime
    if (runtime.locating || runtime.destroyed) {
      return { ok: false }
    }
    if (!runtime.service) {
      return { ok: false }
    }
    runtime.locating = true
    if (!this.data.hasResult) {
      this.setData({ loading: true })
    }
    try {
      const located = await locateCity(runtime.service, Date.now())
      if (located.ok) {
        if (!runtime.destroyed) {
          this.upsertCity(located.city, true)
          this.activateCity(located.city, true)
          tapSuccess()
          if (!options.silent) {
            this.toast(`已定位到 ${located.city.name}`, 'success')
          }
        }
        return { ok: true }
      }
      if (options.allowIp !== false) {
        const ipCity = await locateByIp(runtime.service, Date.now())
        if (ipCity && !runtime.destroyed) {
          this.upsertCity(ipCity, true)
          this.activateCity(ipCity, true)
          tapSuccess()
          if (!options.silent) {
            this.toast(`已按 IP 定位到 ${ipCity.name}`, 'info')
          }
          return { ok: true }
        }
      }
      if (runtime.destroyed) {
        return { ok: false, reason: located.reason }
      }
      if (options.openSearchOnFail !== false) {
        this.openSearchSheet()
        if (!runtime.service.hasKey()) {
          this.setData({
            errorText: '未配置高德 Web服务 Key',
            errorHint: '请在 config.local.ts 填入 Web服务 Key 后重试',
            showRetry: false,
          })
        } else if (!options.silent) {
          this.toast('定位失败，请手动选择城市', 'warning')
        }
      }
      return { ok: false, reason: located.reason }
    } catch (error) {
      logger.warn('weather', '定位链路异常', error)
      if (!runtime.destroyed && options.openSearchOnFail !== false) {
        this.setData({
          searchOpen: true,
          searchFocus: true,
          errorText: '定位失败，请手动选择城市',
          errorHint: '',
          showRetry: true,
        })
      }
      return { ok: false, reason: 'failed' }
    } finally {
      runtime.locating = false
      if (!runtime.destroyed) {
        this.setData({ loading: false })
      }
    }
  },

  openSearchSheet(): void {
    this.setData({
      searchOpen: true,
      searchFocus: true,
      searchKeyword: '',
      searchResults: [],
      searchEmpty: false,
      searchError: '',
    })
  },

  async refreshLocationPermission(): Promise<void> {
    const runtime = this as unknown as WeatherPageRuntime
    const status = await readFuzzyLocationPermission()
    if (runtime.destroyed) {
      return
    }
    const text =
      status === 'granted'
        ? '已授权 · 城市级模糊定位'
        : status === 'denied'
          ? '权限未开启 · 点击后去设置'
          : status === 'unavailable'
            ? '当前环境不支持模糊定位'
            : '未申请 · 点击后按引导开启'
    const action =
      status === 'granted' ? '重新定位' : status === 'unavailable' ? '手动选城' : '去开启'
    this.setData({
      locationPermissionText: text,
      locationActionText: action,
      locationAttention: status !== 'granted',
    })
  },

  /** 统一入口：已授权直接定位；未申请先说明；已拒绝给出去设置 / 手动选城 */
  async beginLocationFlow(auto: boolean): Promise<void> {
    const runtime = this as unknown as WeatherPageRuntime
    if (runtime.locating || runtime.destroyed) {
      return
    }
    const status = await readFuzzyLocationPermission()
    if (runtime.destroyed) {
      return
    }
    if (status === 'granted') {
      const result = await this.locateCurrent({
        silent: auto,
        allowIp: auto,
        openSearchOnFail: auto,
      })
      if (auto || result.ok) {
        return
      }
      this.openLocationPrompt(
        result.reason === 'failed'
          ? 'failed'
          : result.reason === 'unavailable'
            ? 'unavailable'
            : result.reason === 'privacy'
              ? 'privacy'
              : 'denied',
      )
      return
    }
    if (status === 'unset') {
      this.openLocationPrompt('request', auto)
      return
    }
    if (status === 'denied') {
      if (auto) {
        await this.fallbackToIp(true)
      } else {
        this.openLocationPrompt('denied')
      }
      return
    }
    if (auto) {
      await this.fallbackToIp(true)
    } else {
      this.openLocationPrompt('unavailable')
    }
  },

  async startFuzzyLocate(): Promise<void> {
    const result = await this.locateCurrent({
      silent: false,
      allowIp: false,
      openSearchOnFail: false,
    })
    if (result.ok) {
      return
    }
    if (result.reason === 'privacy') {
      this.openLocationPrompt('privacy')
      return
    }
    if (result.reason === 'denied') {
      this.openLocationPrompt('denied')
      return
    }
    this.openLocationPrompt(result.reason === 'unavailable' ? 'unavailable' : 'failed')
  },

  async fallbackToIp(silent = false): Promise<void> {
    const runtime = this as unknown as WeatherPageRuntime
    if (!runtime.service || runtime.destroyed) {
      return
    }
    const ipCity = await locateByIp(runtime.service, Date.now())
    if (ipCity && !runtime.destroyed) {
      this.upsertCity(ipCity, true)
      this.activateCity(ipCity, true)
      tapSuccess()
      if (!silent) {
        this.toast(`已按 IP 定位到 ${ipCity.name}`, 'info')
      }
      return
    }
    if (!runtime.destroyed) {
      this.openSearchSheet()
    }
  },

  openLocationPrompt(
    mode: 'request' | 'privacy' | 'denied' | 'unavailable' | 'failed',
    auto = false,
  ): void {
    const runtime = this as unknown as WeatherPageRuntime
    runtime.locationPromptAuto = auto
    const config =
      mode === 'request'
        ? {
            title: '开启城市级定位？',
            desc: '全息气象只申请城市级模糊定位，用于自动展示所在城市天气；不会获取或保存精确坐标，也不会上传到自建服务器。首次会先确认微信隐私指引，再由微信弹出定位授权。',
            confirm: '允许并定位',
            cancel: '暂不开启',
            extra: '',
            showCancel: true,
          }
        : mode === 'privacy'
          ? {
              title: '需要先同意隐私保护指引',
              desc: '使用定位前需要先同意微信《用户隐私保护指引》。再次点击“重新授权”会重新弹出隐私确认；也可以手动选择城市。',
              confirm: '重新授权',
              cancel: '手动选城',
              extra: '',
              showCancel: true,
            }
          : mode === 'denied'
            ? {
                title: '定位权限未开启',
                desc: '你之前拒绝了城市级模糊定位。可前往小程序设置重新开启，开启后返回气象站会自动定位；若已开启，请检查手机系统定位服务。也可以手动选择城市。',
                confirm: '去设置',
                cancel: '手动选城',
                extra: '系统设置',
                showCancel: true,
              }
          : mode === 'unavailable'
            ? {
                title: '当前环境不支持模糊定位',
                desc: '当前微信版本或运行环境不支持城市级模糊定位，请手动添加城市。',
                confirm: '手动选城',
                cancel: '',
                extra: '',
                showCancel: false,
              }
            : {
                title: '定位暂时失败',
                desc: '模糊定位或逆地理编码没有成功，可以稍后重试，或手动添加城市。',
                confirm: '手动选城',
                cancel: '知道了',
                extra: '',
                showCancel: true,
              }
    this.setData({
      locationPromptShow: true,
      locationPromptMode: mode,
      locationPromptTitle: config.title,
      locationPromptDesc: config.desc,
      locationPromptConfirmText: config.confirm,
      locationPromptCancelText: config.cancel,
      locationPromptExtraText: config.extra,
      locationPromptShowCancel: config.showCancel,
    })
  },

  onUseCurrentLocation(): void {
    const runtime = this as unknown as WeatherPageRuntime
    if (runtime.locating || runtime.destroyed) {
      return
    }
    tapTick()
    if (this.data.citySheetOpen) {
      this.setData({ citySheetOpen: false })
    }
    void this.refreshLocationPermission()
    void this.beginLocationFlow(false)
  },

  onLocationPromptConfirm(): void {
    const runtime = this as unknown as WeatherPageRuntime
    const mode = this.data.locationPromptMode
    runtime.locationPromptAuto = false
    this.setData({ locationPromptShow: false, locationPromptMode: '' })
    if (mode === 'request' || mode === 'privacy') {
      void this.startFuzzyLocate()
      return
    }
    if (mode === 'denied') {
      this.openLocationSetting()
      return
    }
    this.openSearchSheet()
    if (mode === 'unavailable') {
      this.toast('请手动添加城市', 'info')
    }
  },

  onLocationPromptCancel(): void {
    const runtime = this as unknown as WeatherPageRuntime
    const mode = this.data.locationPromptMode
    const auto = runtime.locationPromptAuto
    runtime.locationPromptAuto = false
    this.setData({ locationPromptShow: false, locationPromptMode: '' })
    if (auto) {
      void this.fallbackToIp()
      return
    }
    if (
      mode === 'privacy' ||
      mode === 'denied' ||
      mode === 'failed' ||
      mode === 'unavailable'
    ) {
      this.openSearchSheet()
    }
  },

  onLocationPromptExtra(): void {
    const runtime = this as unknown as WeatherPageRuntime
    runtime.locationPromptAuto = false
    this.setData({ locationPromptShow: false, locationPromptMode: '' })
    const api = wx as unknown as {
      openAppAuthorizeSetting?: (options?: { fail?: () => void }) => void
    }
    if (typeof api.openAppAuthorizeSetting !== 'function') {
      this.toast('当前版本不支持打开系统设置', 'warning')
      return
    }
    api.openAppAuthorizeSetting({
      fail: () => {
        if (!runtime.destroyed) {
          this.toast('打开系统设置失败', 'error')
        }
      },
    })
  },

  openLocationSetting(): void {
    const runtime = this as unknown as WeatherPageRuntime
    wx.openSetting({
      success: (result) => {
        if (runtime.destroyed) {
          return
        }
        const auth = (result.authSetting || {}) as Record<string, unknown>
        if (auth['scope.userFuzzyLocation'] === true) {
          void this.startFuzzyLocate()
        } else {
          this.toast('定位权限仍未开启，可手动添加城市', 'warning')
        }
      },
      fail: () => {
        if (!runtime.destroyed) {
          this.toast('打开设置失败，请在小程序右上角设置中开启定位', 'error')
        }
      },
    })
  },

  upsertCity(city: SavedCity, evict: boolean): boolean {
    const runtime = this as unknown as WeatherPageRuntime
    if (!runtime.storage) {
      return false
    }
    const list = this.data.cities.slice()
    const index = list.findIndex((item) => item.adcode === city.adcode)
    let evicted: SavedCity | null = null
    if (index >= 0) {
      list[index] = city
    } else {
      if (list.length >= MAX_CITIES) {
        if (!evict) {
          this.toast(`最多保留 ${MAX_CITIES} 个城市，请长按移除一个`, 'warning')
          return false
        }
        evicted = list[list.length - 1]
        list.pop()
      }
      list.push(city)
    }
    const cleaned = writeCities(runtime.storage, list)
    if (evicted && evicted.adcode !== city.adcode && runtime.storage) {
      removeCityCache(runtime.storage, evicted.adcode)
    }
    this.setData({
      cities: cleaned,
      cityCountText: `${cleaned.length}/${MAX_CITIES}`,
      currentIndex: Math.max(0, cleaned.findIndex((item) => item.adcode === city.adcode)),
    })
    return true
  },

  activateCity(city: SavedCity, force: boolean): void {
    const runtime = this as unknown as WeatherPageRuntime
    if (runtime.destroyed || !runtime.storage) {
      return
    }
    runtime.currentCity = city
    writeCurrentAdcode(runtime.storage, city.adcode)
    const index = this.data.cities.findIndex((item) => item.adcode === city.adcode)
    this.setData({
      cityName: city.name,
      province: city.province,
      adcode: city.adcode,
      adcodeText: city.adcode,
      citySourceLabel: sourceLabel(city.source),
      currentIndex: index >= 0 ? index : 0,
      errorText: '',
      errorHint: '',
      showRetry: false,
    })
    this.applySunTimes()
    this.clearLiveIfMissing(city.adcode)
    this.clearForecastIfMissing(city.adcode)
    void this.loadLive(city.adcode, force)
    void this.loadForecast(city.adcode, force)
  },

  clearLiveIfMissing(adcode: string): void {
    const runtime = this as unknown as WeatherPageRuntime
    if (!runtime.storage) {
      return
    }
    const cache = readLiveCache(runtime.storage, adcode, Date.now())
    if (cache) {
      return
    }
    this.setData({
      hasResult: false,
      weatherSummary: '',
      weatherName: '—',
      weatherFamily: 'unknown',
      temperatureText: '—',
      temperatureUnit: '',
      winddirection: '—',
      windpower: '—',
      humidityText: '—',
      humidityUnit: '',
      reporttimeText: '—',
      reporttimeAria: '数据发布时间未知',
      stale: false,
      cacheAgeText: '',
    })
  },

  clearForecastIfMissing(adcode: string): void {
    const runtime = this as unknown as WeatherPageRuntime
    if (!runtime.storage) {
      return
    }
    const cache = readForecastCache(runtime.storage, adcode, Date.now())
    if (cache) {
      return
    }
    this.setData({
      forecastTitle: '未来天气',
      forecastDays: [],
      forecastEmpty: true,
      forecastReport: '—',
      chartAria: '暂无预报数据',
      chartCanvasMounted: false,
      chartReady: false,
      hourlyPoints: [],
      hourlyAria: '暂无可推算的 24 小时温度',
      hourlyCanvasMounted: false,
      hourlyReady: false,
    })
    runtime.chartReady = false
    runtime.hourlyReady = false
    runtime.chartCtx = null
    runtime.hourlyCtx = null
  },

  switchCity(delta: number): void {
    const runtime = this as unknown as WeatherPageRuntime
    const cities = this.data.cities
    if (cities.length <= 1) {
      this.toast('仅有一个城市，点击「+」添加', 'info')
      return
    }
    const current = runtime.currentCity
    const index = current ? cities.findIndex((item) => item.adcode === current.adcode) : 0
    const next = index + delta
    if (next < 0 || next >= cities.length) {
      this.toast(delta > 0 ? '已经是最后一个城市' : '已经是第一个城市', 'info')
      return
    }
    tapTick()
    this.activateCity(cities[next], false)
  },

  onTouchStart(event: unknown): void {
    if (this.data.citySheetOpen || this.data.searchOpen || this.data.diagnosticsOpen) {
      return
    }
    const runtime = this as unknown as WeatherPageRuntime
    if (runtime.touchOnStrip) {
      runtime.touchStartX = 0
      runtime.touchStartY = 0
      runtime.touchLastX = 0
      runtime.touchLastY = 0
      return
    }
    const touch = firstTouch(event)
    if (!touch) {
      runtime.touchStartX = 0
      runtime.touchStartY = 0
      return
    }
    runtime.touchStartX = touch.x
    runtime.touchStartY = touch.y
    runtime.touchLastX = touch.x
    runtime.touchLastY = touch.y
  },

  onStripTouchStart(): void {
    const runtime = this as unknown as WeatherPageRuntime
    runtime.touchOnStrip = true
  },

  onStripTouchEnd(): void {
    const runtime = this as unknown as WeatherPageRuntime
    runtime.touchOnStrip = false
  },

  onTouchMove(event: unknown): void {
    const touch = firstTouch(event)
    if (!touch) {
      return
    }
    const runtime = this as unknown as WeatherPageRuntime
    runtime.touchLastX = touch.x
    runtime.touchLastY = touch.y
  },

  onTouchEnd(): void {
    const runtime = this as unknown as WeatherPageRuntime
    if (runtime.touchOnStrip) {
      runtime.touchOnStrip = false
      runtime.touchStartX = 0
      runtime.touchStartY = 0
      runtime.touchLastX = 0
      runtime.touchLastY = 0
      return
    }
    const dx = runtime.touchLastX - runtime.touchStartX
    const dy = runtime.touchLastY - runtime.touchStartY
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      this.switchCity(dx < 0 ? 1 : -1)
    }
    runtime.touchStartX = 0
    runtime.touchStartY = 0
    runtime.touchLastX = 0
    runtime.touchLastY = 0
  },

  onHeaderTap(): void {
    const runtime = this as unknown as WeatherPageRuntime
    const now = Date.now()
    if (now - runtime.tapLastAt > 2500) {
      runtime.tapCount = 0
      this.clearTapTimers()
    }
    runtime.tapLastAt = now
    runtime.tapCount += 1
    if (runtime.tapCount >= 5) {
      runtime.tapCount = 0
      this.clearTapTimers()
      tapSuccess()
      this.openDiagnostics()
      return
    }
    if (runtime.doubleTapTimer) {
      clearTimeout(runtime.doubleTapTimer)
      runtime.doubleTapTimer = 0
      return
    }
    if (runtime.tapCount === 2) {
      runtime.doubleTapTimer = setTimeout(() => {
        runtime.doubleTapTimer = 0
        runtime.tapCount = 0
        void this.beginLocationFlow(false)
      }, 350) as unknown as number
      return
    }
    if (runtime.tapCount === 1) {
      runtime.tapResetTimer = setTimeout(() => {
        runtime.tapCount = 0
        runtime.tapResetTimer = 0
      }, 2500) as unknown as number
    }
  },

  clearTapTimers(): void {
    const runtime = this as unknown as WeatherPageRuntime
    if (runtime.tapResetTimer) {
      clearTimeout(runtime.tapResetTimer)
      runtime.tapResetTimer = 0
    }
    if (runtime.doubleTapTimer) {
      clearTimeout(runtime.doubleTapTimer)
      runtime.doubleTapTimer = 0
    }
  },

  onOpenCities(): void {
    this.setData({ citySheetOpen: true })
    void this.refreshLocationPermission()
  },

  onCloseCities(): void {
    this.setData({ citySheetOpen: false })
  },

  onCityTap(event: unknown): void {
    const dataset = eventDataset(event)
    const index = Number(dataset.index)
    const city = this.data.cities[index]
    if (!city) {
      return
    }
    tapTick()
    this.setData({ citySheetOpen: false })
    this.activateCity(city, false)
  },

  onCityLongPress(event: unknown): void {
    const dataset = eventDataset(event)
    const index = Number(dataset.index)
    const city = this.data.cities[index]
    if (!city) {
      return
    }
    if (city.source === 'fuzzy') {
      this.toast('定位城市不可移除', 'warning')
      return
    }
    if (this.data.cities.length <= 1) {
      this.toast('至少保留一个城市', 'warning')
      return
    }
    wx.showModal({
      title: '移除城市',
      content: `确定移除「${city.name}」？`,
      confirmText: '移除',
      confirmColor: '#FF4D24',
      success: (result) => {
        if (!result.confirm) {
          return
        }
        this.removeCity(index)
      },
    })
  },

  removeCity(index: number): void {
    const runtime = this as unknown as WeatherPageRuntime
    if (!runtime.storage) {
      return
    }
    const cities = this.data.cities.slice()
    const removed = cities[index]
    if (!removed || removed.source === 'fuzzy') {
      return
    }
    cities.splice(index, 1)
    const cleaned = writeCities(runtime.storage, cities)
    removeCityCache(runtime.storage, removed.adcode)
    const current = runtime.currentCity
    this.setData({
      cities: cleaned,
      cityCountText: `${cleaned.length}/${MAX_CITIES}`,
    })
    if (current && current.adcode === removed.adcode) {
      const fallback = cleaned[0]
      if (fallback) {
        this.activateCity(fallback, false)
      }
    }
    this.toast(`已移除 ${removed.name}`, 'success')
  },

  onAddCity(): void {
    this.setData({
      citySheetOpen: false,
      searchOpen: true,
      searchFocus: true,
      searchKeyword: '',
      searchResults: [],
      searchEmpty: false,
      searchError: '',
    })
  },

  onSearchClose(): void {
    this.setData({ searchOpen: false, searchFocus: false })
  },

  onSearchInput(event: unknown): void {
    const runtime = this as unknown as WeatherPageRuntime
    const value = eventInputValue(event)
    this.setData({ searchKeyword: value, searchEmpty: false, searchError: '' })
    if (runtime.searchDebounce) {
      clearTimeout(runtime.searchDebounce)
      runtime.searchDebounce = 0
    }
    const keyword = value.trim()
    if (!keyword) {
      this.setData({ searchResults: [], searchLoading: false, searchEmpty: false })
      return
    }
    runtime.searchDebounce = setTimeout(() => {
      runtime.searchDebounce = 0
      void this.runSearch(keyword)
    }, 350) as unknown as number
  },

  onSearchConfirm(event: unknown): void {
    const keyword = eventInputValue(event).trim()
    if (keyword) {
      void this.runSearch(keyword)
    }
  },

  async runSearch(keyword: string): Promise<void> {
    const runtime = this as unknown as WeatherPageRuntime
    if (!runtime.service || runtime.destroyed) {
      return
    }
    if (!runtime.service.hasKey()) {
      this.setData({
        searchLoading: false,
        searchError: '未配置高德 Web服务 Key',
      })
      return
    }
    runtime.searchSeq += 1
    const seq = runtime.searchSeq
    if (runtime.searchTask) {
      try {
        runtime.searchTask.abort()
      } catch {
        /* 已结束 */
      }
    }
    this.setData({ searchLoading: true, searchError: '', searchEmpty: false })
    const task = runtime.service.searchDistricts(keyword)
    runtime.searchTask = task
    try {
      const results = await task.promise
      if (runtime.destroyed || seq !== runtime.searchSeq) {
        return
      }
      this.setData({
        searchResults: results,
        searchLoading: false,
        searchEmpty: results.length === 0,
      })
    } catch (error) {
      if (runtime.destroyed || seq !== runtime.searchSeq) {
        return
      }
      const failure = describeWeatherFailure(error)
      this.setData({
        searchLoading: false,
        searchError: failure.message,
        searchEmpty: false,
      })
    } finally {
      if (seq === runtime.searchSeq) {
        runtime.searchTask = null
      }
    }
  },

  onSearchSelect(event: unknown): void {
    const dataset = eventDataset(event)
    const adcode = String(dataset.adcode || '')
    const candidate = this.data.searchResults.find((item) => item.adcode === adcode)
    if (!candidate) {
      return
    }
    const existing = this.data.cities.find((item) => item.adcode === candidate.adcode)
    if (existing) {
      tapTick()
      this.setData({ searchOpen: false, searchFocus: false })
      this.activateCity(existing, true)
      return
    }
    const city = candidateToCity(candidate, 'manual', Date.now())
    if (!this.upsertCity(city, false)) {
      return
    }
    tapSuccess()
    this.setData({ searchOpen: false, searchFocus: false })
    this.activateCity(city, true)
  },

  onOpenDiagnostics(): void {
    this.openDiagnostics()
  },

  openDiagnostics(): void {
    const runtime = this as unknown as WeatherPageRuntime
    const now = Date.now()
    const liveAge = runtime.liveMeta ? Math.max(0, now - runtime.liveMeta.fetchedAt) : 0
    const forecastAge = runtime.forecastMeta
      ? Math.max(0, now - runtime.forecastMeta.fetchedAt)
      : 0
    const text = buildDiagnosticText(
      {
        keyMasked: runtime.service ? runtime.service.maskedKey() : '未配置',
        cityName: this.data.cityName,
        province: this.data.province,
        adcode: this.data.adcode,
        reporttime: this.data.reporttimeText,
        liveAgeMs: liveAge,
        liveStale: runtime.liveMeta ? runtime.liveMeta.stale : false,
        forecastAgeMs: forecastAge,
        forecastStale: runtime.forecastMeta ? runtime.forecastMeta.stale : false,
        offline: this.data.offline,
        highLevelLab: this.data.labEnabled,
        ambientEnabled: this.data.ambientEnabled,
      },
      runtime.log.list(),
    )
    this.setData({
      diagnosticsOpen: true,
      diagnosticsText: text,
      diagnosticsLogs: runtime.log.list(),
      diagnosticsKey: runtime.service ? runtime.service.maskedKey() : '未配置',
      citySheetOpen: false,
    })
  },

  onCloseDiagnostics(): void {
    this.setData({ diagnosticsOpen: false })
  },

  onToggleLab(): void {
    const runtime = this as unknown as WeatherPageRuntime
    const next = !this.data.labEnabled
    if (runtime.storage) {
      writeLabEnabled(runtime.storage, next)
    }
    this.setData({ labEnabled: next, minutelyVisible: next })
    tapTick()
    if (next) {
      this.toast('已显示分钟级降水扩展位：高级能力需商务咨询', 'info')
    }
  },

  onCopyDiagnostics(): void {
    wx.setClipboardData({
      data: this.data.diagnosticsText,
      success: () => {
        this.toast('诊断信息已复制', 'success')
      },
      fail: () => {
        this.toast('复制失败，请稍后重试', 'error')
      },
    })
  },

  onToggleAmbient(): void {
    const runtime = this as unknown as WeatherPageRuntime
    if (!this.data.ambientAvailable) {
      this.toast('当前设备不支持合成环境音', 'warning')
      return
    }
    if (!this.data.ambientScene) {
      this.toast('当前天气没有匹配的环境音', 'info')
      return
    }
    const next = !this.data.ambientEnabled
    const scene: AmbientScene =
      this.data.ambientScene === 'rain'
        ? 'rain'
        : this.data.ambientScene === 'wind'
          ? 'wind'
          : null
    runtime.audio.setScene(scene)
    runtime.audio.setEnabled(next)
    if (next && !runtime.audio.isEnabled()) {
      this.setData({ ambientEnabled: false })
      this.toast('环境音启动失败，请检查系统音频状态', 'warning')
      return
    }
    this.setData({ ambientEnabled: next })
    tapTick()
    if (next) {
      this.toast('环境音已开启，切换页面会自动暂停', 'info')
    }
  },

  onOpenWorkflow(): void {
    if (!this.data.hasResult) {
      this.toast('天气数据尚未就绪', 'info')
      return
    }
    tapTick()
    this.setData({ workflowPanelVisible: true })
  },

  onWorkflowPanelClose(): void {
    this.setData({ workflowPanelVisible: false })
  },

  async onRefresherRefresh(): Promise<void> {
    const runtime = this as unknown as WeatherPageRuntime
    const now = Date.now()
    const last =
      runtime.lastManualRefreshAt ||
      (runtime.storage ? readManualRefreshAt(runtime.storage) : 0)
    const elapsed = now - last
    if (elapsed < MANUAL_REFRESH_CD_MS) {
      const remaining = Math.ceil((MANUAL_REFRESH_CD_MS - elapsed) / 1000)
      this.setData({ refreshing: false })
      this.toast(`刷新太快，请 ${remaining} 秒后再试`, 'warning')
      return
    }
    runtime.lastManualRefreshAt = now
    if (runtime.storage) {
      writeManualRefreshAt(runtime.storage, now)
    }
    this.setData({ refreshing: true })
    try {
      await this.refreshCity(true)
    } finally {
      this.setData({ refreshing: false })
    }
  },

  async refreshCity(force: boolean): Promise<void> {
    const runtime = this as unknown as WeatherPageRuntime
    const city = runtime.currentCity
    if (!city) {
      await this.beginLocationFlow(true)
      return
    }
    await Promise.all([
      this.loadLive(city.adcode, force),
      this.loadForecast(city.adcode, force),
    ])
  },

  onRetry(): void {
    const runtime = this as unknown as WeatherPageRuntime
    if (!runtime.service) {
      return
    }
    if (!runtime.service.hasKey()) {
      this.setData({
        errorText: '未配置高德 Web服务 Key',
        errorHint: '请在 config.local.ts 填入 Web服务 Key 后重试',
        showRetry: false,
      })
      return
    }
    void this.refreshCity(true)
  },

  /* ------------------------------------------------------------------------ */
  /* 数据加载                                                                   */
  /* ------------------------------------------------------------------------ */

  async loadLive(adcode: string, force: boolean): Promise<void> {
    const runtime = this as unknown as WeatherPageRuntime
    const service = runtime.service
    const storage = runtime.storage
    if (!service || !storage || runtime.destroyed) {
      return
    }
    const now = Date.now()
    const cached = readLiveCache(storage, adcode, now)
    if (cached) {
      this.applyLive(cached.data, cached, true)
      this.recordRequestLog('weather.live', now, 200, '10000', true, true, adcode)
      if (!cached.stale && !force) {
        return
      }
    } else if (!this.data.hasResult) {
      this.setData({ loading: true })
    }
    if (!force && hasRecentFailure(storage, adcode, 'api', now)) {
      return
    }
    runtime.liveSeq += 1
    const seq = runtime.liveSeq
    if (runtime.liveTask) {
      try {
        runtime.liveTask.abort()
      } catch {
        /* 已结束 */
      }
      runtime.liveTask = null
    }
    const startedAt = Date.now()
    const task = service.fetchLive(adcode)
    runtime.liveTask = task
    try {
      const live = await task.promise
      if (runtime.destroyed || seq !== runtime.liveSeq) {
        return
      }
      const fetchedAt = Date.now()
      writeLiveCache(storage, live, fetchedAt, adcode)
      this.applyLive(
        live,
        {
          fetchedAt,
          reporttime: live.reporttime,
          ageMs: 0,
          stale: false,
        },
        false,
      )
      this.recordRequestLog(
        'weather.live',
        startedAt,
        200,
        '10000',
        true,
        false,
        adcode,
      )
    } catch (error) {
      if (runtime.destroyed || seq !== runtime.liveSeq) {
        return
      }
      const failure = describeWeatherFailure(error)
      const infocode = error instanceof WeatherError ? error.infocode : ''
      const kind = error instanceof WeatherError ? error.kind : 'network'
      writeNegativeCache(storage, adcode, kind, Date.now())
      this.recordRequestLog(
        'weather.live',
        startedAt,
        error instanceof WeatherError ? error.statusCode : 0,
        infocode,
        false,
        false,
        adcode,
      )
      this.handleFailure(failure, Boolean(cached))
    } finally {
      if (seq === runtime.liveSeq) {
        runtime.liveTask = null
      }
      if (!runtime.destroyed && seq === runtime.liveSeq) {
        this.setData({ loading: false })
      }
    }
  },

  async loadForecast(adcode: string, force: boolean): Promise<void> {
    const runtime = this as unknown as WeatherPageRuntime
    const service = runtime.service
    const storage = runtime.storage
    if (!service || !storage || runtime.destroyed) {
      return
    }
    const now = Date.now()
    const cached = readForecastCache(storage, adcode, now)
    if (cached) {
      this.applyForecast(cached.data, cached, true)
      this.recordRequestLog('weather.forecast', now, 200, '10000', true, true, adcode)
      if (!cached.stale && !force) {
        return
      }
    }
    runtime.forecastSeq += 1
    const seq = runtime.forecastSeq
    if (runtime.forecastTask) {
      try {
        runtime.forecastTask.abort()
      } catch {
        /* 已结束 */
      }
      runtime.forecastTask = null
    }
    const startedAt = Date.now()
    const task = service.fetchForecast(adcode)
    runtime.forecastTask = task
    try {
      const forecast = await task.promise
      if (runtime.destroyed || seq !== runtime.forecastSeq) {
        return
      }
      const fetchedAt = Date.now()
      writeForecastCache(storage, forecast, adcode, fetchedAt)
      this.applyForecast(
        forecast,
        {
          fetchedAt,
          reporttime: forecast.reporttime,
          ageMs: 0,
          stale: false,
        },
        false,
      )
      this.recordRequestLog('weather.forecast', startedAt, 200, '10000', true, false, adcode)
    } catch (error) {
      if (runtime.destroyed || seq !== runtime.forecastSeq) {
        return
      }
      const failure = describeWeatherFailure(error)
      const infocode = error instanceof WeatherError ? error.infocode : ''
      this.recordRequestLog(
        'weather.forecast',
        startedAt,
        error instanceof WeatherError ? error.statusCode : 0,
        infocode,
        false,
        false,
        adcode,
      )
      if (!this.data.forecastEmpty) {
        this.handleFailure(failure, true)
      } else {
        this.handleFailure(failure, false)
      }
    } finally {
      if (seq === runtime.forecastSeq) {
        runtime.forecastTask = null
      }
    }
  },

  applyLive(
    live: LiveWeather,
    meta: { fetchedAt: number; reporttime: string; ageMs: number; stale: boolean },
    cacheHit: boolean,
  ): void {
    const runtime = this as unknown as WeatherPageRuntime
    const resolved = resolveWeather(live.weather)
    const age = Math.max(0, meta.ageMs || Date.now() - meta.fetchedAt)
    const temperature = live.temperature
    const humidity = live.humidity
    runtime.liveMeta = {
      fetchedAt: meta.fetchedAt,
      stale: age > 15 * 60 * 1000,
      reporttime: live.reporttime,
    }
    this.setData(
      {
        cityName: live.city || this.data.cityName,
        province: live.province || this.data.province,
        adcode: live.adcode,
        adcodeText: live.adcode,
        weatherName: resolved.label,
        weatherFamily: resolved.family,
        temperatureText: formatTemperature(temperature),
        temperatureUnit: temperature === null ? '' : '℃',
        winddirection: live.winddirection || '—',
        windpower: live.windpower || '—',
        humidityText: humidity === null ? '—' : String(humidity),
        humidityUnit: humidity === null ? '' : '%',
        reporttimeText: formatReportTime(live.reporttime),
        reporttimeAria: formatReportTimeAria(live.reporttime),
        stale: age > 15 * 60 * 1000,
        cacheAgeText: formatAge(age),
        hasResult: true,
        weatherSummary: buildWeatherSummary(live),
        errorText: '',
        errorHint: '',
        showRetry: false,
        loading: false,
      },
      () => {
        this.applySunTimes()
        this.applyAmbientScene(resolved.family)
      },
    )
    if (cacheHit) {
      /* 缓存命中不改变当前请求序号，也不覆盖网络请求状态 */
    }
  },

  applyForecast(
    forecast: ForecastWeather,
    meta: { fetchedAt: number; reporttime: string; ageMs: number; stale: boolean },
    cacheHit: boolean,
  ): void {
    const runtime = this as unknown as WeatherPageRuntime
    const days = forecast.days.slice(0, 4)
    const views: ForecastDayView[] = days.map((day) => ({
      ...day,
      daytempText: formatTemperature(day.daytemp),
      nighttempText: formatTemperature(day.nighttemp),
      dayFamily: resolveWeather(day.dayweather).family,
      nightFamily: resolveWeather(day.nightweather).family,
    }))
    const hourly = buildHourlyForecast(days, new Date())
    const hourlyViews: HourlyPointView[] = hourly.map((point) => ({
      ...point,
      tempText: String(point.temp),
    }))
    const age = Math.max(0, meta.ageMs || Date.now() - meta.fetchedAt)
    runtime.forecastMeta = {
      fetchedAt: meta.fetchedAt,
      stale: age > 30 * 60 * 1000,
      reporttime: forecast.reporttime,
    }
    this.setData(
      {
        forecastTitle: `未来 ${views.length} 天`,
        forecastDays: views,
        forecastEmpty: views.length === 0,
        forecastReport: formatReportTime(forecast.reporttime),
        chartAria: forecastAriaText(days),
        hourlyPoints: hourlyViews,
        hourlyAria: hourlyAriaText(hourly),
        errorText: '',
        errorHint: '',
        showRetry: false,
      },
      () => {
        this.mountCharts()
      },
    )
  },

  applySunTimes(): void {
    const runtime = this as unknown as WeatherPageRuntime
    const city = runtime.currentCity
    const now = new Date()
    if (!city || !city.center) {
      const hour = now.getHours()
      this.setData({
        sunrise: '—',
        sunset: '—',
        sunKind: 'normal',
        sunNote: '缺少经纬度，暂不可计算',
        isNight: isNightHour(hour),
      })
      this.configureFx()
      return
    }
    const times = computeSunTimes(city.center.lat, city.center.lng, now)
    const current = now.getHours() * 60 + now.getMinutes()
    let isNight = isNightHour(now.getHours())
    let note = '依据经纬度本地计算 · 仅供参考'
    if (times.kind === 'polar-day') {
      isNight = false
      note = '极昼：太阳不落'
    } else if (times.kind === 'polar-night') {
      isNight = true
      note = '极夜：太阳不升'
    } else {
      const sunriseMinutes = clockMinutes(times.sunrise)
      const sunsetMinutes = clockMinutes(times.sunset)
      if (sunriseMinutes !== null && sunsetMinutes !== null) {
        isNight = current < sunriseMinutes || current >= sunsetMinutes
      }
    }
    this.setData({
      sunrise: times.sunrise,
      sunset: times.sunset,
      sunKind: times.kind,
      sunNote: note,
      isNight,
    })
    this.configureFx()
  },

  applyAmbientScene(family: WeatherFamily): void {
    const runtime = this as unknown as WeatherPageRuntime
    const scene = ambientSceneFor(family)
    runtime.audio.setScene(scene)
    if (!scene && this.data.ambientEnabled) {
      runtime.audio.setEnabled(false)
    }
    const value: '' | 'rain' | 'wind' = scene === 'rain' ? 'rain' : scene === 'wind' ? 'wind' : ''
    const label = scene === 'rain' ? '雨声合成' : scene === 'wind' ? '风声合成' : '当前天气无匹配环境音'
    this.setData({
      ambientEnabled: scene ? this.data.ambientEnabled : false,
      ambientScene: value,
      ambientSceneLabel: label,
      ambientHint: scene ? '合成白噪音 · 默认关闭 · 切换页面自动暂停' : '当前天气不提供环境音',
    })
  },

  handleFailure(
    failure: { message: string; hint: string; infocode: string },
    hasFallback: boolean,
  ): void {
    if (!hasFallback) {
      tapWarn()
    }
    if (this.data.hasResult && hasFallback) {
      this.setData({
        stale: true,
        errorText: failure.message,
        errorHint: failure.hint,
        showRetry: true,
      })
      return
    }
    this.setData({
      errorText: failure.message,
      errorHint: failure.hint,
      showRetry: true,
      loading: false,
    })
  },

  recordRequestLog(
    endpoint: string,
    startedAt: number,
    statusCode: number,
    infocode: string,
    ok: boolean,
    cacheHit: boolean,
    adcode: string,
  ): void {
    const runtime = this as unknown as WeatherPageRuntime
    runtime.log.record({
      endpoint,
      startedAt,
      durationMs: Math.max(0, Date.now() - startedAt),
      statusCode,
      infocode,
      ok,
      cacheHit,
      adcode,
      label: describeInfoCode(infocode).label,
    })
    this.setData({ diagnosticsLogs: runtime.log.list() })
  },

  /* ------------------------------------------------------------------------ */
  /* Canvas                                                                   */
  /* ------------------------------------------------------------------------ */

  mountFx(): void {
    const runtime = this as unknown as WeatherPageRuntime
    if (
      runtime.destroyed ||
      runtime.fxUnsupported ||
      isDevtools() ||
      uiStore.lowMemory ||
      preferenceStore.motion === 'saver'
    ) {
      return
    }
    if (runtime.fxReady) {
      this.configureFx()
      return
    }
    this.setData({ fxCanvasMounted: true }, () => {
      this.queryCanvas(
        '#weather-fx',
        (entry) => {
          const node = entry.node as unknown as FxCanvasNode
          const width = safeNumber(entry.width)
          const height = safeNumber(entry.height)
          if (!node || width <= 0 || height <= 0) {
            return
          }
          const dpr = pixelRatio()
          node.width = Math.max(1, Math.round(width * dpr))
          node.height = Math.max(1, Math.round(height * dpr))
          runtime.fx.mount(node, width, height, dpr)
          runtime.fxReady = true
          this.setData({
            fxPxW: Math.round(width),
            fxPxH: Math.round(height),
          })
          this.configureFx()
        },
        0,
        () => {
          this.markFxUnsupported()
        },
      )
    })
  },

  markFxUnsupported(): void {
    const runtime = this as unknown as WeatherPageRuntime
    runtime.fxUnsupported = true
    runtime.fxReady = false
    this.setData({ fxCanvasMounted: false, fxPxW: 0, fxPxH: 0 })
  },

  queryCanvas(
    selector: string,
    onReady: (entry: CanvasQueryEntry) => void,
    attempt = 0,
    onFail?: () => void,
  ): void {
    const runtime = this as unknown as WeatherPageRuntime
    if (runtime.destroyed) {
      return
    }
    this.createSelectorQuery()
      .select(selector)
      .fields({ node: true, size: true })
      .exec((result: unknown[]) => {
        if (runtime.destroyed) {
          return
        }
        const entry = result && result[0] ? (result[0] as CanvasQueryEntry) : null
        const node = entry?.node
        const width = safeNumber(entry?.width)
        const height = safeNumber(entry?.height)
        if (node && width > 0 && height > 0) {
          onReady({ node, width, height })
          return
        }
        if (attempt >= 2) {
          if (typeof onFail === 'function') {
            onFail()
          }
          return
        }
        const timer = setTimeout(() => {
          this.queryCanvas(selector, onReady, attempt + 1, onFail)
        }, 300) as unknown as number
        runtime.canvasTimers.push(timer)
      })
  },

  configureFx(): void {
    const runtime = this as unknown as WeatherPageRuntime
    if (!runtime.fxReady) {
      return
    }
    runtime.fx.configure({
      family: this.data.weatherFamily,
      isNight: this.data.isNight,
      theme: uiStore.resolvedTheme,
      lowMemory: uiStore.lowMemory,
      reduceMotion: preferenceStore.motion === 'saver',
    })
    if (runtime.visible && !uiStore.lowMemory && preferenceStore.motion !== 'saver') {
      runtime.fx.start()
    } else {
      runtime.fx.stop()
    }
  },

  mountCharts(): void {
    const runtime = this as unknown as WeatherPageRuntime
    if (runtime.destroyed) {
      return
    }
    if (isDevtools()) {
      this.setData({
        chartCanvasMounted: false,
        chartReady: false,
        hourlyCanvasMounted: false,
        hourlyReady: false,
      })
      return
    }
    const hasForecast = this.data.forecastDays.length > 0 && !runtime.chartUnsupported
    const hasHourly = this.data.hourlyPoints.length > 0 && !runtime.hourlyUnsupported
    if (!hasForecast && !hasHourly) {
      this.setData({
        chartCanvasMounted: false,
        chartReady: false,
        hourlyCanvasMounted: false,
        hourlyReady: false,
      })
      return
    }
    this.setData(
      {
        chartCanvasMounted: hasForecast,
        chartReady: false,
        hourlyCanvasMounted: hasHourly,
        hourlyReady: false,
      },
      () => {
        if (hasForecast) {
          this.queryChart()
        }
        if (hasHourly) {
          this.queryHourly()
        }
      },
    )
  },

  queryChart(): void {
    const runtime = this as unknown as WeatherPageRuntime
    if (runtime.chartReady) {
      this.setData({ chartCanvasMounted: true, chartReady: true })
      this.drawCharts()
      return
    }
    this.queryCanvas('#weather-chart', (entry) => {
      const node = entry.node as unknown as ChartCanvasNode
      const width = safeNumber(entry.width)
      const height = safeNumber(entry.height)
      if (!node || width <= 0 || height <= 0) {
        return
      }
      const ctx = node.getContext('2d')
      if (!ctx) {
        return
      }
      const dpr = pixelRatio()
      node.width = Math.max(1, Math.round(width * dpr))
      node.height = Math.max(1, Math.round(height * dpr))
      runtime.chartNode = node
      runtime.chartCtx = ctx
      runtime.chartWidth = width
      runtime.chartHeight = height
      runtime.chartDpr = dpr
      runtime.chartReady = true
      this.setData({
        chartCanvasMounted: true,
        chartReady: true,
        chartPxW: Math.round(width),
        chartPxH: Math.round(height),
      }, () => {
        this.drawCharts()
      })
    }, 0, () => {
      runtime.chartUnsupported = true
      runtime.chartReady = false
      this.setData({ chartCanvasMounted: false, chartReady: false, chartPxW: 0, chartPxH: 0 })
    })
  },

  queryHourly(): void {
    const runtime = this as unknown as WeatherPageRuntime
    if (runtime.hourlyReady) {
      this.setData({ hourlyCanvasMounted: true, hourlyReady: true })
      this.drawCharts()
      return
    }
    this.queryCanvas('#weather-hourly', (entry) => {
      const node = entry.node as unknown as ChartCanvasNode
      const width = safeNumber(entry.width)
      const height = safeNumber(entry.height)
      if (!node || width <= 0 || height <= 0) {
        return
      }
      const ctx = node.getContext('2d')
      if (!ctx) {
        return
      }
      const dpr = pixelRatio()
      node.width = Math.max(1, Math.round(width * dpr))
      node.height = Math.max(1, Math.round(height * dpr))
      runtime.hourlyNode = node
      runtime.hourlyCtx = ctx
      runtime.hourlyWidth = width
      runtime.hourlyHeight = height
      runtime.hourlyDpr = dpr
      runtime.hourlyReady = true
      this.setData({
        hourlyCanvasMounted: true,
        hourlyReady: true,
        hourlyPxW: Math.round(width),
        hourlyPxH: Math.round(height),
      }, () => {
        this.drawCharts()
      })
    }, 0, () => {
      runtime.hourlyUnsupported = true
      runtime.hourlyReady = false
      this.setData({ hourlyCanvasMounted: false, hourlyReady: false, hourlyPxW: 0, hourlyPxH: 0 })
    })
  },

  drawCharts(): void {
    const runtime = this as unknown as WeatherPageRuntime
    if (runtime.destroyed) {
      return
    }
    if (runtime.chartCtx && this.data.forecastDays.length > 0) {
      runtime.chartCtx.setTransform(runtime.chartDpr, 0, 0, runtime.chartDpr, 0, 0)
      drawForecastChart(
        runtime.chartCtx,
        runtime.chartWidth,
        runtime.chartHeight,
        this.data.forecastDays,
        uiStore.resolvedTheme,
      )
    }
    if (runtime.hourlyCtx && this.data.hourlyPoints.length > 0) {
      runtime.hourlyCtx.setTransform(runtime.hourlyDpr, 0, 0, runtime.hourlyDpr, 0, 0)
      drawHourlyChart(
        runtime.hourlyCtx,
        runtime.hourlyWidth,
        runtime.hourlyHeight,
        this.data.hourlyPoints,
        uiStore.resolvedTheme,
      )
    }
  },

  toast(message: string, type: ToastType = 'info', placement: 'top' | 'bottom' = 'top'): void {
    showGlassToast({ message, type, placement })
  },
})
