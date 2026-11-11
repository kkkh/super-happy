/* ==========================================================================
   M5 · 证件号校验（id-validate）
   - 引擎：合法 / 非法 / 末位 X / 15 位旧证 / 18 位银行卡 / 超长
   - 契约：tools-daily / 页面 / 注册 / 帮助 / 配置 / 来源 / 注入适配器 / 脱敏
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

async function loadId() {
  return import(`${URL_ROOT}subpackages/tools-daily/lib/id.ts`)
}

function luhnCheckDigit(prefix) {
  let sum = 0
  let double = true
  for (let index = prefix.length - 1; index >= 0; index -= 1) {
    let digit = Number(prefix.charAt(index))
    if (double) {
      digit *= 2
      if (digit > 9) {
        digit -= 9
      }
    }
    sum += digit
    double = !double
  }
  return String((10 - (sum % 10)) % 10)
}

test('证件号：合法身份证返回出生日期、性别与地区码', async () => {
  const id = await loadId()
  const result = id.validateIdCard('11010519491231002X')
  assert.equal(result.ok, true)
  assert.equal(result.type, 'id-card')
  assert.equal(result.normalized, '11010519491231002X')
  assert.equal(result.birthDate, '1949-12-31')
  assert.equal(result.gender, '女')
  assert.equal(result.regionCode, '110105')
  assert.equal(result.algorithm, 'id-card')

  assert.equal(id.validateLuhn('4111111111111111'), true)
  assert.equal(id.validateLuhn('4111111111111112'), false)
  assert.equal(id.validateLuhn('123'), false)
  assert.match(id.idSummary(result), /身份证 110105\*{8}002X/)
  assert.equal(id.idSummary(result).includes('11010519491231002X'), false)
})

test('证件号：非法校验位、非法生日与格式错误', async () => {
  const id = await loadId()
  const badCheck = id.validateIdCard('110105194912310021')
  assert.equal(badCheck.ok, false)
  assert.match(badCheck.reason, /校验位/)

  const badBirth = id.validateIdCard('11010519491332002X')
  assert.equal(badBirth.ok, false)
  assert.match(badBirth.reason, /出生日期/)

  const short = id.validateIdCard('11010519491231002')
  assert.equal(short.ok, false)
  assert.match(short.reason, /18 位/)

  const badFormat = id.validateIdCard('11010519491231002Y')
  assert.equal(badFormat.ok, false)
  assert.match(badFormat.reason, /格式/)
})

test('证件号：末位 X 大小写与自动识别', async () => {
  const id = await loadId()
  const lower = id.validateIdentifier('11010519491231002x')
  assert.equal(lower.ok, true)
  assert.equal(lower.type, 'id-card')
  assert.equal(lower.normalized, '11010519491231002X')

  const auto = id.validateIdentifier('11010519491231002X')
  assert.equal(auto.ok, true)
  assert.equal(auto.type, 'id-card')
  assert.equal(id.validateIdentifier('', 'auto').ok, false)
  assert.match(id.validateIdentifier('', 'auto').reason, /请输入/)
})

test('证件号：15 位旧证、18 位银行卡与超长输入', async () => {
  const id = await loadId()
  const oldCard = id.validateIdentifier('130503670401001')
  assert.equal(oldCard.ok, false)
  assert.equal(oldCard.type, 'id-card')
  assert.match(oldCard.reason, /仅支持 18 位/)

  const card = `62220212345678901${luhnCheckDigit('62220212345678901')}`
  assert.equal(card.length, 18)
  const bank = id.validateIdentifier(card)
  assert.equal(bank.ok, true)
  assert.equal(bank.type, 'bank-card')
  assert.equal(bank.algorithm, 'luhn')
  assert.match(id.idSummary(bank), /银行卡 6222 \*{4} \d{4}/)

  const visa = id.validateIdentifier('4111 1111 1111 1111')
  assert.equal(visa.ok, true)
  assert.equal(visa.type, 'bank-card')

  const tooLong = id.validateIdentifier('12345678901234567890')
  assert.equal(tooLong.ok, false)
  assert.equal(tooLong.type, 'unknown')
  assert.match(tooLong.reason, /仅支持/)
})

test('证件号契约：页面 / 注册 / 帮助 / 注入适配器 / 脱敏 / 隐私文案', async () => {
  const app = JSON.parse(read('app.json'))
  const daily = app.subpackages.find((item) => item.root === 'subpackages/tools-daily')
  assert.ok(daily, 'app.json 缺少 tools-daily 分包')
  assert.ok(daily.pages.includes('pages/id-validate/index'), 'tools-daily 未注册证件号校验页面')

  for (const ext of ['.ts', '.json', '.wxml', '.wxss']) {
    assert.ok(
      fs.existsSync(path.join(ROOT, `subpackages/tools-daily/pages/id-validate/index${ext}`)),
      `缺少证件号校验页面文件 ${ext}`,
    )
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'subpackages/tools-daily/lib/id.ts')))

  const pageJson = JSON.parse(read('subpackages/tools-daily/pages/id-validate/index.json'))
  assert.equal(pageJson.navigationBarTitleText, '证件号校验')

  const wxml = read('subpackages/tools-daily/pages/id-validate/index.wxml')
  assert.match(wxml, /tool-id="id-validate"/)
  assert.match(wxml, /bind:run="onRun"/)
  assert.match(wxml, /bindtap="onMode"/)
  assert.match(wxml, /bindtap="onCopy"/)
  assert.match(wxml, /bindtap="onCopyRow"/)
  assert.match(wxml, /身份证/)
  assert.match(wxml, /银行卡/)
  assert.match(wxml, /不保存、不上传/)

  const ts = read('subpackages/tools-daily/pages/id-validate/index.ts')
  assert.match(ts, /自动识别/)
  assert.match(ts, /onShareAppMessage\s*\(/)
  assert.match(ts, /onShareTimeline\s*\(/)
  assert.match(ts, /validateIdentifier/)
  assert.match(ts, /idSummary/)
  assert.match(ts, /onReceiveWorkflow\s*\(/)
  assert.equal(/wx\.request|uploadFile|downloadFile/.test(ts), false, '证件号校验不得联网')
  assert.equal(/wx\./.test(read('subpackages/tools-daily/lib/id.ts')), false, '引擎不得依赖 wx')

  const registry = read('core/toolbox/registry.ts')
  assert.match(registry, /id: 'id-validate'/)
  assert.match(registry, /name: '证件号校验'/)
  assert.match(registry, /weight: 68/)
  assert.match(registry, /sensitive: 'personal'/)
  assert.match(registry, /privacyNote: '号码只在本机校验，不保存、不上传'/)
  assert.match(registry, /subpackages\/tools-daily\/pages\/id-validate\/index/)
  assert.match(read('subpackages/grow/lib/help.ts'), /'id-validate': \{/)
  assert.match(read('scripts/check-budget.js'), /pages\/id-validate/)
  assert.match(read('scripts/e2e-tools.js'), /id: 'id-validate'/)

  const config = await import(`${URL_ROOT}core/workflow/workflowConfig.ts`)
  assert.equal(config.WORKFLOW_ROUTING['id-validate'], 'jump')
  assert.deepEqual(config.WORKFLOW_ACCEPTS['id-validate'], ['text'])

  const source = await import(`${URL_ROOT}core/workflow/workflowSource.ts`)
  assert.deepEqual(source.WORKFLOW_SOURCE_KEYS['id-validate'].text, ['idSummary'])

  const adapters = await import(`${URL_ROOT}core/workflow/workflowAdapters.ts`)
  const adapter = adapters.getWorkflowAdapter('id-validate')
  assert.ok(adapter, 'jump 工具必须有适配器')
  let received = null
  const page = {
    data: { value: '' },
    setData(patch, callback) {
      Object.assign(this.data, patch)
      if (callback) {
        callback()
      }
    },
    onReceiveWorkflow(data) {
      received = data
      return true
    },
  }
  assert.equal(adapter.hasInput(page), false)
  assert.equal(adapter.isReady(page), true)
  assert.equal(
    await adapter.apply(page, { type: 'text', payload: '11010519491231002X' }),
    true,
  )
  assert.equal(received.payload, '11010519491231002X')
  page.data.value = '11010519491231002X'
  assert.equal(adapter.hasInput(page), true)
  assert.equal(read('core/workflow/workflowSilent.ts').includes("case 'id-validate'"), false)
})
