/* ==========================================================================
   glass-tool-shell · 工具页空间玻璃骨架
   - 导航 / 标题 / 隐私说明 / 收藏 / 运行与重置 / 结果槽 / 注释槽
   - 输入区与结果区由各工具页通过多 slot 注入，内部统一 glass-card 承托
   - 运行 / 重置 / 示例 / 收藏全部由 glass-button 接管
   - 提示统一走 glass-toast，废弃 wx.showToast 与旧 g-toast
   ========================================================================== */
import { createStoreBindings } from 'mobx-miniprogram-bindings'
import { uiStore } from '../../core/stores/ui'
import { toolboxStore } from '../../core/toolbox/store'
import { privacyTextFor, resolveToolSession, toggleFavoriteTool } from '../../core/toolbox/tool-session'
import { ROUTES, TIMING } from '../../core/constants/index'
import { tapTick, tapWarn } from '../../core/utils/haptics'
import { useMotion } from '../../core/services/motion'
import { useSound } from '../../core/services/sound'
import { showGlassToast } from '../glass-toast/toast'
import {
  canShareFile,
  cleanupExport,
  prepareExport,
  sanitizeExportName,
  sharePrepared,
  type ExportFormat,
} from '../../core/services/export'
import { copyText } from '../../core/services/feedback'
import { fontScaleClass, syncFontScaleClass } from '../../core/services/font-scale'
import { normalizePosterData, resolvePosterCategory } from '../../core/toolbox/poster'
import { pickFooterQuote } from '../../core/toolbox/quotes'
import { recordToolResult } from '../../core/toolbox/tracker'
import {
  clearDraft,
  draftAllowed,
  readDraft,
  saveDraft,
  type DraftPageBridge,
} from '../../core/toolbox/draft'
import { isWorkflowToolId } from '../../core/workflow/workflowConfig'
import { workflowStore } from '../../core/workflow/workflowStore'
import type { PosterPayload } from '../poster-generator/index'

interface ShellState {
  themeBindings?: { destroyStoreBindings: () => void }
  toolboxBindings?: { destroyStoreBindings: () => void }
  scrollTimer: number
  posterStartTimer: number
  posterSeq: number
  /** 结果埋点：短防抖只合并同一结果的重复触发，不吞掉连续计算 */
  trackTimer: number
  pendingTrackSig: string
  lastTrackSig: string
  lastTrackAt: number
  /** 结果导出：300ms 预写防抖、序列号防旧结果回填 */
  exportTimer: number
  exportSeq: number
  exportPath: string
  /** 草稿：当前页最小接口、首次 show 基线、延迟检查计时器 */
  draftPage: DraftPageBridge | null
  draftPromptTimer: number
  draftPromptChecked: boolean
  draftBaseline: string | null
  draftBaselineTimer: number
}

interface PosterGeneratorInstance {
  generate(payload: PosterPayload): Promise<string>
}

interface DraftSnapshot {
  mode: string
  input: Record<string, string>
}

/** 预览弹簧入场约 550ms：等它完全落位后再开始 Canvas 绘制，绘制不抢过渡帧 */
const POSTER_START_DELAY = 560
/** 省电模式预览只做 220ms 透明度渐变，绘制可以更早接管 */
const POSTER_SAVER_DELAY = 240
/** 结果埋点短防抖：只合并同一结果的多路触发，160ms 内连续计算仍分别记录 */
const TRACK_DEBOUNCE_MS = 160
const EXPORT_DEBOUNCE_MS = 300
/** 草稿恢复条：等页面 onShow / workflow 注入落位后再判断，避免抢输入 */
const DRAFT_PROMPT_DELAY = 600
const EXPORT_FORMATS: ExportFormat[] = ['txt', 'md', 'csv', 'json']

/** 跨页面连续打开工具时，避免页脚出现同一条哲理 */
let lastFooterQuote = ''

function nextFooterQuote(): string {
  const quote = pickFooterQuote(Math.random, lastFooterQuote)
  lastFooterQuote = quote
  return quote
}

Component({
  options: {
    multipleSlots: true,
    /* apply-shared：页面 / app.wxss 的 .theme-dark 令牌必须能进入壳内，
       否则夜航下 23 个工具页会继续吃系统浅色，整页发白 */
    styleIsolation: 'apply-shared',
  },

  properties: {
    toolId: { type: String, value: '' },
    title: { type: String, value: '' },
    kicker: { type: String, value: '' },
    desc: { type: String, value: '' },
    sensitive: { type: String, value: '' },
    state: { type: String, value: 'idle' },
    runLabel: { type: String, value: '计算' },
    canRun: { type: Boolean, value: true },
    showRun: { type: Boolean, value: true },
    showExample: { type: Boolean, value: true },
    hasResult: { type: Boolean, value: false },
    error: { type: String, value: '' },
    emptyTitle: { type: String, value: '输入内容后，结果会显示在这里' },
    emptySub: { type: String, value: '所有计算只在本机完成' },
    /** 是否展示生成海报入口 */
    posterEnabled: { type: Boolean, value: true },
    /** 页面显式指定的海报主值；为空时从当前页结果字段安全回退 */
    posterValue: { type: String, value: '' },
    /** 页面显式指定的海报说明；为空时回退工具描述 */
    posterSub: { type: String, value: '' },
    /** 工具页传入的真实业务数据 IPosterData；优先于旧单字段 */
    posterData: { type: Object, value: null },
    /** 页面自有弹窗 / 输入态占用时，挂起全局更新弹窗 */
    updateBlocked: { type: Boolean, value: false },
    /** 结果导出：页面显式开启；默认关闭 */
    exportEnabled: { type: Boolean, value: false },
    exportName: { type: String, value: '' },
    exportContent: { type: String, value: '' },
    exportType: { type: String, value: 'txt' },
  },

  data: {
    themeClass: uiStore.themeClass,
    themeSwitching: false,
    /** 全局字号档：根节点挂类，共享外壳文字与按钮跟随缩放 */
    fsClass: fontScaleClass(),
    isFavorite: false,
    privacyText: '',
    codeLabel: '',
    kickerLabel: '',
    headInset: 0,
    navRight: 16,
    scrollTarget: '',
    /* 海报状态：纯本地绘制、预览与保存 */
    isGenerating: false,
    posterVisible: false,
    posterPath: '',
    posterError: '',
    posterSaver: false,
    /** 流转面板开关：由结果区按钮打开，面板关闭时反向复位 */
    workflowPanelVisible: false,
    /** 草稿恢复条：仅在表单未被改动时出现 */
    draftPromptVisible: false,
    /** 结果导出状态 */
    exportReady: false,
    exportPending: false,
    exportHint: '',
    exportShareSupported: true,
    footerQuote: '',
  },

  observers: {
    sensitive(value: string) {
      const session = resolveToolSession(this.data.toolId)
      this.setData({ privacyText: privacyTextFor(value || session.sensitive) })
    },

    /** 结果出现：延迟 1.2s 入轨迹，输入型工具只记录稳定后的最终结果 */
    hasResult(value: boolean) {
      if (!value) {
        /* 结果消失时关闭流转面板，避免用过期载荷继续流转 */
        if (this.data.workflowPanelVisible) {
          this.setData({ workflowPanelVisible: false })
        }
        this.resetExport()
        return
      }
      const self = this as unknown as {
        scheduleResultTrack: () => void
        scheduleExportPrepare: () => void
      }
      self.scheduleResultTrack()
      self.scheduleExportPrepare()
    },

    'exportEnabled, exportContent, exportName, exportType'() {
      const self = this as unknown as { scheduleExportPrepare: () => void }
      self.scheduleExportPrepare()
    },

    /** 同一页面重复计算 / 输入型工具结果变化：重新防抖 */
    posterData() {
      if (!this.data.hasResult) {
        return
      }
      const self = this as unknown as { scheduleResultTrack: () => void }
      self.scheduleResultTrack()
    },
  },

  lifetimes: {
    attached() {
      this.setData({ fsClass: syncFontScaleClass() })
      const holder = this as unknown as ShellState
      holder.scrollTimer = 0
      holder.posterStartTimer = 0
      holder.posterSeq = 0
      holder.trackTimer = 0
      holder.pendingTrackSig = ''
      holder.lastTrackSig = ''
      holder.lastTrackAt = 0
      holder.exportTimer = 0
      holder.exportSeq = 0
      holder.exportPath = ''
      holder.draftPage = null
      holder.draftPromptTimer = 0
      holder.draftPromptChecked = false
      holder.draftBaseline = null
      holder.draftBaselineTimer = 0
      try {
        const pages = getCurrentPages()
        const current = pages.length ? pages[pages.length - 1] : null
        holder.draftPage = (current as unknown as DraftPageBridge) ?? null
      } catch {
        /* 页面栈不可读时草稿能力静默关闭 */
      }
      const session = resolveToolSession(this.data.toolId)
      const codeLabel = (this.data.toolId || 'local').toUpperCase()
      const windowInfo = wx.getWindowInfo()
      const capsule = wx.getMenuButtonBoundingClientRect()
      const headInset = Math.max(0, capsule.bottom - (windowInfo.statusBarHeight ?? 0))
      const navRight = Math.max(16, (windowInfo.windowWidth || 375) - capsule.left + 8)
      this.setData({
        privacyText: privacyTextFor(this.data.sensitive || session.sensitive),
        codeLabel,
        kickerLabel: this.data.kicker || session.kicker,
        headInset,
        navRight,
        exportShareSupported: canShareFile(),
        footerQuote: nextFooterQuote(),
      })

      holder.themeBindings = createStoreBindings(this, {
        store: uiStore,
        fields: {
          themeClass: () => uiStore.themeClass,
          themeSwitching: () => uiStore.themeSwitching,
        },
        actions: [],
      })

      toolboxStore.init()
      holder.toolboxBindings = createStoreBindings(this, {
        store: toolboxStore,
        fields: {
          isFavorite: () => toolboxStore.isFavorite(this.data.toolId),
        },
        actions: [],
      })

      if (this.data.toolId) {
        /* 工具页每打开一次，首页「累计打开」+1 */
        toolboxStore.recordOpen(this.data.toolId)
      }
    },

    detached() {
      const holder = this as unknown as ShellState
      /* 页面卸载前最后落一次草稿；失败静默，不打断返回 */
      const draftSelf = this as unknown as {
        saveDraftFromPage: (notifyFailure: boolean) => void
      }
      draftSelf.saveDraftFromPage(false)
      if (holder.draftPromptTimer) {
        clearTimeout(holder.draftPromptTimer)
        holder.draftPromptTimer = 0
      }
      if (holder.draftBaselineTimer) {
        clearTimeout(holder.draftBaselineTimer)
        holder.draftBaselineTimer = 0
      }
      /* 页面离开时把防抖中的结果立即入轨迹，避免「刚算完就返回」丢记录 */
      if (holder.trackTimer) {
        clearTimeout(holder.trackTimer)
        holder.trackTimer = 0
        const self = this as unknown as { trackResult: () => void }
        self.trackResult()
      }
      if (holder.scrollTimer) {
        clearTimeout(holder.scrollTimer)
      }
      if (holder.posterStartTimer) {
        clearTimeout(holder.posterStartTimer)
      }
      if (holder.exportTimer) {
        clearTimeout(holder.exportTimer)
        holder.exportTimer = 0
      }
      holder.exportSeq = (holder.exportSeq || 0) + 1
      if (holder.exportPath) {
        cleanupExport(holder.exportPath)
        holder.exportPath = ''
      }
      /* 页面已卸载：让在途生成结果失效，避免卸载后回填 setData */
      holder.posterSeq = (holder.posterSeq || 0) + 1
      if (holder.themeBindings) {
        holder.themeBindings.destroyStoreBindings()
      }
      if (holder.toolboxBindings) {
        holder.toolboxBindings.destroyStoreBindings()
      }
      /* 【防漏点】页面卸载：清空 current / pendingJump / 撤销栈，图片进入孤儿队列批量释放 */
      workflowStore.clear()
    },
  },

  pageLifetimes: {
    show() {
      /* 从设置页返回时字号档可能已变化，先同步根类再处理其它页面逻辑 */
      this.setData({ fsClass: syncFontScaleClass() })
      uiStore.syncNativeChrome()
      const self = this as unknown as { scheduleDraftPrompt: () => void }
      self.scheduleDraftPrompt()
    },
    /** 切后台 / 去下一级页面前保存草稿；保留原有轨迹落盘逻辑 */
    hide() {
      const draftSelf = this as unknown as {
        saveDraftFromPage: (notifyFailure: boolean) => void
      }
      draftSelf.saveDraftFromPage(false)
      const holder = this as unknown as ShellState
      if (!holder.trackTimer) {
        return
      }
      clearTimeout(holder.trackTimer)
      holder.trackTimer = 0
      const self = this as unknown as { trackResult: () => void }
      self.trackResult()
    },
  },

  methods: {
    onBack() {
      /* 【防漏点】面板打开时优先关闭面板，不执行页面后退 */
      if (this.data.workflowPanelVisible) {
        tapTick()
        /* 【防漏点】关闭面板瞬间清空会话与 pendingJump，但保留目标页仍在展示的注入图片 */
        workflowStore.clear(false)
        this.setData({ workflowPanelVisible: false })
        return
      }
      tapTick()
      wx.navigateBack({
        fail: () => {
          wx.reLaunch({ url: ROUTES.home })
        },
      })
    },

    onToggleFavorite() {
      const id = this.data.toolId
      if (!id) {
        return
      }
      tapTick()
      const result = toggleFavoriteTool(id)
      if (result === 'full') {
        tapWarn()
        showGlassToast({ message: '收藏已满（最多 100 个）', type: 'warning' })
        return
      }
      if (result === 'failed' || result === 'invalid') {
        tapWarn()
        showGlassToast({ message: '收藏失败，请重试', type: 'error' })
        return
      }
      showGlassToast({
        message: result === 'added' ? '已收藏工具' : '已取消收藏',
        type: result === 'added' ? 'success' : 'info',
      })
    },

    onRun() {
      if (this.data.state === 'running') {
        return
      }
      if (!this.data.canRun) {
        showGlassToast('请先完成输入')
        return
      }
      tapTick()
      if (this.data.draftPromptVisible) {
        this.setData({ draftPromptVisible: false })
      }
      /* 计算前先落草稿：此时页面数据仍是纯输入态，不包含即将生成的结果 */
      this.saveDraftFromPage(true)
      wx.hideKeyboard({ fail: () => undefined })
      this.triggerEvent('run')
    },

    onReset() {
      tapTick()
      this.triggerEvent('reset')
      if (this.data.toolId) {
        clearDraft(this.data.toolId)
      }
      if (this.data.draftPromptVisible) {
        this.setData({ draftPromptVisible: false })
      }
      /* 重置后的默认值作为新基线，避免离开页面时把默认值误写成草稿 */
      const holder = this as unknown as ShellState
      if (holder.draftBaselineTimer) {
        clearTimeout(holder.draftBaselineTimer)
      }
      holder.draftBaselineTimer = setTimeout(() => {
        holder.draftBaseline = this.resolveDraftSnapshot()
      }, 0) as unknown as number
      if (holder.scrollTimer) {
        clearTimeout(holder.scrollTimer)
      }
      this.setData({ scrollTarget: 'glass-tool-top' })
      holder.scrollTimer = setTimeout(() => {
        this.setData({ scrollTarget: '' })
        holder.scrollTimer = 0
      }, TIMING.TOOL_SCROLL_RESET) as unknown as number
    },

    onExample() {
      tapTick()
      if (this.data.draftPromptVisible) {
        this.setData({ draftPromptVisible: false })
      }
      this.triggerEvent('example')
    },

    /* ---- 草稿：首次 show 记录基线，600ms 后确认表单未被改动才提示恢复 ---- */
    /** 读取当前页输入快照；未接入草稿或读取失败返回 null */
    resolveDraftSnapshot(): string | null {
      const holder = this as unknown as ShellState
      const page = holder.draftPage
      if (!page || typeof page.collectDraftInput !== 'function') {
        return null
      }
      try {
        const input = page.collectDraftInput() || {}
        const mode = typeof page.draftMode === 'function' ? page.draftMode() : ''
        const normalized: DraftSnapshot = {
          mode: typeof mode === 'string' ? mode : '',
          input,
        }
        return JSON.stringify(normalized)
      } catch {
        return null
      }
    },

    /** 首次 show：同步记录基线，再延迟检查草稿，避开 workflow 注入与异步初始化 */
    scheduleDraftPrompt() {
      const holder = this as unknown as ShellState
      if (holder.draftPromptChecked) {
        return
      }
      holder.draftPromptChecked = true
      holder.draftBaseline = this.resolveDraftSnapshot()
      if (holder.draftBaseline === null || !this.data.toolId) {
        return
      }
      if (holder.draftPromptTimer) {
        clearTimeout(holder.draftPromptTimer)
      }
      holder.draftPromptTimer = setTimeout(() => {
        holder.draftPromptTimer = 0
        this.checkDraftPrompt()
      }, DRAFT_PROMPT_DELAY) as unknown as number
    },

    checkDraftPrompt() {
      const toolId = this.data.toolId
      const holder = this as unknown as ShellState
      const page = holder.draftPage
      if (
        !toolId ||
        !page ||
        typeof page.collectDraftInput !== 'function' ||
        typeof page.applyDraftInput !== 'function'
      ) {
        return
      }
      if (!draftAllowed(toolId)) {
        return
      }
      /* 有 workflow 待注入时优先让流转数据落位，不弹恢复条 */
      if (isWorkflowToolId(toolId) && workflowStore.peekPendingJump(toolId)) {
        return
      }
      const snapshot = this.resolveDraftSnapshot()
      if (snapshot === null || snapshot !== holder.draftBaseline) {
        return
      }
      if (!readDraft(toolId)) {
        return
      }
      this.setData({ draftPromptVisible: true })
    },

    /** 页面动过才写草稿；未动过时绝不把默认值写成“上次输入” */
    saveDraftFromPage(notifyFailure: boolean) {
      const toolId = this.data.toolId
      const holder = this as unknown as ShellState
      const page = holder.draftPage
      if (!toolId || !page || typeof page.collectDraftInput !== 'function') {
        return
      }
      if (!draftAllowed(toolId)) {
        return
      }
      const snapshot = this.resolveDraftSnapshot()
      if (snapshot === null) {
        return
      }
      let parsed: DraftSnapshot
      try {
        parsed = JSON.parse(snapshot) as DraftSnapshot
      } catch {
        return
      }
      const empty = Object.keys(parsed.input).length === 0
      if (holder.draftBaseline === null) {
        /* 基线缺失（show 未触发）：只在有输入时保存，避免写默认值 */
        if (empty) {
          return
        }
      } else if (snapshot === holder.draftBaseline) {
        return
      }
      if (empty) {
        clearDraft(toolId)
        return
      }
      const result = saveDraft(toolId, { mode: parsed.mode, input: parsed.input })
      if (result === 'failed' && notifyFailure) {
        showGlassToast({ message: '草稿保存失败，本次输入未保留', type: 'warning' })
      }
    },

    onDraftDismiss() {
      tapTick()
      this.setData({ draftPromptVisible: false })
    },

    onDraftRestore() {
      const toolId = this.data.toolId
      const holder = this as unknown as ShellState
      const page = holder.draftPage
      if (!toolId || !page || typeof page.applyDraftInput !== 'function') {
        this.setData({ draftPromptVisible: false })
        return
      }
      const draft = readDraft(toolId)
      if (!draft) {
        this.setData({ draftPromptVisible: false })
        return
      }
      /* 用户可能在提示条出现后继续输入：已有内容时绝不覆盖 */
      const snapshot = this.resolveDraftSnapshot()
      if (snapshot !== null && holder.draftBaseline !== null && snapshot !== holder.draftBaseline) {
        this.setData({ draftPromptVisible: false })
        showGlassToast({ message: '表单已有内容，已取消恢复', type: 'warning' })
        return
      }
      tapTick()
      try {
        page.applyDraftInput(draft.input, draft.mode)
      } catch {
        showGlassToast({ message: '恢复失败，请重新输入', type: 'error' })
        return
      }
      this.setData({ draftPromptVisible: false })
      /* 恢复即视为一次使用：刷新 at，避免用户只恢复不修改时 30 天后被淘汰 */
      saveDraft(toolId, { mode: draft.mode, input: draft.input })
      /* 恢复后页面会重算结果；把恢复态作为新基线，避免再被判定为“已修改” */
      holder.draftBaseline = JSON.stringify({ mode: draft.mode, input: draft.input })
      if (holder.draftBaselineTimer) {
        clearTimeout(holder.draftBaselineTimer)
      }
      holder.draftBaselineTimer = setTimeout(() => {
        holder.draftBaseline = this.resolveDraftSnapshot()
      }, 0) as unknown as number
      showGlassToast({ message: '已恢复上次输入', type: 'success' })
    },

    /** 使用说明：跳帮助页并自动展开当前工具 */
    onOpenHelp() {
      if (!this.data.toolId) {
        return
      }
      tapTick()
      wx.navigateTo({
        url: `${ROUTES.help}?tool=${encodeURIComponent(this.data.toolId)}`,
        fail: () => {
          showGlassToast({ message: '使用说明打开失败', type: 'error' })
        },
      })
    },

    /** 打开流转面板：只有存在结果时允许，防重复打开 */
    onWorkflowTap() {
      if (!this.data.hasResult || this.data.workflowPanelVisible) {
        return
      }
      this.setData({ workflowPanelVisible: true })
    },

    /** 面板主动关闭：只复位开关，清理由面板按会话状态处理 */
    onWorkflowPanelClose() {
      if (!this.data.workflowPanelVisible) {
        return
      }
      this.setData({ workflowPanelVisible: false })
    },

    /* ---- 全局埋点：结果出现后短防抖入轨迹，覆盖 23 个工具的默认链路 ---- */
    scheduleResultTrack() {
      const holder = this as unknown as ShellState
      const poster = normalizePosterData(this.data.posterData)
      if (!poster || !this.data.toolId) {
        return
      }
      const signature = `${this.data.toolId}|${poster.mainResult}|${poster.params
        .map((item) => `${item.label}:${item.value}`)
        .join('|')}|${poster.extras.join('|')}`
      const now = Date.now()
      /* 同一次结果的多路触发：已记录或已在队列里，直接忽略 */
      if (signature === holder.lastTrackSig && now - holder.lastTrackAt < 1000) {
        return
      }
      if (holder.trackTimer && signature === holder.pendingTrackSig) {
        return
      }
      if (holder.trackTimer) {
        clearTimeout(holder.trackTimer)
      }
      holder.pendingTrackSig = signature
      holder.trackTimer = setTimeout(() => {
        holder.trackTimer = 0
        this.trackResult()
      }, TRACK_DEBOUNCE_MS) as unknown as number
    },

    trackResult() {
      const holder = this as unknown as ShellState
      holder.pendingTrackSig = ''
      const poster = normalizePosterData(this.data.posterData)
      if (!poster || !this.data.toolId) {
        return
      }
      /* 同一次结果重复触发（hasResult 与 posterData 同时变更）只记一条 */
      const signature = `${this.data.toolId}|${poster.mainResult}|${poster.params
        .map((item) => `${item.label}:${item.value}`)
        .join('|')}|${poster.extras.join('|')}`
      const now = Date.now()
      if (signature === holder.lastTrackSig && now - holder.lastTrackAt < 1000) {
        return
      }
      holder.lastTrackSig = signature
      holder.lastTrackAt = now
      recordToolResult({
        toolId: this.data.toolId,
        toolName: this.data.title || poster.toolName,
        poster,
      })
    },

    /* ---- 结果导出：预写文件、tap 内同步分享、失败降级复制 ---- */
    resolveExportFormat(): ExportFormat {
      const raw = String(this.data.exportType || '').toLowerCase() as ExportFormat
      return EXPORT_FORMATS.includes(raw) ? raw : 'txt'
    },

    /** 页面显式 exportContent 优先；未传时用海报数据拼最小文本 */
    resolveExportContent(): string {
      const raw = String(this.data.exportContent || '')
      if (raw.trim()) {
        return raw
      }
      const poster = normalizePosterData(this.data.posterData)
      if (!poster) {
        return ''
      }
      return [
        poster.toolName,
        `${poster.resultLabel}：${poster.mainResult}`,
        ...poster.params.map((item) => `${item.label}：${item.value}`),
        ...poster.extras,
      ].join('\n')
    },

    exportDisplayName(): string {
      const raw = this.data.exportName || this.data.title || '超欢结果'
      return `${sanitizeExportName(raw)}.${this.resolveExportFormat()}`
    },

    scheduleExportPrepare() {
      const holder = this as unknown as ShellState
      if (holder.exportTimer) {
        clearTimeout(holder.exportTimer)
        holder.exportTimer = 0
      }
      if (!this.data.exportEnabled || !this.data.hasResult) {
        this.resetExport()
        return
      }
      holder.exportTimer = setTimeout(() => {
        holder.exportTimer = 0
        this.prepareExportFile()
      }, EXPORT_DEBOUNCE_MS) as unknown as number
    },

    prepareExportFile() {
      if (!this.data.exportEnabled || !this.data.hasResult) {
        this.resetExport()
        return
      }
      const content = this.resolveExportContent()
      if (!content.trim()) {
        this.setData({ exportReady: false, exportPending: false, exportHint: '' })
        return
      }
      const holder = this as unknown as ShellState
      holder.exportSeq = (holder.exportSeq || 0) + 1
      const seq = holder.exportSeq
      this.setData({ exportPending: true, exportHint: '' })
      prepareExport({
        filename: this.data.exportName || this.data.title || '超欢结果',
        content,
        format: this.resolveExportFormat(),
      }).then((result) => {
        if (seq !== holder.exportSeq) {
          /* 结果已变化或页面已卸载：回收迟到的预写文件 */
          if (result.ok) {
            cleanupExport(result.path)
          }
          return
        }
        if (!result.ok) {
          const hint =
            result.reason === 'too-large'
              ? '内容超过 2MB，仅支持复制'
              : result.reason === 'empty'
                ? ''
                : '文件准备失败，可复制内容'
          this.setData({ exportReady: false, exportPending: false, exportHint: hint })
          return
        }
        if (holder.exportPath && holder.exportPath !== result.path) {
          cleanupExport(holder.exportPath)
        }
        holder.exportPath = result.path
        this.setData({ exportReady: true, exportPending: false, exportHint: '' })
      })
    },

    resetExport() {
      const holder = this as unknown as ShellState
      if (holder.exportTimer) {
        clearTimeout(holder.exportTimer)
        holder.exportTimer = 0
      }
      holder.exportSeq = (holder.exportSeq || 0) + 1
      if (holder.exportPath) {
        cleanupExport(holder.exportPath)
        holder.exportPath = ''
      }
      if (this.data.exportReady || this.data.exportPending || this.data.exportHint) {
        this.setData({ exportReady: false, exportPending: false, exportHint: '' })
      }
    },

    copyExportContent() {
      const content = this.resolveExportContent()
      if (!content.trim()) {
        showGlassToast('暂无可导出的内容')
        return
      }
      void copyText(content, '结果内容已复制')
    },

    onExportTap() {
      if (!this.data.exportEnabled || !this.data.hasResult) {
        return
      }
      tapTick()
      const holder = this as unknown as ShellState
      if (!this.data.exportReady || !holder.exportPath || !this.data.exportShareSupported) {
        this.copyExportContent()
        return
      }
      sharePrepared(holder.exportPath, this.exportDisplayName()).then((outcome) => {
        if (outcome === 'cancelled') {
          showGlassToast({ message: '已取消', type: 'info' })
          return
        }
        if (outcome !== 'shared') {
          this.copyExportContent()
        }
      })
    },

    /* ---- 极光海报：纯本地 Canvas 生成 + 预览 ---- */
    /** 优先读取页面显式 posterValue，其次兼容常见结果字段，绝不取空 */
    resolvePosterValue(): string {
      if (this.data.posterValue) {
        return this.data.posterValue
      }
      try {
        const pages = getCurrentPages() as unknown as Array<{
          data?: Record<string, unknown>
        }>
        const current = pages.length ? pages[pages.length - 1] : null
        const data = current && current.data ? current.data : {}
        const keys = ['posterValue', 'result', 'resultText', 'totalText', 'primaryText', 'outputText', 'answer']
        for (const key of keys) {
          const raw = data[key]
          if (typeof raw === 'number' && Number.isFinite(raw)) {
            return String(raw)
          }
          if (typeof raw === 'string' && raw.trim()) {
            const text = raw.trim()
            return text.length > 160 ? `${text.slice(0, 160)}…` : text
          }
        }
      } catch {
        /* 页面数据不可读时静默回退 */
      }
      return '本机计算已完成 · 结果只留在你的设备'
    },

    resolvePosterSubtitle(): string {
      if (this.data.posterSub) {
        return this.data.posterSub
      }
      try {
        const pages = getCurrentPages() as unknown as Array<{
          data?: Record<string, unknown>
        }>
        const current = pages.length ? pages[pages.length - 1] : null
        const data = current && current.data ? current.data : {}
        const raw = data.posterSub || data.formula
        if (typeof raw === 'string' && raw.trim()) {
          return raw.trim()
        }
      } catch {
        /* 静默回退 */
      }
      return this.data.desc || '本机计算 · 不上传 · 轨迹摘要仅存本机'
    },

    onGeneratePoster() {
      if (this.data.isGenerating || !this.data.hasResult) {
        return
      }
      const generator = this.selectComponent(
        '#posterGenerator',
      ) as unknown as PosterGeneratorInstance | null
      if (!generator || typeof generator.generate !== 'function') {
        tapWarn()
        showGlassToast({
          message: '海报引擎尚未就绪，请稍后重试',
          type: 'warning',
          placement: 'lower-center',
        })
        return
      }

      tapTick()
      /* 显式接入全局音效接管：生成前预热，受静音开关管辖 */
      void useSound().preload()
      const tool = resolveToolSession(this.data.toolId).meta
      const meta = {
        toolId: this.data.toolId,
        theme: uiStore.resolvedTheme,
        date: new Date().toLocaleDateString('zh-CN'),
      }
      /* 工具页显式传入的 IPosterData 优先；旧字段只作为未迁移页面的兜底 */
      const poster = normalizePosterData(this.data.posterData)
      const fallbackSub = this.resolvePosterSubtitle()
      const payload: PosterPayload = poster
        ? { ...poster, ...meta }
        : {
            toolName: this.data.title || tool?.name || '超欢工具',
            category: resolvePosterCategory(tool?.category),
            mainResult: this.resolvePosterValue(),
            resultLabel: '本机结果',
            params: [],
            extras: fallbackSub ? [fallbackSub] : [],
            ...meta,
          }
      const holder = this as unknown as ShellState
      holder.posterSeq = (holder.posterSeq || 0) + 1
      const seq = holder.posterSeq
      if (holder.posterStartTimer) {
        clearTimeout(holder.posterStartTimer)
        holder.posterStartTimer = 0
      }

      /* 先打开玻璃预览骨架，用户点击后立刻获得视觉响应；
         入场动画落位后再开始 Canvas 绘制，绘制不会抢走过渡帧。 */
      const saver = useMotion().level === 'saver'
      this.setData({
        posterVisible: true,
        posterPath: '',
        posterError: '',
        posterSaver: saver,
        isGenerating: true,
      })

      holder.posterStartTimer = setTimeout(() => {
        holder.posterStartTimer = 0
        generator
          .generate(payload)
          .then((path) => {
            if (seq !== holder.posterSeq || !this.data.posterVisible) {
              return
            }
            if (!path) {
              throw new Error('海报文件为空')
            }
            this.setData({
              posterPath: path,
              posterError: '',
              isGenerating: false,
            })
          })
          .catch((error) => {
            if (seq !== holder.posterSeq) {
              return
            }
            this.setData({
              isGenerating: false,
              posterError: '极光海报生成失败，请关闭后重试',
            })
            tapWarn()
            /* 真机现场保留错误，便于排查 Canvas 兼容问题 */
            console.warn('[glass-tool-shell] poster generate failed', error)
          })
      }, saver ? POSTER_SAVER_DELAY : POSTER_START_DELAY) as unknown as number
    },

    onPosterClose() {
      const holder = this as unknown as ShellState
      holder.posterSeq = (holder.posterSeq || 0) + 1
      if (holder.posterStartTimer) {
        clearTimeout(holder.posterStartTimer)
        holder.posterStartTimer = 0
      }
      this.setData({
        posterVisible: false,
        posterError: '',
        isGenerating: false,
      })
    },

    onPosterClosed() {
      this.setData({
        posterVisible: false,
        posterPath: '',
        posterError: '',
        isGenerating: false,
      })
    },
  },
})
