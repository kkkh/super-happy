/* ==========================================================================
   批 3 · 拼音标注（pinyin）
   - 引擎：黄金句 / 多音词消歧 / 非汉字原样 / 去声调 / 未收录 / 2k 截断
   - 契约：tools-dict / 页面 / 注册 / 帮助 / 文本工作流 / 适配器 / 词库来源
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

async function loadPinyin() {
  return import(`${URL_ROOT}subpackages/tools-dict/lib/pinyin.ts`)
}

test('拼音：黄金句带声调标注', async () => {
  const py = await loadPinyin()
  const result = py.toPinyin('重庆银行行长喜欢音乐，重新称重后去银行办事。')
  assert.equal(
    result.output,
    'chóng qìng yín háng háng zhǎng xǐ huān yīn yuè，chóng xīn chēng zhòng hòu qù yín háng bàn shì。',
  )
  assert.ok(result.covered >= 18)
  assert.equal(result.uncovered, 0)
  assert.ok(result.polyphonic > 0)
  assert.match(result.summary, /带声调/)
  assert.match(result.summary, /多音字按常用读音/)
})

test('拼音：常用多音词优先消歧', async () => {
  const py = await loadPinyin()
  const cases = {
    头发: 'tóu fa',
    理发: 'lǐ fà',
    便宜: 'pián yi',
    重庆: 'chóng qìng',
    银行: 'yín háng',
    行长: 'háng zhǎng',
    行业: 'háng yè',
    音乐: 'yīn yuè',
    重新: 'chóng xīn',
    重量: 'zhòng liàng',
    长大: 'zhǎng dà',
  }
  for (const [source, expected] of Object.entries(cases)) {
    assert.equal(py.toPinyin(source).output, expected, source)
  }
})

test('拼音：非汉字原样、去声调与逐字对照', async () => {
  const py = await loadPinyin()
  const tone = py.toPinyin('Hello 2026，世界！')
  assert.equal(tone.output, 'Hello 2026，shì jiè！')
  const plain = py.toPinyin('Hello 2026，世界！', { tone: false })
  assert.equal(plain.output, 'Hello 2026，shi jie！')
  assert.equal(py.stripTone('chóng qìng lǜ sè'), 'chong qing lü se')

  const comparison = py.pinyinComparison(tone.chars, 2)
  assert.equal(comparison.split('\n').length, 2)
  assert.match(comparison, /世 shì/)
})

test('拼音：未收录汉字与超 2k 截断', async () => {
  const py = await loadPinyin()
  const rare = py.toPinyin('𠮷字')
  assert.equal(rare.uncovered, 1)
  assert.match(rare.output, /^𠮷 zì$/)

  const long = '中'.repeat(2001)
  const result = py.toPinyin(long)
  assert.equal(result.truncated, true)
  assert.equal(result.inputChars, 2001)
  assert.equal(result.chars.length, 2000)
  assert.match(result.summary, /已截断至 2000 字/)

  const empty = py.toPinyin('')
  assert.equal(empty.output, '')
  assert.equal(empty.covered, 0)
})

test('拼音契约：tools-dict / 页面 / 注册 / 帮助 / 文本工作流 / 适配器 / 词库', async () => {
  const app = JSON.parse(read('app.json'))
  const dict = app.subpackages.find((item) => item.root === 'subpackages/tools-dict')
  assert.ok(dict, 'app.json 缺少 tools-dict 分包')
  assert.ok(dict.pages.includes('pages/pinyin/index'), 'tools-dict 未注册 pinyin 页面')

  for (const ext of ['.ts', '.json', '.wxml', '.wxss']) {
    assert.ok(
      fs.existsSync(path.join(ROOT, `subpackages/tools-dict/pages/pinyin/index${ext}`)),
      `缺少 pinyin 页面文件 ${ext}`,
    )
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'subpackages/tools-dict/lib/pinyin.ts')))
  assert.ok(fs.existsSync(path.join(ROOT, 'subpackages/tools-dict/lib/pinyin-data.ts')))

  const data = await import(`${URL_ROOT}subpackages/tools-dict/lib/pinyin-data.ts`)
  assert.equal(data.PINYIN_CHARS_RAW.split('|').length, 8000)
  assert.ok(data.PINYIN_PHRASES_RAW.split('|').length >= 1000)
  const dataFile = read('subpackages/tools-dict/lib/pinyin-data.ts')
  assert.match(dataFile, /pinyin-pro 3\.29\.5/)
  assert.match(dataFile, /MIT/)

  const pageJson = JSON.parse(read('subpackages/tools-dict/pages/pinyin/index.json'))
  assert.equal(pageJson.navigationBarTitleText, '拼音标注')

  const wxml = read('subpackages/tools-dict/pages/pinyin/index.wxml')
  assert.match(wxml, /tool-id="pinyin"/)
  assert.match(wxml, /bindtap="onTone"/)
  assert.match(wxml, /bind:run="onRun"/)
  assert.match(wxml, /bind:tap="onCopy"/)
  assert.match(wxml, /带声调/)
  assert.match(wxml, /逐字对照/)

  const ts = read('subpackages/tools-dict/pages/pinyin/index.ts')
  assert.match(ts, /onShareAppMessage\s*\(/)
  assert.match(ts, /onShareTimeline\s*\(/)
  assert.match(ts, /toPinyin/)
  assert.match(ts, /onReceiveWorkflow/)
  assert.equal(/wx\.request|uploadFile|downloadFile/.test(ts), false, '拼音标注不得联网')

  const registry = read('core/toolbox/registry.ts')
  assert.match(registry, /id: 'pinyin'/)
  assert.match(registry, /name: '拼音标注'/)
  assert.match(registry, /weight: 63/)
  assert.match(registry, /subpackages\/tools-dict\/pages\/pinyin\/index/)
  assert.match(read('subpackages/grow/lib/help.ts'), /pinyin: \{/)
  assert.match(read('scripts/check-budget.js'), /pages\/pinyin/)
  assert.match(read('scripts/e2e-tools.js'), /id: 'pinyin'/)

  const config = await import(`${URL_ROOT}core/workflow/workflowConfig.ts`)
  assert.equal(config.WORKFLOW_ROUTING.pinyin, 'jump')
  assert.deepEqual(config.WORKFLOW_ACCEPTS.pinyin, ['text'])

  const source = await import(`${URL_ROOT}core/workflow/workflowSource.ts`)
  assert.deepEqual(source.WORKFLOW_SOURCE_KEYS.pinyin.text, ['pinyinSummary'])

  const adapters = await import(`${URL_ROOT}core/workflow/workflowAdapters.ts`)
  assert.ok(adapters.getWorkflowAdapter('pinyin'), '缺少 pinyin 文本适配器')
  assert.match(read('pages/legal/index.wxml'), /pinyin-pro 3\.29\.5/)
})
