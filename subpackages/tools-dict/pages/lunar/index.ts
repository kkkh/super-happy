/* ==========================================================================
   农历与节气 · 公历转农历
   - 默认今天，选日期即换算；生肖 / 闰月 / 节气 / 传统节日
   - 词库 1900–2100，超出范围明确提示
   - 支持文本工作流注入日期（YYYY-MM-DD / YYYYMMDD）
   ========================================================================== */
import { tapTick } from '../../../../core/utils/haptics'
import { copyText, toast } from '../../lib/ui'
import {
  LUNAR_MAX_DATE,
  LUNAR_MIN_DATE,
  lunarBirthday,
  parseLunarDate,
  toLunar,
  type LunarBirthdayInfo,
  type LunarInfo,
} from '../../lib/lunar'
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

interface LunarState {
  destroyed: boolean
  computeSeq: number
}

type LunarMode = 'convert' | 'birthday'

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

function todayText(): string {
  const now = new Date()
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

Page({
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: '农历与节气',
    kicker: '日期时间',
    desc: '公历转农历 · 生肖 · 节气 · 生日倒计时',
    mode: 'convert' as LunarMode,
    dateValue: todayText(),
    birthDate: '',
    minDate: LUNAR_MIN_DATE,
    maxDate: LUNAR_MAX_DATE,
    lunarText: '',
    lunarYear: '',
    animal: '',
    isLeap: false,
    weekday: '',
    solarTerm: '',
    solarTermDate: '',
    solarTermToday: false,
    daysToSolarTerm: 0,
    festivals: [] as string[],
    festivalText: '',
    lunarSummary: '',
    resultRows: [] as ResultRow[],
    birthdayLunarText: '',
    birthdayCountdownText: '',
    birthdayWeekday: '',
    birthdayRows: [] as ResultRow[],
    birthdaySummary: '',
    hasResult: false,
    shellState: 'idle',
    error: '',
    posterData: null as IPosterData | null,
  },

  onLoad() {
    const state = this as unknown as LunarState
    state.destroyed = false
    state.computeSeq = 0
  },

  onUnload() {
    const state = this as unknown as LunarState
    state.destroyed = true
    state.computeSeq += 1
  },

  onDateChange(event: WechatMiniprogram.PickerChange) {
    const value = String(event.detail.value || '')
    if (!value) {
      return
    }
    this.setData({ dateValue: value, error: '' }, () => this.clearConvert())
  },

  onMode(event: WechatMiniprogram.TouchEvent) {
    const mode = event.currentTarget.dataset.mode as LunarMode
    if ((mode !== 'convert' && mode !== 'birthday') || mode === this.data.mode) {
      return
    }
    tapTick()
    this.setData({ mode, error: '' }, () => {
      if (mode === 'convert') {
        this.clearConvert()
      } else {
        this.clearBirthday()
      }
    })
  },

  onBirthDateChange(event: WechatMiniprogram.PickerChange) {
    const value = String(event.detail.value || '')
    if (!value) {
      return
    }
    this.setData({ birthDate: value, error: '' }, () => this.clearBirthday())
  },

  onExample() {
    tapTick()
    if (this.data.mode === 'birthday') {
      this.setData({ birthDate: '1995-06-15', error: '' }, () => this.clearBirthday())
      return
    }
    this.setData({ dateValue: todayText(), error: '' }, () => this.clearConvert())
  },

  onReset() {
    if (this.data.mode === 'birthday') {
      this.setData({ birthDate: '', error: '' }, () => this.clearBirthday())
      return
    }
    this.setData({ dateValue: todayText(), error: '' }, () => this.clearConvert())
  },

  /* ---- 草稿：模式与日期；恢复后重新换算 ---- */
  draftMode(): string {
    return this.data.mode
  },

  collectDraftInput(): Record<string, string> {
    return { dateValue: this.data.dateValue, birthDate: this.data.birthDate }
  },

  applyDraftInput(input: Record<string, string>, mode: string): void {
    this.setData(
      {
        mode: mode === 'birthday' ? 'birthday' : 'convert',
        dateValue: input.dateValue || todayText(),
        birthDate: input.birthDate ?? '',
        error: '',
        hasResult: false,
        shellState: 'idle',
        posterData: null,
      },
      () => {
        this.onRun()
      },
    )
  },

  onRun() {
    if (this.data.mode === 'birthday') {
      void this.computeBirthday()
      return
    }
    void this.compute()
  },

  onCopy() {
    const text =
      this.data.mode === 'birthday' ? this.data.birthdaySummary : this.data.lunarSummary
    if (!text) {
      toast('没有可复制的内容')
      return
    }
    void copyText(text)
  },

  async onReceiveWorkflow(data: IWorkflowData): Promise<boolean> {
    if (!data || data.type !== 'text' || typeof data.payload !== 'string') {
      return false
    }
    const parts = parseLunarDate(data.payload)
    if (!parts) {
      return false
    }
    this.setData(
      {
        mode: 'convert',
        dateValue: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
        error: '',
      },
      () => {
        void this.compute()
      },
    )
    return true
  },

  compute() {
    const state = this as unknown as LunarState
    if (state.destroyed) {
      return
    }
    if (this.data.mode === 'birthday') {
      void this.computeBirthday()
      return
    }
    const seq = ++state.computeSeq
    const parts = parseLunarDate(this.data.dateValue)
    if (!parts) {
      this.fail(`请选择 ${LUNAR_MIN_DATE} 至 ${LUNAR_MAX_DATE} 之间的日期`)
      return
    }
    const info = toLunar(parts.year, parts.month, parts.day)
    if (!info || seq !== state.computeSeq) {
      if (seq === state.computeSeq) {
        this.fail(`仅支持 ${LUNAR_MIN_DATE} 至 ${LUNAR_MAX_DATE}，请调整日期`)
      }
      return
    }
    this.applyResult(info)
  },

  computeBirthday() {
    const state = this as unknown as LunarState
    if (state.destroyed) {
      return
    }
    const parts = parseLunarDate(this.data.birthDate)
    if (!parts) {
      this.fail(`请选择 ${LUNAR_MIN_DATE} 至 ${LUNAR_MAX_DATE} 之间的生日`)
      return
    }
    const today = parseLunarDate(todayText())
    if (!today) {
      this.fail('无法获取今天的日期，请稍后重试')
      return
    }
    const birthISO = `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`
    if (birthISO > todayText()) {
      this.fail('生日不能晚于今天')
      return
    }
    const info = lunarBirthday(parts.year, parts.month, parts.day, today)
    if (!info) {
      this.fail(`仅支持 ${LUNAR_MIN_DATE} 至 ${LUNAR_MAX_DATE}，请调整生日`)
      return
    }
    this.applyBirthday(info)
  },

  applyBirthday(info: LunarBirthdayInfo) {
    const countdown = info.nextSolarDate
      ? info.isToday
        ? '今天就是农历生日'
        : `距下次农历生日还有 ${info.daysUntil} 天`
      : '下次农历生日超出 2100 年范围'
    const birthdayLunarText = `${info.monthCn}${info.dayCn}`
    const birthdayRows: ResultRow[] = [
      { k: '公历生日', v: info.birthDateText },
      { k: '农历生日', v: info.lunarText },
      { k: '生肖', v: info.animal },
      { k: '下次公历', v: info.nextSolarDate || '超出范围' },
      { k: '下次星期', v: info.nextWeekday || '—' },
      { k: '倒计时', v: info.nextSolarDate ? (info.isToday ? '今天' : `${info.daysUntil} 天`) : '—' },
      { k: '生日序数', v: info.birthdayCount > 0 ? `第 ${info.birthdayCount} 个` : '—' },
      { k: '备注', v: info.notes.length > 0 ? info.notes.join('；') : '无' },
    ]
    const poster: IPosterData = {
      toolName: '农历与节气',
      category: '日期时间',
      mainResult: birthdayLunarText,
      resultLabel: '农历生日',
      params: [
        { label: '生肖', value: info.animal },
        { label: '下次公历', value: info.nextSolarDate || '—' },
      ],
      extras: [countdown, info.notes[0] ?? '本机换算'],
    }
    this.setData({
      birthdayLunarText,
      birthdayCountdownText: countdown,
      birthdayWeekday: info.nextWeekday || '—',
      birthdayRows,
      birthdaySummary: info.summary,
      hasResult: true,
      shellState: 'done',
      error: '',
      posterData: poster,
    })
  },

  clearBirthday() {
    this.setData({
      birthdayLunarText: '',
      birthdayCountdownText: '',
      birthdayWeekday: '',
      birthdayRows: [],
      birthdaySummary: '',
      hasResult: false,
      shellState: 'idle',
      error: '',
      posterData: null,
    })
  },

  applyResult(info: LunarInfo) {
    const termText = info.solarTerm
      ? info.solarTermToday
        ? `${info.solarTerm} · 当天`
        : `${info.solarTerm} · ${info.daysToSolarTerm} 天后`
      : '—'
    const resultRows: ResultRow[] = [
      { k: '农历年', v: info.yearCn },
      { k: '农历月', v: info.monthCn },
      { k: '农历日', v: info.dayCn },
      { k: '生肖', v: info.animal },
      { k: '闰月', v: info.isLeap ? '是' : '否' },
      { k: '节气', v: termText },
      { k: '节气日期', v: info.solarTermDate || '—' },
      { k: '传统节日', v: info.festivals.length > 0 ? info.festivals.join('、') : '无' },
      { k: '星期', v: info.weekday },
      { k: '支持范围', v: `${LUNAR_MIN_DATE} 至 ${LUNAR_MAX_DATE}` },
    ]
    const poster: IPosterData = {
      toolName: '农历与节气',
      category: '日期时间',
      mainResult: info.lunarText,
      resultLabel: '农历',
      params: [
        { label: '生肖', value: info.animal },
        { label: '节气', value: info.solarTerm || '—' },
      ],
      extras: [info.dateText, info.festivals.join('、') || '无传统节日'],
    }
    this.setData({
      lunarText: info.lunarText,
      lunarYear: info.yearCn,
      animal: info.animal,
      isLeap: info.isLeap,
      weekday: info.weekday,
      solarTerm: info.solarTerm,
      solarTermDate: info.solarTermDate,
      solarTermToday: info.solarTermToday,
      daysToSolarTerm: info.daysToSolarTerm,
      festivals: info.festivals,
      festivalText: info.festivals.join('、'),
      lunarSummary: info.summary,
      resultRows,
      hasResult: true,
      shellState: 'done',
      error: '',
      posterData: poster,
    })
  },

  clearConvert() {
    this.setData({
      lunarText: '',
      lunarYear: '',
      animal: '',
      isLeap: false,
      weekday: '',
      solarTerm: '',
      solarTermDate: '',
      solarTermToday: false,
      daysToSolarTerm: 0,
      festivals: [],
      festivalText: '',
      lunarSummary: '',
      resultRows: [],
      hasResult: false,
      shellState: 'idle',
      error: '',
      posterData: null,
    })
  },

  fail(message: string) {
    this.clearConvert()
    this.clearBirthday()
    this.setData({ shellState: 'invalid', error: message })
  },
})
