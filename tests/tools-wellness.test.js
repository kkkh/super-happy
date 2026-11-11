/* ==========================================================================
   批 1 · 每日健康（wellness）
   - 引擎黄金值：饮水、热量、月末推进、负剩余
   - 模式隔离：三模式结果独立缓存
   - 契约：页面 / 注册 / 帮助 / 纯产出工作流
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
  return import(`${URL_ROOT}subpackages/tools-daily/lib/wellness.ts`)
}

test('饮水：体重与活动增量，毫升取整到 10、杯数 0.5 步进', async () => {
  const wellness = await loadEngine()
  assert.deepEqual(wellness.waterTarget(60, 'medium'), { ok: true, ml: 2100, cups: 10.5 })
  assert.deepEqual(wellness.waterTarget(60, 'sedentary'), { ok: true, ml: 1800, cups: 9 })
  assert.deepEqual(wellness.waterTarget(60, 'high'), { ok: true, ml: 2400, cups: 12 })
  assert.equal(wellness.waterTarget(0, 'medium').code, 'weight')
  assert.equal(wellness.waterTarget(60, 'bad').code, 'activity')
})

test('热量：千卡与千焦双向换算', async () => {
  const wellness = await loadEngine()
  assert.equal(wellness.kcalToKj(1000), 4184)
  assert.equal(wellness.kjToKcal(4184), 1000)
  assert.equal(wellness.kcalToKj(-1), null)
  assert.equal(wellness.kjToKcal(Number.NaN), null)
})

test('保质期：月末推进与闰年钳制', async () => {
  const wellness = await loadEngine()
  const normal = wellness.addShelfLife('2026-01-31', 1, 'month', '2026-01-31')
  assert.equal(normal.ok, true)
  assert.equal(normal.expiryISO, '2026-02-28')
  assert.equal(normal.remainingDays, 28)

  const leap = wellness.addShelfLife('2024-01-31', 1, 'month', '2024-01-31')
  assert.equal(leap.ok, true)
  assert.equal(leap.expiryISO, '2024-02-29')

  const year = wellness.addShelfLife('2024-02-29', 1, 'year', '2024-02-29')
  assert.equal(year.ok, true)
  assert.equal(year.expiryISO, '2025-02-28')

  const days = wellness.addShelfLife('2026-01-31', 10, 'day', '2026-01-31')
  assert.equal(days.ok, true)
  assert.equal(days.expiryISO, '2026-02-10')
})

test('保质期：过期后的负剩余天数', async () => {
  const wellness = await loadEngine()
  const expired = wellness.addShelfLife('2025-01-01', 1, 'day', '2026-01-01')
  assert.equal(expired.ok, true)
  assert.equal(expired.expiryISO, '2025-01-02')
  assert.equal(expired.remainingDays, -364)

  assert.equal(wellness.addShelfLife('2026-01-01', 0, 'day', '2026-01-01').code, 'amount')
  assert.equal(wellness.addShelfLife('2026-02-30', 1, 'day', '2026-01-01').code, 'date')
})

test('每日健康契约：模式隔离 / 页面 / 注册 / 帮助 / 纯产出工作流', async () => {
  const app = JSON.parse(read('app.json'))
  const daily = app.subpackages.find((item) => item.root === 'subpackages/tools-daily')
  assert.ok(daily.pages.includes('pages/wellness/index'), 'app.json 未注册页面')

  for (const ext of ['.ts', '.json', '.wxml', '.wxss']) {
    assert.ok(
      fs.existsSync(path.join(ROOT, `subpackages/tools-daily/pages/wellness/index${ext}`)),
      `缺少页面文件 ${ext}`,
    )
  }

  const wxml = read('subpackages/tools-daily/pages/wellness/index.wxml')
  assert.match(wxml, /tool-id="wellness"/)
  assert.match(wxml, /bind:run="onRun"/)
  assert.match(wxml, /poster-data="\{\{posterData\}\}"/)
  assert.match(wxml, /健康建议仅供参考/)

  const ts = read('subpackages/tools-daily/pages/wellness/index.ts')
  assert.match(ts, /modeResults/)
  assert.match(ts, /onShareAppMessage\s*\(/)
  assert.match(ts, /onShareTimeline\s*\(/)
  assert.equal(/onReceiveWorkflow/.test(ts), false, 'accepts: [] 不得声明注入接口')
  assert.equal(/wx\.request|uploadFile|downloadFile/.test(ts), false)

  const registry = read('core/toolbox/registry.ts')
  assert.match(registry, /id: 'wellness'/)
  assert.match(registry, /sensitive: 'health'/)
  assert.match(registry, /weight: 82/)
  assert.match(read('subpackages/grow/lib/help.ts'), /wellness: \{/)

  const config = await import(`${URL_ROOT}core/workflow/workflowConfig.ts`)
  assert.equal(config.WORKFLOW_ROUTING.wellness, 'jump')
  assert.deepEqual(config.WORKFLOW_ACCEPTS.wellness, [])

  const source = await import(`${URL_ROOT}core/workflow/workflowSource.ts`)
  assert.deepEqual(source.WORKFLOW_SOURCE_KEYS.wellness.text, ['wellnessSummary'])
})
