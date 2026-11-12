/* ==========================================================================
   包体门禁 · 上传口径统计
   - 主包 ≤1900KB；tools-core ≤1600KB；tools-media ≤800KB
   - 新页面 manifest 为空时为基线校验
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const { checkBudgets, rootAnomalies } = require('../scripts/check-budget')

test('包体：主包与分包均在上传口径预算内', () => {
  const result = checkBudgets()
  assert.equal(result.ok, true, result.failures.join('；'))
  assert.ok(result.mainKb > 0)
  assert.ok(Object.keys(result.packages).length >= 6)
})

test('包体：根目录不存在未排除的运行时外资源', () => {
  const anomalies = rootAnomalies()
  assert.deepEqual(anomalies, [], `发现未排除资源：${JSON.stringify(anomalies)}`)
})
