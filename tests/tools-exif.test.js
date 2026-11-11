/* ==========================================================================
   M5 · 图片信息（exif）
   - 引擎：尺寸 / 体积 / 格式 / 方向 / 宽高比 / 像素 / 摘要
   - 契约：tools-media / 页面 / 注册 / 帮助 / 配置 / 来源 / 注入适配器
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

async function loadExif() {
  return import(`${URL_ROOT}subpackages/tools-media/lib/exif.ts`)
}

test('图片信息：尺寸、宽高比与像素', async () => {
  const { normalizeImageMeta } = await loadExif()
  const meta = normalizeImageMeta({
    width: 4032,
    height: 3024,
    size: 2516582,
    type: 'jpeg',
    orientation: 'up',
    path: '/tmp/IMG_0001.jpg',
  })
  assert.ok(meta)
  assert.equal(meta.width, 4032)
  assert.equal(meta.height, 3024)
  assert.equal(meta.widthText, '4032 × 3024')
  assert.equal(meta.ratioText, '4 : 3')
  assert.equal(meta.megapixelsText, '1219 万像素')
  assert.equal(meta.fileName, 'IMG_0001.jpg')

  const odd = normalizeImageMeta({ width: 1234, height: 987, path: '/tmp/a.png' })
  assert.ok(odd)
  assert.equal(odd.ratioText, '1.25 : 1')
  assert.equal(
    normalizeImageMeta({ width: 100.9, height: 200.9 }).widthText,
    '100 × 200',
    '像素取整',
  )
})

test('图片信息：体积、格式与方向', async () => {
  const { normalizeImageMeta, exifSummary, formatImageSize } = await loadExif()
  assert.equal(formatImageSize(0), '—')
  assert.equal(formatImageSize(512), '512 B')
  assert.equal(formatImageSize(2048), '2.0 KB')
  assert.equal(formatImageSize(2516582), '2.40 MB')

  const base = normalizeImageMeta({
    width: 800,
    height: 600,
    size: 0,
    type: 'jpeg',
    orientation: 'right',
    path: '/tmp/photo.jpg',
  })
  assert.ok(base)
  assert.equal(base.sizeText, '—')
  assert.equal(base.typeLabel, 'JPEG')
  assert.equal(base.orientationLabel, '顺时针 90°')
  assert.equal(exifSummary(base), '800 × 600 · JPEG · — · 方向 顺时针 90°')

  const up = normalizeImageMeta({
    width: 1024,
    height: 768,
    size: 204800,
    path: '/tmp/up.jpg',
  })
  assert.ok(up)
  assert.equal(up.orientationLabel, '正常')
  assert.equal(exifSummary(up), '1024 × 768 · JPEG · 200.0 KB')

  assert.equal(
    normalizeImageMeta({ width: 10, height: 10, path: '/tmp/a.webp' }).typeLabel,
    'WebP',
    '缺少 type 时从扩展名回退',
  )
  assert.equal(
    normalizeImageMeta({ width: 10, height: 10, type: 'image/png' }).typeLabel,
    'PNG',
  )
  assert.equal(normalizeImageMeta({ width: 10, height: 10 }).typeLabel, '未知')
  assert.equal(
    normalizeImageMeta({ width: 10, height: 10, orientation: 'up-mirrored' })
      .orientationLabel,
    '水平镜像',
  )
  assert.equal(
    normalizeImageMeta({ width: 10, height: 10, orientation: 'sideways' })
      .orientationLabel,
    '未知',
  )
  assert.equal(
    normalizeImageMeta({
      width: 10,
      height: 10,
      path: '/tmp/%E5%9B%BE%E7%89%87.jpg',
    }).fileName,
    '图片.jpg',
  )
})

test('图片信息：读取失败返回 null', async () => {
  const { normalizeImageMeta } = await loadExif()
  for (const input of [null, undefined, {}, 'bad', 0, { width: 0, height: 100 }, { width: 100 }]) {
    assert.equal(normalizeImageMeta(input), null)
  }
})

test('图片信息：损坏文件的宽高一律拒绝', async () => {
  const { normalizeImageMeta } = await loadExif()
  const broken = [
    { width: -100, height: 100 },
    { width: 100, height: -1 },
    { width: Number.NaN, height: 100 },
    { width: 100, height: Number.NaN },
    { width: Number.POSITIVE_INFINITY, height: 100 },
    { width: 100, height: Number.NEGATIVE_INFINITY },
    { width: '100', height: '100' },
  ]
  for (const input of broken) {
    assert.equal(normalizeImageMeta(input), null, JSON.stringify(input))
  }
  const negativeSize = normalizeImageMeta({ width: 100, height: 100, size: -5 })
  assert.ok(negativeSize)
  assert.equal(negativeSize.sizeText, '—', '负数体积按 0 处理')
})

test('图片信息：八项注册契约与图片注入适配器', async () => {
  const app = JSON.parse(read('app.json'))
  const media = app.subpackages.find((item) => item.root === 'subpackages/tools-media')
  assert.ok(media, 'app.json 缺少 tools-media 分包')
  assert.ok(media.pages.includes('pages/exif/index'), 'tools-media 未注册图片信息页面')

  for (const ext of ['.ts', '.json', '.wxml', '.wxss']) {
    assert.ok(
      fs.existsSync(path.join(ROOT, `subpackages/tools-media/pages/exif/index${ext}`)),
      `缺少图片信息页面文件 ${ext}`,
    )
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'subpackages/tools-media/lib/exif.ts')))

  const pageJson = JSON.parse(read('subpackages/tools-media/pages/exif/index.json'))
  assert.equal(pageJson.navigationBarTitleText, '图片信息')

  const wxml = read('subpackages/tools-media/pages/exif/index.wxml')
  assert.match(wxml, /tool-id="exif"/)
  assert.match(wxml, /bindtap="onChoose"/)
  assert.match(wxml, /bind:tap="onCopy"/)
  assert.match(wxml, /poster-data="\{\{posterData\}\}"/)
  assert.match(wxml, /has-result="\{\{hasResult\}\}"/)
  assert.match(wxml, /不解析 GPS/)

  const ts = read('subpackages/tools-media/pages/exif/index.ts')
  assert.match(ts, /onShareAppMessage\s*\(/)
  assert.match(ts, /onShareTimeline\s*\(/)
  assert.match(ts, /onReceiveWorkflow\s*\(/)
  assert.match(ts, /readImageMeta/)
  assert.match(ts, /chooseSingleImage/)
  assert.equal(/saveImageToAlbum/.test(ts), false, '图片信息不写相册')
  assert.equal(/wx\.request|uploadFile|downloadFile/.test(ts), false, '图片信息不得联网')

  const engine = read('subpackages/tools-media/lib/exif.ts')
  assert.match(engine, /wx\.getImageInfo/)
  assert.match(engine, /getFileInfo/)
  assert.equal(/wx\.request|uploadFile|downloadFile/.test(engine), false, '引擎不得联网')

  const registry = read('core/toolbox/registry.ts')
  assert.match(registry, /id: 'exif'/)
  assert.match(registry, /name: '图片信息'/)
  assert.match(registry, /icon: '息'/)
  assert.match(registry, /weight: 58/)
  assert.match(registry, /sensitive: 'privacy'/)
  assert.match(registry, /subpackages\/tools-media\/pages\/exif\/index/)
  assert.match(read('subpackages/grow/lib/help.ts'), /exif: \{/)
  assert.match(read('scripts/check-budget.js'), /pages\/exif/)
  assert.match(read('scripts/e2e-tools.js'), /id: 'exif'/)

  const config = await import(`${URL_ROOT}core/workflow/workflowConfig.ts`)
  assert.equal(config.WORKFLOW_ROUTING.exif, 'jump')
  assert.deepEqual(config.WORKFLOW_ACCEPTS.exif, ['image'])

  const source = await import(`${URL_ROOT}core/workflow/workflowSource.ts`)
  assert.deepEqual(source.WORKFLOW_SOURCE_KEYS.exif.text, ['exifSummary'])
  const snapshot = source.readWorkflowSource('exif', { exifSummary: '4032 × 3024 · JPEG' })
  assert.equal(snapshot.data.type, 'text')
  assert.equal(snapshot.data.payload, '4032 × 3024 · JPEG')

  const adapters = await import(`${URL_ROOT}core/workflow/workflowAdapters.ts`)
  const adapter = adapters.getWorkflowAdapter('exif')
  assert.ok(adapter, 'jump 工具必须有适配器')
  let received = null
  const page = {
    data: { imagePath: '' },
    setData() {},
    onReceiveWorkflow(data) {
      received = data
      return true
    },
  }
  assert.equal(adapter.hasInput(page), false)
  assert.equal(adapter.isReady(page), true)
  assert.equal(await adapter.apply(page, { type: 'image', payload: '/tmp/a.jpg' }), true)
  assert.equal(received.payload, '/tmp/a.jpg')
  page.data.imagePath = '/tmp/a.jpg'
  assert.equal(adapter.hasInput(page), true)
  assert.equal(read('core/workflow/workflowSilent.ts').includes("case 'exif'"), false)
})
