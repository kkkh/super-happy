/* ==========================================================================
   和风天气 · 主屏组件
   - 页面仅保留分享与 Workflow 外壳，全部 UI / 数据编排在本组件
   - 7 个 Tab：总览 / 逐小时 / 每日 / 空气 / 指数 / 天文 / 时光机
   - 覆盖已开通 8 组 API 的全部 27 个端点，并提供 API 覆盖自检抽屉
   ========================================================================== */

import { createStoreBindings } from 'mobx-miniprogram-bindings'
import { uiStore } from '../../../../core/stores/ui'
import { fontScaleClass, syncFontScaleClass } from '../../../../core/services/font-scale'
import { showGlassToast } from '../../../../components/glass-toast/toast'
import { tapTick } from '../../../../core/utils/haptics'
import { describeQWeatherError, QWeatherError, qweatherAuthMode } from '../../lib/qweather/client'
import {
  cityFromPoint,
  cityToQw,
  cityToken,
  readCurrentQwCity,
  readQwCities,
  removeQwCity,
  upsertQwCity,
} from '../../lib/qweather/city'
import { getFuzzyLocation, openFuzzySetting, type QwLocationFailure } from '../../lib/qweather/location'
import { clearLegacyQwCache, clearQwCacheForCity } from '../../lib/qweather/cache'
import { dateKeyForOffset, monthDayText } from '../../lib/qweather/date'
import { qweatherService } from '../../lib/qweather/service'
import type { QwRequestSpec } from '../../lib/qweather/endpoints'
import type {
  QwAirView,
  QwAlertView,
  QwCity,
  QwCurrentView,
  QwDailyRange,
  QwDailyView,
  QwEndpointView,
  QwGeoItem,
  QwHistoryView,
  QwHourlyRange,
  QwHourlyView,
  QwIndicesView,
  QwMinutelyView,
  QwMoonView,
  QwSolarView,
  QwSunView,
} from '../../lib/qweather/types'
import { QWEATHER_HOST } from '../../config-local'

interface QwTab {
  key: string
  label: string
}

interface QwDateOption {
  date: string
  label: string
}

interface QwPageRuntime {
  destroyed: boolean
  busy: Record<string, boolean>
  seq: Record<string, number>
  /** 切城代数：丢弃上一城市的迟到响应，避免覆盖新城市数据 */
  generation: number
  /** 城市选择代数：景点解析 parentId 期间用户再次选城时丢弃旧选择 */
  selectionSeq: number
  /** 加载中再次切换范围时排队，当前请求结束后自动补拉 */
  pendingHourly: QwHourlyRange | null
  pendingDaily: QwDailyRange | null
  pendingIndices: 1 | 3 | null
  specs: QwRequestSpec[]
  themeBindings: { destroyStoreBindings: () => void } | null
  lastLoadAt: number
  endpointRunId: number
}

const TABS: QwTab[] = [
  { key: 'overview', label: '总览' },
  { key: 'hourly', label: '逐小时' },
  { key: 'daily', label: '每日' },
  { key: 'air', label: '空气' },
  { key: 'indices', label: '指数' },
  { key: 'astronomy', label: '天文' },
  { key: 'history', label: '时光机' },
]

const DEFAULT_CITY: QwCity = {
  id: '101010100',
  name: '北京',
  adm1: '北京市',
  adm2: '北京',
  country: '中国',
  lat: 39.9,
  lon: 116.41,
  tz: 'Asia/Shanghai',
  utcOffset: '+08:00',
  source: 'top',
}

const EMPTY_LOADING = {
  overview: false,
  current: false,
  daily: false,
  hourly: false,
  minutely: false,
  alerts: false,
  air: false,
  overviewIndices: false,
  indices: false,
  astronomy: false,
  history: false,
}

const EMPTY_ERRORS = {
  overview: '',
  current: '',
  daily: '',
  hourly: '',
  minutely: '',
  alerts: '',
  air: '',
  overviewIndices: '',
  indices: '',
  astronomy: '',
  history: '',
}

function buildAstroDates(utcOffset?: string, now = Date.now()): QwDateOption[] {
  const list: QwDateOption[] = []
  for (let index = 0; index < 7; index += 1) {
    const date = dateKeyForOffset(utcOffset, index, now)
    const label =
      index === 0
        ? '今天'
        : index === 1
          ? '明天'
          : index === 2
            ? '后天'
            : monthDayText(date)
    list.push({ date, label })
  }
  return list
}

function buildHistoryQuick(utcOffset?: string, now = Date.now()): QwDateOption[] {
  return [1, 2, 3, 5, 7, 10].map((days) => ({
    date: dateKeyForOffset(utcOffset, -days, now),
    label: days === 1 ? '昨天' : days === 2 ? '前天' : `${days} 天前`,
  }))
}

/** 城市切换时同步重建天文 / 时光机日期窗口，避免沿用上一城市时区 */
function cityDateState(city: QwCity | null): Record<string, unknown> {
  const offset = city ? city.utcOffset : ''
  const now = Date.now()
  const astroDates = buildAstroDates(offset, now)
  const historyQuick = buildHistoryQuick(offset, now)
  return {
    astroDates,
    astroDate: astroDates[0] ? astroDates[0].date : '',
    historyQuick,
    historyDate: dateKeyForOffset(offset, -1, now),
    historyMin: dateKeyForOffset(offset, -10, now),
    historyMax: dateKeyForOffset(offset, -1, now),
  }
}

function toast(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'success'): void {
  showGlassToast({ message, type })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

Component({
  options: {
    virtualHost: true,
    styleIsolation: 'isolated',
  },

  data: {
    themeClass: '',
    fsClass: fontScaleClass(),
    navTopPx: 52,
    navRowHeightPx: 44,
    navRightInsetPx: 112,

    tabs: TABS,
    tab: 'overview',

    city: null as QwCity | null,
    cities: [] as QwCity[],
    locating: false,
    locationNotice: '',
    locationReason: '',
    locationActionText: '开启定位',

    current: null as QwCurrentView | null,
    daily: [] as QwDailyView[],
    dailyRange: 10 as QwDailyRange,
    hourly: [] as QwHourlyView[],
    hourlyRange: 24 as QwHourlyRange,
    minutely: null as QwMinutelyView | null,
    alerts: [] as QwAlertView[],
    air: null as QwAirView | null,
    overviewIndices: [] as QwIndicesView[],
    indices: [] as QwIndicesView[],
    indicesRange: 3 as 1 | 3,
    sun: null as QwSunView | null,
    moon: null as QwMoonView | null,
    solar: null as QwSolarView | null,
    astroDates: [] as QwDateOption[],
    astroDate: '',
    astroTime: '12:00',
    astroAltitude: 0,
    history: null as QwHistoryView | null,
    historyDate: '',
    historyMin: '',
    historyMax: '',
    historyQuick: [] as QwDateOption[],

    loading: { ...EMPTY_LOADING },
    errors: { ...EMPTY_ERRORS },
    fromCache: false,
    refreshing: false,
    contentScrollTop: 0.001,
    scrollIntoView: '',
    updatedText: '',
    weatherSummary: '',

    citySheetShow: false,
    apiSheetShow: false,
    endpoints: [] as QwEndpointView[],
    endpointRunning: false,
    endpointProgress: '',
    host: QWEATHER_HOST ? QWEATHER_HOST.replace(/^[^.]+/, '***') : '未配置',
    auth: qweatherAuthMode(),
  },

  lifetimes: {
    attached() {
      const runtime = this as unknown as QwPageRuntime
      runtime.destroyed = false
      runtime.busy = {}
      runtime.seq = {}
      runtime.generation = 0
      runtime.selectionSeq = 0
      runtime.pendingHourly = null
      runtime.pendingDaily = null
      runtime.pendingIndices = null
      runtime.specs = []
      runtime.themeBindings = null
      runtime.lastLoadAt = 0
      runtime.endpointRunId = 0

      /* v1 → v2 缓存升级：旧键只清理，不做数据迁移 */
      clearLegacyQwCache()

      this.setData({
        themeClass: uiStore.themeClass,
        fsClass: fontScaleClass(),
        ...cityDateState(null),
      })

      runtime.themeBindings = createStoreBindings(this, {
        store: uiStore,
        fields: {
          themeClass: () => uiStore.themeClass,
        },
        actions: [],
      })

      this.measureNavBar()

      const cities = readQwCities()
      const current = readCurrentQwCity()
      this.setData({ cities })
      if (current) {
        this.boot(current)
      } else {
        void this.autoLocate()
      }
    },

    detached() {
      const runtime = this as unknown as QwPageRuntime
      runtime.destroyed = true
      qweatherService.abortAll()
      if (runtime.themeBindings) {
        runtime.themeBindings.destroyStoreBindings()
        runtime.themeBindings = null
      }
    },
  },

  pageLifetimes: {
    show() {
      uiStore.syncNativeChrome()
      const fsClass = syncFontScaleClass()
      if (fsClass !== this.data.fsClass) {
        this.setData({ fsClass })
      }
      const dateState = this.syncDateOptions()
      const runtime = this as unknown as QwPageRuntime
      const stale =
        Boolean(this.data.city) &&
        Boolean(this.data.current) &&
        runtime.lastLoadAt > 0 &&
        Date.now() - runtime.lastLoadAt > 10 * 60 * 1000
      if (stale) {
        void this.refreshAll()
        return
      }
      if (this.data.city) {
        if (dateState.astroReload && this.data.tab === 'astronomy') {
          void this.loadAstronomy()
        }
        if (dateState.historyReload && this.data.tab === 'history') {
          void this.loadHistory(this.data.historyDate)
        }
      }
    },

    resize() {
      this.measureNavBar()
    },
  },

  methods: {
    /* ---- 导航栏安全区 ---- */

    /** 跨零点后重建天文 / 时光机日期范围，并标记需要重新拉取的区块 */
    syncDateOptions(): { astroReload: boolean; historyReload: boolean } {
      const offset = this.data.city ? this.data.city.utcOffset : ''
      const now = Date.now()
      const astroDates = buildAstroDates(offset, now)
      const historyQuick = buildHistoryQuick(offset, now)
      const historyMax = dateKeyForOffset(offset, -1, now)
      const historyMin = dateKeyForOffset(offset, -10, now)
      const patch: Record<string, unknown> = {}
      let astroReload = false
      let historyReload = false
      if (astroDates[0] && astroDates[0].date !== (this.data.astroDates as QwDateOption[])[0]?.date) {
        patch.astroDates = astroDates
        const current = String(this.data.astroDate || '')
        if (!astroDates.some((item) => item.date === current)) {
          patch.astroDate = astroDates[0].date
          patch.sun = null
          patch.moon = null
          patch.solar = null
          astroReload = true
        }
      }
      if (historyQuick[0] && historyQuick[0].date !== (this.data.historyQuick as QwDateOption[])[0]?.date) {
        patch.historyQuick = historyQuick
      }
      if (historyMax !== this.data.historyMax) {
        patch.historyMax = historyMax
        if (!this.data.historyDate || String(this.data.historyDate) > historyMax) {
          patch.historyDate = historyMax
          patch.history = null
          historyReload = true
        }
      }
      if (historyMin !== this.data.historyMin) {
        patch.historyMin = historyMin
        if (this.data.historyDate && String(this.data.historyDate) < historyMin) {
          patch.historyDate = historyMin
          patch.history = null
          historyReload = true
        }
      }
      if (Object.keys(patch).length) {
        this.setData(patch)
      }
      return { astroReload, historyReload }
    },

    measureNavBar() {
      let windowWidth = 375
      let statusBarHeight = 20
      try {
        const info = wx.getWindowInfo()
        windowWidth = Number(info && info.windowWidth) || 375
        statusBarHeight = Math.max(0, Number(info && info.statusBarHeight) || 20)
      } catch {
        /* 保守回退 */
      }

      let capsuleTop = 0
      let capsuleHeight = 0
      let capsuleLeft = 0
      try {
        const rect = wx.getMenuButtonBoundingClientRect()
        capsuleTop = Number(rect && rect.top) || 0
        capsuleHeight = Number(rect && rect.height) || 0
        capsuleLeft = Number(rect && rect.left) || 0
      } catch {
        /* 开发者工具异常 */
      }

      const hasCapsule = capsuleTop > 0 && capsuleHeight > 0 && capsuleLeft > 0
      const rowHeight = Math.max(44, hasCapsule ? Math.round(capsuleHeight + 8) : 44)
      const navTop = hasCapsule
        ? Math.max(Math.round(statusBarHeight), Math.round(capsuleTop - (rowHeight - capsuleHeight) / 2))
        : Math.max(Math.round(statusBarHeight + 6), 44)
      const rightInset = hasCapsule ? Math.max(0, Math.round(windowWidth - capsuleLeft + 8)) : 112

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

    /* ---- 加载状态 ---- */

    begin(key: string): boolean {
      const runtime = this as unknown as QwPageRuntime
      if (runtime.destroyed || runtime.busy[key]) {
        return false
      }
      runtime.busy[key] = true
      const patch: Record<string, unknown> = {}
      patch[`loading.${key}`] = true
      patch[`errors.${key}`] = ''
      this.setData(patch)
      return true
    },

    end(key: string): void {
      const runtime = this as unknown as QwPageRuntime
      runtime.busy[key] = false
      if (runtime.destroyed) {
        return
      }
      const patch: Record<string, unknown> = {}
      patch[`loading.${key}`] = false
      this.setData(patch)
    },

    setError(key: string, message: string): void {
      const patch: Record<string, unknown> = {}
      patch[`errors.${key}`] = message
      this.setData(patch)
    },

    reportError(key: string, error: unknown): void {
      if (error instanceof QWeatherError && error.kind === 'cancelled') {
        return
      }
      const message = describeQWeatherError(error)
      this.setError(
        key,
        /重试|重新生成|合法域名/.test(message) ? message : `${message}（下拉刷新可重试）`,
      )
    },

    /* ---- 城市 ---- */

    boot(city: QwCity): void {
      this.setData({ city, ...cityDateState(city) })
      void this.loadOverview()
    },

    applyCity(city: QwCity, persist = true): void {
      const runtime = this as unknown as QwPageRuntime
      if (runtime.destroyed) {
        return
      }
      /* 所有切城入口共享同一选择代数：使景点 parentId 解析等异步旧选择失效 */
      runtime.selectionSeq += 1
      if (persist) {
        const cities = upsertQwCity(city)
        this.setData({ cities })
      }
      qweatherService.abortAll()
      runtime.generation += 1
      /* abortAll 后旧请求的 finally 可能晚于新请求执行：直接清空忙状态，保证切城必定重新拉取 */
      runtime.busy = {}
      runtime.endpointRunId += 1
      runtime.seq = {}
      runtime.pendingHourly = null
      runtime.pendingDaily = null
      runtime.pendingIndices = null
      this.setData({
        city,
        citySheetShow: false,
        tab: 'overview',
        contentScrollTop: this.data.contentScrollTop === 0.001 ? 0 : 0.001,
        current: null,
        daily: [],
        hourly: [],
        minutely: null,
        alerts: [],
        air: null,
        overviewIndices: [],
        indices: [],
        sun: null,
        moon: null,
        solar: null,
        astroAltitude: 0,
        history: null,
        fromCache: false,
        updatedText: '',
        weatherSummary: '',
        locationNotice: '',
        endpoints: [],
        endpointRunning: false,
        endpointProgress: '',
        loading: { ...EMPTY_LOADING },
        errors: { ...EMPTY_ERRORS },
        ...cityDateState(city),
      })
      this.triggerEvent('summary', { text: '' })
      this.notifySheetState()
      void this.loadOverview()
    },

    async autoLocate(): Promise<void> {
      const runtime = this as unknown as QwPageRuntime
      if (runtime.destroyed || this.data.locating) {
        return
      }
      const selection = runtime.selectionSeq
      this.setData({ locating: true })
      try {
        const result = await getFuzzyLocation()
        if (runtime.destroyed) {
          return
        }
        if (result.ok) {
          const city = await cityFromPoint(result.lat, result.lon)
          if (runtime.destroyed) {
            return
          }
          /* 定位期间用户已手选城市：丢弃本次定位结果，避免覆盖选择 */
          if (runtime.selectionSeq !== selection) {
            this.setData({ locating: false })
            return
          }
          if (city) {
            this.setData({ locating: false })
            this.applyCity(city, true)
            toast(`已定位到 ${city.name}`, 'success')
            return
          }
        }
        this.setData({ locating: false })
        this.useFallback(result.ok ? 'failed' : result.reason)
      } catch {
        if (runtime.destroyed) {
          return
        }
        this.setData({ locating: false })
        this.useFallback('failed')
      }
    },

    useFallback(reason: QwLocationFailure): void {
      const hasCity = Boolean(this.data.city)
      const suffix = hasCity ? '当前显示已选城市' : '已显示默认城市'
      const notices: Record<string, string> = {
        denied: `模糊定位权限已关闭，${suffix}；点「开启定位」可重新授权`,
        privacy: `需同意隐私保护指引后才能定位，${suffix}`,
        unavailable: `当前微信版本或运行环境不支持模糊定位，${suffix}`,
        failed: `定位失败，${suffix}；可搜索城市或重试定位`,
      }
      const notice = notices[reason] || notices.failed
      const actionText = reason === 'denied' || reason === 'privacy' ? '开启定位' : '重试定位'
      if (!this.data.city) {
        /* 走统一切城入口：中止旧请求、推进代数、清理旧数据并重建日期窗口 */
        this.applyCity(DEFAULT_CITY, true)
        this.setData({
          locationNotice: notice,
          locationReason: reason,
          locationActionText: actionText,
        })
        return
      }
      this.setData({
        locationNotice: notice,
        locationReason: reason,
        locationActionText: actionText,
      })
    },

    async onLocationAction(): Promise<void> {
      tapTick()
      this.setData({ citySheetShow: false })
      if (this.data.locationReason === 'denied') {
        await openFuzzySetting()
      }
      await this.autoLocate()
    },

    onCityOpen(): void {
      tapTick()
      this.setData({ citySheetShow: true })
      this.notifySheetState()
    },

    onCityClose(): void {
      this.setData({ citySheetShow: false })
      this.notifySheetState()
    },

    async onCitySelect(event: WechatMiniprogram.CustomEvent<{ item?: QwGeoItem }>): Promise<void> {
      const item = event.detail && event.detail.item
      if (!item) {
        return
      }
      tapTick()
      const runtime = this as unknown as QwPageRuntime
      runtime.selectionSeq += 1
      const selection = runtime.selectionSeq
      const city = cityToQw(item)
      /* 景点 POI 的 ID 不能被时光机接受，解析其所属城市 ID */
      if (city.source === 'poi' && !city.parentId) {
        try {
          const parent = await cityFromPoint(city.lat, city.lon)
          if (parent && parent.id) {
            city.parentId = parent.id
          }
        } catch {
          /* 解析失败时仍允许使用景点天气，时光机会给出接口错误 */
        }
      }
      /* 解析期间用户又选了别的城市：丢弃这次迟到的选择 */
      if (runtime.destroyed || runtime.selectionSeq !== selection) {
        return
      }
      const exists = (this.data.cities as QwCity[]).some(
        (entry) => cityToken(entry) === cityToken(city),
      )
      if (!exists && (this.data.cities as QwCity[]).length >= 5) {
        toast('最多保存 5 个城市，已替换最早保存的城市', 'warning')
      }
      this.applyCity(city, true)
    },

    onCitySelectSaved(event: WechatMiniprogram.CustomEvent<{ index?: number }>): void {
      const index = Number(event.detail && event.detail.index)
      const city = (this.data.cities as QwCity[])[index]
      if (!city) {
        return
      }
      tapTick()
      this.applyCity(city, true)
    },

    onCityRemove(event: WechatMiniprogram.CustomEvent<{ token?: string }>): void {
      const token = String((event.detail && event.detail.token) || '')
      const target = (this.data.cities as QwCity[]).find((city) => cityToken(city) === token)
      if (!target) {
        return
      }
      tapTick()
      /* 移除城市时同步删除该城市缓存，与 legal 页说明一致 */
      clearQwCacheForCity(token)
      removeQwCity(target)
      const next = readQwCities()
      this.setData({ cities: next })
      if (this.data.city && cityToken(this.data.city) === token) {
        if (next.length) {
          this.applyCity(next[0], false)
        } else {
          /* 删除最后一个城市：走统一切城入口，清空旧城市数据并重新定位；默认城市不写回已保存列表 */
          this.applyCity(DEFAULT_CITY, false)
          this.setData({
            locationNotice: '已移除最后一个城市，当前显示默认城市；可重新定位或搜索城市',
            locationReason: 'failed',
            locationActionText: '重试定位',
          })
          void this.autoLocate()
        }
      }
      toast(`已移除 ${target.name}`, 'success')
    },

    /* ---- 数据加载 ---- */

    async loadOverview(force = false): Promise<void> {
      const runtime = this as unknown as QwPageRuntime
      const city = this.data.city
      if (!city || !this.begin('overview')) {
        return
      }
      const generation = runtime.generation
      try {
        await Promise.all([
          this.loadCurrent(force),
          this.loadDaily(this.data.dailyRange, force),
          this.loadMinutely(force),
          this.loadAlerts(force),
          this.loadAir(force),
          this.loadIndices(1, 'overviewIndices', force),
        ])
      } finally {
        if (runtime.generation === generation) {
          this.end('overview')
        }
      }
    },

    async loadCurrent(force = false): Promise<void> {
      const runtime = this as unknown as QwPageRuntime
      const city = this.data.city
      if (!city || !this.begin('current')) {
        return
      }
      const generation = runtime.generation
      try {
        const result = await qweatherService.loadCurrent(city, force)
        if (runtime.destroyed || runtime.generation !== generation) {
          return
        }
        this.setData({
          current: result.data,
          fromCache: result.fromCache,
          updatedText: result.data.validTimeText,
        })
        runtime.lastLoadAt = Date.now()
        this.updateSummary()
      } catch (error) {
        if (!runtime.destroyed && runtime.generation === generation) {
          this.reportError('current', error)
        }
      } finally {
        if (runtime.generation === generation) {
          this.end('current')
        }
      }
    },

    async loadDaily(range: QwDailyRange, force = false): Promise<void> {
      const runtime = this as unknown as QwPageRuntime
      const city = this.data.city
      if (!city || !this.begin('daily')) {
        return
      }
      const generation = runtime.generation
      try {
        const result = await qweatherService.loadDaily(city, range, force)
        if (runtime.destroyed || runtime.generation !== generation) {
          return
        }
        /* 旧范围请求晚到：只丢弃数据，不覆盖用户刚选的新范围 */
        if (range !== this.data.dailyRange) {
          return
        }
        this.setData({ daily: result.data.days, dailyRange: range })
      } catch (error) {
        if (!runtime.destroyed && runtime.generation === generation && range === this.data.dailyRange) {
          this.reportError('daily', error)
        }
      } finally {
        if (runtime.generation === generation) {
          this.end('daily')
          const pending = runtime.pendingDaily
          runtime.pendingDaily = null
          if (pending !== null && pending !== range) {
            void this.loadDaily(pending)
          }
        }
      }
    },

    async loadHourly(range: QwHourlyRange, force = false): Promise<void> {
      const runtime = this as unknown as QwPageRuntime
      const city = this.data.city
      if (!city || !this.begin('hourly')) {
        return
      }
      const generation = runtime.generation
      try {
        const result = await qweatherService.loadHourly(city, range, force)
        if (runtime.destroyed || runtime.generation !== generation) {
          return
        }
        /* 旧范围请求晚到：只丢弃数据，不覆盖用户刚选的新范围 */
        if (range !== this.data.hourlyRange) {
          return
        }
        this.setData({ hourly: result.data, hourlyRange: range })
      } catch (error) {
        if (!runtime.destroyed && runtime.generation === generation && range === this.data.hourlyRange) {
          this.reportError('hourly', error)
        }
      } finally {
        if (runtime.generation === generation) {
          this.end('hourly')
          const pending = runtime.pendingHourly
          runtime.pendingHourly = null
          if (pending !== null && pending !== range) {
            void this.loadHourly(pending)
          }
        }
      }
    },

    async loadMinutely(force = false): Promise<void> {
      const runtime = this as unknown as QwPageRuntime
      const city = this.data.city
      if (!city || !this.begin('minutely')) {
        return
      }
      const generation = runtime.generation
      try {
        const result = await qweatherService.loadMinutely(city, force)
        if (!runtime.destroyed && runtime.generation === generation) {
          this.setData({ minutely: result.data })
        }
      } catch (error) {
        if (!runtime.destroyed && runtime.generation === generation) {
          this.reportError('minutely', error)
        }
      } finally {
        if (runtime.generation === generation) {
          this.end('minutely')
        }
      }
    },

    async loadAlerts(force = false): Promise<void> {
      const runtime = this as unknown as QwPageRuntime
      const city = this.data.city
      if (!city || !this.begin('alerts')) {
        return
      }
      const generation = runtime.generation
      try {
        const result = await qweatherService.loadAlerts(city, force)
        if (!runtime.destroyed && runtime.generation === generation) {
          this.setData({ alerts: result.data })
        }
      } catch (error) {
        if (!runtime.destroyed && runtime.generation === generation) {
          this.reportError('alerts', error)
        }
      } finally {
        if (runtime.generation === generation) {
          this.end('alerts')
        }
      }
    },

    async loadAir(force = false): Promise<void> {
      const runtime = this as unknown as QwPageRuntime
      const city = this.data.city
      if (!city || !this.begin('air')) {
        return
      }
      const generation = runtime.generation
      try {
        const result = await qweatherService.loadAir(city, force)
        if (runtime.destroyed || runtime.generation !== generation) {
          return
        }
        const data = result.data
        this.setData({
          air: {
            ...data.current,
            hourly: data.hourly,
            daily: data.daily,
          },
        })
      } catch (error) {
        if (!runtime.destroyed && runtime.generation === generation) {
          this.reportError('air', error)
        }
      } finally {
        if (runtime.generation === generation) {
          this.end('air')
        }
      }
    },

    async loadIndices(days: 1 | 3, target: 'overviewIndices' | 'indices', force = false): Promise<void> {
      const runtime = this as unknown as QwPageRuntime
      const city = this.data.city
      if (!city || !this.begin(target)) {
        return
      }
      const generation = runtime.generation
      try {
        const result = await qweatherService.loadIndices(city, days, force)
        if (runtime.destroyed || runtime.generation !== generation) {
          return
        }
        if (target === 'indices') {
          if (days !== this.data.indicesRange) {
            return
          }
          this.setData({ indices: result.data })
        } else {
          this.setData({ overviewIndices: result.data })
        }
      } catch (error) {
        if (
          !runtime.destroyed &&
          runtime.generation === generation &&
          (target !== 'indices' || days === this.data.indicesRange)
        ) {
          this.reportError(target, error)
        }
      } finally {
        if (runtime.generation === generation) {
          this.end(target)
          if (target === 'indices') {
            const pending = runtime.pendingIndices
            runtime.pendingIndices = null
            if (pending !== null && pending !== days) {
              void this.loadIndices(pending, 'indices')
            }
          }
        }
      }
    },

    async loadAstronomy(force = false): Promise<void> {
      const runtime = this as unknown as QwPageRuntime
      const city = this.data.city
      if (!city) {
        return
      }
      /* 日期 / 时间 / 海拔可连续切换：先取消旧天文请求，再用序号 + 代数丢弃迟到响应 */
      qweatherService.abortPrefix('astro|')
      runtime.seq.astronomy = (runtime.seq.astronomy || 0) + 1
      const seq = runtime.seq.astronomy
      const generation = runtime.generation
      this.setData({ 'loading.astronomy': true, 'errors.astronomy': '' })
      const time = String(this.data.astroTime || '12:00').replace(':', '')
      const altitude = Number(this.data.astroAltitude) || 0
      try {
        const result = await qweatherService.loadAstronomy(
          city,
          this.data.astroDate,
          time || '1200',
          altitude,
          force,
        )
        if (
          runtime.destroyed ||
          runtime.generation !== generation ||
          runtime.seq.astronomy !== seq
        ) {
          return
        }
        this.setData({
          sun: result.data.sun,
          moon: result.data.moon,
          solar: result.data.solar,
        })
      } catch (error) {
        if (
          !runtime.destroyed &&
          runtime.generation === generation &&
          runtime.seq.astronomy === seq
        ) {
          this.reportError('astronomy', error)
        }
      } finally {
        if (
          !runtime.destroyed &&
          runtime.generation === generation &&
          runtime.seq.astronomy === seq
        ) {
          this.setData({ 'loading.astronomy': false })
        }
      }
    },

    async loadHistory(date: string, force = false): Promise<void> {
      const runtime = this as unknown as QwPageRuntime
      const city = this.data.city
      if (!city || !date) {
        return
      }
      qweatherService.abortPrefix('history|')
      runtime.seq.history = (runtime.seq.history || 0) + 1
      const seq = runtime.seq.history
      const generation = runtime.generation
      this.setData({ 'loading.history': true, 'errors.history': '' })
      try {
        const result = await qweatherService.loadHistory(city, date, force)
        if (
          runtime.destroyed ||
          runtime.generation !== generation ||
          runtime.seq.history !== seq
        ) {
          return
        }
        this.setData({ history: result.data })
      } catch (error) {
        if (
          !runtime.destroyed &&
          runtime.generation === generation &&
          runtime.seq.history === seq
        ) {
          this.reportError('history', error)
        }
      } finally {
        if (
          !runtime.destroyed &&
          runtime.generation === generation &&
          runtime.seq.history === seq
        ) {
          this.setData({ 'loading.history': false })
        }
      }
    },

    updateSummary(): void {
      const city = this.data.city
      const current = this.data.current
      if (!city || !current) {
        this.setData({ weatherSummary: '' })
        this.triggerEvent('summary', { text: '' })
        return
      }
      const weatherSummary = `${city.name} ${current.condition} ${current.tempText}，体感 ${current.feelsLikeText}，${current.wind.text}`
      this.setData({ weatherSummary })
      this.triggerEvent('summary', { text: weatherSummary })
    },

    /* ---- 交互 ---- */

    /** 通知页面壳：抽屉/自检打开时暂停全局更新弹窗 */
    notifySheetState(): void {
      this.triggerEvent('sheet', {
        blocked: Boolean(this.data.citySheetShow || this.data.apiSheetShow || this.data.endpointRunning),
      })
    },

    scrollToTop(): void {
      this.setData({
        contentScrollTop: this.data.contentScrollTop === 0.001 ? 0 : 0.001,
        scrollIntoView: '',
      })
    },

    onBackTap(): void {
      wx.navigateBack({
        delta: 1,
        fail: () => {
          wx.reLaunch({ url: '/pages/index/index' })
        },
      })
    },

    onTab(event: WechatMiniprogram.TouchEvent): void {
      const tab = String(event.currentTarget.dataset.tab || '')
      if (!tab || tab === this.data.tab) {
        return
      }
      tapTick()
      this.setData({ tab })
      this.scrollToTop()
      if (tab === 'astronomy' || tab === 'history') {
        this.syncDateOptions()
      }
      const errors = this.data.errors as Record<string, string>
      if (tab === 'hourly' && !this.data.hourly.length && !errors.hourly) {
        void this.loadHourly(this.data.hourlyRange)
      }
      if (tab === 'daily' && !this.data.daily.length && !errors.daily) {
        void this.loadDaily(this.data.dailyRange)
      }
      if (tab === 'air' && !this.data.air && !errors.air) {
        void this.loadAir()
      }
      if (tab === 'indices' && !this.data.indices.length && !errors.indices) {
        void this.loadIndices(this.data.indicesRange, 'indices')
      }
      if (tab === 'astronomy' && !this.data.sun && !errors.astronomy) {
        void this.loadAstronomy()
      }
      if (tab === 'history' && !this.data.history && !errors.history) {
        void this.loadHistory(this.data.historyDate)
      }
    },

    onHeroAir(): void {
      const errors = this.data.errors as Record<string, string>
      this.setData({ tab: 'air' })
      this.scrollToTop()
      if (!this.data.air && !errors.air) {
        void this.loadAir()
      }
    },

    onHeroAlert(): void {
      this.setData({ tab: 'overview', scrollIntoView: '' }, () => {
        this.setData({ scrollIntoView: 'qw-alerts' })
      })
    },

    onFlow(): void {
      tapTick()
      this.triggerEvent('flow')
    },

    onHourlyRange(event: WechatMiniprogram.CustomEvent<{ range: number }>): void {
      const range = Number(event.detail && event.detail.range) as QwHourlyRange
      if (![24, 72, 168, 240].includes(range) || range === this.data.hourlyRange) {
        return
      }
      const runtime = this as unknown as QwPageRuntime
      if (runtime.busy.hourly) {
        /* 当前请求结束后自动补拉，避免用户点选被丢弃 */
        runtime.pendingHourly = range
        this.setData({ hourlyRange: range, hourly: [] })
        this.scrollToTop()
        return
      }
      tapTick()
      this.setData({ hourlyRange: range, hourly: [] })
      void this.loadHourly(range)
    },

    onDailyRange(event: WechatMiniprogram.CustomEvent<{ range: number }>): void {
      const range = Number(event.detail && event.detail.range) as QwDailyRange
      if (![3, 7, 10, 15, 30].includes(range) || range === this.data.dailyRange) {
        return
      }
      const runtime = this as unknown as QwPageRuntime
      if (runtime.busy.daily) {
        runtime.pendingDaily = range
        this.setData({ dailyRange: range, daily: [] })
        this.scrollToTop()
        return
      }
      tapTick()
      this.setData({ dailyRange: range, daily: [] })
      void this.loadDaily(range)
    },

    onIndicesRange(event: WechatMiniprogram.CustomEvent<{ range: number }>): void {
      const range = Number(event.detail && event.detail.range)
      if ((range !== 1 && range !== 3) || range === this.data.indicesRange) {
        return
      }
      const runtime = this as unknown as QwPageRuntime
      if (runtime.busy.indices) {
        runtime.pendingIndices = range as 1 | 3
        this.setData({ indicesRange: range as 1 | 3, indices: [] })
        return
      }
      tapTick()
      this.setData({ indicesRange: range as 1 | 3, indices: [] })
      void this.loadIndices(range as 1 | 3, 'indices')
    },

    onAstroDate(event: WechatMiniprogram.CustomEvent<{ date: string }>): void {
      const date = String((event.detail && event.detail.date) || '')
      if (!date || date === this.data.astroDate) {
        return
      }
      tapTick()
      this.setData({ astroDate: date })
      void this.loadAstronomy()
    },

    onAstroTime(event: WechatMiniprogram.CustomEvent<{ time: string }>): void {
      const time = String((event.detail && event.detail.time) || '')
      if (!time || time === this.data.astroTime) {
        return
      }
      this.setData({ astroTime: time })
      void this.loadAstronomy()
    },

    onAstroAlt(event: WechatMiniprogram.CustomEvent<{ altitude: number }>): void {
      const altitude = Number(event.detail && event.detail.altitude)
      if (!Number.isFinite(altitude) || altitude === this.data.astroAltitude) {
        return
      }
      this.setData({ astroAltitude: altitude })
      void this.loadAstronomy()
    },

    onHistoryDate(event: WechatMiniprogram.CustomEvent<{ date: string }>): void {
      const date = String((event.detail && event.detail.date) || '')
      if (!date || date === this.data.historyDate) {
        return
      }
      tapTick()
      this.setData({ historyDate: date })
      void this.loadHistory(date)
    },

    onRefresh(): void {
      void this.refreshAll()
    },

    onRefresherRefresh(): void {
      void this.refreshAll()
    },

    async refreshAll(): Promise<void> {
      const runtime = this as unknown as QwPageRuntime
      if (runtime.destroyed || this.data.refreshing) {
        return
      }
      if (this.data.endpointRunning) {
        this.setData({ refreshing: false })
        toast('API 自检进行中，请完成后再刷新', 'warning')
        return
      }
      const city = this.data.city
      if (!city) {
        this.setData({ refreshing: false })
        void this.autoLocate()
        return
      }
      tapTick()
      this.setData({ refreshing: true })
      clearQwCacheForCity(cityToken(city))
      /* 显式刷新必须立即生效：中止旧请求并推进代数，避免 begin 被上一次加载挡住 */
      qweatherService.abortAll()
      runtime.generation += 1
      runtime.busy = {}
      runtime.seq = {}
      this.setData({ loading: { ...EMPTY_LOADING } })
      try {
        await this.loadOverview(true)
        const tab = String(this.data.tab)
        if (tab === 'hourly') {
          await this.loadHourly(this.data.hourlyRange, true)
        } else if (tab === 'indices') {
          /* 每日 / 空气已由 loadOverview 按当前范围刷新，无需重复请求 */
          await this.loadIndices(this.data.indicesRange, 'indices', true)
        } else if (tab === 'astronomy') {
          await this.loadAstronomy(true)
        } else if (tab === 'history') {
          await this.loadHistory(this.data.historyDate, true)
        }
      } finally {
        if (!runtime.destroyed) {
          this.setData({ refreshing: false })
        }
      }
    },

    /* ---- API 覆盖自检 ---- */

    async onApiOpen(): Promise<void> {
      const selected = this.data.city
      if (!selected) {
        toast('请先选择城市', 'warning')
        return
      }
      /* 测试进行中重新打开：保留进度，不重置列表 */
      if (this.data.endpointRunning) {
        this.setData({ apiSheetShow: true })
        this.notifySheetState()
        return
      }
      const runtime = this as unknown as QwPageRuntime
      let city = selected
      if (city.source === 'poi' && !city.parentId) {
        try {
          const parent = await cityFromPoint(city.lat, city.lon)
          if (parent && parent.id) {
            city = { ...city, parentId: parent.id }
          }
        } catch {
          /* 无法解析所属城市时，时光机变体会在自检中如实报错 */
        }
      }
      if (runtime.destroyed || !this.data.city || cityToken(this.data.city) !== cityToken(selected)) {
        return
      }
      runtime.specs = qweatherService.catalog(city)
      this.setData({
        apiSheetShow: true,
        endpointProgress: '',
        endpoints: runtime.specs.map(
          (spec): QwEndpointView => ({
            key: spec.key,
            label: spec.label,
            group: spec.group,
            description: spec.description,
            status: 'idle',
            latency: 0,
            count: 0,
            error: '',
          }),
        ),
      })
      this.notifySheetState()
    },

    onApiClose(): void {
      /* 允许中途关闭；测试继续，重新打开时保留进度 */
      this.setData({ apiSheetShow: false })
      this.notifySheetState()
    },

    patchEndpoint(key: string, patch: Partial<QwEndpointView>): void {
      const list = (this.data.endpoints as QwEndpointView[]).map((item) =>
        item.key === key ? { ...item, ...patch } : item,
      )
      this.setData({ endpoints: list })
    },

    async onEndpointRun(event: WechatMiniprogram.CustomEvent<{ key?: string }>): Promise<void> {
      if (this.data.endpointRunning) {
        return
      }
      const key = String((event.detail && event.detail.key) || '')
      const runtime = this as unknown as QwPageRuntime
      const spec = runtime.specs.find((item) => item.key === key)
      if (!spec) {
        return
      }
      this.setData({ endpointRunning: true, endpointProgress: `正在测试 ${spec.label}` })
      this.notifySheetState()
      this.patchEndpoint(key, { status: 'loading', error: '' })
      const runId = runtime.endpointRunId
      const result = await qweatherService.runEndpoint(spec)
      if (runtime.destroyed || runtime.endpointRunId !== runId) {
        return
      }
      this.patchEndpoint(key, {
        status: result.ok ? 'ok' : 'error',
        latency: result.latency,
        count: result.count,
        error: result.error,
      })
      this.setData({
        endpointRunning: false,
        endpointProgress: result.ok ? `${spec.label} 通过 · ${result.latency}ms` : `${spec.label} 失败`,
      })
      this.notifySheetState()
    },

    async onEndpointRunAll(): Promise<void> {
      const runtime = this as unknown as QwPageRuntime
      if (this.data.endpointRunning || !runtime.specs.length) {
        return
      }
      this.setData({ endpointRunning: true })
      this.notifySheetState()
      const started = Date.now()
      const specs = runtime.specs
      const runId = runtime.endpointRunId + 1
      runtime.endpointRunId = runId
      for (let index = 0; index < specs.length; index += 1) {
        if (runtime.destroyed || runtime.endpointRunId !== runId) {
          break
        }
        const spec = specs[index]
        this.setData({
          endpointProgress: `正在测试 ${index + 1}/${specs.length} · ${spec.label}`,
        })
        this.patchEndpoint(spec.key, { status: 'loading', error: '' })
        const result = await qweatherService.runEndpoint(spec)
        if (runtime.destroyed || runtime.endpointRunId !== runId) {
          break
        }
        this.patchEndpoint(spec.key, {
          status: result.ok ? 'ok' : 'error',
          latency: result.latency,
          count: result.count,
          error: result.error,
        })
        /* 官方按 API 限 QPM；逐个测试保持约 1 秒间隔，避免自检本身触发 429 */
        if (index < specs.length - 1) {
          await delay(1100)
        }
      }
      if (runtime.destroyed || runtime.endpointRunId !== runId) {
        return
      }
      const list = this.data.endpoints as QwEndpointView[]
      const ok = list.filter((item) => item.status === 'ok').length
      const seconds = ((Date.now() - started) / 1000).toFixed(1)
      this.setData({
        endpointRunning: false,
        endpointProgress: `完成 ${ok}/${list.length} · 耗时 ${seconds}s`,
      })
      this.notifySheetState()
      if (ok === list.length && list.length > 0) {
        toast('全部端点调用成功', 'success')
      } else {
        toast(`有 ${list.length - ok} 个端点失败，可查看错误详情`, 'warning')
      }
    },

    onEndpointReset(): void {
      if (this.data.endpointRunning) {
        return
      }
      const list = (this.data.endpoints as QwEndpointView[]).map(
        (item): QwEndpointView => ({
          ...item,
          status: 'idle',
          latency: 0,
          count: 0,
          error: '',
        }),
      )
      this.setData({ endpoints: list, endpointProgress: '' })
    },

  },
})
