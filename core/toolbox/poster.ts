/* ==========================================================================
   IPosterData · 工具页 → 极光海报的唯一数据契约
   - 只保留四类有价值的信息：工具名 / 分类 / 主结果 / 参数 / 衍生结论
   - extras 是海报灵魂：税后到手、利息占比、多单位对照等可分享结论
   - 所有文本在此收敛长度，Canvas 绘制永不溢出
   ========================================================================== */

export interface PosterParam {
  label: string
  value: string
}

export interface IPosterData {
  /** 工具名称，如「房贷试算」 */
  toolName: string
  /** 分类胶囊，如「财务计算」 */
  category: string
  /** 核心主结果，如「¥5,368.00」 */
  mainResult: string
  /** 精准结果标签，如「每月月供」 */
  resultLabel: string
  /** 用户真实输入，最多 4 组 */
  params: PosterParam[]
  /** 衍生干货，最多 4 条 */
  extras: string[]
}

const CATEGORY_LABELS: Record<string, string> = {
  calc: '计算换算',
  date: '日期时间',
  text: '文本效率',
  media: '图片处理',
  life: '生活健康',
  work: '职场辅助',
}

/** 工具注册表的英文分类码 → 海报中文胶囊标签 */
export function resolvePosterCategory(code?: string): string {
  if (!code) {
    return '效率工具'
  }
  return CATEGORY_LABELS[code] ?? code
}

const MAX_TOOL_NAME = 24
const MAX_CATEGORY = 12
const MAX_MAIN_RESULT = 80
const MAX_RESULT_LABEL = 24
const MAX_PARAMS = 4
const MAX_PARAM_LABEL = 12
const MAX_PARAM_VALUE = 24
const MAX_EXTRAS = 4
const MAX_EXTRA = 34

function toText(value: unknown, max: number): string {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return ''
  }
  const text = String(value).replace(/\s+/g, ' ').trim()
  if (text.length <= max) {
    return text
  }
  return `${text.slice(0, max - 1)}…`
}

/**
 * 把工具页传入的对象收敛成可绘制的 IPosterData。
 * mainResult 为空视为无效数据，调用方回退到旧字段。
 */
export function normalizePosterData(raw: unknown): IPosterData | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null
  }
  const record = raw as Record<string, unknown>
  const mainResult = toText(record.mainResult, MAX_MAIN_RESULT)
  if (!mainResult) {
    return null
  }

  const params: PosterParam[] = []
  const rawParams = Array.isArray(record.params) ? record.params : []
  for (const item of rawParams) {
    if (params.length >= MAX_PARAMS) {
      break
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue
    }
    const param = item as Record<string, unknown>
    const label = toText(param.label, MAX_PARAM_LABEL)
    const value = toText(param.value, MAX_PARAM_VALUE)
    if (!label || !value) {
      continue
    }
    params.push({ label, value })
  }

  const extras: string[] = []
  const rawExtras = Array.isArray(record.extras) ? record.extras : []
  for (const item of rawExtras) {
    if (extras.length >= MAX_EXTRAS) {
      break
    }
    const text = toText(item, MAX_EXTRA)
    if (!text) {
      continue
    }
    extras.push(text)
  }

  return {
    toolName: toText(record.toolName, MAX_TOOL_NAME) || '超欢工具',
    category: toText(record.category, MAX_CATEGORY) || '效率工具',
    mainResult,
    resultLabel: toText(record.resultLabel, MAX_RESULT_LABEL),
    params,
    extras,
  }
}
