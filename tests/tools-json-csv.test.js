/* ==========================================================================
   M5 · JSON ↔ CSV（json-csv）
   - 引擎：扁平字符串往返、字段不一致、嵌套有损、空 / 非法 / 2MB
   - 工作流：silent JSON → CSV
   - 契约：tools-core / 页面 / 注册 / 帮助 / 配置 / 来源 / 无页面适配器
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

async function loadCsv() {
  return import(`${URL_ROOT}core/toolbox/engines/csv.ts`)
}

test('JSON ↔ CSV：扁平字符串往返一致且支持 BOM', async () => {
  const csv = await loadCsv()
  const source = JSON.stringify([
    { name: '超欢', city: '北京' },
    { name: '秦超', city: '上海' },
  ])
  const forward = csv.jsonToCsv(source)
  assert.equal(forward.ok, true)
  assert.deepEqual(forward.headers, ['name', 'city'])
  assert.equal(forward.rowCount, 2)
  assert.equal(forward.output, 'name,city\r\n超欢,北京\r\n秦超,上海')
  assert.deepEqual(forward.warnings, [])

  const back = csv.csvToJson(forward.output)
  assert.equal(back.ok, true)
  assert.deepEqual(JSON.parse(back.output), [
    { name: '超欢', city: '北京' },
    { name: '秦超', city: '上海' },
  ])

  const withBom = csv.jsonToCsv(source, { bom: true })
  assert.equal(withBom.ok, true)
  assert.equal(withBom.output.startsWith('\uFEFF'), true)
  const backFromBom = csv.csvToJson(withBom.output)
  assert.equal(backFromBom.ok, true)
  assert.equal(JSON.parse(backFromBom.output)[0].name, '超欢')

  const formula = csv.jsonToCsv(JSON.stringify([{ v: '=1+1' }]))
  assert.equal(formula.output, "v\r\n'=1+1")
  assert.equal(JSON.parse(csv.csvToJson(formula.output).output)[0].v, '=1+1')
})

test('JSON ↔ CSV：字段并集与缺失留空', async () => {
  const csv = await loadCsv()
  const forward = csv.jsonToCsv(JSON.stringify([{ a: '1' }, { b: '2' }]))
  assert.equal(forward.ok, true)
  assert.deepEqual(forward.headers, ['a', 'b'])
  assert.equal(forward.output, 'a,b\r\n1,\r\n,2')
  assert.equal(forward.warnings.length, 1)
  assert.match(forward.warnings[0], /字段不一致/)

  const back = csv.csvToJson(forward.output)
  assert.deepEqual(JSON.parse(back.output), [
    { a: '1', b: '' },
    { a: '', b: '2' },
  ])
})

test('JSON ↔ CSV：嵌套与类型转换有损并提示', async () => {
  const csv = await loadCsv()
  const source = JSON.stringify([
    { name: '超欢', score: 98, meta: { x: 1 }, tags: ['a', 'b'] },
  ])
  const forward = csv.jsonToCsv(source)
  assert.equal(forward.ok, true)
  assert.equal(
    forward.output,
    'name,score,meta,tags\r\n超欢,98,"{""x"":1}","[""a"",""b""]"',
  )
  assert.ok(forward.warnings.some((item) => /嵌套/.test(item)))
  assert.ok(forward.warnings.some((item) => /数字/.test(item)))

  const back = csv.csvToJson(forward.output)
  const record = JSON.parse(back.output)[0]
  assert.equal(record.score, '98')
  assert.equal(record.meta, '{"x":1}')
  assert.equal(record.tags, '["a","b"]')
})

test('JSON ↔ CSV：空数组、非法输入、引号换行与 2MB 上限', async () => {
  const csv = await loadCsv()
  assert.match(csv.jsonToCsv('').error, /请输入/)
  assert.match(csv.jsonToCsv('[]').error, /为空/)
  assert.match(csv.jsonToCsv('{}').error, /数组/)
  assert.match(csv.jsonToCsv('[1,2]').error, /对象/)
  assert.match(csv.jsonToCsv('not json').error, /解析失败/)
  assert.match(csv.csvToJson('').error, /请输入/)
  assert.match(csv.csvToJson('a,a\n1,2').error, /重复/)
  assert.match(csv.csvToJson('a,b\n1,2,3').error, /超过表头/)

  const quoted = csv.csvToJson('a,b\r\n1,"x,y"')
  assert.equal(quoted.ok, true)
  assert.equal(JSON.parse(quoted.output)[0].b, 'x,y')
  const multiline = csv.csvToJson('a\n"line\nbreak"')
  assert.equal(JSON.parse(multiline.output)[0].a, 'line\nbreak')
  const shortRow = csv.csvToJson('a,b\n1')
  assert.deepEqual(JSON.parse(shortRow.output), [{ a: '1', b: '' }])

  const oversized = 'x'.repeat(csv.CSV_MAX_BYTES + 1)
  assert.match(csv.jsonToCsv(oversized).error, /2MB/)
  assert.match(csv.csvToJson(oversized).error, /2MB/)

  assert.equal(csv.escapeCsv('a,b'), '"a,b"')
  assert.equal(csv.escapeCsv('=SUM(A1)'), "'=SUM(A1)")
})

test('JSON ↔ CSV：silent 执行器与页面契约', async () => {
  const silent = await import(`${URL_ROOT}core/workflow/workflowSilent.ts`)
  const output = silent.executeSilentTool('json-csv', {
    type: 'json',
    payload: '[{"a":"1"},{"a":"2"}]',
  })
  assert.equal(output.type, 'text')
  assert.equal(output.payload, 'a\r\n1\r\n2')
  assert.throws(
    () =>
      silent.executeSilentTool('json-csv', {
        type: 'text',
        payload: '[]',
      }),
    /JSON 转 CSV/,
  )

  const app = JSON.parse(read('app.json'))
  const core = app.subpackages.find((item) => item.root === 'subpackages/tools-core')
  assert.ok(core, 'app.json 缺少 tools-core 分包')
  assert.ok(core.pages.includes('pages/json-csv/index'), 'tools-core 未注册 JSON ↔ CSV 页面')

  for (const ext of ['.ts', '.json', '.wxml', '.wxss']) {
    assert.ok(
      fs.existsSync(path.join(ROOT, `subpackages/tools-core/pages/json-csv/index${ext}`)),
      `缺少 JSON ↔ CSV 页面文件 ${ext}`,
    )
  }

  const pageJson = JSON.parse(read('subpackages/tools-core/pages/json-csv/index.json'))
  assert.equal(pageJson.navigationBarTitleText, 'JSON ↔ CSV')

  const wxml = read('subpackages/tools-core/pages/json-csv/index.wxml')
  assert.match(wxml, /tool-id="json-csv"/)
  assert.match(wxml, /bind:run="onRun"/)
  assert.match(wxml, /bindtap="onMode"/)
  assert.match(wxml, /bindtap="onCopy"/)
  assert.match(wxml, /bindtap="onCopyRow"/)
  assert.match(wxml, /JSON → CSV/)
  assert.match(wxml, /CSV → JSON/)

  const ts = read('subpackages/tools-core/pages/json-csv/index.ts')
  assert.match(ts, /onShareAppMessage\s*\(/)
  assert.match(ts, /onShareTimeline\s*\(/)
  assert.match(ts, /jsonToCsv/)
  assert.match(ts, /csvToJson/)
  assert.equal(/wx\.request|uploadFile|downloadFile/.test(ts), false, 'JSON ↔ CSV 不得联网')

  const registry = read('core/toolbox/registry.ts')
  assert.match(registry, /id: 'json-csv'/)
  assert.match(registry, /name: 'JSON ↔ CSV'/)
  assert.match(registry, /weight: 82/)
  assert.match(registry, /sensitive: ''/)
  assert.match(registry, /subpackages\/tools-core\/pages\/json-csv\/index/)
  assert.match(read('subpackages/grow/lib/help.ts'), /'json-csv': \{/)
  assert.match(read('scripts/check-budget.js'), /pages\/json-csv/)
  assert.match(read('scripts/e2e-tools.js'), /id: 'json-csv'/)
  assert.equal(/subpackages\//.test(read('core/toolbox/engines/csv.ts')), false, 'core 不得引用分包')

  const config = await import(`${URL_ROOT}core/workflow/workflowConfig.ts`)
  assert.equal(config.WORKFLOW_ROUTING['json-csv'], 'silent')
  assert.deepEqual(config.WORKFLOW_ACCEPTS['json-csv'], ['text', 'json'])

  const source = await import(`${URL_ROOT}core/workflow/workflowSource.ts`)
  assert.deepEqual(source.WORKFLOW_SOURCE_KEYS['json-csv'].text, ['csvSummary'])

  const adapters = await import(`${URL_ROOT}core/workflow/workflowAdapters.ts`)
  assert.equal(adapters.getWorkflowAdapter('json-csv'), null, 'silent 工具不应有页面适配器')
  assert.match(read('core/workflow/workflowSilent.ts'), /case 'json-csv'/)
})
