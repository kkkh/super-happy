/* ==========================================================================
   export · 结果导出（纯本机、用户主动分享）
   - 文件写在 USER_DATA_PATH/exports，不上传、不扫描
   - 分享必须由用户 tap 同步触发：先 prepare 预写，tap 时只调 sharePrepared
   - 低版本无 shareFileMessage 时由调用方隐藏入口，仅保留复制
   ========================================================================== */

export type ExportFormat = 'txt' | 'md' | 'csv' | 'json'

export interface ExportRequest {
  filename: string
  content: string
  format: ExportFormat
}

export type ExportFailReason = 'empty' | 'too-large' | 'write-failed' | 'unsupported'

export type ExportPrepareResult =
  | { ok: true; path: string; bytes: number }
  | { ok: false; reason: ExportFailReason }

/** 单文件上限 2MB */
export const MAX_EXPORT_BYTES = 2 * 1024 * 1024
/** 启动清理：超过 24 小时或总量超过 10MB 的旧导出 */
export const EXPORT_MAX_AGE_MS = 24 * 60 * 60 * 1000
export const EXPORT_MAX_TOTAL_BYTES = 10 * 1024 * 1024

const EXPORT_DIR = 'exports'
const TRUNCATED_NAME = 32

/** UTF-8 字节数：避免依赖 Buffer，逐码点计算 */
export function utf8ByteLength(text: string): number {
  let bytes = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code <= 0x7f) {
      bytes += 1
    } else if (code <= 0x7ff) {
      bytes += 2
    } else if (code <= 0xffff) {
      bytes += 3
    } else {
      bytes += 4
    }
  }
  return bytes
}

/** 文件名清洗：去路径分隔与非法字符，截断 32 字符，空名回退 */
export function sanitizeExportName(raw: string, fallback = '超欢导出'): string {
  const cleaned = raw
    .replace(/[/\\:*?"<>|\r\n\t]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TRUNCATED_NAME)
    .replace(/[. ]+$/, '')
  return cleaned || fallback
}

/* CSV 单元转义统一实现在 core/toolbox/engines/csv.ts，此处保留导出兼容 */
export { escapeCsvCell } from '../toolbox/engines/csv'

/** 组装最终写盘内容：CSV 补 UTF-8 BOM，保证 Excel 中文不乱码 */
export function buildExportContent(content: string, format: ExportFormat): string {
  if (format === 'csv') {
    return `\uFEFF${content}`
  }
  return content
}

function fsManager(): WechatMiniprogram.FileSystemManager | undefined {
  try {
    return wx.getFileSystemManager()
  } catch {
    return undefined
  }
}

function exportDirPath(): string {
  return `${wx.env.USER_DATA_PATH}/${EXPORT_DIR}`
}

/** 当前基础库是否支持文件分享 */
export function canShareFile(): boolean {
  return typeof (wx as unknown as { shareFileMessage?: unknown }).shareFileMessage === 'function'
}

function ensureDir(manager: WechatMiniprogram.FileSystemManager): void {
  const dir = exportDirPath()
  try {
    manager.accessSync(dir)
  } catch {
    try {
      manager.mkdirSync(dir, true)
    } catch {
      /* 已存在或并发创建：写入阶段再兜底 */
    }
  }
}

/**
 * 异步预写导出文件。必须在结果生成后调用，不要放在 tap 回调里；
 * 2MB 内容同步写会阻塞主线程，因此统一走 writeFile 异步。
 * 返回 path 后，用户 tap 时直接 sharePrepared(path)。
 */
export function prepareExport(request: ExportRequest): Promise<ExportPrepareResult> {
  const manager = fsManager()
  if (!manager) {
    return Promise.resolve({ ok: false, reason: 'unsupported' })
  }
  const content = buildExportContent(request.content, request.format)
  if (!content.trim()) {
    return Promise.resolve({ ok: false, reason: 'empty' })
  }
  const bytes = utf8ByteLength(content)
  if (bytes > MAX_EXPORT_BYTES) {
    return Promise.resolve({ ok: false, reason: 'too-large' })
  }

  ensureDir(manager)
  const name = `${sanitizeExportName(request.filename)}.${request.format}`
  const path = `${exportDirPath()}/${name}`
  return new Promise((resolve) => {
    try {
      manager.writeFile({
        filePath: path,
        data: content,
        encoding: 'utf8',
        success: () => resolve({ ok: true, path, bytes }),
        fail: () => resolve({ ok: false, reason: 'write-failed' }),
      })
    } catch {
      resolve({ ok: false, reason: 'write-failed' })
    }
  })
}

/** 删除单个预写文件；失败静默，不影响用户流程 */
export function cleanupExport(path: string): void {
  if (!path) {
    return
  }
  const manager = fsManager()
  if (!manager) {
    return
  }
  try {
    manager.unlinkSync(path)
  } catch {
    /* 文件已被清理或不存在 */
  }
}

/** 清空本程序导出的全部文件；只在页面卸载或用户主动清理时调用 */
export function cleanupAllExports(): void {
  const manager = fsManager()
  if (!manager) {
    return
  }
  const dir = exportDirPath()
  try {
    for (const name of manager.readdirSync(dir)) {
      try {
        manager.unlinkSync(`${dir}/${name}`)
      } catch {
        /* 单个失败不阻断其余清理 */
      }
    }
  } catch {
    /* 目录不存在即无需清理 */
  }
}

interface ExportFileInfo {
  path: string
  size: number
  modifiedAt: number
}

function statsOf(raw: unknown): WechatMiniprogram.Stats | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const holder = raw as { stats?: WechatMiniprogram.Stats }
  if (holder.stats && typeof holder.stats === 'object') {
    return holder.stats
  }
  return raw as WechatMiniprogram.Stats
}

/**
 * 启动清理：删除超过 24 小时的导出文件，并在总量超过 10MB 时从最旧开始删除。
 * 同步执行、失败静默；不阻塞首页。
 */
export function cleanupStaleExports(now = Date.now()): void {
  const manager = fsManager()
  if (!manager) {
    return
  }
  const dir = exportDirPath()
  let names: string[] = []
  try {
    names = manager.readdirSync(dir)
  } catch {
    return
  }
  const files: ExportFileInfo[] = []
  for (const name of names) {
    const filePath = `${dir}/${name}`
    try {
      const stats = statsOf(manager.statSync(filePath))
      if (!stats || (typeof stats.isFile === 'function' && !stats.isFile())) {
        continue
      }
      const rawModified = Number(stats.lastModifiedTime)
      const modifiedAt = Number.isFinite(rawModified)
        ? rawModified < 1e12
          ? rawModified * 1000
          : rawModified
        : 0
      files.push({
        path: filePath,
        size: Number(stats.size) || 0,
        modifiedAt,
      })
    } catch {
      /* 单个文件读取失败不阻断清理 */
    }
  }

  let total = files.reduce((sum, file) => sum + file.size, 0)
  for (const file of files.sort((left, right) => left.modifiedAt - right.modifiedAt)) {
    const expired = file.modifiedAt > 0 && now - file.modifiedAt > EXPORT_MAX_AGE_MS
    if (expired || total > EXPORT_MAX_TOTAL_BYTES) {
      cleanupExport(file.path)
      total -= file.size
    }
  }
}

export type ShareOutcome = 'shared' | 'cancelled' | 'unsupported' | 'failed'

/**
 * 分享已预写的文件。必须在用户 tap 的同步调用栈内执行，
 * 不得先 await 任何异步操作，否则微信会判定非用户触发。
 */
export function sharePrepared(path: string, filename?: string): Promise<ShareOutcome> {
  if (!path || !canShareFile()) {
    return Promise.resolve('unsupported')
  }
  return new Promise((resolve) => {
    try {
      wx.shareFileMessage({
        filePath: path,
        fileName: filename,
        success: () => resolve('shared'),
        fail: (error) => {
          const message = String((error && error.errMsg) || '')
          resolve(/cancel/i.test(message) ? 'cancelled' : 'failed')
        },
      })
    } catch {
      resolve('failed')
    }
  })
}
