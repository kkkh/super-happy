/* ==========================================================================
   M5 · 百分比计算（percent）
   - 引擎：占比 / 增减幅 / 配比黄金值、旧值 0、负值、1000% 边界
   - 工作流：silent 文本解析与摘要
   - 契约：tools-daily / 页面 / 注册 / 帮助 / 配置 / 来源 / 无页面适配器
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

async function loadPercent() {
  return import(`${URL_ROOT}core/toolbox/engines/percent.ts`)
}

test('百分比：占比 / 增减幅 / 配比三模式黄金值', async () => {
  const percent = await loadPercent()
  const share = percent.percentOf(2500, 20000)
  assert.ok(share)
  assert.equal(share.percent, 12.5)
  assert.equal(share.percentText, '12.5%')
  assert.equal(share.remainderCents, 17500)

  const up = percent.changeRate(10000, 12000)
  assert.ok(up)
  assert.equal(up.percent, 20)
  assert.equal(up.percentText, '+20%')
  assert.equal(up.diffCents, 2000)
  assert.equal(up.direction, 'up')

  const down = percent.changeRate(10000, 8000)
  assert.ok(down)
  assert.equal(down.percent, -20)
  assert.equal(down.percentText, '-20%')
  assert.equal(down.direction, 'down')

  const ratio = percent.ratioParts(1600, 2400)
  assert.ok(ratio)
  assert.equal(ratio.ratioText, '2:3')
  assert.equal(ratio.totalParts, 5)
  assert.equal(ratio.aSharePercent, 40)
  assert.equal(ratio.bSharePercent, 60)
})

test('百分比：旧值 0、负值、1000% 与空配比边界', async () => {
  const percent = await loadPercent()
  assert.equal(percent.percentOf(100, 0), null)
  assert.equal(percent.percentOf(-100, 100), null)
  assert.equal(percent.changeRate(0, 100), null)
  assert.equal(percent.changeRate(-100, 100), null)
  assert.equal(percent.changeRate(10000, 120000), null)
  assert.ok(percent.changeRate(10000, 110000), '恰好 1000% 应允许')
  assert.equal(percent.ratioParts(0, 0), null)
  assert.equal(percent.ratioParts(-100, 200), null)
  assert.equal(percent.ratioParts(0, 500).ratioText, '0:1')
})

test('百分比：silent 文本解析与摘要', async () => {
  const percent = await loadPercent()
  assert.deepEqual(percent.parsePercentWorkflow('占比 25 200'), {
    mode: 'share',
    aCents: 2500,
    bCents: 20000,
  })
  assert.deepEqual(percent.parsePercentWorkflow('增减 100 120'), {
    mode: 'change',
    aCents: 10000,
    bCents: 12000,
  })
  assert.deepEqual(percent.parsePercentWorkflow('配比 16 24'), {
    mode: 'ratio',
    aCents: 1600,
    bCents: 2400,
  })
  assert.equal(percent.parsePercentWorkflow('25 200').mode, 'share')
  assert.equal(percent.parsePercentWorkflow('-1 2'), null)
  assert.equal(percent.parsePercentWorkflow('1 2 3'), null)

  const summary = percent.percentSummary(percent.changeRate(10000, 12000))
  assert.match(summary, /增减幅/)
  assert.match(summary, /\+20%/)
  assert.match(percent.percentSummary(percent.ratioParts(1600, 2400)), /2:3/)

  const silent = await import(`${URL_ROOT}core/workflow/workflowSilent.ts`)
  const output = silent.executeSilentTool('percent', {
    type: 'text',
    payload: '增减 100 120',
  })
  assert.equal(output.type, 'text')
  assert.match(output.payload, /\+20%/)
})

test('百分比契约：页面 / 注册 / 帮助 / silent 配置 / 来源 / 无页面适配器', async () => {
  const app = JSON.parse(read('app.json'))
  const daily = app.subpackages.find((item) => item.root === 'subpackages/tools-daily')
  assert.ok(daily, 'app.json 缺少 tools-daily 分包')
  assert.ok(daily.pages.includes('pages/percent/index'), 'tools-daily 未注册百分比页面')

  for (const ext of ['.ts', '.json', '.wxml', '.wxss']) {
    assert.ok(
      fs.existsSync(path.join(ROOT, `subpackages/tools-daily/pages/percent/index${ext}`)),
      `缺少百分比页面文件 ${ext}`,
    )
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'core/toolbox/engines/percent.ts')))
  assert.ok(fs.existsSync(path.join(ROOT, 'subpackages/tools-daily/lib/percent.ts')))

  const pageJson = JSON.parse(read('subpackages/tools-daily/pages/percent/index.json'))
  assert.equal(pageJson.navigationBarTitleText, '百分比计算')

  const wxml = read('subpackages/tools-daily/pages/percent/index.wxml')
  assert.match(wxml, /tool-id="percent"/)
  assert.match(wxml, /bindtap="onMode"/)
  assert.match(wxml, /bind:run="onRun"/)
  assert.match(wxml, /bindtap="onCopy"/)
  assert.match(wxml, /占比/)
  assert.match(wxml, /增减幅/)
  assert.match(wxml, /配比/)

  const ts = read('subpackages/tools-daily/pages/percent/index.ts')
  assert.match(ts, /onShareAppMessage\s*\(/)
  assert.match(ts, /onShareTimeline\s*\(/)
  assert.match(ts, /percentOf/)
  assert.match(ts, /changeRate/)
  assert.match(ts, /ratioParts/)
  assert.equal(/wx\.request|uploadFile|downloadFile/.test(ts), false, '百分比计算不得联网')

  const registry = read('core/toolbox/registry.ts')
  assert.match(registry, /id: 'percent'/)
  assert.match(registry, /name: '百分比计算'/)
  assert.match(registry, /weight: 90/)
  assert.match(registry, /sensitive: ''/)
  assert.match(registry, /subpackages\/tools-daily\/pages\/percent\/index/)
  assert.match(read('subpackages/grow/lib/help.ts'), /percent: \{/)
  assert.match(read('scripts/check-budget.js'), /pages\/percent/)
  assert.match(read('scripts/e2e-tools.js'), /id: 'percent'/)
  assert.equal(/subpackages\//.test(read('core/toolbox/engines/percent.ts')), false, 'core 不得引用分包')

  const config = await import(`${URL_ROOT}core/workflow/workflowConfig.ts`)
  assert.equal(config.WORKFLOW_ROUTING.percent, 'silent')
  assert.deepEqual(config.WORKFLOW_ACCEPTS.percent, ['text'])

  const source = await import(`${URL_ROOT}core/workflow/workflowSource.ts`)
  assert.deepEqual(source.WORKFLOW_SOURCE_KEYS.percent.text, ['percentSummary'])

  const adapters = await import(`${URL_ROOT}core/workflow/workflowAdapters.ts`)
  assert.equal(adapters.getWorkflowAdapter('percent'), null, 'silent 工具不应有页面适配器')
  assert.match(read('core/workflow/workflowSilent.ts'), /case 'percent'/)
})
