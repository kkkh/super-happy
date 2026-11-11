/* ==========================================================================
   批 2 · 车贷计算（carloan）
   - 引擎：与 loan 交叉校验、首付=车价、利率 0、本金首末月、期限边界
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

async function loadEngines() {
  const carloan = await import(`${URL_ROOT}subpackages/tools-daily/lib/carloan.ts`)
  const loan = await import(`${URL_ROOT}core/toolbox/engines/loan.ts`)
  return { carloan, loan }
}

test('车贷：与 loan 同参数结果完全一致', async () => {
  const { carloan, loan } = await loadEngines()
  const car = carloan.carLoanPlan({
    carPriceCents: 20000000,
    downPaymentPercent: 20,
    termMonths: 36,
    annualRateBp: 450,
    mode: 'equal-payment',
  })
  assert.ok(car)
  const direct = loan.planLoan({
    principalCents: 16000000,
    annualRateBp: 450,
    periods: 36,
    mode: 'equal-payment',
    scheduleLimit: 12,
  })
  assert.ok(direct)
  assert.equal(car.downPaymentCents, 4000000)
  assert.equal(car.loanCents, 16000000)
  assert.equal(car.monthlyCents, direct.monthlyCents)
  assert.equal(car.firstCents, direct.firstCents)
  assert.equal(car.lastCents, direct.lastCents)
  assert.equal(car.totalCents, direct.totalCents)
  assert.equal(car.interestCents, direct.interestCents)
  assert.deepEqual(car.schedule, direct.schedule)
})

test('车贷：等额本金首月高于末月', async () => {
  const { carloan } = await loadEngines()
  const plan = carloan.carLoanPlan({
    carPriceCents: 20000000,
    downPaymentCents: 4000000,
    termMonths: 36,
    annualRateBp: 450,
    mode: 'equal-principal',
  })
  assert.ok(plan)
  assert.ok(plan.firstCents > plan.lastCents)
  assert.equal(plan.monthlyCents, 0)
  assert.equal(plan.schedule.length, 12)
})

test('车贷：首付等于或超过车价拒绝', async () => {
  const { carloan } = await loadEngines()
  const base = {
    carPriceCents: 20000000,
    termMonths: 36,
    annualRateBp: 450,
    mode: 'equal-payment',
  }
  assert.equal(carloan.carLoanPlan({ ...base, downPaymentCents: 20000000 }), null)
  assert.equal(carloan.carLoanPlan({ ...base, downPaymentCents: 21000000 }), null)
  assert.equal(carloan.carLoanPlan({ ...base, downPaymentPercent: 100 }), null)
})

test('车贷：利率 0 时月供只摊本金', async () => {
  const { carloan } = await loadEngines()
  const plan = carloan.carLoanPlan({
    carPriceCents: 12000000,
    downPaymentCents: 0,
    termMonths: 24,
    annualRateBp: 0,
    mode: 'equal-payment',
  })
  assert.ok(plan)
  assert.equal(plan.monthlyCents, 500000)
  assert.equal(plan.totalCents, 12000000)
  assert.equal(plan.interestCents, 0)
})

test('车贷：期限 0 / 361 / 首付比例超界拒绝', async () => {
  const { carloan } = await loadEngines()
  const base = {
    carPriceCents: 20000000,
    downPaymentCents: 4000000,
    annualRateBp: 450,
    mode: 'equal-payment',
  }
  assert.equal(carloan.carLoanPlan({ ...base, termMonths: 0 }), null)
  assert.equal(carloan.carLoanPlan({ ...base, termMonths: 361 }), null)
  assert.equal(
    carloan.carLoanPlan({
      carPriceCents: 20000000,
      downPaymentPercent: 101,
      termMonths: 36,
      annualRateBp: 450,
      mode: 'equal-payment',
    }),
    null,
  )
})

test('车贷输入解析：车价转分，期限 / 利率 / 首付错误定位', async () => {
  const { carloan } = await loadEngines()
  assert.equal(carloan.parseCarLoanPrice('200000'), 20000000)
  assert.equal(carloan.parseCarLoanPrice('0'), null)
  assert.equal(carloan.parseCarLoanPrice('-1'), null)
  assert.equal(carloan.parseCarLoanPrice('abc'), null)

  const base = {
    downPercentText: '30',
    downAmountText: '',
    termText: '36',
    rateText: '4.5',
    mode: 'equal-payment',
  }
  const ok = carloan.parseCarLoanScheme({ ...base, downMode: 'percent' })
  assert.equal(ok.ok, true)
  assert.equal(ok.scheme.downPaymentPercent, 30)

  const badTerm = carloan.parseCarLoanScheme({ ...base, downMode: 'percent', termText: '0' })
  assert.equal(badTerm.ok, false)
  assert.match(badTerm.error, /1–360/)
  const badRate = carloan.parseCarLoanScheme({ ...base, downMode: 'percent', rateText: '25' })
  assert.equal(badRate.ok, false)
  assert.match(badRate.error, /0–24%/)
  const badPercent = carloan.parseCarLoanScheme({ ...base, downMode: 'percent', downPercentText: '100' })
  assert.equal(badPercent.ok, false)
  assert.match(badPercent.error, /99\.99%/)
  const badAmount = carloan.parseCarLoanScheme({ ...base, downMode: 'amount', downAmountText: '' })
  assert.equal(badAmount.ok, false)
  assert.match(badAmount.error, /首付金额/)
})

test('车贷对比：两方案独立计算，差额与更省标记正确', async () => {
  const { carloan, loan } = await loadEngines()
  const result = carloan.compareCarLoan({
    carPriceCents: 20000000,
    schemeA: {
      downPaymentPercent: 30,
      termMonths: 36,
      annualRateBp: 450,
      mode: 'equal-payment',
    },
    schemeB: {
      downPaymentPercent: 20,
      termMonths: 24,
      annualRateBp: 390,
      mode: 'equal-payment',
    },
  })
  assert.ok(result)
  assert.equal(result.schemeA.loanCents, 14000000)
  assert.equal(result.schemeB.loanCents, 16000000)
  const directA = loan.planLoan({
    principalCents: 14000000,
    annualRateBp: 450,
    periods: 36,
    mode: 'equal-payment',
    scheduleLimit: 12,
  })
  const directB = loan.planLoan({
    principalCents: 16000000,
    annualRateBp: 390,
    periods: 24,
    mode: 'equal-payment',
    scheduleLimit: 12,
  })
  assert.ok(directA && directB)
  assert.equal(result.schemeA.monthlyCents, directA.monthlyCents)
  assert.equal(result.schemeB.monthlyCents, directB.monthlyCents)
  assert.equal(
    result.monthlyDiffCents,
    result.schemeA.monthlyCents - result.schemeB.monthlyCents,
  )
  assert.equal(
    result.interestDiffCents,
    result.schemeA.interestCents - result.schemeB.interestCents,
  )
  assert.equal(
    result.cheaper,
    result.interestDiffCents > 0 ? 'b' : result.interestDiffCents < 0 ? 'a' : 'tie',
  )
  const summary = carloan.carLoanCompareSummary(result)
  assert.match(summary, /方案 A：/)
  assert.match(summary, /方案 B：/)
  assert.match(summary, /省利息|总利息相同/)
})

test('车贷对比：任一方案非法返回 null', async () => {
  const { carloan } = await loadEngines()
  const scheme = {
    downPaymentPercent: 30,
    termMonths: 36,
    annualRateBp: 450,
    mode: 'equal-payment',
  }
  assert.equal(
    carloan.compareCarLoan({
      carPriceCents: 20000000,
      schemeA: scheme,
      schemeB: { ...scheme, downPaymentPercent: 100 },
    }),
    null,
  )
})

test('车贷提前还款：剩余本金、新月供与节省利息可交叉校验', async () => {
  const { carloan, loan } = await loadEngines()
  const result = carloan.prepayCarLoan({
    carPriceCents: 20000000,
    downPaymentPercent: 30,
    termMonths: 36,
    annualRateBp: 450,
    mode: 'equal-payment',
    prepayAfterPeriod: 12,
    prepayCents: 5000000,
  })
  assert.ok(result)
  const prefix = loan.planLoan({
    principalCents: 14000000,
    annualRateBp: 450,
    periods: 36,
    mode: 'equal-payment',
    scheduleLimit: 12,
  })
  assert.ok(prefix)
  const remaining = prefix.schedule[11].balanceCents
  const paidInterest = prefix.schedule.reduce((sum, row) => sum + row.interestCents, 0)
  const next = loan.planLoan({
    principalCents: remaining - 5000000,
    annualRateBp: 450,
    periods: 24,
    mode: 'equal-payment',
    scheduleLimit: 1,
  })
  assert.ok(next)
  assert.equal(result.remainingBeforeCents, remaining)
  assert.equal(result.remainingAfterCents, remaining - 5000000)
  assert.equal(result.remainingPeriods, 24)
  assert.equal(result.monthlyPaymentCents, prefix.monthlyCents)
  assert.equal(result.newMonthlyPaymentCents, next.monthlyCents)
  assert.equal(result.monthlySavedCents, prefix.monthlyCents - next.monthlyCents)
  assert.equal(result.savedInterestCents, result.plan.interestCents - paidInterest - next.interestCents)
  assert.equal(result.newInterestCents, paidInterest + next.interestCents)
  assert.ok(result.savedInterestCents > 0)
  assert.ok(result.monthlySavedCents > 0)
  assert.match(carloan.carLoanPrepaySummary(result), /节省利息/)
})

test('车贷提前还款：0 利率只减月供、不省利息；非法时点与金额拒绝', async () => {
  const { carloan } = await loadEngines()
  const result = carloan.prepayCarLoan({
    carPriceCents: 12000000,
    downPaymentCents: 0,
    termMonths: 24,
    annualRateBp: 0,
    mode: 'equal-payment',
    prepayAfterPeriod: 12,
    prepayCents: 1000000,
  })
  assert.ok(result)
  assert.equal(result.remainingBeforeCents, 6000000)
  assert.equal(result.newMonthlyPaymentCents, 416667)
  assert.equal(result.monthlySavedCents, 83333)
  assert.equal(result.savedInterestCents, 0)

  const base = {
    carPriceCents: 20000000,
    downPaymentCents: 4000000,
    termMonths: 36,
    annualRateBp: 450,
    mode: 'equal-payment',
  }
  assert.equal(carloan.prepayCarLoan({ ...base, prepayAfterPeriod: 0, prepayCents: 100 }), null)
  assert.equal(carloan.prepayCarLoan({ ...base, prepayAfterPeriod: 36, prepayCents: 100 }), null)
  assert.equal(carloan.prepayCarLoan({ ...base, prepayAfterPeriod: 12, prepayCents: 0 }), null)
  assert.equal(
    carloan.prepayCarLoan({
      ...base,
      prepayAfterPeriod: 12,
      prepayCents: 999999999999,
    }),
    null,
  )
})

test('车贷契约：页面 / 注册 / 帮助 / jump 工作流 / 适配器 / 包体清单', async () => {
  const app = JSON.parse(read('app.json'))
  const daily = app.subpackages.find((item) => item.root === 'subpackages/tools-daily')
  assert.ok(daily.pages.includes('pages/carloan/index'), 'app.json 未注册页面')

  for (const ext of ['.ts', '.json', '.wxml', '.wxss']) {
    assert.ok(
      fs.existsSync(path.join(ROOT, `subpackages/tools-daily/pages/carloan/index${ext}`)),
      `缺少页面文件 ${ext}`,
    )
  }

  const wxml = read('subpackages/tools-daily/pages/carloan/index.wxml')
  assert.match(wxml, /tool-id="carloan"/)
  assert.match(wxml, /bind:run="onRun"/)
  assert.match(wxml, /poster-data="\{\{posterData\}\}"/)
  assert.match(wxml, /bindtap="onCopy"/)
  assert.match(wxml, /bindtap="onToggleSchedule"/)
  assert.match(wxml, /data-mode="compare"/)
  assert.match(wxml, /onCalcMode/)
  assert.match(wxml, /onPrepayToggle/)
  assert.match(wxml, /prepayOn/)

  const ts = read('subpackages/tools-daily/pages/carloan/index.ts')
  assert.match(ts, /onShareAppMessage\s*\(/)
  assert.match(ts, /onShareTimeline\s*\(/)
  assert.match(ts, /carLoanPlan/)
  assert.match(ts, /compareCarLoan/)
  assert.match(ts, /prepayCarLoan/)
  assert.match(ts, /onCalcMode/)
  assert.match(ts, /onPrepayToggle/)
  assert.match(ts, /onReceiveWorkflow\s*\(/)
  assert.equal(/wx\.request|uploadFile|downloadFile/.test(ts), false)

  const registry = read('core/toolbox/registry.ts')
  assert.match(registry, /id: 'carloan'/)
  assert.match(registry, /weight: 86/)
  assert.match(read('subpackages/grow/lib/help.ts'), /carloan: \{/)
  assert.match(read('subpackages/grow/lib/help.ts'), /提前还款/)
  assert.match(read('scripts/check-budget.js'), /pages\/carloan/)
  assert.match(read('scripts/e2e-tools.js'), /id: 'carloan'/)

  const config = await import(`${URL_ROOT}core/workflow/workflowConfig.ts`)
  assert.equal(config.WORKFLOW_ROUTING.carloan, 'jump')
  assert.deepEqual(config.WORKFLOW_ACCEPTS.carloan, ['text'])

  const source = await import(`${URL_ROOT}core/workflow/workflowSource.ts`)
  assert.deepEqual(source.WORKFLOW_SOURCE_KEYS.carloan.text, ['carloanSummary'])

  const adapters = await import(`${URL_ROOT}core/workflow/workflowAdapters.ts`)
  assert.ok(adapters.getWorkflowAdapter('carloan'), '缺少 carloan 跳转适配器')
})
