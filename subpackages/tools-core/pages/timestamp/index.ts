/* ==========================================================================
   时间戳转换 · 秒 / 毫秒双向
   - 时间戳 → 本地时间 + UTC 对照
   - 日期时间 → 时间戳
   - 有效范围：1900–2100
   ========================================================================== */
import {
  formatCN,
  formatClock,
  formatDateTime,
  formatUTC,
  parseDateTime,
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

type TimestampMode = 'to-date' | 'to-stamp'
type StampUnit = 's' | 'ms'

Page({
  /* 此处是处理工具页分享与深链参数校验的边界 */
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: '时间戳',
    kicker: '日期时间',
    desc: '秒 / 毫秒双向转换',
    mode: 'to-date' as TimestampMode,
    unit: 's' as StampUnit,
    stampValue: '',
    dateValue: '',
    timeValue: '',
    hasResult: false,
    error: '',
    localText: '',
    utcText: '',
    weekdayText: '',
    cnText: '',
    stampText: '',
    stampNumber: 0,
    heroLabel: '本地时间',
    copyPayload: '',
    posterData: null as IPosterData | null,
  },

  onLoad() {
    const now = new Date()
    this.setData(
      {
        stampValue: String(Math.floor(now.getTime() / 1000)),
        dateValue: todayISO(),
        timeValue: formatClock(now),
      },
      () => {
        this.recalculate()
      },
    )
  },

  onMode(event: WechatMiniprogram.TouchEvent) {
    const mode = event.currentTarget.dataset.mode as TimestampMode
    if (mode !== 'to-date' && mode !== 'to-stamp') {
      return
    }
    if (mode === this.data.mode) {
      return
    }
    tapTick()
    this.setData({ mode, hasResult: false, error: '' })
    this.onNow()
  },

  onUnit(event: WechatMiniprogram.TouchEvent) {
    const unit = event.currentTarget.dataset.unit as StampUnit
    if (unit !== 's' && unit !== 'ms') {
      return
    }
    if (unit === this.data.unit) {
      return
    }
    tapTick()
    const next: { unit: StampUnit; stampValue?: string } = { unit }
    if (this.data.mode === 'to-date') {
      const raw = this.data.stampValue.trim()
      if (/^-?\d{1,13}$/.test(raw)) {
        const value = Number(raw)
        next.stampValue =
          unit === 'ms' ? String(roundToSafe(value * 1000)) : String(roundToSafe(value / 1000))
      }
    }
    this.setData(next, () => {
      this.recalculate()
    })
  },

  onStampInput(event: WechatMiniprogram.Input) {
    this.setData({ stampValue: event.detail.value }, () => {
      this.recalculate()
    })
  },

  onDateChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ dateValue: String(event.detail.value) }, () => {
      this.recalculate()
    })
  },

  onTimeChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ timeValue: String(event.detail.value) }, () => {
      this.recalculate()
    })
  },

  onNow() {
    tapTick()
    const now = new Date()
    this.setData(
      {
        stampValue: String(
          this.data.unit === 'ms' ? now.getTime() : Math.floor(now.getTime() / 1000),
        ),
        dateValue: todayISO(),
        timeValue: formatClock(now),
      },
      () => {
        this.recalculate()
      },
    )
  },

  onExample() {
    tapTick()
    this.setData(
      {
        mode: 'to-date',
        unit: 's',
        stampValue: '1700000000',
      },
      () => {
        this.recalculate()
      },
    )
  },

  onReset() {
    this.onNow()
  },

  /* ---- 草稿：模式、单位、时间戳与日期时间；恢复后重新转换 ---- */
  draftMode(): string {
    return this.data.mode
  },

  collectDraftInput(): Record<string, string> {
    return {
      unit: this.data.unit,
      stampValue: this.data.stampValue,
      dateValue: this.data.dateValue,
      timeValue: this.data.timeValue,
    }
  },

  applyDraftInput(input: Record<string, string>, mode: string): void {
    this.setData(
      {
        mode: mode === 'to-stamp' ? 'to-stamp' : 'to-date',
        unit: input.unit === 'ms' ? 'ms' : 's',
        stampValue: input.stampValue ?? '',
        dateValue: input.dateValue || todayISO(),
        timeValue: input.timeValue || '00:00',
        hasResult: false,
        error: '',
      },
      () => {
        this.recalculate()
      },
    )
  },

  onCopy() {
    copyText(this.data.copyPayload, '时间戳结果已复制')
  },

  recalculate() {
    if (this.data.mode === 'to-date') {
      this.fromStamp()
    } else {
      this.fromDate()
    }
  },

  fromStamp() {
    const raw = this.data.stampValue.trim()
    if (!/^-?\d{1,13}$/.test(raw)) {
      this.setData({ hasResult: false, error: '请输入 10 位秒级或 13 位毫秒级时间戳' })
      return
    }
    const value = Number(raw)
    const ms = this.data.unit === 's' ? value * 1000 : value
    const date = new Date(ms)
    const year = date.getFullYear()
    if (!Number.isFinite(ms) || year < 1900 || year > 2100) {
      this.setData({ hasResult: false, error: '时间戳超出 1900–2100 年范围' })
      return
    }
    const localText = formatDateTime(date)
    const utcText = formatUTC(date)
    const weekdayText = weekdayLabel(serialOfISO(formatDateOnly(date)) ?? 0)
    const cnText = formatCN(formatDateOnly(date))
    const copy = [
      `时间戳（${this.data.unit === 's' ? '秒' : '毫秒'}）：${raw}`,
      `本地时间：${localText}`,
      `UTC：${utcText}`,
      `星期：${weekdayText}`,
    ].join('\n')
    const unitLabel = this.data.unit === 's' ? '秒' : '毫秒'
    const poster: IPosterData = {
      toolName: '时间戳',
      category: '日期时间',
      mainResult: localText,
      resultLabel: '本地时间',
      params: [
        { label: '时间戳', value: raw },
        { label: '单位', value: unitLabel },
      ],
      extras: [
        `UTC ${utcText}`,
        `星期 ${weekdayText}`,
        `中文日期 ${cnText}`,
        `时间戳 ${raw}`,
      ],
    }
    this.setData({
      hasResult: true,
      error: '',
      heroLabel: '本地时间',
      localText,
      utcText,
      weekdayText,
      cnText,
      stampText: raw,
      copyPayload: copy,
      posterData: poster,
    })
  },

  fromDate() {
    const date = parseDateTime(this.data.dateValue, this.data.timeValue)
    if (!date) {
      this.setData({ hasResult: false, error: '请选择有效的日期与时间' })
      return
    }
    const ms = date.getTime()
    const stamp = this.data.unit === 'ms' ? ms : Math.floor(ms / 1000)
    const localText = formatDateTime(date)
    const utcText = formatUTC(date)
    const weekdayText = weekdayLabel(serialOfISO(this.data.dateValue) ?? 0)
    const cnText = formatCN(this.data.dateValue)
    const stampText = String(stamp)
    const copy = [
      `本地时间：${localText}`,
      `时间戳（${this.data.unit === 's' ? '秒' : '毫秒'}）：${stampText}`,
      `UTC：${utcText}`,
    ].join('\n')
    const unitLabel = this.data.unit === 's' ? '秒' : '毫秒'
    const poster: IPosterData = {
      toolName: '时间戳',
      category: '日期时间',
      mainResult: stampText,
      resultLabel: `${unitLabel}级时间戳`,
      params: [
        { label: '日期', value: this.data.dateValue },
        { label: '时间', value: this.data.timeValue },
      ],
      extras: [
        `本地 ${localText}`,
        `UTC ${utcText}`,
        `星期 ${weekdayText}`,
        `中文 ${cnText}`,
      ],
    }
    this.setData({
      hasResult: true,
      error: '',
      heroLabel: '时间戳',
      localText,
      utcText,
      weekdayText,
      cnText,
      stampText,
      stampNumber: stamp,
      copyPayload: copy,
      posterData: poster,
    })
  },
})

function formatDateOnly(date: Date): string {
  const month = date.getMonth() + 1
  const day = date.getDate()
  return `${date.getFullYear()}-${month < 10 ? `0${month}` : month}-${day < 10 ? `0${day}` : day}`
}

function roundToSafe(value: number): number {
  return Math.round(value)
}
