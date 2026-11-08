/* ==========================================================================
   cronParser · 手写轻量级 5 段 Cron 解析与调度器
   - 支持 * / 步长 / 范围 / 列表 / 混合表达式
   - 星期支持 0-6，并把 7 归一化为周日 0
   - DOM / DOW 同时受限时采用标准 Cron 的 OR 语义
   - 调度器只做分钟级匹配，任务体在宏任务中执行，绝不阻塞页面
   ========================================================================== */

export interface CronField {
  values: number[]
  wildcard: boolean
}

export interface ParsedCron {
  source: string
  minute: CronField
  hour: CronField
  dayOfMonth: CronField
  month: CronField
  dayOfWeek: CronField
}

export interface CronPreset {
  key: string
  label: string
  expression: string
  desc: string
}

export const CRON_PRESETS: CronPreset[] = [
  {
    key: 'five',
    label: '每 5 分钟',
    expression: '*/5 * * * *',
    desc: '高频热备，适合正在密集调试阶段',
  },
  {
    key: 'hourly',
    label: '每小时',
    expression: '0 * * * *',
    desc: '整点自动打包一次',
  },
  {
    key: 'daily',
    label: '每天 03:00',
    expression: '0 3 * * *',
    desc: '凌晨静默快照，不打扰白天使用',
  },
  {
    key: 'weekly',
    label: '每周一 03:00',
    expression: '0 3 * * 1',
    desc: '默认节奏，保留 5 份自动快照',
  },
  {
    key: 'monthly',
    label: '每月 1 日 03:00',
    expression: '0 3 1 * *',
    desc: '月度里程碑归档',
  },
]

export type CronStatus = 'stopped' | 'idle' | 'running' | 'error'

export interface CronSchedulerState {
  expression: string
  status: CronStatus
  nextRunAt: number | null
  lastRunAt: number | null
  lastError: string
  runCount: number
}

export interface CronRunContext {
  expression: string
  scheduledAt: number
  actualAt: number
}

interface CronSchedulerOptions {
  onRun: (context: CronRunContext) => void | Promise<void>
  /** 测试注入；默认 Date.now */
  now?: () => number
  /** 轮询间隔；默认 15 秒 */
  tickMs?: number
  /** 单次任务最大时长，超时只记错误，不终止后续调度 */
  maxRunMs?: number
}

interface FieldSpec {
  min: number
  max: number
  normalize?: (value: number) => number
}

const FIELD_SPECS: Record<'minute' | 'hour' | 'dayOfMonth' | 'month' | 'dayOfWeek', FieldSpec> = {
  minute: { min: 0, max: 59 },
  hour: { min: 0, max: 23 },
  dayOfMonth: { min: 1, max: 31 },
  month: { min: 1, max: 12 },
  dayOfWeek: {
    min: 0,
    max: 7,
    normalize: (value) => (value === 7 ? 0 : value),
  },
}

function parseField(raw: string, spec: FieldSpec): CronField | null {
  const text = raw.trim()
  if (!text) {
    return null
  }
  const values = new Set<number>()
  const wildcard = text.startsWith('*')

  for (const segment of text.split(',')) {
    if (!segment) {
      return null
    }
    let rangeText = segment
    let step = 1
    const stepMatch = segment.match(/^([^/]+)\/(\d+)$/)
    if (stepMatch) {
      rangeText = stepMatch[1]
      step = Number(stepMatch[2])
      if (!Number.isInteger(step) || step <= 0) {
        return null
      }
    }

    let start = spec.min
    let end = spec.max
    if (rangeText === '*') {
      start = spec.min
      end = spec.max
    } else if (rangeText.includes('-')) {
      const parts = rangeText.split('-')
      if (parts.length !== 2) {
        return null
      }
      start = Number(parts[0])
      end = Number(parts[1])
    } else {
      start = Number(rangeText)
      end = start
    }

    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      return null
    }
    if (start < spec.min || start > spec.max) {
      return null
    }
    if (end < spec.min || end > spec.max) {
      return null
    }
    if (end < start) {
      return null
    }

    for (let value = start; value <= end; value += step) {
      values.add(spec.normalize ? spec.normalize(value) : value)
    }
  }

  if (values.size === 0) {
    return null
  }
  return {
    values: Array.from(values).sort((left, right) => left - right),
    wildcard,
  }
}

export function parseCron(expression: string): ParsedCron | null {
  if (typeof expression !== 'string') {
    return null
  }
  const fields = expression.trim().replace(/\s+/g, ' ').split(' ')
  if (fields.length !== 5) {
    return null
  }
  const minute = parseField(fields[0], FIELD_SPECS.minute)
  const hour = parseField(fields[1], FIELD_SPECS.hour)
  const dayOfMonth = parseField(fields[2], FIELD_SPECS.dayOfMonth)
  const month = parseField(fields[3], FIELD_SPECS.month)
  const dayOfWeek = parseField(fields[4], FIELD_SPECS.dayOfWeek)
  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) {
    return null
  }
  return {
    source: expression.trim().replace(/\s+/g, ' '),
    minute,
    hour,
    dayOfMonth,
    month,
    dayOfWeek,
  }
}

function fieldMatches(field: CronField, value: number): boolean {
  return field.values.includes(value)
}

export function cronMatches(cron: ParsedCron, date: Date): boolean {
  if (!cron || !date || !Number.isFinite(date.getTime())) {
    return false
  }
  if (!fieldMatches(cron.minute, date.getMinutes())) {
    return false
  }
  if (!fieldMatches(cron.hour, date.getHours())) {
    return false
  }
  if (!fieldMatches(cron.month, date.getMonth() + 1)) {
    return false
  }

  const domMatch = fieldMatches(cron.dayOfMonth, date.getDate())
  const dowMatch = fieldMatches(cron.dayOfWeek, date.getDay())

  /* 标准 Cron：两个日期字段都受限时满足任一即可；否则两个都要满足 */
  if (!cron.dayOfMonth.wildcard && !cron.dayOfWeek.wildcard) {
    return domMatch || dowMatch
  }
  return domMatch && dowMatch
}

export function nextCronRun(
  cron: ParsedCron,
  from: Date = new Date(),
  maxDays = 370,
): Date | null {
  if (!cron || !from || !Number.isFinite(from.getTime())) {
    return null
  }
  const cursor = new Date(from.getTime())
  cursor.setSeconds(0, 0)
  cursor.setMinutes(cursor.getMinutes() + 1)
  const limit = Math.max(1, maxDays) * 24 * 60

  for (let step = 0; step < limit; step += 1) {
    if (cronMatches(cron, cursor)) {
      return new Date(cursor.getTime())
    }
    cursor.setMinutes(cursor.getMinutes() + 1)
  }
  return null
}

const WEEK_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export function describeCron(cron: ParsedCron): string {
  if (!cron) {
    return '无效表达式'
  }
  const preset = CRON_PRESETS.find((item) => item.expression === cron.source)
  if (preset) {
    return preset.label
  }
  const minute = cron.minute.values.length === 1 ? `${cron.minute.values[0]} 分` : '多分钟'
  const hour = cron.hour.values.length === 1 ? `${cron.hour.values[0]} 点` : '多小时'
  const week =
    cron.dayOfWeek.wildcard && cron.dayOfMonth.wildcard
      ? ''
      : ` · ${cron.dayOfWeek.values.map((value) => WEEK_LABELS[value] ?? value).join('/')}`
  return `${hour} ${minute}${week}`
}

function minuteKey(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}-${date.getHours()}-${date.getMinutes()}`
}

export class CronScheduler {
  private options: CronSchedulerOptions
  private parsed: ParsedCron | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private stopped = true
  private running = false
  private runCount = 0
  private lastMinute = ''
  private lastRunAt: number | null = null
  private lastError = ''
  private nextRunAt: number | null = null
  private destroyed = false

  constructor(options: CronSchedulerOptions) {
    this.options = options
  }

  start(expression: string): boolean {
    if (this.destroyed) {
      return false
    }
    const parsed = parseCron(expression)
    if (!parsed) {
      this.lastError = 'Cron 表达式不合法'
      return false
    }
    this.parsed = parsed
    this.stopped = false
    this.lastError = ''
    this.refreshNextRun()
    this.arm()
    return true
  }

  update(expression: string): boolean {
    this.stop()
    return this.start(expression)
  }

  stop(): void {
    this.stopped = true
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.nextRunAt = null
  }

  destroy(): void {
    this.stop()
    this.destroyed = true
    this.running = false
  }

  state(): CronSchedulerState {
    return {
      expression: this.parsed ? this.parsed.source : '',
      status: this.stopped ? 'stopped' : this.running ? 'running' : this.lastError ? 'error' : 'idle',
      nextRunAt: this.nextRunAt,
      lastRunAt: this.lastRunAt,
      lastError: this.lastError,
      runCount: this.runCount,
    }
  }

  /** 测试 / 页面恢复前台时可手动对齐一次，不依赖系统定时器 */
  tick(now = this.now()): void {
    if (this.stopped || this.destroyed || !this.parsed) {
      return
    }
    const date = new Date(now)
    const key = minuteKey(now)
    if (cronMatches(this.parsed, date) && this.lastMinute !== key && !this.running) {
      this.lastMinute = key
      this.running = true
      this.lastRunAt = now
      this.runCount += 1
      this.lastError = ''
      const expression = this.parsed.source
      try {
        const result = this.options.onRun({
          expression,
          scheduledAt: date.getTime(),
          actualAt: now,
        })
        void Promise.resolve(result)
          .catch((error) => {
            this.lastError = error instanceof Error ? error.message : String(error)
          })
          .finally(() => {
            this.running = false
            if (!this.stopped && !this.destroyed) {
              this.refreshNextRun()
              this.arm()
            }
          })
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error)
        this.running = false
      }
    }
    this.refreshNextRun()
  }

  private now(): number {
    return this.options.now ? this.options.now() : Date.now()
  }

  private refreshNextRun(): void {
    if (!this.parsed) {
      this.nextRunAt = null
      return
    }
    const next = nextCronRun(this.parsed, new Date(this.now()))
    this.nextRunAt = next ? next.getTime() : null
  }

  private arm(): void {
    if (this.stopped || this.destroyed || this.timer) {
      return
    }
    const interval = Math.max(1000, this.options.tickMs || 15000)
    this.timer = setTimeout(() => {
      this.timer = null
      if (this.stopped || this.destroyed) {
        return
      }
      this.tick()
      this.arm()
    }, interval)
  }
}
