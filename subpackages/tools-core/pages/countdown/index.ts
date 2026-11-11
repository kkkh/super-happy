/* ==========================================================================
   倒数日 · 本地日期差
   - 只在前台展示，不申请订阅消息、不做后台推送
   - 目标日默认今天 +30 天
   ========================================================================== */
import {
  addDays,
  dayDiff,
  formatCN,
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
    toolName: '倒数日',
    kicker: '日期时间',
    desc: '距离目标日还有几天',
    title: '',
    target: '',
    targetLabel: '',
    hasResult: false,
    error: '',
    daysValue: 0,
    daysText: '',
    stateText: '',
    weekdayText: '',
    weeksText: '',
    heroLabel: '距离目标日',
    copyPayload: '',
    posterData: null as IPosterData | null,
  },

  onLoad() {
    const target = addDays(todayISO(), 30) ?? todayISO()
    this.setData({ target }, () => {
      this.recalculate()
    })
  },

  onShow() {
    /* 系统时间可能在后台被改动：回前台时按当前本机日期重算，避免展示过期天数 */
    if (this.data.target) {
      this.recalculate()
    }
  },

  onTitleInput(event: WechatMiniprogram.Input) {
    this.setData({ title: event.detail.value }, () => {
      this.recalculate()
    })
  },

  onTargetChange(event: WechatMiniprogram.PickerChange) {
    const target = String(event.detail.value)
    this.setData({ target }, () => {
      this.recalculate()
    })
  },

  onQuick(event: WechatMiniprogram.TouchEvent) {
    const days = Number(event.currentTarget.dataset.days)
    if (!Number.isFinite(days)) {
      return
    }
    tapTick()
    const target = addDays(todayISO(), days) ?? todayISO()
    this.setData({ target }, () => {
      this.recalculate()
    })
  },

  onExample() {
    tapTick()
    this.setData({ title: '新年', target: '2027-01-01' }, () => {
      this.recalculate()
    })
  },

  onReset() {
    const target = addDays(todayISO(), 30) ?? todayISO()
    this.setData({ title: '', target }, () => {
      this.recalculate()
    })
  },

  onCopy() {
    copyText(this.data.copyPayload, '倒数日结果已复制')
  },

  recalculate() {
    const target = this.data.target
    if (!target) {
      this.setData({ hasResult: false })
      return
    }
    const diff = dayDiff(todayISO(), target)
    if (diff === null) {
      this.setData({ hasResult: false, error: '目标日期格式不正确' })
      return
    }
    const abs = Math.abs(diff)
    const daysText = `${abs}`
    const stateText = diff === 0 ? '就是今天' : diff > 0 ? `还有 ${abs} 天` : `已过去 ${abs} 天`
    const weekdayText = weekdayLabel(serialOfISO(target) ?? 0)
    const weeksText = `${(abs / 7).toFixed(1)} 周`
    const heroLabel = this.data.title.trim() || '距离目标日'
    const copy = [
      this.data.title.trim() || '倒数日',
      `目标日：${formatCN(target)}（${weekdayText}）`,
      stateText,
      `约合 ${weeksText}`,
    ].join('\n')
    const title = this.data.title.trim()
    const poster: IPosterData = {
      toolName: '倒数日',
      category: '日期时间',
      mainResult: daysText,
      resultLabel: title ? `距离${title}` : '距离目标日',
      params: [
        { label: '目标日', value: formatCN(target) },
        ...(title ? [{ label: '事件名称', value: title }] : []),
      ],
      extras: [
        `目标日 ${formatCN(target)}`,
        `约合 ${weeksText}`,
        `${weekdayText} · ${stateText}`,
      ],
    }

    this.setData({
      hasResult: true,
      error: '',
      targetLabel: formatCN(target),
      daysValue: abs,
      daysText,
      stateText,
      weekdayText,
      weeksText,
      heroLabel,
      copyPayload: copy,
      posterData: poster,
    })
  },
})
