/* ==========================================================================
   Hash 与加密计算引擎 · tools-core 分包本地实现
   - crypto-js 只安装在分包，主包不包含任何加密库
   - MD5 / SHA-1 / SHA-256 / SHA-512，普通 Hash 与 HMAC
   - 100,000 字符输入上限；空文本、空密钥、底层异常全部拦截
   ========================================================================== */
import CryptoJS from 'crypto-js'

export type HashAlgorithm = 'md5' | 'sha1' | 'sha256' | 'sha512'
export type HashCaseMode = 'lower' | 'upper'

export interface HashAlgorithmOption {
  key: HashAlgorithm
  label: string
  fullLabel: string
}

export interface HashOptions {
  algorithm: HashAlgorithm
  hmac: boolean
  secret: string
}

export interface HashResult {
  hex: string
  algorithm: HashAlgorithm
  hmac: boolean
  algorithmLabel: string
  modeLabel: string
  inputChars: number
  elapsedMs: number
}

/** 单边文本上限：防止 JS 引擎内存溢出 */
export const MAX_HASH_CHARS = 100000

export const HASH_ALGORITHMS: HashAlgorithmOption[] = [
  { key: 'md5', label: 'MD5', fullLabel: 'MD5' },
  { key: 'sha1', label: 'SHA-1', fullLabel: 'SHA-1' },
  { key: 'sha256', label: 'SHA-256', fullLabel: 'SHA-256' },
  { key: 'sha512', label: 'SHA-512', fullLabel: 'SHA-512' },
]

const ALGORITHM_LABELS: Record<HashAlgorithm, string> = {
  md5: 'MD5',
  sha1: 'SHA-1',
  sha256: 'SHA-256',
  sha512: 'SHA-512',
}

export function algorithmLabel(algorithm: HashAlgorithm): string {
  return ALGORITHM_LABELS[algorithm] ?? 'SHA-256'
}

/** 统一的十六进制大小写转换，禁止页面自行重复实现 */
export function formatHash(hex: string, mode: HashCaseMode): string {
  const value = typeof hex === 'string' ? hex : ''
  return mode === 'upper' ? value.toUpperCase() : value.toLowerCase()
}

function codePointLength(text: string): number {
  return Array.from(text).length
}

/**
 * 核心计算：
 * - 不做任何 DOM / wx API 调用，可在宏任务中安全执行
 * - 所有底层异常都转成带上下文的中文错误，页面直接展示
 */
export function computeHash(input: string, options: HashOptions): HashResult {
  const startedAt = Date.now()
  const text = typeof input === 'string' ? input : ''
  if (!text.trim()) {
    throw new Error('请输入需要计算 Hash 的文本')
  }
  const inputChars = codePointLength(text)
  if (inputChars > MAX_HASH_CHARS) {
    throw new Error(`输入超过 ${MAX_HASH_CHARS.toLocaleString()} 字符上限`)
  }

  const algorithm: HashAlgorithm = options.algorithm
  const hmac = Boolean(options.hmac)
  const secret = typeof options.secret === 'string' ? options.secret : ''
  if (hmac && !secret.trim()) {
    throw new Error('HMAC 模式必须填写密钥')
  }

  let digest: CryptoJS.lib.WordArray
  try {
    switch (algorithm) {
      case 'md5':
        digest = hmac ? CryptoJS.HmacMD5(text, secret) : CryptoJS.MD5(text)
        break
      case 'sha1':
        digest = hmac ? CryptoJS.HmacSHA1(text, secret) : CryptoJS.SHA1(text)
        break
      case 'sha256':
        digest = hmac ? CryptoJS.HmacSHA256(text, secret) : CryptoJS.SHA256(text)
        break
      case 'sha512':
        digest = hmac ? CryptoJS.HmacSHA512(text, secret) : CryptoJS.SHA512(text)
        break
      default:
        throw new Error('不支持的 Hash 算法')
    }
  } catch (error) {
    if (error instanceof Error && /不支持/.test(error.message)) {
      throw error
    }
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Hash 计算失败：${message || '底层库异常'}`)
  }

  let hex = ''
  try {
    hex = digest.toString(CryptoJS.enc.Hex)
  } catch {
    throw new Error('Hash 结果序列化失败')
  }
  if (!hex) {
    throw new Error('Hash 结果为空，请检查输入')
  }

  return {
    hex,
    algorithm,
    hmac,
    algorithmLabel: algorithmLabel(algorithm),
    modeLabel: hmac ? 'HMAC' : '普通 Hash',
    inputChars,
    elapsedMs: Date.now() - startedAt,
  }
}
