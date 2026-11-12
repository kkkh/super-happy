/* ==========================================================================
   和风天气 · 主屏组件
   - 页面仅保留分享与 Workflow 外壳，全部 UI / 数据编排在本组件
   - 7 个 Tab：总览 / 逐小时 / 每日 / 空气 / 指数 / 天文 / 时光机
   - 覆盖已开通 8 组 API 的全部 27 个端点，并提供 API 覆盖自检抽屉
   ========================================================================== */

import { createStoreBindings } from 'mobx-miniprogram-bindings'
import { uiStore } from '../../../../core/stores/ui'
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
import { clearQwCacheForCity } from '../../lib/qweather/cache'
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

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function ymd(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function offsetDate(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return ymd(date)
}

function buildAstroDates(): QwDateOption[] {
  const list: QwDateOption[] = []
  for (let index = 0; index < 7; index += 1) {
    const date = new Date()
    date.setDate(date.getDate() + index)
    const label =
      index === 0
        ? '今天'
        : index === 1
          ? '明天'
          : index === 2
            ? '后天'
            : `${date.getMonth() + 1}/${date.getDate()}`
    list.push({ date: ymd(date), label })
  }
  return list
}

function buildHistoryQuick(): QwDateOption[] {
  return [1, 2, 3, 5, 7, 10].map((days) => ({
    date: offsetDate(-days),
    label: days === 1 ? '昨天' : days === 2 ? '前天' : `${days} 天前`,
  }))
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
    navTopPx: 52,
    navRowHeightPx: 44,
    navRightInsetPx: 112,

    tabs: TABS,
    tab: 'overview',

    city: null as QwCity | null,
    cities: [] as QwCity[],
    cityCountText: '',
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
    host: QWEATHER_HOST,
    auth: qweatherAuthMode(),
  },

  lifetimes: {
    attached() {
      const runtime = this as unknown as QwPageRuntime
      runtime.destroyed = false
      runtime.busy = {}
      runtime.seq = {}
      runtime.specs = []
      runtime.themeBindings = null
      runtime.lastLoadAt = 0
      runtime.endpointRunId = 0

      this.setData({
        themeClass: uiStore.themeClass,
        astroDates: buildAstroDates(),
        astroDate: ymd(new Date()),
        historyQuick: buildHistoryQuick(),
        historyDate: offsetDate(-1),
        historyMin: offsetDate(-10),
        historyMax: offsetDate(-1),
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
      this.setData({ cities, cityCountText: `${cities.length}/5` })
      if (current) {
        this.boot(current)
      } else {
        void this.autoLocate(true)
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
      const runtime = this as unknown as QwPageRuntime
      if (
        this.data.city &&
        this.data.current &&
        runtime.lastLoadAt > 0 &&
        Date.now() - runtime.lastLoadAt > 10 * 60 * 1000
      ) {
        void this.refreshAll()
      }
    },

    resize() {
      this.measureNavBar()
    },
  },

  methods: {
    /* ---- 导航栏安全区 ---- */

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
      this.setData({ city })
      void this.loadOverview()
    },

    applyCity(city: QwCity, persist = true): void {
      const runtime = this as unknown as QwPageRuntime
      if (runtime.destroyed) {
        return
      }
      if (persist) {
        const cities = upsertQwCity(city)
        this.setData({ cities, cityCountText: `${cities.length}/5` })
      }
      qweatherService.abortAll()
      runtime.endpointRunId += 1
      runtime.seq = {}
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
        errors: { ...EMPTY_ERRORS },
      })
      void this.loadOverview()
    },

    async autoLocate(auto: boolean): Promise<void> {
      const runtime = this as unknown as QwPageRuntime
      if (runtime.destroyed || this.data.locating) {
        return
      }
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
      if (auto) {
        /* 自动定位失败时保留静默，与手动定位区分 */
      }
    },

    useFallback(reason: QwLocationFailure): void {
      const hasCity = Boolean(this.data.city)
      const suffix = hasCity ? '当前显示已保存城市' : '已显示默认城市'
      const notices: Record<string, string> = {
        denied: `模糊定位权限已关闭，${suffix}；点「开启定位」可重新授权`,
        privacy: `需同意隐私保护指引后才能定位，${suffix}`,
        unavailable: `当前微信版本或运行环境不支持模糊定位，${suffix}`,
        failed: `定位失败，${suffix}；可搜索城市或重试定位`,
      }
      this.setData({
        locationNotice: notices[reason] || notices.failed,
        locationReason: reason,
        locationActionText:
          reason === 'denied' || reason === 'privacy' ? '开启定位' : '重试定位',
      })
      if (!this.data.city) {
        this.setData({ city: DEFAULT_CITY })
        void this.loadOverview()
      }
    },

    async onLocationAction(): Promise<void> {
      tapTick()
      this.setData({ citySheetShow: false })
      if (this.data.locationReason === 'denied') {
        await openFuzzySetting()
      }
      await this.autoLocate(false)
    },

    onCityOpen(): void {
      tapTick()
      this.setData({ citySheetShow: true })
    },

    onCityClose(): void {
      this.setData({ citySheetShow: false })
    },

    async onCitySelect(event: WechatMiniprogram.CustomEvent<{ item?: QwGeoItem }>): Promise<void> {
      const item = event.detail && event.detail.item
      if (!item) {
        return
      }
      tapTick()
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
      this.setData({ cities: next, cityCountText: `${next.length}/5` })
      if (this.data.city && cityToken(this.data.city) === token) {
        if (next.length) {
          this.applyCity(next[0], false)
        } else {
          this.setData({ city: null })
          void this.autoLocate(false)
        }
      }
      toast(`已移除 ${target.name}`, 'success')
    },

    /* ---- 数据加载 ---- */

    async loadOverview(force = false): Promise<void> {
      const city = this.data.city
      if (!city || !this.begin('overview')) {
        return
      }
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
        this.end('overview')
      }
    },

    async loadCurrent(force = false): Promise<void> {
      const runtime = this as unknown as QwPageRuntime
      const city = this.data.city
      if (!city || !this.begin('current')) {
        return
      }
      try {
        const result = await qweatherService.loadCurrent(city, force)
        if (runtime.destroyed) {
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
        if (!runtime.destroyed) {
          this.reportError('current', error)
        }
      } finally {
        this.end('current')
      }
    },

    async loadDaily(range: QwDailyRange, force = false): Promise<void> {
      const runtime = this as unknown as QwPageRuntime
      const city = this.data.city
      if (!city || !this.begin('daily')) {
        return
      }
      try {
        const result = await qweatherService.loadDaily(city, range, force)
        if (runtime.destroyed) {
          return
        }
        this.setData({ daily: result.data.days, dailyRange: range })
      } catch (error) {
        if (!runtime.destroyed) {
          this.reportError('daily', error)
        }
      } finally {
        this.end('daily')
      }
    },

    async loadHourly(range: QwHourlyRange, force = false): Promise<void> {
      const runtime = this as unknown as QwPageRuntime
      const city = this.data.city
      if (!city || !this.begin('hourly')) {
        return
      }
      try {
        const result = await qweatherService.loadHourly(city, range, force)
        if (runtime.destroyed) {
          return
        }
        this.setData({ hourly: result.data, hourlyRange: range })
      } catch (error) {
        if (!runtime.destroyed) {
          this.reportError('hourly', error)
        }
      } finally {
        this.end('hourly')
      }
    },

    async loadMinutely(force = false): Promise<void> {
      const runtime = this as unknown as QwPageRuntime
      const city = this.data.city
      if (!city || !this.begin('minutely')) {
        return
      }
      try {
        const result = await qweatherService.loadMinutely(city, force)
        if (!runtime.destroyed) {
          this.setData({ minutely: result.data })
        }
      } catch (error) {
        if (!runtime.destroyed) {
          this.reportError('minutely', error)
        }
      } finally {
        this.end('minutely')
      }
    },

    async loadAlerts(force = false): Promise<void> {
      const runtime = this as unknown as QwPageRuntime
      const city = this.data.city
      if (!city || !this.begin('alerts')) {
        return
      }
      try {
        const result = await qweatherService.loadAlerts(city, force)
        if (!runtime.destroyed) {
          this.setData({ alerts: result.data })
        }
      } catch (error) {
        if (!runtime.destroyed) {
          this.reportError('alerts', error)
        }
      } finally {
        this.end('alerts')
      }
    },

    async loadAir(force = false): Promise<void> {
      const runtime = this as unknown as QwPageRuntime
      const city = this.data.city
      if (!city || !this.begin('air')) {
        return
      }
      try {
        const result = await qweatherService.loadAir(city, force)
        if (runtime.destroyed) {
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
        if (!runtime.destroyed) {
          this.reportError('air', error)
        }
      } finally {
        this.end('air')
      }
    },

    async loadIndices(days: 1 | 3, target: 'overviewIndices' | 'indices', force = false): Promise<void> {
      const runtime = this as unknown as QwPageRuntime
      const city = this.data.city
      if (!city || !this.begin(target)) {
        return
      }
      try {
        const result = await qweatherService.loadIndices(city, days, force)
        if (runtime.destroyed) {
          return
        }
        if (target === 'indices') {
          this.setData({ indices: result.data })
        } else {
          this.setData({ overviewIndices: result.data })
        }
      } catch (error) {
        if (!runtime.destroyed) {
          this.reportError(target, error)
        }
      } finally {
        this.end(target)
      }
    },

    async loadAstronomy(force = false): Promise<void> {
      const runtime = this as unknown as QwPageRuntime
      const city = this.data.city
      if (!city) {
        return
      }
      /* 日期 / 时间 / 海拔可连续切换：用序号丢弃过期响应，避免旧数据覆盖新选择 */
      runtime.seq.astronomy = (runtime.seq.astronomy || 0) + 1
      const seq = runtime.seq.astronomy
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
        if (runtime.destroyed || runtime.seq.astronomy !== seq) {
          return
        }
        this.setData({
          sun: result.data.sun,
          moon: result.data.moon,
          solar: result.data.solar,
        })
      } catch (error) {
        if (!runtime.destroyed && runtime.seq.astronomy === seq) {
          this.reportError('astronomy', error)
        }
      } finally {
        if (!runtime.destroyed && runtime.seq.astronomy === seq) {
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
      runtime.seq.history = (runtime.seq.history || 0) + 1
      const seq = runtime.seq.history
      this.setData({ 'loading.history': true, 'errors.history': '' })
      try {
        const result = await qweatherService.loadHistory(city, date, force)
        if (runtime.destroyed || runtime.seq.history !== seq) {
          return
        }
        this.setData({ history: result.data })
      } catch (error) {
        if (!runtime.destroyed && runtime.seq.history === seq) {
          this.reportError('history', error)
        }
      } finally {
        if (!runtime.destroyed && runtime.seq.history === seq) {
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
        void this.loadIndices(3, 'indices')
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

    onHourlyRange(event: WechatMiniprogram.CustomEvent<{ range: number }>): void {
      const range = Number(event.detail && event.detail.range) as QwHourlyRange
      if (![24, 72, 168, 240].includes(range) || range === this.data.hourlyRange) {
        return
      }
      const runtime = this as unknown as QwPageRuntime
      if (runtime.busy.hourly) {
        toast('正在加载逐小时数据，请稍候', 'warning')
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
        toast('正在加载每日预报，请稍候', 'warning')
        return
      }
      tapTick()
      this.setData({ dailyRange: range, daily: [] })
      void this.loadDaily(range)
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
      const city = this.data.city
      if (!city) {
        void this.autoLocate(true)
        return
      }
      tapTick()
      this.setData({ refreshing: true })
      clearQwCacheForCity(cityToken(city))
      try {
        await this.loadOverview(true)
        const tab = String(this.data.tab)
        if (tab === 'hourly') {
          await this.loadHourly(this.data.hourlyRange, true)
        } else if (tab === 'daily') {
          await this.loadDaily(this.data.dailyRange, true)
        } else if (tab === 'air') {
          await this.loadAir(true)
        } else if (tab === 'indices') {
          await this.loadIndices(3, 'indices', true)
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

    onApiOpen(): void {
      const city = this.data.city
      if (!city) {
        toast('请先选择城市', 'warning')
        return
      }
      /* 测试进行中重新打开：保留进度，不重置列表 */
      if (this.data.endpointRunning) {
        this.setData({ apiSheetShow: true })
        return
      }
      const runtime = this as unknown as QwPageRuntime
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
    },

    onApiClose(): void {
      /* 允许中途关闭；测试继续，重新打开时保留进度 */
      this.setData({ apiSheetShow: false })
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
      this.patchEndpoint(key, { status: 'loading', error: '' })
      const result = await qweatherService.runEndpoint(spec)
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
    },

    async onEndpointRunAll(): Promise<void> {
      const runtime = this as unknown as QwPageRuntime
      if (this.data.endpointRunning || !runtime.specs.length) {
        return
      }
      this.setData({ endpointRunning: true })
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
