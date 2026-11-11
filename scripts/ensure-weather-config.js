/* ==========================================================================
   ensure-weather-config · 保证 config.local.ts 存在
   - 真实 Key 由开发者在本地填写，不进仓库
   - 新克隆 / CI 首次 typecheck / test 时自动从 example 生成空配置
   ========================================================================== */
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const dir = path.join(root, 'subpackages/tools-core/weather')
const local = path.join(dir, 'config.local.ts')
const example = path.join(dir, 'config.example.ts')

try {
  if (!fs.existsSync(local) && fs.existsSync(example)) {
    fs.copyFileSync(example, local)
    console.log('[weather] 已生成 config.local.ts；真机联调前请填入高德 Web服务 Key')
  }
} catch (error) {
  console.warn('[weather] 无法生成 config.local.ts', error && error.message ? error.message : error)
}
