/* ==========================================================================
   M5 · 日期加减（date-add）
   - 引擎：月末 / 闰日 / 跨年 / 0 / 超范围
   - 工作流：silent 文本解析与摘要
   - 契约：tools-core / 页面 / 注册 / 帮助 / 配置 / 来源 / 无页面适配器
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

async function loadDate() {
  return import(`${URL_ROOT}core/toolbox/engines/date.ts`)
}

test('日期加减：月末与闰日按目标月钳制', async () => {
  const date = await loadDate()

  const janToFeb = date.addDate('2026-01-31', 1, 'month')
  assert.ok(janToFeb)
  assert.equal(janToFeb.endISO, '2026-02-28')
  assert.equal(janToFeb.weekday, '周六')
  assert.equal(janToFeb.diffDays, 28)
  assert.equal(janToFeb.clamped, true)

  const leapMonth = date.addDate('2024-01-31', 1, 'month')
  assert.equal(leapMonth.endISO, '2024-02-29')
  assert.equal(leapMonth.diffDays, 29)
  assert.equal(leapMonth.clamped, true)

  const leapYear = date.addDate('2024-02-29', 1, 'year')
  assert.equal(leapYear.endISO, '2025-02-28')
  assert.equal(leapYear.clamped, true)

  const backYear = date.addDate('2024-02-29', -1, 'year')
  assert.equal(backYear.endISO, '2023-02-28')
  assert.equal(backYear.clamped, true)

  const normal = date.addDate('2026-01-15', 1, 'month')
  assert.equal(normal.endISO, '2026-02-15')
  assert.equal(normal.clamped, false)
})

test('日期加减：跨年、按周推进与负向回退', async () => {
  const date = await loadDate()

  const nextDay = date.addDate('2026-12-31', 1, 'day')
  assert.equal(nextDay.endISO, '2027-01-01')
  assert.equal(nextDay.diffDays, 1)
  assert.equal(nextDay.weekday, '周五')

  const nextWeek = date.addDate('2026-12-31', 1, 'week')
  assert.equal(nextWeek.endISO, '2027-01-07')
  assert.equal(nextWeek.diffDays, 7)

  const backDay = date.addDate('2025-01-01', -1, 'day')
  assert.equal(backDay.endISO, '2024-12-31')
  assert.equal(backDay.diffDays, -1)

  const backWeek = date.addDate('2026-01-01', -1, 'week')
  assert.equal(backWeek.endISO, '2025-12-25')
  assert.equal(backWeek.diffDays, -7)
})

test('日期加减：数量 0、负数与非法参数', async () => {
  const date = await loadDate()

  const zero = date.addDate('2026-01-31', 0, 'month')
  assert.equal(zero.endISO, '2026-01-31')
  assert.equal(zero.diffDays, 0)
  assert.equal(zero.clamped, false)

  const minus = date.addDate('2026-01-31', -30, 'day')
  assert.equal(minus.endISO, '2026-01-01')
  assert.equal(minus.diffDays, -30)

  assert.equal(date.addDate('2026-01-01', 1.5, 'day'), null)
  assert.equal(date.addDate('2026-1-1', 1, 'day'), null)
  assert.equal(date.addDate('2026-01-01', 1, 'decade'), null)
  assert.equal(date.addDate('2026-01-01', 100001, 'day'), null)
})

test('日期加减：结果超出 1900–2100 返回 null', async () => {
  const date = await loadDate()

  assert.equal(date.addDate('1900-01-01', -1, 'day'), null)
  assert.equal(date.addDate('2100-12-31', 1, 'day'), null)
  assert.equal(date.addDate('2100-01-01', 1, 'year'), null)
  assert.ok(date.addDate('1900-01-01', 1, 'year'))
  assert.ok(date.addDate('2100-12-31', -1, 'day'))
})

test('日期加减：silent 解析、摘要与页面契约', async () => {
  const date = await loadDate()

  assert.deepEqual(date.parseDateAddWorkflow('2026-01-31 +1m'), {
    startISO: '2026-01-31',
    amount: 1,
    unit: 'month',
  })
  assert.deepEqual(date.parseDateAddWorkflow('2026-01-31 -30d'), {
    startISO: '2026-01-31',
    amount: -30,
    unit: 'day',
  })
  assert.equal(date.parseDateAddWorkflow('2026-01-31 1 月').unit, 'month')
  assert.equal(date.parseDateAddWorkflow('2026/01/31 +1w').startISO, '2026-01-31')
  assert.equal(date.parseDateAddWorkflow('2026-01-31 +1年').unit, 'year')
  assert.equal(date.parseDateAddWorkflow('2026-01-31'), null)
  assert.equal(date.parseDateAddWorkflow('2026-01-31 +1'), null)
  assert.equal(date.parseDateAddWorkflow('2026-01-31 +1x'), null)
  assert.equal(date.parseDateAddWorkflow('2026-02-30 +1d'), null)
  assert.equal(date.parseDateAddWorkflow('2026-01-31 +100001d'), null)

  const summary = date.dateAddSummary(date.addDate('2026-01-31', 1, 'month'))
  assert.equal(
    summary,
    '2026-01-31 +1 月 → 2026-02-28 · 周六 · 相差 28 天 · 月末已调整',
  )
  assert.match(
    date.dateAddSummary(date.addDate('2025-01-01', -1, 'day')),
    /相差 1 天$/,
  )

  const silent = await import(`${URL_ROOT}core/workflow/workflowSilent.ts`)
  const output = silent.executeSilentTool('date-add', {
    type: 'text',
    payload: '2024-02-29 +1y',
  })
  assert.equal(output.type, 'text')
  assert.match(output.payload, /2025-02-28/)
  assert.throws(
    () =>
      silent.executeSilentTool('date-add', {
        type: 'text',
        payload: '2026-01-31',
      }),
    /日期加减/,
  )

  const app = JSON.parse(read('app.json'))
  const core = app.subpackages.find((item) => item.root === 'subpackages/tools-core')
  assert.ok(core, 'app.json 缺少 tools-core 分包')
  assert.ok(core.pages.includes('pages/date-add/index'), 'tools-core 未注册日期加减页面')

  for (const ext of ['.ts', '.json', '.wxml', '.wxss']) {
    assert.ok(
      fs.existsSync(path.join(ROOT, `subpackages/tools-core/pages/date-add/index${ext}`)),
      `缺少日期加减页面文件 ${ext}`,
    )
  }

  const pageJson = JSON.parse(read('subpackages/tools-core/pages/date-add/index.json'))
  assert.equal(pageJson.navigationBarTitleText, '日期加减')

  const wxml = read('subpackages/tools-core/pages/date-add/index.wxml')
  assert.match(wxml, /tool-id="date-add"/)
  assert.match(wxml, /bind:run="onRun"/)
  assert.match(wxml, /bindtap="onDirection"/)
  assert.match(wxml, /bindtap="onUnit"/)
  assert.match(wxml, /bindtap="onCopy"/)
  assert.match(wxml, /bindtap="onCopyRow"/)
  assert.match(wxml, /天 \/ 周 \/ 月 \/ 年/)

  const ts = read('subpackages/tools-core/pages/date-add/index.ts')
  assert.match(ts, /onShareAppMessage\s*\(/)
  assert.match(ts, /onShareTimeline\s*\(/)
  assert.match(ts, /onCopyRow\s*\(/)
  assert.match(ts, /addDate/)
  assert.match(ts, /dateAddSummary/)
  assert.equal(/wx\.request|uploadFile|downloadFile/.test(ts), false, '日期加减不得联网')

  const registry = read('core/toolbox/registry.ts')
  assert.match(registry, /id: 'date-add'/)
  assert.match(registry, /name: '日期加减'/)
  assert.match(registry, /weight: 89/)
  assert.match(registry, /sensitive: ''/)
  assert.match(registry, /subpackages\/tools-core\/pages\/date-add\/index/)
  assert.match(read('subpackages/grow/lib/help.ts'), /'date-add': \{/)
  assert.match(read('scripts/check-budget.js'), /pages\/date-add/)
  assert.match(read('scripts/e2e-tools.js'), /id: 'date-add'/)
  assert.equal(/subpackages\//.test(read('core/toolbox/engines/date.ts')), false, 'core 不得引用分包')

  const config = await import(`${URL_ROOT}core/workflow/workflowConfig.ts`)
  assert.equal(config.WORKFLOW_ROUTING['date-add'], 'silent')
  assert.deepEqual(config.WORKFLOW_ACCEPTS['date-add'], ['text'])

  const source = await import(`${URL_ROOT}core/workflow/workflowSource.ts`)
  assert.deepEqual(source.WORKFLOW_SOURCE_KEYS['date-add'].text, ['dateAddSummary'])

  const adapters = await import(`${URL_ROOT}core/workflow/workflowAdapters.ts`)
  assert.equal(adapters.getWorkflowAdapter('date-add'), null, 'silent 工具不应有页面适配器')
  assert.match(read('core/workflow/workflowSilent.ts'), /case 'date-add'/)
})
