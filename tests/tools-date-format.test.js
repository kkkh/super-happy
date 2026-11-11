/* ==========================================================================
   批 1 · 日期格式（date-format）
   - 引擎黄金值：ISO 周周年、闰年、非法日期、跨年周、Unix 时区
   - 契约：页面注册、外壳、帮助、silent 工作流与来源字段
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

test('日期格式：ISO 周 53 必须带正确周年', async () => {
  const date = await loadDate()
  assert.deepEqual(date.isoWeekOf(date.serialOfISO('2020-12-31')), {
    weekYear: 2020,
    week: 53,
  })
  assert.deepEqual(date.isoWeekOf(date.serialOfISO('2021-01-01')), {
    weekYear: 2020,
    week: 53,
  })
  assert.equal(date.formatAll('2020-12-31').isoWeek, '2020-W53')
  assert.equal(date.formatAll('2021-01-01').isoWeek, '2020-W53')
})

test('日期格式：闰年 2/29 与当年天序', async () => {
  const date = await loadDate()
  const leap = date.formatAll('2020-02-29')
  assert.equal(leap.leapYear, true)
  assert.equal(leap.daysInMonth, 29)
  assert.equal(leap.dayOfYear, 60)
  assert.equal(leap.weekday, '周六')
  assert.equal(leap.cnDate, '2020 年 2 月 29 日')
  assert.equal(date.formatAll('2019-02-29'), null)
})

test('日期格式：非法日期与 1900–2100 越界均返回 null', async () => {
  const date = await loadDate()
  for (const raw of [
    '',
    '2020-1-1',
    '2020-13-01',
    '2021-02-30',
    '1899-12-31',
    '2101-01-01',
  ]) {
    assert.equal(date.formatAll(raw), null, `${raw} 应为非法日期`)
  }
})

test('日期格式：跨年周按 ISO 周年归属', async () => {
  const date = await loadDate()
  assert.equal(date.formatAll('2021-01-04').isoWeek, '2021-W01')
  assert.equal(date.formatAll('2024-12-30').isoWeek, '2025-W01')
  assert.equal(date.formatAll('2025-12-29').isoWeek, '2026-W01')
})

test('日期格式：Unix 按本机时区零点计算，1970 前为负值', async () => {
  const date = await loadDate()
  const leap = date.formatAll('2020-02-29')
  const local = new Date(2020, 1, 29, 0, 0, 0, 0)
  assert.equal(leap.unixMs, local.getTime())
  assert.equal(leap.unixSec, Math.floor(local.getTime() / 1000))
  assert.equal(leap.iso8601, '2020-02-29T00:00:00')

  const before = date.formatAll('1969-12-31')
  const beforeLocal = new Date(1969, 11, 31, 0, 0, 0, 0)
  assert.equal(before.unixMs, beforeLocal.getTime())
  assert.ok(before.unixSec < 0, '1970 年前应为负 Unix 秒')
})

test('日期格式契约：页面 / 注册 / 帮助 / silent 工作流', async () => {
  const app = JSON.parse(read('app.json'))
  const core = app.subpackages.find((item) => item.root === 'subpackages/tools-core')
  assert.ok(core.pages.includes('pages/date-format/index'), 'app.json 未注册页面')

  for (const ext of ['.ts', '.json', '.wxml', '.wxss']) {
    assert.ok(
      fs.existsSync(
        path.join(ROOT, `subpackages/tools-core/pages/date-format/index${ext}`),
      ),
      `缺少页面文件 ${ext}`,
    )
  }

  const wxml = read('subpackages/tools-core/pages/date-format/index.wxml')
  assert.match(wxml, /tool-id="date-format"/)
  assert.match(wxml, /show-run="\{\{false\}\}"/)
  assert.match(wxml, /bindtap="onCopy"/)
  assert.match(wxml, /poster-data="\{\{posterData\}\}"/)

  const ts = read('subpackages/tools-core/pages/date-format/index.ts')
  assert.match(ts, /onShareAppMessage\s*\(/)
  assert.match(ts, /onShareTimeline\s*\(/)
  assert.match(ts, /onReceiveWorkflow\s*\(/)
  assert.equal(/wx\.request|uploadFile|downloadFile/.test(ts), false)

  const registry = read('core/toolbox/registry.ts')
  assert.match(registry, /id: 'date-format'/)
  assert.match(registry, /weight: 88/)
  assert.match(read('subpackages/grow/lib/help.ts'), /'date-format': \{/)

  const config = await import(`${URL_ROOT}core/workflow/workflowConfig.ts`)
  assert.equal(config.WORKFLOW_ROUTING['date-format'], 'silent')
  assert.deepEqual(config.WORKFLOW_ACCEPTS['date-format'], ['text'])

  const source = await import(`${URL_ROOT}core/workflow/workflowSource.ts`)
  assert.deepEqual(source.WORKFLOW_SOURCE_KEYS['date-format'].text, ['dateSummary'])

  const silent = await import(`${URL_ROOT}core/workflow/workflowSilent.ts`)
  const output = silent.executeSilentTool('date-format', {
    type: 'text',
    payload: '2021-01-01',
  })
  assert.match(output.payload, /2020-W53/)
  assert.throws(
    () =>
      silent.executeSilentTool('date-format', {
        type: 'text',
        payload: '2021-02-30',
      }),
    /合法日期/,
  )
})
