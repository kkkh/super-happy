/* ==========================================================================
   批 2 · 工期排期（schedule）
   - 引擎：含/不含开始日、跳周末、自定义休息日、跨年、边界
   - 契约：页面 / 注册 / 帮助 / jump 工作流 / 适配器 / 包体清单
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
  return import(`${URL_ROOT}core/toolbox/engines/date.ts`)
}

test('排期：含开始日与不含开始日相差一个工作日', async () => {
  const date = await loadEngine()
  const withStart = date.addWorkdays('2026-01-05', 5, { includeStart: true })
  const withoutStart = date.addWorkdays('2026-01-05', 5, { includeStart: false })
  assert.ok(withStart && withoutStart)
  assert.equal(withStart.endISO, '2026-01-09')
  assert.equal(withStart.calendarDays, 5)
  assert.equal(withoutStart.endISO, '2026-01-12')
  assert.equal(withoutStart.calendarDays, 8)
})

test('排期：跳过周末，逐日清单标记非工作日', async () => {
  const date = await loadEngine()
  const result = date.addWorkdays('2026-01-09', 2, { includeStart: true })
  assert.ok(result)
  assert.equal(result.endISO, '2026-01-12')
  assert.equal(result.calendarDays, 4)
  assert.equal(result.entries.length, 4)
  assert.deepEqual(
    result.entries.map((entry) => entry.workday),
    [true, false, false, true],
  )
})

test('排期：自定义休息日与关闭跳周末', async () => {
  const date = await loadEngine()
  const holiday = date.addWorkdays('2026-01-05', 3, {
    includeStart: true,
    holidays: ['2026-01-06'],
  })
  assert.ok(holiday)
  assert.equal(holiday.endISO, '2026-01-08')
  assert.equal(holiday.entries[1].holiday, true)
  assert.equal(holiday.entries[1].workday, false)

  const weekendWork = date.addWorkdays('2026-01-10', 2, {
    includeStart: true,
    skipWeekend: false,
  })
  assert.ok(weekendWork)
  assert.equal(weekendWork.endISO, '2026-01-11')
  assert.equal(weekendWork.calendarDays, 2)
})

test('排期：跨年推进与工作日计数', async () => {
  const date = await loadEngine()
  const result = date.addWorkdays('2025-12-31', 2, { includeStart: true })
  assert.ok(result)
  assert.equal(result.endISO, '2026-01-01')
  assert.equal(result.calendarDays, 2)
  assert.equal(date.countWorkdays('2026-01-05', '2026-01-09'), 5)
  assert.equal(date.countWorkdays('2026-01-05', '2026-01-09', { holidays: ['2026-01-06'] }), 4)
})

test('排期：工期 0 / 超 1000 / 非法日期返回 null', async () => {
  const date = await loadEngine()
  assert.equal(date.addWorkdays('2026-01-05', 0), null)
  assert.equal(date.addWorkdays('2026-01-05', 1001), null)
  assert.equal(date.addWorkdays('2026-02-30', 5), null)
})

test('排期契约：页面 / 注册 / 帮助 / jump 工作流 / 适配器 / 包体清单', async () => {
  const app = JSON.parse(read('app.json'))
  const core = app.subpackages.find((item) => item.root === 'subpackages/tools-core')
  assert.ok(core.pages.includes('pages/schedule/index'), 'app.json 未注册页面')

  for (const ext of ['.ts', '.json', '.wxml', '.wxss']) {
    assert.ok(
      fs.existsSync(path.join(ROOT, `subpackages/tools-core/pages/schedule/index${ext}`)),
      `缺少页面文件 ${ext}`,
    )
  }

  const wxml = read('subpackages/tools-core/pages/schedule/index.wxml')
  assert.match(wxml, /tool-id="schedule"/)
  assert.match(wxml, /bindchange="onDateChange"/)
  assert.match(wxml, /bind:run="onRun"/)
  assert.match(wxml, /bindchange="onToggle"/)
  assert.match(wxml, /bindtap="onToggleList"/)
  assert.match(wxml, /poster-data="\{\{posterData\}\}"/)
  assert.match(wxml, /bindtap="onCopy"/)

  const ts = read('subpackages/tools-core/pages/schedule/index.ts')
  assert.match(ts, /onShareAppMessage\s*\(/)
  assert.match(ts, /onShareTimeline\s*\(/)
  assert.match(ts, /addWorkdays/)
  assert.match(ts, /onReceiveWorkflow\s*\(/)
  assert.equal(/new Date\(Date\.UTC/.test(ts), false, '页面不得自行推进日期')
  assert.equal(/wx\.request|uploadFile|downloadFile/.test(ts), false)

  const registry = read('core/toolbox/registry.ts')
  assert.match(registry, /id: 'schedule'/)
  assert.match(registry, /weight: 84/)
  assert.match(read('subpackages/grow/lib/help.ts'), /schedule: \{/)
  assert.match(read('scripts/check-budget.js'), /pages\/schedule/)
  assert.match(read('scripts/e2e-tools.js'), /id: 'schedule'/)

  const config = await import(`${URL_ROOT}core/workflow/workflowConfig.ts`)
  assert.equal(config.WORKFLOW_ROUTING.schedule, 'jump')
  assert.deepEqual(config.WORKFLOW_ACCEPTS.schedule, ['text'])

  const source = await import(`${URL_ROOT}core/workflow/workflowSource.ts`)
  assert.deepEqual(source.WORKFLOW_SOURCE_KEYS.schedule.text, ['scheduleSummary'])

  const adapters = await import(`${URL_ROOT}core/workflow/workflowAdapters.ts`)
  assert.ok(adapters.getWorkflowAdapter('schedule'), '缺少 schedule 跳转适配器')
})
