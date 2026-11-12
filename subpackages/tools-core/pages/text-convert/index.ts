/* ==========================================================================
   文本转换 · 大小写 / 命名 / HTML 实体 / Unicode 转义 / 清洗
   - 实时模式：输入即转换，空串为空态而非错误
   - 五模式独立缓存输入；切换模式恢复各自内容
   ========================================================================== */
import { tapTick } from '../../../../core/utils/haptics'
import {
  convertText,
  type CleanOptions,
  type ConvertMode,
} from '../../../../core/toolbox/engines/text'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'
import { copyText } from '../../lib/ui'

type PanelMode = 'case' | 'naming' | 'html' | 'unicode' | 'clean'

interface PanelOption {
  key: PanelMode
  label: string
}

interface ResultRow {
  k: string
  v: string
}

type CleanOptionKey =
  | 'toHalfWidth'
  | 'removeSpaces'
  | 'cjkPunctuation'
  | 'removeBlankLines'
  | 'removeLineBreaks'
  | 'removeInvisible'

interface CleanOption {
  key: CleanOptionKey
  label: string
  on: boolean
}

const CLEAN_OPTIONS: CleanOption[] = [
  { key: 'toHalfWidth', label: '全角→半角', on: true },
  { key: 'removeSpaces', label: '去空格', on: false },
  { key: 'cjkPunctuation', label: '中文标点', on: false },
  { key: 'removeBlankLines', label: '去空行', on: true },
  { key: 'removeLineBreaks', label: '并成一行', on: false },
  { key: 'removeInvisible', label: '去不可见', on: true },
]

function defaultCleanOptions(): CleanOption[] {
  return CLEAN_OPTIONS.map((item) => ({ ...item }))
}

interface TextConvertState {
  destroyed: boolean
  modeInputs: Record<PanelMode, string>
}

const PANEL_OPTIONS: PanelOption[] = [
  { key: 'case', label: '大小写' },
  { key: 'naming', label: '命名' },
  { key: 'html', label: 'HTML' },
  { key: 'unicode', label: 'Unicode' },
  { key: 'clean', label: '清洗' },
]

const CASE_OPTIONS: Array<{ key: 'upper' | 'lower'; label: string }> = [
  { key: 'upper', label: '大写' },
  { key: 'lower', label: '小写' },
]

const NAMING_OPTIONS: Array<{ key: 'camel' | 'snake' | 'kebab'; label: string }> = [
  { key: 'camel', label: '驼峰' },
  { key: 'snake', label: '下划线' },
  { key: 'kebab', label: '短横线' },
]

const HTML_OPTIONS: Array<{ key: 'html-encode' | 'html-decode'; label: string }> = [
  { key: 'html-encode', label: '编码' },
  { key: 'html-decode', label: '解码' },
]

const EXAMPLES: Record<PanelMode, string> = {
  case: 'Hello World · 超欢',
  naming: 'HTTPResponse',
  html: '<a href="x">超欢 & Tools</a>',
  unicode: '超欢 A😀',
  clean: '　ＡＢＣ　１２３\r\n第二行　超欢　',
}

function preview(text: string, size = 48): string {
  const chars = Array.from(text)
  return chars.length > size ? `${chars.slice(0, size).join('')}…` : text
}

Page({
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: '文本转换',
    kicker: '文本效率',
    desc: '大小写 · 命名 · HTML · Unicode · 清洗',
    activeMode: 'case' as PanelMode,
    panelOptions: PANEL_OPTIONS,
    caseOptions: CASE_OPTIONS,
    namingOptions: NAMING_OPTIONS,
    htmlOptions: HTML_OPTIONS,
    caseMode: 'upper' as 'upper' | 'lower',
    namingMode: 'camel' as 'camel' | 'snake' | 'kebab',
    htmlMode: 'html-encode' as 'html-encode' | 'html-decode',
    cleanOptions: defaultCleanOptions(),
    convertMode: 'upper' as ConvertMode,
    inputText: '',
    inputLength: 0,
    resultLabel: '转换结果',
    resultMain: '',
    resultRows: [] as ResultRow[],
    resultText: '',
    convertSummary: '',
    truncated: false,
    shellState: 'idle',
    hasResult: false,
    error: '',
    posterData: null as IPosterData | null,
  },

  onLoad() {
    const state = this as unknown as TextConvertState
    state.destroyed = false
    state.modeInputs = { case: '', naming: '', html: '', unicode: '', clean: '' }
  },

  onUnload() {
    const state = this as unknown as TextConvertState
    state.destroyed = true
  },

  onInput(event: WechatMiniprogram.TextareaInput) {
    const value = String(event.detail.value || '')
    this.setData({ inputText: value, inputLength: Array.from(value).length }, () =>
      this.compute(),
    )
  },

  onModeTap(event: WechatMiniprogram.TouchEvent) {
    const mode = event.currentTarget.dataset.mode as PanelMode
    if (!PANEL_OPTIONS.some((item) => item.key === mode) || mode === this.data.activeMode) {
      return
    }
    const state = this as unknown as TextConvertState
    state.modeInputs[this.data.activeMode] = this.data.inputText
    tapTick()
    const next = state.modeInputs[mode]
    this.setData(
      {
        activeMode: mode,
        inputText: next,
        inputLength: Array.from(next).length,
        convertMode: this.modeFor(mode),
      },
      () => this.compute(),
    )
  },

  onCaseMode(event: WechatMiniprogram.TouchEvent) {
    const mode = event.currentTarget.dataset.mode as 'upper' | 'lower'
    if (!CASE_OPTIONS.some((item) => item.key === mode)) {
      return
    }
    tapTick()
    this.setData({ caseMode: mode, convertMode: mode }, () => this.compute())
  },

  onNamingMode(event: WechatMiniprogram.TouchEvent) {
    const mode = event.currentTarget.dataset.mode as 'camel' | 'snake' | 'kebab'
    if (!NAMING_OPTIONS.some((item) => item.key === mode)) {
      return
    }
    tapTick()
    this.setData({ namingMode: mode, convertMode: mode }, () => this.compute())
  },

  onHtmlMode(event: WechatMiniprogram.TouchEvent) {
    const mode = event.currentTarget.dataset.mode as 'html-encode' | 'html-decode'
    if (!HTML_OPTIONS.some((item) => item.key === mode)) {
      return
    }
    tapTick()
    this.setData({ htmlMode: mode, convertMode: mode }, () => this.compute())
  },

  onCleanOption(event: WechatMiniprogram.TouchEvent) {
    const key = event.currentTarget.dataset.key as CleanOptionKey
    if (!CLEAN_OPTIONS.some((item) => item.key === key)) {
      return
    }
    tapTick()
    const cleanOptions = this.data.cleanOptions.map((item) =>
      item.key === key ? { ...item, on: !item.on } : item,
    )
    this.setData({ cleanOptions }, () => this.compute())
  },

  onExample() {
    tapTick()
    const value = EXAMPLES[this.data.activeMode]
    this.setData({ inputText: value, inputLength: Array.from(value).length }, () =>
      this.compute(),
    )
  },

  onReset() {
    const state = this as unknown as TextConvertState
    state.modeInputs = { case: '', naming: '', html: '', unicode: '', clean: '' }
    this.setData({
      inputText: '',
      inputLength: 0,
      resultLabel: '转换结果',
      resultMain: '',
      resultRows: [],
      resultText: '',
      convertSummary: '',
      truncated: false,
      shellState: 'idle',
      hasResult: false,
      error: '',
      posterData: null,
      cleanOptions: defaultCleanOptions(),
    })
  },

  /* ---- 草稿：当前面板、文本、各面板选项与清洗开关；恢复后重算 ---- */
  draftMode(): string {
    return this.data.activeMode
  },

  collectDraftInput(): Record<string, string> {
    return {
      inputText: this.data.inputText,
      caseMode: this.data.caseMode,
      namingMode: this.data.namingMode,
      htmlMode: this.data.htmlMode,
      cleanFlags: this.data.cleanOptions
        .filter((item) => item.on)
        .map((item) => item.key)
        .join(','),
    }
  },

  applyDraftInput(input: Record<string, string>, mode: string): void {
    const activeMode = PANEL_OPTIONS.some((item) => item.key === mode)
      ? (mode as PanelMode)
      : 'case'
    const text = input.inputText ?? ''
    const caseMode =
      input.caseMode === 'lower' ? 'lower' : 'upper'
    const namingMode =
      input.namingMode === 'snake' || input.namingMode === 'kebab'
        ? input.namingMode
        : 'camel'
    const htmlMode =
      input.htmlMode === 'html-decode' ? 'html-decode' : 'html-encode'
    const enabled = new Set(
      (input.cleanFlags ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    )
    const cleanOptions = CLEAN_OPTIONS.map((item) => ({ ...item, on: enabled.has(item.key) }))
    const state = this as unknown as TextConvertState
    state.modeInputs[activeMode] = text
    this.setData(
      {
        activeMode,
        inputText: text,
        inputLength: Array.from(text).length,
        caseMode,
        namingMode,
        htmlMode,
        cleanOptions,
      },
      () => {
        this.setData({ convertMode: this.modeFor(activeMode) }, () => this.compute())
      },
    )
  },

  onCopy() {
    const text = this.data.resultText
    if (!text) {
      return
    }
    tapTick()
    copyText(text, '结果已复制')
  },

  onReceiveWorkflow(data: { payload?: string }): boolean {
    const payload = typeof data?.payload === 'string' ? data.payload : ''
    if (!payload) {
      return false
    }
    const state = this as unknown as TextConvertState
    state.modeInputs[this.data.activeMode] = payload
    this.setData({ inputText: payload, inputLength: Array.from(payload).length }, () =>
      this.compute(),
    )
    return true
  },

  modeFor(mode: PanelMode): ConvertMode {
    if (mode === 'case') {
      return this.data.caseMode
    }
    if (mode === 'naming') {
      return this.data.namingMode
    }
    if (mode === 'html') {
      return this.data.htmlMode
    }
    if (mode === 'clean') {
      return 'clean'
    }
    return 'unicode-escape'
  },

  cleanOptionsForEngine(): CleanOptions {
    const enabled = new Set(this.data.cleanOptions.filter((item) => item.on).map((item) => item.key))
    return {
      toHalfWidth: enabled.has('toHalfWidth'),
      removeSpaces: enabled.has('removeSpaces'),
      cjkPunctuation: enabled.has('cjkPunctuation'),
      removeBlankLines: enabled.has('removeBlankLines'),
      removeLineBreaks: enabled.has('removeLineBreaks'),
      removeInvisible: enabled.has('removeInvisible'),
      trimSpaces: true,
    }
  },

  compute() {
    const state = this as unknown as TextConvertState
    if (state.destroyed) {
      return
    }
    const source = this.data.inputText
    if (!source) {
      this.setData({
        hasResult: false,
        shellState: 'idle',
        resultMain: '',
        resultRows: [],
        resultText: '',
        convertSummary: '',
        truncated: false,
        error: '',
        posterData: null,
      })
      return
    }
    const mode = this.data.convertMode
    const result =
      mode === 'clean'
        ? convertText('clean', source, { clean: this.cleanOptionsForEngine() })
        : convertText(mode, source)
    if (!result.text) {
      this.setData({
        hasResult: false,
        shellState: 'idle',
        resultMain: '',
        resultRows: [],
        resultText: '',
        convertSummary: '',
        truncated: result.truncated,
        error: '',
        posterData: null,
      })
      return
    }
    const modeLabel =
      PANEL_OPTIONS.find((item) => item.key === this.data.activeMode)?.label ?? '转换'
    const rows: ResultRow[] = [
      { k: '变更字符数', v: String(result.changed) },
      { k: '结果字符数', v: String(Array.from(result.text).length) },
    ]
    if (this.data.activeMode === 'naming') {
      rows.push({ k: '对照', v: `${preview(source, 24)} → ${preview(result.text, 24)}` })
    }
    if (this.data.activeMode === 'clean') {
      const labels = this.data.cleanOptions.filter((item) => item.on).map((item) => item.label)
      rows.push({ k: '清洗项', v: labels.length ? labels.join(' · ') : '未选择清洗项' })
    }
    const poster: IPosterData = {
      toolName: '文本转换',
      category: '文本效率',
      mainResult: preview(result.text, 32),
      resultLabel: '转换结果',
      params: [{ label: '模式', value: modeLabel }],
      extras: [`变更 ${result.changed} 字符`, `结果 ${Array.from(result.text).length} 字符`],
    }
    this.setData({
      shellState: 'done',
      hasResult: true,
      error: '',
      resultLabel: '转换结果',
      resultMain: preview(result.text),
      resultRows: rows,
      resultText: result.text,
      convertSummary: result.text,
      truncated: result.truncated,
      posterData: poster,
    })
  },
})
