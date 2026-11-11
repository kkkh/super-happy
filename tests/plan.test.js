/* ==========================================================================
   方案自检 · 契约回归
   - 章节编号连续、能力 81 项、卡片 63 张
   - §4 路由与 §3.11 分包一致
   - §30 批 1 清单齐全，§31.4 注入契约一致
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { checkPlan } = require('../scripts/check-plan')

test('方案：章节连续、81 项能力、63 张卡、路由与分包一致', () => {
  const result = checkPlan()
  assert.equal(result.ok, true, result.failures.join('；'))
  assert.equal(result.totals.capabilities, 81)
  assert.equal(result.totals.cards, 63)

  const legal = fs.readFileSync(
    path.join(__dirname, '..', 'pages/legal/index.wxml'),
    'utf8',
  )
  for (const key of ['tbx:helpBannerDismissed', 'exports', 'cyber:auto:v1']) {
    assert.ok(legal.includes(key), `legal 缺少披露：${key}`)
  }

  /* 负向回归：门禁逻辑退化时必须真实报错，不能只验证通过路径 */
  const planText = fs.readFileSync(
    path.join(__dirname, '..', '工具矩阵扩展与体验补全方案.md'),
    'utf8',
  )
  /* 同时把 §14 置回待开始并删除 §30 施工行，避免卡上线后被“已完成”豁免 */
  const target = 'regex'
  const undonePlan = planText.replace(
    new RegExp(`^\\| M1 批 1 · ${target} \\| 完成 \\|`, 'm'),
    `| M1 批 1 · ${target} | 待开始 |`,
  )
  const [head30, tail30] = undonePlan.split('### 30.1 ')
  const brokenRow = tail30.replace(
    new RegExp(`^\\| \`${target}\` \\|.*$`, 'm'),
    '| （已删除） |',
  )
  assert.notEqual(brokenRow, tail30, `负向用例未生效：未找到 ${target} 施工行`)
  assert.equal(
    checkPlan(`${head30}### 30.1 ${brokenRow}`).ok,
    false,
    '删除未完成卡的施工行后门禁应失败',
  )

  const undone = planText.replace(
    /^\| M1 批 1 · radix \| 完成 \|/m,
    '| M1 批 1 · radix | 待开始 |',
  )
  assert.notEqual(undone, planText, '负向用例未生效：未找到 radix 完成行')
  assert.equal(
    checkPlan(undone).ok,
    false,
    'radix 改回待开始且无 §30 施工行时门禁应失败',
  )
})
