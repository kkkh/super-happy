/* ==========================================================================
   元宝搜索页 · 行为回归
   - 查询 → 请求 → 结果 / 海报 / 摘要
   - 官方 Error → 页面错误态
   - Workflow 文本注入 → 自动搜索
   - config-local 用测试替身注入，避免读取真实密钥
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { registerHooks } = require('node:module')

const ROOT = path.resolve(__dirname, '..')
const FAKE_CONFIG = `data:text/javascript,${encodeURIComponent(
  "export const YUANBAO_CONFIG = { apiKey: 'sk-test', secretId: '', secretKey: '', endpoint: 'https://example.test/SearchPro', timeout: 1000 }",
)}`

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier === './config-local' &&
      String(context.parentURL || '').includes('/core/services/yuanbao/index')
    ) {
      return { url: FAKE_CONFIG, shortCircuit: true }
    }
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

function payload() {
  return {
    Response: {
      Pages: [
        JSON.stringify({
          title: '第一条结果',
          url: 'https://example.com/1',
          site: '示例网',
          date: '2026-11-11',
          passage: '摘要一',
        }),
        JSON.stringify({
          title: '第二条结果',
          url: 'https://example.com/2',
          passage: '摘要二',
        }),
      ],
      Query: '人工智能',
      Version: 'standard',
      RequestId: 'req-page',
    },
  }
}

function installWx(response) {
  globalThis.wx = {
    request(options) {
      options.success({
        statusCode: 200,
        data: response || payload(),
      })
      return { abort() {} }
    },
    vibrateShort() {},
    getStorageSync() {
      return ''
    },
    setStorageSync() {},
    removeStorageSync() {},
  }
}

function createPage(definition) {
  const instance = {
    data: JSON.parse(JSON.stringify(definition.data || {})),
    setData(patch, callback) {
      Object.assign(this.data, JSON.parse(JSON.stringify(patch)))
      if (callback) {
        callback()
      }
    },
  }
  Object.keys(definition).forEach((key) => {
    if (typeof definition[key] === 'function') {
      instance[key] = definition[key].bind(instance)
    }
  })
  return instance
}

let cachedDefinition = null

async function loadDefinition() {
  if (cachedDefinition) {
    return cachedDefinition
  }
  installWx()
  let definition = null
  const previousPage = globalThis.Page
  globalThis.Page = (config) => {
    definition = config
  }
  try {
    await import(pathToFileURL(path.join(ROOT, 'subpackages/tools-core/pages/web-search/index.ts')).href)
  } finally {
    globalThis.Page = previousPage
  }
  if (!definition) {
    throw new Error('web-search page definition was not captured')
  }
  cachedDefinition = definition
  return definition
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

test('页面：查询后回填结果、摘要与海报，且海报不含搜索词', async () => {
  const definition = await loadDefinition()
  installWx()
  const page = createPage(definition)

  page.onLoad({ query: '人工智能' })
  page.onReady()
  await flush()

  assert.equal(page.data.serviceReady, true)
  assert.equal(page.data.shellState, 'done')
  assert.equal(page.data.hasResult, true)
  assert.equal(page.data.resultCount, 2)
  assert.equal(page.data.results[0].title, '第一条结果')
  assert.match(page.data.searchSummary, /共 2 条结果/)
  assert.equal(page.data.posterData.mainResult, '2 条结果')
  assert.equal(page.data.posterData.params.length, 2)
  assert.equal(JSON.stringify(page.data.posterData).includes('人工智能'), false)
  page.onUnload()
})

test('页面：官方 Error 进入错误态并清空结果', async () => {
  const definition = await loadDefinition()
  installWx({
    Response: {
      Error: { Code: 'UnauthorizedOperation', Message: 'bad key' },
      RequestId: 'req-error',
    },
  })
  const page = createPage(definition)

  page.onLoad({})
  page.setData({ query: '测试' })
  page.runSearch()
  await flush()

  assert.equal(page.data.shellState, 'error')
  assert.equal(page.data.hasResult, false)
  assert.match(page.data.error, /密钥无效|未授权/)
  assert.equal(page.data.posterData, null)
  page.onUnload()
})

test('页面：Workflow 文本注入后自动搜索', async () => {
  const definition = await loadDefinition()
  installWx()
  const page = createPage(definition)

  page.onLoad({})
  const accepted = page.onReceiveWorkflow({ type: 'text', payload: '三星堆的由来' })
  await flush()

  assert.equal(accepted, true)
  assert.equal(page.data.query, '三星堆的由来')
  assert.equal(page.data.shellState, 'done')
  assert.equal(page.data.resultCount, 2)
  page.onUnload()
})
