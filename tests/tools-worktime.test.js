/* ==========================================================================
   批 1 · 工时与请假（worktime）
   - 引擎黄金值：跨天、倍率、正常/加班拆分、周末排除、半天、起止倒置
   - 契约：页面 / 注册 / 帮助 / 纯产出工作流
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { registerHooks } = require('node:module')

const ROOT = path.resolve(__dirname, '..')
const URL_ROOT = `${require('node:url').pathToFileURL(ROOT).href}/`
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !path.extname(specifier)) {
      return nextResolve(`${specifier}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})

async function loadEngine() {
  return import(`${URL_ROOT}subpackages/tools-daily/lib/worktime.ts`)
}

test('工时：跨天、下班等于上班与常规时段', async () => {
  const work = await loadEngine()
  const night = work.calcWorkMinutes('22:00', '02:00', 0, 8)
  assert.equal(night.ok, true)
  assert.equal(night.totalMinutes, 240)
  assert.equal(night.crossDay, true)

  const same = work.calcWorkMinutes('09:00', '09:00', 0, 8)
  assert.equal(same.ok, true)
  assert.equal(same.totalMinutes, 1440)
  assert.equal(same.crossDay, true)

  const normal = work.calcWorkMinutes('09:00', '18:30', 60, 8)
  assert.equal(normal.ok, true)
  assert.equal(normal.totalMinutes, 510)
  assert.equal(normal.crossDay, false)
})

test('工时：正常与加班拆分', async () => {
  const work = await loadEngine()
  const result = work.calcWorkMinutes('09:00', '18:30', 60, 8)
  assert.equal(result.ok, true)
  assert.equal(result.normalMinutes, 480)
  assert.equal(result.overtimeMinutes, 30)
  assert.equal(work.formatHours(result.totalMinutes), '8.5')
})

test('工时：加班费倍率与分运算', async () => {
  const work = await loadEngine()
  assert.deepEqual(work.calcOvertimePay(30, '100', 1.5), { ok: true, payCents: 7500 })
  assert.deepEqual(work.calcOvertimePay(30, '100', 2), { ok: true, payCents: 10000 })
  assert.equal(work.calcOvertimePay(30, '', 1.5).code, 'wage')
  assert.equal(work.calcOvertimePay(30, '100', 11).code, 'multiplier')
})

test('请假：周末排除与含周末', async () => {
  const work = await loadEngine()
  const excluded = work.calcLeaveDays('2026-11-06', '2026-11-09', false, false)
  assert.equal(excluded.ok, true)
  assert.equal(excluded.totalDays, 4)
  assert.equal(excluded.workdays, 2)
  assert.equal(excluded.leaveDays, 2)

  const included = work.calcLeaveDays('2026-11-06', '2026-11-09', true, false)
  assert.equal(included.ok, true)
  assert.equal(included.workdays, 4)
  assert.equal(included.leaveDays, 4)
})

test('请假：半天固定扣开始日 0.5 天', async () => {
  const work = await loadEngine()
  const weekday = work.calcLeaveDays('2026-11-06', '2026-11-09', false, true)
  assert.equal(weekday.ok, true)
  assert.equal(weekday.workdays, 2)
  assert.equal(weekday.leaveDays, 1.5)
  assert.equal(weekday.halfApplied, true)

  /* 开始日是周六：先排除周末，再扣半天 */
  const weekendStart = work.calcLeaveDays('2026-11-07', '2026-11-09', false, true)
  assert.equal(weekendStart.ok, true)
  assert.equal(weekendStart.startWeekend, true)
  assert.equal(weekendStart.workdays, 1)
  assert.equal(weekendStart.leaveDays, 0.5)
})

test('请假：起止倒置与页面契约', async () => {
  const work = await loadEngine()
  assert.equal(work.calcLeaveDays('2026-11-09', '2026-11-06', false, false).code, 'order')
  assert.equal(work.calcLeaveDays('2026-02-30', '2026-03-01', false, false).code, 'date')

  const app = JSON.parse(read('app.json'))
  const daily = app.subpackages.find((item) => item.root === 'subpackages/tools-daily')
  assert.ok(daily.pages.includes('pages/worktime/index'), 'app.json 未注册页面')

  for (const ext of ['.ts', '.json', '.wxml', '.wxss']) {
    assert.ok(
      fs.existsSync(path.join(ROOT, `subpackages/tools-daily/pages/worktime/index${ext}`)),
      `缺少页面文件 ${ext}`,
    )
  }

  const wxml = read('subpackages/tools-daily/pages/worktime/index.wxml')
  assert.match(wxml, /tool-id="worktime"/)
  assert.match(wxml, /bind:run="onRun"/)
  assert.match(wxml, /poster-data="\{\{posterData\}\}"/)

  const ts = read('subpackages/tools-daily/pages/worktime/index.ts')
  assert.match(ts, /onShareAppMessage\s*\(/)
  assert.match(ts, /onShareTimeline\s*\(/)
  assert.equal(/onReceiveWorkflow/.test(ts), false, 'accepts: [] 不得声明注入接口')
  assert.equal(/wx\.request|uploadFile|downloadFile/.test(ts), false)

  const registry = read('core/toolbox/registry.ts')
  assert.match(registry, /id: 'worktime'/)
  assert.match(registry, /weight: 78/)
  assert.match(registry, /draftExcluded: true/)
  assert.match(read('subpackages/grow/lib/help.ts'), /worktime: \{/)

  const config = await import(`${URL_ROOT}core/workflow/workflowConfig.ts`)
  assert.equal(config.WORKFLOW_ROUTING.worktime, 'jump')
  assert.deepEqual(config.WORKFLOW_ACCEPTS.worktime, [])

  const source = await import(`${URL_ROOT}core/workflow/workflowSource.ts`)
  assert.deepEqual(source.WORKFLOW_SOURCE_KEYS.worktime.text, ['worktimeSummary'])
})
