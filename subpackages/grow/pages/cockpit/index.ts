/* ==========================================================================
   数据驾驶舱 · Data Cockpit
   - 全部数据来自 historyStore 的本机轨迹摘要，不请求网络、不上传
   - 主题严格使用「白昼 / 夜航」：Canvas 调色板随 isNight 立即重绘
   - 环形图 / 折线图：onReady 后绘制，尺寸为 0 自动重试，rAF 生长动画
   - 开发者工具 Skyline 不支持 Canvas 组件：自动切离屏 Canvas 导出静态图
   - onHide / onUnload 取消动画与定时器，卸载时销毁绑定、释放临时图
   - 隐私盾默认脱敏：只隐藏金额 / 密码 / 健康等敏感值，点击眼睛恢复真实摘要
   ========================================================================== */
import { createStoreBindings } from 'mobx-miniprogram-bindings'
import { reaction } from 'mobx-miniprogram'
import { uiStore } from '../../../../core/stores/ui'
import { preferenceStore } from '../../../../core/stores/preference'
import { historyStore, HISTORY_MAX } from '../../../../core/stores/history'
import { toolboxStore } from '../../../../core/toolbox/store'
import {
  buildCategoryStats,
  buildDailyStats,
  buildHistoryInsight,
  buildTimeline,
  formatCategoryPercentages,
  type CategoryStat,
  type HistoryInsight,
  type TimelineItem,
} from '../../../../core/toolbox/history-insights'
import { ROUTES, APP_VERSION } from '../../../../core/constants/index'
import { countHistoryInSnapshots, purgeHistoryFromSnapshots, purgeHistoryRecordFromSnapshots } from '../../../../core/toolbox/history-snapshots'
import { tapSuccess, tapTick, tapWarn, useHaptics } from '../../../../core/utils/haptics'
import { showGlassToast } from '../../../../components/glass-toast/toast'
import { isDevtools } from '../../../../core/utils/platform'
import { logger } from '../../../../core/utils/logger'
import { useMotion } from '../../../../core/services/motion'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import {
  animateChart,
  drawDonutChart,
  drawLineChart,
  type ChartAnimator,
  type ChartCanvas,
  type ChartCtx,
  type ChartPoint,
  type ChartSlice,
  type ChartTheme,
} from '../../lib/cockpit-chart'

type CockpitToastType = 'info' | 'success' | 'error' | 'warning'

function showCockpitToast(message: string, type: CockpitToastType = 'info'): void {
  showGlassToast({
    message,
    type,
    placement: 'lower-center',
    tapToDismiss: true,
  })
}

interface StoreBindings {
  destroyStoreBindings: () => void
}

interface LegendView {
  code: string
  label: string
  value: number
  percentText: string
}

interface TimelineView extends TimelineItem {
  inputText: string
  outputText: string
}

interface AcquiredCanvas {
  node: ChartCanvas
  ctx: ChartCtx
  width: number
  height: number
}

interface BoxSize {
  width: number
  height: number
}

interface CockpitRuntime {
  themeBindings?: StoreBindings
  toolboxBindings?: StoreBindings
  themeReaction?: () => void
  historyReaction?: () => void
  drawTimer: number
  drawSeq: number
  donutAnim?: ChartAnimator
  lineAnim?: ChartAnimator
  donutCanvas?: ChartCanvas
  lineCanvas?: ChartCanvas
  slices: ChartSlice[]
  points: ChartPoint[]
  total: number
  ready: boolean
  visible: boolean
  dirty: boolean
  destroyed: boolean
}

const EMPTY_INSIGHT = buildHistoryInsight([])
/** 首屏时间线条数；展开后按 24 条一批追加 */
const TIMELINE_PREVIEW = 12
const TIMELINE_BATCH = 24
/** 环形图 / 折线图生长时长：省电模式直接落位 */
const DONUT_DURATION = 820
const LINE_DURATION = 1060

/* ---- 全息专注小卡：只读 focus:* Storage，不 import life 分包 ---- */
const FOCUS_LEVEL_LABELS = [
  '初识心流',
  '渐入佳境',
  '稳定心流',
  '深度专注',
  '心流大师',
  '心流传奇',
] as const

function focusLocalDate(timestamp: number): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function focusShiftDate(dateKey: string, deltaDays: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return ''
  }
  const [year, month, day] = dateKey.split('-').map((part) => Number(part))
  const date = new Date(year, month - 1, day)
  date.setDate(date.getDate() + deltaDays)
  return focusLocalDate(date.getTime())
}

function parseFocusStorage(raw: unknown): unknown {
  if (typeof raw !== 'string') {
    return raw
  }
  if (!raw.trim()) {
    return null
  }
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

function readFocusStatsRaw(): Record<string, unknown> | null {
  try {
    const parsed = parseFocusStorage(wx.getStorageSync('focus:stats:v1'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    const record = parsed as Record<string, unknown>
    return record.version === 1 ? record : null
  } catch {
    return null
  }
}

function readRecentFocusTag(): string {
  try {
    const parsed = parseFocusStorage(wx.getStorageSync('focus:ledger:v1'))
    if (!Array.isArray(parsed)) {
      return ''
    }
    let newest: Record<string, unknown> | null = null
    let newestEnd = -1
    for (const item of parsed) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        continue
      }
      const record = item as Record<string, unknown>
      const endedAt = Number(record.endedAt)
      if (
        Number.isFinite(endedAt) &&
        endedAt > newestEnd &&
        typeof record.tag === 'string'
      ) {
        newest = record
        newestEnd = endedAt
      }
    }
    return newest && typeof newest.tag === 'string' ? newest.tag.trim() : ''
  } catch {
    return ''
  }
}

function readDpr(): number {
  try {
    const info = wx.getWindowInfo()
    return info.pixelRatio > 0 ? info.pixelRatio : 2
  } catch {
    return 2
  }
}

function unlinkQuietly(path: string): void {
  if (!path) {
    return
  }
  try {
    wx.getFileSystemManager().unlink({
      filePath: path,
      fail: () => undefined,
    })
  } catch {
    /* 临时文件由系统兜底回收 */
  }
}

function exportCanvasFile(canvas: ChartCanvas): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas: canvas as unknown as WechatMiniprogram.Canvas,
      x: 0,
      y: 0,
      width: canvas.width,
      height: canvas.height,
      destWidth: canvas.width,
      destHeight: canvas.height,
      fileType: 'png',
      success: (result) => resolve(result.tempFilePath),
      fail: (error) => reject(new Error(error.errMsg || '图表导出失败')),
    })
  })
}

function toTimelineView(items: TimelineItem[]): TimelineView[] {
  return items.map((item) => ({
    ...item,
    inputText: item.inputSummary || '未记录输入',
    outputText: item.outputSummary || '未记录结果',
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
    isNight: uiStore.resolvedTheme === 'dark',
    themeLabel: uiStore.resolvedThemeLabel,
    navTop: 44,
    navRight: 16,
    contentTop: 96,

    usageCount: 0,
    masked: true,
    trackingEnabled: true,
    hasHistory: false,
    insight: EMPTY_INSIGHT as HistoryInsight,
    legend: [] as LegendView[],
    timeline: [] as TimelineView[],
    timelineExpanded: false,
    timelineVisible: 0,
    snapshotHistoryCount: 0,
    storageWarning: false,
    appVersion: APP_VERSION,
    donutAria: '',
    dailyAria: '',

    focusCardVisible: false,
    focusHasData: false,
    focusTodayMinutes: 0,
    focusCompleted: 0,
    focusStreak: 0,
    focusLevelLabel: 'Lv.1 初识心流',
    focusRecentTag: '',

    imageCharts: false,
    chartError: false,
    donutImage: '',
    lineImage: '',

    confirmShow: false,
    clearMode: 'current' as 'current' | 'snapshots',
    confirmTitle: '清空当前轨迹',
    confirmDesc: '',
    confirmActionText: '清空当前轨迹',
    confirmCountText: '',
    deleteShow: false,
    deleteId: '',
    deleteName: '',
  },

  onLoad() {
    historyStore.init()
    toolboxStore.init()
    preferenceStore.init()

    const runtime = this as unknown as CockpitRuntime
    runtime.drawTimer = 0
    runtime.drawSeq = 0
    runtime.slices = []
    runtime.points = []
    runtime.total = 0
    runtime.ready = false
    runtime.visible = false
    runtime.dirty = false
    runtime.destroyed = false

    this.setupInsets()
    /* Skyline 开发者工具不支持 Canvas 组件：直接走离屏导出静态图；
       隐私盾读取上次持久化状态，默认开启 */
    this.setData(
      {
        imageCharts: isDevtools(),
        masked: preferenceStore.isPrivacyMasked,
        trackingEnabled: preferenceStore.isHistoryTrackingEnabled,
      },
      () => {
        this.refreshFromStore(false)
        this.refreshSnapshotCount()
      },
    )

    runtime.themeBindings = createStoreBindings(this, {
      store: uiStore,
      fields: {
        themeClass: () => uiStore.themeClass,
        themeSwitching: () => uiStore.themeSwitching,
        isNight: () => uiStore.resolvedTheme === 'dark',
        themeLabel: () => uiStore.resolvedThemeLabel,
      },
      actions: [],
    })

    runtime.toolboxBindings = createStoreBindings(this, {
      store: toolboxStore,
      fields: {
        usageCount: () => toolboxStore.usageCount,
      },
      actions: [],
    })

    /* 主题翻转：先更新 isNight，再立刻用新调色板重绘，绝不让图表停在旧主题 */
    runtime.themeReaction = reaction(
      () => uiStore.resolvedTheme,
      (theme) => {
        if (runtime.destroyed) {
          return
        }
        this.setData(
          {
            isNight: theme === 'dark',
            themeLabel: uiStore.resolvedThemeLabel,
          },
          () => {
            if (runtime.visible) {
              this.scheduleDraw(false, 0)
            }
          },
        )
      },
    )

    /* 新轨迹产生：可见时立即重算；隐藏时只置 dirty，onShow 再统一刷新 */
    runtime.historyReaction = reaction(
      () => historyStore.version,
      () => {
        if (runtime.destroyed) {
          return
        }
        if (!runtime.visible) {
          runtime.dirty = true
          return
        }
        this.refreshFromStore(true)
      },
    )
  },

  onReady() {
    const runtime = this as unknown as CockpitRuntime
    runtime.ready = true
    if (runtime.visible && this.data.hasHistory) {
      this.scheduleDraw(true, 0)
    }
  },

  onShow() {
    const runtime = this as unknown as CockpitRuntime
    runtime.visible = true
    runtime.dirty = false
    uiStore.syncNativeChrome()
    /* 从其他页面返回时同步最新隐私 / 记录偏好，再重算时间线 */
    this.setData(
      {
        masked: preferenceStore.isPrivacyMasked,
        trackingEnabled: preferenceStore.isHistoryTrackingEnabled,
      },
      () => {
        this.refreshFromStore(false)
        this.refreshSnapshotCount()
        this.refreshFocusCard()
        if (runtime.ready && this.data.hasHistory) {
          this.scheduleDraw(true, 60)
        }
      },
    )
  },

  onHide() {
    const runtime = this as unknown as CockpitRuntime
    runtime.visible = false
    this.cancelChartWork()
    /* 切后台 / 离开页面时回到遮罩态，并立即把已渲染的时间线替换为脱敏文本，
       避免系统快照继续显示真实摘要 */
    if (!this.data.masked) {
      this.setData({ masked: true }, () => this.rebuildTimeline())
    }
  },

  onUnload() {
    const runtime = this as unknown as CockpitRuntime
    runtime.destroyed = true
    this.cancelChartWork()

    if (runtime.themeReaction) {
      runtime.themeReaction()
      runtime.themeReaction = undefined
    }
    if (runtime.historyReaction) {
      runtime.historyReaction()
      runtime.historyReaction = undefined
    }
    if (runtime.themeBindings) {
      runtime.themeBindings.destroyStoreBindings()
      runtime.themeBindings = undefined
    }
    if (runtime.toolboxBindings) {
      runtime.toolboxBindings.destroyStoreBindings()
      runtime.toolboxBindings = undefined
    }

    unlinkQuietly(this.data.donutImage)
    unlinkQuietly(this.data.lineImage)
    /* 释放高分辨率后备存储：即使节点引用被立即回收也不会留下大块显存 */
    const shrink = (canvas?: ChartCanvas): void => {
      if (!canvas) {
        return
      }
      try {
        canvas.width = 8
        canvas.height = 8
      } catch {
        /* 个别环境不允许改尺寸时忽略 */
      }
    }
    shrink(runtime.donutCanvas)
    shrink(runtime.lineCanvas)
    runtime.donutCanvas = undefined
    runtime.lineCanvas = undefined
    runtime.slices = []
    runtime.points = []

    /* 离开驾驶舱时把在途轨迹写入立即落盘 */
    historyStore.flush()
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
        contentTop: Math.max(72, (capsule.bottom || navTop + 48) + 16, navTop + 60),
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

  onGoHome(): void {
    tapTick()
    wx.switchTab({
      url: ROUTES.home,
      fail: () => {
        wx.reLaunch({ url: ROUTES.home })
      },
    })
  },

  /* ---- 数据聚合：所有图表与时间线都从 historyStore 单一真相源重算 ---- */
  refreshFromStore(draw = true): void {
    const runtime = this as unknown as CockpitRuntime
    if (runtime.destroyed) {
      return
    }

    const records = historyStore.records
    const hasHistory = records.length > 0
    const shouldCollapse = !hasHistory || records.length <= TIMELINE_PREVIEW
    const timelineExpanded = shouldCollapse ? false : this.data.timelineExpanded
    const timelineVisible = shouldCollapse ? 0 : this.data.timelineVisible
    const limit = timelineExpanded
      ? Math.min(Math.max(timelineVisible || TIMELINE_BATCH, TIMELINE_PREVIEW), HISTORY_MAX)
      : TIMELINE_PREVIEW

    const insight = buildHistoryInsight(records)
    const categories: CategoryStat[] = buildCategoryStats(records)
    const daily = buildDailyStats(records)
    const timeline = toTimelineView(buildTimeline(records, this.data.masked, limit))
    const percentages = formatCategoryPercentages(categories)

    const legend: LegendView[] = categories.map((stat, index) => ({
      code: stat.code,
      label: stat.label,
      value: stat.value,
      percentText: percentages[index] || '0%',
    }))

    const donutAria = legend.length
      ? `分类占比：${legend
          .map((item) => `${item.label} ${item.value} 次 ${item.percentText}`)
          .join('，')}`
      : '暂无分类数据'
    const dailyAria = `近 7 日计算次数：${daily
      .map((day) => `${day.label} ${day.value} 次`)
      .join('，')}`

    runtime.slices = categories.map((stat) => ({
      code: stat.code,
      label: stat.label,
      value: stat.value,
      percent: stat.percent,
    }))
    runtime.points = daily.map((day) => ({ label: day.label, value: day.value }))
    runtime.total = records.length

    /* 轨迹被清空：立刻取消在途生长动画，避免继续往即将卸载的画布上绘制 */
    if (records.length === 0) {
      this.cancelChartWork()
    }

    this.setData(
      {
        hasHistory,
        insight,
        legend,
        timeline,
        timelineExpanded,
        timelineVisible,
        donutAria,
        dailyAria,
        storageWarning: historyStore.writeFailed,
      },
      () => {
        if (draw && runtime.visible) {
          this.scheduleDraw(true, 60)
        }
      },
    )
  },

  timelineLimit(): number {
    return this.data.timelineExpanded
      ? Math.min(Math.max(this.data.timelineVisible || TIMELINE_BATCH, TIMELINE_PREVIEW), HISTORY_MAX)
      : TIMELINE_PREVIEW
  },

  rebuildTimeline(): void {
    this.setData({
      timeline: toTimelineView(
        buildTimeline(historyStore.records, this.data.masked, this.timelineLimit()),
      ),
    })
  },

  refreshSnapshotCount(): void {
    this.setData({ snapshotHistoryCount: countHistoryInSnapshots() })
  },

  /* ---- 全息专注小卡：今日 / 累计完成 / 连续天数 / 最近标签 / 等级 ---- */
  refreshFocusCard(): void {
    const runtime = this as unknown as CockpitRuntime
    if (runtime.destroyed) {
      return
    }
    if (!preferenceStore.isHistoryTrackingEnabled) {
      if (this.data.focusCardVisible) {
        this.setData({ focusCardVisible: false })
      }
      return
    }
    const stats = readFocusStatsRaw()
    const tag = readRecentFocusTag()
    const now = Date.now()
    const today = focusLocalDate(now)
    const yesterday = focusShiftDate(today, -1)

    let todayMinutes = 0
    let completed = 0
    let streak = 0
    let level = 1
    if (stats) {
      const todayDate =
        typeof stats.todayDate === 'string' ? stats.todayDate : ''
      const todayFocusMs = Number(stats.todayFocusMs)
      if (todayDate === today && Number.isFinite(todayFocusMs) && todayFocusMs > 0) {
        todayMinutes = Math.floor(todayFocusMs / 60000)
      }
      const count = Number(stats.completedCount)
      completed = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
      const lastCompleted =
        typeof stats.lastCompletedDate === 'string' ? stats.lastCompletedDate : ''
      const streakDays = Number(stats.streakDays)
      if (
        lastCompleted &&
        yesterday &&
        lastCompleted >= yesterday &&
        Number.isFinite(streakDays) &&
        streakDays > 0
      ) {
        streak = Math.floor(streakDays)
      }
      const levelValue = Number(stats.level)
      level = Number.isFinite(levelValue)
        ? Math.min(6, Math.max(1, Math.floor(levelValue)))
        : 1
    }

    const hasData = completed > 0
    const recentTag = this.data.masked
      ? tag
        ? '已脱敏'
        : ''
      : tag

    this.setData({
      focusCardVisible: true,
      focusHasData: hasData,
      focusTodayMinutes: todayMinutes,
      focusCompleted: completed,
      focusStreak: streak,
      focusLevelLabel: `Lv.${level} ${FOCUS_LEVEL_LABELS[level - 1]}`,
      focusRecentTag: recentTag,
    })
  },

  /* ---- 隐私盾：偏好持久化，默认脱敏，点击眼睛才显示真实摘要 ---- */
  onTogglePrivacy(): void {
    const persisted = preferenceStore.togglePrivacyMasked()
    const masked = preferenceStore.isPrivacyMasked
    useHaptics().tick()
    this.setData({ masked }, () => {
      this.rebuildTimeline()
      this.refreshFocusCard()
    })
    showCockpitToast(
      persisted
        ? masked
          ? '隐私脱敏已开启 · 敏感字段已隐藏'
          : '已显示真实摘要 · 仅你本人可见'
        : '脱敏设置仅在本次会话生效',
      masked && persisted ? 'success' : persisted ? 'warning' : 'error',
    )
  },

  onToggleTracking(event: WechatMiniprogram.CustomEvent<{ value: boolean }>): void {
    const enabled = Boolean(event.detail && event.detail.value)
    const persisted = preferenceStore.setHistoryTrackingEnabled(enabled)
    this.setData({ trackingEnabled: preferenceStore.isHistoryTrackingEnabled })
    this.refreshFocusCard()
    showCockpitToast(
      persisted
        ? enabled
          ? '已恢复记录计算轨迹'
          : '已暂停记录 · 已有轨迹保留，可随时删除'
        : '记录开关仅在本次会话生效',
      persisted ? (enabled ? 'success' : 'warning') : 'error',
    )
  },

  onToggleTimeline(): void {
    const total = this.data.insight.total
    if (!this.data.timelineExpanded) {
      tapTick()
      this.setData(
        {
          timelineExpanded: true,
          timelineVisible: Math.min(TIMELINE_BATCH, total),
        },
        () => this.rebuildTimeline(),
      )
      return
    }
    if (this.data.timelineVisible < total) {
      tapTick()
      this.setData(
        {
          timelineVisible: Math.min(this.data.timelineVisible + TIMELINE_BATCH, total),
        },
        () => this.rebuildTimeline(),
      )
      return
    }
    tapTick()
    this.setData({ timelineExpanded: false, timelineVisible: 0 }, () =>
      this.rebuildTimeline(),
    )
  },

  onOpenClear(): void {
    tapWarn()
    this.setData({
      clearMode: 'current',
      confirmTitle: '清空当前轨迹',
      confirmDesc: '将删除当前全部计算摘要；自动快照和热备中的历史轨迹不受影响，可单独清除。',
      confirmActionText: '清空当前轨迹',
      confirmCountText: `当前 ${this.data.insight.total} 条`,
      confirmShow: true,
    })
  },

  onOpenSnapshotClear(): void {
    if (this.data.snapshotHistoryCount <= 0) {
      return
    }
    tapWarn()
    this.setData({
      clearMode: 'snapshots',
      confirmTitle: '清除快照中的轨迹',
      confirmDesc: '将从自动快照和热备中移除历史轨迹，保留主题、收藏等其他数据；当前轨迹不受影响。',
      confirmActionText: '清除快照轨迹',
      confirmCountText: `快照中 ${this.data.snapshotHistoryCount} 条`,
      confirmShow: true,
    })
  },

  onConfirmClose(): void {
    this.setData({ confirmShow: false })
  },

  onConfirmClear(): void {
    if (this.data.clearMode === 'snapshots') {
      const result = purgeHistoryFromSnapshots()
      this.setData({ confirmShow: false }, () => this.refreshSnapshotCount())
      tapSuccess()
      showCockpitToast(
        result.records > 0 ? `已清除快照中的 ${result.records} 条轨迹` : '快照中暂无轨迹',
        'success',
      )
      return
    }

    historyStore.clear()
    this.setData(
      {
        confirmShow: false,
        timelineExpanded: false,
        timelineVisible: 0,
      },
      () => {
        this.refreshFromStore(false)
        this.refreshSnapshotCount()
      },
    )
    tapSuccess()
    showCockpitToast('当前计算轨迹已清空', 'success')
  },

  onAskDelete(event: WechatMiniprogram.BaseEvent): void {
    const dataset = event.currentTarget.dataset as { id?: string; name?: string }
    const id = typeof dataset.id === 'string' ? dataset.id : ''
    if (!id) {
      return
    }
    tapWarn()
    this.setData({
      deleteShow: true,
      deleteId: id,
      deleteName: typeof dataset.name === 'string' ? dataset.name : '这条轨迹',
    })
  },

  onDeleteClose(): void {
    this.setData({ deleteShow: false, deleteId: '', deleteName: '' })
  },

  onConfirmDelete(): void {
    const id = this.data.deleteId
    if (!id) {
      this.onDeleteClose()
      return
    }
    const removed = historyStore.remove(id)
    const purged = purgeHistoryRecordFromSnapshots(id)
    this.setData({ deleteShow: false, deleteId: '', deleteName: '' }, () => {
      this.refreshFromStore(false)
      this.refreshSnapshotCount()
    })
    tapSuccess()
    showCockpitToast(
      removed
        ? purged > 0
          ? '轨迹已删除，并从快照中同步移除'
          : '轨迹已删除'
        : '这条轨迹已不存在',
      removed ? 'success' : 'info',
    )
  },

  onRetryCharts(): void {
    this.cancelChartWork()
    unlinkQuietly(this.data.donutImage)
    unlinkQuietly(this.data.lineImage)
    tapTick()
    this.setData(
      {
        imageCharts: isDevtools(),
        chartError: false,
        donutImage: '',
        lineImage: '',
      },
      () => this.scheduleDraw(true, 0),
    )
  },

  /* ---- Canvas 生命周期 ---- */
  chartTheme(): ChartTheme {
    return this.data.isNight ? 'night' : 'day'
  },

  cancelAnimations(): void {
    const runtime = this as unknown as CockpitRuntime
    if (runtime.donutAnim) {
      runtime.donutAnim.cancel()
      runtime.donutAnim = undefined
    }
    if (runtime.lineAnim) {
      runtime.lineAnim.cancel()
      runtime.lineAnim = undefined
    }
  },

  cancelChartWork(): void {
    const runtime = this as unknown as CockpitRuntime
    if (runtime.drawTimer) {
      clearTimeout(runtime.drawTimer)
      runtime.drawTimer = 0
    }
    runtime.drawSeq += 1
    this.cancelAnimations()
  },

  scheduleDraw(animate: boolean, delay = 60): void {
    const runtime = this as unknown as CockpitRuntime
    if (runtime.destroyed || !runtime.visible || !this.data.hasHistory) {
      return
    }
    if (runtime.drawTimer) {
      clearTimeout(runtime.drawTimer)
    }
    runtime.drawSeq += 1
    const seq = runtime.drawSeq
    runtime.drawTimer = setTimeout(() => {
      runtime.drawTimer = 0
      this.drawCharts(seq, animate)
    }, delay) as unknown as number
  },

  drawCharts(seq: number, animate: boolean): void {
    const runtime = this as unknown as CockpitRuntime
    if (runtime.destroyed || seq !== runtime.drawSeq) {
      return
    }
    if (!this.data.hasHistory) {
      this.cancelChartWork()
      return
    }

    if (this.data.imageCharts) {
      void this.renderChartImages(seq)
      return
    }

    this.cancelAnimations()
    Promise.all([this.acquireCanvas('cockpitDonut'), this.acquireCanvas('cockpitLine')]).then(
      (results) => {
        if (runtime.destroyed || seq !== runtime.drawSeq) {
          return
        }
        const donut = results[0]
        const line = results[1]
        if (!donut || !line) {
          /* 真机 Canvas 查询失败：降级离屏静态图，保证驾驶舱绝不空白 */
          logger.warn('cockpit', 'Canvas 节点不可用，切换离屏静态图')
          this.setData({ imageCharts: true }, () => {
            void this.renderChartImages(seq)
          })
          return
        }

        runtime.donutCanvas = donut.node
        runtime.lineCanvas = line.node
        this.setData({ chartError: false })

        const motion = useMotion()
        const glow = motion.lightEnabled
        const donutDuration =
          animate && motion.level !== 'saver'
            ? Math.round(DONUT_DURATION * motion.durationScale)
            : 0
        const lineDuration =
          animate && motion.level !== 'saver'
            ? Math.round(LINE_DURATION * motion.durationScale)
            : 0

        const paintDonut = (progress: number): void => {
          drawDonutChart(
            donut.ctx,
            donut.width,
            donut.height,
            runtime.slices,
            runtime.total,
            progress,
            this.chartTheme(),
            glow,
          )
        }
        const paintLine = (progress: number): void => {
          drawLineChart(
            line.ctx,
            line.width,
            line.height,
            runtime.points,
            progress,
            this.chartTheme(),
            glow,
          )
        }

        /* 零时长也先画首帧，主题切换时保证旧颜色被立即擦除 */
        paintDonut(animate ? 0 : 1)
        paintLine(animate ? 0 : 1)

        if (donutDuration > 0) {
          runtime.donutAnim = animateChart(donut.node, donutDuration, paintDonut)
        }
        if (lineDuration > 0) {
          runtime.lineAnim = animateChart(line.node, lineDuration, paintLine)
        }
      },
    )
  },

  /** Canvas 尺寸可能尚未撑开：尺寸为 0 / 节点缺失时 120ms 重试，最多 5 次 */
  acquireCanvas(id: string, attempt = 0): Promise<AcquiredCanvas | null> {
    return new Promise((resolve) => {
      this.createSelectorQuery()
        .select(`#${id}`)
        .fields({ node: true, size: true })
        .exec((result: unknown[]) => {
          const entry = result && result[0]
          const record =
            entry && typeof entry === 'object'
              ? (entry as { node?: ChartCanvas; width?: number; height?: number })
              : null
          const node = record ? record.node : undefined
          const width = record && typeof record.width === 'number' ? record.width : 0
          const height = record && typeof record.height === 'number' ? record.height : 0

          if (!node || width <= 0 || height <= 0) {
            if (attempt >= 4) {
              resolve(null)
              return
            }
            setTimeout(() => {
              resolve(this.acquireCanvas(id, attempt + 1))
            }, 120)
            return
          }

          const dpr = readDpr()
          node.width = Math.round(width * dpr)
          node.height = Math.round(height * dpr)
          const ctx = node.getContext('2d')
          if (!ctx) {
            if (attempt >= 4) {
              resolve(null)
              return
            }
            setTimeout(() => {
              resolve(this.acquireCanvas(id, attempt + 1))
            }, 120)
            return
          }
          ctx.scale(dpr, dpr)
          resolve({ node, ctx, width, height })
        })
    })
  },

  measureBox(id: string, attempt = 0): Promise<BoxSize | null> {
    return new Promise((resolve) => {
      this.createSelectorQuery()
        .select(`#${id}`)
        .boundingClientRect((rect: WechatMiniprogram.BoundingClientRectCallbackResult | null) => {
          if (!rect || rect.width <= 0 || rect.height <= 0) {
            if (attempt >= 4) {
              resolve(null)
              return
            }
            setTimeout(() => {
              resolve(this.measureBox(id, attempt + 1))
            }, 120)
            return
          }
          resolve({ width: rect.width, height: rect.height })
        })
        .exec()
    })
  },

  /* ---- 开发者工具 / Canvas 不可用：离屏绘制终态并导出静态图 ---- */
  async renderChartImages(seq: number): Promise<void> {
    const runtime = this as unknown as CockpitRuntime
    if (runtime.destroyed || seq !== runtime.drawSeq || !this.data.hasHistory) {
      return
    }

    try {
      const sizes = await Promise.all([
        this.measureBox('cockpitDonutWrap'),
        this.measureBox('cockpitLineWrap'),
      ])
      if (runtime.destroyed || seq !== runtime.drawSeq) {
        return
      }
      const donutBox = sizes[0]
      const lineBox = sizes[1]
      if (!donutBox || !lineBox) {
        throw new Error('图表容器尺寸为 0')
      }

      const settled = await Promise.allSettled([
        this.renderChartImage('donut', donutBox),
        this.renderChartImage('line', lineBox),
      ])
      const images = settled
        .filter((item): item is PromiseFulfilledResult<string> => item.status === 'fulfilled')
        .map((item) => item.value)
      if (settled.some((item) => item.status === 'rejected')) {
        /* 一张失败时回收另一张已生成的临时图，避免路径丢失造成泄漏 */
        images.forEach(unlinkQuietly)
        const failure = settled.find(
          (item): item is PromiseRejectedResult => item.status === 'rejected',
        )
        throw failure ? failure.reason : new Error('图表导出失败')
      }
      if (images.length !== 2) {
        images.forEach(unlinkQuietly)
        throw new Error('图表数量不完整')
      }
      if (runtime.destroyed || seq !== runtime.drawSeq) {
        /* 主题翻转 / 页面离开导致本轮作废：回收刚生成的临时图，不覆盖新主题 */
        images.forEach(unlinkQuietly)
        return
      }

      const previousDonut = this.data.donutImage
      const previousLine = this.data.lineImage
      this.setData(
        {
          donutImage: images[0],
          lineImage: images[1],
          imageCharts: true,
          chartError: false,
        },
        () => {
          if (previousDonut && previousDonut !== images[0]) {
            unlinkQuietly(previousDonut)
          }
          if (previousLine && previousLine !== images[1]) {
            unlinkQuietly(previousLine)
          }
        },
      )
    } catch (error) {
      logger.warn('cockpit', '离屏图表渲染失败', error)
      if (!runtime.destroyed && seq === runtime.drawSeq) {
        this.setData({ chartError: true })
      }
    }
  },

  renderChartImage(kind: 'donut' | 'line', box: BoxSize): Promise<string> {
    return new Promise((resolve, reject) => {
      const runtime = this as unknown as CockpitRuntime
      if (typeof wx.createOffscreenCanvas !== 'function') {
        reject(new Error('当前环境不支持离屏画布'))
        return
      }
      const dpr = readDpr()
      const width = Math.round(box.width * dpr)
      const height = Math.round(box.height * dpr)
      let canvas: ChartCanvas
      try {
        canvas = wx.createOffscreenCanvas({
          type: '2d',
          width,
          height,
        }) as unknown as ChartCanvas
      } catch (error) {
        reject(error instanceof Error ? error : new Error('离屏画布创建失败'))
        return
      }
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('离屏画布上下文不可用'))
        return
      }
      ctx.scale(dpr, dpr)

      const glow = useMotion().lightEnabled
      if (kind === 'donut') {
        drawDonutChart(
          ctx,
          box.width,
          box.height,
          runtime.slices,
          runtime.total,
          1,
          this.chartTheme(),
          glow,
        )
      } else {
        drawLineChart(ctx, box.width, box.height, runtime.points, 1, this.chartTheme(), glow)
      }

      exportCanvasFile(canvas)
        .then(resolve)
        .catch(reject)
    })
  },
})
