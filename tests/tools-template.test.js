/* ==========================================================================
   批 2 · 占位符模板（template）
   - 引擎：提取 / 替换 / 缺失保留 / 重复 key / 变量表解析 / 20k 截断
   - 契约：页面 / 注册 / 帮助 / silent 工作流 / 包体清单
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
  return import(`${URL_ROOT}core/toolbox/engines/template.ts`)
}

test('模板：提取唯一变量并保留首次出现顺序', async () => {
  const template = await loadEngine()
  assert.deepEqual(
    template.extractPlaceholders('你好 {{ name }}，{{city}} 与 {{name}}，{{ a.b }}'),
    ['name', 'city', 'a.b'],
  )
  assert.deepEqual(template.extractPlaceholders('没有变量'), [])
})

test('模板：替换、缺失保留与重复 key 取首值', async () => {
  const template = await loadEngine()
  const result = template.renderTemplate('你好 {{name}}，欢迎来到 {{city}}！{{missing}}', [
    { key: 'name', value: '秦超' },
    { key: 'name', value: '覆盖' },
    { key: 'city', value: '杭州' },
  ])
  assert.equal(result.text, '你好 秦超，欢迎来到 杭州！{{missing}}')
  assert.deepEqual(result.keys, ['name', 'city', 'missing'])
  assert.deepEqual(result.filled, ['name', 'city'])
  assert.deepEqual(result.missing, ['missing'])
  assert.match(template.templateSummaryText(result), /已填充 2 \/ 3/)
  assert.match(template.templateSummaryText(result), /未填充：missing/)
})

test('模板：变量表支持 = 与 : 分隔，值可含分隔符', async () => {
  const template = await loadEngine()
  const variables = template.parseVariables(
    ['name = 秦超', 'city: 杭州', 'link=https://a.com?x=1:2', 'name=覆盖', 'bad line'].join('\n'),
  )
  assert.deepEqual(variables, [
    { key: 'name', value: '秦超' },
    { key: 'city', value: '杭州' },
    { key: 'link', value: 'https://a.com?x=1:2' },
  ])
})

test('模板：超过 20,000 码点截断并标记', async () => {
  const template = await loadEngine()
  const source = `${'{{name}}'.repeat(3000)}`
  const result = template.renderTemplate(source, [{ key: 'name', value: 'A' }])
  assert.equal(result.truncated, true)
  assert.ok(Array.from(result.text).length <= template.TEMPLATE_LIMIT)
  assert.match(template.templateSummaryText(result), /已截断/)
})

test('模板契约：页面 / 注册 / 帮助 / silent 工作流 / 包体清单', async () => {
  const app = JSON.parse(read('app.json'))
  const core = app.subpackages.find((item) => item.root === 'subpackages/tools-core')
  assert.ok(core.pages.includes('pages/template/index'), 'app.json 未注册页面')

  for (const ext of ['.ts', '.json', '.wxml', '.wxss']) {
    assert.ok(
      fs.existsSync(path.join(ROOT, `subpackages/tools-core/pages/template/index${ext}`)),
      `缺少页面文件 ${ext}`,
    )
  }
  assert.ok(
    fs.existsSync(path.join(ROOT, 'subpackages/tools-core/lib/template.ts')),
    '缺少 tools-core 薄 re-export',
  )

  const wxml = read('subpackages/tools-core/pages/template/index.wxml')
  assert.match(wxml, /tool-id="template"/)
  assert.match(wxml, /bind:run="onRun"/)
  assert.match(wxml, /poster-data="\{\{posterData\}\}"/)
  assert.match(wxml, /bindtap="onCopy"/)

  const ts = read('subpackages/tools-core/pages/template/index.ts')
  assert.match(ts, /onShareAppMessage\s*\(/)
  assert.match(ts, /onShareTimeline\s*\(/)
  assert.match(ts, /renderTemplate/)
  assert.equal(/new RegExp\(/.test(ts), false, '页面不得自行构造占位符正则')
  assert.equal(/wx\.request|uploadFile|downloadFile/.test(ts), false)

  const registry = read('core/toolbox/registry.ts')
  assert.match(registry, /id: 'template'/)
  assert.match(registry, /weight: 71/)
  assert.match(read('subpackages/grow/lib/help.ts'), /template: \{/)
  assert.match(read('scripts/check-budget.js'), /pages\/template/)

  const config = await import(`${URL_ROOT}core/workflow/workflowConfig.ts`)
  assert.equal(config.WORKFLOW_ROUTING.template, 'silent')
  assert.deepEqual(config.WORKFLOW_ACCEPTS.template, ['text'])

  const source = await import(`${URL_ROOT}core/workflow/workflowSource.ts`)
  assert.deepEqual(source.WORKFLOW_SOURCE_KEYS.template.text, ['templateSummary'])

  const silent = await import(`${URL_ROOT}core/workflow/workflowSilent.ts`)
  const output = silent.executeSilentTool('template', {
    type: 'text',
    payload: '你好 {{name}}，{{city}}',
  })
  assert.equal(output.type, 'text')
  assert.equal(output.payload, '变量：name、city（2 个）')
  assert.throws(
    () => silent.executeSilentTool('template', { type: 'text', payload: '没有变量' }),
    /未发现/,
  )
})
