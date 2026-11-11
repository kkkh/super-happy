/* ==========================================================================
   时区换算 · 墙钟 → 墙钟
   - 内置常用城市固定偏移；夏令时由用户手动 +1 小时
   - 源时区默认本机；目标时区默认伦敦
   - 摘要与跳转注入同源 convertZone / timezoneSummaryText
   ========================================================================== */
import { tapTick } from '../../../../core/utils/haptics'
import { parseISODate, todayISO } from '../../../../core/toolbox/engines/date'
import {
  WORLD_CLOCK_CITY_IDS,
  ZONE_PRESETS,
  convertZone,
  localZone,
  timezoneSummaryText,
  worldClock,
  worldClockSummaryText,
  type TimezoneResult,
  type TimezoneZone,
  type WorldClockRow,
} from '../../../../core/toolbox/engines/timezone'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'
import type { IWorkflowData } from '../../../../core/workflow/types'
import { copyText } from '../../lib/ui'

interface ResultRow {
  k: string
  v: string
}

interface TimezoneState {
  destroyed: boolean
}

type TimezoneMode = 'convert' | 'world'

const DEFAULT_TARGET_ID = 'london'

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

function currentTime(): string {
  const now = new Date()
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`
}

function zoneList(): TimezoneZone[] {
  return [localZone(), ...ZONE_PRESETS]
}

function zoneIndexOf(zones: TimezoneZone[], id: string): number {
  const index = zones.findIndex((zone) => zone.id === id)
  return index >= 0 ? index : 0
}

function worldCities(): TimezoneZone[] {
  return WORLD_CLOCK_CITY_IDS.map((id) => ZONE_PRESETS.find((zone) => zone.id === id)).filter(
    (zone): zone is TimezoneZone => zone !== undefined,
  )
}

function toRows(result: TimezoneResult): ResultRow[] {
  return [
    { k: '源时间', v: `${result.sourceDateTime} ${result.sourceWeekday}` },
    { k: '源时区', v: `${result.sourceOffsetLabel} ${result.sourceZoneLabel}` },
    { k: '目标星期', v: result.targetWeekday },
    { k: '目标 UTC 偏移', v: result.targetOffsetLabel },
    { k: '与源时差', v: result.diffLabel },
    { k: '跨日', v: result.crossDay ? '是（日期已变化）' : '否' },
  ]
}

Page({
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: '时区换算',
    kicker: '日期时间',
    desc: '跨时区墙钟 · 世界时钟同屏 · 手动夏令时',
    mode: 'convert' as TimezoneMode,
    date: todayISO(),
    time: currentTime(),
    zones: zoneList(),
    sourceIndex: 0,
    targetIndex: 1,
    sourceZoneLabel: '本机',
    targetZoneLabel: '伦敦',
    sourceDst: false,
    targetDst: false,
    worldDstIds: [] as string[],
    worldRows: [] as WorldClockRow[],
    resultLabel: '目标时间',
    resultMain: '',
    resultRows: [] as ResultRow[],
    timezoneSummary: '',
    shellState: 'idle',
    hasResult: false,
    error: '',
    posterData: null as IPosterData | null,
  },

  onLoad() {
    const state = this as unknown as TimezoneState
    state.destroyed = false
    const zones = this.data.zones as TimezoneZone[]
    const targetIndex = zoneIndexOf(zones, DEFAULT_TARGET_ID)
    this.setData(
      {
        targetIndex,
        targetZoneLabel: zones[targetIndex]?.label ?? '伦敦',
      },
      () => this.onRun(),
    )
  },

  onUnload() {
    const state = this as unknown as TimezoneState
    state.destroyed = true
  },

  onDateChange(event: WechatMiniprogram.PickerChange) {
    this.setData(
      { date: String(event.detail.value || ''), error: '' },
      () => this.onRun(),
    )
  },

  onTimeChange(event: WechatMiniprogram.PickerChange) {
    this.setData(
      { time: String(event.detail.value || ''), error: '' },
      () => this.onRun(),
    )
  },

  onMode(event: WechatMiniprogram.TouchEvent) {
    const mode = event.currentTarget.dataset.mode as TimezoneMode
    if (mode !== 'convert' && mode !== 'world') {
      return
    }
    if (mode === this.data.mode) {
      return
    }
    tapTick()
    this.setData({ mode, error: '' }, () => {
      if (mode === 'world') {
        this.runWorldClock()
      } else {
        this.onRun()
      }
    })
  },

  onWorldDst(event: { currentTarget: { dataset: { id?: string } }; detail: { value: boolean } }) {
    const id = String(event.currentTarget.dataset.id || '')
    if (!id) {
      return
    }
    const checked = Boolean(event.detail.value)
    const zones = this.data.zones as TimezoneZone[]
    const source = zones[this.data.sourceIndex] ?? zones[0]
    if (source && id === source.id) {
      this.setData({ sourceDst: checked, error: '' }, () => this.runWorldClock())
      return
    }
    const current = this.data.worldDstIds as string[]
    const next = checked
      ? Array.from(new Set([...current, id]))
      : current.filter((item) => item !== id)
    this.setData({ worldDstIds: next, error: '' }, () => this.runWorldClock())
  },

  onSourceChange(event: WechatMiniprogram.PickerChange) {
    const zones = this.data.zones as TimezoneZone[]
    const index = Number(event.detail.value)
    const zone = zones[index]
    if (!zone) {
      return
    }
    this.setData({ sourceIndex: index, sourceZoneLabel: zone.label, error: '' }, () =>
      this.onRun(),
    )
  },

  onTargetChange(event: WechatMiniprogram.PickerChange) {
    const zones = this.data.zones as TimezoneZone[]
    const index = Number(event.detail.value)
    const zone = zones[index]
    if (!zone) {
      return
    }
    this.setData({ targetIndex: index, targetZoneLabel: zone.label, error: '' }, () =>
      this.onRun(),
    )
  },

  onToggle(event: { currentTarget: { dataset: { field?: string } }; detail: { value: boolean } }) {
    const field = String(event.currentTarget.dataset.field || '')
    const checked = Boolean(event.detail.value)
    if (field === 'sourceDst') {
      this.setData({ sourceDst: checked, error: '' }, () => this.onRun())
      return
    }
    if (field === 'targetDst') {
      this.setData({ targetDst: checked, error: '' }, () => this.onRun())
    }
  },

  onExample() {
    tapTick()
    const zones = this.data.zones as TimezoneZone[]
    const sourceIndex = zoneIndexOf(zones, 'beijing')
    const targetIndex = zoneIndexOf(zones, DEFAULT_TARGET_ID)
    this.setData(
      {
        date: '2026-01-01',
        time: '10:00',
        sourceIndex,
        targetIndex,
        sourceZoneLabel: zones[sourceIndex]?.label ?? '北京',
        targetZoneLabel: zones[targetIndex]?.label ?? '伦敦',
        sourceDst: false,
        targetDst: false,
        worldDstIds: [],
        error: '',
      },
      () => this.onRun(),
    )
  },

  onReset() {
    const zones = this.data.zones as TimezoneZone[]
    const targetIndex = zoneIndexOf(zones, DEFAULT_TARGET_ID)
    this.setData(
      {
        date: todayISO(),
        time: currentTime(),
        sourceIndex: 0,
        targetIndex,
        sourceZoneLabel: zones[0]?.label ?? '本机',
        targetZoneLabel: zones[targetIndex]?.label ?? '伦敦',
        sourceDst: false,
        targetDst: false,
        worldDstIds: [],
        error: '',
      },
      () => this.onRun(),
    )
  },

  invalidate(message: string) {
    this.setData({
      shellState: 'invalid',
      hasResult: false,
      resultMain: '',
      resultRows: [],
      worldRows: [],
      timezoneSummary: '',
      error: message,
      posterData: null,
    })
  },

  onRun() {
    const state = this as unknown as TimezoneState
    if (state.destroyed) {
      return
    }
    if (this.data.mode === 'world') {
      this.runWorldClock()
      return
    }
    const zones = this.data.zones as TimezoneZone[]
    const source = zones[this.data.sourceIndex]
    const target = zones[this.data.targetIndex]
    if (!source || !target) {
      this.invalidate('请选择源时区与目标时区')
      return
    }
    const result = convertZone({
      date: this.data.date,
      time: this.data.time,
      source,
      target,
      sourceDst: this.data.sourceDst,
      targetDst: this.data.targetDst,
    })
    if (!result) {
      this.invalidate('请输入 1900–2100 之间的合法日期与 HH:mm 时间')
      return
    }

    const summary = timezoneSummaryText(result)
    const poster: IPosterData = {
      toolName: '时区换算',
      category: '日期时间',
      mainResult: result.targetDateTime,
      resultLabel: '目标时间',
      params: [
        { label: '源', value: `${result.sourceZoneLabel} ${result.sourceDateTime}` },
        { label: '目标', value: `${result.targetZoneLabel} ${result.targetDateTime}` },
      ],
      extras: [
        result.targetWeekday,
        result.targetOffsetLabel,
        `时差 ${result.diffLabel}`,
        result.crossDay ? '跨日' : '同日',
      ],
    }
    this.setData({
      shellState: 'done',
      hasResult: true,
      error: '',
      resultLabel: `${result.targetZoneLabel} · 目标时间`,
      resultMain: result.targetDateTime,
      resultRows: toRows(result),
      timezoneSummary: summary,
      posterData: poster,
    })
  },

  runWorldClock() {
    const state = this as unknown as TimezoneState
    if (state.destroyed || this.data.mode !== 'world') {
      return
    }
    const zones = this.data.zones as TimezoneZone[]
    const source = zones[this.data.sourceIndex] ?? zones[0]
    if (!source) {
      this.invalidate('请选择基准时区')
      return
    }
    const rows = worldClock({
      date: this.data.date,
      time: this.data.time,
      source,
      sourceDst: this.data.sourceDst,
      zones: worldCities(),
      dstIds: this.data.worldDstIds as string[],
    })
    if (!rows) {
      this.invalidate('请输入 1900–2100 之间的合法日期与 HH:mm 时间')
      return
    }

    const main = `${this.data.date} ${this.data.time}`
    const summary = worldClockSummaryText(rows)
    const cityPreview = rows.slice(1, 5).map(
      (row) => `${row.label} ${row.date.slice(5)} ${row.time} ${row.weekday}`,
    )
    const poster: IPosterData = {
      toolName: '时区换算',
      category: '日期时间',
      mainResult: main,
      resultLabel: '基准时间',
      params: [
        { label: '基准时区', value: source.label },
        { label: '同屏城市', value: `${rows.length} 个` },
      ],
      extras: cityPreview.length ? cityPreview : ['仅基准时区'],
    }
    this.setData({
      shellState: 'done',
      hasResult: true,
      error: '',
      resultLabel: `${source.label} · 基准时间`,
      resultMain: main,
      worldRows: rows,
      timezoneSummary: summary,
      posterData: poster,
    })
  },

  onCopy() {
    const text = this.data.timezoneSummary
    if (!text) {
      return
    }
    tapTick()
    copyText(text, '摘要已复制')
  },
  onCopyRow(event: WechatMiniprogram.TouchEvent) {
    const value = String(event.currentTarget.dataset.value || '')
    if (!value) {
      return
    }
    tapTick()
    copyText(value, '已复制')
  },

  onReceiveWorkflow(data: IWorkflowData): boolean {
    if (!data || data.type === 'image' || typeof data.payload !== 'string') {
      return false
    }
    const match = data.payload.match(
      /(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/,
    )
    if (!match) {
      return false
    }
    const iso = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
    if (!parseISODate(iso)) {
      return false
    }
    const patch: Record<string, string | number | boolean> = {
      mode: 'convert',
      date: iso,
      error: '',
    }
    if (match[4] !== undefined && match[5] !== undefined) {
      const hour = Number(match[4])
      const minute = Number(match[5])
      if (hour > 23 || minute > 59) {
        return false
      }
      patch.time = `${pad(hour)}:${pad(minute)}`
    }
    const zoneId = data.context?.timezoneSourceZone
    if (typeof zoneId === 'string') {
      const zones = this.data.zones as TimezoneZone[]
      const index = zones.findIndex((zone) => zone.id === zoneId)
      if (index >= 0) {
        patch.sourceIndex = index
        patch.sourceZoneLabel = zones[index].label
      }
    }
    const sourceDst = data.context?.timezoneSourceDst
    if (typeof sourceDst === 'boolean') {
      patch.sourceDst = sourceDst
    }
    this.setData(patch, () => this.onRun())
    return true
  },
})
