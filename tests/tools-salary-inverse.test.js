/* ==========================================================================
   批 3 · 薪资反算（salary-inverse）
   - 引擎：个税上移 / 反算后正算 ≤0.01 / 比例与固定金额 / 边界 / 不收敛
   - 契约：tools-daily / 页面 / 注册 / 帮助 / 文本工作流 / 适配器 / 个税引擎
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

async function loadSalary() {
  return import(`${URL_ROOT}subpackages/tools-daily/lib/salary.ts`)
}

async function loadTax() {
  return import(`${URL_ROOT}core/toolbox/engines/tax.ts`)
}

const BASE_INPUT = {
  targetNetCents: 1000000,
  insuranceMode: 'ratio',
  insuranceRatio: 10.5,
  insuranceFixedCents: 0,
  specialCents: 100000,
}

test('个税引擎：月度 / 年度黄金值与非法输入', async () => {
  const tax = await loadTax()
  const monthly = tax.calcTax({
    mode: 'monthly',
    incomeCents: 1500000,
    insuranceCents: 200000,
    specialCents: 100000,
  })
  assert.ok(monthly)
  assert.equal(monthly.taxableCents, 700000)
  assert.equal(monthly.taxCents, 49000)
  assert.equal(monthly.netCents, 1251000)
  assert.equal(monthly.bracketIndex, 1)

  const annual = tax.calcTax({ mode: 'annual', incomeCents: 12000000 })
  assert.ok(annual)
  assert.equal(annual.taxableCents, 6000000)
  assert.equal(annual.taxCents, 348000)
  assert.equal(annual.netCents, 11652000)

  assert.equal(tax.calcTax({ mode: 'monthly', incomeCents: 0 }), null)
  assert.equal(
    tax.calcTax({ mode: 'monthly', incomeCents: 100000, insuranceCents: 100001 }),
    null,
  )
})

test('薪资反算：按比例反算后再正算，误差 ≤1 分', async () => {
  const salary = await loadSalary()
  const result = salary.inverseSalary(BASE_INPUT)
  assert.ok(result)
  assert.equal(result.targetNetCents, 1000000)
  assert.equal(result.grossCents, 1140906)
  assert.equal(result.insuranceCents, 119795)
  assert.equal(result.taxCents, 21111)
  assert.equal(result.netCents, 1000000)
  assert.ok(result.iterations > 0 && result.iterations <= 60)
  assert.equal(Math.abs(result.netCents - result.targetNetCents) <= 1, true)
  assert.match(result.summary, /目标到手/)
  assert.match(result.summary, /税前月薪/)
  assert.match(result.summary, /不按累计预扣/)

  const forward = salary.forwardSalaryNet(result.grossCents, BASE_INPUT)
  assert.ok(forward)
  assert.equal(forward.netCents, result.netCents)
})

test('薪资反算：固定金额、边界与不收敛', async () => {
  const salary = await loadSalary()
  const fixed = salary.inverseSalary({
    ...BASE_INPUT,
    insuranceMode: 'fixed',
    insuranceFixedCents: 200000,
    insuranceRatio: 0,
  })
  assert.ok(fixed)
  assert.equal(fixed.grossCents, 1221111)
  assert.equal(fixed.insuranceCents, 200000)
  assert.equal(fixed.netCents, 1000000)

  assert.equal(salary.inverseSalary({ ...BASE_INPUT, targetNetCents: 0 }), null)
  assert.equal(salary.inverseSalary({ ...BASE_INPUT, insuranceRatio: 101 }), null)
  assert.equal(salary.inverseSalary({ ...BASE_INPUT, insuranceRatio: 100 }), null)
  assert.equal(salary.inverseSalary({ ...BASE_INPUT, targetNetCents: 90000000 }), null)
  assert.equal(salary.inverseSalary({ ...BASE_INPUT, maxIter: 1 }), null)

  assert.equal(salary.parseSalaryWorkflowAmount('目标到手 12,345.67 元'), 1234567)
  assert.equal(salary.parseSalaryWorkflowAmount('没有数字'), null)
})

test('薪资反算契约：页面 / 注册 / 帮助 / 文本工作流 / 适配器 / 个税上移', async () => {
  const app = JSON.parse(read('app.json'))
  const daily = app.subpackages.find((item) => item.root === 'subpackages/tools-daily')
  assert.ok(daily, 'app.json 缺少 tools-daily 分包')
  assert.ok(daily.pages.includes('pages/salary-inverse/index'), 'tools-daily 未注册薪资反算页面')

  for (const ext of ['.ts', '.json', '.wxml', '.wxss']) {
    assert.ok(
      fs.existsSync(path.join(ROOT, `subpackages/tools-daily/pages/salary-inverse/index${ext}`)),
      `缺少薪资反算页面文件 ${ext}`,
    )
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'subpackages/tools-daily/lib/salary.ts')))
  assert.ok(fs.existsSync(path.join(ROOT, 'core/toolbox/engines/tax.ts')))

  const pageJson = JSON.parse(read('subpackages/tools-daily/pages/salary-inverse/index.json'))
  assert.equal(pageJson.navigationBarTitleText, '薪资反算')

  const wxml = read('subpackages/tools-daily/pages/salary-inverse/index.wxml')
  assert.match(wxml, /tool-id="salary-inverse"/)
  assert.match(wxml, /bindtap="onMode"/)
  assert.match(wxml, /bind:run="onRun"/)
  assert.match(wxml, /bindtap="onCopy"/)
  assert.match(wxml, /月度简化口径/)
  assert.match(wxml, /不按累计预扣/)

  const ts = read('subpackages/tools-daily/pages/salary-inverse/index.ts')
  assert.match(ts, /onShareAppMessage\s*\(/)
  assert.match(ts, /onShareTimeline\s*\(/)
  assert.match(ts, /inverseSalary/)
  assert.match(ts, /onReceiveWorkflow/)
  assert.equal(/wx\.request|uploadFile|downloadFile/.test(ts), false, '薪资反算不得联网')

  const taxPage = read('subpackages/tools-core/pages/tax/index.ts')
  assert.match(taxPage, /core\/toolbox\/engines\/tax/)
  assert.equal(/const MONTHLY_BRACKETS/.test(taxPage), false, '个税页不得保留重复税率表')

  const registry = read('core/toolbox/registry.ts')
  assert.match(registry, /id: 'salary-inverse'/)
  assert.match(registry, /name: '薪资反算'/)
  assert.match(registry, /weight: 67/)
  assert.match(registry, /sensitive: 'finance'/)
  assert.match(registry, /subpackages\/tools-daily\/pages\/salary-inverse\/index/)
  assert.match(read('subpackages/grow/lib/help.ts'), /'salary-inverse': \{/)
  assert.match(read('scripts/check-budget.js'), /pages\/salary-inverse/)
  assert.match(read('scripts/e2e-tools.js'), /id: 'salary-inverse'/)

  const config = await import(`${URL_ROOT}core/workflow/workflowConfig.ts`)
  assert.equal(config.WORKFLOW_ROUTING['salary-inverse'], 'jump')
  assert.deepEqual(config.WORKFLOW_ACCEPTS['salary-inverse'], ['text'])

  const source = await import(`${URL_ROOT}core/workflow/workflowSource.ts`)
  assert.deepEqual(source.WORKFLOW_SOURCE_KEYS['salary-inverse'].text, ['salarySummary'])

  const adapters = await import(`${URL_ROOT}core/workflow/workflowAdapters.ts`)
  assert.ok(adapters.getWorkflowAdapter('salary-inverse'), '缺少 salary-inverse 文本适配器')
})
