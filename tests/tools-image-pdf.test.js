/* ==========================================================================
   M5 · 图片转 PDF（image-pdf）
   - 引擎：JPEG SOF 解析、PDF 结构 / xref、页面尺寸、9 页与 2MB 上限
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

async function loadPdf() {
  return import(`${URL_ROOT}subpackages/tools-media/lib/pdf.ts`)
}

function fakeJpeg(width, height, components = 3, padding = 0) {
  const parts = [0xff, 0xd8]
  let remaining = padding
  while (remaining > 4) {
    const dataLength = Math.min(65533, remaining - 4)
    const segmentLength = dataLength + 2
    parts.push(0xff, 0xfe, (segmentLength >> 8) & 0xff, segmentLength & 0xff)
    for (let index = 0; index < dataLength; index += 1) {
      parts.push(0)
    }
    remaining -= dataLength + 4
  }
  const sofLength = 8 + components * 3
  parts.push(
    0xff,
    0xc0,
    (sofLength >> 8) & 0xff,
    sofLength & 0xff,
    8,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    components,
  )
  for (let index = 0; index < components; index += 1) {
    parts.push(index + 1, 0x11, 0)
  }
  parts.push(0xff, 0xd9)
  return new Uint8Array(parts)
}

function latin1(bytes) {
  let text = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    text += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return text
}

test('图片转 PDF：JPEG SOF 解析宽高与通道数', async () => {
  const pdf = await loadPdf()
  assert.deepEqual(pdf.jpegSize(fakeJpeg(640, 480)), {
    width: 640,
    height: 480,
    components: 3,
  })
  assert.deepEqual(pdf.jpegSize(fakeJpeg(120, 90, 1)), {
    width: 120,
    height: 90,
    components: 1,
  })
  assert.equal(pdf.jpegSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), null)
  assert.equal(pdf.jpegSize(new Uint8Array()), null)
  assert.equal(pdf.jpegSize(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])), null)
})

test('图片转 PDF：PDF 结构、页数与 xref 偏移', async () => {
  const pdf = await loadPdf()
  const output = pdf.buildImagePdf(
    [
      { data: fakeJpeg(640, 480), width: 640, height: 480 },
      { data: fakeJpeg(800, 600), width: 800, height: 600 },
    ],
    'a4',
  )
  assert.ok(output instanceof Uint8Array)
  const text = latin1(output)
  assert.equal(text.startsWith('%PDF-1.4'), true)
  assert.match(text, /\/Type \/Catalog/)
  assert.match(text, /\/Count 2/)
  assert.equal((text.match(/\/Type \/Page /g) || []).length, 2)
  assert.match(text, /\/MediaBox \[0 0 595 842\]/)
  assert.match(text, /\/Filter \/DCTDecode/)
  assert.match(text, /cm \/Im0 Do Q/)
  assert.match(text, /trailer\n<< \/Size 9 \/Root 1 0 R >>/)
  assert.equal(text.endsWith('%%EOF\n'), true)

  const startxref = text.match(/startxref\n(\d+)\n%%EOF\n$/)
  assert.ok(startxref)
  const offset = Number(startxref[1])
  assert.equal(text.slice(offset, offset + 4), 'xref')
  const xrefLines = text.slice(offset).split('\n')
  assert.match(xrefLines[0], /^xref$/)
  assert.match(xrefLines[1], /^0 9$/)
  assert.match(xrefLines[2], /^0000000000 65535 f $/)
})

test('图片转 PDF：A4 / Letter / 原图尺寸与非法输入', async () => {
  const pdf = await loadPdf()
  const one = [{ data: fakeJpeg(32, 16), width: 32, height: 16 }]
  assert.match(latin1(pdf.buildImagePdf(one, 'letter')), /\/MediaBox \[0 0 612 792\]/)
  assert.match(latin1(pdf.buildImagePdf(one, 'original')), /\/MediaBox \[0 0 32 16\]/)

  const tooMany = Array.from({ length: 10 }, () => ({
    data: fakeJpeg(32, 16),
    width: 32,
    height: 16,
  }))
  assert.equal(pdf.buildImagePdf(tooMany, 'a4'), null)
  assert.equal(pdf.buildImagePdf([], 'a4'), null)
  assert.equal(
    pdf.buildImagePdf([{ data: new Uint8Array([1, 2, 3]), width: 32, height: 16 }], 'a4'),
    null,
  )
  assert.equal(pdf.buildImagePdf([{ data: fakeJpeg(32, 16, 2), width: 32, height: 16 }], 'a4'), null)
})

test('图片转 PDF：超过 2MB 拒绝', async () => {
  const pdf = await loadPdf()
  const big = fakeJpeg(32, 16, 3, pdf.PDF_MAX_BYTES + 1024)
  assert.ok(big.length > pdf.PDF_MAX_BYTES)
  assert.equal(pdf.buildImagePdf([{ data: big, width: 32, height: 16 }], 'a4'), null)
})

test('图片转 PDF 契约：页面 / 注册 / 帮助 / 注入适配器 / 本机生成', async () => {
  const app = JSON.parse(read('app.json'))
  const media = app.subpackages.find((item) => item.root === 'subpackages/tools-media')
  assert.ok(media, 'app.json 缺少 tools-media 分包')
  assert.ok(media.pages.includes('pages/image-pdf/index'), 'tools-media 未注册图片转 PDF 页面')

  for (const ext of ['.ts', '.json', '.wxml', '.wxss']) {
    assert.ok(
      fs.existsSync(path.join(ROOT, `subpackages/tools-media/pages/image-pdf/index${ext}`)),
      `缺少图片转 PDF 页面文件 ${ext}`,
    )
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'subpackages/tools-media/lib/pdf.ts')))

  const pageJson = JSON.parse(read('subpackages/tools-media/pages/image-pdf/index.json'))
  assert.equal(pageJson.navigationBarTitleText, '图片转 PDF')

  const wxml = read('subpackages/tools-media/pages/image-pdf/index.wxml')
  assert.match(wxml, /tool-id="image-pdf"/)
  assert.match(wxml, /bind:run="onRun"/)
  assert.match(wxml, /bindtap="onChoose"/)
  assert.match(wxml, /catchtap="onRemove"/)
  assert.match(wxml, /bindtap="onPageSize"/)
  assert.match(wxml, /bindtap="onPreview"/)
  assert.match(wxml, /id="pdf-canvas"/)
  assert.match(wxml, /A4/)
  assert.match(wxml, /Letter/)

  const ts = read('subpackages/tools-media/pages/image-pdf/index.ts')
  assert.match(ts, /onShareAppMessage\s*\(/)
  assert.match(ts, /onShareTimeline\s*\(/)
  assert.match(ts, /onReceiveWorkflow\s*\(/)
  assert.match(ts, /buildImagePdf/)
  assert.match(ts, /jpegSize/)
  assert.match(ts, /openDocument/)
  assert.match(ts, /writeFile/)
  assert.match(ts, /invalidateResult/)
  assert.equal(/saveImageToAlbum/.test(ts), false, 'PDF 不写入相册')
  assert.equal(/wx\.request|uploadFile|downloadFile/.test(ts), false, '图片转 PDF 不得联网')
  assert.equal(/wx\./.test(read('subpackages/tools-media/lib/pdf.ts')), false, '引擎不得依赖 wx')

  const chooseBody = ts.slice(ts.indexOf('async onChoose'), ts.indexOf('toItem('))
  assert.equal(/this\.render\(/.test(chooseBody), false, '选图后不得自动生成 PDF')
  const sizeBody = ts.slice(ts.indexOf('onPageSize'), ts.indexOf('onRun('))
  assert.equal(/this\.render\(/.test(sizeBody), false, '修改页面尺寸后不得自动生成 PDF')

  const registry = read('core/toolbox/registry.ts')
  assert.match(registry, /id: 'image-pdf'/)
  assert.match(registry, /name: '图片转 PDF'/)
  assert.match(registry, /weight: 62/)
  assert.match(registry, /sensitive: 'privacy'/)
  assert.match(registry, /subpackages\/tools-media\/pages\/image-pdf\/index/)
  assert.match(read('subpackages/grow/lib/help.ts'), /'image-pdf': \{/)
  assert.match(read('scripts/check-budget.js'), /pages\/image-pdf/)
  assert.match(read('scripts/e2e-tools.js'), /id: 'image-pdf'/)

  const config = await import(`${URL_ROOT}core/workflow/workflowConfig.ts`)
  assert.equal(config.WORKFLOW_ROUTING['image-pdf'], 'jump')
  assert.deepEqual(config.WORKFLOW_ACCEPTS['image-pdf'], ['image'])

  const source = await import(`${URL_ROOT}core/workflow/workflowSource.ts`)
  assert.deepEqual(source.WORKFLOW_SOURCE_KEYS['image-pdf'].image, ['outputPath'])

  const adapters = await import(`${URL_ROOT}core/workflow/workflowAdapters.ts`)
  const adapter = adapters.getWorkflowAdapter('image-pdf')
  assert.ok(adapter, 'jump 工具必须有适配器')
  let received = null
  const page = {
    data: { selected: [] },
    setData() {},
    onReceiveWorkflow(data) {
      received = data
      return true
    },
  }
  assert.equal(adapter.hasInput(page), false)
  assert.equal(adapter.isReady(page), true)
  assert.equal(
    await adapter.apply(page, { type: 'image', payload: '/tmp/a.jpg' }),
    true,
  )
  assert.equal(received.payload, '/tmp/a.jpg')
  page.data.selected = [{ id: 1 }]
  assert.equal(adapter.hasInput(page), true)
  assert.equal(read('core/workflow/workflowSilent.ts').includes("case 'image-pdf'"), false)
})
