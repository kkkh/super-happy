/* ==========================================================================
   date-engine · 跨分包日期核心迁移契约
   - core/toolbox/engines/date.ts 是唯一实现
   - tools-core/lib/date.ts 只做薄 re-export
   - 迁移前后黄金值保持一致
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { registerHooks } = require('node:module')

const ROOT = path.resolve(__dirname, '..')

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !path.extname(specifier)) {
      return nextResolve(`${specifier}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})

function moduleUrl(relativePath) {
  return `${require('node:url').pathToFileURL(ROOT).href}/${relativePath}`
}

test('date 引擎：core 与 tools-core 薄 re-export 导出同一组函数', async () => {
  const core = await import(moduleUrl('core/toolbox/engines/date.ts'))
  const shim = await import(moduleUrl('subpackages/tools-core/lib/date.ts'))
  const coreKeys = Object.keys(core).sort()
  const shimKeys = Object.keys(shim).sort()
  /* 允许后续卡新增 isoWeekOf / dayOfYear / addMonths，但 21 个迁移基线必须全部存在 */
  assert.ok(coreKeys.length >= 21, `core 导出少于 21：${coreKeys.length}`)
  for (const key of [
    'daysInMonth',
    'isLeapYear',
    'parseISODate',
    'serialOf',
    'partsFromSerial',
    'isoOf',
    'serialOfISO',
    'isoFromSerial',
    'todayISO',
    'dayDiff',
    'weekdayLabel',
    'isWeekend',
    'countWeekdays',
    'addDays',
    'addMonths',
    'formatCN',
    'ageParts',
    'nextBirthday',
    'formatDateTime',
    'parseDateTime',
    'formatUTC',
    'formatClock',
  ]) {
    assert.ok(coreKeys.includes(key), `core 缺少导出：${key}`)
  }
  assert.deepEqual(shimKeys, coreKeys)
})

test('date 引擎：日序号、闰年与工作日黄金值', async () => {
  const date = await import(moduleUrl('core/toolbox/engines/date.ts'))
  assert.equal(date.isLeapYear(2024), true)
  assert.equal(date.isLeapYear(2100), false)
  assert.equal(date.daysInMonth(2024, 2), 29)
  assert.equal(date.daysInMonth(2023, 2), 28)
  assert.equal(date.isoFromSerial(date.serialOfISO('2026-01-01')), '2026-01-01')
  assert.equal(date.addDays('2024-02-28', 1), '2024-02-29')
  assert.equal(date.countWeekdays(date.serialOfISO('2026-01-05'), date.serialOfISO('2026-01-09')), 5)
})

test('date 引擎：年龄与 2 月 29 日生日推进', async () => {
  const date = await import(moduleUrl('core/toolbox/engines/date.ts'))
  assert.deepEqual(date.ageParts('2000-02-29', '2026-02-28'), {
    years: 25,
    months: 11,
    days: 30,
    totalDays: 9496,
    totalMonths: 311,
  })
  const birthday = date.nextBirthday('2000-02-29', '2026-03-01')
  assert.equal(birthday.dateISO, '2027-02-28')
  assert.equal(birthday.leapAdjusted, true)
  assert.equal(birthday.today, false)
})
