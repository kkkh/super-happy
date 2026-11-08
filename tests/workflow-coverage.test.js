/* ==========================================================================
   Workflow 全量接管 · 静态覆盖测试
   - 23 个工具必须同时存在于 workflowConfig 的 routing / accepts
   - 所有 jump 工具必须有适配器，所有 silent 工具不得有页面适配器
   - 23 个工具都必须能从页面数据提取到可流转结果
   - 所有工具页必须有发起端（壳层流转按钮）或接收端（receiver + panel）
   - 多字段工具必须暴露 onReceiveWorkflow
   - 运行：npm test
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { registerHooks } = require('node:module')

const ROOT = path.resolve(__dirname, '..')

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !path.extname(specifier)) {
      try {
        return nextResolve(`${specifier}.ts`, context)
      } catch {
        /* 不是 TS 模块时回退原始路径 */
      }
    }
    return nextResolve(specifier, context)
  },
})

function moduleUrl(relative) {
  return pathToFileURL(path.join(ROOT, relative)).href
}

async function loadRegistry() {
  return import(moduleUrl('core/toolbox/registry.ts'))
}

async function loadConfig() {
  return import(moduleUrl('core/workflow/workflowConfig.ts'))
}

async function loadAdapters() {
  return import(moduleUrl('core/workflow/workflowAdapters.ts'))
}

async function loadSource() {
  return import(moduleUrl('core/workflow/workflowSource.ts'))
}

/** 覆盖所有工具的来源字段，用于证明每个工具都能提取到流转结果 */
function megaPageData() {
  return {
    result: '1',
    formula: '1',
    taxText: '1',
    monthlyText: '1',
    totalText: '1',
    calendarText: '1 天',
    calendarDays: 1,
    ageText: '1 岁',
    daysText: '1 天',
    localText: '2026-01-01',
    stampText: '1700000000',
    upperText: '壹',
    amountText: '1',
    flowPayload: 'payload',
    displayHex: 'abc',
    hashHex: 'abc',
    copyPayload: 'payload',
    outputText: 'payload',
    password: 'secret',
    bmiValue: '22',
    dominantHex: '#FFFFFF',
    averageHex: '#FFFFFF',
    colors: [{ hex: '#FFFFFF' }],
    compressedPath: '/tmp/compressed.png',
    qrImagePath: '/tmp/qr.png',
    previewSrc: '/tmp/watermark.png',
    imagePath: '/tmp/source.png',
    tiles: [{ path: '/tmp/tile.png' }],
    mode: 'to-date',
    includeStart: true,
    excludeWeekend: true,
    ref: '2026-01-01',
    target: '2026-01-01',
    activeCategory: 0,
    units: [{ key: 'm' }, { key: 'cm' }],
    fromIndex: 0,
    toIndex: 1,
    level: 'M',
    sizeKey: '280',
    qualityKey: 'balanced',
    edgeKey: '1920',
    frequency: 'year',
  }
}

test('配置：23 个工具全部注册 routing / accepts，且无多余条目', async () => {
  const { TOOLS } = await loadRegistry()
  const config = await loadConfig()

  assert.equal(TOOLS.length, 23)
  for (const tool of TOOLS) {
    assert.ok(
      config.WORKFLOW_ROUTING[tool.id],
      `${tool.id} 未注册 workflowConfig routing`,
    )
    assert.ok(
      Array.isArray(config.WORKFLOW_ACCEPTS[tool.id]),
      `${tool.id} 未注册 workflowConfig accepts`,
    )
    assert.equal(
      config.WORKFLOW_ROUTE_META[tool.id].mode,
      config.WORKFLOW_ROUTING[tool.id],
      `${tool.id} route meta 与 routing 不一致`,
    )
  }
  assert.equal(Object.keys(config.WORKFLOW_ROUTING).length, TOOLS.length)
  assert.equal(Object.keys(config.WORKFLOW_ACCEPTS).length, TOOLS.length)
})

test('适配器：每个 jump 工具都有完整适配器，silent 工具不产生页面适配器', async () => {
  const { TOOLS } = await loadRegistry()
  const config = await loadConfig()
  const adapters = await loadAdapters()

  for (const tool of TOOLS) {
    const mode = config.WORKFLOW_ROUTING[tool.id]
    const adapter = adapters.getWorkflowAdapter(tool.id)
    if (mode === 'jump') {
      assert.ok(adapter, `${tool.id} 是 jump 但没有适配器`)
      assert.equal(adapter.id, tool.id)
      assert.equal(typeof adapter.hasInput, 'function', `${tool.id} 缺 hasInput`)
      assert.equal(typeof adapter.isReady, 'function', `${tool.id} 缺 isReady`)
      assert.equal(typeof adapter.apply, 'function', `${tool.id} 缺 apply`)
    } else {
      assert.equal(adapter, null, `${tool.id} 是 silent 不应有页面适配器`)
    }
  }
})

test('来源：23 个工具都能从页面数据提取到非空载荷', async () => {
  const { TOOLS } = await loadRegistry()
  const source = await loadSource()
  const data = megaPageData()

  for (const tool of TOOLS) {
    const snapshot = source.readWorkflowSource(tool.id, data)
    assert.ok(snapshot, `${tool.id} 无法提取流转来源`)
    assert.equal(snapshot.data.type, snapshot.data.type)
    assert.ok(snapshot.data.payload.trim(), `${tool.id} 提取了空载荷`)
    assert.ok(
      ['text', 'image', 'json'].includes(snapshot.data.type),
      `${tool.id} 载荷类型非法`,
    )
  }
})

test('页面：每个工具都有发起端与接收端，watermark 不得只收不发', async () => {
  const { TOOLS } = await loadRegistry()

  for (const tool of TOOLS) {
    const pageDir = path.dirname(path.join(ROOT, tool.route.replace(/^\//, '')))
    const wxmlPath = path.join(pageDir, 'index.wxml')
    const wxml = fs.readFileSync(wxmlPath, 'utf8')
    const usesShell = wxml.includes('<glass-tool-shell')
    const hasReceiver = wxml.includes('<workflow-receiver')
    const hasPanel = wxml.includes('<workflow-panel')

    assert.ok(usesShell || hasReceiver, `${tool.id} 既没有壳层也没有接收端`)
    if (usesShell) {
      assert.ok(wxml.includes(`tool-id="${tool.id}"`), `${tool.id} 未传 tool-id`)
      assert.ok(
        wxml.includes('has-result="{{hasResult}}"'),
        `${tool.id} 未把 hasResult 传给壳层，流转入口不会出现`,
      )
    } else {
      assert.ok(hasReceiver, `${tool.id} 自定义页缺少 workflow-receiver`)
      assert.ok(hasPanel, `${tool.id} 自定义页缺少发起端 workflow-panel`)
    }
  }
})

test('多字段工具：必须暴露 onReceiveWorkflow(data) 页面接口', async () => {
  const { TOOLS } = await loadRegistry()
  const multiFieldTools = ['unit', 'span', 'hash', 'text-diff', 'palette', 'watermark']

  for (const id of multiFieldTools) {
    const tool = TOOLS.find((item) => item.id === id)
    assert.ok(tool, `${id} 不在 registry`)
    const pageDir = path.dirname(path.join(ROOT, tool.route.replace(/^\//, '')))
    const ts = fs.readFileSync(path.join(pageDir, 'index.ts'), 'utf8')
    assert.match(ts, /onReceiveWorkflow\s*\(/, `${id} 缺少 onReceiveWorkflow`)
  }
})

test('span 适配器：默认表单不触发覆盖确认，注入优先走页面接口', async () => {
  const adapters = await loadAdapters()
  const adapter = adapters.getWorkflowAdapter('span')
  assert.ok(adapter)

  let received = null
  const page = {
    data: { formTouched: false },
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
  const payload = {
    type: 'text',
    payload: '2026-01-01',
    context: { spanIncludeStart: true, spanExcludeWeekend: false },
  }

  assert.equal(adapter.hasInput(page), false, '默认日期不应算作用户输入')
  assert.equal(await adapter.apply(page, payload), true)
  assert.deepEqual(received, payload)
  page.data.formTouched = true
  assert.equal(adapter.hasInput(page), true, '手动编辑后必须触发覆盖确认')
})
