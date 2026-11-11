/* ==========================================================================
   专业文本对比 · 字符级 / 行级 Diff
   - diff-match-patch 只在 tools-core 分包内运行，主包零依赖
   - setTimeout 宏任务先渲染极光 Loading，再执行算法
   - rich-text Nodes 渲染，差异块数超限自动降级
   - Workflow 接收端：原文本自动填入并触发对比
   ========================================================================== */
import { createStoreBindings } from 'mobx-miniprogram-bindings'
import { tapSuccess, tapTick, tapWarn } from '../../../../core/utils/haptics'
import { uiStore } from '../../../../core/stores/ui'
import type { IWorkflowData } from '../../../../core/workflow/types'
import type { IPosterData } from '../../../../core/toolbox/poster'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import { copyText } from '../../lib/ui'
import {
  buildDiffReport,
  buildHighlightedText,
  computeTextDiff,
  type DiffSegment,
} from '../../utils/diffEngine'
import {
  diffSegmentsToRichText,
  type RichTextNode,
} from '../../utils/diffToRichText'

const MAX_DIFF_CHARS = 50000
/** 先让 Loading 渲染一帧，再进入同步算法 */
const COMPUTE_DELAY = 32
/** 双栏同步滚动的反馈锁时长；低端机滚动事件可能延迟 */
const SYNC_LOCK_MS = 200

const EXAMPLE_ORIGINAL =
  '真正的效率，不是把每一分钟都排满，而是把注意力留给真正重要的事。\n' +
  '工具应该安静地完成重复计算，把时间还给生活。\n' +
  '所有数据只在本机处理，不上传服务器。'
const EXAMPLE_MODIFIED =
  '真正的效率，不是把每一分钟都排满，而是把注意力留给真正重要的事情。\n' +
  '好工具应该安静地完成重复计算，把时间还给生活。\n' +
  '所有文本只在本机处理，不会上传服务器。'

interface DiffPageStats {
  changeText: string
  insertText: string
  deleteText: string
}

interface DiffPageRuntime {
  seq: number
  timer: number
  comparing: boolean
  destroyed: boolean
  syncFrom: 'original' | 'modified' | ''
  syncTimer: number
  themeBindings?: { destroyStoreBindings: () => void }
}

const EMPTY_RESULT_PATCH = {
  hasResult: false,
  summaryText: '',
  differencesText: '0',
  stats: { changeText: '0', insertText: '0', deleteText: '0' } as DiffPageStats,
  originalNodes: [] as RichTextNode[],
  modifiedNodes: [] as RichTextNode[],
  compacted: false,
  timedOut: false,
  reportText: '',
  highlightText: '',
  flowPayload: '',
  posterData: null as IPosterData | null,
  originalTop: 0,
  modifiedTop: 0,
}

function runtimeOf(page: unknown): DiffPageRuntime {
  const holder = page as { __diffRuntime?: DiffPageRuntime }
  if (!holder.__diffRuntime) {
    holder.__diffRuntime = {
      seq: 0,
      timer: 0,
      comparing: false,
      destroyed: false,
      syncFrom: '',
      syncTimer: 0,
    }
  }
  return holder.__diffRuntime
}

function codePointLength(text: string): number {
  return Array.from(text).length
}

/** 统计某一侧被改动的字符数，用于计算可解释的差异率 */
function countChangedChars(
  segments: DiffSegment[],
  type: 'insert' | 'delete',
): number {
  return segments.reduce((total, segment) => {
    return segment.type === type ? total + codePointLength(segment.text) : total
  }, 0)
}

/**
 * 差异率 = 改动字符数 / 两侧总字符数，天然落在 0~100%。
 * 海报只展示统计结论，不塞入任何原文，避免长文本撑破版面。
 */
function formatDiffRate(
  originalChars: number,
  modifiedChars: number,
  changedChars: number,
): string {
  const total = originalChars + modifiedChars
  if (total <= 0 || changedChars <= 0) {
    return '0'
  }
  const rate = Math.min(100, (changedChars / total) * 100)
  if (rate < 0.1) {
    return '<0.1'
  }
  return String(Number(rate.toFixed(1)))
}

function buildDiffPoster(input: {
  originalChars: number
  modifiedChars: number
  insertCount: number
  deleteCount: number
  elapsedMs: number
  changedChars: number
}): IPosterData {
  return {
    toolName: '专业文本对比',
    category: '文本效率',
    mainResult: `差异率 ${formatDiffRate(
      input.originalChars,
      input.modifiedChars,
      input.changedChars,
    )}%`,
    resultLabel: '比对结果',
    params: [
      { label: '原文本长度', value: `${input.originalChars} 字` },
      { label: '新文本长度', value: `${input.modifiedChars} 字` },
    ],
    extras: [
      `新增: ${input.insertCount} 处`,
      `删除: ${input.deleteCount} 处`,
      `耗时: ${input.elapsedMs}ms`,
    ],
  }
}

Page({
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: '文本对比',
    kicker: '文本效率',
    desc: '字符级 / 行级专业差异对比',
    themeClass: uiStore.themeClass,
    original: '',
    modified: '',
    originalCount: 0,
    modifiedCount: 0,
    ignoreCase: false,
    ignoreSpace: true,
    state: 'idle',
    canRun: false,
    hasResult: false,
    error: '',

    summaryText: '',
    differencesText: '0',
    stats: { changeText: '0', insertText: '0', deleteText: '0' } as DiffPageStats,
    originalNodes: [] as RichTextNode[],
    modifiedNodes: [] as RichTextNode[],
    compacted: false,
    timedOut: false,
    reportText: '',
    highlightText: '',
    flowMode: 'report' as 'report' | 'highlight',
    flowPayload: '',
    posterData: null as IPosterData | null,

    originalTop: 0,
    modifiedTop: 0,

    tooLongShow: false,
    tooLongText: '',
  },

  onLoad() {
    const runtime = runtimeOf(this)
    runtime.destroyed = false
    runtime.themeBindings = createStoreBindings(this, {
      store: uiStore,
      fields: { themeClass: () => uiStore.themeClass },
      actions: [],
    })
  },

  onUnload() {
    const runtime = runtimeOf(this)
    runtime.destroyed = true
    runtime.seq += 1
    runtime.comparing = false
    if (runtime.themeBindings) {
      runtime.themeBindings.destroyStoreBindings()
      runtime.themeBindings = undefined
    }
    if (runtime.timer) {
      clearTimeout(runtime.timer)
      runtime.timer = 0
    }
    if (runtime.syncTimer) {
      clearTimeout(runtime.syncTimer)
      runtime.syncTimer = 0
    }
  },

  onOriginalInput(event: WechatMiniprogram.TextareaInput) {
    if (this.data.state === 'running') {
      return
    }
    const original = event.detail.value
    const originalCount = codePointLength(original)
    this.setData({
      ...EMPTY_RESULT_PATCH,
      original,
      originalCount,
      error: '',
      canRun: Boolean(original.trim() && this.data.modified.trim()),
    })
  },

  onModifiedInput(event: WechatMiniprogram.TextareaInput) {
    if (this.data.state === 'running') {
      return
    }
    const modified = event.detail.value
    const modifiedCount = codePointLength(modified)
    this.setData({
      ...EMPTY_RESULT_PATCH,
      modified,
      modifiedCount,
      error: '',
      canRun: Boolean(this.data.original.trim() && modified.trim()),
    })
  },

  onIgnoreCaseChange(event: { detail: { value: boolean } }) {
    if (this.data.state === 'running') {
      return
    }
    const shouldRecompare = this.data.hasResult
    this.setData({ ignoreCase: event.detail.value }, () => {
      if (shouldRecompare) {
        this.onCompare()
      }
    })
  },

  onIgnoreSpaceChange(event: { detail: { value: boolean } }) {
    if (this.data.state === 'running') {
      return
    }
    const shouldRecompare = this.data.hasResult
    this.setData({ ignoreSpace: event.detail.value }, () => {
      if (shouldRecompare) {
        this.onCompare()
      }
    })
  },

  /**
   * 开始对比：
   * 1. 空值 / 超长校验
   * 2. 立刻进入 running 并锁住按钮
   * 3. setTimeout 宏任务先渲染 Loading，再跑算法
   */
  onCompare() {
    const runtime = runtimeOf(this)
    if (runtime.comparing || this.data.state === 'running') {
      return
    }
    const original = this.data.original
    const modified = this.data.modified
    if (!original.trim() || !modified.trim()) {
      this.setData({ error: '请先填写原文本和新文本，再开始对比' })
      tapWarn()
      return
    }

    const originalChars = codePointLength(original)
    const modifiedChars = codePointLength(modified)
    if (originalChars > MAX_DIFF_CHARS || modifiedChars > MAX_DIFF_CHARS) {
      this.setData({
        state: 'idle',
        canRun: true,
        tooLongShow: true,
        tooLongText: `${originalChars > MAX_DIFF_CHARS ? '原文本' : '新文本'}共 ${Math.max(
          originalChars,
          modifiedChars,
        )} 字符，超过 50,000 字符上限。请精简后再对比。`,
      })
      tapWarn()
      return
    }

    runtime.comparing = true
    runtime.seq += 1
    const seq = runtime.seq
    if (runtime.timer) {
      clearTimeout(runtime.timer)
      runtime.timer = 0
    }
    this.setData({
      ...EMPTY_RESULT_PATCH,
      state: 'running',
      canRun: false,
      error: '',
    })

    runtime.timer = setTimeout(() => {
      runtime.timer = 0
      if (runtime.destroyed || seq !== runtime.seq) {
        runtime.comparing = false
        return
      }
      this.runDiff(original, modified, seq)
    }, COMPUTE_DELAY) as unknown as number
  },

  runDiff(original: string, modified: string, seq: number) {
    const runtime = runtimeOf(this)
    try {
      const result = computeTextDiff(original, modified, {
        ignoreCase: this.data.ignoreCase,
        ignoreSpace: this.data.ignoreSpace,
      })
      if (runtime.destroyed || seq !== runtime.seq) {
        runtime.comparing = false
        return
      }
      const originalRich = diffSegmentsToRichText(result.originalSegments)
      const modifiedRich = diffSegmentsToRichText(result.modifiedSegments)
      const summary =
        result.stats.changeCount > 0
          ? `共发现 ${result.stats.changeCount} 处差异（+新增 ${result.stats.insertCount} 处，-删除 ${result.stats.deleteCount} 处）`
          : '两段文本完全一致，没有发现差异'
      const reportText = buildDiffReport(original, modified, result)
      const highlightText = buildHighlightedText(result)
      const flowPayload =
        this.data.flowMode === 'highlight' ? highlightText : reportText
      const originalChars = codePointLength(original)
      const modifiedChars = codePointLength(modified)
      const changedChars =
        countChangedChars(result.originalSegments, 'delete') +
        countChangedChars(result.modifiedSegments, 'insert')
      const poster = buildDiffPoster({
        originalChars,
        modifiedChars,
        insertCount: result.stats.insertCount,
        deleteCount: result.stats.deleteCount,
        elapsedMs: result.elapsedMs,
        changedChars,
      })

      this.setData({
        state: 'idle',
        canRun: true,
        hasResult: true,
        error: '',
        summaryText: summary,
        differencesText: String(result.stats.changeCount),
        stats: {
          changeText: String(result.stats.changeCount),
          insertText: String(result.stats.insertCount),
          deleteText: String(result.stats.deleteCount),
        },
        originalNodes: originalRich.nodes,
        modifiedNodes: modifiedRich.nodes,
        compacted: originalRich.compacted || modifiedRich.compacted,
        timedOut: result.timedOut,
        reportText,
        highlightText,
        flowPayload,
        posterData: poster,
        originalTop: 0,
        modifiedTop: 0,
      })
      runtime.comparing = false
      tapSuccess()
    } catch (error) {
      if (runtime.destroyed || seq !== runtime.seq) {
        runtime.comparing = false
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      this.setData({
        state: 'idle',
        canRun: true,
        hasResult: false,
        error: message || '对比失败，请精简文本后重试',
      })
      runtime.comparing = false
      tapWarn()
    }
  },

  onExample() {
    const runtime = runtimeOf(this)
    if (runtime.comparing) {
      return
    }
    this.setData(
      {
        ...EMPTY_RESULT_PATCH,
        original: EXAMPLE_ORIGINAL,
        modified: EXAMPLE_MODIFIED,
        originalCount: codePointLength(EXAMPLE_ORIGINAL),
        modifiedCount: codePointLength(EXAMPLE_MODIFIED),
        canRun: true,
        error: '',
      },
      () => {
        this.onCompare()
      },
    )
  },

  onReset() {
    const runtime = runtimeOf(this)
    runtime.seq += 1
    runtime.comparing = false
    if (runtime.timer) {
      clearTimeout(runtime.timer)
      runtime.timer = 0
    }
    if (runtime.syncTimer) {
      clearTimeout(runtime.syncTimer)
      runtime.syncTimer = 0
    }
    runtime.syncFrom = ''
    this.setData({
      ...EMPTY_RESULT_PATCH,
      original: '',
      modified: '',
      originalCount: 0,
      modifiedCount: 0,
      state: 'idle',
      canRun: false,
      error: '',
      tooLongShow: false,
      tooLongText: '',
    })
  },

  /** Workflow 接收端：原文本自动填入，新文本已存在时自动触发对比 */
  onReceiveWorkflow(data: IWorkflowData): boolean {
    if (!data || data.type === 'image' || typeof data.payload !== 'string') {
      return false
    }
    const payload = data.payload
    if (!payload.trim()) {
      return false
    }
    const runtime = runtimeOf(this)
    runtime.seq += 1
    runtime.comparing = false
    if (runtime.timer) {
      clearTimeout(runtime.timer)
      runtime.timer = 0
    }
    const modified = this.data.modified
    const canRun = Boolean(payload.trim() && modified.trim())
    this.setData(
      {
        ...EMPTY_RESULT_PATCH,
        state: 'idle',
        original: payload,
        originalCount: codePointLength(payload),
        canRun,
        error: canRun ? '' : '已接收原文本，请填写新文本后开始对比',
      },
      () => {
        if (canRun) {
          this.onCompare()
        }
      },
    )
    return true
  },

  onFlowMode(event: WechatMiniprogram.TouchEvent) {
    const mode = event.currentTarget.dataset.mode
    if (mode !== 'report' && mode !== 'highlight') {
      return
    }
    if (this.data.flowMode === mode) {
      return
    }
    tapTick()
    this.setData({
      flowMode: mode,
      flowPayload:
        mode === 'highlight' ? this.data.highlightText : this.data.reportText,
    })
  },

  onCopyReport() {
    copyText(this.data.reportText, '差异报告已复制')
  },

  onCopyHighlight() {
    copyText(this.data.highlightText, '高亮文本已复制')
  },

  /**
   * 双栏同步滚动：
   * - 滚动 A → 写入 B 的 scroll-top
   * - B 因程序滚动产生的事件由 syncFrom 标记吞掉，避免来回抖动
   */
  onOriginalDiffScroll(event: { detail: { scrollTop: number } }) {
    const runtime = runtimeOf(this)
    if (runtime.syncFrom === 'modified') {
      return
    }
    const top = event.detail.scrollTop
    if (!this.data.hasResult || Math.abs(top - this.data.modifiedTop) < 2) {
      return
    }
    runtime.syncFrom = 'original'
    this.setData({ modifiedTop: top })
    this.scheduleSyncUnlock(runtime)
  },

  onModifiedDiffScroll(event: { detail: { scrollTop: number } }) {
    const runtime = runtimeOf(this)
    if (runtime.syncFrom === 'original') {
      return
    }
    const top = event.detail.scrollTop
    if (!this.data.hasResult || Math.abs(top - this.data.originalTop) < 2) {
      return
    }
    runtime.syncFrom = 'modified'
    this.setData({ originalTop: top })
    this.scheduleSyncUnlock(runtime)
  },

  scheduleSyncUnlock(runtime: DiffPageRuntime) {
    if (runtime.syncTimer) {
      clearTimeout(runtime.syncTimer)
    }
    runtime.syncTimer = setTimeout(() => {
      runtime.syncFrom = ''
      runtime.syncTimer = 0
    }, SYNC_LOCK_MS) as unknown as number
  },

  onTooLongConfirm() {
    this.setData({ tooLongShow: false })
  },
})
