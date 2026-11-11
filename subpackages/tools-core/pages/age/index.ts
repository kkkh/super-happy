/* ==========================================================================
   年龄周岁 · 公历年月日比较
   - 周岁 / 月龄 / 总天数 / 下次生日
   - 闰日生日在平年按 2 月 28 日提示
   ========================================================================== */
import {
  ageParts,
  formatCN,
  nextBirthday,
  serialOfISO,
  todayISO,
  weekdayLabel,
} from '../../../../core/toolbox/engines/date'
import { copyText } from '../../lib/ui'
import { tapTick } from '../../../../core/utils/haptics'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'

Page({
  /* 此处是处理工具页分享与深链参数校验的边界 */
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: '年龄周岁',
    kicker: '日期时间',
    desc: '周岁、月龄与下次生日',
    birth: '',
    ref: '',
    birthLabel: '',
    refLabel: '',
    hasResult: false,
    error: '',
    ageValue: 0,
    ageText: '',
    ageSub: '',
    totalMonthsText: '',
    totalDaysText: '',
    virtualText: '',
    nextDaysText: '',
    nextDateText: '',
    copyPayload: '',
    posterData: null as IPosterData | null,
  },

  onLoad() {
    const ref = todayISO()
    this.setData({ ref, refLabel: formatCN(ref) })
  },

  onBirthChange(event: WechatMiniprogram.PickerChange) {
    const birth = String(event.detail.value)
    this.setData({ birth }, () => {
      this.recalculate()
    })
  },

  onRefChange(event: WechatMiniprogram.PickerChange) {
    const ref = String(event.detail.value)
    this.setData({ ref }, () => {
      this.recalculate()
    })
  },

  onToday() {
    tapTick()
    const ref = todayISO()
    this.setData({ ref }, () => {
      this.recalculate()
    })
  },

  onExample() {
    tapTick()
    const ref = todayISO()
    this.setData({ birth: '2000-01-01', ref }, () => {
      this.recalculate()
    })
  },

  onReset() {
    const ref = todayISO()
    this.setData(
      {
        birth: '',
        ref,
        birthLabel: '',
        refLabel: formatCN(ref),
        hasResult: false,
        error: '',
        ageValue: 0,
        ageText: '',
        ageSub: '',
        totalMonthsText: '',
        totalDaysText: '',
        virtualText: '',
        nextDaysText: '',
        nextDateText: '',
      },
      () => {
        this.recalculate()
      },
    )
  },

  /* ---- 草稿：生日与基准日；恢复后重新计算 ---- */
  collectDraftInput(): Record<string, string> {
    return { birth: this.data.birth, ref: this.data.ref }
  },

  applyDraftInput(input: Record<string, string>): void {
    const ref = input.ref || todayISO()
    this.setData(
      {
        birth: input.birth ?? '',
        ref,
        birthLabel: input.birth ? formatCN(input.birth) : '',
        refLabel: formatCN(ref),
        hasResult: false,
        error: '',
      },
      () => {
        this.recalculate()
      },
    )
  },

  onCopy() {
    copyText(this.data.copyPayload, '年龄结果已复制')
  },

  recalculate() {
    const birth = this.data.birth
    const ref = this.data.ref
    if (!birth || !ref) {
      this.setData({ hasResult: false, error: '' })
      return
    }
    const age = ageParts(birth, ref)
    if (!age) {
      this.setData({ hasResult: false, error: '基准日不能早于生日' })
      return
    }
    const next = nextBirthday(birth, ref)
    if (!next) {
      this.setData({ hasResult: false, error: '日期格式不正确' })
      return
    }

    const ageText = `${age.years} 岁`
    const ageSub = `${age.months} 个月 ${age.days} 天`
    const totalMonthsText = `${age.totalMonths} 个月`
    const totalDaysText = `${age.totalDays} 天`
    const virtualText = `${Number(ref.slice(0, 4)) - Number(birth.slice(0, 4)) + 1} 岁`
    const nextDaysText = next.today ? '就是今天' : `${next.days} 天后`
    const nextWeek = weekdayLabel(serialOfISO(next.dateISO) ?? 0)
    const nextDateText = `${formatCN(next.dateISO)} · ${nextWeek}${next.leapAdjusted ? '（闰日按 2 月 28 日提示）' : ''}`
    const copy = [
      '年龄与生日',
      `生日：${formatCN(birth)}`,
      `基准日：${formatCN(ref)}`,
      `周岁：${ageText} ${ageSub}`,
      `累计月龄：${totalMonthsText}`,
      `总天数：${totalDaysText}`,
      `下次生日：${next.today ? '今天' : `${next.days} 天后`}（${nextDateText}）`,
    ].join('\n')
    const poster: IPosterData = {
      toolName: '年龄周岁',
      category: '日期时间',
      mainResult: ageText,
      resultLabel: '周岁',
      params: [
        { label: '生日', value: formatCN(birth) },
        { label: '基准日', value: formatCN(ref) },
      ],
      extras: [
        `累计月龄 ${totalMonthsText}`,
        `总天数 ${totalDaysText}`,
        `虚岁 ${virtualText}`,
        `下次生日 ${nextDaysText}`,
      ],
    }

    this.setData({
      hasResult: true,
      error: '',
      birthLabel: formatCN(birth),
      refLabel: formatCN(ref),
      ageValue: age.years,
      ageText,
      ageSub,
      totalMonthsText,
      totalDaysText,
      virtualText,
      nextDaysText,
      nextDateText,
      copyPayload: copy,
      posterData: poster,
    })
  },
})
