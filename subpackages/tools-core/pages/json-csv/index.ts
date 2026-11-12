/* ==========================================================================
   JSON ↔ CSV · 双向转换
   - JSON → CSV：表头取对象键并集，缺失留空，输出带 BOM
   - CSV → JSON：首行表头，单元格全部保留字符串，不做类型推断
   - 双向独立缓存输入；摘要与 silent 执行器共用 csv 引擎
   ========================================================================== */
import { tapTick } from '../../../../core/utils/haptics'
import { LIMITS } from '../../../../core/constants/index'
import {
  csvToJson,
  jsonToCsv,
  type CsvResult,
} from '../../../../core/toolbox/engines/csv'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'
import { copyText } from '../../lib/ui'

type CsvDirection = 'json-to-csv' | 'csv-to-json'

interface ResultRow {
  k: string
  v: string
}

interface ModeMeta {
  label: string
  inputLabel: string
  inputHint: string
  placeholder: string
  sample: string
  resultLabel: string
  action: string
}

interface JsonCsvState {
  destroyed: boolean
  modeInputs: Record<CsvDirection, string>
}

const JSON_SAMPLE = JSON.stringify(
  [
    { name: '超欢', type: '工具箱', score: 98 },
    { name: '秦超', type: '独立开发', score: 95, note: '本机处理' },
  ],
  null,
  2,
)

const CSV_SAMPLE = ['name,type,score,note', '超欢,工具箱,98,', '秦超,独立开发,95,本机处理'].join(
  '\n',
)

const MODE_OPTIONS: Array<{ key: CsvDirection; label: string }> = [
  { key: 'json-to-csv', label: 'JSON → CSV' },
  { key: 'csv-to-json', label: 'CSV → JSON' },
]

const MODE_META: Record<CsvDirection, ModeMeta> = {
  'json-to-csv': {
    label: 'JSON → CSV',
    inputLabel: 'JSON 对象数组',
    inputHint: '表头取所有对象键的并集，缺失字段留空；最多 20,000 字符',
    placeholder: '[{"name":"超欢","score":98}]',
    sample: JSON_SAMPLE,
    resultLabel: 'CSV 结果',
    action: '转换为 CSV',
  },
  'csv-to-json': {
    label: 'CSV → JSON',
    inputLabel: 'CSV 文本',
    inputHint: '首行为表头；所有单元格按字符串输出；最多 20,000 字符',
    placeholder: 'name,score\n超欢,98',
    sample: CSV_SAMPLE,
    resultLabel: 'JSON 结果',
    action: '转换为 JSON',
  },
}

function emptyResult() {
  return {
    outputText: '',
    resultLabel: '转换结果',
    resultMeta: '',
    resultRows: [] as ResultRow[],
    warnings: [] as string[],
    csvSummary: '',
    hasResult: false,
    shellState: 'idle' as string,
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
    toolName: 'JSON ↔ CSV',
    kicker: '文本效率',
    desc: '双向转换 · 表头并集 · 转义',
    mode: 'json-to-csv' as CsvDirection,
    modeOptions: MODE_OPTIONS,
    modeMeta: MODE_META['json-to-csv'],
    input: '',
    maxText: LIMITS.TEXT_INPUT,
    canRun: false,
    ...emptyResult(),
  },

  onLoad() {
    const state = this as unknown as JsonCsvState
    state.destroyed = false
    state.modeInputs = { 'json-to-csv': '', 'csv-to-json': '' }
  },

  onUnload() {
    const state = this as unknown as JsonCsvState
    state.destroyed = true
  },

  onMode(event: WechatMiniprogram.TouchEvent) {
    const mode = event.currentTarget.dataset.mode as CsvDirection
    if (!MODE_META[mode] || mode === this.data.mode) {
      return
    }
    const state = this as unknown as JsonCsvState
    state.modeInputs[this.data.mode] = this.data.input
    tapTick()
    this.setData(
      {
        mode,
        modeMeta: MODE_META[mode],
        input: state.modeInputs[mode],
        canRun: state.modeInputs[mode].trim().length > 0,
        ...emptyResult(),
      },
      () => this.updateCanRun(),
    )
  },

  onInput(event: WechatMiniprogram.TextareaInput) {
    this.setData({ input: event.detail.value, ...emptyResult() }, () => this.updateCanRun())
  },

  onExample() {
    tapTick()
    this.setData(
      {
        input: MODE_META[this.data.mode].sample,
        ...emptyResult(),
      },
      () => this.onRun(),
    )
  },

  onReset() {
    const state = this as unknown as JsonCsvState
    state.modeInputs = { 'json-to-csv': '', 'csv-to-json': '' }
    this.setData({
      mode: 'json-to-csv',
      modeMeta: MODE_META['json-to-csv'],
      input: '',
      canRun: false,
      ...emptyResult(),
    })
  },

  /* ---- 草稿：模式与输入；恢复后重新转换 ---- */
  draftMode(): string {
    return this.data.mode
  },

  collectDraftInput(): Record<string, string> {
    return { input: this.data.input }
  },

  applyDraftInput(input: Record<string, string>, mode: string): void {
    const nextMode: CsvDirection = MODE_META[mode as CsvDirection]
      ? (mode as CsvDirection)
      : 'json-to-csv'
    const value = input.input ?? ''
    const state = this as unknown as JsonCsvState
    state.modeInputs[nextMode] = value
    this.setData(
      {
        mode: nextMode,
        modeMeta: MODE_META[nextMode],
        input: value,
        canRun: value.trim().length > 0,
        ...emptyResult(),
      },
      () => {
        this.updateCanRun()
        this.onRun()
      },
    )
  },

  onRun() {
    this.compute()
  },

  onCopy() {
    if (!this.data.outputText) {
      return
    }
    tapTick()
    void copyText(this.data.outputText, '转换结果已复制')
  },

  onCopyRow(event: WechatMiniprogram.TouchEvent) {
    const value = String(event.currentTarget.dataset.value || '')
    if (!value) {
      return
    }
    tapTick()
    void copyText(value, '已复制')
  },

  updateCanRun() {
    this.setData({ canRun: this.data.input.trim().length > 0 })
  },

  compute() {
    const state = this as unknown as JsonCsvState
    if (state.destroyed) {
      return
    }
    if (!this.data.input.trim()) {
      this.invalidate('请先粘贴 JSON 数组或 CSV 文本')
      return
    }
    const result: CsvResult =
      this.data.mode === 'json-to-csv'
        ? jsonToCsv(this.data.input, { bom: true })
        : csvToJson(this.data.input)
    if (!result.ok) {
      this.invalidate(result.error)
      return
    }

    const meta = MODE_META[this.data.mode]
    const headLabel = result.headers.slice(0, 6).join('、')
    const headerText =
      result.headers.length > 6 ? `${headLabel}…` : headLabel || '（空表头）'
    const rows: ResultRow[] =
      this.data.mode === 'json-to-csv'
        ? [
            { k: '列数', v: `${result.headers.length} 列` },
            { k: '数据行', v: `${result.rowCount} 行` },
            { k: '表头', v: headerText },
          ]
        : [
            { k: '字段数', v: `${result.headers.length} 个` },
            { k: '数据行', v: `${result.rowCount} 行` },
            { k: '字段', v: headerText },
          ]
    const extras =
      result.warnings.length > 0 ? result.warnings : [`共 ${result.rowCount} 行数据`]
    const poster: IPosterData = {
      toolName: 'JSON ↔ CSV',
      category: '文本效率',
      mainResult: `${result.rowCount} 行 × ${result.headers.length} 列`,
      resultLabel: meta.label,
      params: [
        { label: '方向', value: meta.label },
        { label: '表头', value: headerText },
      ],
      extras,
    }

    this.setData({
      outputText: result.output,
      resultLabel: meta.resultLabel,
      resultMeta: `${result.headers.length} 列 · ${result.rowCount} 行`,
      resultRows: rows,
      warnings: result.warnings,
      csvSummary: result.output,
      hasResult: true,
      shellState: 'done',
      error: '',
      canRun: true,
      posterData: poster,
    })
  },

  invalidate(message: string) {
    this.setData({
      ...emptyResult(),
      shellState: 'invalid',
      error: message,
    })
  },
})
