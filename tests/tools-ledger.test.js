/* ==========================================================================
   批 1 · 算账助手（ledger）
   - 引擎黄金值：折扣、满减、AA 余数守恒、人数 0、金额上限
   - 页面契约：路由注册、统一外壳、金融免责、工作流接收
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
  return import(`${URL_ROOT}subpackages/tools-daily/lib/ledger.ts`)
}

test('算账：100 元 8 折 → 应付 80、省 20', async () => {
  const { calcDiscount } = await loadEngine()
  const result = calcDiscount(10000, 80)
  assert.equal(result.ok, true)
  assert.equal(result.payable, 8000)
  assert.equal(result.saved, 2000)
})

test('算账：满减取满足门槛的最高档，不满足时原价', async () => {
  const { calcThreshold } = await loadEngine()
  const tiers = [
    { thresholdCents: 10000, offCents: 1000 },
    { thresholdCents: 20000, offCents: 3000 },
    { thresholdCents: 50000, offCents: 10000 },
  ]
  const hit = calcThreshold(25000, tiers)
  assert.equal(hit.ok, true)
  assert.equal(hit.payable, 22000)
  assert.equal(hit.saved, 3000)
  assert.equal(hit.reached, true)

  const miss = calcThreshold(9999, tiers)
  assert.equal(miss.ok, true)
  assert.equal(miss.payable, 9999)
  assert.equal(miss.saved, 0)
  assert.equal(miss.reached, false)
})

test('算账：AA 余数从第一人起各 +1 分，总和守恒', async () => {
  const { splitBill, formatSplitSpread } = await loadEngine()
  const result = splitBill(10000, 3, 0)
  assert.equal(result.ok, true)
  assert.deepEqual(result.perPerson, [3334, 3333, 3333])
  assert.equal(
    result.perPerson.reduce((sum, item) => sum + item, 0),
    result.payable,
  )
  assert.equal(formatSplitSpread(result.perPerson), '前 1 人 ¥33.34，其余 2 人 ¥33.33')

  const tipped = splitBill(10000, 3, 10)
  assert.equal(tipped.ok, true)
  assert.equal(tipped.tipCents, 1000)
  assert.equal(tipped.payable, 11000)
  assert.deepEqual(tipped.perPerson, [3667, 3667, 3666])
  assert.equal(formatSplitSpread(tipped.perPerson), '前 2 人 ¥36.67，其余 1 人 ¥36.66')
})

test('算账：人数 0、人数超限与折扣越界均拒绝', async () => {
  const { splitBill, calcDiscount } = await loadEngine()
  assert.deepEqual(splitBill(10000, 0, 0), { ok: false, code: 'people' })
  assert.deepEqual(splitBill(10000, 101, 0), { ok: false, code: 'people' })
  assert.deepEqual(calcDiscount(10000, 101), { ok: false, code: 'discount' })
})

test('算账：金额上限与非法档位', async () => {
  const { calcDiscount, calcThreshold, MAX_LEDGER_CENTS } = await loadEngine()
  assert.deepEqual(calcDiscount(MAX_LEDGER_CENTS + 1, 80), { ok: false, code: 'amount' })
  assert.deepEqual(calcDiscount(-1, 80), { ok: false, code: 'amount' })
  assert.deepEqual(calcThreshold(10000, [{ thresholdCents: 100, offCents: 200 }]), {
    ok: false,
    code: 'tiers',
  })
})

test('契约：ledger 已注册路由 / 外壳 / 帮助 / 工作流接收', async () => {
  const app = JSON.parse(read('app.json'))
  const daily = app.subpackages.find((item) => item.root === 'subpackages/tools-daily')
  assert.ok(daily, 'app.json 未注册 tools-daily')
  assert.ok(daily.pages.includes('pages/ledger/index'), 'tools-daily 未注册 ledger 页面')

  const registry = read('core/toolbox/registry.ts')
  assert.match(registry, /id: 'ledger'/, 'registry 缺少 ledger')
  assert.match(registry, /sensitive: 'finance'/, 'ledger 必须声明 finance')

  const wxml = read('subpackages/tools-daily/pages/ledger/index.wxml')
  assert.match(wxml, /tool-id="ledger"/)
  assert.match(wxml, /has-result="\{\{hasResult\}\}"/)
  assert.match(wxml, /poster-data="\{\{posterData\}\}"/)
  assert.match(wxml, /本机计算/)

  const ts = read('subpackages/tools-daily/pages/ledger/index.ts')
  assert.match(ts, /onShareAppMessage\s*\(/)
  assert.match(ts, /onShareTimeline\s*\(/)
  assert.match(ts, /onReceiveWorkflow\s*\(/)
  assert.match(ts, /posterData: poster/)
  assert.match(ts, /resultMain: view\.main/, '模式切换必须恢复 resultMain')
  assert.match(ts, /buildPoster\(view, mode\)/, '海报参数必须使用目标模式')

  const help = read('subpackages/grow/lib/help.ts')
  assert.match(help, /ledger: \{/, 'help 缺少 ledger 条目')
})
