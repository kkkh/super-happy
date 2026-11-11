/* ==========================================================================
   去重排序 · 按行处理
   - 去空行 / 去首尾空格 / 忽略大小写去重
   - 原序 / 升序 / 降序 / 按长度
   ========================================================================== */
import { copyText } from '../../lib/ui'
import { LIMITS } from '../../../../core/constants/index'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'

type SortMode = 'none' | 'asc' | 'desc' | 'length'

const SORT_MODES: { key: SortMode; label: string }[] = [
  { key: 'none', label: '保持原序' },
  { key: 'asc', label: '升序' },
  { key: 'desc', label: '降序' },
  { key: 'length', label: '按长度' },
]

interface DedupeStat {
  key: string
  label: string
  value: string
}

Page({
  /* 此处是处理工具页分享与深链参数校验的边界 */
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: '去重排序',
    kicker: '文本效率',
    desc: '按行去重、排序与清理',
    text: '',
    maxText: LIMITS.TEXT_INPUT,
    dropEmpty: true,
    trimLines: true,
    ignoreCase: false,
    sortMode: 'none' as SortMode,
    sortModes: SORT_MODES,
    hasResult: false,
    outputText: '',
    outputEmpty: false,
    resultLinesText: '0',
    resultLinesValue: 0,
    stats: [] as DedupeStat[],
    copyPayload: '',
    posterData: null as IPosterData | null,
  },

  onInput(event: WechatMiniprogram.TextareaInput) {
    this.setData({ text: event.detail.value }, () => {
      this.recalculate()
    })
  },

  onDropEmpty(event: { detail: { value: boolean } }) {
    this.setData({ dropEmpty: event.detail.value }, () => {
      this.recalculate()
    })
  },

  onTrim(event: { detail: { value: boolean } }) {
    this.setData({ trimLines: event.detail.value }, () => {
      this.recalculate()
    })
  },

  onIgnoreCase(event: { detail: { value: boolean } }) {
    this.setData({ ignoreCase: event.detail.value }, () => {
      this.recalculate()
    })
  },

  onSortMode(event: WechatMiniprogram.TouchEvent) {
    const mode = event.currentTarget.dataset.mode as SortMode
    if (!SORT_MODES.some((item) => item.key === mode)) {
      return
    }
    this.setData({ sortMode: mode }, () => {
      this.recalculate()
    })
  },

  onExample() {
    const sample = ['苹果', '香蕉', '苹果', '  橙子  ', '', 'Banana', 'banana', '梨'].join('\n')
    this.setData({ text: sample }, () => {
      this.recalculate()
    })
  },

  onReset() {
    this.setData({
      text: '',
      dropEmpty: true,
      trimLines: true,
      ignoreCase: false,
      sortMode: 'none',
      hasResult: false,
      outputText: '',
      outputEmpty: false,
      resultLinesText: '0',
      resultLinesValue: 0,
      stats: [],
    })
  },

  /* ---- 草稿：文本与处理选项；恢复后重新去重 ---- */
  collectDraftInput(): Record<string, string> {
    return {
      text: this.data.text,
      dropEmpty: this.data.dropEmpty ? '1' : '0',
      trimLines: this.data.trimLines ? '1' : '0',
      ignoreCase: this.data.ignoreCase ? '1' : '0',
      sortMode: this.data.sortMode,
    }
  },

  applyDraftInput(input: Record<string, string>): void {
    const sortMode = SORT_MODES.some((item) => item.key === input.sortMode)
      ? (input.sortMode as SortMode)
      : 'none'
    this.setData(
      {
        text: input.text ?? '',
        dropEmpty: input.dropEmpty !== '0',
        trimLines: input.trimLines !== '0',
        ignoreCase: input.ignoreCase === '1',
        sortMode,
      },
      () => {
        this.recalculate()
      },
    )
  },

  onCopy() {
    copyText(this.data.outputText, '处理结果已复制')
  },

  recalculate() {
    const text = this.data.text
    if (!text.trim()) {
      this.setData({
        hasResult: false,
        outputText: '',
        outputEmpty: false,
        resultLinesText: '0',
        resultLinesValue: 0,
        stats: [],
      })
      return
    }
    const rawLines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
    const originalCount = rawLines.length
    const emptyCount = rawLines.filter((line) => !line.trim()).length
    let lines = rawLines.map((line) => (this.data.trimLines ? line.trim() : line))
    if (this.data.dropEmpty) {
      lines = lines.filter((line) => line.trim() !== '')
    }

    const seen = new Set<string>()
    let duplicateCount = 0
    const deduped: string[] = []
    lines.forEach((line) => {
      const key = this.data.ignoreCase ? line.toLowerCase() : line
      if (seen.has(key)) {
        duplicateCount += 1
        return
      }
      seen.add(key)
      deduped.push(line)
    })

    let output = deduped
    if (this.data.sortMode === 'asc') {
      output = [...output].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    } else if (this.data.sortMode === 'desc') {
      output = [...output].sort((left, right) => (left > right ? -1 : left < right ? 1 : 0))
    } else if (this.data.sortMode === 'length') {
      output = [...output].sort((left, right) => left.length - right.length)
    }

    const outputText = output.join('\n')
    const stats: DedupeStat[] = [
      { key: 'raw', label: '原始行数', value: `${originalCount}` },
      { key: 'empty', label: '空行', value: `${emptyCount}` },
      { key: 'duplicate', label: '重复行', value: `${duplicateCount}` },
      { key: 'result', label: '结果行数', value: `${output.length}` },
    ]
    const copy = ['去重排序结果', outputText || '（空）'].join('\n')
    const sortLabel = SORT_MODES.find((item) => item.key === this.data.sortMode)?.label ?? '保持原序'
    const poster: IPosterData = {
      toolName: '去重排序',
      category: '文本效率',
      mainResult: `${output.length}`,
      resultLabel: '去重后行数',
      params: [
        { label: '排序方式', value: sortLabel },
        { label: '去空行', value: this.data.dropEmpty ? '开' : '关' },
        { label: '去空格', value: this.data.trimLines ? '开' : '关' },
        { label: '忽略大小写', value: this.data.ignoreCase ? '开' : '关' },
      ],
      extras: [
        `原始 ${originalCount} 行`,
        `空行 ${emptyCount} · 重复 ${duplicateCount}`,
        `结果 ${output.length} 行`,
      ],
    }

    this.setData({
      hasResult: true,
      outputText,
      outputEmpty: output.length === 0,
      resultLinesText: `${output.length}`,
      resultLinesValue: output.length,
      stats,
      copyPayload: copy,
      posterData: poster,
    })
  },
})
