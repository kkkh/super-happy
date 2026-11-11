/* ==========================================================================
   批 1 · 图片编辑（photo-edit）
   - 几何黄金值：裁剪、钳制、旋转、点位映射
   - 透明补白口径
   - 契约：页面 / 注册 / 帮助 / 图片工作流与来源字段
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

async function loadGeometry() {
  return import(`${URL_ROOT}subpackages/tools-media/lib/geometry.ts`)
}

test('图片编辑：居中裁剪三种比例与自由比例', async () => {
  const g = await loadGeometry()
  assert.deepEqual(g.cropRect({ width: 1000, height: 500 }, '1:1'), {
    x: 250,
    y: 0,
    width: 500,
    height: 500,
  })
  assert.deepEqual(g.cropRect({ width: 4000, height: 3000 }, '16:9'), {
    x: 0,
    y: 375,
    width: 4000,
    height: 2250,
  })
  assert.deepEqual(g.cropRect({ width: 4000, height: 3000 }, '4:3'), {
    x: 0,
    y: 0,
    width: 4000,
    height: 3000,
  })
  assert.deepEqual(g.cropRect({ width: 800, height: 600 }, 'free'), {
    x: 0,
    y: 0,
    width: 800,
    height: 600,
  })
  assert.equal(g.cropRect({ width: 40, height: 20 }, '1:1'), null)
})

test('图片编辑：源图 12MP 上限与长边 4096 钳制', async () => {
  const g = await loadGeometry()
  assert.equal(g.clampSourceSize(8000, 2000).code, 'too-large')
  assert.equal(g.clampSourceSize(0, 100).code, 'invalid')
  assert.equal(g.clampSourceSize(20, 20).code, 'too-small')

  const exact = g.clampSourceSize(4000, 3000)
  assert.equal(exact.ok, true)
  assert.equal(exact.scaled, false)
  assert.equal(exact.scale, 1)

  const scaled = g.clampSourceSize(5000, 1000)
  assert.equal(scaled.ok, true)
  assert.equal(scaled.width, 4096)
  assert.equal(scaled.height, 819)
  assert.equal(scaled.scaled, true)
})

test('图片编辑：旋转宽高互换与点位映射', async () => {
  const g = await loadGeometry()
  assert.deepEqual(g.rotatedSize({ width: 400, height: 300 }, 0), {
    width: 400,
    height: 300,
  })
  assert.deepEqual(g.rotatedSize({ width: 400, height: 300 }, 90), {
    width: 300,
    height: 400,
  })
  assert.deepEqual(g.rotatedSize({ width: 400, height: 300 }, 270), {
    width: 300,
    height: 400,
  })
  assert.equal(g.normalizeRotation(450), 90)

  /* 顺时针 90°：裁剪图左上角映射到输出右上角 */
  assert.deepEqual(g.mapPoint({ x: 0, y: 0 }, { width: 400, height: 300 }, 90), {
    x: 300,
    y: 0,
  })
  /* 水平翻转：左上角映射到右上角 */
  assert.deepEqual(
    g.mapPoint({ x: 0, y: 0 }, { width: 400, height: 300 }, 0, true, false),
    { x: 400, y: 0 },
  )
})

test('图片编辑：透明像素按 alpha 合成到白底', async () => {
  const g = await loadGeometry()
  assert.deepEqual(g.flattenToWhite(0, 0, 0, 0), { r: 255, g: 255, b: 255, a: 255 })
  assert.deepEqual(g.flattenToWhite(255, 0, 0, 255), { r: 255, g: 0, b: 0, a: 255 })
  const half = g.flattenToWhite(255, 0, 0, 128)
  assert.equal(half.a, 255)
  assert.equal(half.r, 255)
  assert.equal(half.g, 127)
  assert.equal(half.b, 127)
})

test('图片编辑契约：页面 / 注册 / 帮助 / 图片工作流', async () => {
  const app = JSON.parse(read('app.json'))
  const media = app.subpackages.find((item) => item.root === 'subpackages/tools-media')
  assert.ok(media.pages.includes('pages/photo-edit/index'), 'app.json 未注册页面')

  for (const ext of ['.ts', '.json', '.wxml', '.wxss']) {
    assert.ok(
      fs.existsSync(path.join(ROOT, `subpackages/tools-media/pages/photo-edit/index${ext}`)),
      `缺少页面文件 ${ext}`,
    )
  }

  const wxml = read('subpackages/tools-media/pages/photo-edit/index.wxml')
  assert.match(wxml, /tool-id="photo-edit"/)
  assert.match(wxml, /show-run="\{\{false\}\}"/)
  assert.match(wxml, /bind:tap="onChoose"/)
  assert.match(wxml, /bind:tap="onSave"/)
  assert.match(wxml, /poster-data="\{\{posterData\}\}"/)

  const ts = read('subpackages/tools-media/pages/photo-edit/index.ts')
  assert.match(ts, /onShareAppMessage\s*\(/)
  assert.match(ts, /onShareTimeline\s*\(/)
  assert.match(ts, /onReceiveWorkflow\s*\(/)
  assert.match(ts, /unlink/)
  assert.equal(/wx\.request|uploadFile|downloadFile/.test(ts), false)

  const registry = read('core/toolbox/registry.ts')
  assert.match(registry, /id: 'photo-edit'/)
  assert.match(registry, /sensitive: 'privacy'/)
  assert.match(registry, /weight: 85/)
  assert.match(read('subpackages/grow/lib/help.ts'), /'photo-edit': \{/)

  const config = await import(`${URL_ROOT}core/workflow/workflowConfig.ts`)
  assert.equal(config.WORKFLOW_ROUTING['photo-edit'], 'jump')
  assert.deepEqual(config.WORKFLOW_ACCEPTS['photo-edit'], ['image'])

  const source = await import(`${URL_ROOT}core/workflow/workflowSource.ts`)
  assert.deepEqual(source.WORKFLOW_SOURCE_KEYS['photo-edit'].image, ['outputPath'])

  const adapters = read('core/workflow/workflowAdapters.ts')
  assert.match(adapters, /'photo-edit':/)
})
