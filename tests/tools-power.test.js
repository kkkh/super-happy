/* ==========================================================================
   批 2 · 电费估算（power）
   - 引擎：30 度、两档分段、阶梯非递增、超最高档、零值边界
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
  return import(`${URL_ROOT}subpackages/tools-daily/lib/power.ts`)
}

test('电费：1000W × 1h × 30 天 = 30 度', async () => {
  const power = await loadEngine()
  const result = power.powerBill({
    powerW: 1000,
    hoursPerDay: 1,
    days: 30,
    pricePerKwh: 0.6,
  })
  assert.ok(result)
  assert.equal(result.totalKwh, 30)
  assert.equal(result.averageDailyKwh, 1)
  assert.equal(result.totalCost, 18)
  assert.match(power.powerSummaryText(result), /30\.00 度/)
})

test('电费：两档阶梯分段计价', async () => {
  const power = await loadEngine()
  const result = power.powerBill({
    powerW: 5000,
    hoursPerDay: 1,
    days: 30,
    tiers: [
      { limitKwh: 100, pricePerKwh: 0.5 },
      { limitKwh: null, pricePerKwh: 0.8 },
    ],
  })
  assert.ok(result)
  assert.equal(result.totalKwh, 150)
  assert.equal(result.totalCost, 90)
  assert.deepEqual(
    result.slices.map((slice) => slice.kwh),
    [100, 50],
  )
  assert.equal(result.aboveHighest, false)
})

test('电费：阶梯上限非递增返回 null', async () => {
  const power = await loadEngine()
  assert.equal(
    power.powerBill({
      powerW: 1000,
      hoursPerDay: 1,
      days: 30,
      tiers: [
        { limitKwh: 100, pricePerKwh: 0.5 },
        { limitKwh: 80, pricePerKwh: 0.8 },
      ],
    }),
    null,
  )
  assert.equal(
    power.powerBill({
      powerW: 1000,
      hoursPerDay: 1,
      days: 30,
      tiers: [
        { limitKwh: null, pricePerKwh: 0.5 },
        { limitKwh: 100, pricePerKwh: 0.8 },
      ],
    }),
    null,
  )
})

test('电费：超出最高档按末档单价并提示', async () => {
  const power = await loadEngine()
  const result = power.powerBill({
    powerW: 1000,
    hoursPerDay: 1,
    days: 30,
    tiers: [
      { limitKwh: 10, pricePerKwh: 0.5 },
      { limitKwh: 20, pricePerKwh: 0.8 },
    ],
  })
  assert.ok(result)
  assert.equal(result.totalKwh, 30)
  assert.equal(result.totalCost, 21)
  assert.equal(result.aboveHighest, true)
  assert.match(power.powerSummaryText(result), /超出最高档/)
})

test('电费：功率 / 时长 / 天数为 0 返回 null', async () => {
  const power = await loadEngine()
  const base = { powerW: 1000, hoursPerDay: 1, days: 30, pricePerKwh: 0.6 }
  assert.equal(power.powerBill({ ...base, powerW: 0 }), null)
  assert.equal(power.powerBill({ ...base, hoursPerDay: 0 }), null)
  assert.equal(power.powerBill({ ...base, days: 0 }), null)
})

test('水费 / 燃气费：平价 + 基础费', async () => {
  const power = await loadEngine()
  const water = power.utilityBill({
    kind: 'water',
    usage: 10,
    pricePerUnit: 3.5,
    baseFee: 5,
  })
  assert.ok(water)
  assert.equal(water.mode, 'flat')
  assert.equal(water.usage, 10)
  assert.equal(water.totalCost, 35)
  assert.equal(water.baseFee, 5)
  assert.equal(water.totalWithFee, 40)
  assert.match(power.utilitySummaryText(water), /用水 10\.00 吨/)
  assert.match(power.utilitySummaryText(water), /合计 40\.00 元/)

  const gas = power.utilityBill({ kind: 'gas', usage: 8, pricePerUnit: 2.8 })
  assert.ok(gas)
  assert.equal(gas.totalCost, 22.4)
  assert.equal(gas.totalWithFee, 22.4)
  assert.match(power.utilitySummaryText(gas), /用气 8\.00 m³/)
})

test('水费 / 燃气费：阶梯费率与超最高档', async () => {
  const power = await loadEngine()
  const water = power.utilityBill({
    kind: 'water',
    usage: 30,
    tiers: [
      { limitKwh: 10, pricePerKwh: 2 },
      { limitKwh: 20, pricePerKwh: 3 },
    ],
    baseFee: 2,
  })
  assert.ok(water)
  assert.equal(water.mode, 'tier')
  assert.equal(water.totalCost, 80)
  assert.equal(water.totalWithFee, 82)
  assert.equal(water.aboveHighest, true)
  assert.deepEqual(
    water.slices.map((slice) => slice.amount),
    [10, 10, 10],
  )

  const gas = power.utilityBill({
    kind: 'gas',
    usage: 12,
    tiers: [
      { limitKwh: 10, pricePerKwh: 2 },
      { limitKwh: null, pricePerKwh: 3 },
    ],
  })
  assert.ok(gas)
  assert.equal(gas.totalCost, 26)
  assert.equal(gas.aboveHighest, false)
})

test('水费 / 燃气费：非法模式 / 用量 / 基础费 / 费率返回 null', async () => {
  const power = await loadEngine()
  assert.equal(
    power.utilityBill({ kind: 'electric', usage: 10, pricePerUnit: 3 }),
    null,
  )
  assert.equal(power.utilityBill({ kind: 'water', usage: 0, pricePerUnit: 3 }), null)
  assert.equal(
    power.utilityBill({ kind: 'water', usage: 10, pricePerUnit: 3, baseFee: -1 }),
    null,
  )
  assert.equal(power.utilityBill({ kind: 'water', usage: 10, pricePerUnit: -1 }), null)
  assert.equal(
    power.utilityBill({
      kind: 'gas',
      usage: 10,
      tiers: [
        { limitKwh: 20, pricePerKwh: 2 },
        { limitKwh: 10, pricePerKwh: 3 },
      ],
    }),
    null,
  )
})

test('电费契约：页面 / 注册 / 帮助 / jump 工作流 / 适配器 / 包体清单', async () => {
  const app = JSON.parse(read('app.json'))
  const daily = app.subpackages.find((item) => item.root === 'subpackages/tools-daily')
  assert.ok(daily.pages.includes('pages/power/index'), 'app.json 未注册页面')

  for (const ext of ['.ts', '.json', '.wxml', '.wxss']) {
    assert.ok(
      fs.existsSync(path.join(ROOT, `subpackages/tools-daily/pages/power/index${ext}`)),
      `缺少页面文件 ${ext}`,
    )
  }

  const wxml = read('subpackages/tools-daily/pages/power/index.wxml')
  assert.match(wxml, /tool-id="power"/)
  assert.match(wxml, /bind:run="onRun"/)
  assert.match(wxml, /poster-data="\{\{posterData\}\}"/)
  assert.match(wxml, /bindtap="onCopy"/)
  assert.match(wxml, /data-mode="\{\{item.key\}\}"/)
  assert.match(wxml, /usageText/)
  assert.match(wxml, /baseFeeText/)
  assert.match(wxml, /wx:if="\{\{hasTiers\}\}"/)
  assert.match(wxml, /wx:if="\{\{aboveHighest\}\}"/)

  const ts = read('subpackages/tools-daily/pages/power/index.ts')
  assert.match(ts, /onShareAppMessage\s*\(/)
  assert.match(ts, /onShareTimeline\s*\(/)
  assert.match(ts, /powerBill/)
  assert.match(ts, /utilityBill/)
  assert.match(ts, /runUtility/)
  assert.match(ts, /onReceiveWorkflow\s*\(/)
  assert.equal(/wx\.request|uploadFile|downloadFile/.test(ts), false)

  const registry = read('core/toolbox/registry.ts')
  assert.match(registry, /id: 'power'/)
  assert.match(registry, /name: '水电燃气费'/)
  assert.match(registry, /weight: 68/)
  assert.match(read('subpackages/grow/lib/help.ts'), /power: \{/)
  assert.match(read('scripts/check-budget.js'), /pages\/power/)
  assert.match(read('scripts/e2e-tools.js'), /id: 'power'/)

  const config = await import(`${URL_ROOT}core/workflow/workflowConfig.ts`)
  assert.equal(config.WORKFLOW_ROUTING.power, 'jump')
  assert.deepEqual(config.WORKFLOW_ACCEPTS.power, ['text'])

  const source = await import(`${URL_ROOT}core/workflow/workflowSource.ts`)
  assert.deepEqual(source.WORKFLOW_SOURCE_KEYS.power.text, ['powerSummary'])

  const adapters = await import(`${URL_ROOT}core/workflow/workflowAdapters.ts`)
  assert.ok(adapters.getWorkflowAdapter('power'), '缺少 power 跳转适配器')
})
