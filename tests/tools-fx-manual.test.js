/* ==========================================================================
   批 3 · 汇率换算（fx-manual）
   - 引擎：官方 CFETS 中间价 / 交叉汇率 / 100JPY / 手动牌价 / 双向一致
   - 服务：请求、6 小时缓存、失败回退旧缓存
   - 契约：页面 / 注册 / 帮助 / 文本工作流 / 适配器 / 来源与合规
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

async function loadFx() {
  return import(`${URL_ROOT}subpackages/tools-daily/lib/fx.ts`)
}

async function loadOfficialService() {
  return import(`${URL_ROOT}subpackages/tools-daily/lib/fx-official.ts`)
}

const CFETS_FIXTURE = {
  data: { lastDate: '2026-11-10 9:15' },
  records: [
    { vrtEName: 'USD/CNY', price: '6.7167' },
    { vrtEName: 'EUR/CNY', price: '7.5071' },
    { vrtEName: '100JPY/CNY', price: '4.2355' },
    { vrtEName: 'HKD/CNY', price: '0.85642' },
    { vrtEName: 'GBP/CNY', price: '8.9892' },
    { vrtEName: 'AUD/CNY', price: '4.6277' },
    { vrtEName: 'CAD/CNY', price: '4.7353' },
  ],
}

function installWxMock(options = {}) {
  const cache = new Map()
  const request = options.request
  global.wx = {
    getStorageSync(key) {
      return cache.get(key)
    },
    setStorageSync(key, value) {
      cache.set(key, value)
    },
    request(config) {
      if (request) {
        request(config)
        return
      }
      config.fail({ errMsg: 'request:fail mock' })
    },
  }
  return cache
}

test('手动汇率：双向换算一致（误差 ≤1 分）', async () => {
  const fx = await loadFx()
  const forward = fx.convertManual({
    amountCents: 100000,
    rate: 7.2,
    from: 'USD',
    to: 'CNY',
    rateDate: '2026-11-10',
  })
  assert.ok(forward)
  assert.equal(forward.convertedCents, 720000)
  assert.equal(forward.rateDate, '2026-11-10')

  const back = fx.convertManual({
    amountCents: forward.convertedCents,
    rate: 1 / 7.2,
    from: 'CNY',
    to: 'USD',
    rateDate: '2026-11-10',
  })
  assert.ok(back)
  assert.ok(Math.abs(back.convertedCents - 100000) <= 1)
})

test('手动汇率：牌价 0 / 超精度 / 超范围拒绝', async () => {
  const fx = await loadFx()
  assert.equal(fx.parseFxRate('0'), null)
  assert.equal(fx.parseFxRate('0.0000001'), null)
  assert.equal(fx.parseFxRate('1000000.1'), null)
  assert.equal(fx.parseFxRate('7.1234567'), null)
  assert.equal(fx.parseFxRate('0.000001'), 0.000001)
  assert.equal(fx.parseFxRate('1000000'), 1000000)
  assert.equal(
    fx.convertManual({ amountCents: 10000, rate: 0, from: 'USD', to: 'CNY', rateDate: '2026-11-10' }),
    null,
  )
})

test('手动汇率：同币种 / 金额 0 / 超 1 亿分拒绝', async () => {
  const fx = await loadFx()
  assert.equal(
    fx.convertManual({ amountCents: 10000, rate: 7.2, from: 'USD', to: 'USD', rateDate: '2026-11-10' }),
    null,
  )
  assert.equal(fx.parseFxAmount('0'), null)
  assert.equal(fx.parseFxAmount('-1'), null)
  assert.equal(fx.parseFxAmount('1000000.00'), 100000000)
  assert.equal(fx.parseFxAmount('1000000.01'), null)
})

test('手动汇率：免责说明与牌价日期提醒', async () => {
  const fx = await loadFx()
  const result = fx.convertManual({
    amountCents: 100000,
    rate: 7.2,
    from: 'USD',
    to: 'CNY',
    rateDate: '1999-12-31',
  })
  assert.ok(result)
  const summary = fx.fxSummary(result)
  assert.match(summary, /手动填写/)
  assert.match(summary, /仅供参考/)
  assert.equal(fx.fxDateWarning('1999-12-31', '2026-11-10').length > 0, true)
  assert.equal(fx.fxDateWarning('2026-11-10', '2026-11-10'), '')
  assert.equal(fx.fxDateWarning('2026-11-11', '2026-11-10').length > 0, true)
})

test('手动汇率：牌价格式与工作流金额解析', async () => {
  const fx = await loadFx()
  assert.equal(fx.formatFxRate(7.2), '7.2')
  assert.equal(fx.formatFxRate(0.000001), '0.000001')
  assert.equal(fx.formatFxRate(1000000), '1000000')
  assert.equal(fx.parseFxWorkflowAmount('金额 1,234.56 元'), 123456)
  assert.equal(fx.parseFxWorkflowAmount('没有数字'), null)
})

test('汇率换算：CFETS 中间价解析与交叉汇率', async () => {
  const fx = await loadFx()
  const official = fx.parseCfetsRates(CFETS_FIXTURE)
  assert.ok(official)
  assert.equal(official.date, '2026-11-10')
  assert.equal(official.updatedAt, '2026-11-10 9:15')
  assert.equal(official.rates.CNY, 1)
  assert.equal(official.rates.USD, 6.7167)
  assert.ok(Math.abs(official.rates.JPY - 0.042355) < 1e-12)
  assert.ok(Math.abs(fx.officialCrossRate('USD', 'CNY', official) - 6.7167) < 1e-9)
  assert.ok(
    Math.abs(fx.officialCrossRate('EUR', 'USD', official) - 7.5071 / 6.7167) < 1e-9,
  )
  assert.ok(Math.abs(fx.officialCrossRate('JPY', 'CNY', official) - 0.042355) < 1e-9)
  assert.equal(fx.officialCrossRate('USD', 'USD', official), null)
  assert.equal(fx.officialCrossRate('USD', 'CNY', null), null)
  assert.equal(fx.parseCfetsRates({ data: {}, records: [] }), null)
})

test('汇率换算：官方摘要包含来源与更新时间', async () => {
  const fx = await loadFx()
  const result = fx.convertManual({
    amountCents: 100000,
    rate: 6.7167,
    from: 'USD',
    to: 'CNY',
    rateDate: '2026-11-10',
  })
  assert.ok(result)
  const summary = fx.fxSummary(result, 'official', '中国外汇交易中心（CFETS）官方中间价')
  assert.match(summary, /CFETS/)
  assert.match(summary, /官方中间价，仅供参考/)
  assert.equal(summary.includes('手动填写'), false)
})

test('汇率换算：官方服务请求、缓存与失败回退', async () => {
  const cache = installWxMock({
    request: (config) => {
      config.success({ statusCode: 200, data: CFETS_FIXTURE })
    },
  })
  const service = await loadOfficialService()
  const first = await service.fetchOfficialRates(true)
  assert.equal(first.fromCache, false)
  assert.equal(first.stale, false)
  assert.equal(first.rates.rates.USD, 6.7167)

  const cached = await service.fetchOfficialRates(false)
  assert.equal(cached.fromCache, true)
  assert.equal(cached.stale, false)

  const constants = await import(`${URL_ROOT}core/constants/index.ts`)
  const staleCache = installWxMock({
    request: (config) => {
      config.fail({ errMsg: 'request:fail network' })
    },
  })
  staleCache.set(constants.STORAGE_KEYS.fxOfficialRates, {
    savedAt: Date.now() - 24 * 60 * 60 * 1000,
    rates: first.rates,
  })
  const stale = await service.fetchOfficialRates(false)
  assert.equal(stale.fromCache, true)
  assert.equal(stale.stale, true)
  assert.equal(stale.rates.rates.USD, 6.7167)
  assert.ok(cache.size >= 1)
})

test('汇率换算契约：页面 / 注册 / 帮助 / 文本工作流 / 适配器 / 合规', async () => {
  const app = JSON.parse(read('app.json'))
  const daily = app.subpackages.find((item) => item.root === 'subpackages/tools-daily')
  assert.ok(daily.pages.includes('pages/fx-manual/index'), 'app.json 未注册页面')

  for (const ext of ['.ts', '.json', '.wxml', '.wxss']) {
    assert.ok(
      fs.existsSync(path.join(ROOT, `subpackages/tools-daily/pages/fx-manual/index${ext}`)),
      `缺少页面文件 ${ext}`,
    )
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'subpackages/tools-daily/lib/fx.ts')))
  assert.ok(fs.existsSync(path.join(ROOT, 'subpackages/tools-daily/lib/fx-official.ts')))

  const pageJson = JSON.parse(
    read('subpackages/tools-daily/pages/fx-manual/index.json'),
  )
  assert.equal(pageJson.navigationBarTitleText, '汇率换算')

  const wxml = read('subpackages/tools-daily/pages/fx-manual/index.wxml')
  assert.match(wxml, /tool-id="fx-manual"/)
  assert.match(wxml, /bindtap="onSwap"/)
  assert.match(wxml, /bindchange="onRateDateChange"/)
  assert.match(wxml, /bind:tap="onCopy"/)
  assert.match(wxml, /官方中间价/)
  assert.match(wxml, /CFETS/)
  assert.match(wxml, /手动牌价/)
  assert.match(wxml, /仅供参考/)
  assert.equal(/实时汇率|实时行情/.test(wxml), false, '页面不得宣称实时汇率或行情')

  const ts = read('subpackages/tools-daily/pages/fx-manual/index.ts')
  assert.match(ts, /onShareAppMessage\s*\(/)
  assert.match(ts, /onShareTimeline\s*\(/)
  assert.match(ts, /convertManual/)
  assert.match(ts, /fetchOfficialRates/)
  assert.match(ts, /onSourceChange/)
  assert.match(ts, /onReceiveWorkflow/)
  assert.match(ts, /onReset/)
  assert.equal(/wx\.request|uploadFile|downloadFile/.test(ts), false, '页面不得直接发起网络请求')
  assert.equal(/实时汇率|实时行情/.test(ts), false, '页面不得宣称实时汇率或行情')

  const service = read('subpackages/tools-daily/lib/fx-official.ts')
  assert.match(service, /chinamoney\.com\.cn/)
  assert.match(service, /wx\.request/)
  assert.match(service, /CACHE_TTL_MS/)

  const registry = read('core/toolbox/registry.ts')
  assert.match(registry, /id: 'fx-manual'/)
  assert.match(registry, /name: '汇率换算'/)
  assert.match(registry, /weight: 65/)
  assert.match(registry, /sensitive: 'finance'/)
  assert.match(registry, /subpackages\/tools-daily\/pages\/fx-manual\/index/)
  assert.match(read('subpackages/grow/lib/help.ts'), /'fx-manual': \{/)
  assert.match(read('scripts/check-budget.js'), /pages\/fx-manual/)
  assert.match(read('scripts/e2e-tools.js'), /id: 'fx-manual'/)
  assert.match(read('core/constants/index.ts'), /fxOfficialRates: 'tbx:fx\.official\.v1'/)
  assert.match(read('subpackages/grow/pages/legal/index.wxml'), /chinamoney\.com\.cn/)
  assert.match(read('subpackages/grow/pages/legal/index.wxml'), /tbx:fx\.official\.v1/)

  const config = await import(`${URL_ROOT}core/workflow/workflowConfig.ts`)
  assert.equal(config.WORKFLOW_ROUTING['fx-manual'], 'jump')
  assert.deepEqual(config.WORKFLOW_ACCEPTS['fx-manual'], ['text'])

  const source = await import(`${URL_ROOT}core/workflow/workflowSource.ts`)
  assert.deepEqual(source.WORKFLOW_SOURCE_KEYS['fx-manual'].text, ['fxSummary'])

  const adapters = await import(`${URL_ROOT}core/workflow/workflowAdapters.ts`)
  assert.ok(adapters.getWorkflowAdapter('fx-manual'), '缺少 fx-manual 文本适配器')
})
