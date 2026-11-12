/* ==========================================================================
   常量层 · 路由表 / Canvas 调色板 / 全局常量
   - 路由唯一真相源：页面跳转禁止手写字符串
   - paletteFor 为 Canvas 层（极光/名片）唯一取色入口，与 Design Tokens 同源
   ========================================================================== */
import type { ResolvedTheme } from '../types/index'

/** 路由表（主包 TabBar 页 + 工具分包 + 简历分包） */
export const ROUTES = {
  home: '/pages/index/index',
  favorites: '/pages/favorites/index',
  mine: '/pages/mine/index',
  legal: '/subpackages/grow/pages/legal/index',
  /* 简历首页：由主包迁入 grow 分包，入口统一走「我的 → 关于作者」 */
  growHome: '/subpackages/grow/pages/home/index',
  greeting: '/subpackages/grow/pages/greeting/index',
  profile: '/subpackages/grow/pages/profile/index',
  about: '/subpackages/grow/pages/about/index',
  skills: '/subpackages/grow/pages/skills/index',
  worksHub: '/subpackages/works/pages/hub/index',
  worksList: '/subpackages/works/pages/list/index',
  worksDetail: '/subpackages/works/pages/detail/index',
  /* 园枢图集体积较大，详情页与 22 张真机界面独立分包承载 */
  campusDetail: '/subpackages/campus/pages/detail/index',
  /* 全局配置与管控中枢：挂在个人域 grow 分包，避免主包继续增页 */
  settings: '/subpackages/grow/pages/settings/index',
  /* 数据驾驶舱：本机计算轨迹 / 效率周报 / 双主题 Canvas 图表 */
  cockpit: '/subpackages/grow/pages/cockpit/index',
  /* 使用指南：全部工具的使用步骤与常见问题 */
  help: '/subpackages/grow/pages/help/index',
  /* 全息专注引擎：life 分包，独立于 26 个工具路由 */
  focus: '/subpackages/life/pages/focus/index',
  /* 全息气象站：tools-core 分包，直连高德 Web服务 REST */
  weather: '/subpackages/tools-core/pages/weather/index',
  /* 元宝搜索：tools-core 分包，腾讯云 WSA SearchPro */
  webSearch: '/subpackages/tools-core/pages/web-search/index',
  /* 和风天气：weather 分包，8 组 API / 27 端点 / 官方图标 */
  qweather: '/subpackages/weather/pages/home/index',
} as const

/** 当前版本号：设置中心、我的页与更新日志共用同一真相源 */
export const APP_VERSION = '1.1.0'
/** 隐私保护指引版本：仅在数据处理方式变化时递增，与 app:privacy.version 比对 */
export const PRIVACY_VERSION = 2

/** 模态弹窗动作色：破坏性操作必须红/绿分明，避免误触 */
export const ACTION_COLORS = {
  safe: '#0B6B5F',
  danger: '#FF4D24',
} as const

/** 全局时序常量：防抖、Toast、滚动复位、Canvas 延迟统一收口 */
export const TIMING = {
  HOME_SEARCH_DEBOUNCE: 160,
  WORKS_SEARCH_DEBOUNCE: 200,
  TOAST_DURATION: 2200,
  LEGAL_SCROLL_RESET: 600,
  TOOL_SCROLL_RESET: 500,
  CARD_RENDER_DELAY: 140,
  DOUBLE_TAP_WINDOW: 280,
  DRAG_FRAME: 16,
  /** 主题切换呼吸窗口：页面在此期间播放一次呼吸淡入，掩盖硬切 */
  THEME_TRANSITION: 420,
} as const

/** 领域输入上限：页面 data 绑定，避免 WXML 与 TS 各自硬编码 */
export const LIMITS = {
  TEXT_INPUT: 20000,
  MEDIA_SOURCE_BYTES: 50 * 1024 * 1024,
} as const

/** 页面标题表：返回历史菜单与导航题字复用（键为无参路由） */
export const ROUTE_TITLES: Record<string, string> = {
  [ROUTES.home]: '工具箱',
  [ROUTES.favorites]: '常用工具',
  [ROUTES.mine]: '我的',
  [ROUTES.legal]: '隐私与说明',
  [ROUTES.growHome]: '简历',
  [ROUTES.greeting]: '您好',
  [ROUTES.profile]: '个人简介',
  [ROUTES.about]: '关于我',
  [ROUTES.skills]: '我的技能',
  [ROUTES.worksHub]: '我的项目',
  [ROUTES.worksList]: '作品列表',
  [ROUTES.worksDetail]: '作品详情',
  [ROUTES.campusDetail]: '作品详情',
  [ROUTES.settings]: '全局设置',
  [ROUTES.cockpit]: '数据驾驶舱',
  [ROUTES.help]: '使用指南',
  [ROUTES.weather]: '全息气象',
  [ROUTES.qweather]: '和风天气',
  [ROUTES.webSearch]: '元宝搜索',
}

/** 带参路由构造器 */
export function routeTo(category: string): string {
  return `${ROUTES.worksList}?category=${category}`
}

export function routeDetail(id: string): string {
  /* 园枢详情与图集位于 campus 分包，其余作品继续走作品分包 */
  if (id === 'yuan-shu') {
    return `${ROUTES.campusDetail}?id=${id}`
  }
  return `${ROUTES.worksDetail}?id=${id}`
}

/* ---- Canvas 调色板（与 app.wxss 的 --g-* 语义真值逐一同源） ---- */
export interface CanvasPalette {
  canvas: string
  well: string
  ink: string
  ink2: string
  ink3: string
  ink4: string
  iris: string
  aurora: string
  amber: string
  heroGlow: string
}

const DARK_PALETTE: CanvasPalette = {
  canvas: '#06080f',
  well: '#0b0f1a',
  ink: '#f4f6fb',
  ink2: '#dce2ef',
  ink3: '#8c99b6',
  ink4: '#5d6b8b',
  iris: '#8a93ec',
  aurora: '#54cfb2',
  amber: '#e9c68d',
  heroGlow: 'rgba(138, 147, 236, 0.42)',
}

const LIGHT_PALETTE: CanvasPalette = {
  canvas: '#f3f5fa',
  well: '#e8ebf3',
  ink: '#151926',
  ink2: '#39404f',
  ink3: '#656f86',
  ink4: '#97a0b4',
  iris: '#4c56b7',
  aurora: '#16826b',
  amber: '#8e6a24',
  heroGlow: 'rgba(76, 86, 183, 0.30)',
}

export function paletteFor(theme: ResolvedTheme): CanvasPalette {
  return theme === 'dark' ? DARK_PALETTE : LIGHT_PALETTE
}

/* ---- 全局常量 ---- */
export const STORAGE_KEYS = {
  themeMode: 'gallery.theme.mode',
  favorites: 'gallery.works.favorites',
  /** 全局偏好 v1：损坏时回退默认值，绝不阻塞启动 */
  preference: 'app:prefs.v1',
  /** 旧版偏好：仅迁移读取，不再写入 */
  preferenceLegacy: 'app:prefs.v0',
  /** 最近一次备份导出时间：删除备份或重置全部时清除 */
  backupAt: 'app:backup.at',
  /** 已确认的隐私保护指引版本：仅重置全部清除 */
  privacyVersion: 'app:privacy.version',
  /** 会议倒计时悬浮胶囊位置：只存 left / top，跨启动恢复 */
  meetingTimerHud: 'toolbox:meeting-timer.hud.v1',
  /** 官方汇率中间价缓存：只存最近一次牌价与更新时间，用于离线回退 */
  fxOfficialRates: 'tbx:fx.official.v1',
} as const

/** 传输层重试策略：HTTP Transport 接入时复用同一退避参数 */
export const NETWORK_POLICY = {
  retryBaseMs: 300,
  retryMaxMs: 2400,
  retryJitterMs: 120,
} as const

/** 本地黑匣子：崩溃/未处理 Promise/页面丢失的现场记录，不联网、不上传 */
export const DIAGNOSTICS = {
  storageKey: 'diag:errors.v1',
  maxEntries: 20,
  maxMessageLength: 500,
  maxStackLength: 1000,
} as const

export const LOG_TAG = '[gallery]'
