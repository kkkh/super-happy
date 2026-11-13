/* ==========================================================================
   性能采样 · 冷启动与首屏
   - 默认抽样 20%，未命中不注册观察器，零额外开销
   - 采集 appLaunch / firstRender / firstPaint / FCP / LCP / downloadPackage
   - 只记录入口页的首条指标，后续页面渲染不覆盖冷启动数据
   - 3s 防抖后异步落盘 perf:samples.v1，环形保留最近 40 条
   - 基础库 < 2.11.0 或 API 缺失时静默降级，绝不影响业务
   ========================================================================== */

export const PERF_STORAGE_KEY = 'perf:samples.v1'
export const PERF_MAX_SAMPLES = 40
export const PERF_SAMPLE_RATE = 0.2

const PERF_FLUSH_DELAY = 3000

export interface PerfSample {
  /** 采样时间戳（毫秒） */
  at: number
  /** 入口页路由（仅 firstRender 条目带 path 时记录） */
  route?: string
  /** 小程序启动耗时（navigation / appLaunch） */
  appLaunch?: number
  /** 页面首次渲染耗时（render / firstRender） */
  firstRender?: number
  /** 首次绘制（render / firstPaint，iOS 不支持） */
  firstPaint?: number
  /** 首次内容绘制（render / firstContentfulPaint） */
  firstContentfulPaint?: number
  /** 最大内容绘制（render / largestContentfulPaint，iOS 不支持） */
  largestContentfulPaint?: number
  /** 代码包下载耗时（loadPackage / downloadPackage，2.24.0+） */
  downloadPackage?: number
}

/** 观察器条目：只声明实际消费的字段，避免依赖类型联合的版本差异 */
export interface PerfEntryLike {
  name?: string
  path?: string
  duration?: number
}

/** 是否命中采样：抽 20%，避免每次启动都写存储 */
export function shouldSample(random: number = Math.random()): boolean {
  return random < PERF_SAMPLE_RATE
}

/** 环形写入：只保留最近 max 条 */
export function pushPerfSample(
  list: PerfSample[],
  sample: PerfSample,
  max: number = PERF_MAX_SAMPLES,
): PerfSample[] {
  const next = list.concat(sample)
  return next.length > max ? next.slice(next.length - max) : next
}

/** 合并条目：同一字段只保留首条，保证采样代表入口页冷启动 */
export function mergePerfEntries(sample: PerfSample, entries: PerfEntryLike[]): PerfSample {
  const next = { ...sample }
  for (const entry of entries) {
    const { name, duration } = entry
    if (!name || typeof duration !== 'number') {
      continue
    }
    if (name === 'appLaunch' && next.appLaunch === undefined) {
      next.appLaunch = duration
    } else if (name === 'firstRender' && next.firstRender === undefined) {
      next.firstRender = duration
      if (entry.path) {
        next.route = entry.path
      }
    } else if (name === 'firstPaint' && next.firstPaint === undefined) {
      next.firstPaint = duration
    } else if (name === 'firstContentfulPaint' && next.firstContentfulPaint === undefined) {
      next.firstContentfulPaint = duration
    } else if (name === 'largestContentfulPaint' && next.largestContentfulPaint === undefined) {
      next.largestContentfulPaint = duration
    } else if (name === 'downloadPackage' && next.downloadPackage === undefined) {
      next.downloadPackage = duration
    }
  }
  return next
}

/** 读取已有采样；存储损坏或不可用时返回空数组 */
export function readPerfSamples(): PerfSample[] {
  try {
    if (typeof wx === 'undefined') {
      return []
    }
    const raw: unknown = wx.getStorageSync(PERF_STORAGE_KEY)
    return Array.isArray(raw) ? (raw as PerfSample[]) : []
  } catch {
    return []
  }
}

/** 最近一次采样的可读摘要：设置页「性能采样」行使用 */
export function summarizePerfSamples(list: PerfSample[]): string {
  if (!list.length) {
    return '暂无采样'
  }
  const last = list[list.length - 1]
  const parts: string[] = []
  if (typeof last.appLaunch === 'number') {
    parts.push(`启动 ${Math.round(last.appLaunch)}ms`)
  }
  if (typeof last.firstRender === 'number') {
    parts.push(`首屏 ${Math.round(last.firstRender)}ms`)
  }
  if (typeof last.downloadPackage === 'number') {
    parts.push(`下载 ${Math.round(last.downloadPackage)}ms`)
  }
  if (!parts.length) {
    return '暂无采样'
  }
  return `${parts.join(' · ')} · 共 ${list.length} 次`
}

function flush(sample: PerfSample): void {
  try {
    if (typeof wx === 'undefined') {
      return
    }
    /* 只有 at 时间戳说明本轮没抓到任何指标，不落盘 */
    if (Object.keys(sample).length <= 1) {
      return
    }
    const list = pushPerfSample(readPerfSamples(), sample)
    wx.setStorage({ key: PERF_STORAGE_KEY, data: list, fail: () => undefined })
  } catch {
    /* 采样失败不影响业务 */
  }
}

/** 启动采样：命中抽样才注册观察器；任何异常静默降级 */
export function startPerfSampling(): void {
  try {
    if (!shouldSample()) {
      return
    }
    if (typeof wx === 'undefined' || typeof wx.getPerformance !== 'function') {
      return
    }
    const performance = wx.getPerformance()
    if (!performance || typeof performance.createObserver !== 'function') {
      return
    }
    let sample: PerfSample = { at: Date.now() }
    let timer: ReturnType<typeof setTimeout> | null = null
    const schedule = (): void => {
      if (timer) {
        clearTimeout(timer)
      }
      timer = setTimeout(() => flush(sample), PERF_FLUSH_DELAY)
    }
    const collect = (entries: PerfEntryLike[] | undefined): void => {
      if (!entries || !entries.length) {
        return
      }
      sample = mergePerfEntries(sample, entries)
      schedule()
    }
    const observer = performance.createObserver(
      (entryList: { getEntries?: () => PerfEntryLike[] } | undefined) => {
        collect(entryList && typeof entryList.getEntries === 'function' ? entryList.getEntries() : [])
      },
    )
    observer.observe({ entryTypes: ['navigation', 'render', 'loadPackage'] })
    /* 注册前已产生的启动指标从缓冲区补齐 */
    collect(performance.getEntries() as PerfEntryLike[])
  } catch {
    /* 性能 API 不可用时静默降级 */
  }
}
