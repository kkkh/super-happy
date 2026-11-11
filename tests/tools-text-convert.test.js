/* ==========================================================================
   批 1 · 文本转换（text-convert）
   - 引擎黄金值：大小写、命名、HTML 编解码、Unicode 转义
   - 边界：CJK 保留、变更字符数、20k 截断
   - 契约：页面 / 注册 / 帮助 / silent 工作流与来源字段
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
  return import(`${URL_ROOT}core/toolbox/engines/text.ts`)
}

test('文本转换：大小写保持 CJK 原样', async () => {
  const text = await loadEngine()
  assert.equal(text.toCase('Hello 世界', 'upper'), 'HELLO 世界')
  assert.equal(text.toCase('Hello 世界', 'lower'), 'hello 世界')
  assert.deepEqual(text.convertText('upper', 'abc'), {
    text: 'ABC',
    changed: 3,
    truncated: false,
  })
})

test('文本转换：命名风格拆开缩写与 camel 边界', async () => {
  const text = await loadEngine()
  assert.equal(text.toNaming('HTTPResponse', 'snake'), 'http_response')
  assert.equal(text.toNaming('HTTPResponse', 'kebab'), 'http-response')
  assert.equal(text.toNaming('HTTPResponse', 'camel'), 'httpResponse')
  assert.equal(text.toNaming('getHTTPResponse', 'camel'), 'getHttpResponse')
  assert.equal(text.toNaming('用户 Name', 'snake'), '用户_name')
})

test('文本转换：HTML 编码 / 解码与实体边界', async () => {
  const text = await loadEngine()
  const encoded = text.encodeHtml('<a href="x">超欢 & Tools</a>')
  assert.equal(encoded, '&lt;a href=&quot;x&quot;&gt;超欢 &amp; Tools&lt;/a&gt;')
  assert.equal(text.decodeHtml(encoded), '<a href="x">超欢 & Tools</a>')
  assert.equal(text.decodeHtml('&#39;'), "'")
  assert.equal(text.decodeHtml('&#x4E2D;'), '中')
  assert.equal(text.decodeHtml('&nbsp;'), '\u00A0')
  assert.equal(text.decodeHtml('&nope;'), '&nope;')
})

test('文本转换：Unicode 转义覆盖 BMP 与代理对', async () => {
  const text = await loadEngine()
  assert.equal(text.escapeUnicode('中A😀\n'), '\\u4e2dA\\ud83d\\ude00\n')
})

test('文本转换：变更字符数按公共前后缀之外的码点数计算', async () => {
  const text = await loadEngine()
  assert.equal(text.changedCharCount('abc', 'abd'), 1)
  assert.equal(text.changedCharCount('abc', 'ab'), 1)
  assert.equal(text.changedCharCount('', 'abc'), 3)
  assert.equal(text.changedCharCount('abc', 'abc'), 0)
  assert.equal(text.changedCharCount('😀a', '😀b'), 1)
})

test('文本转换：清洗模式四种组合', async () => {
  const text = await loadEngine()
  const input = '　ＡＢＣ　１２３\r\n第二行　超欢　'
  assert.equal(
    text.cleanText(input, { toHalfWidth: true, trimSpaces: false, removeLineBreaks: false }),
    ' ABC 123\n第二行 超欢 ',
    '仅全角转半角，换行统一为 LF',
  )
  assert.equal(
    text.cleanText(input, { toHalfWidth: false, trimSpaces: true, removeLineBreaks: false }),
    'ＡＢＣ １２３\n第二行 超欢',
    '仅合并空白',
  )
  assert.equal(
    text.cleanText(input, { toHalfWidth: false, trimSpaces: false, removeLineBreaks: true }),
    '　ＡＢＣ　１２３第二行　超欢　',
    '仅去换行：中文之间不补空格',
  )
  assert.equal(text.cleanText(input), 'ABC 123\n第二行 超欢', '默认全角转半角并保留段落')
  assert.equal(text.cleanText('！Ａ～　中😀'), '！A~ 中😀', '默认保留中文感叹号与 CJK / Emoji')
  assert.equal(text.isConvertMode('clean'), true)
  assert.equal(text.convertText('clean', input).text, 'ABC 123\n第二行 超欢')
})

test('文本转换：清洗高级能力（空行 / 不可见字符 / 中文标点 / 合并一行）', async () => {
  const text = await loadEngine()
  assert.equal(text.cleanText('第一行\n\n  \n第二行'), '第一行\n第二行', '默认删除空行')
  assert.equal(text.cleanText('A\u200B B\uFEFFC\u00AD'), 'A BC', '删除零宽 / BOM / 软连字符')
  assert.equal(text.cleanText('👨\u200D👩'), '👨\u200D👩', '保留 emoji ZWJ 序列')
  assert.equal(
    text.cleanText('你好，世界。'),
    '你好，世界。',
    '默认不改中文标点',
  )
  assert.equal(text.cleanText('你好，世界！', { cjkPunctuation: true }), '你好,世界!', '全角区中文标点')
  assert.equal(
    text.cleanText('你好。世界【注】《书名》'),
    '你好。世界【注】《书名》',
    '默认不改中文标点',
  )
  assert.equal(
    text.cleanText('你好。世界【注】《书名》', { cjkPunctuation: true }),
    '你好.世界[注]<书名>',
    '开启中文标点',
  )
  assert.equal(
    text.cleanText('中文——测试……结束', { cjkPunctuation: true }),
    '中文--测试...结束',
    '中文破折号与省略号按一对一转',
  )
  assert.equal(text.cleanText('第一行\n第二行'), '第一行\n第二行', '默认保留段落')
  assert.equal(
    text.cleanText('第一行\n第二行', { removeLineBreaks: true }),
    '第一行第二行',
    '中文行合并不补空格',
  )
  assert.equal(
    text.cleanText('Hello\nWorld', { removeLineBreaks: true }),
    'Hello World',
    '英文行合并补空格',
  )
  assert.equal(text.cleanText('\u3000Ａ\u3000　Ｂ　'), 'A B', '全角空格与全角字母')
  assert.equal(text.cleanText('ＡＢＣ', { toHalfWidth: false }), 'ＡＢＣ', '关闭全角转半角')
  assert.equal(text.cleanText('￥ １２３'), '¥ 123', '全角货币符号')
})

test('文本转换：去空格覆盖中英文 / 制表符 / 全角空格', async () => {
  const text = await loadEngine()
  assert.equal(
    text.cleanText('Hello World 你好 世界', { removeSpaces: true }),
    'HelloWorld你好世界',
    '英文与中文空格都删除',
  )
  assert.equal(
    text.cleanText('Ａ　Ｂ\tＣ\u00A0Ｄ', { removeSpaces: true }),
    'ABCD',
    '全角空格 / 制表符 / 不换行空格',
  )
  assert.equal(
    text.cleanText('A\u2003B\u2009C\u3000D', { removeSpaces: true }),
    'ABCD',
    'Unicode 宽空格 / 窄空格 / 全角空格',
  )
  assert.equal(
    text.cleanText('第一行\n第二行', { removeSpaces: true }),
    '第一行\n第二行',
    '去空格不删换行',
  )
  assert.equal(
    text.cleanText('Hello\nWorld', { removeSpaces: true, removeLineBreaks: true }),
    'HelloWorld',
    '并成一行后同样去空格',
  )
  assert.equal(text.cleanText('A B'), 'A B', '默认不去空格')
})

test('文本转换：清洗模式并入页面、帮助与 silent 流转', async () => {
  const page = read('subpackages/tools-core/pages/text-convert/index.ts')
  assert.match(page, /key: 'clean'/)
  assert.match(page, /activeMode === 'clean'/)
  assert.match(page, /return 'clean'/)
  assert.match(page, /onCleanOption/)
  assert.match(page, /cleanOptionsForEngine/)
  assert.match(page, /removeSpaces/)

  const wxml = read('subpackages/tools-core/pages/text-convert/index.wxml')
  assert.match(wxml, /activeMode === 'clean'/)
  assert.match(wxml, /onCleanOption/)
  assert.match(wxml, /去空格/)
  assert.match(wxml, /并成一行/)
  assert.match(wxml, /保留段落/)
  assert.match(read('subpackages/grow/lib/help.ts'), /清洗模式/)

  const silent = await import(`${URL_ROOT}core/workflow/workflowSilent.ts`)
  const output = silent.executeSilentTool('text-convert', {
    type: 'text',
    payload: '　ＡＢＣ　１２３',
    context: { convertMode: 'clean' },
  })
  assert.equal(output.payload, 'ABC 123')

  const source = await import(`${URL_ROOT}core/workflow/workflowSource.ts`)
  const snapshot = source.readWorkflowSource('text-convert', {
    convertSummary: 'ABC 123',
    convertMode: 'clean',
  })
  assert.equal(snapshot.data.context.convertMode, 'clean')
})

test('文本转换契约：20k 截断 / 页面 / 注册 / 帮助 / silent 工作流', async () => {
  const text = await loadEngine()
  const long = text.convertText('upper', 'a'.repeat(20001))
  assert.equal(long.truncated, true)
  assert.equal(long.text.length, 20000)

  const app = JSON.parse(read('app.json'))
  const core = app.subpackages.find((item) => item.root === 'subpackages/tools-core')
  assert.ok(core.pages.includes('pages/text-convert/index'), 'app.json 未注册页面')

  for (const ext of ['.ts', '.json', '.wxml', '.wxss']) {
    assert.ok(
      fs.existsSync(
        path.join(ROOT, `subpackages/tools-core/pages/text-convert/index${ext}`),
      ),
      `缺少页面文件 ${ext}`,
    )
  }

  const wxml = read('subpackages/tools-core/pages/text-convert/index.wxml')
  assert.match(wxml, /tool-id="text-convert"/)
  assert.match(wxml, /show-run="\{\{false\}\}"/)
  assert.match(wxml, /bind:input="onInput"/)
  assert.match(wxml, /poster-data="\{\{posterData\}\}"/)

  const ts = read('subpackages/tools-core/pages/text-convert/index.ts')
  assert.match(ts, /onShareAppMessage\s*\(/)
  assert.match(ts, /onShareTimeline\s*\(/)
  assert.match(ts, /onReceiveWorkflow\s*\(/)
  assert.equal(/wx\.request|uploadFile|downloadFile/.test(ts), false)

  const registry = read('core/toolbox/registry.ts')
  assert.match(registry, /id: 'text-convert'/)
  assert.match(registry, /weight: 80/)
  assert.match(read('subpackages/grow/lib/help.ts'), /'text-convert': \{/)

  const config = await import(`${URL_ROOT}core/workflow/workflowConfig.ts`)
  assert.equal(config.WORKFLOW_ROUTING['text-convert'], 'silent')
  assert.deepEqual(config.WORKFLOW_ACCEPTS['text-convert'], ['text'])

  const source = await import(`${URL_ROOT}core/workflow/workflowSource.ts`)
  assert.deepEqual(source.WORKFLOW_SOURCE_KEYS['text-convert'].text, ['convertSummary'])
  const snapshot = source.readWorkflowSource('text-convert', {
    convertSummary: 'http_response',
    convertMode: 'kebab',
  })
  assert.equal(snapshot.data.payload, 'http_response')
  assert.equal(snapshot.data.context.convertMode, 'kebab')

  const silent = await import(`${URL_ROOT}core/workflow/workflowSilent.ts`)
  const output = silent.executeSilentTool('text-convert', {
    type: 'text',
    payload: 'HTTPResponse',
    context: { convertMode: 'snake' },
  })
  assert.equal(output.payload, 'http_response')
  const fallback = silent.executeSilentTool('text-convert', {
    type: 'text',
    payload: 'Hello World',
  })
  assert.equal(fallback.payload, 'hello_world')
  assert.throws(
    () =>
      silent.executeSilentTool('text-convert', {
        type: 'text',
        payload: '   ',
      }),
    /没有可转换的内容/,
  )
})
