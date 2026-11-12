/* ==========================================================================
   诊断包 · 脱敏、丢弃与预览契约
   - 覆盖路径 / Key / Token / 邮箱 / 手机号 / 证件号脱敏
   - 覆盖 20 条上限、500 字截断、50KB 上限与用户输入整条丢弃
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { registerHooks } = require('node:module')
const { pathToFileURL } = require('node:url')

const ROOT = path.resolve(__dirname, '..')

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !path.extname(specifier)) {
      return nextResolve(`${specifier}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})

async function loadDiagnostics() {
  return import(pathToFileURL(path.join(ROOT, 'core/services/diagnostics.ts')).href)
}

test('诊断脱敏：路径、Key、Bearer、邮箱、手机号与证件号', async () => {
  const mod = await loadDiagnostics()

  assert.match(mod.redactDiagnosticText('token=abc123'), /token=<redacted>/)
  assert.match(mod.redactDiagnosticText('Authorization: Bearer abc.def'), /Bearer <redacted>/)
  assert.equal(
    mod.redactDiagnosticText('/Users/qinchao/Desktop/超欢-小程序/core/app.ts'),
    '<path>',
  )
  assert.equal(
    mod.redactDiagnosticText('https://restapi.amap.com/v3/weather?key=abc'),
    '<path>',
  )
  assert.equal(mod.redactDiagnosticText('56967916@qq.com'), '<redacted>')
  assert.equal(mod.redactDiagnosticText('13800138000'), '<redacted>')
  assert.equal(mod.redactDiagnosticText('11010519491231002X'), '<redacted>')
})

test('诊断丢弃：脱敏后仍像用户输入的消息整条丢弃', async () => {
  const mod = await loadDiagnostics()

  assert.equal(mod.shouldDropDiagnosticMessage('金额：1234 元'), true)
  assert.equal(mod.shouldDropDiagnosticMessage('姓名：张三'), true)
  assert.equal(mod.shouldDropDiagnosticMessage('错误码 123456'), true)
  assert.equal(mod.shouldDropDiagnosticMessage('TypeError: Cannot read property x of undefined'), false)
})

test('诊断条目：20 条上限、500 字截断与非法数据丢弃', async () => {
  const mod = await loadDiagnostics()
  const raw = Array.from({ length: 25 }, (_, index) => ({
    at: 1760000000000 + index,
    kind: 'app-error',
    message: `错误 ${index}`,
    route: 'pages/help/index',
  }))
  raw.push({ at: 1, kind: 'app-error', message: '金额：99 元', route: 'pages/help/index' })
  raw.push('not-an-object')

  const result = mod.sanitizeDiagnosticEntries(raw, 1760000000000)
  assert.equal(result.entries.length, 20)
  assert.equal(result.dropped, 7)
  assert.equal(result.entries[0].message, '错误 0')

  const long = mod.sanitizeDiagnosticEntries(
    [{ at: 1, kind: 'app-error', message: 'x'.repeat(800), route: 'pages/help/index' }],
    1760000000000,
  )
  assert.equal(long.entries[0].message.length, 500)
})

test('诊断条目：非应用路由替换为 <path>，未知 kind 归一为 unknown', async () => {
  const mod = await loadDiagnostics()
  const result = mod.sanitizeDiagnosticEntries(
    [{ at: 1760000000000, kind: 'evil', message: 'boom', route: '/Users/qinchao/app.ts' }],
    1760000000000,
  )

  assert.equal(result.entries[0].kind, 'unknown')
  assert.equal(result.entries[0].route, '<path>')
})

test('诊断预览：包含五类字段且不超过 50KB', async () => {
  const mod = await loadDiagnostics()
  const preview = mod.buildDiagnosticPreview({
    appVersion: '1.1.0',
    sdkVersion: '3.17.6',
    wechatVersion: '8.0.50',
    deviceModel: 'iPhone 15 Pro',
    system: 'iOS 18.0',
    route: 'pages/help/index',
    entries: [
      { at: 1760000000000, kind: 'app-error', message: 'TypeError: boom', route: 'pages/index/index' },
    ],
    now: 1760000000000,
  })

  assert.match(preview.text, /应用版本：1\.1\.0/)
  assert.match(preview.text, /基础库：3\.17\.6/)
  assert.match(preview.text, /设备：iPhone 15 Pro \/ iOS 18\.0/)
  assert.match(preview.text, /当前路由：pages\/help\/index/)
  assert.match(preview.text, /最近错误（1 条，已脱敏）/)
  assert.equal(preview.entries, 1)
  assert.equal(preview.dropped, 0)
  assert.ok(preview.bytes > 0 && preview.bytes <= mod.DIAGNOSTIC_MAX_BYTES)
})

test('诊断预览：敏感条目被丢弃并计入 dropped', async () => {
  const mod = await loadDiagnostics()
  const preview = mod.buildDiagnosticPreview({
    appVersion: '1.1.0',
    sdkVersion: '3.17.6',
    wechatVersion: '',
    deviceModel: 'iPhone',
    system: 'iOS',
    route: 'pages/help/index',
    entries: [
      { at: 1, kind: 'app-error', message: '金额：1234 元', route: 'pages/help/index' },
      { at: 2, kind: 'unhandled-rejection', message: 'TypeError: boom', route: 'pages/help/index' },
    ],
    now: 1760000000000,
  })

  assert.equal(preview.entries, 1)
  assert.equal(preview.dropped, 1)
  assert.match(preview.text, /已丢弃 1 条记录（敏感或超限）/)
  assert.equal(preview.text.includes('金额'), false)
})

test('诊断文件名与时间格式', async () => {
  const mod = await loadDiagnostics()
  const at = new Date(2026, 10, 11, 9, 7, 5).getTime()

  assert.equal(mod.diagnosticFileName(at), '超欢诊断-20261111-0907')
  assert.equal(mod.formatDiagnosticTime(at), '2026-11-11 09:07:05')
})

test('诊断服务：不联网，使用新版设备信息接口并复用导出服务', () => {
  const source = fs.readFileSync(path.join(ROOT, 'core/services/diagnostics.ts'), 'utf8')

  assert.equal(/wx\.request|uploadFile|downloadFile/.test(source), false)
  assert.match(source, /getAppBaseInfo/)
  assert.match(source, /getDeviceInfo/)
  assert.equal(/getSystemInfoSync/.test(source), false)
  assert.match(source, /prepareExport/)
  assert.match(source, /DIAGNOSTIC_MAX_BYTES = 50 \* 1024/)
})
