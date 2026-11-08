/* ==========================================================================
   aesVault · 冷备保险箱
   - AES-256-CBC + PKCS7，密钥由口令 SHA-256 派生
   - 输出纯文本格式：CYBER-AES1|<ivHex>|<cipherHex>
   - 运行时只依赖 grow/lib/crypto-js.js（从 tools-core 已审计产物复制）
   - 主包 0KB 增长；加解密全部在 grow 分包内执行
   ========================================================================== */

import CryptoJS from '../lib/crypto-js.js'

export interface VaultCipherParts {
  ivHex: string
  cipherHex: string
}

const HEADER = 'CYBER-AES1'
const MIN_PASSPHRASE = 6

function deriveKey(passphrase: string) {
  return CryptoJS.SHA256(`chaohuan-cyber-vault|${passphrase}`)
}

export function isVaultReady(): boolean {
  return Boolean(CryptoJS && CryptoJS.AES && CryptoJS.SHA256)
}

export function validatePassphrase(passphrase: string): string {
  const text = typeof passphrase === 'string' ? passphrase.trim() : ''
  if (text.length < MIN_PASSPHRASE) {
    return `保险箱口令至少 ${MIN_PASSPHRASE} 个字符`
  }
  return ''
}

export function encryptVault(
  plain: string,
  passphrase: string,
  fixedIvHex = '',
): string | null {
  const error = validatePassphrase(passphrase)
  if (error || typeof plain !== 'string' || !plain) {
    return null
  }
  try {
    const key = deriveKey(passphrase.trim())
    const iv = fixedIvHex
      ? CryptoJS.enc.Hex.parse(fixedIvHex)
      : CryptoJS.lib.WordArray.random(16)
    const encrypted = CryptoJS.AES.encrypt(plain, key, {
      iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    })
    return `${HEADER}|${iv.toString(CryptoJS.enc.Hex)}|${encrypted.ciphertext.toString(
      CryptoJS.enc.Hex,
    )}`
  } catch (error) {
    console.error(
      '[aesVault] encrypt failed',
      error && (error as Error).message,
      typeof CryptoJS,
      CryptoJS ? Object.keys(CryptoJS) : 'null',
    )
    return null
  }
}

export function decryptVault(cipherText: string, passphrase: string): string | null {
  const error = validatePassphrase(passphrase)
  if (error || typeof cipherText !== 'string') {
    return null
  }
  const text = cipherText.trim()
  if (!text.startsWith(`${HEADER}|`)) {
    return null
  }
  const parts = text.split('|')
  if (parts.length !== 3 || !parts[1] || !parts[2]) {
    return null
  }
  try {
    const key = deriveKey(passphrase.trim())
    const iv = CryptoJS.enc.Hex.parse(parts[1])
    const ciphertext = CryptoJS.enc.Hex.parse(parts[2])
    const cipherParams = CryptoJS.lib.CipherParams.create({ ciphertext })
    const decrypted = CryptoJS.AES.decrypt(cipherParams, key, {
      iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    })
    const plain = decrypted.toString(CryptoJS.enc.Utf8)
    return plain || null
  } catch {
    return null
  }
}

export function isVaultText(text: string): boolean {
  return typeof text === 'string' && text.trim().startsWith(`${HEADER}|`)
}
