/* 元宝搜索页面视图模型：筛选选项、结果卡片映射与空态；页面只保留交互 */
import type { YuanbaoResult } from '../../../core/services/yuanbao/index'
import {
  YUANBAO_CNT_OPTIONS,
  YUANBAO_FRESHNESS_OPTIONS,
  YUANBAO_INDUSTRY_OPTIONS,
} from '../../../core/services/yuanbao/index'

export interface WebSearchResultView {
  index: number
  title: string
  site: string
  date: string
  passage: string
  content: string
  url: string
  meta: string
  scoreText: string
  authorityText: string
  favicon: string
  pics: Array<{ caption: string; originUrl: string }>
  deeplinks: Array<{ title: string; url: string }>
}

export interface OptionView {
  value: string
  label: string
}

export const CNT_OPTIONS: OptionView[] = YUANBAO_CNT_OPTIONS.map((value) => ({
  value: String(value),
  label: `${value} 条`,
}))

export const FRESHNESS_OPTIONS: OptionView[] = [
  ...YUANBAO_FRESHNESS_OPTIONS.map((item) => ({
    value: item.value,
    label: item.label,
  })),
  { value: 'custom', label: '自定义' },
]

export const INDUSTRY_OPTIONS: OptionView[] = YUANBAO_INDUSTRY_OPTIONS.map((item) => ({
  value: item.value,
  label: item.label,
}))

export const UNIT_OPTIONS: OptionView[] = [
  { value: 'd', label: '天' },
  { value: 'm', label: '月' },
  { value: 'y', label: '年' },
]

export const EXAMPLE_QUERY = '人工智能发展现状'

/** 把官方 Freshness 额度还原为可读文案，供海报 / 摘要使用 */
export function freshnessLabel(value: string): string {
  if (!value) {
    return '不限时间'
  }
  const preset = FRESHNESS_OPTIONS.find((item) => item.value === value)
  if (preset) {
    return preset.label
  }
  const range = value.split(',')
  if (range.length === 2) {
    return `区间 ${range[0]} 至 ${range[1]}`
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `指定日期 ${value}`
  }
  const recent = /^([dmy])(\d+)$/.exec(value)
  if (recent) {
    const unit = { d: '天', m: '月', y: '年' }[recent[1] as 'd' | 'm' | 'y']
    return `最近 ${recent[2]} ${unit}`
  }
  return value
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) {
    return text
  }
  return `${text.slice(0, limit).trim()}…`
}

export function toView(result: YuanbaoResult, index: number): WebSearchResultView {
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
    scoreText: result.score > 0 ? `相关 ${result.score.toFixed(2)}` : '',
    authorityText: result.authorityLevel > 0 ? `权威 ${result.authorityLevel}/5` : '',
    favicon: result.favicon,
    pics: result.pics,
    deeplinks: result.deeplinks,
  }
}

/** 单篇文章导出正文：标题、来源、链接、摘要、正文、配图地址与附件子链 */
export function toArticleExport(result: WebSearchResultView): { filename: string; content: string } {
  const title = result.title || '元宝搜索文章'
  const lines = [title]
  if (result.meta) {
    lines.push(result.meta)
  }
  if (result.url) {
    lines.push(result.url)
  }
  if (result.passage) {
    lines.push('', result.passage)
  }
  if (result.content && result.content !== result.passage) {
    lines.push('', result.content)
  }
  if (result.pics.length) {
    lines.push('', '配图地址：')
    result.pics.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.caption || '配图'}：${item.originUrl}`)
    })
  }
  if (result.deeplinks.length) {
    lines.push('', '附件子链：')
    result.deeplinks.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.title || item.url}`)
      lines.push(item.url)
    })
  }
  return { filename: title, content: lines.join('\n') }
}
