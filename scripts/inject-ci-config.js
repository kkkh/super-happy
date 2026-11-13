#!/usr/bin/env node
/* ==========================================================================
   inject-ci-config · CI 构建期注入联网服务配置
   - 仅在 CI 使用：从环境变量生成三个被 .gitignore 忽略的 config 文件
   - 缺任一必需变量直接失败，避免上传空配置包
   - 支持 --root 指定输出根目录，便于本地自测且不覆盖真实配置
   - 不打印任何密钥值，只输出写入结果
   ========================================================================== */
const fs = require('node:fs')
const path = require('node:path')

function readRoot() {
  const index = process.argv.indexOf('--root')
  if (index >= 0 && process.argv[index + 1]) {
    return path.resolve(process.argv[index + 1])
  }
  return path.resolve(__dirname, '..')
}

function required(name) {
  const value = (process.env[name] || '').trim()
  if (!value) {
    console.error(`✖ 缺少环境变量 ${name}，已阻止上传空配置包`)
    process.exit(1)
  }
  return value
}

function optional(name, fallback = '') {
  return (process.env[name] || fallback).trim()
}

function write(relative, content) {
  const target = path.join(ROOT, relative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content, { mode: 0o600 })
  console.log(`✔ 已注入 ${relative}`)
}

const ROOT = readRoot()

const amapKey = required('AMAP_WEB_SERVICE_KEY')
const qweatherHost = required('QWEATHER_HOST')
const qweatherApiKey = optional('QWEATHER_API_KEY')
const qweatherToken = optional('QWEATHER_TOKEN')
if (!qweatherApiKey && !qweatherToken) {
  console.error('✖ QWEATHER_API_KEY 与 QWEATHER_TOKEN 至少填一个，已阻止上传空配置包')
  process.exit(1)
}

const yuanbaoApiKey = optional('YUANBAO_API_KEY')
const yuanbaoSecretId = optional('YUANBAO_SECRET_ID')
const yuanbaoSecretKey = optional('YUANBAO_SECRET_KEY')
if (!yuanbaoApiKey && !(yuanbaoSecretId && yuanbaoSecretKey)) {
  console.error('✖ 元宝搜索需要 YUANBAO_API_KEY 或 YUANBAO_SECRET_ID + YUANBAO_SECRET_KEY，已阻止上传空配置包')
  process.exit(1)
}

write(
  'subpackages/tools-core/weather/config.local.ts',
  `/* 由 CI 构建期注入，请勿提交 */
export const AMAP_WEB_SERVICE_KEY = ${JSON.stringify(amapKey)}
`,
)

write(
  'subpackages/weather/config-local.ts',
  `/* 由 CI 构建期注入，请勿提交 */
export const QWEATHER_HOST = ${JSON.stringify(qweatherHost)}
export const QWEATHER_TOKEN = ${JSON.stringify(qweatherToken)}
export const QWEATHER_API_KEY = ${JSON.stringify(qweatherApiKey)}
`,
)

const endpoint = optional('YUANBAO_ENDPOINT', 'https://api.wsa.cloud.tencent.com/SearchPro')
write(
  'core/services/yuanbao/config-local.ts',
  `/* 由 CI 构建期注入，请勿提交 */
export interface YuanbaoConfig {
  apiKey: string
  secretId: string
  secretKey: string
  endpoint: string
  timeout: number
}

export const YUANBAO_CONFIG: YuanbaoConfig = {
  apiKey: ${JSON.stringify(yuanbaoApiKey)},
  secretId: ${JSON.stringify(yuanbaoSecretId)},
  secretKey: ${JSON.stringify(yuanbaoSecretKey)},
  endpoint: ${JSON.stringify(endpoint)},
  timeout: 15000,
}
`,
)

console.log('✔ CI 联网服务配置注入完成')
