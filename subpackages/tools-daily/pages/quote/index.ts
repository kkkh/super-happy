/* ==========================================================================
   报价单 · 明细 / 优惠 / 税额 / 大写 / CSV
   - 行小计与合计全部按分；优惠先于计税
   - 固定标注“报价单，非发票”，不生成发票号码
   - CSV 只在本机写临时文件，用户主动分享
   ========================================================================== */
import { tapTick } from '../../../../core/utils/haptics'
import {
  formatCents,
  parseCents,
  parseDecimal,
} from '../../../../core/toolbox/engines/money'
import {
  QUOTE_MAX_ROWS,
  quoteCsv,
  quoteTotals,
  type QuoteRowInput,
} from '../../lib/quote'
import {
  canShareFile,
  cleanupExport,
  prepareExport,
  sharePrepared,
} from '../../../../core/services/export'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'
import type { IWorkflowData } from '../../../../core/workflow/types'
import { copyText } from '../../lib/ui'

interface QuoteRowDraft {
  id: number
  name: string
  quantity: string
  unitPrice: string
}

interface ResultRow {
  k: string
  v: string
}

interface QuoteState {
  destroyed: boolean
}

let rowSeed = 1

function createRow(): QuoteRowDraft {
  rowSeed += 1
  return { id: rowSeed, name: '', quantity: '1', unitPrice: '' }
}

Page({
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: '报价单',
    kicker: '职场辅助',
    desc: '明细小计 · 优惠 · 税额 · CSV',
    rows: [createRow()] as QuoteRowDraft[],
    taxText: '',
    discountText: '',
    resultLabel: '应付金额',
    resultMain: '',
    resultRows: [] as ResultRow[],
    quoteSummary: '',
    hasResult: false,
    canExport: false,
    csvPath: '',
    shellState: 'idle',
    error: '',
    posterData: null as IPosterData | null,
    formTouched: false,
  },

  onLoad() {
    const state = this as unknown as QuoteState
    state.destroyed = false
    this.setData({ canExport: canShareFile() })
  },

  onUnload() {
    const state = this as unknown as QuoteState
    state.destroyed = true
    const path = this.data.csvPath
    if (path) {
      cleanupExport(path)
    }
  },

  onAddRow() {
    const rows = this.data.rows as QuoteRowDraft[]
    if (rows.length >= QUOTE_MAX_ROWS) {
      this.setData({ error: `明细最多 ${QUOTE_MAX_ROWS} 行` })
      return
    }
    tapTick()
    this.setData({ rows: [...rows, createRow()], formTouched: true, error: '' })
  },

  onRemoveRow(event: WechatMiniprogram.TouchEvent) {
    const id = Number(event.currentTarget.dataset.id)
    const rows = this.data.rows as QuoteRowDraft[]
    if (rows.length <= 1) {
      return
    }
    tapTick()
    this.setData({
      rows: rows.filter((row) => row.id !== id),
      formTouched: true,
      error: '',
    })
  },

  onRowInput(event: WechatMiniprogram.Input) {
    const id = Number(event.currentTarget.dataset.id)
    const field = String(event.currentTarget.dataset.field || '')
    const value = String(event.detail.value ?? '')
    const rows = this.data.rows as QuoteRowDraft[]
    const index = rows.findIndex((row) => row.id === id)
    if (index < 0 || (field !== 'name' && field !== 'quantity' && field !== 'unitPrice')) {
      return
    }
    const patch: Record<string, string | boolean> = { formTouched: true, error: '' }
    patch[`rows[${index}].${field}`] = value
    this.setData(patch)
  },

  onFieldInput(event: WechatMiniprogram.Input) {
    const field = String(event.currentTarget.dataset.field || '')
    const value = String(event.detail.value ?? '')
    if (field === 'taxText' || field === 'discountText') {
      this.setData({ [field]: value, formTouched: true, error: '' })
    }
  },

  onExample() {
    tapTick()
    this.setData(
      {
        rows: [
          { id: rowSeed + 1, name: '设计服务', quantity: '1', unitPrice: '3000' },
          { id: rowSeed + 2, name: '部署支持', quantity: '2', unitPrice: '800' },
        ],
        taxText: '6',
        discountText: '200',
        formTouched: true,
        error: '',
      },
      () => {
        rowSeed += 2
        this.onRun()
      },
    )
  },

  onReset() {
    this.setData({
      rows: [createRow()],
      taxText: '',
      discountText: '',
      resultLabel: '应付金额',
      resultMain: '',
      resultRows: [],
      quoteSummary: '',
      hasResult: false,
      csvPath: '',
      shellState: 'idle',
      error: '',
      posterData: null,
      formTouched: false,
    })
  },

  onRun() {
    const state = this as unknown as QuoteState
    if (state.destroyed) {
      return
    }
    const drafts = this.data.rows as QuoteRowDraft[]
    const inputs: QuoteRowInput[] = []
    for (const row of drafts) {
      const name = row.name.trim()
      const qtyText = row.quantity.trim()
      const priceText = row.unitPrice.trim()
      if (!name && !qtyText && !priceText) {
        continue
      }
      const quantity = parseDecimal(qtyText, 0.01, 1000000, 2)
      const unitPriceCents = parseCents(priceText)
      if (quantity === null || unitPriceCents === null) {
        this.setData({
          shellState: 'invalid',
          hasResult: false,
          resultMain: '',
          resultRows: [],
          quoteSummary: '',
          error: '每行需填写大于 0 的数量与非负单价',
          posterData: null,
        })
        return
      }
      inputs.push({
        name: name || '未命名',
        quantity,
        unitPriceCents,
      })
    }
    if (inputs.length === 0) {
      this.setData({
        shellState: 'invalid',
        hasResult: false,
        resultMain: '',
        resultRows: [],
        quoteSummary: '',
        error: '请至少填写一行明细',
        posterData: null,
      })
      return
    }

    const taxText = String(this.data.taxText).trim()
    const taxPercent = taxText === '' ? null : parseDecimal(taxText, 0, 100, 2)
    if (taxText !== '' && taxPercent === null) {
      this.setData({
        shellState: 'invalid',
        hasResult: false,
        resultMain: '',
        resultRows: [],
        quoteSummary: '',
        error: '税率需在 0–100% 之间，最多两位小数',
        posterData: null,
      })
      return
    }
    const discountText = String(this.data.discountText).trim()
    const discountCents = discountText === '' ? 0 : parseCents(discountText)
    if (discountCents === null) {
      this.setData({
        shellState: 'invalid',
        hasResult: false,
        resultMain: '',
        resultRows: [],
        quoteSummary: '',
        error: '优惠金额需为大于等于 0 的数字，最多两位小数',
        posterData: null,
      })
      return
    }

    const totals = quoteTotals(inputs, taxPercent, discountCents)
    if (!totals) {
      this.setData({
        shellState: 'invalid',
        hasResult: false,
        resultMain: '',
        resultRows: [],
        quoteSummary: '',
        error: `明细需为 1–${QUOTE_MAX_ROWS} 行，数量大于 0，税率 0–100%`,
        posterData: null,
      })
      return
    }

    const rows: ResultRow[] = [
      { k: '合计', v: `¥${formatCents(totals.totalCents)}` },
      { k: '优惠', v: `-¥${formatCents(totals.discountCents)}` },
    ]
    if (totals.taxCents !== null) {
      rows.push({ k: '税额', v: `¥${formatCents(totals.taxCents)}` })
    }
    rows.push({ k: '应付', v: `¥${formatCents(totals.payableCents)}` })
    rows.push({ k: '大写', v: totals.chinese })

    const summaryParts = [
      `报价单`,
      `合计 ¥${formatCents(totals.totalCents)}`,
      totals.discountCents > 0 ? `优惠 ¥${formatCents(totals.discountCents)}` : '',
      totals.taxCents !== null ? `税额 ¥${formatCents(totals.taxCents)}` : '',
      `应付 ¥${formatCents(totals.payableCents)}`,
      totals.chinese,
    ].filter(Boolean)
    if (totals.discountClamped) {
      summaryParts.push('优惠超过合计，已按合计封顶')
    }
    const summary = summaryParts.join('；')

    const csv = quoteCsv(totals)
    prepareExport({ filename: '报价单', content: csv, format: 'csv' }).then((result) => {
      if (state.destroyed) {
        return
      }
      if (result.ok) {
        this.setData({ csvPath: result.path })
      }
    })

    const poster: IPosterData = {
      toolName: '报价单',
      category: '职场辅助',
      mainResult: `¥${formatCents(totals.payableCents)}`,
      resultLabel: '应付金额',
      params: [{ label: '明细', value: `${totals.rows.length} 行` }],
      extras: [
        `合计 ¥${formatCents(totals.totalCents)}`,
        totals.taxCents === null ? '未含税' : `税额 ¥${formatCents(totals.taxCents)}`,
        totals.chinese,
      ],
    }
    this.setData({
      shellState: 'done',
      hasResult: true,
      error: '',
      resultLabel: '应付金额',
      resultMain: `¥${formatCents(totals.payableCents)}`,
      resultRows: rows,
      quoteSummary: summary,
      csvPath: '',
      posterData: poster,
    })
  },

  onCopy() {
    const text = this.data.quoteSummary
    if (!text) {
      return
    }
    tapTick()
    copyText(text, '报价摘要已复制')
  },

  onCopyRow(event: WechatMiniprogram.TouchEvent) {
    const value = String(event.currentTarget.dataset.value || '')
    if (!value) {
      return
    }
    tapTick()
    copyText(value, '已复制')
  },

  onExportCsv() {
    const path = this.data.csvPath
    if (!path) {
      this.setData({ error: 'CSV 尚未生成，请先计算报价' })
      return
    }
    tapTick()
    sharePrepared(path, '报价单.csv').then((outcome) => {
      if (outcome === 'unsupported') {
        this.setData({ error: '当前微信版本不支持文件分享，请使用复制' })
      }
    })
  },

  onReceiveWorkflow(data: IWorkflowData): boolean {
    if (!data || data.type === 'image' || typeof data.payload !== 'string') {
      return false
    }
    const payload = data.payload.trim()
    if (!payload) {
      return false
    }
    const match = payload.replace(/,/g, '').match(/(\d+(?:\.\d{1,2})?)/)
    const priceCents = match ? Math.round(Number(match[1]) * 100) : 0
    const rows = this.data.rows as QuoteRowDraft[]
    if (rows.length >= QUOTE_MAX_ROWS) {
      return false
    }
    const next: QuoteRowDraft = {
      id: rowSeed + 1,
      name: payload.slice(0, 24),
      quantity: '1',
      unitPrice: (priceCents / 100).toFixed(2),
    }
    rowSeed += 1
    this.setData({ rows: [...rows, next], formTouched: true, error: '' }, () => this.onRun())
    return true
  },
})
