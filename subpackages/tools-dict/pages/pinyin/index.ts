/* ==========================================================================
   拼音标注 · 带声调 / 不带声调 / 逐字对照
   - 常用字表 + 2–4 字多音词消歧；多音字按常用读音
   - 非汉字原样保留；未收录汉字保留原字并标注
   - 支持文本工作流注入，注入后保留用户当前声调设置
   ========================================================================== */
import { tapTick } from '../../../../core/utils/haptics'
import { copyText, toast } from '../../lib/ui'
import {
  PINYIN_MAX_CHARS,
  pinyinComparison,
  toPinyin,
  type PinyinResult,
} from '../../lib/pinyin'
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

const TONE_OPTIONS = [
  { key: 'tone', label: '带声调' },
  { key: 'plain', label: '不带声调' },
]

const EXAMPLE = '重庆银行行长喜欢音乐，重新称重后去银行办事。'

const COMPARISON_LIMIT = 200

function preview(text: string, size = 60): string {
  const chars = Array.from(text)
  return chars.length > size ? `${chars.slice(0, size).join('')}…` : text
}

function emptyResult() {
  return {
    resultMain: '',
    resultText: '',
    comparisonText: '',
    comparisonTruncated: false,
    pinyinSummary: '',
    resultRows: [] as ResultRow[],
    truncated: false,
    covered: 0,
    uncovered: 0,
    polyphonic: 0,
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
    toolName: '拼音标注',
    kicker: '文本效率',
    desc: '带声调 · 不带声调 · 逐字对照',
    tone: true,
    toneKey: 'tone',
    toneOptions: TONE_OPTIONS,
    maxChars: PINYIN_MAX_CHARS,
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

  onTone(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.tone || '')
    const tone = key !== 'plain'
    if (tone === this.data.tone) {
      return
    }
    const shouldRun = this.data.hasResult
    tapTick()
    this.setData({ tone, toneKey: tone ? 'tone' : 'plain', ...emptyResult() }, () => {
      if (shouldRun) {
        this.compute()
      }
    })
  },

  onExample() {
    tapTick()
    this.setData(
      {
        inputText: EXAMPLE,
        inputLength: Array.from(EXAMPLE).length,
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

  /* ---- 草稿：文本与声调；恢复后重新标注 ---- */
  draftMode(): string {
    return this.data.toneKey
  },

  collectDraftInput(): Record<string, string> {
    return { inputText: this.data.inputText }
  },

  applyDraftInput(input: Record<string, string>, mode: string): void {
    const text = input.inputText ?? ''
    const toneKey = mode === 'plain' ? 'plain' : 'tone'
    this.setData(
      {
        inputText: text,
        inputLength: Array.from(text).length,
        tone: toneKey === 'tone',
        toneKey,
        ...emptyResult(),
      },
      () => {
        this.compute()
      },
    )
  },

  onCopy() {
    if (!this.data.resultText) {
      toast('没有可复制的内容')
      return
    }
    tapTick()
    void copyText(this.data.resultText, '拼音结果已复制')
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
      this.setData({ ...emptyResult(), error: '请输入要标注拼音的文本' })
      return
    }
    const result: PinyinResult = toPinyin(source, { tone: this.data.tone })
    const rows: ResultRow[] = [
      { k: '声调', v: result.tone ? '带声调' : '不带声调' },
      { k: '已标注', v: `${result.covered} 字` },
      { k: '未收录', v: `${result.uncovered} 字` },
      { k: '多音字', v: `${result.polyphonic} 处，按常用读音` },
      { k: '输入 / 输出', v: `${result.inputChars} 字 → ${Array.from(result.output).length} 字符` },
    ]
    const poster: IPosterData = {
      toolName: '拼音标注',
      category: '文本效率',
      mainResult: preview(result.output, 36),
      resultLabel: '拼音结果',
      params: [
        { label: '声调', value: result.tone ? '带声调' : '不带声调' },
        { label: '已标注', value: `${result.covered} 字` },
      ],
      extras: [`未收录 ${result.uncovered} 字`, `多音字 ${result.polyphonic} 处`],
    }
    this.setData({
      resultMain: preview(result.output),
      resultText: result.output,
      comparisonText: pinyinComparison(result.chars, COMPARISON_LIMIT),
      comparisonTruncated: result.covered > COMPARISON_LIMIT,
      pinyinSummary: result.summary,
      resultRows: rows,
      truncated: result.truncated,
      covered: result.covered,
      uncovered: result.uncovered,
      polyphonic: result.polyphonic,
      hasResult: true,
      shellState: 'done',
      error: '',
      posterData: poster,
    })
  },
})
