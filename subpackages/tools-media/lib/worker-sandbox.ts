/* ==========================================================================
   worker-sandbox · 小程序 Worker 计算沙箱
   - 平台硬限制：同一时刻最多 1 个 Worker（官方文档）
   - 因此采用「单 Worker + 优先级队列 + 超时 + 取消 + 主线程降级」的高吞吐模型
   - 支持长文本统计、按行去重、UTF-8 Base64、双种子 FNV-1a 校验
   - Worker 入口：workers/compute.js，需在 app.json 配置 "workers": "workers"
   ========================================================================== */

export type WorkerSandboxErrorCode =
  | 'UNAVAILABLE'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'QUEUE_FULL'
  | 'WORKER_ERROR'
  | 'INVALID_RESPONSE'
  | 'DISPOSED'

export interface TextStatsInput {
  text: string
}

export interface TextStatsResult {
  codePoints: number
  noSpace: number
  chinese: number
  words: number
  numberRuns: number
  lines: number
  nonEmptyLines: number
  paragraphs: number
  maxLineLength: number
  readingMinutes: number
}

export interface DedupeInput {
  text: string
  dropEmpty: boolean
  trimLines: boolean
  ignoreCase: boolean
  sort: 'none' | 'asc' | 'desc' | 'length'
}

export interface DedupeResult {
  text: string
  originalLines: number
  emptyLines: number
  duplicateLines: number
  resultLines: number
}

export interface Base64Input {
  text: string
}

export interface Base64Result {
  base64: string
  bytes: number
}

export interface ChecksumInput {
  text: string
}

export interface ChecksumResult {
  hash: string
  length: number
}

export interface ChunkTextInput {
  text: string
  /** 每段码点长度，默认 4096，范围 256–65536 */
  chunkSize?: number
  /** 相邻段重叠码点数，默认 0，最大为 chunkSize / 2 */
  overlap?: number
}

export interface TextChunk {
  index: number
  start: number
  end: number
  preview: string
}

export interface ChunkTextResult {
  chunks: TextChunk[]
  total: number
  chunkSize: number
  overlap: number
}

export interface NineGridPlanInput {
  width: number
  height: number
  columns?: number
  rows?: number
}

export interface NineGridPlanResult {
  side: number
  cell: number
  columns: number
  rows: number
  offsetsX: number[]
  offsetsY: number[]
  count: number
}

export interface WorkerTaskMap {
  'text-stats': { input: TextStatsInput; output: TextStatsResult }
  dedupe: { input: DedupeInput; output: DedupeResult }
  'base64-encode': { input: Base64Input; output: Base64Result }
  checksum: { input: ChecksumInput; output: ChecksumResult }
  'chunk-text': { input: ChunkTextInput; output: ChunkTextResult }
  'nine-grid-plan': { input: NineGridPlanInput; output: NineGridPlanResult }
}

export type WorkerTaskName = keyof WorkerTaskMap
export type WorkerTaskInput = WorkerTaskMap[WorkerTaskName]['input']
export type WorkerTaskOutput = WorkerTaskMap[WorkerTaskName]['output']

export interface WorkerRunOptions {
  /** 单任务超时，ms；默认 15000 */
  timeout?: number
  /** 队列优先级，越大越先执行；默认 0 */
  priority?: number
  /** 进度回调 0–1 */
  onProgress?: (progress: number) => void
}

export interface WorkerSandboxConfig {
  /** Worker 入口，默认 workers/compute.js */
  scriptPath?: string
  /** 单任务默认超时 */
  timeout?: number
  /** 队列上限 */
  maxQueue?: number
  /** Worker 不可用时是否主线程降级，默认 true */
  fallbackToMainThread?: boolean
}

export interface WorkerSandboxStatus {
  runningTaskId: string | null
  queued: number
  unavailable: boolean
  disposed: boolean
}

export interface WorkerTaskHandle<T> {
  id: string
  promise: Promise<T>
  cancel: () => boolean
}

export class WorkerSandboxError extends Error {
  readonly code: WorkerSandboxErrorCode
  readonly taskId: string

  constructor(code: WorkerSandboxErrorCode, message: string, taskId = '') {
    super(message)
    this.name = 'WorkerSandboxError'
    this.code = code
    this.taskId = taskId
  }
}

interface WorkerProgressMessage {
  kind: 'progress'
  id: string
  progress: number
}

interface WorkerDoneMessage {
  kind: 'done'
  id: string
  ok: boolean
  data?: unknown
  error?: {
    code: string
    message: string
  }
}

type WorkerResponse = WorkerProgressMessage | WorkerDoneMessage

interface PendingTask {
  id: string
  task: WorkerTaskName
  payload: WorkerTaskInput
  priority: number
  createdAt: number
  timeout: number
  resolve: (value: unknown) => void
  reject: (error: WorkerSandboxError) => void
  onProgress?: (progress: number) => void
  timer: number
}

const DEFAULT_SCRIPT_PATH = 'workers/compute.js'
const DEFAULT_TIMEOUT = 15000
const DEFAULT_MAX_QUEUE = 8

let taskSequence = 0

function nextTaskId(): string {
  taskSequence += 1
  return `worker-task-${taskSequence}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isWorkerResponse(value: unknown): value is WorkerResponse {
  if (!isRecord(value)) {
    return false
  }
  if (value.kind === 'progress') {
    return typeof value.id === 'string' && typeof value.progress === 'number'
  }
  if (value.kind === 'done') {
    if (typeof value.id !== 'string' || typeof value.ok !== 'boolean') {
      return false
    }
    if (value.ok) {
      return true
    }
    return isRecord(value.error) && typeof value.error.message === 'string'
  }
  return false
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.min(1, Math.max(0, value))
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  try {
    return JSON.stringify(error)
  } catch {
    return '未知错误'
  }
}

/* ---- 主线程降级实现 ---- */

function fallbackTextStats(input: TextStatsInput): TextStatsResult {
  const text = input.text
  let codePoints = 0
  let noSpace = 0
  let chinese = 0
  let words = 0
  let numberRuns = 0
  let lines = 1
  let nonEmptyLines = 0
  let paragraphs = 0
  let maxLineLength = 0
  let inWord = false
  let inDigits = false
  let lineHasContent = false
  let inParagraph = false
  let lineLength = 0

  for (const char of text) {
    codePoints += 1
    const code = char.codePointAt(0) ?? 0
    const isSpace =
      code === 32 ||
      (code >= 9 && code <= 13) ||
      code === 160 ||
      code === 5760 ||
      (code >= 8192 && code <= 8202) ||
      code === 8232 ||
      code === 8233 ||
      code === 8239 ||
      code === 8287 ||
      code === 12288 ||
      code === 65279

    if (!isSpace) {
      noSpace += 1
      lineHasContent = true
    }

    if (
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0xf900 && code <= 0xfaff)
    ) {
      chinese += 1
    }

    const isAsciiLetter = (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
    const isConnector = code === 39 || code === 8217 || code === 45
    if (isAsciiLetter) {
      if (!inWord) {
        words += 1
        inWord = true
      }
    } else if (!(isConnector && inWord)) {
      inWord = false
    }

    const isDigit = code >= 48 && code <= 57
    if (isDigit) {
      if (!inDigits) {
        numberRuns += 1
        inDigits = true
      }
    } else {
      inDigits = false
    }

    if (code === 10) {
      lines += 1
      if (lineHasContent) {
        nonEmptyLines += 1
        if (!inParagraph) {
          paragraphs += 1
          inParagraph = true
        }
      } else {
        inParagraph = false
      }
      lineHasContent = false
      lineLength = 0
    } else {
      lineLength += 1
      if (lineLength > maxLineLength) {
        maxLineLength = lineLength
      }
    }
  }

  if (lineHasContent) {
    nonEmptyLines += 1
    if (!inParagraph) {
      paragraphs += 1
    }
  }

  return {
    codePoints,
    noSpace,
    chinese,
    words,
    numberRuns,
    lines,
    nonEmptyLines,
    paragraphs,
    maxLineLength,
    readingMinutes: Math.max(1, Math.ceil((chinese + words * 2) / 300)),
  }
}

function fallbackDedupe(input: DedupeInput): DedupeResult {
  const rawLines = input.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const originalLines = rawLines.length
  const emptyLines = rawLines.filter((line) => !line.trim()).length
  let lines = rawLines.map((line) => (input.trimLines ? line.trim() : line))

  if (input.dropEmpty) {
    lines = lines.filter((line) => line.trim() !== '')
  }

  const seen = new Set<string>()
  let duplicateLines = 0
  const deduped: string[] = []

  lines.forEach((line) => {
    const key = input.ignoreCase ? line.toLowerCase() : line
    if (seen.has(key)) {
      duplicateLines += 1
      return
    }
    seen.add(key)
    deduped.push(line)
  })

  let output = deduped
  if (input.sort === 'asc') {
    output = [...output].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
  } else if (input.sort === 'desc') {
    output = [...output].sort((left, right) => (left > right ? -1 : left < right ? 1 : 0))
  } else if (input.sort === 'length') {
    output = [...output].sort((left, right) => left.length - right.length)
  }

  return {
    text: output.join('\n'),
    originalLines,
    emptyLines,
    duplicateLines,
    resultLines: output.length,
  }
}

function utf8Bytes(text: string): number[] {
  const bytes: number[] = []
  for (const char of text) {
    const code = char.codePointAt(0)
    if (code === undefined) {
      continue
    }
    if (code < 0x80) {
      bytes.push(code)
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      )
    }
  }
  return bytes
}

function bytesToBase64(bytes: number[]): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const b1 = bytes[index]
    const b2 = bytes[index + 1]
    const b3 = bytes[index + 2]
    out += alphabet[b1 >> 2]
    out += alphabet[((b1 & 0x03) << 4) | ((b2 ?? 0) >> 4)]
    out += b2 === undefined ? '=' : alphabet[((b2 & 0x0f) << 2) | ((b3 ?? 0) >> 6)]
    out += b3 === undefined ? '=' : alphabet[b3 & 0x3f]
  }
  return out
}

function fallbackBase64(input: Base64Input): Base64Result {
  const bytes = utf8Bytes(input.text)
  return {
    base64: bytesToBase64(bytes),
    bytes: bytes.length,
  }
}

function fnv1a(text: string, seed: number): number {
  let hash = seed >>> 0
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = (hash * 0x01000193) >>> 0
  }
  return hash >>> 0
}

function fallbackChecksum(input: ChecksumInput): ChecksumResult {
  const first = fnv1a(input.text, 0x811c9dc5)
  const second = fnv1a(input.text, 0x7f4a7c15)
  const hex = (value: number): string => value.toString(16).padStart(8, '0')
  return {
    hash: `${hex(first)}${hex(second)}`,
    length: input.text.length,
  }
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  return Math.min(max, Math.max(min, Math.floor(value)))
}

function fallbackChunkText(input: ChunkTextInput): ChunkTextResult {
  const text = input.text
  const chunkSize = clampInteger(input.chunkSize, 256, 65536, 4096)
  const overlap = clampInteger(input.overlap, 0, Math.floor(chunkSize / 2), 0)
  const step = Math.max(1, chunkSize - overlap)
  const chunks: TextChunk[] = []
  let start = 0
  let index = 0

  while (start < text.length || (text.length === 0 && index === 0)) {
    const end = Math.min(text.length, start + chunkSize)
    chunks.push({
      index,
      start,
      end,
      preview: text.slice(start, Math.min(end, start + 80)),
    })
    index += 1
    if (end >= text.length) {
      break
    }
    start += step
  }

  return {
    chunks,
    total: chunks.length,
    chunkSize,
    overlap,
  }
}

function fallbackNineGridPlan(input: NineGridPlanInput): NineGridPlanResult {
  const width = Math.max(0, Math.floor(input.width))
  const height = Math.max(0, Math.floor(input.height))
  const columns = clampInteger(input.columns, 1, 12, 3)
  const rows = clampInteger(input.rows, 1, 12, 3)
  const side = Math.min(width, height)
  const cell = Math.floor(side / Math.max(columns, rows))
  const offsetsX: number[] = []
  const offsetsY: number[] = []
  const originX = Math.floor((width - side) / 2)
  const originY = Math.floor((height - side) / 2)

  for (let column = 0; column < columns; column += 1) {
    offsetsX.push(originX + column * cell)
  }
  for (let row = 0; row < rows; row += 1) {
    offsetsY.push(originY + row * cell)
  }

  return {
    side,
    cell,
    columns,
    rows,
    offsetsX,
    offsetsY,
    count: columns * rows,
  }
}

function runFallbackTask<K extends WorkerTaskName>(
  task: K,
  payload: WorkerTaskMap[K]['input'],
): WorkerTaskMap[K]['output'] {
  if (task === 'text-stats') {
    return fallbackTextStats(payload as TextStatsInput) as WorkerTaskMap[K]['output']
  }
  if (task === 'dedupe') {
    return fallbackDedupe(payload as DedupeInput) as WorkerTaskMap[K]['output']
  }
  if (task === 'base64-encode') {
    return fallbackBase64(payload as Base64Input) as WorkerTaskMap[K]['output']
  }
  if (task === 'chunk-text') {
    return fallbackChunkText(payload as ChunkTextInput) as WorkerTaskMap[K]['output']
  }
  if (task === 'nine-grid-plan') {
    return fallbackNineGridPlan(payload as NineGridPlanInput) as WorkerTaskMap[K]['output']
  }
  return fallbackChecksum(payload as ChecksumInput) as WorkerTaskMap[K]['output']
}

/* ---- 沙箱 ---- */

export class WorkerSandbox {
  private readonly scriptPath: string
  private readonly defaultTimeout: number
  private readonly maxQueue: number
  private readonly fallbackToMainThread: boolean

  private worker: WechatMiniprogram.Worker | null = null
  private running: PendingTask | null = null
  private queue: PendingTask[] = []
  private unavailable = false
  private disposed = false

  constructor(config: WorkerSandboxConfig = {}) {
    this.scriptPath = config.scriptPath || DEFAULT_SCRIPT_PATH
    this.defaultTimeout = Math.max(0, config.timeout ?? DEFAULT_TIMEOUT)
    this.maxQueue = Math.max(1, Math.floor(config.maxQueue ?? DEFAULT_MAX_QUEUE))
    this.fallbackToMainThread = config.fallbackToMainThread !== false
  }

  /** 预创建 Worker；失败时标记不可用并返回 false */
  warmup(): boolean {
    return this.ensureWorker() !== null
  }

  getStatus(): WorkerSandboxStatus {
    return {
      runningTaskId: this.running ? this.running.id : null,
      queued: this.queue.length,
      unavailable: this.unavailable,
      disposed: this.disposed,
    }
  }

  runTask<K extends WorkerTaskName>(
    task: K,
    payload: WorkerTaskMap[K]['input'],
    options: WorkerRunOptions = {},
  ): Promise<WorkerTaskMap[K]['output']> {
    return this.runTaskHandle(task, payload, options).promise
  }

  /** 带任务句柄：可拿到 id 并定向取消 */
  runTaskHandle<K extends WorkerTaskName>(
    task: K,
    payload: WorkerTaskMap[K]['input'],
    options: WorkerRunOptions = {},
  ): WorkerTaskHandle<WorkerTaskMap[K]['output']> {
    const id = nextTaskId()
    const cancel = (): boolean => this.cancel(id)

    if (this.disposed) {
      return {
        id,
        cancel,
        promise: Promise.reject(
          new WorkerSandboxError('DISPOSED', '计算沙箱已销毁', id),
        ),
      }
    }

    if (!this.canUseWorker()) {
      if (this.fallbackToMainThread) {
        return {
          id,
          cancel,
          promise: Promise.resolve().then(() => runFallbackTask(task, payload)),
        }
      }
      return {
        id,
        cancel,
        promise: Promise.reject(
          new WorkerSandboxError('UNAVAILABLE', 'Worker 不可用', id),
        ),
      }
    }

    if (this.queue.length >= this.maxQueue) {
      return {
        id,
        cancel,
        promise: Promise.reject(
          new WorkerSandboxError('QUEUE_FULL', '计算队列已满，请稍后再试', id),
        ),
      }
    }

    const promise = new Promise<WorkerTaskMap[K]['output']>((resolve, reject) => {
      const pending: PendingTask = {
        id,
        task,
        payload,
        priority: options.priority ?? 0,
        createdAt: Date.now(),
        timeout: Math.max(0, options.timeout ?? this.defaultTimeout),
        resolve: (value: unknown) => {
          resolve(value as WorkerTaskMap[K]['output'])
        },
        reject,
        onProgress: options.onProgress,
        timer: 0,
      }
      this.queue.push(pending)
      this.sortQueue()
      this.dispatch()
    })

    return { id, cancel, promise }
  }

  cancel(taskId: string): boolean {
    const queueIndex = this.queue.findIndex((task) => task.id === taskId)
    if (queueIndex >= 0) {
      const [task] = this.queue.splice(queueIndex, 1)
      if (task) {
        task.reject(new WorkerSandboxError('CANCELLED', '任务已取消', task.id))
      }
      return true
    }

    if (this.running && this.running.id === taskId) {
      const task = this.running
      this.running = null
      this.clearTaskTimer(task)
      this.terminateWorker()
      task.reject(new WorkerSandboxError('CANCELLED', '任务已取消', task.id))
      this.dispatch()
      return true
    }

    return false
  }

  cancelAll(): void {
    const queued = [...this.queue]
    this.queue = []
    queued.forEach((task) => {
      task.reject(new WorkerSandboxError('CANCELLED', '任务已取消', task.id))
    })

    if (this.running) {
      const task = this.running
      this.running = null
      this.clearTaskTimer(task)
      this.terminateWorker()
      task.reject(new WorkerSandboxError('CANCELLED', '任务已取消', task.id))
    }
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.cancelAll()
    this.disposed = true
    this.terminateWorker()
    this.queue = []
  }

  private canUseWorker(): boolean {
    return !this.unavailable && typeof wx.createWorker === 'function'
  }

  private sortQueue(): void {
    this.queue.sort((left, right) => {
      if (right.priority !== left.priority) {
        return right.priority - left.priority
      }
      return left.createdAt - right.createdAt
    })
  }

  private ensureWorker(): WechatMiniprogram.Worker | null {
    if (this.worker) {
      return this.worker
    }
    if (typeof wx.createWorker !== 'function') {
      this.unavailable = true
      return null
    }

    try {
      const worker = wx.createWorker(this.scriptPath)
      worker.onMessage((result: WechatMiniprogram.WorkerOnMessageListenerResult) => {
        this.handleMessage(result.message as unknown)
      })
      this.worker = worker
      return worker
    } catch (error) {
      this.unavailable = true
      return null
    }
  }

  private terminateWorker(): void {
    if (!this.worker) {
      return
    }
    try {
      this.worker.terminate()
    } catch {
      /* 已终止时忽略 */
    }
    this.worker = null
  }

  private dispatch(): void {
    if (this.disposed) {
      return
    }
    if (this.running || this.queue.length === 0) {
      return
    }

    const worker = this.ensureWorker()
    if (!worker) {
      this.flushFallbackQueue()
      return
    }

    const task = this.queue.shift()
    if (!task) {
      return
    }

    this.running = task
    if (task.timeout > 0) {
      task.timer = setTimeout(() => {
        if (!this.running || this.running.id !== task.id) {
          return
        }
        this.running = null
        this.clearTaskTimer(task)
        this.terminateWorker()
        task.reject(
          new WorkerSandboxError(
            'TIMEOUT',
            `计算超时（${task.timeout}ms）`,
            task.id,
          ),
        )
        this.dispatch()
      }, task.timeout) as unknown as number
    }

    try {
      worker.postMessage({
        kind: 'task',
        id: task.id,
        task: task.task,
        payload: task.payload,
      })
    } catch (error) {
      this.running = null
      this.clearTaskTimer(task)
      this.terminateWorker()
      task.reject(
        new WorkerSandboxError('WORKER_ERROR', toErrorMessage(error), task.id),
      )
      this.dispatch()
    }
  }

  private handleMessage(message: unknown): void {
    if (!isWorkerResponse(message)) {
      return
    }
    if (!this.running || this.running.id !== message.id) {
      return
    }

    const task = this.running

    if (message.kind === 'progress') {
      if (typeof task.onProgress === 'function') {
        try {
          task.onProgress(clampProgress(message.progress))
        } catch {
          /* 进度回调异常不影响任务 */
        }
      }
      return
    }

    this.running = null
    this.clearTaskTimer(task)

    if (message.ok) {
      task.resolve(message.data)
    } else {
      const errorMessage = message.error?.message || 'Worker 计算失败'
      const errorCode = message.error?.code || 'WORKER_ERROR'
      task.reject(
        new WorkerSandboxError(
          errorCode === 'TIMEOUT' ? 'TIMEOUT' : 'WORKER_ERROR',
          errorMessage,
          task.id,
        ),
      )
    }

    this.dispatch()
  }

  private clearTaskTimer(task: PendingTask): void {
    if (task.timer) {
      clearTimeout(task.timer)
      task.timer = 0
    }
  }

  private flushFallbackQueue(): void {
    const queued = [...this.queue]
    this.queue = []
    queued.forEach((task) => {
      if (!this.fallbackToMainThread) {
        task.reject(
          new WorkerSandboxError('UNAVAILABLE', 'Worker 不可用', task.id),
        )
        return
      }
      Promise.resolve()
        .then(() => runFallbackTask(task.task, task.payload))
        .then((value) => task.resolve(value))
        .catch((error: unknown) => {
          task.reject(
            new WorkerSandboxError(
              'WORKER_ERROR',
              toErrorMessage(error),
              task.id,
            ),
          )
        })
    })
  }
}

/** 默认沙箱：workers/compute.js + 15s 超时 + 主线程降级 */
export const workerSandbox = new WorkerSandbox()

export function computeTextStats(
  text: string,
  options: WorkerRunOptions = {},
): Promise<TextStatsResult> {
  return workerSandbox.runTask('text-stats', { text }, options)
}

export function dedupeInWorker(
  input: DedupeInput,
  options: WorkerRunOptions = {},
): Promise<DedupeResult> {
  return workerSandbox.runTask('dedupe', input, options)
}

export function base64EncodeInWorker(
  text: string,
  options: WorkerRunOptions = {},
): Promise<Base64Result> {
  return workerSandbox.runTask('base64-encode', { text }, options)
}

export function checksumInWorker(
  text: string,
  options: WorkerRunOptions = {},
): Promise<ChecksumResult> {
  return workerSandbox.runTask('checksum', { text }, options)
}

/** 长文本切片：把超大文本拆成 Worker 可逐步处理的段 */
export function chunkTextInWorker(
  input: ChunkTextInput,
  options: WorkerRunOptions = {},
): Promise<ChunkTextResult> {
  return workerSandbox.runTask('chunk-text', input, options)
}

/** 九宫格几何计划：居中正方形、列行偏移与数量 */
export function planNineGridInWorker(
  input: NineGridPlanInput,
  options: WorkerRunOptions = {},
): Promise<NineGridPlanResult> {
  return workerSandbox.runTask('nine-grid-plan', input, options)
}
