/* ==========================================================================
   diagnostics · 反馈闭环与本地诊断包
   - 只读取版本 / 基础库 / 机型 / 当前路由 / 黑匣最近 20 条
   - 导出前统一脱敏路径、Key、Token、邮箱、手机号与证件号
   - 诊断文件只写 USER_DATA_PATH/exports，不联网、不上传
   ========================================================================== */

import { APP_VERSION, DIAGNOSTICS } from '../constants/index'
import { readStorage } from '../toolbox/storage'
import { prepareExport, utf8ByteLength, type ExportFailReason } from './export'

export const DIAGNOSTIC_MAX_BYTES = 50 * 1024
export const DIAGNOSTIC_MAX_ENTRIES = DIAGNOSTICS.maxEntries
export const DIAGNOSTIC_MESSAGE_LIMIT = DIAGNOSTICS.maxMessageLength
const DIAGNOSTIC_FIELD_LIMIT = 120
const DIAGNOSTIC_KINDS = new Set([
  'app-error',
  'unhandled-rejection',
  'page-not-found',
  'memory-warning',
])

export interface DiagnosticEntryView {
  at: number
  kind: string
  message: string
  route: string
}

export interface DiagnosticEnvironment {
  appVersion: string
  sdkVersion: string
  wechatVersion: string
  deviceModel: string
  system: string
  route: string
  entries: unknown
  now: number
}

export interface DiagnosticPreview {
  text: string
  bytes: number
  entries: number
  dropped: number
}

export type DiagnosticFileResult =
  | { ok: true; path: string; name: string; bytes: number }
  | { ok: false; reason: ExportFailReason }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cleanField(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : ''
  return text ? text.slice(0, DIAGNOSTIC_FIELD_LIMIT) : ''
}

/** 路径、Key、Token、邮箱、手机号与证件号统一脱敏 */
export function redactDiagnosticText(value: string): string {
  let text = typeof value === 'string' ? value : ''
  text = text
    .replace(/(?:file|wxfile|https?):\/\/[^\s"'<>，。；、]+/gi, '<path>')
    .replace(/(?:[A-Za-z]:\\|~\/|\/(?:Users|home|var|private|tmp|opt|Applications)\/)[^\s"'<>，。；、]+/g, '<path>')
    .replace(/wx\.env\.USER_DATA_PATH[^\s"'<>，。；、]*/g, '<path>')
    .replace(/(\bBearer\s+)([A-Za-z0-9._~+/=-]+)/gi, '$1<redacted>')
    .replace(
      /(\b(?:key|token|secret|password|passwd|pwd|api[_-]?key|access[_-]?token)\b\s*[=:]\s*)([^\s&,;]+)/gi,
      '$1<redacted>',
    )
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<redacted>')
    .replace(/\b1[3-9]\d{9}\b/g, '<redacted>')
    .replace(/\b\d{17}[\dXx]\b/g, '<redacted>')
  return text
}

function sanitizeRoute(value: unknown): string {
  const route = typeof value === 'string' ? value.trim() : ''
  if (!route) {
    return ''
  }
  /* 只保留应用内路由；其他路径一律视为本机路径 */
  return /^(pages|subpackages)\/[A-Za-z0-9/_-]+$/.test(route) ? route : '<path>'
}

/** 脱敏后仍像用户输入的记录整条丢弃，不做部分保留 */
export function shouldDropDiagnosticMessage(value: string): boolean {
  const text = typeof value === 'string' ? value : ''
  return [
    /[\w.+-]+@[\w-]+\.[\w.-]+/,
    /\b1[3-9]\d{9}\b/,
    /\b\d{17}[\dXx]\b/,
    /(?:¥|￥|\$)\s?\d/,
    /\d[\d,.]*\s*(?:元|万元|亿元|分|角)/,
    /(?:金额|价格|工资|薪资|余额|本金|利息|税费|保费|报销|姓名|名字|联系人|收件人|用户名|身份证|银行卡|手机号|openid|unionid)\s*[:：]?\s*\S+/i,
    /\b\d{6,}\b/,
  ].some((pattern) => pattern.test(text))
}

export function sanitizeDiagnosticEntries(
  raw: unknown,
  now = Date.now(),
): { entries: DiagnosticEntryView[]; dropped: number } {
  const list = Array.isArray(raw) ? raw : []
  const entries: DiagnosticEntryView[] = []
  let dropped = Math.max(0, list.length - DIAGNOSTIC_MAX_ENTRIES)

  for (const item of list.slice(0, DIAGNOSTIC_MAX_ENTRIES)) {
    if (!isPlainObject(item)) {
      dropped += 1
      continue
    }
    const message = typeof item.message === 'string' ? item.message.trim() : ''
    if (!message) {
      dropped += 1
      continue
    }
    const redacted = redactDiagnosticText(message).slice(0, DIAGNOSTIC_MESSAGE_LIMIT)
    if (!redacted || shouldDropDiagnosticMessage(redacted)) {
      dropped += 1
      continue
    }
    const at = Number(item.at)
    const kind = typeof item.kind === 'string' && DIAGNOSTIC_KINDS.has(item.kind) ? item.kind : 'unknown'
    entries.push({
      at: Number.isFinite(at) && at > 0 ? Math.floor(at) : now,
      kind,
      message: redacted,
      route: sanitizeRoute(item.route),
    })
  }
  return { entries, dropped }
}

export function formatDiagnosticTime(at: number): string {
  if (!Number.isFinite(at) || at <= 0) {
    return ''
  }
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** 固定文件名：超欢诊断-YYYYMMDD-HHmm（prepareExport 会补 .txt） */
export function diagnosticFileName(now = Date.now()): string {
  const date = new Date(now)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `超欢诊断-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}`
}

function truncateToBytes(text: string, limit: number): string {
  if (utf8ByteLength(text) <= limit) {
    return text
  }
  let out = ''
  for (const char of text) {
    if (utf8ByteLength(out + char) > limit) {
      break
    }
    out += char
  }
  return out
}

function buildText(
  env: DiagnosticEnvironment,
  entries: DiagnosticEntryView[],
  dropped: number,
): string {
  const lines: string[] = [
    '超欢诊断包',
    `生成时间：${formatDiagnosticTime(env.now)}`,
    `应用版本：${cleanField(env.appVersion) || '未知'}`,
    `基础库：${cleanField(env.sdkVersion) || '未知'}`,
    `设备：${cleanField(env.deviceModel) || '未知'} / ${cleanField(env.system) || '未知'}${
      cleanField(env.wechatVersion) ? ` / 微信 ${cleanField(env.wechatVersion)}` : ''
    }`,
    `当前路由：${sanitizeRoute(env.route) || '未知'}`,
    '',
    `最近错误（${entries.length} 条，已脱敏）：`,
  ]
  if (entries.length === 0) {
    lines.push('无')
  } else {
    entries.forEach((entry, index) => {
      lines.push(
        `${index + 1}. [${formatDiagnosticTime(entry.at)}] ${entry.kind} · ${entry.route || '未知路由'}`,
      )
      lines.push(`   ${entry.message}`)
    })
  }
  if (dropped > 0) {
    lines.push('', `已丢弃 ${dropped} 条记录（敏感或超限）。`)
  }
  return lines.join('\n')
}

/**
 * 生成预览文本；超过 50KB 时从最旧记录开始丢弃。
 * 纯函数，页面与 Node 测试共用。
 */
export function buildDiagnosticPreview(env: DiagnosticEnvironment): DiagnosticPreview {
  const sanitized = sanitizeDiagnosticEntries(env.entries, env.now)
  const entries = [...sanitized.entries]
  let dropped = sanitized.dropped
  let text = buildText(env, entries, dropped)

  while (utf8ByteLength(text) > DIAGNOSTIC_MAX_BYTES && entries.length > 0) {
    entries.pop()
    dropped += 1
    text = buildText(env, entries, dropped)
  }
  if (utf8ByteLength(text) > DIAGNOSTIC_MAX_BYTES) {
    text = truncateToBytes(text, DIAGNOSTIC_MAX_BYTES)
  }
  return {
    text,
    bytes: utf8ByteLength(text),
    entries: entries.length,
    dropped,
  }
}

function readAppBaseInfo(): { sdkVersion: string; wechatVersion: string } {
  try {
    if (typeof wx.getAppBaseInfo !== 'function') {
      return { sdkVersion: '', wechatVersion: '' }
    }
    const info = wx.getAppBaseInfo()
    return {
      sdkVersion: typeof info.SDKVersion === 'string' ? info.SDKVersion : '',
      wechatVersion: typeof info.version === 'string' ? info.version : '',
    }
  } catch {
    return { sdkVersion: '', wechatVersion: '' }
  }
}

function readDeviceInfo(): { model: string; system: string } {
  try {
    if (typeof wx.getDeviceInfo !== 'function') {
      return { model: '', system: '' }
    }
    const info = wx.getDeviceInfo()
    return {
      model: typeof info.model === 'string' ? info.model : '',
      system: typeof info.system === 'string' ? info.system : '',
    }
  } catch {
    return { model: '', system: '' }
  }
}

function currentRoute(): string {
  try {
    const pages = getCurrentPages()
    return pages[pages.length - 1]?.route ?? ''
  } catch {
    return ''
  }
}

/** 读取设备、版本、当前路由与黑匣，生成完整环境 */
export function collectDiagnosticEnvironment(now = Date.now()): DiagnosticEnvironment {
  const base = readAppBaseInfo()
  const device = readDeviceInfo()
  return {
    appVersion: APP_VERSION,
    sdkVersion: base.sdkVersion,
    wechatVersion: base.wechatVersion,
    deviceModel: device.model,
    system: device.system,
    route: currentRoute(),
    entries: readStorage(DIAGNOSTICS.storageKey),
    now,
  }
}

export function buildDiagnosticPreviewFromDevice(now = Date.now()): DiagnosticPreview {
  return buildDiagnosticPreview(collectDiagnosticEnvironment(now))
}

/** 预览确认后写诊断文件；文件名带时间，文件只落在 exports 目录 */
export async function prepareDiagnosticFile(
  preview: DiagnosticPreview,
  now = Date.now(),
): Promise<DiagnosticFileResult> {
  if (!preview.text.trim()) {
    return { ok: false, reason: 'empty' }
  }
  if (preview.bytes > DIAGNOSTIC_MAX_BYTES) {
    return { ok: false, reason: 'too-large' }
  }
  const baseName = diagnosticFileName(now)
  const result = await prepareExport({
    filename: baseName,
    content: preview.text,
    format: 'txt',
  })
  if (!result.ok) {
    return { ok: false, reason: result.reason }
  }
  return {
    ok: true,
    path: result.path,
    name: `${baseName}.txt`,
    bytes: result.bytes,
  }
}
