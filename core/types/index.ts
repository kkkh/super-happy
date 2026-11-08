/* ==========================================================================
   类型宪法 · 全链路 strict 类型定义
   - 页面 → Service → Store → 数据，全部经由此处类型贯通
   - 禁止隐式 any；领域结构即 AI SKILL 的原子接口契约（阶段 4 直接复用）
   ========================================================================== */

/* ---- 主题 ---- */
export type ThemeMode = 'auto' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

/* ---- 语义色调（贯穿 Tag / Icon / Accent 的色彩语义名） ---- */
export type Tone = 'iris' | 'aurora' | 'amber'

/* ---- 个人档案 ---- */
export interface Profile {
  name: string
  alias: string
  motto: string
  location: string[]
  email: string
  phone: string
  avatar: string
  intro: string
  /** 名片生成器画布使用的英雄副题 */
  heroLine: string
}

/* ---- 社交坐标 ---- */
export interface ContactLink {
  id: string
  label: string
  handle: string
  qr: string
  tone: Tone
}

/* ---- 问候卡 ---- */
export interface GreetingCard {
  id: string
  title: string
  body: string
  icon: string
  tone: Tone
}

/* ---- 关于我 · 叙事块 ---- */
export interface AboutBlock {
  id: string
  title: string
  kicker: string
  body: string[]
  tone: Tone
}

/* ---- 成长时间线 ---- */
export interface TimelineMilestone {
  title: string
  note: string
}

export interface TimelineEra {
  id: string
  era: string
  kicker: string
  title: string
  note: string
  tone: Tone
  items: TimelineMilestone[]
}

/* ---- 技能 ---- */
export interface SkillItem {
  name: string
  /** 1–5 掌握度 */
  level: number
  note: string
}

export interface SkillGroup {
  id: string
  title: string
  kicker: string
  tone: Tone
  items: SkillItem[]
}

/* ---- 数字速览 ---- */
export interface StatItem {
  id: string
  label: string
  kicker: string
  value: number
  suffix: string
}

/* ---- 作品 ---- */
export interface StackSection {
  label: string
  items: string[]
}

export interface GalleryShot {
  img: string
}

export interface GalleryGroup {
  title: string
  shots: GalleryShot[]
  /** 画幅：默认横版 16:10；手机截图使用竖版 */
  layout?: 'landscape' | 'portrait'
}

export interface ProjectMetric {
  label: string
  value: string
}

export interface Project {
  id: string
  category: ProjectCategory
  title: string
  subtitle: string
  summary: string
  cover: string
  accent: Tone
  role: string
  duration: string
  stack: StackSection[]
  metrics: ProjectMetric[]
  highlights: string[]
  experiences: string[]
  gallery: GalleryGroup[]
  shareKey: string
}

export type ProjectCategory = 'actual' | 'personal'

export interface CategoryMeta {
  category: ProjectCategory
  title: string
  kicker: string
  description: string
  shareKey: string
  tone: Tone
}

/* ---- 主页入口 ---- */
export interface HomeEntry {
  id: string
  index: string
  icon: string
  title: string
  sub: string
  route: string
  tone: Tone
  /** 主页入口环 → 目标页徽章的共享元素飞跃键 */
  flyKey: string
}

/* ---- 传输层（Service 骨架） ---- */
export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError }

export interface AppError {
  code: ErrorCode
  message: string
  /** 是否值得自动重试（网络抖动等瞬态错误） */
  retryable: boolean
}

export type ErrorCode =
  | 'NETWORK'
  | 'TIMEOUT'
  | 'PARSE'
  | 'NOT_FOUND'
  | 'PERMISSION'
  | 'CANVAS'
  | 'SAVE_ALBUM'
  | 'UNKNOWN'

/* ---- AI SKILL 原子接口（阶段 4 封装为 SKILL 单元） ---- */
export interface SkillEndpoint<Req, Res> {
  name: string
  description: string
  invoke: (payload: Req) => Promise<Result<Res>>
}
