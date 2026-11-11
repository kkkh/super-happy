/* ==========================================================================
   workflowConfig · 全域智能路由唯一配置
   - 63 个真实工具全部登记，禁止遗漏、禁止猜测
   - silent：面板内纯 TS 计算，不跳转
   - jump：navigateTo 注入后继续用户操作（图片 / 复杂表单）
   - accepts 决定当前载荷类型下哪些工具可点，哪些置灰
   ========================================================================== */
import { TOOLS } from '../toolbox/registry'
import type {
  WorkflowDataType,
  WorkflowRouteMode,
  WorkflowToolId,
} from './types'

interface WorkflowToolRouteMeta {
  mode: WorkflowRouteMode
  /** 该工具可接收的载荷类型；空数组表示纯产出型工具 */
  accepts: WorkflowDataType[]
}

/** 路由分类映射：全部工具逐一声明，绝无遗漏 */
export const WORKFLOW_ROUTING: Record<WorkflowToolId, WorkflowRouteMode> = {
  /* ---- A 类 · 静默流转（纯文本 / JSON 纯函数） ---- */
  base64: 'silent',
  radix: 'silent',
  'date-format': 'silent',
  'date-add': 'silent',
  color: 'silent',
  'json-csv': 'silent',
  'size-convert': 'jump',
  severance: 'jump',
  'id-validate': 'jump',
  'image-pdf': 'jump',
  barcode: 'jump',
  exif: 'jump',
  timezone: 'jump',
  schedule: 'jump',
  'text-convert': 'silent',
  template: 'silent',
  resolution: 'silent',
  percent: 'silent',
  dedupe: 'silent',
  json: 'silent',
  url: 'silent',
  wordcount: 'silent',
  'random-pick': 'silent',

  /* ---- B 类 · 带参跳转（复杂表单 / 图片 / 需要用户继续操作） ---- */
  unit: 'jump',
  ledger: 'jump',
  fuel: 'jump',
  power: 'jump',
  carloan: 'jump',
  quote: 'jump',
  'meeting-timer': 'jump',
  bodyfat: 'jump',
  avatar: 'jump',
  collage: 'jump',
  'id-photo': 'jump',
  'qr-decode': 'jump',
  lunar: 'jump',
  'zh-convert': 'jump',
  pinyin: 'jump',
  'fx-manual': 'jump',
  'salary-inverse': 'jump',
  worktime: 'jump',
  wellness: 'jump',
  vcard: 'jump',
  tax: 'jump',
  loan: 'jump',
  deposit: 'jump',
  span: 'jump',
  age: 'jump',
  countdown: 'jump',
  timestamp: 'jump',
  regex: 'jump',
  rmb: 'jump',
  'text-diff': 'jump',
  hash: 'jump',
  password: 'jump',
  'photo-edit': 'jump',
  bmi: 'jump',
  compress: 'jump',
  palette: 'jump',
  'nine-grid': 'jump',
  qr: 'jump',
  watermark: 'jump',
  weather: 'jump',
}

/** 接收能力：用于面板智能过滤与置灰 */
export const WORKFLOW_ACCEPTS: Record<WorkflowToolId, WorkflowDataType[]> = {
  base64: ['text', 'json'],
  /* 静默流转只接受纯文本：执行器只认十进制整数，避免对 JSON / 前缀做虚假承诺 */
  radix: ['text'],
  'date-format': ['text'],
  'date-add': ['text'],
  color: ['text'],
  'json-csv': ['text', 'json'],
  'size-convert': [],
  severance: [],
  'id-validate': ['text'],
  'image-pdf': ['image'],
  barcode: ['text'],
  exif: ['image'],
  timezone: ['text'],
  schedule: ['text'],
  'text-convert': ['text'],
  template: ['text'],
  resolution: ['text'],
  percent: ['text'],
  dedupe: ['text', 'json'],
  json: ['json', 'text'],
  url: ['text', 'json'],
  wordcount: ['text', 'json'],
  'random-pick': ['text'],

  unit: ['text'],
  ledger: ['text'],
  fuel: ['text'],
  power: ['text'],
  carloan: ['text'],
  quote: ['text'],
  'meeting-timer': [],
  bodyfat: [],
  avatar: ['image'],
  collage: ['image'],
  'id-photo': ['image'],
  'qr-decode': ['image'],
  lunar: ['text'],
  'zh-convert': ['text'],
  pinyin: ['text'],
  'fx-manual': ['text'],
  'salary-inverse': ['text'],
  worktime: [],
  wellness: [],
  vcard: [],
  tax: ['text'],
  loan: ['text'],
  deposit: ['text'],
  span: ['text'],
  age: ['text'],
  countdown: ['text'],
  timestamp: ['text'],
  regex: ['text'],
  rmb: ['text'],
  'text-diff': ['text', 'json'],
  hash: ['text', 'json'],
  /* 纯产出 / 多字段复杂表单：不接受任意流转内容，面板中明确置灰 */
  password: [],
  'photo-edit': ['image'],
  bmi: [],
  compress: ['image'],
  palette: ['image'],
  'nine-grid': ['image'],
  qr: ['text'],
  watermark: ['image'],
  /* 气象站为纯产出：天气摘要可复制/流转，但不接受任意文本注入 */
  weather: [],
}

/** 路由元数据：mode + accepts 一处取用 */
export const WORKFLOW_ROUTE_META: Record<WorkflowToolId, WorkflowToolRouteMeta> =
  (Object.keys(WORKFLOW_ROUTING) as WorkflowToolId[]).reduce(
    (map, id) => {
      map[id] = {
        mode: WORKFLOW_ROUTING[id],
        accepts: WORKFLOW_ACCEPTS[id],
      }
      return map
    },
    {} as Record<WorkflowToolId, WorkflowToolRouteMeta>,
  )

export const WORKFLOW_TYPE_LABELS: Record<WorkflowDataType, string> = {
  text: '文本',
  image: '图片',
  json: 'JSON',
}

const TOOL_ID_SET = new Set<string>(
  (Object.keys(WORKFLOW_ROUTING) as WorkflowToolId[]).map((id) => id),
)

const SILENT_TOOL_SET = new Set<WorkflowToolId>(
  (Object.keys(WORKFLOW_ROUTING) as WorkflowToolId[]).filter(
    (id) => WORKFLOW_ROUTING[id] === 'silent',
  ),
)

export function isWorkflowToolId(value: unknown): value is WorkflowToolId {
  return typeof value === 'string' && TOOL_ID_SET.has(value)
}

export function isSilentWorkflowTool(id: WorkflowToolId): boolean {
  return SILENT_TOOL_SET.has(id)
}

export function isToolCompatible(id: WorkflowToolId, type: WorkflowDataType): boolean {
  const accepts = WORKFLOW_ACCEPTS[id]
  return accepts.length > 0 && accepts.includes(type)
}

/** 面板排序：可用工具在前，不可用工具置灰在后；同组按注册表权重 */
export function workflowToolsForType(type: WorkflowDataType): Array<{
  id: WorkflowToolId
  name: string
  desc: string
  category: string
  icon: string
  mode: WorkflowRouteMode
  compatible: boolean
}> {
  const weightOf = (id: WorkflowToolId): number => {
    const meta = TOOLS.find((tool) => tool.id === id)
    return meta ? meta.weight : 0
  }

  return (Object.keys(WORKFLOW_ROUTING) as WorkflowToolId[])
    .map((id) => {
      const meta = TOOLS.find((tool) => tool.id === id)
      return {
        id,
        name: meta?.name ?? id,
        desc: meta?.desc ?? '',
        category: meta?.category ?? '',
        icon: meta?.icon ?? '·',
        mode: WORKFLOW_ROUTING[id],
        compatible: isToolCompatible(id, type),
      }
    })
    .sort((left, right) => {
      if (left.compatible !== right.compatible) {
        return left.compatible ? -1 : 1
      }
      return weightOf(right.id) - weightOf(left.id)
    })
}

/** 工具中文名：快捷管道、熔断提示、历史记录统一取这里 */
export function workflowToolName(id: WorkflowToolId): string {
  return TOOLS.find((tool) => tool.id === id)?.name ?? id
}
