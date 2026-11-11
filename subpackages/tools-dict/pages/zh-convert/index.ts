/* ==========================================================================
   简繁转换 · 简→繁 / 繁→简 / 词组优先
   - 默认词组级，字符级可切换；方向与模式切换保留输入
   - 结果按 OpenCC 本地词库转换，不联网、不上传文本
   - 支持文本工作流注入，注入后保留用户当前方向与模式
   ========================================================================== */
import { tapTick } from '../../../../core/utils/haptics'
import { copyText, toast } from '../../lib/ui'
import {
  convertZh,
  normalizeZhDirection,
  normalizeZhMode,
  zhDirectionLabel,
  zhModeLabel,
  type ZhDirection,
  type ZhMode,
} from '../../lib/zh'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'
import type { IWorkflowData } from '../../../../core/workflow/types'

interface ResultRow {
  k: string
  v: string
}

interface ZhOption {
  key: string
  label: string
}

const DIRECTION_OPTIONS: ZhOption[] = [
  { key: 's2t', label: '简 → 繁' },
  { key: 't2s', label: '繁 → 简' },
]

const MODE_OPTIONS: ZhOption[] = [
  { key: 'phrase', label: '词组优先' },
  { key: 'char', label: '字符级' },
]

const EXAMPLES: Record<ZhDirection, string> = {
  s2t: '理发师发现，头发长了要理发；发财后别忘了开发新发型。',
  t2s: '理髮師發現，頭髮長了要理髮；發財後別忘了開發新髮型。',
}

function preview(text: string, size = 60): string {
  const chars = Array.from(text)
  return chars.length > size ? `${chars.slice(0, size).join('')}…` : text
}

function emptyResult() {
  return {
    resultMain: '',
    resultText: '',
    zhSummary: '',
    resultRows: [] as ResultRow[],
    truncated: false,
    replaced: 0,
    ambiguous: 0,
    hasResult: false,
    shellState: 'idle',
    error: '',
    posterData: null as IPosterData | null,
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
    toolName: '简繁转换',
    kicker: '文本效率',
    desc: '简→繁 · 繁→简 · 词组优先',
    direction: 's2t' as ZhDirection,
    mode: 'phrase' as ZhMode,
    directionOptions: DIRECTION_OPTIONS,
    modeOptions: MODE_OPTIONS,
    inputText: '',
    inputLength: 0,
    ...emptyResult(),
  },

  onInput(event: WechatMiniprogram.TextareaInput) {
    const value = String(event.detail.value || '')
    this.setData({
      inputText: value,
      inputLength: Array.from(value).length,
      ...emptyResult(),
    })
  },

  onDirection(event: WechatMiniprogram.TouchEvent) {
    const direction = normalizeZhDirection(event.currentTarget.dataset.direction)
    if (direction === this.data.direction) {
      return
    }
    const shouldRun = this.data.hasResult
    tapTick()
    this.setData({ direction, ...emptyResult() }, () => {
      if (shouldRun) {
        this.compute()
      }
    })
  },

  onMode(event: WechatMiniprogram.TouchEvent) {
    const mode = normalizeZhMode(event.currentTarget.dataset.mode)
    if (mode === this.data.mode) {
      return
    }
    const shouldRun = this.data.hasResult
    tapTick()
    this.setData({ mode, ...emptyResult() }, () => {
      if (shouldRun) {
        this.compute()
      }
    })
  },

  onExample() {
    tapTick()
    const value = EXAMPLES[this.data.direction]
    this.setData(
      {
        inputText: value,
        inputLength: Array.from(value).length,
        ...emptyResult(),
      },
      () => this.compute(),
    )
  },

  onRun() {
    this.compute()
  },

  onReset() {
    this.setData({
      inputText: '',
      inputLength: 0,
      ...emptyResult(),
    })
  },

  onCopy() {
    if (!this.data.resultText) {
      toast('没有可复制的内容')
      return
    }
    tapTick()
    void copyText(this.data.resultText, '转换结果已复制')
  },

  onReceiveWorkflow(data: IWorkflowData): boolean {
    if (!data || data.type !== 'text' || typeof data.payload !== 'string') {
      return false
    }
    const payload = data.payload.trim()
    if (!payload) {
      return false
    }
    this.setData(
      {
        inputText: payload,
        inputLength: Array.from(payload).length,
        ...emptyResult(),
      },
      () => this.compute(),
    )
    return true
  },

  compute() {
    const source = this.data.inputText
    if (!source) {
      this.setData({ ...emptyResult(), error: '请输入要转换的文本' })
      return
    }
    const result = convertZh(source, {
      direction: this.data.direction,
      mode: this.data.mode,
    })
    const directionLabel = zhDirectionLabel(result.direction)
    const modeLabel = zhModeLabel(result.mode)
    const rows: ResultRow[] = [
      { k: '方向', v: directionLabel },
      { k: '模式', v: modeLabel },
      { k: '替换字符', v: `${result.replaced} 字` },
      { k: '输入 / 输出', v: `${result.inputChars} → ${result.outputChars} 字` },
    ]
    if (result.ambiguous > 0) {
      rows.push({
        k: result.direction === 's2t' ? '一词多繁' : '多简字',
        v: `${result.ambiguous} 处，按常用词处理`,
      })
    }
    const poster: IPosterData = {
      toolName: '简繁转换',
      category: '文本效率',
      mainResult: preview(result.output, 36),
      resultLabel: '转换结果',
      params: [
        { label: '方向', value: directionLabel },
        { label: '模式', value: modeLabel },
      ],
      extras: [`替换 ${result.replaced} 字`, `输出 ${result.outputChars} 字`],
    }
    this.setData({
      resultMain: preview(result.output),
      resultText: result.output,
      zhSummary: result.summary,
      resultRows: rows,
      truncated: result.truncated,
      replaced: result.replaced,
      ambiguous: result.ambiguous,
      hasResult: true,
      shellState: 'done',
      error: '',
      posterData: poster,
    })
  },
})
