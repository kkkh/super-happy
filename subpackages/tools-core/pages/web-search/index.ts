/* 元宝搜索 · 腾讯云 WSA SearchPro：搜索 / 筛选 / 详情；查询词会上传，不写草稿 */
import { tapSuccess, tapTick, tapWarn } from '../../../../core/utils/haptics'
import {
  YUANBAO_CNT_OPTIONS,
  YUANBAO_FRESHNESS_OPTIONS,
  YUANBAO_INDUSTRY_OPTIONS,
  YUANBAO_MAX_QUERY,
  isYuanbaoConfigured,
  searchYuanbao,
  summarizeYuanbaoResults,
  type YuanbaoResult,
} from '../../../../core/services/yuanbao/index'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'
import { copyText, toast } from '../../lib/ui'

interface WebSearchResultView {
  index: number
  title: string
  site: string
  date: string
  passage: string
  content: string
  url: string
  meta: string
}

interface WebSearchRuntime {
  destroyed: boolean
  task?: WechatMiniprogram.RequestTask
  seq: number
}

interface OptionView {
  value: string
  label: string
}

const CNT_OPTIONS: OptionView[] = YUANBAO_CNT_OPTIONS.map((value) => ({
  value: String(value),
  label: `${value} 条`,
}))

const FRESHNESS_OPTIONS: OptionView[] = YUANBAO_FRESHNESS_OPTIONS.map((item) => ({
  value: item.value,
  label: item.label,
}))

const INDUSTRY_OPTIONS: OptionView[] = YUANBAO_INDUSTRY_OPTIONS.map((item) => ({
  value: item.value,
  label: item.label,
}))

const EXAMPLE_QUERY = '人工智能发展现状'

function emptyResultState() {
  return {
    results: [] as WebSearchResultView[],
    resultCount: 0,
    hasResult: false,
    shellState: 'idle' as string,
    error: '',
    searchSummary: '',
    searchedQuery: '',
    version: '',
    requestId: '',
    posterData: null as IPosterData | null,
  }
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) {
    return text
  }
  return `${text.slice(0, limit).trim()}…`
}

function toView(result: YuanbaoResult, index: number): WebSearchResultView {
  const meta = [result.site, result.date].filter((item) => Boolean(item)).join(' · ')
  return {
    index,
    title: result.title || '未命名结果',
    site: result.site,
    date: result.date,
    passage: truncate(result.passage || result.content, 180),
    content: result.content,
    url: result.url,
    meta,
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
    industry: '',
    site: '',
    advancedOpen: false,
    cntOptions: CNT_OPTIONS,
    freshnessOptions: FRESHNESS_OPTIONS,
    industryOptions: INDUSTRY_OPTIONS,
    serviceReady: isYuanbaoConfigured(),
    maxQuery: YUANBAO_MAX_QUERY,
    canRun: false,
    detailShow: false,
    detailTitle: '',
    detailMeta: '',
    detailPassage: '',
    detailContent: '',
    detailUrl: '',
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
      incoming = decodeURIComponent(rawIncoming)
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
    const freshness = String(event.currentTarget.dataset.value || '')
    if (!FRESHNESS_OPTIONS.some((item) => item.value === freshness) || freshness === this.data.freshness) {
      return
    }
    tapTick()
    this.setData({ freshness, ...emptyResultState() })
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
      industry: '',
      site: '',
      advancedOpen: false,
      canRun: false,
      detailShow: false,
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
        error: '尚未配置元宝搜索服务 API KEY，请先在本地配置中填入服务密钥',
        shellState: 'error',
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
        const poster: IPosterData = {
          toolName: '元宝搜索',
          category: '文本效率',
          resultLabel: '搜索结果',
          mainResult: `${results.length} 条结果`,
          params: [
            { label: '返回条数', value: `${this.data.cnt} 条` },
            { label: '时效', value: this.freshnessLabel(this.data.freshness) },
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
          version: response.version,
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

  freshnessLabel(value: string): string {
    const option = FRESHNESS_OPTIONS.find((item) => item.value === value)
    return option ? option.label : '不限时间'
  },

  onCopySummary(): void {
    if (!this.data.searchSummary) {
      return
    }
    void copyText(this.data.searchSummary, '搜索摘要已复制')
  },

  onCopyLink(event: WechatMiniprogram.TouchEvent) {
    const url = String(event.currentTarget.dataset.url || '')
    if (!url) {
      return
    }
    tapTick()
    void copyText(url, '链接已复制')
  },

  onOpenDetail(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index)
    const result = this.data.results[index]
    if (!result) {
      return
    }
    tapTick()
    this.setData({
      detailShow: true,
      detailTitle: result.title,
      detailMeta: result.meta,
      detailPassage: result.passage,
      detailContent: result.content,
      detailUrl: result.url,
    })
  },

  onDetailClose(): void {
    this.setData({ detailShow: false })
  },

  onCopyDetailLink(): void {
    if (!this.data.detailUrl) {
      return
    }
    void copyText(this.data.detailUrl, '链接已复制')
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
