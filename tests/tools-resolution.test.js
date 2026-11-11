/* ==========================================================================
   批 2 · 分辨率与比例（resolution）
   - 引擎：16:9 化简、1280 宽、宽高 0、极端比例、按比例取整
   - 契约：页面 / 注册 / 帮助 / silent 工作流 / 包体清单
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
  return import(`${URL_ROOT}core/toolbox/engines/resolution.ts`)
}

test('分辨率：1920 × 1080 化简为 16:9', async () => {
  const resolution = await loadEngine()
  const ratio = resolution.simplifyRatio(1920, 1080)
  assert.ok(ratio)
  assert.equal(ratio.text, '16:9')
  const base = resolution.analyzeResolution(1920, 1080)
  assert.ok(base)
  assert.equal(base.megapixels, 2.07)
  assert.equal(base.isHD, true)
})

test('分辨率：目标宽 1280 → 1280 × 720', async () => {
  const resolution = await loadEngine()
  const plan = resolution.planResolution({ width: 1920, height: 1080, targetWidth: 1280 })
  assert.ok(plan)
  assert.equal(plan.targetWidth, 1280)
  assert.equal(plan.targetHeight, 720)
  assert.equal(plan.targetRatioText, '16:9')
  assert.match(resolution.resolutionSummary(plan), /目标 1280 × 720/)
})

test('分辨率：按目标比例 4:3 计算目标高度', async () => {
  const resolution = await loadEngine()
  const plan = resolution.planResolution({
    width: 1920,
    height: 1080,
    ratio: { width: 4, height: 3 },
  })
  assert.ok(plan)
  assert.equal(plan.targetWidth, 1920)
  assert.equal(plan.targetHeight, 1440)
  assert.equal(plan.targetRatioText, '4:3')
  assert.equal(plan.isHD, true)
})

test('分辨率：宽高 0 / 目标宽 0 拒绝', async () => {
  const resolution = await loadEngine()
  assert.equal(resolution.simplifyRatio(0, 1080), null)
  assert.equal(resolution.analyzeResolution(1920, 0), null)
  assert.equal(resolution.fitWidth(1920, 1080, 0), null)
  assert.equal(resolution.planResolution({ width: 0, height: 1080 }), null)
})

test('分辨率：极端比例取整后为 0 时拒绝', async () => {
  const resolution = await loadEngine()
  assert.equal(resolution.fitWidth(10000, 1, 320), null)
  assert.equal(
    resolution.planResolution({
      width: 10000,
      height: 1,
      ratio: { width: 100000, height: 1 },
    }),
    null,
  )
})

test('打印尺寸：A4 300 DPI、横版与 Letter 72 DPI', async () => {
  const resolution = await loadEngine()
  const a4 = resolution.printPixelSize({
    paperKey: 'a4',
    dpi: 300,
    orientation: 'portrait',
  })
  assert.ok(a4)
  assert.equal(a4.pixelWidth, 2480)
  assert.equal(a4.pixelHeight, 3508)
  assert.equal(a4.megapixels, 8.7)
  assert.equal(a4.widthCm, 21)
  assert.equal(a4.heightCm, 29.7)
  assert.match(resolution.printSummaryText(a4), /A4 竖版/)
  assert.match(resolution.printSummaryText(a4), /2480 × 3508 px/)

  const landscape = resolution.printPixelSize({
    paperKey: 'a4',
    dpi: 300,
    orientation: 'landscape',
  })
  assert.ok(landscape)
  assert.equal(landscape.pixelWidth, 3508)
  assert.equal(landscape.pixelHeight, 2480)
  assert.match(resolution.printSummaryText(landscape), /横版/)

  const letter = resolution.printPixelSize({
    paperKey: 'letter',
    dpi: 72,
    orientation: 'portrait',
  })
  assert.ok(letter)
  assert.equal(letter.pixelWidth, 612)
  assert.equal(letter.pixelHeight, 792)
})

test('打印尺寸：非法纸张 / DPI / 方向返回 null', async () => {
  const resolution = await loadEngine()
  assert.equal(
    resolution.printPixelSize({ paperKey: 'a0', dpi: 300, orientation: 'portrait' }),
    null,
  )
  assert.equal(
    resolution.printPixelSize({ paperKey: 'a4', dpi: 0, orientation: 'portrait' }),
    null,
  )
  assert.equal(
    resolution.printPixelSize({ paperKey: 'a4', dpi: 3000, orientation: 'portrait' }),
    null,
  )
  assert.equal(
    resolution.printPixelSize({ paperKey: 'a4', dpi: 300, orientation: 'auto' }),
    null,
  )
})

test('分辨率契约：页面 / 注册 / 帮助 / silent 工作流 / 包体清单', async () => {
  const app = JSON.parse(read('app.json'))
  const daily = app.subpackages.find((item) => item.root === 'subpackages/tools-daily')
  assert.ok(daily.pages.includes('pages/resolution/index'), 'app.json 未注册页面')

  for (const ext of ['.ts', '.json', '.wxml', '.wxss']) {
    assert.ok(
      fs.existsSync(path.join(ROOT, `subpackages/tools-daily/pages/resolution/index${ext}`)),
      `缺少页面文件 ${ext}`,
    )
  }
  assert.ok(
    fs.existsSync(path.join(ROOT, 'subpackages/tools-daily/lib/resolution.ts')),
    '缺少 tools-daily 薄 re-export',
  )

  const wxml = read('subpackages/tools-daily/pages/resolution/index.wxml')
  assert.match(wxml, /tool-id="resolution"/)
  assert.match(wxml, /bind:run="onRun"/)
  assert.match(wxml, /poster-data="\{\{posterData\}\}"/)
  assert.match(wxml, /bindtap="onCopy"/)
  assert.match(wxml, /data-mode="print"/)
  assert.match(wxml, /paperOptions/)
  assert.match(wxml, /dpiOptions/)
  assert.match(wxml, /onPaper/)
  assert.match(wxml, /onDpi/)

  const ts = read('subpackages/tools-daily/pages/resolution/index.ts')
  assert.match(ts, /onShareAppMessage\s*\(/)
  assert.match(ts, /onShareTimeline\s*\(/)
  assert.match(ts, /planResolution/)
  assert.match(ts, /printPixelSize/)
  assert.match(ts, /runPrint/)
  assert.equal(/wx\.request|uploadFile|downloadFile/.test(ts), false)

  const registry = read('core/toolbox/registry.ts')
  assert.match(registry, /id: 'resolution'/)
  assert.match(registry, /weight: 64/)
  assert.match(read('subpackages/grow/lib/help.ts'), /resolution: \{/)
  assert.match(read('scripts/check-budget.js'), /pages\/resolution/)
  assert.match(read('scripts/e2e-tools.js'), /id: 'resolution'/)

  const config = await import(`${URL_ROOT}core/workflow/workflowConfig.ts`)
  assert.equal(config.WORKFLOW_ROUTING.resolution, 'silent')
  assert.deepEqual(config.WORKFLOW_ACCEPTS.resolution, ['text'])

  const source = await import(`${URL_ROOT}core/workflow/workflowSource.ts`)
  assert.deepEqual(source.WORKFLOW_SOURCE_KEYS.resolution.text, ['resolutionSummary'])

  const silent = await import(`${URL_ROOT}core/workflow/workflowSilent.ts`)
  const output = silent.executeSilentTool('resolution', {
    type: 'text',
    payload: '1920x1080',
  })
  assert.equal(output.type, 'text')
  assert.match(output.payload, /16:9/)
  assert.match(output.payload, /2\.07 MP/)
  assert.throws(
    () => silent.executeSilentTool('resolution', { type: 'text', payload: '没有尺寸' }),
    /1920x1080/,
  )
})
