/* ==========================================================================
   ambient-theme · 环境光自适应主题引擎
   - 根据工具分类切换极光色组：计算冷蓝灰 / 图片暖橙紫 / 文本薄荷 / 日期虹彩
   - 根据系统时间微调亮度与朦胧度：白天通透、夜晚变暗并增加 haze
   - 输出可直接绑定到页面根节点的 class / style，不直接操作页面
   - 纯函数 + 单例引擎，可单元测试；无 wx 依赖
   ========================================================================== */
import type { ToolCategory } from '../toolbox/types'

export type AmbientPreset = 'auto' | 'cold' | 'warm' | 'iris' | 'mint' | 'night'
export type AmbientScene = 'cold' | 'warm' | 'iris' | 'mint' | 'night'
export type AmbientCategory = ToolCategory | 'home'
export type AmbientPhase = 'morning' | 'day' | 'evening' | 'night'

export interface AmbientPalette {
  scene: AmbientScene
  label: string
  a: string
  b: string
  c: string
  aSoft: string
  bSoft: string
  cSoft: string
  intensity: number
  haze: number
}

export interface AmbientThemeState {
  preset: AmbientPreset
  category: AmbientCategory
  scene: AmbientScene
  phase: AmbientPhase
  palette: AmbientPalette
  intensity: number
  haze: number
  className: string
  style: string
  updatedAt: number
}

export interface AmbientThemeOptions {
  /** 时钟刷新间隔，默认 60s */
  clockIntervalMs?: number
  /** 注入 now，便于单元测试 */
  now?: () => Date
  /** 工具 id → 分类解析器；App 启动时注册一次 */
  resolveCategory?: AmbientCategoryResolver
}

export type AmbientCategoryResolver = (toolId: string) => AmbientCategory

let registeredCategoryResolver: AmbientCategoryResolver | null = null

/** App 启动时注册；避免 ambient-theme 依赖 registry，便于单测与复用 */
export function setAmbientToolCategoryResolver(
  resolver: AmbientCategoryResolver | null,
): void {
  registeredCategoryResolver = resolver
}

const PRESETS: AmbientPreset[] = ['auto', 'cold', 'warm', 'iris', 'mint', 'night']
const CATEGORIES: AmbientCategory[] = ['home', 'calc', 'date', 'text', 'media', 'life', 'work']

const CATEGORY_SCENE: Record<AmbientCategory, AmbientScene> = {
  home: 'iris',
  calc: 'cold',
  date: 'iris',
  text: 'mint',
  media: 'warm',
  life: 'warm',
  work: 'cold',
}

interface PaletteDefinition {
  label: string
  a: string
  b: string
  c: string
  aSoft: string
  bSoft: string
  cSoft: string
  intensity: number
  haze: number
}

const PALETTES: Record<AmbientScene, PaletteDefinition> = {
  cold: {
    label: '冷峻蓝灰',
    a: '#7c8cff',
    b: '#5fdcc7',
    c: '#9f7cff',
    aSoft: 'rgba(124, 140, 255, 0.22)',
    bSoft: 'rgba(95, 220, 199, 0.14)',
    cSoft: 'rgba(159, 124, 255, 0.13)',
    intensity: 1,
    haze: 0.16,
  },
  warm: {
    label: '暖橙紫',
    a: '#ffb083',
    b: '#9f7cff',
    c: '#5fdcc7',
    aSoft: 'rgba(255, 176, 131, 0.2)',
    bSoft: 'rgba(159, 124, 255, 0.15)',
    cSoft: 'rgba(95, 220, 199, 0.1)',
    intensity: 1,
    haze: 0.18,
  },
  iris: {
    label: '虹彩紫',
    a: '#9f7cff',
    b: '#7c8cff',
    c: '#ffb083',
    aSoft: 'rgba(159, 124, 255, 0.22)',
    bSoft: 'rgba(124, 140, 255, 0.16)',
    cSoft: 'rgba(255, 176, 131, 0.12)',
    intensity: 1,
    haze: 0.17,
  },
  mint: {
    label: '薄荷青',
    a: '#5fdcc7',
    b: '#7c8cff',
    c: '#9f7cff',
    aSoft: 'rgba(95, 220, 199, 0.2)',
    bSoft: 'rgba(124, 140, 255, 0.14)',
    cSoft: 'rgba(159, 124, 255, 0.12)',
    intensity: 1,
    haze: 0.15,
  },
  night: {
    label: '深夜石墨',
    a: '#1a2238',
    b: '#3a4a7a',
    c: '#6b4f8f',
    aSoft: 'rgba(26, 34, 56, 0.34)',
    bSoft: 'rgba(58, 74, 122, 0.22)',
    cSoft: 'rgba(107, 79, 143, 0.18)',
    intensity: 0.42,
    haze: 0.52,
  },
}

function isPreset(value: unknown): value is AmbientPreset {
  return typeof value === 'string' && PRESETS.includes(value as AmbientPreset)
}

function isCategory(value: unknown): value is AmbientCategory {
  return typeof value === 'string' && CATEGORIES.includes(value as AmbientCategory)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 时间段：5–11 清晨，11–18 白天，18–22 傍晚，其余深夜 */
export function resolvePhase(date: Date = new Date()): AmbientPhase {
  const hour = date.getHours()
  if (hour >= 5 && hour < 11) {
    return 'morning'
  }
  if (hour >= 11 && hour < 18) {
    return 'day'
  }
  if (hour >= 18 && hour < 22) {
    return 'evening'
  }
  return 'night'
}

interface PhaseTuning {
  intensity: number
  haze: number
}

function phaseTuning(phase: AmbientPhase): PhaseTuning {
  if (phase === 'morning') {
    return { intensity: 1, haze: 0.14 }
  }
  if (phase === 'day') {
    return { intensity: 1, haze: 0.12 }
  }
  if (phase === 'evening') {
    return { intensity: 0.86, haze: 0.26 }
  }
  return { intensity: 0.64, haze: 0.46 }
}

function buildPalette(scene: AmbientScene, phase: AmbientPhase): AmbientPalette {
  const base = PALETTES[scene]
  const tuning = phaseTuning(phase)
  return {
    scene,
    label: base.label,
    a: base.a,
    b: base.b,
    c: base.c,
    aSoft: base.aSoft,
    bSoft: base.bSoft,
    cSoft: base.cSoft,
    intensity: clamp(base.intensity * tuning.intensity, 0.18, 1),
    haze: clamp(Math.max(base.haze, tuning.haze), 0, 0.72),
  }
}

function buildStyle(palette: AmbientPalette): string {
  return [
    `--sg-ambient-a:${palette.a}`,
    `--sg-ambient-b:${palette.b}`,
    `--sg-ambient-c:${palette.c}`,
    `--sg-ambient-a-soft:${palette.aSoft}`,
    `--sg-ambient-b-soft:${palette.bSoft}`,
    `--sg-ambient-c-soft:${palette.cSoft}`,
    `--sg-ambient-intensity:${palette.intensity.toFixed(3)}`,
    `--sg-ambient-haze:${palette.haze.toFixed(3)}`,
  ].join(';')
}

/** 纯函数：给定预设 / 分类 / 时间，生成完整环境光状态 */
export function resolveAmbientTheme(
  preset: AmbientPreset,
  category: AmbientCategory,
  date: Date = new Date(),
): AmbientThemeState {
  const phase = resolvePhase(date)
  const safePreset = isPreset(preset) ? preset : 'auto'
  const safeCategory = isCategory(category) ? category : 'home'
  const scene: AmbientScene =
    safePreset === 'auto'
      ? CATEGORY_SCENE[safeCategory]
      : safePreset === 'night'
        ? 'night'
        : safePreset
  const palette = buildPalette(scene, phase)

  return {
    preset: safePreset,
    category: safeCategory,
    scene,
    phase,
    palette,
    intensity: palette.intensity,
    haze: palette.haze,
    className: `sg-ambient-${scene}`,
    style: buildStyle(palette),
    updatedAt: Date.now(),
  }
}

/** 根据工具 id 找到分类；需要外部注入 resolver；找不到回退 home */
export function categoryForTool(
  toolId: string,
  resolver: AmbientCategoryResolver | null = registeredCategoryResolver,
): AmbientCategory {
  if (!resolver) {
    return 'home'
  }
  try {
    return resolver(toolId)
  } catch {
    return 'home'
  }
}

export type AmbientThemeListener = (state: AmbientThemeState) => void

export class AmbientThemeEngine {
  private preset: AmbientPreset = 'auto'
  private category: AmbientCategory = 'home'
  private state: AmbientThemeState
  private listeners = new Set<AmbientThemeListener>()
  private timer = 0
  private readonly clockIntervalMs: number
  private readonly now: () => Date
  private readonly resolveCategory: AmbientCategoryResolver | null

  constructor(options: AmbientThemeOptions = {}) {
    this.clockIntervalMs = Math.max(15000, options.clockIntervalMs ?? 60000)
    this.now = options.now ?? (() => new Date())
    this.resolveCategory = options.resolveCategory ?? null
    this.state = resolveAmbientTheme(this.preset, this.category, this.now())
  }

  getState(): AmbientThemeState {
    return this.state
  }

  setPreset(preset: AmbientPreset): AmbientThemeState {
    this.preset = isPreset(preset) ? preset : 'auto'
    this.rebuild(true)
    return this.state
  }

  setCategory(category: AmbientCategory): AmbientThemeState {
    this.category = isCategory(category) ? category : 'home'
    this.rebuild(true)
    return this.state
  }

  /** 跟随工具页：自动映射 calc / media / text 等分类 */
  syncTool(toolId: string): AmbientThemeState {
    const resolver = this.resolveCategory ?? registeredCategoryResolver
    return this.setCategory(categoryForTool(toolId, resolver))
  }

  /** 每分钟刷新时间相位；页面无需轮询 */
  refresh(): AmbientThemeState {
    this.rebuild(true)
    return this.state
  }

  subscribe(listener: AmbientThemeListener): () => void {
    if (typeof listener !== 'function') {
      return () => undefined
    }
    this.listeners.add(listener)
    listener(this.state)
    this.startClock()

    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) {
        this.stopClock()
      }
    }
  }

  startClock(): void {
    if (this.timer) {
      return
    }
    this.timer = setInterval(() => {
      this.refresh()
    }, this.clockIntervalMs) as unknown as number
  }

  stopClock(): void {
    if (!this.timer) {
      return
    }
    clearInterval(this.timer)
    this.timer = 0
  }

  dispose(): void {
    this.stopClock()
    this.listeners.clear()
  }

  private rebuild(emit: boolean): void {
    this.state = resolveAmbientTheme(this.preset, this.category, this.now())
    if (!emit) {
      return
    }
    this.listeners.forEach((listener) => {
      try {
        listener(this.state)
      } catch {
        /* 单个订阅者异常不影响其它页面 */
      }
    })
  }
}

/** 全局引擎；页面订阅后把 className / style 绑定到根节点 */
export const ambientTheme = new AmbientThemeEngine()

/** 页面接入类型：不依赖具体 Page 实例 */
export interface AmbientPageBindings {
  ambientClass: string
  ambientStyle: string
}

export function applyAmbientToPage(
  page: { setData: (data: AmbientPageBindings) => void },
  state: AmbientThemeState,
): void {
  page.setData({
    ambientClass: state.className,
    ambientStyle: state.style,
  })
}
