/* ==========================================================================
   M5 · 单位扩展 7 类（unit）
   - 引擎：13 类目录 / 数据 / 时间 / 压力 / 能量 / 功率 / 角度 / 频率
   - 契约：页面复用共享引擎、Workflow 分类上下文、无重复实现
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

async function loadUnits() {
  return import(`${URL_ROOT}subpackages/tools-core/lib/units.ts`)
}

function convert(units, categoryKey, fromKey, toKey, value) {
  const category = units.UNIT_CATEGORIES.find((item) => item.key === categoryKey)
  assert.ok(category, `缺少分类 ${categoryKey}`)
  const from = category.units.find((item) => item.key === fromKey)
  const to = category.units.find((item) => item.key === toKey)
  assert.ok(from, `缺少单位 ${categoryKey}.${fromKey}`)
  assert.ok(to, `缺少单位 ${categoryKey}.${toKey}`)
  return units.convertUnit(category, from, to, value)
}

test('单位扩展：13 类目录与分组顺序', async () => {
  const units = await loadUnits()
  const keys = units.UNIT_CATEGORIES.map((item) => item.key)
  assert.deepEqual(keys, [
    'length',
    'mass',
    'area',
    'volume',
    'temperature',
    'speed',
    'data',
    'time',
    'pressure',
    'energy',
    'power',
    'angle',
    'frequency',
  ])
  assert.equal(units.UNIT_CATEGORY_NAMES.length, 13)
  for (const category of units.UNIT_CATEGORIES) {
    assert.ok(category.units.length >= 3, `${category.key} 单位少于 3 个`)
    const unitKeys = new Set(category.units.map((item) => item.key))
    assert.equal(unitKeys.size, category.units.length, `${category.key} 单位 key 重复`)
  }
})

test('单位扩展：数据按 1024 进制', async () => {
  const units = await loadUnits()
  assert.equal(convert(units, 'data', 'gb', 'mb', 1), 1024)
  assert.equal(convert(units, 'data', 'mb', 'kb', 1), 1024)
  assert.equal(convert(units, 'data', 'tb', 'gb', 2), 2048)
  assert.equal(convert(units, 'data', 'b', 'bit', 1), 8)
  assert.equal(convert(units, 'data', 'bit', 'b', 8), 1)
})

test('单位扩展：时间黄金值', async () => {
  const units = await loadUnits()
  assert.equal(convert(units, 'time', 'week', 'h', 1), 168)
  assert.equal(convert(units, 'time', 'day', 'min', 1), 1440)
  assert.equal(convert(units, 'time', 'min', 'h', 90), 1.5)
  assert.equal(convert(units, 'time', 'ms', 's', 500), 0.5)
})

test('单位扩展：压力黄金值', async () => {
  const units = await loadUnits()
  assert.equal(convert(units, 'pressure', 'atm', 'kpa', 1), 101.325)
  assert.equal(convert(units, 'pressure', 'bar', 'kpa', 1), 100)
  assert.equal(convert(units, 'pressure', 'mpa', 'pa', 1), 1000000)
  const psi = convert(units, 'pressure', 'psi', 'kpa', 1)
  assert.ok(Math.abs(psi - 6.894757293168361) < 1e-9)
  const mmHg = convert(units, 'pressure', 'mmhg', 'atm', 760)
  assert.ok(Math.abs(mmHg - 1) < 1e-6)
})

test('单位扩展：能量黄金值', async () => {
  const units = await loadUnits()
  assert.equal(convert(units, 'energy', 'kwh', 'j', 1), 3600000)
  assert.equal(convert(units, 'energy', 'wh', 'j', 1), 3600)
  assert.equal(convert(units, 'energy', 'kcal', 'kj', 1), 4.184)
  assert.equal(convert(units, 'energy', 'cal', 'j', 1000), 4184)
})

test('单位扩展：功率黄金值', async () => {
  const units = await loadUnits()
  assert.equal(convert(units, 'power', 'mw', 'kw', 1), 1000)
  assert.equal(convert(units, 'power', 'kw', 'w', 2), 2000)
  assert.equal(convert(units, 'power', 'hp', 'w', 1), 735.49875)
  assert.ok(Math.abs(convert(units, 'power', 'w', 'hp', 735.49875) - 1) < 1e-12)
})

test('单位扩展：角度与频率黄金值', async () => {
  const units = await loadUnits()
  assert.ok(Math.abs(convert(units, 'angle', 'deg', 'rad', 180) - Math.PI) < 1e-12)
  assert.equal(convert(units, 'angle', 'turn', 'deg', 1), 360)
  assert.equal(convert(units, 'angle', 'arcmin', 'deg', 60), 1)
  assert.equal(convert(units, 'angle', 'arcsec', 'deg', 3600), 1)
  assert.equal(convert(units, 'angle', 'grad', 'deg', 100), 90)

  assert.equal(convert(units, 'frequency', 'ghz', 'mhz', 1), 1000)
  assert.equal(convert(units, 'frequency', 'khz', 'hz', 1), 1000)
  assert.equal(convert(units, 'frequency', 'rpm', 'hz', 60), 1)
})

test('单位扩展：输入解析与格式化', async () => {
  const units = await loadUnits()
  assert.equal(units.parseUnitInput('1.234567', false), 1.234567)
  assert.equal(units.parseUnitInput('-3', true), -3)
  assert.equal(units.parseUnitInput('-3', false), null)
  assert.equal(units.parseUnitInput('1.2345678', false), null)
  assert.equal(units.parseUnitInput('abc', false), null)
  assert.equal(units.parseUnitInput(' 2 ', false), 2)

  assert.equal(units.formatUnitValue(1.5), '1.5')
  assert.equal(units.formatUnitValue(1 / 3), '0.333333')
  assert.equal(units.formatUnitValue(0.0000001), '1.0000e-7')
  assert.equal(units.formatUnitValue(1e10), '1.0000e+10')
  assert.equal(units.formatUnitValue(1234567.5), '1,234,567.5')
  assert.equal(units.formatUnitValue(Number.NaN), '—')
})

test('单位扩展：页面复用共享引擎与 Workflow 分类上下文', async () => {
  const page = read('subpackages/tools-core/pages/unit/index.ts')
  assert.match(page, /from '\.\.\/\.\.\/lib\/units'/)
  assert.match(page, /UNIT_CATEGORIES/)
  assert.match(page, /convertUnit/)
  assert.match(page, /parseUnitInput/)
  assert.equal(/const UNIT_CATEGORIES: UnitCategory\[\] = \[/.test(page), false, '页面不得重复定义单位表')
  assert.equal(/function convertUnit\(/.test(page), false, '页面不得重复实现换算')

  const wxml = read('subpackages/tools-core/pages/unit/index.wxml')
  assert.match(wxml, /13 类/)
  assert.match(wxml, /数据按 1024 进制/)

  const engine = read('subpackages/tools-core/lib/units.ts')
  assert.equal(/wx\./.test(engine), false, '单位引擎不得依赖 wx')

  const source = await import(`${URL_ROOT}core/workflow/workflowSource.ts`)
  const snapshot = source.readWorkflowSource('unit', {
    result: '1,024',
    activeCategory: 6,
    units: [{ key: 'gb', name: 'GB' }, { key: 'mb', name: 'MB' }],
    fromIndex: 0,
    toIndex: 1,
  })
  assert.ok(snapshot)
  assert.equal(snapshot.data.payload, '1024', '结果千分位必须还原为纯数字')
  assert.equal(snapshot.data.context.unitCategory, 'data')
  assert.equal(snapshot.data.context.unitFrom, 'mb')
  assert.equal(snapshot.data.context.unitTo, 'gb')

  const registry = read('core/toolbox/registry.ts')
  assert.match(registry, /id: 'unit'/)
  assert.match(registry, /name: '单位换算'/)
})
