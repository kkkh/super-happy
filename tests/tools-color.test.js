/* ==========================================================================
   M5 · 颜色转换（color）
   - 引擎：黑白 21:1、红绿、非法色、3 位 HEX、AA/AAA 阈值
   - 工作流：silent 解析与摘要
   - 契约：tools-core / 页面 / 注册 / 帮助 / 配置 / 来源 / 无页面适配器
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

async function loadColor() {
  return import(`${URL_ROOT}core/toolbox/engines/color.ts`)
}

test('颜色：黑白对比度 21:1 与相对亮度', async () => {
  const color = await loadColor()
  const white = color.parseColor('#FFFFFF')
  const black = color.parseColor('#000000')
  assert.deepEqual(white, { r: 255, g: 255, b: 255 })
  assert.deepEqual(black, { r: 0, g: 0, b: 0 })
  assert.equal(color.relativeLuminance(white), 1)
  assert.equal(color.relativeLuminance(black), 0)
  assert.equal(color.contrastRatio(black, white), 21)
  assert.equal(color.contrastRatio(white, black), 21)
  assert.equal(color.contrastReport(21).ratioText, '21.0:1')
})

test('颜色：红绿与红白对比度', async () => {
  const color = await loadColor()
  const red = color.parseColor('#FF0000')
  const green = color.parseColor('#00FF00')
  const white = color.parseColor('#FFFFFF')

  const redGreen = color.contrastRatio(red, green)
  assert.equal(color.formatRatio(redGreen), '2.91:1')
  assert.equal(color.contrastReport(redGreen).aaNormal, false)

  const redWhite = color.contrastRatio(red, white)
  assert.equal(color.formatRatio(redWhite), '4.0:1')
  assert.equal(color.contrastReport(redWhite).aaNormal, false)
  assert.equal(color.contrastReport(redWhite).aaLarge, true)
})

test('颜色：非法值拒绝且透明度忽略', async () => {
  const color = await loadColor()
  for (const raw of [
    '',
    '   ',
    '#GGGGGG',
    '#12345',
    'rgb(256, 0, 0)',
    'hsl(0, 101%, 50%)',
    'red',
  ]) {
    assert.equal(color.parseColor(raw), null, `${raw} 应为非法颜色`)
  }

  assert.deepEqual(color.parseColor('#FF000080'), { r: 255, g: 0, b: 0 })
  assert.deepEqual(color.parseColor('#f008'), { r: 255, g: 0, b: 0 })
  assert.deepEqual(color.parseColor('rgba(255, 0, 0, 0.5)'), { r: 255, g: 0, b: 0 })
  assert.deepEqual(color.parseColor('hsla(0, 100%, 50%, 0.2)'), { r: 255, g: 0, b: 0 })
})

test('颜色：3 位 HEX、RGB / HSL 解析与互转', async () => {
  const color = await loadColor()
  assert.deepEqual(color.parseColor('#f00'), { r: 255, g: 0, b: 0 })
  assert.deepEqual(color.parseColor('rgb(61, 90, 254)'), { r: 61, g: 90, b: 254 })
  assert.deepEqual(color.parseColor('rgb(61 90 254)'), { r: 61, g: 90, b: 254 })
  assert.deepEqual(color.parseColor('hsl(0, 100%, 50%)'), { r: 255, g: 0, b: 0 })
  assert.deepEqual(color.parseColor('hsl(360 100% 50%)'), { r: 255, g: 0, b: 0 })

  const formats = color.formatColor(color.parseColor('#f00'))
  assert.equal(formats.hex, '#FF0000')
  assert.equal(formats.rgbText, 'rgb(255, 0, 0)')
  assert.equal(formats.hslText, 'hsl(0, 100%, 50%)')

  const blue = color.formatColor(color.parseColor('rgb(61, 90, 254)'))
  assert.equal(blue.hex, '#3D5AFE')

  for (const hex of ['#3D5AFE', '#00FF00', '#123456', '#FFAA00']) {
    const rgb = color.parseColor(hex)
    const roundTrip = color.hslToRgb(color.rgbToHsl(rgb))
    assert.ok(Math.abs(roundTrip.r - rgb.r) <= 1, `${hex} R 往返误差`)
    assert.ok(Math.abs(roundTrip.g - rgb.g) <= 1, `${hex} G 往返误差`)
    assert.ok(Math.abs(roundTrip.b - rgb.b) <= 1, `${hex} B 往返误差`)
  }

  const simulated = color.cvdResults(color.parseColor('#FF0000'), color.parseColor('#FFFFFF'))
  assert.equal(simulated.length, 3)
  assert.deepEqual(
    simulated.map((item) => item.type),
    ['protanopia', 'deuteranopia', 'tritanopia'],
  )
  for (const item of simulated) {
    assert.match(item.hex, /^#[0-9A-F]{6}$/)
    assert.ok(item.rgb.r >= 0 && item.rgb.r <= 255)
  }
})

test('颜色：AA/AAA 阈值、silent 摘要与页面契约', async () => {
  const color = await loadColor()

  const aa = color.contrastReport(4.5)
  assert.equal(aa.aaNormal, true)
  assert.equal(aa.aaaLarge, true)
  assert.equal(aa.aaaNormal, false)
  assert.equal(color.contrastReport(4.49).aaNormal, false)
  assert.equal(color.contrastReport(4.49).aaLarge, true)
  assert.equal(color.contrastReport(3).aaLarge, true)
  assert.equal(color.contrastReport(3).aaaLarge, false)
  assert.equal(color.contrastReport(7).aaaNormal, true)

  const summary = color.colorSummary(
    color.parseColor('#FF0000'),
    color.parseColor('#FFFFFF'),
  )
  assert.match(summary, /#FF0000 · rgb\(255, 0, 0\) · hsl\(0, 100%, 50%\)/)
  assert.match(summary, /对白 4\.0:1（仅大字 AA 通过）/)

  const silent = await import(`${URL_ROOT}core/workflow/workflowSilent.ts`)
  const output = silent.executeSilentTool('color', {
    type: 'text',
    payload: '#FF0000',
  })
  assert.equal(output.type, 'text')
  assert.match(output.payload, /#FF0000/)
  assert.match(output.payload, /对白 4\.0:1/)
  assert.throws(
    () =>
      silent.executeSilentTool('color', {
        type: 'text',
        payload: '#GGGGGG',
      }),
    /颜色/,
  )

  const app = JSON.parse(read('app.json'))
  const core = app.subpackages.find((item) => item.root === 'subpackages/tools-core')
  assert.ok(core, 'app.json 缺少 tools-core 分包')
  assert.ok(core.pages.includes('pages/color/index'), 'tools-core 未注册颜色转换页面')

  for (const ext of ['.ts', '.json', '.wxml', '.wxss']) {
    assert.ok(
      fs.existsSync(path.join(ROOT, `subpackages/tools-core/pages/color/index${ext}`)),
      `缺少颜色转换页面文件 ${ext}`,
    )
  }

  const pageJson = JSON.parse(read('subpackages/tools-core/pages/color/index.json'))
  assert.equal(pageJson.navigationBarTitleText, '颜色转换')

  const wxml = read('subpackages/tools-core/pages/color/index.wxml')
  assert.match(wxml, /tool-id="color"/)
  assert.match(wxml, /bind:run="onRun"/)
  assert.match(wxml, /bindtap="onCopy"/)
  assert.match(wxml, /bindtap="onCopyRow"/)
  assert.match(wxml, /HEX/)
  assert.match(wxml, /RGB/)
  assert.match(wxml, /HSL/)

  const ts = read('subpackages/tools-core/pages/color/index.ts')
  assert.match(ts, /onShareAppMessage\s*\(/)
  assert.match(ts, /onShareTimeline\s*\(/)
  assert.match(ts, /parseColor/)
  assert.match(ts, /contrastRatio/)
  assert.equal(/wx\.request|uploadFile|downloadFile/.test(ts), false, '颜色转换不得联网')

  const registry = read('core/toolbox/registry.ts')
  assert.match(registry, /id: 'color'/)
  assert.match(registry, /name: '颜色转换'/)
  assert.match(registry, /weight: 82/)
  assert.match(registry, /sensitive: ''/)
  assert.match(registry, /subpackages\/tools-core\/pages\/color\/index/)
  assert.match(read('subpackages/grow/lib/help.ts'), /color: \{/)
  assert.match(read('scripts/check-budget.js'), /pages\/color/)
  assert.match(read('scripts/e2e-tools.js'), /id: 'color'/)
  assert.equal(/subpackages\//.test(read('core/toolbox/engines/color.ts')), false, 'core 不得引用分包')

  const config = await import(`${URL_ROOT}core/workflow/workflowConfig.ts`)
  assert.equal(config.WORKFLOW_ROUTING.color, 'silent')
  assert.deepEqual(config.WORKFLOW_ACCEPTS.color, ['text'])

  const source = await import(`${URL_ROOT}core/workflow/workflowSource.ts`)
  assert.deepEqual(source.WORKFLOW_SOURCE_KEYS.color.text, ['colorSummary'])

  const adapters = await import(`${URL_ROOT}core/workflow/workflowAdapters.ts`)
  assert.equal(adapters.getWorkflowAdapter('color'), null, 'silent 工具不应有页面适配器')
  assert.match(read('core/workflow/workflowSilent.ts'), /case 'color'/)
})
