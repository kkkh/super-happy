/* ==========================================================================
   Workflow 类型契约 · 全域智能流转引擎的唯一致真相源
   - IWorkflowData 只允许 text / image / json 三种载荷
   - 所有页面、Store、面板、适配器必须消费同一套类型
   - 禁止 URL 传参：payload 只经 workflowStore 内存传递
   ========================================================================== */

export type WorkflowDataType = 'text' | 'image' | 'json'

/** 上下文值只允许基础类型，禁止对象/数组，避免不可控内存与序列化风险 */
export type WorkflowContextValue = string | number | boolean

/** 业务上下文：与 payload 同生命周期，例如单位分类、时间戳方向、房贷模式 */
export type WorkflowContext = Record<string, WorkflowContextValue>

/** 当前项目真实存在的工具 id；新增工具时必须同步扩展 */
export type WorkflowToolId =
  | 'unit'
  | 'radix'
  | 'date-format'
  | 'date-add'
  | 'color'
  | 'json-csv'
  | 'size-convert'
  | 'severance'
  | 'id-validate'
  | 'image-pdf'
  | 'barcode'
  | 'exif'
  | 'timezone'
  | 'schedule'
  | 'text-convert'
  | 'template'
  | 'resolution'
  | 'percent'
  | 'regex'
  | 'ledger'
  | 'fuel'
  | 'power'
  | 'carloan'
  | 'quote'
  | 'meeting-timer'
  | 'bodyfat'
  | 'avatar'
  | 'collage'
  | 'id-photo'
  | 'qr-decode'
  | 'lunar'
  | 'zh-convert'
  | 'pinyin'
  | 'fx-manual'
  | 'salary-inverse'
  | 'worktime'
  | 'wellness'
  | 'random-pick'
  | 'vcard'
  | 'tax'
  | 'loan'
  | 'deposit'
  | 'span'
  | 'age'
  | 'countdown'
  | 'timestamp'
  | 'rmb'
  | 'wordcount'
  | 'dedupe'
  | 'json'
  | 'url'
  | 'base64'
  | 'text-diff'
  | 'hash'
  | 'password'
  | 'photo-edit'
  | 'bmi'
  | 'compress'
  | 'palette'
  | 'nine-grid'
  | 'qr'
  | 'watermark'
  | 'weather'
  | 'qweather'
  | 'web-search'

/** silent：面板内纯函数计算；jump：navigateTo 带参跳转 */
export type WorkflowRouteMode = 'silent' | 'jump'

/** 流转载荷：payload 为真实内容，图片时为本地文件路径 */
export interface IWorkflowData {
  type: WorkflowDataType
  payload: string
  /** 业务上下文：可选，禁止塞对象/数组；由 store 统一 sanitize */
  context?: WorkflowContext
}

export interface WorkflowSession {
  sessionId: string
  data: IWorkflowData
  sourceToolId: WorkflowToolId | ''
  createdAt: number
  expiresAt: number
  consumed: boolean
  bytes: number
}

/** 超过 50KB 时暂存，等待用户二次确认；确认前不产生可消费 session */
export interface WorkflowOversizeDraft {
  sessionId: string
  data: IWorkflowData
  sourceToolId: WorkflowToolId | ''
  bytes: number
  createdAt: number
}

export interface WorkflowBeginSuccess {
  ok: true
  sessionId: string
  bytes: number
}

export interface WorkflowBeginFailure {
  ok: false
  reason: 'empty' | 'unsupported-type' | 'too-large' | 'image-save-failed'
  bytes: number
  sessionId?: string
}

export type WorkflowBeginResult = WorkflowBeginSuccess | WorkflowBeginFailure

export interface WorkflowQuickPipe {
  sourceId: WorkflowToolId
  targetId: WorkflowToolId
  useCount: number
  updatedAt: number
}

export interface WorkflowHistoryEntry {
  id: string
  createdAt: number
  toolIds: WorkflowToolId[]
  initial: IWorkflowData
  final: IWorkflowData
  summary: string
}

export interface WorkflowPipelineStep {
  toolId: WorkflowToolId
  toolName: string
  ok: boolean
  output: string
  error: string
  elapsedMs: number
}

export interface WorkflowPipelineSuccess {
  ok: true
  steps: WorkflowPipelineStep[]
  initial: IWorkflowData
  output: IWorkflowData
  toolIds: WorkflowToolId[]
  totalMs: number
}

export interface WorkflowPipelineFailure {
  ok: false
  steps: WorkflowPipelineStep[]
  initial: IWorkflowData
  partial: IWorkflowData
  failedAt: WorkflowToolId | ''
  failedName: string
  error: string
  toolIds: WorkflowToolId[]
  totalMs: number
}

export type WorkflowPipelineResult = WorkflowPipelineSuccess | WorkflowPipelineFailure

/** 跳转类工具的待消费上下文：sessionId 防串台，超时自动失效 */
export interface WorkflowPendingJump {
  sessionId: string
  toolId: WorkflowToolId
  sourceToolId: WorkflowToolId | ''
  bytes: number
  createdAt: number
  expiresAt: number
}

export interface WorkflowJumpSuccess {
  ok: true
  sessionId: string
  toolId: WorkflowToolId
  bytes: number
  data: IWorkflowData
}

export interface WorkflowJumpFailure {
  ok: false
  reason: 'no-session' | 'expired' | 'not-jump' | 'incompatible' | 'invalid-tool'
}

export type WorkflowJumpResult = WorkflowJumpSuccess | WorkflowJumpFailure

/**
 * 注入撤销帧：字段级精准回滚
 * - fields：注入 + 自动计算前后真正发生变化的字段旧值
 * - applied：注入完成时这些字段的新值，用于识别用户是否又手动改过
 */
export interface WorkflowInjectionUndo {
  toolId: WorkflowToolId
  sessionId: string
  createdAt: number
  data: IWorkflowData
  fields: Record<string, unknown>
  applied: Record<string, unknown>
}

export interface WorkflowConsumption {
  sessionId: string
  data: IWorkflowData
  sourceToolId: WorkflowToolId | ''
}
