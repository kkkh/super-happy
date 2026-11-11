/* 元宝搜索 · 腾讯云 WSA SearchPro：搜索 / 筛选 / 详情；查询词会上传，不写草稿 */
import { tapSuccess, tapTick, tapWarn } from '../../../../core/utils/haptics'
import {
  YUANBAO_MAX_QUERY,
  isYuanbaoConfigured,
  searchYuanbao,
  summarizeYuanbaoResults,
} from '../../../../core/services/yuanbao/index'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import { toast } from '../../lib/ui'
import type { IPosterData } from '../../../../core/toolbox/poster'
import { normalizeCustomFreshness, todayISO } from '../../lib/freshness'
import {
  CNT_OPTIONS,
  EXAMPLE_QUERY,
  FRESHNESS_OPTIONS,
  INDUSTRY_OPTIONS,
  UNIT_OPTIONS,
  freshnessLabel,
  toView,
  type WebSearchResultView,
} from '../../lib/web-search-view'

interface WebSearchRuntime {
  destroyed: boolean
  task?: WechatMiniprogram.RequestTask
  seq: number
}

/* 页面海报状态：保留在此以便工具页数据契约统一校验 */
function emptyResultState() {
  return {
    results: [] as WebSearchResultView[],
    resultCount: 0,
    hasResult: false,
    shellState: 'idle' as string,
    error: '',
    searchSummary: '',
    searchedQuery: '',
    versionLabel: '',
    versionHint: '',
    message: '',
    requestId: '',
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
    toolName: '元宝搜索',
    kicker: '联网搜索',
    desc: '全网实时搜索 · 结果来自腾讯云元宝',
    query: '',
    cnt: '10',
    freshness: '',
    freshnessPreset: '',
    customMode: 'recent' as 'recent' | 'day' | 'range',
    customN: '7',
    customUnit: 'd' as 'd' | 'm' | 'y',
    customStart: todayISO(),
    customEnd: todayISO(),
    maxDate: todayISO(),
    customError: '',
    deeplinks: false,
    industry: '',
    site: '',
    advancedOpen: false,
    cntOptions: CNT_OPTIONS,
    freshnessOptions: FRESHNESS_OPTIONS,
    industryOptions: INDUSTRY_OPTIONS,
    unitOptions: UNIT_OPTIONS,
    serviceReady: isYuanbaoConfigured(),
    maxQuery: YUANBAO_MAX_QUERY,
    canRun: false,
    ...emptyResultState(),
  },

  onLoad(query?: Record<string, string | undefined>) {
    const runtime = this as unknown as WebSearchRuntime
    runtime.destroyed = false
    runtime.seq = 0
    runtime.task = undefined
    const rawIncoming = String(query?.query || '').trim()
    let incoming = rawIncoming
    try {
      /* 首页 / 分享链接会把查询词 encodeURIComponent，onLoad 需还原 */
      incoming = decodeURIComponent(rawIncoming).trim()
    } catch {
      incoming = rawIncoming
    }
    const serviceReady = isYuanbaoConfigured()
    this.setData({
      serviceReady,
      query: incoming.slice(0, YUANBAO_MAX_QUERY),
      canRun: Boolean(incoming),
    })
  },

  onReady() {
    if (this.data.query.trim()) {
      this.runSearch()
    }
  },

  onUnload() {
    const runtime = this as unknown as WebSearchRuntime
    runtime.destroyed = true
    runtime.seq += 1
    this.abortRequest()
  },

  onHide() {
    /* 离开页面时取消在途请求，避免结果回到后台后继续占用配额 */
    this.abortRequest()
  },

  abortRequest(): void {
    const runtime = this as unknown as WebSearchRuntime
    if (runtime.task) {
      runtime.task.abort()
      runtime.task = undefined
    }
  },

  onQueryInput(event: WechatMiniprogram.Input) {
    const query = String(event.detail.value || '').slice(0, YUANBAO_MAX_QUERY)
    this.setData({
      query,
      canRun: Boolean(query.trim()),
      error: '',
      shellState: this.data.hasResult ? 'done' : 'idle',
    })
  },

  onConfirm(): void {
    this.runSearch()
  },

  onCnt(event: WechatMiniprogram.TouchEvent) {
    const cnt = String(event.currentTarget.dataset.value || '')
    if (!CNT_OPTIONS.some((item) => item.value === cnt) || cnt === this.data.cnt) {
      return
    }
    tapTick()
    this.setData({ cnt, ...emptyResultState() })
  },

  onFreshness(event: WechatMiniprogram.TouchEvent) {
    const preset = String(event.currentTarget.dataset.value || '')
    if (!FRESHNESS_OPTIONS.some((item) => item.value === preset) || preset === this.data.freshnessPreset) {
      return
    }
    tapTick()
    if (preset === 'custom') {
      this.setData(
        { freshnessPreset: 'custom', freshness: '', customError: '', ...emptyResultState() },
        () => this.recomputeCustomFreshness(),
      )
      return
    }
    this.setData({ freshnessPreset: preset, freshness: preset, customError: '', ...emptyResultState() })
  },

  onCustomMode(event: WechatMiniprogram.TouchEvent) {
    const mode = String(event.currentTarget.dataset.mode || '')
    if (!['recent', 'day', 'range'].includes(mode) || mode === this.data.customMode) {
      return
    }
    tapTick()
    this.setData({ customMode: mode as 'recent' | 'day' | 'range', ...emptyResultState() }, () =>
      this.recomputeCustomFreshness(),
    )
  },

  onCustomNInput(event: WechatMiniprogram.Input) {
    this.setData(
      { customN: String(event.detail.value || '').slice(0, 2), ...emptyResultState() },
      () => this.recomputeCustomFreshness(),
    )
  },

  onCustomUnit(event: WechatMiniprogram.TouchEvent) {
    const unit = String(event.currentTarget.dataset.unit || '')
    if (!['d', 'm', 'y'].includes(unit) || unit === this.data.customUnit) {
      return
    }
    tapTick()
    this.setData({ customUnit: unit as 'd' | 'm' | 'y', ...emptyResultState() }, () =>
      this.recomputeCustomFreshness(),
    )
  },

  onCustomStart(event: WechatMiniprogram.PickerChange) {
    this.setData({ customStart: String(event.detail.value || ''), ...emptyResultState() }, () =>
      this.recomputeCustomFreshness(),
    )
  },

  onCustomEnd(event: WechatMiniprogram.PickerChange) {
    this.setData({ customEnd: String(event.detail.value || ''), ...emptyResultState() }, () =>
      this.recomputeCustomFreshness(),
    )
  },

  /** 将自定义时效归一化为官方额度：dN / mN / yN 或 yyyy-mm-dd,yyyy-mm-dd */
  recomputeCustomFreshness(): void {
    if (this.data.freshnessPreset !== 'custom') {
      return
    }
    const result = normalizeCustomFreshness({
      mode: this.data.customMode,
      n: this.data.customN,
      unit: this.data.customUnit,
      start: this.data.customStart,
      end: this.data.customEnd,
    })
    this.setData({ freshness: result.freshness, customError: result.error })
  },

  onToggleDeeplinks(): void {
    tapTick()
    this.setData({ deeplinks: !this.data.deeplinks, ...emptyResultState() })
  },

  onIndustry(event: WechatMiniprogram.TouchEvent) {
    const industry = String(event.currentTarget.dataset.value || '')
    if (!INDUSTRY_OPTIONS.some((item) => item.value === industry) || industry === this.data.industry) {
      return
    }
    tapTick()
    this.setData({ industry, ...emptyResultState() })
  },

  onSiteInput(event: WechatMiniprogram.Input) {
    this.setData({
      site: String(event.detail.value || '').slice(0, 120),
      ...emptyResultState(),
    })
  },

  onToggleAdvanced(): void {
    tapTick()
    this.setData({ advancedOpen: !this.data.advancedOpen })
  },

  onExample(): void {
    this.setData({ query: EXAMPLE_QUERY, canRun: true, ...emptyResultState() }, () =>
      this.runSearch(),
    )
  },

  onReset(): void {
    const runtime = this as unknown as WebSearchRuntime
    runtime.seq += 1
    this.abortRequest()
    this.setData({
      query: '',
      cnt: '10',
      freshness: '',
      freshnessPreset: '',
      customMode: 'recent',
      customN: '7',
      customUnit: 'd',
      customStart: todayISO(),
      customEnd: todayISO(),
      customError: '',
      deeplinks: false,
      industry: '',
      site: '',
      advancedOpen: false,
      canRun: false,
      ...emptyResultState(),
    })
  },

  runSearch(): void {
    const runtime = this as unknown as WebSearchRuntime
    if (runtime.destroyed) {
      return
    }
    const query = this.data.query.trim()
    if (!query) {
      tapWarn()
      this.setData({ error: '请输入搜索词', shellState: 'invalid' })
      return
    }
    if (!this.data.serviceReady) {
      tapWarn()
      this.setData({
        error: '尚未配置元宝搜索密钥，请先在本地配置中填入服务 API KEY 或 SecretId / SecretKey',
        shellState: 'error',
      })
      return
    }
    if (this.data.freshnessPreset === 'custom' && !this.data.freshness) {
      tapWarn()
      this.setData({
        error: this.data.customError || '自定义时效未设置完整',
        shellState: 'invalid',
      })
      return
    }

    runtime.seq += 1
    const seq = runtime.seq
    this.abortRequest()
    tapTick()
    this.setData({
      ...emptyResultState(),
      searchedQuery: query,
      shellState: 'running',
      canRun: true,
    })

    searchYuanbao(
      {
        query,
        cnt: Number(this.data.cnt) || 10,
        freshness: this.data.freshness,
        industry: this.data.industry,
        site: this.data.site,
        deeplinks: this.data.deeplinks,
      },
      {
        onTask: (task) => {
          runtime.task = task
        },
      },
    )
      .then((response) => {
        if (runtime.destroyed || seq !== runtime.seq) {
          return
        }
        runtime.task = undefined
        const results = response.results.map((result, index) => toView(result, index))
        const summary = summarizeYuanbaoResults(query, response.results)
        /* 海报与轨迹只保存结果量与筛选条件，不保存搜索词本身 */
        const poster = {
          toolName: '元宝搜索',
          category: '文本效率',
          resultLabel: '搜索结果',
          mainResult: `${results.length} 条结果`,
          params: [
            { label: '返回条数', value: `${this.data.cnt} 条` },
            { label: '时效', value: freshnessLabel(this.data.freshness) },
          ],
          extras: [
            ...results.slice(0, 3).map((item, index) => `${index + 1}. ${item.title}`),
          ],
        }
        this.setData({
          results,
          resultCount: results.length,
          hasResult: true,
          shellState: 'done',
          error: '',
          searchSummary: summary,
          searchedQuery: query,
          versionLabel: this.versionLabel(response.version),
          versionHint: this.versionHint(response.version),
          message: response.message,
          requestId: response.requestId,
          posterData: poster,
        })
        tapSuccess()
      })
      .catch((error: unknown) => {
        if (runtime.destroyed || seq !== runtime.seq) {
          return
        }
        runtime.task = undefined
        const message =
          error && typeof error === 'object' && 'message' in error
            ? String((error as { message?: unknown }).message || '')
            : ''
        tapWarn()
        this.setData({
          ...emptyResultState(),
          searchedQuery: query,
          shellState: 'error',
          error: message || '元宝搜索暂时不可用，请稍后再试',
          posterData: null,
        })
      })
  },

  versionLabel(version: string): string {
    if (version === 'flagship') {
      return '旗舰版'
    }
    if (version === 'lite') {
      return '极速版'
    }
    if (version === 'standard') {
      return '标准版'
    }
    return version
  },

  versionHint(version: string): string {
    if (!version || version === 'flagship') {
      return ''
    }
    if (version === 'lite') {
      return '极速版不返回相关性、配图与动态摘要；权威度 / 子链需旗舰版'
    }
    return '当前为标准版；权威度与附件子链需旗舰版'
  },

  onReceiveWorkflow(data: { type?: string; payload?: string }): boolean {
    const payload = String(data?.payload || '').trim()
    if (!payload) {
      return false
    }
    this.setData({ query: payload.slice(0, YUANBAO_MAX_QUERY), canRun: true }, () =>
      this.runSearch(),
    )
    toast('已接收搜索词')
    return true
  },
})
