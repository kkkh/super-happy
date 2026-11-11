/* ==========================================================================
   元宝搜索页 · 行为回归
   - 查询 → 请求 → 结果 / 海报 / 摘要
   - 官方 Error → 页面错误态
   - Workflow 文本注入 → 自动搜索
   - config-local 用测试替身注入，避免读取真实密钥
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
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
          score: 0.91,
          authority_level: 4,
          favicon: 'https://example.com/favicon.ico',
          pics: [{ caption: '现场图', origin_url: 'https://example.com/p1.jpg' }],
          deeplinks: [{ title: '附件一', url: 'https://example.com/deep/1' }],
        }),
        JSON.stringify({
          title: '第二条结果',
          url: 'https://example.com/2',
          passage: '摘要二',
        }),
      ],
      Query: '人工智能',
      Version: 'flagship',
      Msg: '结果经过去重',
      RequestId: 'req-page',
    },
  }
}

let lastRequestData = ''

function installWx(response) {
  lastRequestData = ''
  globalThis.wx = {
    request(options) {
      lastRequestData = options.data
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
  /* 旗舰版支持信息与结果字段 */
  assert.equal(page.data.versionLabel, '旗舰版')
  assert.equal(page.data.versionHint, '')
  assert.equal(page.versionLabel('standard'), '标准版')
  assert.equal(page.versionHint('standard', false), '')
  assert.match(page.versionHint('standard', true), /未返回/)
  assert.equal(page.versionHint('flagship', true), '')
  assert.equal(page.data.message, '结果经过去重')
  assert.equal(page.data.requestId, 'req-page')
  assert.equal(page.data.results[0].scoreText, '相关 0.91')
  assert.equal(page.data.results[0].authorityText, '权威 4/5')
  assert.equal(page.data.results[0].favicon, 'https://example.com/favicon.ico')
  assert.equal(page.data.results[0].pics.length, 1)
  assert.equal(page.data.results[0].deeplinks[0].title, '附件一')
  assert.match(page.data.exportContent, /第一条结果/)
  assert.match(page.data.exportContent, /第二条结果/)
  assert.equal(page.data.exportContent.includes('另有'), false)
  const { toArticleExport } = await import(
    pathToFileURL(path.join(ROOT, 'subpackages/tools-core/lib/web-search-view.ts')).href
  )
  const article = toArticleExport(page.data.results[0])
  assert.equal(article.filename, '第一条结果')
  assert.match(article.content, /示例网 · 2026-11-11/)
  assert.match(article.content, /附件子链/)
  assert.match(article.content, /https:\/\/example\.com\/deep\/1/)
  const componentDir = path.join(ROOT, 'subpackages/tools-core/components/web-search-results')
  const componentWxml = fs.readFileSync(path.join(componentDir, 'index.wxml'), 'utf8')
  const componentTs = fs.readFileSync(path.join(componentDir, 'index.ts'), 'utf8')
  assert.match(componentWxml, /bindtap="onExportArticle"/)
  assert.match(componentTs, /sharePrepared\(runtime\.articlePath\)/)
  page.onUnload()
})

test('页面：Cnt 50、Deeplinks 与自定义时效透传官方参数', async () => {
  const definition = await loadDefinition()
  const five = payload()
  five.Response.Pages.push(
    JSON.stringify({ title: '第三条结果', url: 'https://example.com/3', passage: '摘要三' }),
    JSON.stringify({ title: '第四条结果', url: 'https://example.com/4', passage: '摘要四' }),
    JSON.stringify({ title: '第五条结果', url: 'https://example.com/5', passage: '摘要五' }),
  )
  installWx(five)
  const page = createPage(definition)

  page.onLoad({})
  page.setData({
    query: '量子计算',
    cnt: '50',
    deeplinks: true,
    freshnessPreset: 'custom',
    customMode: 'recent',
    customN: '3',
    customUnit: 'm',
  })
  page.recomputeCustomFreshness()
  assert.equal(page.data.freshness, 'm3')
  assert.equal(page.data.customError, '')

  page.runSearch()
  await flush()

  const request = JSON.parse(lastRequestData)
  assert.equal(request.Query, '量子计算')
  assert.equal(request.Cnt, 50)
  assert.equal(request.Freshness, 'm3')
  assert.equal(request.Deeplinks, true)
  assert.equal(page.data.shellState, 'done')
  assert.equal(page.data.resultCount, 5)
  assert.equal(page.data.posterData.params[1].value, '最近 3 月')
  assert.match(page.data.searchSummary, /另有 2 条/)
  assert.match(page.data.exportContent, /5\. 第五条结果/)
  assert.match(page.data.exportContent, /摘要五/)
  page.onUnload()
})

test('页面：自定义时效非法时阻止请求', async () => {
  const definition = await loadDefinition()
  installWx()
  const page = createPage(definition)

  page.onLoad({})
  page.setData({
    query: '测试',
    freshnessPreset: 'custom',
    customMode: 'range',
    customStart: '2026-11-10',
    customEnd: '2026-11-01',
  })
  page.recomputeCustomFreshness()
  assert.match(page.data.customError, /开始日期不能晚于结束日期/)

  page.runSearch()
  await flush()

  assert.equal(lastRequestData, '')
  assert.equal(page.data.shellState, 'invalid')
  assert.match(page.data.error, /开始日期不能晚于结束日期/)
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
