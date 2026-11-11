/* ==========================================================================
   共享引擎 · 金额分运算
   - core/toolbox/engines/money.ts 为唯一实现
   - tools-core/lib/money.ts 必须是薄 re-export，禁止第二套实现
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
  return import(`${URL_ROOT}core/toolbox/engines/money.ts`)
}

test('金额：分解析支持两位小数、千分位与负数开关', async () => {
  const { parseCents } = await loadEngine()
  assert.equal(parseCents('12.34'), 1234)
  assert.equal(parseCents('1,234.5'), 123450)
  assert.equal(parseCents('0'), 0)
  assert.equal(parseCents('-1.01'), null)
  assert.equal(parseCents('-1.01', true), -101)
  assert.equal(parseCents('1.234'), null)
  assert.equal(parseCents('abc'), null)
})

test('金额：四舍五入与千分位格式化', async () => {
  const { roundHalfUp, formatCents, formatNumber } = await loadEngine()
  assert.equal(roundHalfUp(10.5), 11)
  assert.equal(roundHalfUp(-10.5), -11)
  assert.equal(formatCents(123456), '1,234.56')
  assert.equal(formatCents(-101), '-1.01')
  assert.equal(formatNumber(0), '0.00')
  assert.equal(formatNumber(Number.NaN), '—')
})

test('金额：基点、整数与小数边界', async () => {
  const { parseBasisPoints, parseInteger, parseDecimal, clamp } = await loadEngine()
  assert.equal(parseBasisPoints('3.6%'), 360)
  assert.equal(parseBasisPoints('100'), 10000)
  assert.equal(parseBasisPoints('1000'), null)
  assert.equal(parseInteger('12', 1, 360), 12)
  assert.equal(parseInteger('0', 1, 360), null)
  assert.equal(parseDecimal('1.234', 0, 2, 2), null)
  assert.equal(parseDecimal('1.23', 0, 2, 2), 1.23)
  assert.equal(clamp(120, 0, 100), 100)
})

test('金额：tools-core 兼容出口与 core 引擎同源', () => {
  const shim = read('subpackages/tools-core/lib/money.ts')
  assert.match(shim, /export \* from '\.\.\/\.\.\/\.\.\/core\/toolbox\/engines\/money'/)
  assert.doesNotMatch(shim, /function parseCents/)
})
