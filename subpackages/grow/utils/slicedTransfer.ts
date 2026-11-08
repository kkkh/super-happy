/* ==========================================================================
   slicedTransfer · 分片剪贴板跨端传输协议
   - 纯文本协议：[Part 1/5] CSOS1|sid|index|total|fullCrc|partCrc|jsonChunk
   - 分片可乱序 / 重复粘贴；每片独立校验，缺片时明确报告
   - 全部到齐后校验整包 CRC32，验签失败拒绝重组
   - 不使用 Buffer / Base64，微信剪贴板与真机输入法均可安全承载
   ========================================================================== */

import { crc32Hex } from '../../../core/toolbox/crc32'

export interface TransferPart {
  sessionId: string
  index: number
  total: number
  signature: string
  partSignature: string
  chunk: string
  text: string
}

export interface TransferPackage {
  sessionId: string
  total: number
  signature: string
  parts: string[]
  originalChars: number
}

export type TransferStatus = 'need-more' | 'complete' | 'duplicate' | 'error'

export interface TransferState {
  sessionId: string
  total: number
  signature: string
  chunks: Record<number, string>
  received: number
  completed: boolean
}

export interface TransferAppendResult {
  status: TransferStatus
  sessionId: string
  received: number
  total: number
  missing: number[]
  payload: string
  message: string
}

export interface TransferOptions {
  /** 单片最大字符数；默认 700，给微信剪贴板留足冗余 */
  chunkSize?: number
  /** 最大分片数；默认 64 */
  maxParts?: number
  /** 测试注入固定 sessionId */
  sessionId?: string
}

const HEADER = 'CSOS1'
const MAX_CHUNK_TEXT = 4096
const PART_PATTERN =
  /^\[Part (\d+)\/(\d+)\] CSOS1\|([A-Za-z0-9_-]{1,48})\|(\d+)\|(\d+)\|([0-9a-f]{8})\|([0-9a-f]{8})\|(.+)$/

function makeSessionId(payload: string): string {
  const seed = crc32Hex(payload)
  const salt = Date.now().toString(36).slice(-6)
  return `${seed.slice(0, 4)}_${salt}`
}

export function createTransfer(
  payload: string,
  options: TransferOptions = {},
): TransferPackage | null {
  if (typeof payload !== 'string' || payload.length === 0) {
    return null
  }
  const chunkSize = Math.max(80, Math.min(2000, Math.floor(options.chunkSize || 700)))
  const maxParts = Math.max(1, Math.min(128, Math.floor(options.maxParts || 64)))
  const chars = Array.from(payload)
  const total = Math.ceil(chars.length / chunkSize)
  if (total > maxParts) {
    return null
  }
  const sessionId = options.sessionId || makeSessionId(payload)
  if (!/^[A-Za-z0-9_-]{1,48}$/.test(sessionId)) {
    return null
  }
  const signature = crc32Hex(payload)
  const parts: string[] = []

  for (let index = 1; index <= total; index += 1) {
    const chunk = chars.slice((index - 1) * chunkSize, index * chunkSize).join('')
    const partSignature = crc32Hex(chunk)
    const jsonChunk = JSON.stringify(chunk)
    parts.push(
      `[Part ${index}/${total}] ${HEADER}|${sessionId}|${index}|${total}|${signature}|${partSignature}|${jsonChunk}`,
    )
  }

  return {
    sessionId,
    total,
    signature,
    parts,
    originalChars: chars.length,
  }
}

export function parseTransferPart(text: string): TransferPart | null {
  if (typeof text !== 'string') {
    return null
  }
  const match = text.trim().match(PART_PATTERN)
  if (!match) {
    return null
  }
  const index = Number(match[1])
  const total = Number(match[2])
  const sessionId = match[3]
  const bodyIndex = Number(match[4])
  const bodyTotal = Number(match[5])
  const signature = match[6]
  const partSignature = match[7]
  const jsonChunk = match[8]

  if (
    !Number.isInteger(index) ||
    !Number.isInteger(total) ||
    index < 1 ||
    total < 1 ||
    index > total ||
    total > 128 ||
    bodyIndex !== index ||
    bodyTotal !== total
  ) {
    return null
  }
  if (jsonChunk.length > MAX_CHUNK_TEXT) {
    return null
  }
  let chunk = ''
  try {
    const parsed = JSON.parse(jsonChunk)
    if (typeof parsed !== 'string') {
      return null
    }
    chunk = parsed
  } catch {
    return null
  }
  if (crc32Hex(chunk) !== partSignature) {
    return null
  }
  return {
    sessionId,
    index,
    total,
    signature,
    partSignature,
    chunk,
    text: text.trim(),
  }
}

export function createTransferState(
  sessionId: string,
  total: number,
  signature: string,
): TransferState {
  return {
    sessionId,
    total,
    signature,
    chunks: {},
    received: 0,
    completed: false,
  }
}

function result(
  state: TransferState,
  status: TransferStatus,
  message: string,
  payload = '',
): TransferAppendResult {
  const missing: number[] = []
  for (let index = 1; index <= state.total; index += 1) {
    if (!state.chunks[index]) {
      missing.push(index)
    }
  }
  return {
    status,
    sessionId: state.sessionId,
    received: state.received,
    total: state.total,
    missing,
    payload,
    message,
  }
}

/**
 * 追加一片：允许乱序与重复粘贴；
 * 任何校验失败都返回 error，绝不把损坏数据静默拼进结果。
 */
export function appendTransferPart(
  state: TransferState | null,
  text: string,
): { state: TransferState | null; result: TransferAppendResult } {
  const part = parseTransferPart(text)
  if (!part) {
    return {
      state,
      result: {
        status: 'error',
        sessionId: state ? state.sessionId : '',
        received: state ? state.received : 0,
        total: state ? state.total : 0,
        missing: [],
        payload: '',
        message: '分片格式或片内校验失败',
      },
    }
  }

  const current = state || createTransferState(part.sessionId, part.total, part.signature)
  if (current.completed) {
    return {
      state: current,
      result: result(current, 'complete', '该传输已完成', ''),
    }
  }
  if (part.sessionId !== current.sessionId) {
    return {
      state: current,
      result: result(current, 'error', '分片来自另一条传输会话'),
    }
  }
  if (part.total !== current.total || part.signature !== current.signature) {
    return {
      state: current,
      result: result(current, 'error', '分片总数或整包签名不一致'),
    }
  }
  const existing = current.chunks[part.index]
  if (existing !== undefined) {
    if (existing !== part.chunk) {
      return {
        state: current,
        result: result(current, 'error', '同一分片出现不同内容'),
      }
    }
    return {
      state: current,
      result: result(current, 'duplicate', `第 ${part.index} 片已存在，已忽略`),
    }
  }

  current.chunks[part.index] = part.chunk
  current.received += 1

  if (current.received < current.total) {
    return {
      state: current,
      result: result(current, 'need-more', `已接收 ${current.received}/${current.total} 片`),
    }
  }

  const payload = Array.from({ length: current.total }, (_, index) => {
      return current.chunks[index + 1] ?? ''
    }).join('')
  if (crc32Hex(payload) !== current.signature) {
    return {
      state: current,
      result: result(current, 'error', '整包验签失败，数据可能被截断或污染'),
    }
  }
  current.completed = true
  return {
    state: current,
    result: result(current, 'complete', '全部分片校验通过，已重组', payload),
  }
}

export function resetTransfer(): TransferState | null {
  return null
}

/** 人类可读的片段标签，供 UI 直接渲染 */
export function partLabel(part: TransferPart): string {
  return `Part ${part.index}/${part.total} · ${part.chunk.length} 字符`
}
