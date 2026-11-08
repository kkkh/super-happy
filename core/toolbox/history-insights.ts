/* ==========================================================================
   history-insights · 纯前端效率周报 / 分类占比 / 7 日活动 / 轨迹时间线
   - 输入全部来自 historyStore 的本机摘要，不请求网络
   - 所有函数纯计算，便于驾驶舱在主题切换 / 隐私切换时快速重算
   - 隐私遮罩只隐藏敏感字段，单位 / 分类 / 普通换算文案保持可读
   ========================================================================== */
import type { HistoryRecord } from '../stores/history'
import type { ToolCategory } from './types'
import { resolvePosterCategory } from './poster'
import { maskLegacySummary } from './privacy'

export interface CategoryStat {
  code: ToolCategory
  label: string
  value: number
  percent: number
}

export interface DailyStat {
  key: string
  label: string
  value: number
}

export interface TimelineItem {
  id: string
  toolName: string
  categoryLabel: string
  icon: string
  timeLabel: string
  inputSummary: string
  outputSummary: string
  night: boolean
  themeLabel: string
}

export interface HistoryInsight {
  hasHistory: boolean
  total: number
  weekTotal: number
  topToolName: string
  topCategoryLabel: string
  nightPercent: number
  dayPercent: number
  streak: number
  persona: string
  title: string
  body: string
  tags: string[]
}

const CATEGORY_ORDER: ToolCategory[] = ['calc', 'date', 'text', 'media', 'life', 'work']

const PERSONA: Record<ToolCategory, string> = {
  calc: '理性规划者',
  date: '时间管理者',
  text: '文字整理派',
  media: '视觉创作者',
  life: '生活掌控者',
  work: '效率行动派',
}

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function dayKey(timestamp: number): string {
  const date = new Date(timestamp)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function dayLabel(timestamp: number, now: number): string {
  const diff = Math.round((startOfDay(now) - startOfDay(timestamp)) / 86400000)
  if (diff <= 0) {
    return '今天'
  }
  if (diff === 1) {
    return '昨天'
  }
  const date = new Date(timestamp)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

function timeText(timestamp: number): string {
  const date = new Date(timestamp)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

/** 旧存档兜底：按工具类型智能脱敏，保留单位 / 分类文案 */
export function maskSummary(text: string, toolId = ''): string {
  return maskLegacySummary(text, toolId)
}

export function buildCategoryStats(records: HistoryRecord[]): CategoryStat[] {
  if (!records.length) {
    return []
  }
  const counts: Record<ToolCategory, number> = {
    calc: 0,
    date: 0,
    text: 0,
    media: 0,
    life: 0,
    work: 0,
  }
  records.forEach((record) => {
    counts[record.category] += 1
  })
  const total = records.length
  return CATEGORY_ORDER.filter((code) => counts[code] > 0)
    .map((code) => ({
      code,
      label: resolvePosterCategory(code),
      value: counts[code],
      percent: counts[code] / total,
    }))
    .sort((left, right) => right.value - left.value)
}

export function buildDailyStats(records: HistoryRecord[], now = Date.now()): DailyStat[] {
  const days: DailyStat[] = []
  const todayStart = startOfDay(now)
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(todayStart)
    date.setDate(date.getDate() - offset)
    const start = date.getTime()
    const endDate = new Date(start)
    endDate.setDate(endDate.getDate() + 1)
    const end = endDate.getTime()
    const value = records.filter((record) => record.timestamp >= start && record.timestamp < end).length
    days.push({
      key: dayKey(start),
      label: dayLabel(start, now),
      value,
    })
  }
  return days
}

/** 分类占比取整：最大余数法，保证界面显示总和为 100% */
export function formatCategoryPercentages(stats: CategoryStat[]): string[] {
  if (!stats.length) {
    return []
  }
  const raw = stats.map((stat) => Math.max(0, stat.percent) * 100)
  const floors = raw.map((value) => Math.floor(value))
  let remaining = Math.max(0, 100 - floors.reduce((sum, value) => sum + value, 0))
  const order = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index)
  const next = [...floors]
  for (let index = 0; index < order.length && remaining > 0; index += 1) {
    next[order[index].index] += 1
    remaining -= 1
  }
  return next.map((value) => `${value}%`)
}

function computeStreak(records: HistoryRecord[], now: number): number {
  if (!records.length) {
    return 0
  }
  const keys = new Set(records.map((record) => dayKey(record.timestamp)))
  const cursor = new Date(startOfDay(now))
  if (!keys.has(dayKey(cursor.getTime()))) {
    cursor.setDate(cursor.getDate() - 1)
  }
  let streak = 0
  while (keys.has(dayKey(cursor.getTime()))) {
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

export function buildHistoryInsight(records: HistoryRecord[], now = Date.now()): HistoryInsight {
  const total = records.length
  const weekStartDate = new Date(startOfDay(now))
  weekStartDate.setDate(weekStartDate.getDate() - 6)
  const weekStart = weekStartDate.getTime()
  const weekRecords = records.filter((record) => record.timestamp >= weekStart)
  const scope = weekRecords.length ? weekRecords : records

  let topToolName = ''
  let topCategory: ToolCategory = 'calc'
  if (scope.length) {
    const counts = new Map<string, { count: number; name: string }>()
    scope.forEach((record) => {
      const current = counts.get(record.toolId)
      if (current) {
        current.count += 1
      } else {
        counts.set(record.toolId, { count: 1, name: record.toolName })
      }
    })
    let bestCount = 0
    counts.forEach((value, toolId) => {
      if (value.count > bestCount) {
        bestCount = value.count
        topToolName = value.name
        const record = scope.find((item) => item.toolId === toolId)
        topCategory = record ? record.category : 'calc'
      }
    })
  }

  const nightCount = scope.filter((record) => record.night).length
  const nightPercent = scope.length ? Math.round((nightCount / scope.length) * 100) : 0
  const dayPercent = 100 - nightPercent
  const streak = computeStreak(records, now)
  const weekTotal = weekRecords.length
  const persona = PERSONA[topCategory]

  if (!total) {
    return {
      hasHistory: false,
      total: 0,
      weekTotal: 0,
      topToolName: '',
      topCategoryLabel: '',
      nightPercent: 0,
      dayPercent: 0,
      streak: 0,
      persona: '',
      title: '等待第一条轨迹',
      body: '去首页完成一次计算，这里会生成你的效率洞察、分类占比与 7 日活动。',
      tags: [],
    }
  }

  const topCategoryLabel = resolvePosterCategory(topCategory)
  const themeTone =
    nightPercent >= 60
      ? '夜航模式是你的主战场'
      : nightPercent <= 30
        ? '你更习惯在白昼完成计算'
        : '昼夜各有节奏'
  const body = weekTotal
    ? `最近 7 天完成 ${weekTotal} 次计算，最常用【${topToolName}】。${themeTone}，连续 ${streak} 天留下轨迹。你是个${persona}。`
    : `驾驶舱里已有 ${total} 条轨迹，最近 7 天暂时安静。最常用【${topToolName}】，${nightPercent >= 60 ? '夜航' : '白昼'}占比 ${Math.max(nightPercent, dayPercent)}%。`

  const tags: string[] = []
  if (weekTotal) {
    tags.push(`近 7 日 ${weekTotal} 次`)
  }
  if (streak) {
    tags.push(`连续 ${streak} 天`)
  }
  if (scope.length) {
    tags.push(`${nightPercent >= 60 ? '夜航' : '白昼'} ${Math.max(nightPercent, dayPercent)}%`)
    tags.push(`最常用 ${topToolName}`)
  }
  if (topCategoryLabel) {
    tags.push(topCategoryLabel)
  }

  return {
    hasHistory: true,
    total,
    weekTotal,
    topToolName,
    topCategoryLabel,
    nightPercent,
    dayPercent,
    streak,
    persona,
    title: weekTotal ? '近 7 日效率简报' : '你的计算画像',
    body,
    tags,
  }
}

function timelineTimeLabel(timestamp: number, now: number): string {
  return `${dayLabel(timestamp, now)} ${timeText(timestamp)}`
}

export function buildTimeline(
  records: HistoryRecord[],
  masked: boolean,
  limit = 12,
  now = Date.now(),
): TimelineItem[] {
  return records.slice(0, Math.max(1, limit)).map((record) => ({
    id: record.id,
    toolName: record.toolName,
    categoryLabel: record.categoryLabel,
    icon: record.icon,
    timeLabel: timelineTimeLabel(record.timestamp, now),
    inputSummary: masked
      ? record.inputMasked ?? maskSummary(record.inputSummary, record.toolId)
      : record.inputSummary,
    outputSummary: masked
      ? record.outputMasked ?? maskSummary(record.outputSummary, record.toolId)
      : record.outputSummary,
    night: record.night,
    themeLabel: record.themeLabel,
  }))
}
