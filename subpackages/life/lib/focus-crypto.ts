/* ==========================================================================
   focus-crypto · 全息专注引擎本机存证
   - 自带 SHA-256 / HMAC-SHA256，不依赖 crypto-js / Node crypto
   - canonical payload 与《最终版方案》附录 B.3 一致
   - 纯函数：不调用 wx / DOM，可直接单元测试
   ========================================================================== */
import type {
  FocusRecord,
  FocusRecordCheck,
  FocusStats,
  FocusSession,
} from './focus-types'

/** SHA-256 初始 Hash */
const SHA256_H = new Uint32Array([
  0x6a09e667,
  0xbb67ae85,
  0x3c6ef372,
  0xa54ff53a,
  0x510e527f,
  0x9b05688c,
  0x1f83d9ab,
  0x5be0cd19,
])

/** SHA-256 轮常数 */
const SHA256_K = new Uint32Array([
  0x428a2f98,
  0x71374491,
  0xb5c0fbcf,
  0xe9b5dba5,
  0x3956c25b,
  0x59f111f1,
  0x923f82a4,
  0xab1c5ed5,
  0xd807aa98,
  0x12835b01,
  0x243185be,
  0x550c7dc3,
  0x72be5d74,
  0x80deb1fe,
  0x9bdc06a7,
  0xc19bf174,
  0xe49b69c1,
  0xefbe4786,
  0x0fc19dc6,
  0x240ca1cc,
  0x2de92c6f,
  0x4a7484aa,
  0x5cb0a9dc,
  0x76f988da,
  0x983e5152,
  0xa831c66d,
  0xb00327c8,
  0xbf597fc7,
  0xc6e00bf3,
  0xd5a79147,
  0x06ca6351,
  0x14292967,
  0x27b70a85,
  0x2e1b2138,
  0x4d2c6dfc,
  0x53380d13,
  0x650a7354,
  0x766a0abb,
  0x81c2c92e,
  0x92722c85,
  0xa2bfe8a1,
  0xa81a664b,
  0xc24b8b70,
  0xc76c51a3,
  0xd192e819,
  0xd6990624,
  0xf40e3585,
  0x106aa070,
  0x19a4c116,
  0x1e376c08,
  0x2748774c,
  0x34b0bcb5,
  0x391c0cb3,
  0x4ed8aa4a,
  0x5b9cca4f,
  0x682e6ff3,
  0x748f82ee,
  0x78a5636f,
  0x84c87814,
  0x8cc70208,
  0x90befffa,
  0xa4506ceb,
  0xbef9a3f7,
  0xc67178f2,
])

const KEY_HEX_PATTERN = /^[0-9a-f]{64}$/
const HMAC_BLOCK_SIZE = 64

function rotr(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0
}

function smallSigma0(value: number): number {
  return (rotr(value, 7) ^ rotr(value, 18) ^ (value >>> 3)) >>> 0
}

function smallSigma1(value: number): number {
  return (rotr(value, 17) ^ rotr(value, 19) ^ (value >>> 10)) >>> 0
}

function bigSigma0(value: number): number {
  return (rotr(value, 2) ^ rotr(value, 13) ^ rotr(value, 22)) >>> 0
}

function bigSigma1(value: number): number {
  return (rotr(value, 6) ^ rotr(value, 11) ^ rotr(value, 25)) >>> 0
}

/** 纯 JS UTF-8 编码：不依赖 TextEncoder，覆盖中文与 emoji */
export function utf8Bytes(text: string): Uint8Array {
  const bytes: number[] = []
  for (let index = 0; index < text.length; index += 1) {
    let code = text.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00)
        index += 1
      }
    }
    if (code <= 0x7f) {
      bytes.push(code)
    } else if (code <= 0x7ff) {
      bytes.push(0xc0 | (code >>> 6), 0x80 | (code & 0x3f))
    } else if (code <= 0xffff) {
      bytes.push(
        0xe0 | (code >>> 12),
        0x80 | ((code >>> 6) & 0x3f),
        0x80 | (code & 0x3f),
      )
    } else {
      bytes.push(
        0xf0 | (code >>> 18),
        0x80 | ((code >>> 12) & 0x3f),
        0x80 | ((code >>> 6) & 0x3f),
        0x80 | (code & 0x3f),
      )
    }
  }
  return new Uint8Array(bytes)
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = ''
  for (let index = 0; index < bytes.length; index += 1) {
    hex += bytes[index].toString(16).padStart(2, '0')
  }
  return hex
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error('hex 字符串格式不合法')
  }
  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const out = new Uint8Array(left.length + right.length)
  out.set(left)
  out.set(right, left.length)
  return out
}

/** 纯 JS SHA-256；输入为 UTF-8 字节 */
export function sha256Bytes(bytes: Uint8Array): Uint8Array {
  const bitLength = bytes.length * 8
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64
  const padded = new Uint8Array(paddedLength)
  padded.set(bytes)
  padded[bytes.length] = 0x80

  /* 64-bit 大端长度；JS 数字安全范围内足够 */
  let remaining = bitLength
  for (let index = 0; index < 8; index += 1) {
    padded[paddedLength - 1 - index] = remaining & 0xff
    remaining = Math.floor(remaining / 256)
  }

  const hash = new Uint32Array(SHA256_H)
  const words = new Uint32Array(64)

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const start = offset + index * 4
      words[index] = (
        (padded[start] << 24) |
        (padded[start + 1] << 16) |
        (padded[start + 2] << 8) |
        padded[start + 3]
      ) >>> 0
    }
    for (let index = 16; index < 64; index += 1) {
      words[index] = (
        smallSigma1(words[index - 2]) +
        words[index - 7] +
        smallSigma0(words[index - 15]) +
        words[index - 16]
      ) >>> 0
    }

    let a = hash[0]
    let b = hash[1]
    let c = hash[2]
    let d = hash[3]
    let e = hash[4]
    let f = hash[5]
    let g = hash[6]
    let h = hash[7]

    for (let index = 0; index < 64; index += 1) {
      const sum1 = bigSigma1(e)
      const choose = ((e & f) ^ (~e & g)) >>> 0
      const temp1 = (h + sum1 + choose + SHA256_K[index] + words[index]) >>> 0
      const sum0 = bigSigma0(a)
      const majority = ((a & b) ^ (a & c) ^ (b & c)) >>> 0
      const temp2 = (sum0 + majority) >>> 0

      h = g
      g = f
      f = e
      e = (d + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }

    hash[0] = (hash[0] + a) >>> 0
    hash[1] = (hash[1] + b) >>> 0
    hash[2] = (hash[2] + c) >>> 0
    hash[3] = (hash[3] + d) >>> 0
    hash[4] = (hash[4] + e) >>> 0
    hash[5] = (hash[5] + f) >>> 0
    hash[6] = (hash[6] + g) >>> 0
    hash[7] = (hash[7] + h) >>> 0
  }

  const out = new Uint8Array(32)
  for (let index = 0; index < 8; index += 1) {
    out[index * 4] = hash[index] >>> 24
    out[index * 4 + 1] = (hash[index] >>> 16) & 0xff
    out[index * 4 + 2] = (hash[index] >>> 8) & 0xff
    out[index * 4 + 3] = hash[index] & 0xff
  }
  return out
}

export function sha256Hex(text: string): string {
  return bytesToHex(sha256Bytes(utf8Bytes(text)))
}

/** HMAC-SHA256 字节版；keyHex 可以是任意偶数长度 hex */
export function hmacSha256Bytes(keyHex: string, message: Uint8Array): string {
  const key = hexToBytes(keyHex)
  const normalized = key.length > HMAC_BLOCK_SIZE ? sha256Bytes(key) : key
  const paddedKey = new Uint8Array(HMAC_BLOCK_SIZE)
  paddedKey.set(normalized)

  const innerPad = new Uint8Array(HMAC_BLOCK_SIZE)
  const outerPad = new Uint8Array(HMAC_BLOCK_SIZE)
  for (let index = 0; index < HMAC_BLOCK_SIZE; index += 1) {
    innerPad[index] = paddedKey[index] ^ 0x36
    outerPad[index] = paddedKey[index] ^ 0x5c
  }

  const inner = sha256Bytes(concatBytes(innerPad, message))
  return bytesToHex(sha256Bytes(concatBytes(outerPad, inner)))
}

/** HMAC-SHA256 文本版；keyHex 可以是任意偶数长度 hex，签名校验使用 64 位 */
export function hmacSha256Hex(keyHex: string, message: string): string {
  return hmacSha256Bytes(keyHex, utf8Bytes(message))
}

export function isValidKeyHex(value: string): boolean {
  return KEY_HEX_PATTERN.test(value)
}

/** 32 字节随机数 → 64 位小写 hex */
export function keyHexFromBytes(bytes: Uint8Array): string {
  if (bytes.length !== 32) {
    throw new Error('focus key 必须是 32 字节')
  }
  return bytesToHex(bytes)
}

/** 至少 4 字节随机数 → 32-bit 无符号种子 */
export function seedFromBytes(bytes: Uint8Array): number {
  if (bytes.length < 4) {
    throw new Error('seed 至少需要 4 字节')
  }
  return (((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0)
}

export function canonicalSession(session: FocusSession): string {
  return JSON.stringify([
    1,
    session.id,
    session.fsm,
    session.tag,
    session.startedAt,
    session.phaseStartedAt,
    session.phaseEndsAt,
    session.phaseTotalMs,
    session.remainingMs,
    session.cycle,
    session.completedFocus,
    session.continuousFocusMs,
    session.breaches,
    session.updatedAt,
    session.lockUntil ?? 0,
    session.lastHeartbeatAt ?? 0,
    session.confidence ?? 'high',
  ])
}

export function canonicalRecord(record: FocusRecord): string {
  return JSON.stringify([
    1,
    record.id,
    record.tag,
    record.startedAt,
    record.endedAt,
    record.focusedMs,
    record.breaches,
    record.seed,
    record.level,
    record.confidence,
  ])
}

export function canonicalStats(stats: FocusStats): string {
  return JSON.stringify([
    1,
    stats.totalFocusMs,
    stats.completedCount,
    stats.level,
    stats.streakDays,
    stats.lastCompletedDate,
    stats.todayDate,
    stats.todayFocusMs,
    stats.continuousFocusMs,
    stats.lastAppliedRecordId,
    stats.updatedAt,
  ])
}

export function signSession(session: FocusSession, keyHex: string): string {
  return hmacSha256Hex(keyHex, canonicalSession(session))
}

export function signRecord(record: FocusRecord, keyHex: string): string {
  return hmacSha256Hex(keyHex, canonicalRecord(record))
}

export function signStats(stats: FocusStats, keyHex: string): string {
  return hmacSha256Hex(keyHex, canonicalStats(stats))
}

function timingSafeEqualHex(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false
  }
  let diff = 0
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return diff === 0
}

export function verifyRecord(record: FocusRecord, keyHex: string): FocusRecordCheck {
  if (!isValidKeyHex(keyHex)) {
    return {
      record,
      verified: false,
      tainted: false,
      reason: 'keyLost',
    }
  }
  const expected = signRecord(record, keyHex)
  const ok = timingSafeEqualHex(expected, record.signature)
  return {
    record,
    verified: ok,
    tainted: !ok,
    reason: ok ? 'ok' : 'signature',
  }
}

export function verifySessionSignature(session: FocusSession, keyHex: string): boolean {
  if (!isValidKeyHex(keyHex)) {
    return false
  }
  return timingSafeEqualHex(signSession(session, keyHex), session.signature)
}

export function verifyStatsSignature(stats: FocusStats, keyHex: string): boolean {
  if (!isValidKeyHex(keyHex)) {
    return false
  }
  return timingSafeEqualHex(signStats(stats, keyHex), stats.signature)
}
