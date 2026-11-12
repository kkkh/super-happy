/* ==========================================================================
   批 3 · 简繁转换（zh-convert）
   - 引擎：黄金句 / 一词多繁 / 未收录原样 / 方向切换 / 20k 截断
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

async function loadZh() {
  return import(`${URL_ROOT}subpackages/tools-dict/lib/zh.ts`)
}

const GOLDEN_S2T = '理发师发现，头发长了要理发；发财后别忘了开发新发型。'
const GOLDEN_T2S = '理髮師發現，頭髮長了要理髮；發財後別忘了開發新髮型。'

test('简繁：黄金句词组优先转换', async () => {
  const zh = await loadZh()
  const result = zh.convertZh(GOLDEN_S2T, { direction: 's2t', mode: 'phrase' })
  assert.equal(result.output, GOLDEN_T2S)
  assert.ok(result.replaced > 0)
  assert.ok(result.ambiguous >= 4, '“发 / 长”等多繁字应被统计')
  assert.equal(result.truncated, false)
  assert.match(result.summary, /简→繁/)
  assert.match(result.summary, /词组级/)
  assert.match(result.summary, /替换/)
})

test('简繁：一词多繁按常用词处理', async () => {
  const zh = await loadZh()
  const phrase = zh.convertZh('头发 理发 发财 发现', { direction: 's2t', mode: 'phrase' })
  assert.equal(phrase.output, '頭髮 理髮 發財 發現')
  const char = zh.convertZh('头发', { direction: 's2t', mode: 'char' })
  assert.equal(char.output, '頭發')
  assert.equal(zh.convertZh('干杯 干部 干燥', { direction: 's2t', mode: 'phrase' }).output, '乾杯 幹部 乾燥')
  assert.equal(zh.convertZh('皇后 面条 台风 台湾', { direction: 's2t', mode: 'phrase' }).output, '皇后 麪條 颱風 臺灣')
})

test('简繁：未收录字、英文、数字与标点原样保留', async () => {
  const zh = await loadZh()
  const source = '𠮷鿿😀ABC123，。'
  const result = zh.convertZh(source, { direction: 's2t', mode: 'phrase' })
  assert.equal(result.output, source)
  assert.equal(result.replaced, 0)
  assert.equal(zh.convertZh('', { direction: 's2t' }).output, '')
})

test('简繁：方向切换、字符级与超 20k 截断', async () => {
  const zh = await loadZh()
  const back = zh.convertZh(GOLDEN_T2S, { direction: 't2s', mode: 'phrase' })
  assert.equal(back.output, GOLDEN_S2T)
  assert.match(back.summary, /繁→简/)
  assert.match(zh.convertZh('头发', { direction: 's2t', mode: 'char' }).summary, /字符级/)

  const long = '发'.repeat(20001)
  const truncated = zh.convertZh(long, { direction: 's2t', mode: 'phrase' })
  assert.equal(truncated.truncated, true)
  assert.equal(truncated.inputChars, 20001)
  assert.equal(truncated.outputChars, 20000)
  assert.match(truncated.summary, /已截断至 20000 字/)
})

test('简繁契约：tools-dict / 页面 / 注册 / 帮助 / 文本工作流 / 适配器 / 词库', async () => {
  const app = JSON.parse(read('app.json'))
  const dict = app.subpackages.find((item) => item.root === 'subpackages/tools-dict')
  assert.ok(dict, 'app.json 缺少 tools-dict 分包')
  assert.ok(dict.pages.includes('pages/zh-convert/index'), 'tools-dict 未注册 zh-convert 页面')
  assert.ok(dict.pages.includes('pages/pinyin/index'), 'tools-dict 未注册 pinyin 页面')

  for (const ext of ['.ts', '.json', '.wxml', '.wxss']) {
    assert.ok(
      fs.existsSync(path.join(ROOT, `subpackages/tools-dict/pages/zh-convert/index${ext}`)),
      `缺少 zh-convert 页面文件 ${ext}`,
    )
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'subpackages/tools-dict/lib/zh.ts')))
  assert.ok(fs.existsSync(path.join(ROOT, 'subpackages/tools-dict/lib/zh-data.ts')))

  const data = await import(`${URL_ROOT}subpackages/tools-dict/lib/zh-data.ts`)
  assert.ok(data.ZH_S2T_CHARS_RAW.split('|').length >= 3500, '简→繁字符表应覆盖常用 3500 字')
  assert.equal(data.ZH_S2T_PHRASES_RAW.split('|').length, 5000)
  assert.ok(data.ZH_T2S_CHARS_RAW.split('|').length >= 3500)
  assert.equal(data.ZH_T2S_PHRASES_RAW.split('|').length, 5000)
  assert.match(read('subpackages/tools-dict/lib/zh-data.ts'), /OpenCC 1\.4\.2/)

  const pageJson = JSON.parse(read('subpackages/tools-dict/pages/zh-convert/index.json'))
  assert.equal(pageJson.navigationBarTitleText, '简繁转换')

  const wxml = read('subpackages/tools-dict/pages/zh-convert/index.wxml')
  assert.match(wxml, /tool-id="zh-convert"/)
  assert.match(wxml, /bindtap="onDirection"/)
  assert.match(wxml, /bindtap="onMode"/)
  assert.match(wxml, /bind:run="onRun"/)
  assert.match(wxml, /bind:tap="onCopy"/)
  assert.match(wxml, /directionOptions/)
  assert.match(wxml, /modeOptions/)
  assert.match(wxml, /OpenCC/)

  const ts = read('subpackages/tools-dict/pages/zh-convert/index.ts')
  assert.match(ts, /onShareAppMessage\s*\(/)
  assert.match(ts, /onShareTimeline\s*\(/)
  assert.match(ts, /convertZh/)
  assert.match(ts, /onReceiveWorkflow/)
  assert.match(ts, /简 → 繁/)
  assert.match(ts, /繁 → 简/)
  assert.match(ts, /词组优先/)
  assert.equal(/wx\.request|uploadFile|downloadFile/.test(ts), false, '简繁转换不得联网')

  const registry = read('core/toolbox/registry.ts')
  assert.match(registry, /id: 'zh-convert'/)
  assert.match(registry, /name: '简繁转换'/)
  assert.match(registry, /weight: 69/)
  assert.match(registry, /subpackages\/tools-dict\/pages\/zh-convert\/index/)
  assert.match(read('subpackages/grow/lib/help.ts'), /'zh-convert': \{/)
  assert.match(read('scripts/check-budget.js'), /pages\/zh-convert/)
  assert.match(read('scripts/e2e-tools.js'), /id: 'zh-convert'/)

  const config = await import(`${URL_ROOT}core/workflow/workflowConfig.ts`)
  assert.equal(config.WORKFLOW_ROUTING['zh-convert'], 'jump')
  assert.deepEqual(config.WORKFLOW_ACCEPTS['zh-convert'], ['text'])

  const source = await import(`${URL_ROOT}core/workflow/workflowSource.ts`)
  assert.deepEqual(source.WORKFLOW_SOURCE_KEYS['zh-convert'].text, ['zhSummary'])

  const adapters = await import(`${URL_ROOT}core/workflow/workflowAdapters.ts`)
  assert.ok(adapters.getWorkflowAdapter('zh-convert'), '缺少 zh-convert 文本适配器')
  assert.match(read('subpackages/grow/pages/legal/index.wxml'), /OpenCC 1\.4\.2/)
})
