/* ==========================================================================
   JSON 格式化 / 压缩
   - JSON.parse / JSON.stringify；错误给出原始信息与行列位置
   - 不吞异常；结果只存在页面内存
   ========================================================================== */
import { copyText } from '../../lib/ui'
import { tapTick } from '../../../../core/utils/haptics'
import { LIMITS } from '../../../../core/constants/index'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'

type JsonMode = 'format' | 'minify'

const SAMPLE = JSON.stringify(
  {
    name: '超欢',
    tools: 20,
    privacy: '本机处理',
    features: ['搜索', '收藏', '最近使用', '离线可用'],
    owner: { name: '秦超', role: '个人开发者' },
  },
  null,
  2,
)

/** 从 JSON 错误信息中提取字符位置，换算为行列 */
function errorPosition(message: string, source: string): string {
  const match = /position\s+(\d+)/i.exec(message)
  if (!match) {
    return ''
  }
  const position = Number(match[1])
  if (!Number.isFinite(position) || position < 0) {
    return ''
  }
  const before = source.slice(0, position)
  const lines = before.split('\n')
  return `第 ${lines.length} 行，第 ${lines[lines.length - 1].length + 1} 列`
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
    toolName: 'JSON 格式化',
    kicker: '文本效率',
    desc: '格式化 / 压缩 / 错误定位',
    input: '',
    maxText: LIMITS.TEXT_INPUT,
    mode: 'format' as JsonMode,
    indent: 2,
    shellState: 'idle',
    hasResult: false,
    error: '',
    outputText: '',
    resultSizeText: '',
    resultLinesText: '',
    resultTypeText: '',
    posterData: null as IPosterData | null,
  },

  onInput(event: WechatMiniprogram.TextareaInput) {
    this.setData({ input: event.detail.value, error: '' })
  },

  onMode(event: WechatMiniprogram.TouchEvent) {
    const mode = event.currentTarget.dataset.mode as JsonMode
    if (mode !== 'format' && mode !== 'minify') {
      return
    }
    tapTick()
    this.setData({ mode, error: '' })
  },

  onIndent(event: WechatMiniprogram.TouchEvent) {
    const indent = Number(event.currentTarget.dataset.indent)
    if (indent !== 2 && indent !== 4) {
      return
    }
    tapTick()
    this.setData({ indent })
  },

  onExample() {
    this.setData({ input: SAMPLE, error: '' }, () => {
      this.run()
    })
  },

  onReset() {
    this.setData({
      input: '',
      mode: 'format',
      indent: 2,
      shellState: 'idle',
      hasResult: false,
      error: '',
      outputText: '',
      resultSizeText: '',
      resultLinesText: '',
      resultTypeText: '',
    })
  },

  /* ---- 草稿：文本、模式与缩进；恢复后重新格式化 ---- */
  draftMode(): string {
    return this.data.mode
  },

  collectDraftInput(): Record<string, string> {
    return { input: this.data.input, indent: `${this.data.indent}` }
  },

  applyDraftInput(input: Record<string, string>, mode: string): void {
    this.setData(
      {
        input: input.input ?? '',
        mode: mode === 'minify' ? 'minify' : 'format',
        indent: input.indent === '4' ? 4 : 2,
        shellState: 'idle',
        hasResult: false,
        error: '',
        outputText: '',
        resultSizeText: '',
        resultLinesText: '',
        resultTypeText: '',
        posterData: null,
      },
      () => {
        this.run()
      },
    )
  },

  onRun() {
    this.run()
  },

  onCopy() {
    copyText(this.data.outputText, 'JSON 结果已复制')
  },

  run() {
    const source = this.data.input
    if (!source.trim()) {
      this.setData({
        shellState: 'invalid',
        hasResult: false,
        error: '请输入 JSON 内容',
        outputText: '',
        resultSizeText: '',
        resultLinesText: '',
        resultTypeText: '',
      })
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(source)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const location = errorPosition(message, source)
      this.setData({
        shellState: 'invalid',
        hasResult: false,
        error: location
          ? `解析失败：${message}（${location}）。请检查引号、逗号与括号是否配对。`
          : `解析失败：${message}。请检查引号、逗号与括号是否配对。`,
        outputText: '',
        resultSizeText: '',
        resultLinesText: '',
        resultTypeText: '',
      })
      return
    }

    let output: string | undefined
    try {
      output =
        this.data.mode === 'format'
          ? JSON.stringify(parsed, null, this.data.indent)
          : JSON.stringify(parsed)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.setData({
        shellState: 'error',
        hasResult: false,
        error: `序列化失败：${message}`,
        outputText: '',
        resultSizeText: '',
        resultLinesText: '',
        resultTypeText: '',
      })
      return
    }
    if (output === undefined) {
      this.setData({
        shellState: 'error',
        hasResult: false,
        error: '该内容无法序列化为 JSON 文本',
        outputText: '',
        resultSizeText: '',
        resultLinesText: '',
        resultTypeText: '',
      })
      return
    }

    const type = Array.isArray(parsed)
      ? '数组'
      : parsed === null
        ? 'null'
        : typeof parsed === 'object'
          ? '对象'
          : typeof parsed
    const outputLines = output.split('\n').length
    const inputChars = Array.from(source).length
    const outputChars = Array.from(output).length
    const poster: IPosterData = {
      toolName: 'JSON 格式化',
      category: '文本效率',
      mainResult: `${outputChars}`,
      resultLabel: '输出字符数',
      params: [
        { label: '处理模式', value: this.data.mode === 'format' ? '格式化' : '压缩' },
        { label: '缩进', value: this.data.mode === 'format' ? `${this.data.indent} 空格` : '无' },
      ],
      extras: [
        `数据类型 ${type}`,
        `输出 ${outputLines} 行`,
        `输入 ${inputChars} 字符`,
        `输出 ${outputChars} 字符`,
      ],
    }

    this.setData({
      shellState: 'done',
      hasResult: true,
      error: '',
      outputText: output,
      resultSizeText: `${Array.from(output).length} 字符`,
      resultLinesText: `${outputLines} 行`,
      resultTypeText: type,
      posterData: poster,
    })
  },
})
