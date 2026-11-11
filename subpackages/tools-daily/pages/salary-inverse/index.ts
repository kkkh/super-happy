/* ==========================================================================
   薪资反算 · 目标到手 → 税前月薪
   - 月度简化口径：5,000 元起征、7 级税率、五险一金 + 专项附加扣除
   - 二分逼近，误差 ≤1 分；税前上限 1,000,000 元/月
   - 不按累计预扣，结果仅供参考，不构成税务或劳动建议
   ========================================================================== */
import { tapTick } from '../../../../core/utils/haptics'
import {
  formatCents,
  parseCents,
  parseDecimal,
} from '../../../../core/toolbox/engines/money'
import { copyText } from '../../lib/ui'
import {
  SALARY_MAX_GROSS_CENTS,
  forwardSalaryNet,
  insuranceModeLabel,
  inverseSalary,
  parseSalaryWorkflowAmount,
  type InsuranceMode,
} from '../../lib/salary'
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

const MODE_OPTIONS: Array<{ key: InsuranceMode; label: string }> = [
  { key: 'ratio', label: '按比例' },
  { key: 'fixed', label: '固定金额' },
]

function amountInput(cents: number): string {
  const yuan = cents / 100
  return Number.isInteger(yuan) ? String(yuan) : yuan.toFixed(2)
}

function emptyResult() {
  return {
    grossText: '',
    salarySummary: '',
    resultRows: [] as ResultRow[],
    verificationNote: '',
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
    toolName: '薪资反算',
    kicker: '职场辅助',
    desc: '目标到手 · 反推税前 · 月度简化口径',
    targetNet: '',
    insuranceMode: 'ratio' as InsuranceMode,
    modeOptions: MODE_OPTIONS,
    insuranceRatio: '',
    insuranceFixed: '',
    special: '',
    formTouched: false,
    ...emptyResult(),
  },

  onInput(event: WechatMiniprogram.Input) {
    const field = String(event.currentTarget.dataset.field || '')
    if (
      field !== 'targetNet' &&
      field !== 'insuranceRatio' &&
      field !== 'insuranceFixed' &&
      field !== 'special'
    ) {
      return
    }
    this.setData({ [field]: event.detail.value, formTouched: true, ...emptyResult() })
  },

  onMode(event: WechatMiniprogram.TouchEvent) {
    const mode = event.currentTarget.dataset.mode as InsuranceMode
    if (mode !== 'ratio' && mode !== 'fixed') {
      return
    }
    if (mode === this.data.insuranceMode) {
      return
    }
    tapTick()
    this.setData({ insuranceMode: mode, formTouched: true, ...emptyResult() })
  },

  onExample() {
    tapTick()
    this.setData(
      {
        targetNet: '10000',
        insuranceMode: 'ratio',
        insuranceRatio: '10.5',
        insuranceFixed: '',
        special: '1000',
        formTouched: true,
        ...emptyResult(),
      },
      () => this.compute(),
    )
  },

  onReset() {
    this.setData({
      targetNet: '',
      insuranceMode: 'ratio',
      insuranceRatio: '',
      insuranceFixed: '',
      special: '',
      formTouched: false,
      ...emptyResult(),
    })
  },

  onRun() {
    this.compute()
  },

  onCopy() {
    if (!this.data.salarySummary) {
      return
    }
    tapTick()
    void copyText(this.data.salarySummary, '薪资反算结果已复制')
  },

  onReceiveWorkflow(data: IWorkflowData): boolean {
    if (!data || data.type !== 'text' || typeof data.payload !== 'string') {
      return false
    }
    const targetCents = parseSalaryWorkflowAmount(data.payload)
    if (targetCents === null) {
      return false
    }
    this.setData(
      {
        targetNet: amountInput(targetCents),
        formTouched: true,
        ...emptyResult(),
      },
      () => this.compute(),
    )
    return true
  },

  compute() {
    const targetNetCents = parseCents(this.data.targetNet)
    if (targetNetCents === null || targetNetCents <= 0) {
      this.invalidate('请输入大于 0 的目标到手月薪，最多两位小数')
      return
    }
    if (targetNetCents > SALARY_MAX_GROSS_CENTS) {
      this.invalidate('目标到手不能超过 1,000,000 元/月')
      return
    }

    const mode = this.data.insuranceMode
    let ratio = 0
    let fixedCents = 0
    if (mode === 'ratio') {
      const parsedRatio = parseDecimal(this.data.insuranceRatio, 0, 100, 2)
      if (parsedRatio === null) {
        this.invalidate('五险一金比例需在 0–100% 之间，最多两位小数')
        return
      }
      ratio = parsedRatio
    } else if (this.data.insuranceFixed.trim()) {
      const parsedFixed = parseCents(this.data.insuranceFixed)
      if (parsedFixed === null) {
        this.invalidate('五险一金固定金额格式不正确')
        return
      }
      fixedCents = parsedFixed
    }

    let specialCents = 0
    if (this.data.special.trim()) {
      const parsedSpecial = parseCents(this.data.special)
      if (parsedSpecial === null) {
        this.invalidate('专项附加扣除格式不正确')
        return
      }
      specialCents = parsedSpecial
    }

    const input = {
      targetNetCents,
      insuranceMode: mode,
      insuranceRatio: ratio,
      insuranceFixedCents: fixedCents,
      specialCents,
    }
    const result = inverseSalary(input)
    if (!result) {
      const maxBreakdown = forwardSalaryNet(SALARY_MAX_GROSS_CENTS, input)
      if (maxBreakdown && maxBreakdown.netCents < targetNetCents) {
        this.invalidate('目标到手超过当前参数下可达到的上限，请降低目标或调整五险一金')
      } else {
        this.invalidate('未能在 60 次迭代内收敛，请调整五险一金或专项附加扣除后重试')
      }
      return
    }

    const grossText = `¥${formatCents(result.grossCents)}`
    const diff = Math.abs(result.netCents - targetNetCents)
    const verificationNote =
      diff > 0 ? `校验到手与目标相差 ¥${formatCents(diff)}，在 1 分误差内` : ''
    const resultRows: ResultRow[] = [
      { k: '五险一金', v: `${insuranceModeLabel(mode)} · ¥${formatCents(result.insuranceCents)}` },
      { k: '专项附加扣除', v: `¥${formatCents(result.specialCents)}` },
      { k: '应纳税所得额', v: `¥${formatCents(result.taxableCents)}` },
      { k: '个人所得税', v: `¥${formatCents(result.taxCents)}` },
      { k: '校验到手', v: `¥${formatCents(result.netCents)}` },
      {
        k: '适用级距',
        v: result.taxableCents === 0 ? '未达起征点' : result.bracket.label,
      },
      { k: '二分迭代', v: `${result.iterations} 次` },
    ]
    const poster: IPosterData = {
      toolName: '薪资反算',
      category: '财务计算',
      mainResult: grossText,
      resultLabel: '税前月薪',
      params: [
        { label: '目标到手', value: `¥${formatCents(targetNetCents)}` },
        { label: '五险一金', value: `¥${formatCents(result.insuranceCents)}` },
        { label: '专项附加', value: `¥${formatCents(result.specialCents)}` },
      ],
      extras: [
        `个税 ¥${formatCents(result.taxCents)}`,
        `校验到手 ¥${formatCents(result.netCents)}`,
        '月度简化口径，仅供参考',
      ],
    }

    this.setData({
      grossText,
      salarySummary: result.summary,
      resultRows,
      verificationNote,
      hasResult: true,
      shellState: 'done',
      error: '',
      posterData: poster,
      formTouched: true,
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
