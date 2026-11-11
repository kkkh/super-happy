/* ==========================================================================
   M5 · 条形码生成（barcode）
   - 引擎：CODE128B 编码黄金值、校验位、静区与 1-bit PNG 尺寸
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

async function loadBarcode() {
  return import(`${URL_ROOT}subpackages/tools-media/lib/barcode.ts`)
}

function bits(modules) {
  return modules.map((bar) => (bar ? '1' : '0')).join('')
}

test('条形码：CODE128B 黄金值 A 与模块结构', async () => {
  const { encodeCode128B, BARCODE_QUIET_MODULES } = await loadBarcode()
  const result = encodeCode128B('A')
  assert.equal(result.ok, true)
  assert.equal(result.text, 'A')
  assert.deepEqual(result.codes, [104, 33, 34])
  assert.equal(result.checksum, 34)
  assert.equal(result.charCount, 1)

  const quiet = '0'.repeat(BARCODE_QUIET_MODULES)
  const expected =
    quiet +
    '11010010000' + // 起始符 B
    '10100011000' + // 数据符 33（A）
    '10001011000' + // 校验符 34
    '1100011101011' + // 终止符
    quiet
  assert.equal(bits(result.modules), expected)
  assert.equal(result.moduleCount, 66)
  assert.equal(result.modules.slice(0, BARCODE_QUIET_MODULES).some(Boolean), false)
  assert.equal(result.modules.slice(-BARCODE_QUIET_MODULES).some(Boolean), false)
})

test('条形码：校验位、80 字符边界与 PNG 尺寸', async () => {
  const {
    BARCODE_MAX_CHARS,
    barcodePngBase64,
    encodeCode128B,
  } = await loadBarcode()

  const hello = encodeCode128B('HELLO')
  assert.equal(hello.ok, true)
  assert.deepEqual(hello.codes, [104, 40, 37, 44, 44, 47, 40])
  assert.equal(hello.checksum, 40)

  const max = encodeCode128B('A'.repeat(BARCODE_MAX_CHARS))
  assert.equal(max.ok, true)
  assert.equal(max.charCount, 80)
  assert.equal(max.codes.length, 82, '起始符 + 80 数据符 + 校验符')
  assert.equal(max.codes[0], 104)

  const image = barcodePngBase64(max, 2)
  assert.ok(image)
  assert.equal(image.width, max.moduleCount * 2)
  assert.equal(image.height, 100)
  const bytes = Buffer.from(image.base64, 'base64')
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  assert.equal(bytes.readUInt32BE(16), image.width)
  assert.equal(bytes.readUInt32BE(20), image.height)
  assert.equal(bytes[24], 1, '位深 1')
  assert.equal(bytes[25], 0, '灰度色彩类型')

  const thick = barcodePngBase64(hello, 4)
  assert.ok(thick)
  assert.equal(thick.width, hello.moduleCount * 4)
  assert.equal(thick.height, 200)
  assert.equal(barcodePngBase64(hello, 3).moduleWidth, 3)
})

test('条形码：非 ASCII 与控制字符拒绝', async () => {
  const { encodeCode128B } = await loadBarcode()
  for (const input of ['中文', 'A中B', 'AB😀', 'A\tB', 'A\u0000B', '超欢-128']) {
    const result = encodeCode128B(input)
    assert.equal(result.ok, false, `${JSON.stringify(input)} 应拒绝`)
    assert.equal(result.error, 'non-ascii')
  }
  /* 可见 ASCII 全段可用，含空格与英文标点 */
  const printable = encodeCode128B('A z 0 !~')
  assert.equal(printable.ok, true)
  assert.equal(printable.charCount, 8)
})

test('条形码：空输入与纯空白拒绝', async () => {
  const { encodeCode128B } = await loadBarcode()
  for (const input of ['', '   ', '\n\t ', undefined, null, 0]) {
    const result = encodeCode128B(input)
    assert.equal(result.ok, false)
    assert.equal(result.error, 'empty')
  }
})

test('条形码：超长拒绝与八项注册契约', async () => {
  const barcode = await loadBarcode()
  assert.equal(barcode.encodeCode128B('A'.repeat(81)).error, 'too-long')
  assert.equal(barcode.encodeCode128B('A'.repeat(81)).ok, false)

  const app = JSON.parse(read('app.json'))
  const media = app.subpackages.find((item) => item.root === 'subpackages/tools-media')
  assert.ok(media, 'app.json 缺少 tools-media 分包')
  assert.ok(media.pages.includes('pages/barcode/index'), 'tools-media 未注册条形码页面')

  for (const ext of ['.ts', '.json', '.wxml', '.wxss']) {
    assert.ok(
      fs.existsSync(path.join(ROOT, `subpackages/tools-media/pages/barcode/index${ext}`)),
      `缺少条形码页面文件 ${ext}`,
    )
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'subpackages/tools-media/lib/barcode.ts')))

  const pageJson = JSON.parse(read('subpackages/tools-media/pages/barcode/index.json'))
  assert.equal(pageJson.navigationBarTitleText, '条形码生成')

  const wxml = read('subpackages/tools-media/pages/barcode/index.wxml')
  assert.match(wxml, /tool-id="barcode"/)
  assert.match(wxml, /bind:run="onRun"/)
  assert.match(wxml, /bind:tap="onModule"/)
  assert.match(wxml, /bind:tap="onSave"/)
  assert.match(wxml, /bind:tap="onCopy"/)
  assert.match(wxml, /poster-data="\{\{posterData\}\}"/)
  assert.match(wxml, /CODE128B/)

  const ts = read('subpackages/tools-media/pages/barcode/index.ts')
  assert.match(ts, /onShareAppMessage\s*\(/)
  assert.match(ts, /onShareTimeline\s*\(/)
  assert.match(ts, /onReceiveWorkflow\s*\(/)
  assert.match(ts, /encodeCode128B/)
  assert.match(ts, /barcodePngBase64/)
  assert.match(ts, /writePngFile/)
  assert.match(ts, /saveImageToAlbum/)
  assert.equal(/wx\.request|uploadFile|downloadFile/.test(ts), false, '条形码不得联网')
  assert.equal(/wx\./.test(read('subpackages/tools-media/lib/barcode.ts')), false, '引擎不得依赖 wx')
  assert.equal(/<canvas/.test(wxml), false, '条形码不依赖 Canvas')

  const registry = read('core/toolbox/registry.ts')
  assert.match(registry, /id: 'barcode'/)
  assert.match(registry, /name: '条形码生成'/)
  assert.match(registry, /weight: 60/)
  assert.match(registry, /sensitive: 'privacy'/)
  assert.match(registry, /subpackages\/tools-media\/pages\/barcode\/index/)
  assert.match(read('subpackages/grow/lib/help.ts'), /barcode: \{/)
  assert.match(read('scripts/check-budget.js'), /pages\/barcode/)
  assert.match(read('scripts/e2e-tools.js'), /id: 'barcode'/)

  const config = await import(`${URL_ROOT}core/workflow/workflowConfig.ts`)
  assert.equal(config.WORKFLOW_ROUTING.barcode, 'jump')
  assert.deepEqual(config.WORKFLOW_ACCEPTS.barcode, ['text'])

  const source = await import(`${URL_ROOT}core/workflow/workflowSource.ts`)
  assert.deepEqual(source.WORKFLOW_SOURCE_KEYS.barcode.image, ['outputPath'])

  const adapters = await import(`${URL_ROOT}core/workflow/workflowAdapters.ts`)
  const adapter = adapters.getWorkflowAdapter('barcode')
  assert.ok(adapter, 'jump 工具必须有适配器')
  let received = null
  const page = {
    data: { content: '' },
    setData() {},
    onReceiveWorkflow(data) {
      received = data
      return true
    },
  }
  assert.equal(adapter.hasInput(page), false)
  assert.equal(adapter.isReady(page), true)
  assert.equal(await adapter.apply(page, { type: 'text', payload: 'TBX-2026-001' }), true)
  assert.equal(received.payload, 'TBX-2026-001')
  page.data.content = 'TBX'
  assert.equal(adapter.hasInput(page), true)
  assert.equal(read('core/workflow/workflowSilent.ts').includes("case 'barcode'"), false)
})
