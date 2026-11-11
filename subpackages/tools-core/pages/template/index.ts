/* ==========================================================================
   占位符模板 · {{key}} 批量替换
   - 模板与变量表两个输入；点击生成后输出替换结果
   - 缺失变量保留原样，并单独列出；模板 20,000 字符截断
   ========================================================================== */
import { tapTick } from '../../../../core/utils/haptics'
import {
  renderTemplate,
  templateSummaryText,
  type TemplateRenderResult,
} from '../../../../core/toolbox/engines/template'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'
import { copyText } from '../../lib/ui'

interface ResultRow {
  k: string
  v: string
}

interface TemplateState {
  destroyed: boolean
}

function toRows(result: TemplateRenderResult): ResultRow[] {
  const rows: ResultRow[] = [
    { k: '变量数', v: String(result.keys.length) },
    { k: '已填充', v: String(result.filled.length) },
    { k: '未填充', v: String(result.missing.length) },
    { k: '结果字符数', v: String(Array.from(result.text).length) },
  ]
  if (result.truncated) {
    rows.push({ k: '模板截断', v: '超过 20,000 字符' })
  }
  return rows
}

Page({
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: '占位符模板',
    kicker: '文本效率',
    desc: '{{变量}} 批量替换 · 缺失提示',
    templateText: '',
    variablesText: '',
    resultLabel: '替换结果',
    resultMain: '',
    resultText: '',
    resultRows: [] as ResultRow[],
    missingKeys: [] as string[],
    missingCount: 0,
    templateSummary: '',
    shellState: 'idle',
    hasResult: false,
    error: '',
    posterData: null as IPosterData | null,
  },

  onLoad() {
    const state = this as unknown as TemplateState
    state.destroyed = false
  },

  onUnload() {
    const state = this as unknown as TemplateState
    state.destroyed = true
  },

  onFieldInput(event: WechatMiniprogram.Input) {
    const field = String(event.currentTarget.dataset.field || '')
    if (field !== 'templateText' && field !== 'variablesText') {
      return
    }
    this.setData({
      [field]: String(event.detail.value || ''),
      hasResult: false,
      shellState: 'idle',
      error: '',
      posterData: null,
    })
  },

  onExample() {
    tapTick()
    const templateText =
      '你好 {{name}}，欢迎来到 {{city}}！\n联系方式：{{contact}}\n{{signature}}'
    const variablesText = 'name=秦超\ncity=杭州\ncontact=hi@example.com'
    this.setData(
      { templateText, variablesText },
      () => this.onRun(),
    )
  },

  onReset() {
    this.setData({
      templateText: '',
      variablesText: '',
      resultLabel: '替换结果',
      resultMain: '',
      resultText: '',
      resultRows: [],
      missingKeys: [],
      missingCount: 0,
      templateSummary: '',
      shellState: 'idle',
      hasResult: false,
      error: '',
      posterData: null,
    })
  },

  onCopy() {
    if (!this.data.resultText) {
      return
    }
    tapTick()
    copyText(this.data.resultText, '替换结果已复制')
  },

  onRun() {
    const templateText = this.data.templateText.trim()
    if (!templateText) {
      this.setData({
        shellState: 'invalid',
        hasResult: false,
        error: '请输入模板文本',
        posterData: null,
      })
      return
    }

    const result = renderTemplate(templateText, this.data.variablesText)
    if (result.keys.length === 0) {
      this.setData({
        shellState: 'invalid',
        hasResult: false,
        error: '模板中没有 {{变量}}，请用 {{key}} 标记需要替换的内容',
        posterData: null,
      })
      return
    }

    const summary = templateSummaryText(result)
    const poster: IPosterData = {
      toolName: '占位符模板',
      category: '文本效率',
      mainResult: `${result.filled.length} / ${result.keys.length}`,
      resultLabel: '已填充变量',
      params: [
        { label: '变量数', value: String(result.keys.length) },
        { label: '未填充', value: String(result.missing.length) },
      ],
      extras: [...result.keys.slice(0, 6)],
    }

    this.setData({
      shellState: 'done',
      hasResult: true,
      error: '',
      resultLabel: '替换结果',
      resultMain: summary,
      resultText: result.text,
      resultRows: toRows(result),
      missingKeys: result.missing,
      missingCount: result.missing.length,
      templateSummary: summary,
      posterData: poster,
    })
  },
})
