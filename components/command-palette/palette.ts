/* ==========================================================================
   Command Palette · 全局命令面板 Store + 模糊匹配
   - 23 个工具自动生成命令，另附 6 个全局导航命令
   - 模糊匹配：完全匹配 / 前缀 / 包含 / 字符子序列 / 关键词
   - 支持带参路由与 switchTab / navigateTo 两种跳转模式
   ========================================================================== */
import { observable } from 'mobx-miniprogram'
import { ROUTES } from '../../core/constants/index'
import { TOOLS } from '../../core/toolbox/registry'
import type { ToolCategory } from '../../core/toolbox/types'

export type PaletteRouteMode = 'navigateTo' | 'switchTab'

export interface PaletteCommand {
  id: string
  title: string
  subtitle: string
  icon: string
  keywords: string[]
  route: string
  mode: PaletteRouteMode
  params?: Record<string, string>
  category?: string
  weight: number
}

export type PaletteCloseSource = 'mask' | 'close' | 'select' | 'programmatic'

export interface PaletteSelectDetail {
  command: PaletteCommand
}

export interface PaletteCloseDetail {
  source: PaletteCloseSource
}

const CATEGORY_LABELS: Record<ToolCategory, string> = {
  calc: '计算换算',
  date: '日期时间',
  text: '文本效率',
  media: '图片处理',
  life: '生活健康',
  work: '职场辅助',
}

/**
 * 分类别名：用户搜“图片”“照片”“修图”或拼音都能命中整个媒体工具组。
 * 这是扩大命中率的第一层兜底，不改变工具本身的名称。
 */
const CATEGORY_ALIASES: Record<ToolCategory, string[]> = {
  calc: ['计算', '换算', 'jisuan', 'huansuan', 'js', 'hs'],
  date: ['日期', '时间', 'riqi', 'shijian', 'rq', 'sj'],
  text: ['文本', '文字', 'wenben', 'wenzi', 'wb', 'wz'],
  media: ['图片', '图像', '照片', '修图', 'tupian', 'tuxiang', 'zhaopian', 'tp', 'tx', 'zp'],
  life: ['生活', '健康', 'shenghuo', 'jiankang', 'sh', 'jk'],
  work: ['职场', '办公', 'zhichang', 'bangong', 'zc', 'bg'],
}

/**
 * 工具别名：全拼、拼音首字母与常用口语词。
 * 不引入额外拼音库，直接在命令构建期合并进 keywords，交由统一打分器处理。
 */
const TOOL_ALIASES: Record<string, string[]> = {
  unit: ['danwei', 'danweihuansuan', 'dw', 'dwhs', '换算', '厘米', '英寸'],
  tax: ['geshui', 'geshuijisuan', 'gs', 'gsjs', '个税', '所得税', '到手'],
  loan: ['fangdai', 'fangdaisuan', 'fd', 'fds', '房贷', '贷款', '月供'],
  deposit: ['cunkuan', 'cunkuanfuli', 'ck', 'ckfl', '存款', '复利'],
  span: ['riqi', 'riqijian', 'ge', 'rqjg', 'rq', '天数', '间隔', '工作日'],
  age: ['nianling', 'nianlingzhousui', 'nl', 'nlzs', '年龄', '生日', '周岁'],
  countdown: ['daoshu', 'daoshuri', 'ds', 'dsr', '倒数', '纪念日'],
  timestamp: ['shijianchuo', 'sjc', '时间戳', 'unix'],
  rmb: ['renminbi', 'jinedaxie', 'rmb', 'jedx', '大写', '金额', '报销'],
  wordcount: ['zishu', 'zishutongji', 'zs', 'zstj', '字数', '统计', '文案'],
  dedupe: ['quchong', 'quchongpaixu', 'qc', 'qccx', '去重', '排序', '清理'],
  json: ['json', 'geshihua', 'gs', '格式化', '压缩', '校验'],
  url: ['url', 'lianjie', 'bianma', 'jiema', 'lj', 'bm', 'jm', '链接', '转义'],
  base64: ['base64', 'bianma', 'jiema', 'bm', 'jm', '编码', '解码'],
  password: ['mima', 'suijimima', 'mm', 'sjmima', 'suiji', '密码', '强密码'],
  bmi: ['bmi', 'tizhong', 'shengao', 'tz', 'sg', '体重', '身高', '胖瘦'],
  compress: ['yasuo', 'tupian', 'tupianyasuo', 'ys', 'tp', 'tpys', '图片压缩', '照片压缩'],
  palette: ['quese', 'tuse', 'tupianquese', 'qs', 'ts', 'tpqs', '取色', '色板', '颜色'],
  'nine-grid': ['jiugongge', 'qietu', 'jiugonggeqietu', 'jgg', 'qt', 'jggqt', '九宫格', '切图'],
  qr: ['erweima', 'erweimashengcheng', 'qr', 'ewm', 'saoma', '二维码', '扫码'],
  watermark: ['shuiyin', 'shuiyingongzuotai', 'sy', 'dama', 'mashike', '水印', '打码', '防伪', '版权', '图层'],
}

const TOOL_COMMANDS: PaletteCommand[] = TOOLS.map((tool) => ({
  id: `tool:${tool.id}`,
  title: tool.name,
  subtitle: tool.desc,
  icon: tool.icon,
  keywords: [
    tool.id,
    tool.name,
    tool.desc,
    tool.category,
    ...tool.keywords,
    ...(TOOL_ALIASES[tool.id] ?? []),
    ...CATEGORY_ALIASES[tool.category],
  ],
  route: tool.route,
  mode: 'navigateTo',
  category: CATEGORY_LABELS[tool.category],
  weight: tool.weight,
}))

const NAV_COMMANDS: PaletteCommand[] = [
  {
    id: 'nav-home',
    title: '工具箱首页',
    subtitle: '回到全部工具',
    icon: '⌂',
    keywords: ['首页', '工具箱', 'home', '工具', 'shouye', 'sy', 'huidao'],
    route: ROUTES.home,
    mode: 'switchTab',
    weight: 130,
  },
  {
    id: 'nav-favorites',
    title: '常用工具',
    subtitle: '打开收藏页',
    icon: '♥',
    keywords: ['收藏', '常用', 'favorites', 'fav', 'shoucang', 'sc', 'changyong'],
    route: ROUTES.favorites,
    mode: 'switchTab',
    weight: 126,
  },
  {
    id: 'nav-mine',
    title: '我的',
    subtitle: '外观、数据与关于作者',
    icon: '我',
    keywords: ['我的', '设置', '外观', 'mine', 'about', 'wode', 'wd', 'shezhi', 'sz'],
    route: ROUTES.mine,
    mode: 'switchTab',
    weight: 122,
  },
  {
    id: 'nav-legal',
    title: '隐私与说明',
    subtitle: '隐私、本机数据与开源许可',
    icon: '§',
    keywords: ['隐私', '说明', '许可', 'legal', 'privacy', 'yinsi', 'ys', 'shuoming', 'sm'],
    route: ROUTES.legal,
    mode: 'navigateTo',
    params: { section: 'privacy' },
    weight: 118,
  },
  {
    id: 'nav-grow',
    title: '关于作者',
    subtitle: '简历与个人介绍',
    icon: 'CV',
    keywords: ['简历', '作者', '关于', 'grow', 'profile', 'jianli', 'jl', 'zuozhe', 'zz', 'guanyu', 'gy'],
    route: ROUTES.growHome,
    mode: 'navigateTo',
    weight: 116,
  },
  {
    id: 'nav-works',
    title: '我的项目',
    subtitle: '实际工程与个人作品',
    icon: '作',
    keywords: ['作品', '项目', '工程', 'works', 'project', 'zuopin', 'zp', 'xiangmu', 'xm', 'gongcheng', 'gc'],
    route: ROUTES.worksHub,
    mode: 'navigateTo',
    weight: 114,
  },
]

export const BUILTIN_COMMANDS: PaletteCommand[] = [...TOOL_COMMANDS, ...NAV_COMMANDS]

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '')
}

function isSubsequence(haystack: string, needle: string): boolean {
  if (!needle) {
    return true
  }
  let cursor = 0
  for (let index = 0; index < haystack.length; index += 1) {
    if (haystack.charAt(index) === needle.charAt(cursor)) {
      cursor += 1
      if (cursor >= needle.length) {
        return true
      }
    }
  }
  return false
}

function scoreField(query: string, value: string): number {
  const field = normalize(value)
  if (!field || !query) {
    return 0
  }
  if (field === query) {
    return 1000
  }
  if (field.startsWith(query)) {
    return 820
  }
  if (field.includes(query)) {
    return 620
  }
  if (isSubsequence(field, query)) {
    return 360
  }
  return 0
}

function scoreCommand(query: string, command: PaletteCommand): number {
  const fields: string[] = [
    command.title,
    command.subtitle,
    command.id,
    command.category ?? '',
    ...command.keywords,
  ]

  let best = 0
  fields.forEach((field) => {
    const score = scoreField(query, field)
    if (score > best) {
      best = score
    }
  })
  return best
}

/** 空查询按权重返回；有查询按模糊分 + 权重排序 */
export function filterPaletteCommands(
  commands: PaletteCommand[],
  keyword: string,
  maxResults: number,
): PaletteCommand[] {
  const limit = Math.max(1, Math.floor(maxResults))
  const query = normalize(keyword)

  if (!query) {
    return [...commands].sort((left, right) => right.weight - left.weight).slice(0, limit)
  }

  const scored = commands
    .map((command) => ({
      command,
      score: scoreCommand(query, command),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }
      return right.command.weight - left.command.weight
    })

  return scored.slice(0, limit).map((entry) => entry.command)
}

/** 拼接 query 参数；已带 query 时使用 & */
export function buildPaletteUrl(command: PaletteCommand): string {
  const params = command.params
  if (!params) {
    return command.route
  }
  const keys = Object.keys(params)
  if (keys.length === 0) {
    return command.route
  }
  const query = keys
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key] ?? '')}`)
    .join('&')
  return `${command.route}${command.route.includes('?') ? '&' : '?'}${query}`
}

/** 全局命令面板开关 */
export const paletteStore = observable({
  visible: false,

  show(): void {
    this.visible = true
  },

  hide(): void {
    this.visible = false
  },

  toggle(): void {
    this.visible = !this.visible
  },
})

export function openCommandPalette(): void {
  paletteStore.show()
}

export function closeCommandPalette(): void {
  paletteStore.hide()
}

export function toggleCommandPalette(): void {
  paletteStore.toggle()
}
