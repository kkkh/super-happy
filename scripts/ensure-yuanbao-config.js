/* ==========================================================================
   ensure-yuanbao-config · 元宝搜索本地配置兜底
   - config.local.ts 被 git 忽略；不存在时从模板生成，避免 tsc / 测试失败
   ========================================================================== */
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const DIR = path.join(ROOT, 'core/services/yuanbao')
const TARGET = path.join(DIR, 'config-local.ts')
const TEMPLATE = path.join(DIR, 'config.example.ts')

if (!fs.existsSync(TARGET)) {
  fs.copyFileSync(TEMPLATE, TARGET)
  console.log('[yuanbao] 已生成 core/services/yuanbao/config-local.ts，请填入服务 API KEY')
}
