#!/usr/bin/env node
/* ==========================================================================
   和风天气占位配置
   - config-local.ts 缺失时从 config.example.ts 复制，保证 typecheck / test 可编译
   - 不覆盖已存在的本地配置
   - pretypecheck / pretest 自动调用
   ========================================================================== */

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const EXAMPLE = path.join(ROOT, 'subpackages/weather/config.example.ts')
const LOCAL = path.join(ROOT, 'subpackages/weather/config-local.ts')

if (!fs.existsSync(EXAMPLE)) {
  console.error('✖ 缺少 subpackages/weather/config.example.ts')
  process.exit(1)
}

if (fs.existsSync(LOCAL)) {
  process.exit(0)
}

fs.mkdirSync(path.dirname(LOCAL), { recursive: true })
fs.copyFileSync(EXAMPLE, LOCAL)
console.log('ℹ 已生成和风天气占位配置；运行 npm run qweather:token 写入真实凭据')
