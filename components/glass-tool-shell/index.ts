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
import { TOOLS } from '../../core/toolbox/registry'
import { ROUTES, TIMING } from '../../core/constants/index'
import { tapTick, tapWarn } from '../../core/utils/haptics'
import { useMotion } from '../../core/services/motion'
import { useSound } from '../../core/services/sound'
import { showGlassToast } from '../glass-toast/toast'
import { normalizePosterData, resolvePosterCategory } from '../../core/toolbox/poster'
import { recordToolResult } from '../../core/toolbox/tracker'
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
}

interface PosterGeneratorInstance {
  generate(payload: PosterPayload): Promise<string>
}

/** 预览弹簧入场约 550ms：等它完全落位后再开始 Canvas 绘制，绘制不抢过渡帧 */
const POSTER_START_DELAY = 560
/** 省电模式预览只做 220ms 透明度渐变，绘制可以更早接管 */
const POSTER_SAVER_DELAY = 240
/** 结果埋点短防抖：只合并同一结果的多路触发，160ms 内连续计算仍分别记录 */
const TRACK_DEBOUNCE_MS = 160

function privacyTextFor(sensitive: string): string {
  if (sensitive === 'privacy') {
    return '图片只在本机处理，不会上传服务器'
  }
  if (sensitive === 'finance') {
    return '试算结果仅供参考，不构成金融建议'
  }
  if (sensitive === 'health') {
    return '结果仅供参考，不构成医疗建议'
  }
  return ''
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
  },

  data: {
    themeClass: uiStore.themeClass,
    themeSwitching: false,
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
  },

  observers: {
    sensitive(value: string) {
      this.setData({ privacyText: privacyTextFor(value) })
    },

    /** 结果出现：延迟 1.2s 入轨迹，输入型工具只记录稳定后的最终结果 */
    hasResult(value: boolean) {
      if (!value) {
        /* 结果消失时关闭流转面板，避免用过期载荷继续流转 */
        if (this.data.workflowPanelVisible) {
          this.setData({ workflowPanelVisible: false })
        }
        return
      }
      const self = this as unknown as { scheduleResultTrack: () => void }
      self.scheduleResultTrack()
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
      const holder = this as unknown as ShellState
      holder.scrollTimer = 0
      holder.posterStartTimer = 0
      holder.posterSeq = 0
      holder.trackTimer = 0
      holder.pendingTrackSig = ''
      holder.lastTrackSig = ''
      holder.lastTrackAt = 0
      const meta = TOOLS.find((tool) => tool.id === this.data.toolId)
      const codeLabel = (this.data.toolId || 'local').toUpperCase()
      const windowInfo = wx.getWindowInfo()
      const capsule = wx.getMenuButtonBoundingClientRect()
      const headInset = Math.max(0, capsule.bottom - (windowInfo.statusBarHeight ?? 0))
      const navRight = Math.max(16, (windowInfo.windowWidth || 375) - capsule.left + 8)
      this.setData({
        privacyText: privacyTextFor(this.data.sensitive),
        codeLabel,
        kickerLabel: this.data.kicker || (meta?.category ?? 'tool').toUpperCase(),
        headInset,
        navRight,
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
      uiStore.syncNativeChrome()
    },
    /** 切后台前把防抖中的结果轨迹立即落盘 */
    hide() {
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
      const added = toolboxStore.toggleFavorite(id)
      if (added === null) {
        tapWarn()
        showGlassToast({ message: '收藏失败，请重试', type: 'error' })
        return
      }
      showGlassToast({
        message: added ? '已收藏工具' : '已取消收藏',
        type: added ? 'success' : 'info',
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
      wx.hideKeyboard({ fail: () => undefined })
      this.triggerEvent('run')
    },

    onReset() {
      tapTick()
      this.triggerEvent('reset')
      const holder = this as unknown as ShellState
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
      this.triggerEvent('example')
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
      const tool = TOOLS.find((item) => item.id === this.data.toolId)
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
