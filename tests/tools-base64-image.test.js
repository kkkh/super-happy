/* ==========================================================================
   M5 · Base64 图片模式（base64）
   - 文本：UTF-8 / Base64 字节一致、URL-safe、非法输入
   - 图片：MIME、data URL 前缀、2MB 上限、读取失败、页面契约
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

async function loadBase64() {
  return import(`${URL_ROOT}subpackages/tools-core/lib/base64.ts`)
}

function mockWx({ size = 1024, data = 'aGVsbG8=', readFail = false } = {}) {
  const calls = { read: 0 }
  global.wx = {
    getFileSystemManager: () => ({
      getFileInfo: ({ success }) => success({ size }),
      readFile: ({ success, fail }) => {
        calls.read += 1
        if (readFail) {
          fail({ errMsg: 'read fail' })
          return
        }
        success({ data })
      },
    }),
  }
  return calls
}

test('Base64 文本：UTF-8 字节一致与 URL-safe', async () => {
  const base64 = await loadBase64()
  assert.deepEqual(base64.encodeTextToBase64('A'), { base64: 'QQ==', byteLength: 1 })
  assert.deepEqual(base64.encodeTextToBase64('中'), { base64: '5Lit', byteLength: 3 })
  assert.deepEqual(base64.encodeTextToBase64('😀'), {
    base64: '8J+YgA==',
    byteLength: 4,
  })

  const sample = '超欢 A😀\n第二行'
  const encoded = base64.encodeTextToBase64(sample)
  const decoded = base64.decodeBase64ToText(encoded.base64)
  assert.equal(decoded.text, sample)
  assert.equal(decoded.byteLength, encoded.byteLength)

  assert.equal(base64.decodeBase64ToText('5Lit').text, '中')
  assert.equal(base64.decodeBase64ToText(' 5Lit \n').text, '中')
  assert.deepEqual(base64.base64ToBytes('-_-_'), [0xfb, 0xff, 0xbf])
  assert.throws(() => base64.decodeBase64ToText('abcde'), /长度/)
  assert.throws(() => base64.decodeBase64ToText('!!!!'), /无效/)
  assert.throws(() => base64.decodeBase64ToText(''), /请输入/)
})

test('Base64 图片：MIME、data URL 前缀与 2MB 边界', async () => {
  const base64 = await loadBase64()
  assert.equal(base64.mimeForImage('/tmp/a.JPG'), 'image/jpeg')
  assert.equal(base64.mimeForImage('/tmp/a.png?x=1'), 'image/png')
  assert.equal(base64.mimeForImage('/tmp/a.webp'), 'image/webp')
  assert.equal(base64.mimeForImage('/tmp/a.unknown'), 'image/jpeg')
  assert.equal(
    base64.withDataUrlPrefix('abc', 'image/png'),
    'data:image/png;base64,abc',
  )
  assert.equal(base64.isImageWithinLimit(base64.BASE64_MAX_BYTES), true)
  assert.equal(base64.isImageWithinLimit(base64.BASE64_MAX_BYTES + 1), false)
  assert.equal(base64.isImageWithinLimit(0), false)
  assert.equal(base64.isImageWithinLimit(Number.NaN), false)
})

test('Base64 图片：imageToBase64 成功、超限与读取失败', async () => {
  const base64 = await loadBase64()

  const calls = mockWx({ size: 1024, data: 'aGVsbG8=' })
  const result = await base64.imageToBase64('/tmp/photo.PNG', true)
  assert.equal(result.base64, 'aGVsbG8=')
  assert.equal(result.dataUrl, 'data:image/png;base64,aGVsbG8=')
  assert.equal(result.size, 1024)
  assert.equal(result.mime, 'image/png')
  assert.equal(calls.read, 1)

  const raw = await base64.imageToBase64('/tmp/photo.PNG', false)
  assert.equal(raw.base64, 'aGVsbG8=')

  const oversize = mockWx({ size: base64.BASE64_MAX_BYTES + 1 })
  await assert.rejects(
    () => base64.imageToBase64('/tmp/big.jpg', true),
    /2MB/,
  )
  assert.equal(oversize.read, 0, '超限时不得读取文件')

  mockWx({ size: 0 })
  await assert.rejects(() => base64.imageToBase64('/tmp/empty.jpg'), /无法读取图片大小/)

  mockWx({ size: 1024, readFail: true })
  await assert.rejects(() => base64.imageToBase64('/tmp/a.jpg'), /读取图片失败/)

  delete global.wx
})

test('Base64 图片契约：页面 / 注册 / 帮助 / E2E / 隐私授权', async () => {
  const app = JSON.parse(read('app.json'))
  const core = app.subpackages.find((item) => item.root === 'subpackages/tools-core')
  assert.ok(core.pages.includes('pages/base64/index'))
  for (const ext of ['.ts', '.json', '.wxml', '.wxss']) {
    assert.ok(
      fs.existsSync(path.join(ROOT, `subpackages/tools-core/pages/base64/index${ext}`)),
      `缺少 Base64 页面文件 ${ext}`,
    )
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'subpackages/tools-core/lib/base64.ts')))

  const page = read('subpackages/tools-core/pages/base64/index.ts')
  assert.match(page, /from '\.\.\/\.\.\/lib\/base64'/)
  assert.match(page, /ensurePrivacyAuthorized/)
  assert.match(page, /wx\.chooseMedia/)
  assert.match(page, /imageToBase64/)
  assert.match(page, /onImagePrefix/)
  assert.match(page, /BASE64_MAX_BYTES/)
  assert.equal(/const ALPHABET/.test(page), false, '页面不得重复实现 Base64 表')
  assert.equal(/function utf8ToBytes/.test(page), false, '页面不得重复实现 UTF-8 编码')

  const wxml = read('subpackages/tools-core/pages/base64/index.wxml')
  assert.match(wxml, /data-mode="image"/)
  assert.match(wxml, /onChooseImage/)
  assert.match(wxml, /imagePrefix/)
  assert.match(wxml, /2MB/)
  assert.match(wxml, /data URL/)

  const engine = read('subpackages/tools-core/lib/base64.ts')
  assert.equal(/wx\.request|uploadFile|downloadFile/.test(engine), false, '不得联网')
  assert.match(engine, /getFileInfo/)
  assert.match(engine, /readFile/)

  const registry = read('core/toolbox/registry.ts')
  assert.match(registry, /id: 'base64'/)
  assert.match(registry, /desc: '文本 \/ 图片 · 本机编解码'/)
  assert.match(registry, /weight: 68/)
  assert.match(read('subpackages/grow/lib/help.ts'), /2MB/)
  assert.match(read('scripts/e2e-tools.js'), /id: 'base64'/)

  const config = await import(`${URL_ROOT}core/workflow/workflowConfig.ts`)
  assert.equal(config.WORKFLOW_ROUTING.base64, 'silent')
  assert.deepEqual(config.WORKFLOW_ACCEPTS.base64, ['text', 'json'])
})
