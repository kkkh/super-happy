/* ==========================================================================
   批 1 · 进制转换（radix）
   - 引擎黄金值：四进制互转、负数、前缀、128 位、非法字符
   - 页面契约：路由注册、统一外壳、复制入口、无网络请求
   - 工作流：silent 注册与摘要输出
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

async function loadRadix() {
  return import(`${URL_ROOT}subpackages/tools-core/lib/radix.ts`)
}

test('进制：255 四进制互转全部正确', async () => {
  const { convertRadix } = await loadRadix()
  const result = convertRadix('255', 10)
  assert.equal(result.ok, true)
  const map = Object.fromEntries(result.conversions.map((item) => [item.base, item.value]))
  assert.equal(map[2], '11111111')
  assert.equal(map[8], '377')
  assert.equal(map[10], '255')
  assert.equal(map[16], 'FF')
})

test('进制：负数、前缀与下划线分隔', async () => {
  const { convertRadix } = await loadRadix()
  const negative = convertRadix('-1010', 2)
  assert.equal(negative.ok, true)
  assert.equal(negative.conversions.find((item) => item.base === 10).value, '-10')

  const prefixed = convertRadix('0xFF', 16)
  assert.equal(prefixed.ok, true)
  assert.equal(prefixed.conversions.find((item) => item.base === 10).value, '255')

  const underscored = convertRadix('1111_1111', 2)
  assert.equal(underscored.ok, true)
  assert.equal(underscored.conversions.find((item) => item.base === 16).value, 'FF')
})

test('进制：非法字符定位、空值、前缀不匹配与超长', async () => {
  const { convertRadix, radixErrorText } = await loadRadix()

  const invalid = convertRadix('102', 2)
  assert.equal(invalid.ok, false)
  assert.equal(invalid.reason, 'invalid-char')
  assert.equal(invalid.index, 2)
  assert.match(radixErrorText(invalid, 2), /第 3 位/)

  /* 错误位置必须回溯到原始输入：'-1012' 中 2 是第 5 个字符 */
  const negativeInvalid = convertRadix('-1012', 2)
  assert.equal(negativeInvalid.index, 4)
  assert.match(radixErrorText(negativeInvalid, 2), /第 5 位/)

  /* 前缀与所选进制不匹配时按普通数字解析，'x' 定位到原始第 3 位 */
  const mismatch = convertRadix('0xFF', 2)
  assert.equal(mismatch.reason, 'invalid-char')
  assert.equal(mismatch.index, 1)

  /* 0 开头但第二个字符是合法十六进制数字：应正常解析而不是误判前缀 */
  const leadingZero = convertRadix('0BEE', 16)
  assert.equal(leadingZero.ok, true)
  assert.equal(leadingZero.conversions.find((item) => item.base === 10).value, '3054')

  assert.equal(convertRadix('   ', 10).reason, 'empty')
  /* 前导零不计入有效数字上限 */
  assert.equal(convertRadix('0'.repeat(200) + '1', 10).ok, true)
  assert.equal(convertRadix('1'.repeat(129), 10).reason, 'too-long')
})

test('进制：128 位大数不丢精度', async () => {
  const { convertRadix } = await loadRadix()
  const decimal = '9'.repeat(128)
  const result = convertRadix(decimal, 10)
  assert.equal(result.ok, true)
  assert.equal(result.decimal, decimal)
})

test('进制页面：路由、外壳、复制与无网络', () => {
  const app = JSON.parse(read('app.json'))
  const core = app.subpackages.find((item) => item.root === 'subpackages/tools-core')
  assert.ok(core.pages.includes('pages/radix/index'))

  for (const ext of ['.ts', '.json', '.wxml', '.wxss']) {
    assert.ok(fs.existsSync(path.join(ROOT, `subpackages/tools-core/pages/radix/index${ext}`)))
  }

  const wxml = read('subpackages/tools-core/pages/radix/index.wxml')
  assert.match(wxml, /<glass-tool-shell/)
  assert.match(wxml, /tool-id="radix"/)
  assert.match(wxml, /poster-data="\{\{posterData\}\}"/)
  assert.match(wxml, /bindtap="onCopy"/)
  assert.match(wxml, /aria-label="复制/)

  const ts = read('subpackages/tools-core/pages/radix/index.ts')
  assert.match(ts, /onShareAppMessage\s*\(/)
  assert.match(ts, /onShareTimeline\s*\(/)
  assert.equal(/wx\.request|uploadFile|downloadFile/.test(ts), false)

  const registry = read('core/toolbox/registry.ts')
  assert.match(registry, /id: 'radix'/)
  assert.match(read('subpackages/grow/lib/help.ts'), /radix: \{/)
})

test('进制工作流：silent 注册与摘要输出', async () => {
  const config = await import(`${URL_ROOT}core/workflow/workflowConfig.ts`)
  assert.equal(config.WORKFLOW_ROUTING.radix, 'silent')
  assert.deepEqual(config.WORKFLOW_ACCEPTS.radix, ['text'])

  const silent = await import(`${URL_ROOT}core/workflow/workflowSilent.ts`)
  const output = silent.executeSilentTool('radix', { type: 'text', payload: '255' })
  assert.match(output.payload, /BIN 11111111/)
  assert.match(output.payload, /HEX FF/)

  assert.throws(
    () => silent.executeSilentTool('radix', { type: 'text', payload: 'abc' }),
    /仅支持十进制整数/,
  )
})
