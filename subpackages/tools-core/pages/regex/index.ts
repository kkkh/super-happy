/* ==========================================================================
   正则测试 · 模式 / flags / 分组高亮
   - 匹配只在 Worker 沙箱执行：300ms 超时终止，Worker 不可用直接拒绝
   - 文本上限 10,000、模式上限 200、全局匹配上限 500
   ========================================================================== */
import { tapTick } from '../../../../core/utils/haptics'
import {
  WorkerSandboxError,
  workerSandbox,
  type RegexMatch,
  type RegexResult,
  type WorkerTaskHandle,
} from '../../../../core/services/worker'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'
import { copyText } from '../../lib/ui'

interface FlagOption {
  key: string
  label: string
  desc: string
  on: boolean
}

interface MatchView {
  key: string
  title: string
  value: string
  groups: string
}

interface Segment {
  id: number
  text: string
  hit: boolean
}

interface RegexState {
  destroyed: boolean
  runToken: number
  handle: WorkerTaskHandle<RegexResult> | null
}

const FLAG_OPTIONS: FlagOption[] = [
  { key: 'g', label: 'g', desc: '全局', on: true },
  { key: 'i', label: 'i', desc: '忽略大小写', on: false },
  { key: 'm', label: 'm', desc: '多行', on: false },
  { key: 's', label: 's', desc: '点号匹配换行', on: false },
  { key: 'u', label: 'u', desc: 'Unicode', on: false },
  { key: 'y', label: 'y', desc: '粘性', on: false },
]

const TEXT_LIMIT = 10000
const PATTERN_LIMIT = 200
const PREVIEW_LIMIT = 2000

function flagsText(options: FlagOption[]): string {
  return options
    .filter((option) => option.on)
    .map((option) => option.key)
    .join('')
}

function errorText(error: unknown): string {
  if (error instanceof WorkerSandboxError) {
    if (error.code === 'UNAVAILABLE') {
      return '当前环境不支持安全正则测试'
    }
    if (error.code === 'TIMEOUT') {
      return '模式过慢，已终止（300ms 上限）'
    }
    if (error.code === 'QUEUE_FULL') {
      return '计算队列繁忙，请稍后重试'
    }
    if (error.code === 'CANCELLED' || error.code === 'DISPOSED') {
      return ''
    }
  }
  const message = error instanceof Error ? error.message : ''
  if (/invalid regular expression|invalid group|unterminated/i.test(message)) {
    return '正则表达式非法，请检查模式'
  }
  return message ? `正则测试失败：${message}` : '正则测试失败，请稍后重试'
}

/** 高亮预览：最多 2,000 字符，零宽匹配不产生高亮节点 */
function buildSegments(
  text: string,
  matches: RegexMatch[],
): { segments: Segment[]; cut: boolean } {
  const segments: Segment[] = []
  let cursor = 0
  let used = 0
  let sequence = 0
  let cut = false

  const push = (value: string, hit: boolean): void => {
    if (!value) {
      return
    }
    sequence += 1
    segments.push({ id: sequence, text: value, hit })
    used += value.length
  }

  for (const match of matches) {
    if (used >= PREVIEW_LIMIT) {
      cut = true
      break
    }
    if (match.end <= match.index || match.index < cursor) {
      continue
    }
    if (match.index > cursor) {
      const plainEnd = Math.min(match.index, cursor + (PREVIEW_LIMIT - used))
      push(text.slice(cursor, plainEnd), false)
      cursor = plainEnd
      if (cursor < match.index) {
        cut = true
        break
      }
    }
    const hitEnd = Math.min(match.end, match.index + (PREVIEW_LIMIT - used))
    push(text.slice(match.index, hitEnd), true)
    cursor = hitEnd
    if (cursor < match.end) {
      cut = true
      break
    }
  }

  if (!cut && cursor < text.length) {
    const rest = text.slice(cursor, cursor + (PREVIEW_LIMIT - used))
    push(rest, false)
    if (cursor + rest.length < text.length) {
      cut = true
    }
  }
  return { segments, cut }
}

Page({
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: '正则测试',
    kicker: '文本效率',
    desc: '模式 · flags · 分组高亮',
    pattern: '',
    flagOptions: FLAG_OPTIONS,
    testText: '',
    maxText: TEXT_LIMIT,
    stale: false,
    canRun: false,
    running: false,
    shellState: 'idle',
    hasResult: false,
    error: '',
    matchCount: 0,
    matchesView: [] as MatchView[],
    segments: [] as Segment[],
    truncated: false,
    highlightCut: false,
    resultJson: '',
    regexSummary: '',
    posterData: null as IPosterData | null,
  },

  onLoad() {
    const state = this as unknown as RegexState
    state.destroyed = false
    state.runToken = 0
    state.handle = null
  },

  onUnload() {
    const state = this as unknown as RegexState
    state.destroyed = true
    state.runToken += 1
    if (state.handle) {
      state.handle.cancel()
      state.handle = null
    }
  },

  onPatternInput(event: WechatMiniprogram.Input) {
    const value = String(event.detail.value || '')
    this.setData({ pattern: value }, () => {
      this.invalidate()
      this.refreshCanRun()
    })
  },

  onTextInput(event: WechatMiniprogram.TextareaInput) {
    const value = String(event.detail.value || '')
    this.setData({ testText: value }, () => {
      this.invalidate()
      this.refreshCanRun()
    })
  },

  onFlagTap(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.flag || '')
    if (!key) {
      return
    }
    tapTick()
    const next = this.data.flagOptions.map((option) =>
      option.key === key ? { ...option, on: !option.on } : option,
    )
    this.setData({ flagOptions: next }, () => this.invalidate())
  },

  onExample() {
    tapTick()
    const options = FLAG_OPTIONS.map((option) => ({ ...option, on: option.key === 'g' }))
    this.setData(
      {
        pattern: '(\\d{4})-(\\d{2})',
        flagOptions: options,
        testText: '2020-12-31 发布，2021-01-15 更新',
        stale: false,
        error: '',
      },
      () => {
        this.refreshCanRun()
        void this.onRun()
      },
    )
  },

  onReset() {
    const state = this as unknown as RegexState
    state.runToken += 1
    if (state.handle) {
      state.handle.cancel()
      state.handle = null
    }
    this.setData({
      pattern: '',
      flagOptions: FLAG_OPTIONS.map((option) => ({ ...option })),
      testText: '',
      stale: false,
      canRun: false,
      running: false,
      shellState: 'idle',
      hasResult: false,
      error: '',
      matchCount: 0,
      matchesView: [],
      segments: [],
      truncated: false,
      highlightCut: false,
      resultJson: '',
      regexSummary: '',
      posterData: null,
    })
  },

  onCopy() {
    if (!this.data.resultJson) {
      return
    }
    tapTick()
    copyText(this.data.resultJson, '结果 JSON 已复制')
  },

  onReceiveWorkflow(data: { payload?: string }): boolean {
    const payload = typeof data?.payload === 'string' ? data.payload : ''
    if (!payload) {
      return false
    }
    if (payload.length > TEXT_LIMIT) {
      this.fail(`测试文本最多 ${TEXT_LIMIT.toLocaleString()} 字符`)
      return false
    }
    this.invalidate()
    this.setData({ testText: payload }, () => this.refreshCanRun())
    return true
  },

  refreshCanRun() {
    const pattern = this.data.pattern.trim()
    const text = this.data.testText
    this.setData({
      canRun:
        pattern.length > 0 &&
        pattern.length <= PATTERN_LIMIT &&
        text.length > 0 &&
        text.length <= TEXT_LIMIT,
    })
  },

  invalidate() {
    const state = this as unknown as RegexState
    state.runToken += 1
    if (state.handle) {
      state.handle.cancel()
      state.handle = null
    }
    const patch: Record<string, unknown> = { running: false, error: '' }
    if (this.data.hasResult || this.data.shellState === 'running') {
      Object.assign(patch, {
        hasResult: false,
        shellState: 'idle',
        stale: true,
        matchCount: 0,
        matchesView: [],
        segments: [],
        truncated: false,
        highlightCut: false,
        resultJson: '',
        regexSummary: '',
        posterData: null,
      })
    }
    this.setData(patch)
  },

  fail(message: string) {
    this.setData({
      running: false,
      shellState: 'invalid',
      hasResult: false,
      stale: false,
      error: message,
      matchCount: 0,
      matchesView: [],
      segments: [],
      truncated: false,
      highlightCut: false,
      resultJson: '',
      regexSummary: '',
      posterData: null,
    })
  },

  async onRun() {
    const state = this as unknown as RegexState
    if (state.destroyed || this.data.running) {
      return
    }
    const pattern = this.data.pattern.trim()
    const text = this.data.testText
    if (!pattern) {
      this.fail('请输入正则模式')
      return
    }
    if (pattern.length > PATTERN_LIMIT) {
      this.fail(`正则模式最多 ${PATTERN_LIMIT} 字符`)
      return
    }
    if (!text) {
      this.fail('请输入测试文本')
      return
    }
    if (text.length > TEXT_LIMIT) {
      this.fail(`测试文本最多 ${TEXT_LIMIT.toLocaleString()} 字符`)
      return
    }

    tapTick()
    const flags = flagsText(this.data.flagOptions)
    const token = state.runToken + 1
    state.runToken = token
    this.setData({
      running: true,
      shellState: 'running',
      hasResult: false,
      error: '',
      posterData: null,
    })

    const handle = workerSandbox.runTaskHandle('regex', { pattern, flags, text })
    state.handle = handle
    try {
      const result = await handle.promise
      if (state.destroyed || token !== state.runToken) {
        return
      }
      state.handle = null
      this.renderResult(result, pattern, flags, text)
    } catch (error) {
      if (state.destroyed || token !== state.runToken) {
        return
      }
      state.handle = null
      const message = errorText(error)
      if (!message) {
        this.setData({ running: false, shellState: 'idle' })
        return
      }
      this.setData({
        running: false,
        shellState: 'invalid',
        hasResult: false,
        error: message,
        posterData: null,
      })
    }
  },

  renderResult(result: RegexResult, pattern: string, flags: string, text: string) {
    const count = result.matches.length
    const views: MatchView[] = result.matches.slice(0, 30).map((match, index) => ({
      key: `${match.index}-${index}`,
      title: `#${index + 1} [${match.index}, ${match.end})`,
      value: match.value || '（空匹配）',
      groups: match.groups.length
        ? match.groups.map((group, groupIndex) => `$${groupIndex + 1}=${group || '∅'}`).join(' · ')
        : '无捕获组',
    }))
    const preview = buildSegments(text, result.matches)
    const first = result.matches.find((match) => match.end > match.index)?.value ?? ''
    const summary =
      count === 0
        ? '未匹配'
        : `匹配 ${count} 处${first ? ` · 首个：${first.slice(0, 24)}` : ''}`
    const json = JSON.stringify(
      { pattern, flags, text, matches: result.matches, truncated: result.truncated },
      null,
      2,
    )
    const poster: IPosterData = {
      toolName: '正则测试',
      category: '文本效率',
      mainResult: count === 0 ? '未匹配' : `${count} 处`,
      resultLabel: '匹配数',
      params: [
        { label: '模式', value: pattern.slice(0, 24) },
        { label: 'flags', value: flags || '无' },
      ],
      extras: [
        first ? `首个 ${first.slice(0, 20)}` : '无匹配',
        result.truncated ? '已达 500 条上限' : `共 ${count} 条`,
      ],
    }
    this.setData({
      running: false,
      shellState: 'done',
      hasResult: true,
      stale: false,
      error: '',
      matchCount: count,
      matchesView: views,
      segments: preview.segments,
      truncated: result.truncated,
      highlightCut: preview.cut,
      resultJson: json,
      regexSummary: summary,
      posterData: poster,
    })
  },
})
