/* ==========================================================================
   M5 · 密码强度评估（password）
   - 引擎：熵公式、弱 / 中 / 强阈值、空密码、进度百分比
   - 契约：页面复用共享引擎、注册 / 帮助 / E2E
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

async function loadPassword() {
  return import(`${URL_ROOT}subpackages/tools-core/lib/password.ts`)
}

test('密码强度：信息熵 = 长度 × log2(字符集)', async () => {
  const password = await loadPassword()
  const entropy = password.passwordEntropy(16, 26)
  assert.ok(Math.abs(entropy - 16 * Math.log2(26)) < 1e-9)
  assert.ok(Math.abs(password.passwordEntropy(8, 10) - 8 * Math.log2(10)) < 1e-9)
  assert.ok(Math.abs(password.passwordEntropy(16, 94) - 16 * Math.log2(94)) < 1e-9)
  assert.equal(password.passwordEntropy(16.9, 26.9), entropy, '长度与字符集向下取整')
  assert.equal(password.passwordEntropy(0, 26), 0)
  assert.equal(password.passwordEntropy(16, 0), 0)
  assert.equal(password.passwordEntropy(16, 1), 0)
  assert.equal(password.passwordEntropy(Number.NaN, 26), 0)
  assert.equal(password.passwordEntropy(16, Number.NaN), 0)
})

test('密码强度：弱 / 中 / 强阈值与进度', async () => {
  const password = await loadPassword()
  const weak = password.strengthLevel(39.9)
  assert.equal(weak.key, 'weak')
  assert.equal(weak.label, '弱')
  assert.equal(weak.percent, 49)
  assert.equal(weak.entropy, 39.9)

  const mediumLow = password.strengthLevel(40)
  assert.equal(mediumLow.key, 'medium')
  assert.equal(mediumLow.label, '中')
  assert.equal(mediumLow.percent, 50)

  const mediumHigh = password.strengthLevel(79.9)
  assert.equal(mediumHigh.key, 'medium')
  assert.equal(mediumHigh.percent, 99)

  const strong = password.strengthLevel(80)
  assert.equal(strong.key, 'strong')
  assert.equal(strong.label, '强')
  assert.equal(strong.percent, 100)

  assert.equal(password.strengthLevel(128).percent, 100)
  assert.ok(password.strengthLevel(20).percent < weak.percent)
})

test('密码强度：空密码与非法输入', async () => {
  const password = await loadPassword()
  for (const input of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = password.strengthLevel(input)
    assert.equal(result.key, 'empty')
    assert.equal(result.label, '空密码')
    assert.equal(result.percent, 0)
    assert.equal(result.entropy, 0)
  }
})

test('密码强度契约：页面复用共享引擎与展示', async () => {
  const app = JSON.parse(read('app.json'))
  const core = app.subpackages.find((item) => item.root === 'subpackages/tools-core')
  assert.ok(core.pages.includes('pages/password/index'))
  for (const ext of ['.ts', '.json', '.wxml', '.wxss']) {
    assert.ok(
      fs.existsSync(path.join(ROOT, `subpackages/tools-core/pages/password/index${ext}`)),
      `缺少密码页面文件 ${ext}`,
    )
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'subpackages/tools-core/lib/password.ts')))
  assert.equal(/wx\./.test(read('subpackages/tools-core/lib/password.ts')), false, '强度引擎不得依赖 wx')

  const page = read('subpackages/tools-core/pages/password/index.ts')
  assert.match(page, /from '\.\.\/\.\.\/lib\/password'/)
  assert.match(page, /passwordEntropy/)
  assert.match(page, /strengthLevel/)
  assert.equal(/Math\.log2\(/.test(page), false, '页面不得重复实现熵公式')

  const wxml = read('subpackages/tools-core/pages/password/index.wxml')
  assert.match(wxml, /strengthPercent/)
  assert.match(wxml, /strengthText/)
  assert.match(wxml, /entropyText/)
  assert.match(wxml, /40–79/)
  assert.match(wxml, /不联网/)

  const registry = read('core/toolbox/registry.ts')
  assert.match(registry, /id: 'password'/)
  assert.match(registry, /name: '随机密码'/)
  assert.match(registry, /weight: 72/)
  assert.match(read('subpackages/grow/lib/help.ts'), /password: \{/)
  assert.match(read('subpackages/grow/lib/help.ts'), /信息熵/)
  assert.match(read('scripts/e2e-tools.js'), /id: 'password'/)

  const config = await import(`${URL_ROOT}core/workflow/workflowConfig.ts`)
  assert.equal(config.WORKFLOW_ROUTING.password, 'jump')
  assert.deepEqual(config.WORKFLOW_ACCEPTS.password, [])
})
