/* ==========================================================================
   M5 · 离职补偿（severance）
   - 引擎：N、N+1、社平 3 倍封顶、年假折算、年限 0 / 非法输入
   - 契约：tools-daily / 页面 / 注册 / 帮助 / 配置 / 来源 / 纯产出适配器
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

async function loadSeverance() {
  return import(`${URL_ROOT}subpackages/tools-daily/lib/severance.ts`)
}

function baseInput(overrides = {}) {
  return {
    monthlyCents: 2000000,
    years: 5,
    months: 7,
    mode: 'n',
    capEnabled: false,
    socialAverageCents: 0,
    unusedLeaveDays: 0,
    ...overrides,
  }
}

test('离职补偿：N 与不足 6 个月的折算', async () => {
  const severance = await loadSeverance()
  const out = severance.severanceTotal(baseInput())
  assert.equal(out.ok, true)
  assert.equal(out.result.totalMonths, 67)
  assert.equal(out.result.yearsForComp, 6)
  assert.equal(out.result.baseCents, 2000000)
  assert.equal(out.result.compensationCents, 12000000)
  assert.equal(out.result.noticeCents, 0)
  assert.equal(out.result.totalCents, 12000000)
  assert.equal(out.result.capped, false)
  assert.equal(out.result.yearsCapped, false)

  assert.equal(severance.compensationYears(3), 0.5)
  assert.equal(severance.compensationYears(6), 1)
  assert.equal(severance.compensationYears(11), 1)
  assert.equal(severance.compensationYears(12), 1)
  assert.equal(severance.compensationYears(17), 1)
  assert.equal(severance.compensationYears(18), 2)
  assert.equal(severance.compensationYears(67), 6)
})

test('离职补偿：N+1 代通知金与年假折算', async () => {
  const severance = await loadSeverance()
  const n1 = severance.severanceTotal(baseInput({ mode: 'n1' }))
  assert.equal(n1.ok, true)
  assert.equal(n1.result.noticeCents, 2000000)
  assert.equal(n1.result.totalCents, 14000000)

  const withLeave = severance.severanceTotal(baseInput({ unusedLeaveDays: 3 }))
  assert.equal(withLeave.ok, true)
  assert.equal(withLeave.result.leavePayCents, 551724)
  assert.equal(withLeave.result.totalCents, 12551724)
  assert.match(severance.severanceSummary(withLeave.result), /N · 补偿 6 个月/)
  assert.match(severance.severanceSummary(withLeave.result), /年假补偿 ¥5517\.24/)

  assert.equal(severance.annualLeavePay(2000000, 0), 0)
  assert.equal(severance.annualLeavePay(2000000, 0.5), 91954)
  assert.equal(severance.annualLeavePay(2000000, 31), null)
  assert.equal(severance.annualLeavePay(2000000, 0.3), null)
  assert.equal(severance.annualLeavePay(0, 3), null)
})

test('离职补偿：社平 3 倍封顶与 12 年上限', async () => {
  const severance = await loadSeverance()
  const capped = severance.severanceTotal(
    baseInput({
      monthlyCents: 5000000,
      years: 15,
      months: 0,
      capEnabled: true,
      socialAverageCents: 1000000,
    }),
  )
  assert.equal(capped.ok, true)
  assert.equal(capped.result.baseCents, 3000000)
  assert.equal(capped.result.yearsForComp, 12)
  assert.equal(capped.result.compensationCents, 36000000)
  assert.equal(capped.result.capped, true)
  assert.equal(capped.result.yearsCapped, true)

  const uncapped = severance.severanceTotal(
    baseInput({ monthlyCents: 5000000, years: 15, months: 0 }),
  )
  assert.equal(uncapped.result.baseCents, 5000000)
  assert.equal(uncapped.result.yearsForComp, 15)
  assert.equal(uncapped.result.compensationCents, 75000000)

  const belowTriple = severance.severanceTotal(
    baseInput({
      years: 15,
      months: 0,
      capEnabled: true,
      socialAverageCents: 1000000,
    }),
  )
  assert.equal(belowTriple.result.capped, false)
  assert.equal(belowTriple.result.yearsCapped, true)
  assert.equal(belowTriple.result.compensationCents, 24000000)

  const noSocial = severance.severanceTotal(
    baseInput({ capEnabled: true, socialAverageCents: 0 }),
  )
  assert.equal(noSocial.ok, false)
  assert.match(noSocial.error, /社平/)
})

test('离职补偿：年限 0、年假与非法参数', async () => {
  const severance = await loadSeverance()
  assert.equal(severance.severanceTotal(baseInput({ years: 0, months: 0 })).ok, false)
  assert.equal(severance.severanceTotal(baseInput({ monthlyCents: 0 })).ok, false)
  assert.equal(
    severance.severanceTotal(baseInput({ monthlyCents: 1000000001 })).ok,
    false,
  )
  assert.equal(severance.severanceTotal(baseInput({ years: 51 })).ok, false)
  assert.equal(severance.severanceTotal(baseInput({ months: 12 })).ok, false)
  assert.equal(severance.severanceTotal(baseInput({ unusedLeaveDays: 31 })).ok, false)
  assert.equal(severance.severanceTotal(baseInput({ unusedLeaveDays: 0.3 })).ok, false)
  assert.equal(severance.severanceTotal(baseInput({ mode: 'x' })).ok, false)
})

test('离职补偿契约：页面 / 注册 / 帮助 / jump 配置 / 来源 / 纯产出适配器', async () => {
  const app = JSON.parse(read('app.json'))
  const daily = app.subpackages.find((item) => item.root === 'subpackages/tools-daily')
  assert.ok(daily, 'app.json 缺少 tools-daily 分包')
  assert.ok(daily.pages.includes('pages/severance/index'), 'tools-daily 未注册离职补偿页面')

  for (const ext of ['.ts', '.json', '.wxml', '.wxss']) {
    assert.ok(
      fs.existsSync(path.join(ROOT, `subpackages/tools-daily/pages/severance/index${ext}`)),
      `缺少离职补偿页面文件 ${ext}`,
    )
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'subpackages/tools-daily/lib/severance.ts')))

  const pageJson = JSON.parse(read('subpackages/tools-daily/pages/severance/index.json'))
  assert.equal(pageJson.navigationBarTitleText, '离职补偿')

  const wxml = read('subpackages/tools-daily/pages/severance/index.wxml')
  assert.match(wxml, /tool-id="severance"/)
  assert.match(wxml, /bind:run="onRun"/)
  assert.match(wxml, /bindtap="onMode"/)
  assert.match(wxml, /bindtap="onCap"/)
  assert.match(wxml, /bindtap="onCopy"/)
  assert.match(wxml, /bindtap="onCopyRow"/)
  assert.match(wxml, /N\+1/)
  assert.match(wxml, /封顶/)
  assert.match(wxml, /年假/)
  assert.match(wxml, /不构成法律意见/)

  const ts = read('subpackages/tools-daily/pages/severance/index.ts')
  assert.match(ts, /onShareAppMessage\s*\(/)
  assert.match(ts, /onShareTimeline\s*\(/)
  assert.match(ts, /severanceTotal/)
  assert.match(ts, /severanceSummary/)
  assert.equal(/onReceiveWorkflow/.test(ts), false, '纯产出卡不应实现注入接口')
  assert.equal(/wx\.request|uploadFile|downloadFile/.test(ts), false, '离职补偿不得联网')
  assert.equal(/wx\./.test(read('subpackages/tools-daily/lib/severance.ts')), false, '引擎不得依赖 wx')

  const registry = read('core/toolbox/registry.ts')
  assert.match(registry, /id: 'severance'/)
  assert.match(registry, /name: '离职补偿'/)
  assert.match(registry, /weight: 70/)
  assert.match(registry, /sensitive: 'finance'/)
  assert.match(registry, /subpackages\/tools-daily\/pages\/severance\/index/)
  assert.match(read('subpackages/grow/lib/help.ts'), /severance: \{/)
  assert.match(read('scripts/check-budget.js'), /pages\/severance/)
  assert.match(read('scripts/e2e-tools.js'), /id: 'severance'/)

  const config = await import(`${URL_ROOT}core/workflow/workflowConfig.ts`)
  assert.equal(config.WORKFLOW_ROUTING.severance, 'jump')
  assert.deepEqual(config.WORKFLOW_ACCEPTS.severance, [])

  const source = await import(`${URL_ROOT}core/workflow/workflowSource.ts`)
  assert.deepEqual(source.WORKFLOW_SOURCE_KEYS.severance.text, ['severanceSummary'])

  const adapters = await import(`${URL_ROOT}core/workflow/workflowAdapters.ts`)
  const adapter = adapters.getWorkflowAdapter('severance')
  assert.ok(adapter, 'jump 工具必须有适配器')
  assert.equal(adapter.hasInput({}), false)
  assert.equal(adapter.isReady({}), false)
  assert.equal(await adapter.apply({}, { type: 'text', payload: 'x' }), false)
  assert.equal(read('core/workflow/workflowSilent.ts').includes("case 'severance'"), false)
})
