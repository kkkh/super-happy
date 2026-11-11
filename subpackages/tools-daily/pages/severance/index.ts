/* ==========================================================================
   离职补偿 · N / N+1 · 封顶 · 未休年假
   - 月份输入独立校验；封顶开启时才要求社平月薪
   - 金额全部以分整数计算，展示两位小数
   - 结果只在本机计算，仅供参考，不构成法律意见
   ========================================================================== */
import { tapTick } from '../../../../core/utils/haptics'
import {
  formatCents,
  parseCents,
  parseDecimal,
  parseInteger,
} from '../../../../core/toolbox/engines/money'
import {
  MAX_LEAVE_DAYS,
  MAX_MONTHLY_CENTS,
  severanceSummary,
  severanceTotal,
  type SeveranceMode,
  type SeveranceResult,
} from '../../lib/severance'
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

interface SeveranceState {
  destroyed: boolean
}

const MODE_OPTIONS: Array<{ key: SeveranceMode; label: string }> = [
  { key: 'n', label: 'N' },
  { key: 'n1', label: 'N+1' },
]

function monthsText(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function emptyResult() {
  return {
    resultMain: '',
    resultLabel: '补偿合计',
    resultRows: [] as ResultRow[],
    severanceSummary: '',
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
    toolName: '离职补偿',
    kicker: '职场辅助',
    desc: 'N / N+1 · 封顶 · 年假折算',
    mode: 'n' as SeveranceMode,
    modeOptions: MODE_OPTIONS,
    monthly: '',
    years: '',
    months: '',
    capEnabled: false,
    social: '',
    leaveDays: '0',
    canRun: false,
    ...emptyResult(),
  },

  onLoad() {
    const state = this as unknown as SeveranceState
    state.destroyed = false
  },

  onUnload() {
    const state = this as unknown as SeveranceState
    state.destroyed = true
  },

  onMode(event: WechatMiniprogram.TouchEvent) {
    const mode = event.currentTarget.dataset.mode as SeveranceMode
    if ((mode !== 'n' && mode !== 'n1') || mode === this.data.mode) {
      return
    }
    tapTick()
    this.setData({ mode, ...emptyResult() })
  },

  onCap(event: WechatMiniprogram.TouchEvent) {
    const enabled = event.currentTarget.dataset.enabled === '1'
    if (enabled === this.data.capEnabled) {
      return
    }
    tapTick()
    this.setData({ capEnabled: enabled, ...emptyResult() }, () => this.updateCanRun())
  },

  onInput(event: WechatMiniprogram.Input) {
    const field = String(event.currentTarget.dataset.field || '')
    const allowed = ['monthly', 'years', 'months', 'social', 'leaveDays']
    if (!allowed.includes(field)) {
      return
    }
    this.setData({ [field]: event.detail.value, ...emptyResult() }, () =>
      this.updateCanRun(),
    )
  },

  onExample() {
    tapTick()
    this.setData(
      {
        mode: 'n',
        monthly: '20000',
        years: '5',
        months: '7',
        capEnabled: false,
        social: '',
        leaveDays: '3',
        ...emptyResult(),
      },
      () => this.onRun(),
    )
  },

  onReset() {
    this.setData({
      mode: 'n',
      monthly: '',
      years: '',
      months: '',
      capEnabled: false,
      social: '',
      leaveDays: '0',
      canRun: false,
      ...emptyResult(),
    })
  },

  onRun() {
    this.compute()
  },

  onCopy() {
    if (!this.data.severanceSummary) {
      return
    }
    tapTick()
    void copyText(this.data.severanceSummary, '补偿结果已复制')
  },

  onCopyRow(event: WechatMiniprogram.TouchEvent) {
    const value = String(event.currentTarget.dataset.value || '')
    if (!value) {
      return
    }
    tapTick()
    void copyText(value, '已复制')
  },

  readMonthly(): number | null {
    const cents = parseCents(this.data.monthly)
    if (cents === null || cents <= 0 || cents > MAX_MONTHLY_CENTS) {
      return null
    }
    return cents
  },

  readLeaveDays(): number | null {
    return parseDecimal(this.data.leaveDays, 0, MAX_LEAVE_DAYS, 1)
  },

  updateCanRun() {
    const monthly = this.readMonthly()
    const years = parseInteger(this.data.years, 0, 50)
    const months = parseInteger(this.data.months, 0, 11)
    const leave = this.readLeaveDays()
    const social = this.data.capEnabled ? parseCents(this.data.social) : 1
    const valid =
      monthly !== null &&
      years !== null &&
      months !== null &&
      years * 12 + months > 0 &&
      leave !== null &&
      social !== null &&
      social > 0
    this.setData({ canRun: valid })
  },

  compute() {
    const state = this as unknown as SeveranceState
    if (state.destroyed) {
      return
    }
    const monthly = this.readMonthly()
    if (monthly === null) {
      this.invalidate('月薪需大于 0 且不超过 1,000 万元')
      return
    }
    const years = parseInteger(this.data.years, 0, 50)
    const months = parseInteger(this.data.months, 0, 11)
    if (years === null || months === null) {
      this.invalidate('工作年限需填写 0–50 年与 0–11 个月')
      return
    }
    const leaveDays = this.readLeaveDays()
    if (leaveDays === null) {
      this.invalidate('未休年假需在 0–30 天之间，支持半天')
      return
    }
    const social = this.data.capEnabled ? parseCents(this.data.social) : 0
    if (this.data.capEnabled && (social === null || social <= 0)) {
      this.invalidate('启用封顶时，请填写大于 0 的当地社平月薪')
      return
    }

    const outcome = severanceTotal({
      monthlyCents: monthly,
      years,
      months,
      mode: this.data.mode,
      capEnabled: this.data.capEnabled,
      socialAverageCents: social ?? 0,
      unusedLeaveDays: leaveDays,
    })
    if (!outcome.ok) {
      this.invalidate(outcome.error)
      return
    }
    this.render(outcome.result)
  },

  render(result: SeveranceResult) {
    const main = `¥${formatCents(result.totalCents)}`
    const rows: ResultRow[] = [
      { k: '计发基数', v: `¥${formatCents(result.baseCents)}` },
      { k: '补偿年限', v: `${monthsText(result.yearsForComp)} 个月` },
      { k: '经济补偿（N）', v: `¥${formatCents(result.compensationCents)}` },
      {
        k: '代通知金（+1）',
        v: result.noticeCents > 0 ? `¥${formatCents(result.noticeCents)}` : '不含',
      },
      {
        k: '未休年假',
        v:
          result.leaveDays > 0
            ? `${result.leaveDays} 天 · ¥${formatCents(result.leavePayCents)}`
            : '未填写',
      },
      { k: '合计', v: `¥${formatCents(result.totalCents)}` },
    ]
    if (result.capped) {
      rows.push({ k: '基数封顶', v: '已按社平 3 倍计算' })
    }
    if (result.yearsCapped) {
      rows.push({ k: '年限封顶', v: '已按 12 年计算' })
    }

    const summary = severanceSummary(result)
    const poster: IPosterData = {
      toolName: '离职补偿',
      category: '职场辅助',
      mainResult: main,
      resultLabel: '补偿合计',
      params: [
        { label: '月薪', value: `¥${formatCents(result.monthlyCents)}` },
        { label: '方案', value: result.mode === 'n1' ? 'N+1' : 'N' },
      ],
      extras: [
        `补偿 ${monthsText(result.yearsForComp)} 个月`,
        `经济补偿 ¥${formatCents(result.compensationCents)}`,
      ],
    }
    this.setData({
      resultMain: main,
      resultRows: rows,
      severanceSummary: summary,
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
