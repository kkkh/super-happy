#!/usr/bin/env node
/* ==========================================================================
   和风天气 JWT 生成器
   - Ed25519 + Base64URL，Header { alg: EdDSA, kid }
   - Payload { iss, sub, iat: now-30, exp: iat+86400 }，最长 24 小时
   - 写入 subpackages/weather/config-local.ts（git 忽略）
   - 私钥只从本机路径读取，不复制、不打印、不入库
   - 运行：npm run qweather:token
   ========================================================================== */

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const ROOT = path.resolve(__dirname, '..')
const CONFIG_PATH = path.join(ROOT, 'subpackages/weather/config-local.ts')
const DEFAULT_KEY_PATH = '/Users/qinchao/ed25519-private.pem'

function readExisting() {
  try {
    const text = fs.readFileSync(CONFIG_PATH, 'utf8')
    const host = /QWEATHER_HOST = '([^']*)'/.exec(text)
    const key = /QWEATHER_API_KEY = '([^']*)'/.exec(text)
    return { host: host ? host[1] : '', apiKey: key ? key[1] : '' }
  } catch {
    return { host: '', apiKey: '' }
  }
}

const existing = readExisting()
const HOST = process.env.QWEATHER_HOST || existing.host || 'mq46h5tchy.re.qweatherapi.com'
const KID = process.env.QWEATHER_KID || 'CAB6RT7W9C'
const ISS = process.env.QWEATHER_ISS || 'Q8574DAB97'
const SUB = process.env.QWEATHER_SUB || '4EE27AEAGP'
const KEY_PATH = process.env.QWEATHER_PRIVATE_KEY_PATH || DEFAULT_KEY_PATH
/* 保留已写入的 API KEY，避免本地刷新 JWT 时把生产凭据清空 */
const API_KEY = process.env.QWEATHER_API_KEY || existing.apiKey || ''

function base64url(value) {
  return Buffer.from(value).toString('base64url')
}

function signJwt(privateKey) {
  const header = base64url(JSON.stringify({ alg: 'EdDSA', kid: KID }))
  const iat = Math.floor(Date.now() / 1000) - 30
  const exp = iat + 86400
  const payload = base64url(JSON.stringify({ iss: ISS, sub: SUB, iat, exp }))
  const data = `${header}.${payload}`
  const signature = crypto.sign(null, Buffer.from(data), privateKey)
  return {
    token: `${data}.${base64url(signature)}`,
    exp,
  }
}

function main() {
  let token = process.env.QWEATHER_TOKEN || ''
  let exp = 0
  if (!token) {
    if (!fs.existsSync(KEY_PATH)) {
      console.error(`✖ 未找到 Ed25519 私钥：${KEY_PATH}`)
      console.error('  可通过 QWEATHER_PRIVATE_KEY_PATH 指定路径，或直接设置 QWEATHER_TOKEN')
      process.exit(1)
    }
    const pem = fs.readFileSync(KEY_PATH)
    let privateKey
    try {
      privateKey = crypto.createPrivateKey(pem)
    } catch (error) {
      console.error('✖ 私钥解析失败，请确认是 PKCS8 PEM（BEGIN PRIVATE KEY）')
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    }
    if (privateKey.asymmetricKeyType !== 'ed25519') {
      console.error(`✖ 私钥类型为 ${privateKey.asymmetricKeyType || '未知'}，和风天气 JWT 需要 Ed25519 私钥`)
      process.exit(1)
    }
    const signed = signJwt(privateKey)
    token = signed.token
    exp = signed.exp
  }

  const content = `/* 自动生成：npm run qweather:token；不得提交（已在 .gitignore） */
export const QWEATHER_HOST = '${HOST}'
export const QWEATHER_TOKEN = '${token}'
export const QWEATHER_API_KEY = '${API_KEY}'
`
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  fs.writeFileSync(CONFIG_PATH, content, { mode: 0o600 })
  const expiry = exp ? new Date(exp * 1000).toLocaleString('zh-CN', { hour12: false }) : '由环境变量提供'
  console.log('✔ 和风天气凭据已写入 subpackages/weather/config-local.ts')
  console.log(`  Host：${HOST}`)
  console.log(`  凭据：${API_KEY ? 'API KEY' : 'JWT'}`)
  console.log(`  过期：${expiry}`)
  if (!API_KEY) {
    console.log('  提示：JWT 最长 24 小时，重新构建前请再次运行 npm run qweather:token')
  }
}

main()
