/* ==========================================================================
   Workflow 全量接管 · 静态覆盖测试
   - 全部工具必须同时存在于 workflowConfig 的 routing / accepts
   - 所有 jump 工具必须有适配器，所有 silent 工具不得有页面适配器
   - 全部工具都必须能从页面数据提取到可流转结果
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

/**
 * 由 workflowSource 的 WORKFLOW_SOURCE_KEYS 动态生成每个工具的页面数据。
 * 禁止在测试里手写卡片字段清单：新增卡只需在共享引擎登记字段，测试自动覆盖。
 */
function sourceFixture(toolId, keys) {
  const data = {}
  for (const key of keys.text) {
    data[key] = key === 'localText' ? '2026-01-01' : 'payload'
  }
  for (const key of keys.number) {
    data[key] = 1
  }
  for (const key of keys.image) {
    data[key] = '/tmp/mock.png'
  }
  /* 九宫格走 tiles 数组回退；时间戳走 mode 分支；调色板优先读 colors */
  if (toolId === 'nine-grid') {
    data.tiles = [{ path: '/tmp/mock.png' }]
  }
  if (toolId === 'timestamp') {
    data.mode = 'to-date'
  }
  if (toolId === 'palette') {
    data.colors = [{ hex: '#FFFFFF' }]
  }
  return data
}

test('配置：全部工具注册 routing / accepts，且无多余条目', async () => {
  const { TOOLS } = await loadRegistry()
  const config = await loadConfig()

  assert.ok(TOOLS.length >= 24)
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

test('来源：全部工具都能从页面数据提取到非空载荷', async () => {
  const { TOOLS } = await loadRegistry()
  const source = await loadSource()

  assert.equal(
    Object.keys(source.WORKFLOW_SOURCE_KEYS).length,
    TOOLS.length,
    'WORKFLOW_SOURCE_KEYS 必须与 registry 工具数一致',
  )

  for (const tool of TOOLS) {
    const keys = source.WORKFLOW_SOURCE_KEYS[tool.id]
    assert.ok(keys, `${tool.id} 未登记 WORKFLOW_SOURCE_KEYS`)
    assert.ok(
      keys.text.length + keys.number.length + keys.image.length > 0 || tool.id === 'nine-grid',
      `${tool.id} 的来源字段为空`,
    )

    const snapshot = source.readWorkflowSource(tool.id, sourceFixture(tool.id, keys))
    assert.ok(snapshot, `${tool.id} 无法提取流转来源`)
    assert.equal(snapshot.toolId, tool.id, `${tool.id} 来源工具 id 不一致`)
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
  const multiFieldTools = ['unit', 'ledger', 'span', 'hash', 'text-diff', 'palette', 'watermark']

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
