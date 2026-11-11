/* ==========================================================================
   批 2 · 二维码识别（qr-decode）
   - 引擎：黄金二维码（8 掩码 + 中文）/ 无码 / 模糊 / 超长截断 / 尺寸钳制
   - 契约：页面 / 注册 / 帮助 / 图片工作流 / 适配器 / 开源许可
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
  return import(`${URL_ROOT}subpackages/tools-media/lib/qrdecode.ts`)
}

async function loadQrcode() {
  const module = await import(`${URL_ROOT}subpackages/tools-media/lib/qrcode.ts`)
  const factory = module.default
  factory.stringToBytes = factory.stringToBytesFuncs['UTF-8']
  return factory
}

/** 把 qrcode 矩阵渲染成 RGBA，模拟相册图片 */
async function renderQr(text, mask = 0, scale = 8, quiet = 4) {
  const qrcode = await loadQrcode()
  const code = qrcode(0, 'M')
  code.addData(text)
  code.make(mask)
  const modules = code.getModuleCount()
  const size = (modules + quiet * 2) * scale
  const data = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const mx = Math.floor(x / scale) - quiet
      const my = Math.floor(y / scale) - quiet
      const dark = mx >= 0 && my >= 0 && mx < modules && my < modules && code.isDark(my, mx)
      const value = dark ? 0 : 255
      const index = (y * size + x) * 4
      data[index] = value
      data[index + 1] = value
      data[index + 2] = value
      data[index + 3] = 255
    }
  }
  return { data, size }
}

/** 简单盒式模糊，用于模拟失焦照片 */
function boxBlur(source, size, radius) {
  const out = new Uint8ClampedArray(source.length)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let sum = 0
      let count = 0
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const xx = x + dx
          const yy = y + dy
          if (xx < 0 || yy < 0 || xx >= size || yy >= size) {
            continue
          }
          sum += source[(yy * size + xx) * 4]
          count += 1
        }
      }
      const value = Math.round(sum / count)
      const index = (y * size + x) * 4
      out[index] = value
      out[index + 1] = value
      out[index + 2] = value
      out[index + 3] = 255
    }
  }
  return out
}

test('二维码识别：黄金二维码覆盖 8 种掩码与中文', async () => {
  const { decodeImageData } = await loadEngine()
  const text = 'https://example.com/hello?from=chaohuan'
  for (let mask = 0; mask < 8; mask += 1) {
    const { data, size } = await renderQr(text, mask)
    assert.equal(decodeImageData(data, size, size), text, `掩码 ${mask} 解码失败`)
  }
  const chinese = '超欢工具箱 · 二维码识别'
  const { data, size } = await renderQr(chinese, 3)
  assert.equal(decodeImageData(data, size, size), chinese)
})

test('二维码识别：无码与非法输入返回 null', async () => {
  const { decodeImageData } = await loadEngine()
  const size = 240
  const blank = new Uint8ClampedArray(size * size * 4).fill(255)
  assert.equal(decodeImageData(blank, size, size), null)
  assert.equal(decodeImageData(null, size, size), null)
  assert.equal(decodeImageData(blank, 0, size), null)
  assert.equal(decodeImageData(new Uint8ClampedArray(16), 100, 100), null)
})

test('二维码识别：模糊图不崩溃并返回 null', async () => {
  const { decodeImageData } = await loadEngine()
  const text = 'https://example.com/hello?from=chaohuan'
  const { data, size } = await renderQr(text, 0, 8)
  const blurred = boxBlur(data, size, 6)
  assert.equal(decodeImageData(blurred, size, size), null)
})

test('二维码识别：超长文本截断展示，复制保留全文', async () => {
  const { qrDisplayText, QR_TEXT_LIMIT } = await loadEngine()
  assert.equal(QR_TEXT_LIMIT, 2000)
  const full = '测'.repeat(QR_TEXT_LIMIT + 1)
  const shown = qrDisplayText(full)
  assert.equal(shown.truncated, true)
  assert.equal(shown.display.length, QR_TEXT_LIMIT + 1)
  assert.ok(shown.display.endsWith('…'))
  assert.equal(shown.display.slice(0, QR_TEXT_LIMIT), full.slice(0, QR_TEXT_LIMIT))

  const short = qrDisplayText('hello')
  assert.deepEqual(short, { display: 'hello', truncated: false })
})

test('二维码识别：长边钳制到 1024', async () => {
  const { qrDecodeSize, QR_DECODE_MAX_EDGE } = await loadEngine()
  assert.equal(QR_DECODE_MAX_EDGE, 1024)
  assert.deepEqual(qrDecodeSize(2048, 1024), { width: 1024, height: 512 })
  assert.deepEqual(qrDecodeSize(800, 600), { width: 800, height: 600 })
  assert.deepEqual(qrDecodeSize(0, 0), { width: 1, height: 1 })
})

test('二维码识别契约：页面 / 注册 / 帮助 / 图片工作流 / 适配器 / 许可', async () => {
  const app = JSON.parse(read('app.json'))
  const media = app.subpackages.find((item) => item.root === 'subpackages/tools-media')
  assert.ok(media.pages.includes('pages/qr-decode/index'), 'app.json 未注册页面')

  for (const ext of ['.ts', '.json', '.wxml', '.wxss']) {
    assert.ok(
      fs.existsSync(path.join(ROOT, `subpackages/tools-media/pages/qr-decode/index${ext}`)),
      `缺少页面文件 ${ext}`,
    )
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'subpackages/tools-media/lib/qrdecode.ts')))
  assert.ok(fs.existsSync(path.join(ROOT, 'subpackages/tools-media/lib/qrdecode-vendor.ts')))

  const vendor = read('subpackages/tools-media/lib/qrdecode-vendor.ts')
  assert.match(vendor, /jsQR 1\.4\.0/)
  assert.match(vendor, /Apache License 2\.0/)
  assert.match(vendor, /export default jsQR/)

  const wxml = read('subpackages/tools-media/pages/qr-decode/index.wxml')
  assert.match(wxml, /tool-id="qr-decode"/)
  assert.match(wxml, /id="qr-canvas"/)
  assert.match(wxml, /type="2d"/)
  assert.match(wxml, /bindtap="onChoose"/)
  assert.match(wxml, /bind:tap="onCopy"/)
  assert.match(wxml, /truncated/)

  const ts = read('subpackages/tools-media/pages/qr-decode/index.ts')
  assert.match(ts, /onShareAppMessage\s*\(/)
  assert.match(ts, /onShareTimeline\s*\(/)
  assert.match(ts, /chooseSingleImage/)
  assert.match(ts, /decodeImageData/)
  assert.match(ts, /qrDisplayText/)
  assert.match(ts, /qrIsExternalLink/)
  assert.match(ts, /cleanupFiles/)
  /* 选图只预览，解码必须由「识别二维码」按钮显式触发 */
  const chooseBlock = ts.split('async onChoose()')[1].split('onRun()')[0]
  assert.equal(chooseBlock.includes('this.decode()'), false, '选图后不得自动解码')
  assert.equal(/wx\.request|uploadFile|downloadFile/.test(ts), false, '不得联网')
  assert.equal(/previewImage\(\{\s*current:\s*this\.data\.resultText/.test(ts), false, '不得把文本当图片打开')

  const registry = read('core/toolbox/registry.ts')
  assert.match(registry, /id: 'qr-decode'/)
  assert.match(registry, /weight: 80/)
  assert.match(registry, /sensitive: 'privacy'/)
  assert.match(read('subpackages/grow/lib/help.ts'), /'qr-decode': \{/)
  assert.match(read('scripts/check-budget.js'), /pages\/qr-decode/)
  assert.match(read('scripts/e2e-tools.js'), /id: 'qr-decode'/)
  assert.match(read('pages/legal/index.wxml'), /jsQR 1\.4\.0/)

  const config = await import(`${URL_ROOT}core/workflow/workflowConfig.ts`)
  assert.equal(config.WORKFLOW_ROUTING['qr-decode'], 'jump')
  assert.deepEqual(config.WORKFLOW_ACCEPTS['qr-decode'], ['image'])

  const source = await import(`${URL_ROOT}core/workflow/workflowSource.ts`)
  assert.deepEqual(source.WORKFLOW_SOURCE_KEYS['qr-decode'].text, ['qrSummary', 'resultText'])

  const adapters = await import(`${URL_ROOT}core/workflow/workflowAdapters.ts`)
  assert.ok(adapters.getWorkflowAdapter('qr-decode'), '缺少 qr-decode 图片适配器')
})
