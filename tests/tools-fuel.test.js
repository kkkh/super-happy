/* ==========================================================================
   批 2 · 油耗计算（fuel）
   - 引擎：500/40→8.00、油价 8→0.64/km、油价空隐藏费用、里程 0、极大值
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
  return import(`${URL_ROOT}subpackages/tools-daily/lib/fuel.ts`)
}

test('油耗：500 km / 40 L → 8.00 L/100km', async () => {
  const fuel = await loadEngine()
  const result = fuel.calcFuel({ distanceKm: 500, liters: 40 })
  assert.ok(result)
  assert.equal(result.consumption, 8)
  assert.equal(result.costPerKm, null)
  assert.equal(result.totalCost, null)
  assert.match(fuel.fuelSummaryText(result), /8\.00 L\/100km/)
})

test('油耗：油价 8 元 → 每公里 0.64 元、总油费 320 元', async () => {
  const fuel = await loadEngine()
  const result = fuel.calcFuel({ distanceKm: 500, liters: 40, pricePerLiter: 8 })
  assert.ok(result)
  assert.equal(result.costPerKm, 0.64)
  assert.equal(result.totalCost, 320)
  const summary = fuel.fuelSummaryText(result)
  assert.match(summary, /0\.64 元\/km/)
  assert.match(summary, /320\.00 元/)
})

test('油耗：油价为空时只显示油耗并隐藏费用', async () => {
  const fuel = await loadEngine()
  const result = fuel.calcFuel({ distanceKm: 300, liters: 24 })
  assert.ok(result)
  assert.equal(result.pricePerLiter, null)
  assert.equal(result.costPerKm, null)
  assert.equal(result.totalCost, null)
  assert.equal(/元/.test(fuel.fuelSummaryText(result)), false)
})

test('油耗：里程 0 / 负值 / 加油量 0 返回 null', async () => {
  const fuel = await loadEngine()
  assert.equal(fuel.calcFuel({ distanceKm: 0, liters: 40 }), null)
  assert.equal(fuel.calcFuel({ distanceKm: -1, liters: 40 }), null)
  assert.equal(fuel.calcFuel({ distanceKm: 500, liters: 0 }), null)
})

test('油耗：极大里程提示复核但仍计算', async () => {
  const fuel = await loadEngine()
  const result = fuel.calcFuel({ distanceKm: 12000, liters: 900, pricePerLiter: 7.5 })
  assert.ok(result)
  assert.equal(result.consumption, 7.5)
  assert.match(fuel.fuelSummaryText(result), /复核/)
})

test('油耗契约：页面 / 注册 / 帮助 / jump 工作流 / 适配器 / 包体清单', async () => {
  const app = JSON.parse(read('app.json'))
  const daily = app.subpackages.find((item) => item.root === 'subpackages/tools-daily')
  assert.ok(daily.pages.includes('pages/fuel/index'), 'app.json 未注册页面')

  for (const ext of ['.ts', '.json', '.wxml', '.wxss']) {
    assert.ok(
      fs.existsSync(path.join(ROOT, `subpackages/tools-daily/pages/fuel/index${ext}`)),
      `缺少页面文件 ${ext}`,
    )
  }

  const wxml = read('subpackages/tools-daily/pages/fuel/index.wxml')
  assert.match(wxml, /tool-id="fuel"/)
  assert.match(wxml, /bind:run="onRun"/)
  assert.match(wxml, /poster-data="\{\{posterData\}\}"/)
  assert.match(wxml, /bindtap="onCopy"/)
  assert.match(wxml, /wx:if="\{\{hasPrice\}\}"/)

  const ts = read('subpackages/tools-daily/pages/fuel/index.ts')
  assert.match(ts, /onShareAppMessage\s*\(/)
  assert.match(ts, /onShareTimeline\s*\(/)
  assert.match(ts, /calcFuel/)
  assert.match(ts, /onReceiveWorkflow\s*\(/)
  assert.equal(/wx\.request|uploadFile|downloadFile/.test(ts), false)

  const registry = read('core/toolbox/registry.ts')
  assert.match(registry, /id: 'fuel'/)
  assert.match(registry, /weight: 72/)
  assert.match(read('subpackages/grow/lib/help.ts'), /fuel: \{/)
  assert.match(read('scripts/check-budget.js'), /pages\/fuel/)
  assert.match(read('scripts/e2e-tools.js'), /id: 'fuel'/)

  const config = await import(`${URL_ROOT}core/workflow/workflowConfig.ts`)
  assert.equal(config.WORKFLOW_ROUTING.fuel, 'jump')
  assert.deepEqual(config.WORKFLOW_ACCEPTS.fuel, ['text'])

  const source = await import(`${URL_ROOT}core/workflow/workflowSource.ts`)
  assert.deepEqual(source.WORKFLOW_SOURCE_KEYS.fuel.text, ['fuelSummary'])

  const adapters = await import(`${URL_ROOT}core/workflow/workflowAdapters.ts`)
  assert.ok(adapters.getWorkflowAdapter('fuel'), '缺少 fuel 跳转适配器')
})
