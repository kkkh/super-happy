/* ==========================================================================
   批 2 · 报价单（quote）
   - 引擎：合计守恒、税额进位、优惠后税额、大写一致、空明细、CSV 转义
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
  const quote = await import(`${URL_ROOT}subpackages/tools-daily/lib/quote.ts`)
  const rmb = await import(`${URL_ROOT}core/toolbox/engines/rmb.ts`)
  return { quote, rmb }
}

test('报价：行小计先舍入，合计等于各行小计之和', async () => {
  const { quote } = await loadEngines()
  const result = quote.quoteTotals([
    { name: 'A', quantity: 3, unitPriceCents: 1999 },
    { name: 'B', quantity: 1, unitPriceCents: 1 },
    { name: 'C', quantity: 1.01, unitPriceCents: 1999 },
  ])
  assert.ok(result)
  assert.deepEqual(
    result.rows.map((row) => row.subtotalCents),
    [5997, 1, 2019],
  )
  assert.equal(result.totalCents, 8017)
  assert.equal(
    result.totalCents,
    result.rows.reduce((sum, row) => sum + row.subtotalCents, 0),
  )
})

test('报价：税额四舍五入到分', async () => {
  const { quote } = await loadEngines()
  const result = quote.quoteTotals([{ name: '服务', quantity: 1, unitPriceCents: 10001 }], 6)
  assert.ok(result)
  assert.equal(result.taxCents, 600)
  assert.equal(result.payableCents, 10601)
})

test('报价：先优惠后计税，优惠超合计封顶', async () => {
  const { quote } = await loadEngines()
  const result = quote.quoteTotals([{ name: '服务', quantity: 1, unitPriceCents: 10000 }], 6, 1000)
  assert.ok(result)
  assert.equal(result.afterDiscountCents, 9000)
  assert.equal(result.taxCents, 540)
  assert.equal(result.payableCents, 9540)
  assert.equal(result.discountClamped, false)

  const clamped = quote.quoteTotals([{ name: '服务', quantity: 1, unitPriceCents: 5000 }], null, 8000)
  assert.ok(clamped)
  assert.equal(clamped.discountCents, 5000)
  assert.equal(clamped.discountClamped, true)
  assert.equal(clamped.payableCents, 0)
})

test('报价：大写与 rmb 引擎一致', async () => {
  const { quote, rmb } = await loadEngines()
  const result = quote.quoteTotals([{ name: '套餐', quantity: 1, unitPriceCents: 123456 }])
  assert.ok(result)
  assert.equal(result.chinese, rmb.centsToChinese(123456))
  assert.equal(result.chinese, '壹仟贰佰叁拾肆元伍角陆分')
})

test('报价：空明细 / 数量 0 / 税率超界 / 行数超限返回 null', async () => {
  const { quote } = await loadEngines()
  assert.equal(quote.quoteTotals([]), null)
  assert.equal(quote.quoteTotals([{ name: 'A', quantity: 0, unitPriceCents: 100 }]), null)
  assert.equal(quote.quoteTotals([{ name: 'A', quantity: 1, unitPriceCents: 100 }], 101), null)
  const rows = Array.from({ length: 51 }, (_, index) => ({
    name: `行 ${index}`,
    quantity: 1,
    unitPriceCents: 100,
  }))
  assert.equal(quote.quoteTotals(rows), null)
})

test('报价：CSV 转义与“非发票”文案', async () => {
  const { quote } = await loadEngines()
  const result = quote.quoteTotals([
    { name: '套餐, "A"\n第二行', quantity: 2, unitPriceCents: 1000 },
    { name: '=1+1', quantity: 1, unitPriceCents: 500 },
  ])
  assert.ok(result)
  const csv = quote.quoteCsv(result)
  assert.match(csv, /"套餐, ""A""\n第二行"/)
  assert.match(csv, /'=1\+1/)
  assert.match(csv, /报价单，非发票/)
  assert.match(csv, /应付/)
})

test('报价契约：页面 / 注册 / 帮助 / jump 工作流 / 适配器 / 包体清单', async () => {
  const app = JSON.parse(read('app.json'))
  const daily = app.subpackages.find((item) => item.root === 'subpackages/tools-daily')
  assert.ok(daily.pages.includes('pages/quote/index'), 'app.json 未注册页面')

  for (const ext of ['.ts', '.json', '.wxml', '.wxss']) {
    assert.ok(
      fs.existsSync(path.join(ROOT, `subpackages/tools-daily/pages/quote/index${ext}`)),
      `缺少页面文件 ${ext}`,
    )
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'core/toolbox/engines/csv.ts')), '缺少 csv 引擎')
  assert.ok(fs.existsSync(path.join(ROOT, 'core/toolbox/engines/rmb.ts')), 'rmb 未上移 core')

  const wxml = read('subpackages/tools-daily/pages/quote/index.wxml')
  assert.match(wxml, /tool-id="quote"/)
  assert.match(wxml, /bind:run="onRun"/)
  assert.match(wxml, /poster-data="\{\{posterData\}\}"/)
  assert.match(wxml, /bindtap="onCopy"/)
  assert.match(wxml, /bindtap="onExportCsv"/)
  assert.match(wxml, /报价单，非发票/)

  const ts = read('subpackages/tools-daily/pages/quote/index.ts')
  assert.match(ts, /onShareAppMessage\s*\(/)
  assert.match(ts, /onShareTimeline\s*\(/)
  assert.match(ts, /quoteTotals/)
  assert.match(ts, /onReceiveWorkflow\s*\(/)
  assert.equal(/wx\.request|uploadFile|downloadFile/.test(ts), false)

  const registry = read('core/toolbox/registry.ts')
  assert.match(registry, /id: 'quote'/)
  assert.match(registry, /weight: 74/)
  assert.match(read('subpackages/grow/lib/help.ts'), /quote: \{/)
  assert.match(read('scripts/check-budget.js'), /pages\/quote/)
  assert.match(read('scripts/e2e-tools.js'), /id: 'quote'/)

  const config = await import(`${URL_ROOT}core/workflow/workflowConfig.ts`)
  assert.equal(config.WORKFLOW_ROUTING.quote, 'jump')
  assert.deepEqual(config.WORKFLOW_ACCEPTS.quote, ['text'])

  const source = await import(`${URL_ROOT}core/workflow/workflowSource.ts`)
  assert.deepEqual(source.WORKFLOW_SOURCE_KEYS.quote.text, ['quoteSummary'])

  const adapters = await import(`${URL_ROOT}core/workflow/workflowAdapters.ts`)
  assert.ok(adapters.getWorkflowAdapter('quote'), '缺少 quote 跳转适配器')
})
