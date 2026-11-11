/* ==========================================================================
   M5 · 尺码换算（size-convert）
   - 引擎：男鞋 42、女装 M、戒指 16、超范围 / 半码
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

async function loadSize() {
  return import(`${URL_ROOT}subpackages/tools-daily/lib/size.ts`)
}

test('尺码：男鞋 42 与半码、各地区输入一致', async () => {
  const size = await loadSize()
  const male42 = size.shoeSize({ gender: 'male', region: 'cn', value: 42 })
  assert.deepEqual(male42, {
    kind: 'shoe',
    gender: 'male',
    eu: 42,
    us: 9,
    uk: 8,
    footCm: 26,
  })
  assert.deepEqual(size.shoeSize({ gender: 'male', region: 'us', value: 9 }), male42)
  assert.deepEqual(size.shoeSize({ gender: 'male', region: 'uk', value: 8 }), male42)
  assert.deepEqual(size.shoeSize({ gender: 'male', region: 'foot', value: 26 }), male42)

  const half = size.shoeSize({ gender: 'male', region: 'cn', value: 42.5 })
  assert.equal(half.eu, 42.5)
  assert.equal(half.us, 9.5)
  assert.equal(half.uk, 8.5)
  assert.equal(half.footCm, 26.3)

  const female38 = size.shoeSize({ gender: 'female', region: 'cn', value: 38 })
  assert.equal(female38.us, 7.5)
  assert.equal(female38.uk, 5)
  assert.equal(female38.footCm, 24)
})

test('尺码：女装 M 与男装 M 的对照', async () => {
  const size = await loadSize()
  const femaleM = size.clothingSize('female', 'M')
  assert.deepEqual(femaleM, {
    kind: 'clothing',
    gender: 'female',
    label: 'M',
    us: 'M',
    eu: 38,
    uk: 10,
    heightCm: 165,
    chestCm: 88,
  })
  const maleM = size.clothingSize('male', 'M')
  assert.equal(maleM.eu, 48)
  assert.equal(maleM.uk, 38)
  assert.equal(maleM.heightCm, 175)
  assert.equal(maleM.chestCm, 96)
  const maleXXL = size.clothingSize('male', 'XXL')
  assert.equal(maleXXL.eu, 54)
  assert.equal(maleXXL.uk, 44)
  assert.equal(size.clothingSize('female', 'XXXL'), null)
  assert.equal(size.clothingSize('other', 'M'), null)
})

test('尺码：戒指 16 与各地区输入', async () => {
  const size = await loadSize()
  const cn16 = size.ringSize({ region: 'cn', value: 16 })
  assert.deepEqual(cn16, {
    kind: 'ring',
    cn: 16,
    us: 7.5,
    eu: 56,
    circumferenceMm: 56,
    diameterMm: 17.8,
  })
  const us75 = size.ringSize({ region: 'us', value: 7.5 })
  assert.equal(us75.cn, 16)
  assert.equal(us75.eu, 56)
  assert.equal(us75.us, 7.5)
  assert.equal(size.ringSize({ region: 'eu', value: 56 }).cn, 16)
  assert.equal(size.ringSize({ region: 'circumference', value: 56 }).us, 7.5)
})

test('尺码：超范围、非法步长与格式化', async () => {
  const size = await loadSize()
  assert.equal(size.shoeSize({ gender: 'male', region: 'cn', value: 37 }), null)
  assert.equal(size.shoeSize({ gender: 'male', region: 'cn', value: 51 }), null)
  assert.equal(size.shoeSize({ gender: 'male', region: 'cn', value: 42.3 }), null)
  assert.equal(size.shoeSize({ gender: 'male', region: 'foot', value: 20 }), null)
  assert.equal(size.shoeSize({ gender: 'female', region: 'cn', value: 45 }), null)
  assert.equal(size.shoeSize({ gender: 'other', region: 'cn', value: 42 }), null)

  assert.equal(size.ringSize({ region: 'cn', value: 7 }), null)
  assert.equal(size.ringSize({ region: 'cn', value: 25 }), null)
  assert.equal(size.ringSize({ region: 'us', value: 20 }), null)
  assert.equal(size.ringSize({ region: 'circumference', value: 47.5 }), null)
  assert.equal(size.ringSize({ region: 'eu', value: 56.5 }), null)
  assert.equal(size.ringSize({ region: 'us', value: 7.3 }), null)

  assert.equal(size.formatSize(42), '42')
  assert.equal(size.formatSize(7.5), '7.5')
  assert.equal(size.formatSize(26.3), '26.3')
})

test('尺码契约：页面 / 注册 / 帮助 / jump 配置 / 来源 / 纯产出适配器', async () => {
  const app = JSON.parse(read('app.json'))
  const daily = app.subpackages.find((item) => item.root === 'subpackages/tools-daily')
  assert.ok(daily, 'app.json 缺少 tools-daily 分包')
  assert.ok(daily.pages.includes('pages/size-convert/index'), 'tools-daily 未注册尺码换算页面')

  for (const ext of ['.ts', '.json', '.wxml', '.wxss']) {
    assert.ok(
      fs.existsSync(path.join(ROOT, `subpackages/tools-daily/pages/size-convert/index${ext}`)),
      `缺少尺码换算页面文件 ${ext}`,
    )
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'subpackages/tools-daily/lib/size.ts')))

  const pageJson = JSON.parse(read('subpackages/tools-daily/pages/size-convert/index.json'))
  assert.equal(pageJson.navigationBarTitleText, '尺码换算')

  const wxml = read('subpackages/tools-daily/pages/size-convert/index.wxml')
  assert.match(wxml, /tool-id="size-convert"/)
  assert.match(wxml, /bind:run="onRun"/)
  assert.match(wxml, /bindtap="onMode"/)
  assert.match(wxml, /bindtap="onGender"/)
  assert.match(wxml, /bindtap="onRegion"/)
  assert.match(wxml, /bindtap="onClothingLabel"/)
  assert.match(wxml, /bindtap="onCopy"/)
  assert.match(wxml, /bindtap="onCopyRow"/)
  assert.match(wxml, /鞋码/)
  assert.match(wxml, /服装/)
  assert.match(wxml, /戒指/)

  const ts = read('subpackages/tools-daily/pages/size-convert/index.ts')
  assert.match(ts, /onShareAppMessage\s*\(/)
  assert.match(ts, /onShareTimeline\s*\(/)
  assert.match(ts, /shoeSize/)
  assert.match(ts, /clothingSize/)
  assert.match(ts, /ringSize/)
  assert.equal(/onReceiveWorkflow/.test(ts), false, '纯产出卡不应实现注入接口')
  assert.equal(/wx\.request|uploadFile|downloadFile/.test(ts), false, '尺码换算不得联网')
  assert.equal(/wx\./.test(read('subpackages/tools-daily/lib/size.ts')), false, '引擎不得依赖 wx')

  const registry = read('core/toolbox/registry.ts')
  assert.match(registry, /id: 'size-convert'/)
  assert.match(registry, /name: '尺码换算'/)
  assert.match(registry, /weight: 62/)
  assert.match(registry, /sensitive: ''/)
  assert.match(registry, /subpackages\/tools-daily\/pages\/size-convert\/index/)
  assert.match(read('subpackages/grow/lib/help.ts'), /'size-convert': \{/)
  assert.match(read('scripts/check-budget.js'), /pages\/size-convert/)
  assert.match(read('scripts/e2e-tools.js'), /id: 'size-convert'/)

  const config = await import(`${URL_ROOT}core/workflow/workflowConfig.ts`)
  assert.equal(config.WORKFLOW_ROUTING['size-convert'], 'jump')
  assert.deepEqual(config.WORKFLOW_ACCEPTS['size-convert'], [])

  const source = await import(`${URL_ROOT}core/workflow/workflowSource.ts`)
  assert.deepEqual(source.WORKFLOW_SOURCE_KEYS['size-convert'].text, ['sizeSummary'])

  const adapters = await import(`${URL_ROOT}core/workflow/workflowAdapters.ts`)
  const adapter = adapters.getWorkflowAdapter('size-convert')
  assert.ok(adapter, 'jump 工具必须有适配器')
  assert.equal(adapter.hasInput({}), false)
  assert.equal(adapter.isReady({}), false)
  assert.equal(await adapter.apply({}, { type: 'text', payload: 'x' }), false)
  assert.equal(read('core/workflow/workflowSilent.ts').includes("case 'size-convert'"), false)
})
