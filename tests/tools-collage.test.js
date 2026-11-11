/* ==========================================================================
   批 2 · 拼图与长图（collage）
   - 引擎：2×2 / 3×3 尺寸、竖排总高、间距累加、容量截断、解码跳过摘要
   - 契约：页面 / 多图选择 / 注册 / 帮助 / 图片工作流 / 适配器
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

async function loadCollage() {
  return import(`${URL_ROOT}subpackages/tools-media/lib/collage.ts`)
}

test('拼图：2×2 / 3×3 输出尺寸与间距累加', async () => {
  const collage = await loadCollage()
  const grid2 = collage.collageLayout('grid2', 4, 8)
  assert.ok(grid2)
  assert.equal(grid2.width, 2 * 1024 + 8)
  assert.equal(grid2.height, grid2.width)
  assert.deepEqual(grid2.cells[0], { x: 0, y: 0, width: 1024, height: 1024 })
  assert.deepEqual(grid2.cells[1], { x: 1032, y: 0, width: 1024, height: 1024 })
  assert.deepEqual(grid2.cells[2], { x: 0, y: 1032, width: 1024, height: 1024 })

  const grid3 = collage.collageLayout('grid3', 9, 16)
  assert.ok(grid3)
  assert.equal(grid3.width, 3 * 1024 + 32)
  assert.equal(grid3.cells.length, 9)
  assert.equal(grid3.cells[8].x, 2 * (1024 + 16))
  assert.equal(grid3.cells[8].y, 2 * (1024 + 16))
})

test('拼图：竖排总高与 4096 上限', async () => {
  const collage = await loadCollage()
  const vertical = collage.collageLayout('vertical', 3, 8)
  assert.ok(vertical)
  assert.equal(vertical.width, 1024)
  assert.equal(vertical.height, 3 * 1024 + 16)
  assert.equal(vertical.cells[1].y, 1032)
  assert.equal(vertical.cells[2].y, 2064)

  const nine = collage.collageLayout('vertical', 9, 16)
  assert.ok(nine)
  assert.ok(nine.height <= 4096, `竖排高度超限: ${nine.height}`)
  assert.equal(nine.height, 9 * 440 + 8 * 16)
})

test('拼图：容量截断与不足 2 张拒绝', async () => {
  const collage = await loadCollage()
  assert.equal(collage.collageDrawCount('grid2', 9), 4)
  assert.equal(collage.collageDrawCount('grid3', 9), 9)
  assert.equal(collage.collageDrawCount('vertical', 9), 9)
  assert.equal(collage.collageDrawCount('grid2', 1), 0)
  assert.equal(collage.collageDrawCount('grid3', 0), 0)
  assert.equal(collage.collageLayout('grid2', 1, 8), null)
  assert.equal(collage.collageLayout('vertical', 1, 8), null)
})

test('拼图：解码失败跳过摘要', async () => {
  const collage = await loadCollage()
  assert.equal(collage.collageSkipNotice(5, 0), '')
  assert.equal(collage.collageSkipNotice(5, 2), '已跳过 2 / 5 张无法解码的图片')
  assert.equal(collage.collageSkipNotice(0, 0), '')
})

test('拼图契约：页面 / 多图选择 / 注册 / 帮助 / 图片工作流 / 适配器', async () => {
  const app = JSON.parse(read('app.json'))
  const media = app.subpackages.find((item) => item.root === 'subpackages/tools-media')
  assert.ok(media.pages.includes('pages/collage/index'), 'app.json 未注册页面')

  for (const ext of ['.ts', '.json', '.wxml', '.wxss']) {
    assert.ok(
      fs.existsSync(path.join(ROOT, `subpackages/tools-media/pages/collage/index${ext}`)),
      `缺少页面文件 ${ext}`,
    )
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'subpackages/tools-media/lib/collage.ts')))

  const imageLib = read('subpackages/tools-media/lib/image.ts')
  assert.match(imageLib, /export async function chooseImages/)
  assert.match(imageLib, /ensurePrivacyAuthorized/)
  assert.match(imageLib, /count: limit/)

  const wxml = read('subpackages/tools-media/pages/collage/index.wxml')
  assert.match(wxml, /tool-id="collage"/)
  assert.match(wxml, /id="collage-canvas"/)
  assert.match(wxml, /type="2d"/)
  assert.match(wxml, /can-run=/)
  assert.match(wxml, /bindtap="onChoose"/)
  assert.match(wxml, /bindtap="onTemplate"/)
  assert.match(wxml, /bindtap="onGap"/)
  assert.match(wxml, /bindtap="onBackground"/)
  assert.match(wxml, /bind:tap="onSave"/)

  const ts = read('subpackages/tools-media/pages/collage/index.ts')
  assert.match(ts, /onShareAppMessage\s*\(/)
  assert.match(ts, /onShareTimeline\s*\(/)
  assert.match(ts, /chooseImages/)
  assert.match(ts, /collageLayout/)
  assert.match(ts, /onReceiveWorkflow/)
  assert.match(ts, /cleanupFiles/)
  assert.match(ts, /invalidateResult/)
  assert.equal(/wx\.request|uploadFile|downloadFile/.test(ts), false, '不得联网')

  const chooseBody = ts.slice(ts.indexOf('async onChoose'), ts.indexOf('toItem('))
  assert.equal(/this\.render\(/.test(chooseBody), false, '选图后不得自动生成拼图')
  const configBody = ts.slice(ts.indexOf('onTemplate'), ts.indexOf('onRun('))
  assert.equal(/this\.render\(/.test(configBody), false, '修改参数后不得自动生成拼图')

  const registry = read('core/toolbox/registry.ts')
  assert.match(registry, /id: 'collage'/)
  assert.match(registry, /weight: 70/)
  assert.match(registry, /sensitive: 'privacy'/)
  assert.match(read('subpackages/grow/lib/help.ts'), /collage: \{/)
  assert.match(read('scripts/check-budget.js'), /pages\/collage/)
  assert.match(read('scripts/e2e-tools.js'), /id: 'collage'/)

  const config = await import(`${URL_ROOT}core/workflow/workflowConfig.ts`)
  assert.equal(config.WORKFLOW_ROUTING.collage, 'jump')
  assert.deepEqual(config.WORKFLOW_ACCEPTS.collage, ['image'])

  const source = await import(`${URL_ROOT}core/workflow/workflowSource.ts`)
  assert.deepEqual(source.WORKFLOW_SOURCE_KEYS.collage.image, ['outputPath'])

  const adapters = await import(`${URL_ROOT}core/workflow/workflowAdapters.ts`)
  assert.ok(adapters.getWorkflowAdapter('collage'), '缺少 collage 图片适配器')
})
