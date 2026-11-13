/* ==========================================================================
   批 2 · 体脂率（bodyfat）
   - 引擎：男女黄金值、围度非法、区间边界、极端值复核
   - 契约：页面 / 注册 / 帮助 / jump 无注入 / body 引擎 / 包体清单
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

async function loadBodyfat() {
  const bodyfat = await import(`${URL_ROOT}subpackages/tools-daily/lib/bodyfat.ts`)
  const body = await import(`${URL_ROOT}subpackages/tools-core/lib/body-engine.ts`)
  return { bodyfat, body }
}

test('体脂：男性黄金值与脂肪 / 去脂体重', async () => {
  const { bodyfat } = await loadBodyfat()
  const result = bodyfat.navyBodyFat({
    gender: 'male',
    heightCm: 175,
    weightKg: 70,
    neckCm: 38,
    waistCm: 85,
  })
  assert.ok(result)
  assert.equal(result.percent.toFixed(1), '16.9')
  assert.equal(result.category.label, '健身')
  assert.equal(result.needsReview, false)
  assert.equal(result.fatMassKg.toFixed(1), '11.9')
  assert.equal(result.leanMassKg.toFixed(1), '58.1')
})

test('体脂：女性黄金值与臀围必填', async () => {
  const { bodyfat } = await loadBodyfat()
  const result = bodyfat.navyBodyFat({
    gender: 'female',
    heightCm: 162,
    weightKg: 55,
    neckCm: 32,
    waistCm: 72,
    hipCm: 95,
  })
  assert.ok(result)
  assert.equal(result.percent.toFixed(1), '26.7')
  assert.equal(result.category.label, '平均')

  const missingHip = bodyfat.navyBodyFat({
    gender: 'female',
    heightCm: 162,
    weightKg: 55,
    neckCm: 32,
    waistCm: 72,
  })
  assert.equal(missingHip, null)
})

test('体脂：围度非法与公式定义域外返回 null', async () => {
  const { bodyfat } = await loadBodyfat()
  const base = { gender: 'male', heightCm: 175, weightKg: 70, neckCm: 38, waistCm: 85 }
  assert.equal(bodyfat.navyBodyFat({ ...base, waistCm: 38 }), null, '腰围等于颈围')
  assert.equal(bodyfat.navyBodyFat({ ...base, waistCm: 30 }), null, '腰围小于颈围')
  assert.equal(bodyfat.navyBodyFat({ ...base, neckCm: 0 }), null)
  assert.equal(bodyfat.navyBodyFat({ ...base, heightCm: 0 }), null)
  assert.equal(bodyfat.navyBodyFat({ ...base, weightKg: 0 }), null)
  assert.equal(
    bodyfat.navyBodyFat({ gender: 'female', heightCm: 162, weightKg: 55, neckCm: 100, waistCm: 60, hipCm: 40 }),
    null,
    '腰 + 臀未大于颈',
  )
})

test('体脂：男女区间左闭右开', async () => {
  const { bodyfat } = await loadBodyfat()
  const male = (percent) => bodyfat.bodyFatCategory('male', percent).label
  assert.equal(male(5.9), '偏低')
  assert.equal(male(6), '运动')
  assert.equal(male(13.9), '运动')
  assert.equal(male(14), '健身')
  assert.equal(male(17.9), '健身')
  assert.equal(male(18), '平均')
  assert.equal(male(24.9), '平均')
  assert.equal(male(25), '偏高')

  const female = (percent) => bodyfat.bodyFatCategory('female', percent).label
  assert.equal(female(13.9), '偏低')
  assert.equal(female(14), '运动')
  assert.equal(female(21), '健身')
  assert.equal(female(25), '平均')
  assert.equal(female(32), '偏高')
})

test('体脂：极端值夹在 0–100 并标记复核', async () => {
  const { bodyfat } = await loadBodyfat()
  const low = bodyfat.navyBodyFat({
    gender: 'male',
    heightCm: 250,
    weightKg: 60,
    neckCm: 50,
    waistCm: 51,
  })
  assert.ok(low)
  assert.equal(low.percent, 0)
  assert.equal(low.needsReview, true)

  const high = bodyfat.navyBodyFat({
    gender: 'male',
    heightCm: 100,
    weightKg: 80,
    neckCm: 30,
    waistCm: 1000,
  })
  assert.ok(high)
  assert.equal(high.percent, 100)
  assert.equal(high.needsReview, true)
})

test('体脂契约：页面 / 注册 / 帮助 / jump 无注入 / body 引擎 / 包体清单', async () => {
  const app = JSON.parse(read('app.json'))
  const daily = app.subpackages.find((item) => item.root === 'subpackages/tools-daily')
  assert.ok(daily.pages.includes('pages/bodyfat/index'), 'app.json 未注册页面')

  for (const ext of ['.ts', '.json', '.wxml', '.wxss']) {
    assert.ok(
      fs.existsSync(path.join(ROOT, `subpackages/tools-daily/pages/bodyfat/index${ext}`)),
      `缺少页面文件 ${ext}`,
    )
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'subpackages/tools-core/lib/body-engine.ts')), '缺少 body 共享引擎')

  const wxml = read('subpackages/tools-daily/pages/bodyfat/index.wxml')
  assert.match(wxml, /tool-id="bodyfat"/)
  assert.match(wxml, /bind:run="onRun"/)
  assert.match(wxml, /bindtap="onCopy"/)
  assert.match(wxml, /不构成医疗建议/)

  const ts = read('subpackages/tools-daily/pages/bodyfat/index.ts')
  assert.match(ts, /onShareAppMessage\s*\(/)
  assert.match(ts, /onShareTimeline\s*\(/)
  assert.match(ts, /navyBodyFat/)
  assert.match(ts, /bodyfatSummary/)
  assert.equal(/wx\.request|uploadFile|downloadFile/.test(ts), false, '不得联网')

  const bmi = read('subpackages/tools-core/pages/bmi/index.ts')
  assert.match(bmi, /lib\/body-engine/, 'BMI 页未复用共享引擎')

  const registry = read('core/toolbox/registry.ts')
  assert.match(registry, /id: 'bodyfat'/)
  assert.match(registry, /weight: 66/)
  assert.match(registry, /sensitive: 'health'/)
  assert.match(read('subpackages/grow/lib/help.ts'), /bodyfat: \{/)
  assert.match(read('scripts/check-budget.js'), /pages\/bodyfat/)
  assert.match(read('scripts/e2e-tools.js'), /id: 'bodyfat'/)

  const config = await import(`${URL_ROOT}core/workflow/workflowConfig.ts`)
  assert.equal(config.WORKFLOW_ROUTING.bodyfat, 'jump')
  assert.deepEqual(config.WORKFLOW_ACCEPTS.bodyfat, [])

  const source = await import(`${URL_ROOT}core/workflow/workflowSource.ts`)
  assert.deepEqual(source.WORKFLOW_SOURCE_KEYS.bodyfat.text, ['bodyfatSummary'])

  const adapters = await import(`${URL_ROOT}core/workflow/workflowAdapters.ts`)
  assert.ok(adapters.getWorkflowAdapter('bodyfat'), '缺少 bodyfat 适配器')
})
