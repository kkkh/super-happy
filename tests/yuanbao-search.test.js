/* ==========================================================================
   元宝搜索 · 服务层回归
   - 官方 Pages JSON 字符串解析、HTML 清洗、异常条目丢弃
   - Bearer 请求头、请求体、错误码映射、网络失败
   - config.local 用测试替身注入，避免读取真实密钥
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

function moduleUrl(relative) {
  return pathToFileURL(path.join(ROOT, relative)).href
}

function officialPayload() {
  return {
    Response: {
      Pages: [
        JSON.stringify({
          title: '人工智能<strong>发展现状</strong>',
          url: 'https://example.com/ai',
          site: '示例网',
          date: '2026-11-06 16:59:00',
          passage: '第一段 <strong>摘要</strong> &amp; 更多内容',
          content: '更长的正文 <p>段落</p>',
          score: 0.91,
          authority_level: 4,
          favicon: 'https://example.com/favicon.ico',
          pics: [{ caption: '配图', origin_url: 'https://example.com/a.jpg' }],
          deeplinks: [{ title: '子链', url: 'https://example.com/sub' }],
        }),
        '{"title":"第二条","url":"https://example.com/2","passage":"摘要二"}',
        'not-json',
        '{"title":"","url":""}',
      ],
      Query: '人工智能',
      Version: 'standard',
      RequestId: 'req-1',
    },
  }
}

test('解析：Pages JSON 字符串、HTML 清洗与非法条目丢弃', async () => {
  const { parseYuanbaoResponse } = await import(moduleUrl('core/services/yuanbao/index.ts'))
  const result = parseYuanbaoResponse(officialPayload())

  assert.equal(result.query, '人工智能')
  assert.equal(result.version, 'standard')
  assert.equal(result.requestId, 'req-1')
  assert.equal(result.results.length, 2)
  assert.equal(result.results[0].title, '人工智能 发展现状')
  assert.equal(result.results[0].passage, '第一段 摘要 & 更多内容')
  assert.equal(result.results[0].site, '示例网')
  assert.equal(result.results[0].score, 0.91)
  assert.equal(result.results[0].authorityLevel, 4)
  assert.equal(result.results[0].pics.length, 1)
  assert.equal(result.results[0].deeplinks.length, 1)
  assert.equal(result.results[1].title, '第二条')
})

test('解析：官方 Error 对象按错误码映射', async () => {
  const { parseYuanbaoResponse, YuanbaoError } = await import(
    moduleUrl('core/services/yuanbao/index.ts')
  )

  for (const [code, expected] of [
    ['UnauthorizedOperation', 'unauthorized'],
    ['AuthFailure.SignatureFailure', 'unauthorized'],
    ['AuthFailure.SecretIdNotFound', 'unauthorized'],
    ['ResourceNotFound', 'not-activated'],
    ['ResourceNotFound.ServiceNotActivated', 'not-activated'],
    ['RequestLimitExceeded', 'quota'],
    ['ResourceUnavailable', 'unavailable'],
    ['InvalidParameter', 'invalid-parameter'],
  ]) {
    assert.throws(
      () =>
        parseYuanbaoResponse({
          Response: { Error: { Code: code, Message: 'x' }, RequestId: 'r' },
        }),
      (error) => error instanceof YuanbaoError && error.code === expected,
    )
  }
})

test('请求：Bearer 头、SearchPro 地址、筛选参数与成功解析', async () => {
  const captured = []
  globalThis.wx = {
    request(options) {
      captured.push(options)
      options.success({ statusCode: 200, data: officialPayload() })
      return { abort() {} }
    },
  }

  try {
    const { searchYuanbao } = await import(moduleUrl('core/services/yuanbao/index.ts'))
    let task
    const result = await searchYuanbao(
      {
        query: '人工智能',
        cnt: 20,
        freshness: 'd7',
        industry: 'news',
        site: 'qq.com',
      },
      { onTask: (value) => (task = value) },
    )

    assert.ok(task, '必须把 RequestTask 交给页面用于取消')
    assert.equal(captured.length, 1)
    const request = captured[0]
    assert.equal(request.url, 'https://example.test/SearchPro')
    assert.equal(request.method, 'POST')
    assert.equal(request.header.Authorization, 'Bearer sk-test')
    assert.equal(request.header['Content-Type'], 'application/json; charset=utf-8')
    assert.equal(typeof request.data, 'string')
    assert.deepEqual(JSON.parse(request.data), {
      Query: '人工智能',
      Cnt: 20,
      Freshness: 'd7',
      Industry: 'news',
      Site: 'qq.com',
    })
    assert.equal(result.results.length, 2)
  } finally {
    delete globalThis.wx
  }
})

test('请求：HTTP 失败、网络失败与空查询', async () => {
  const { searchYuanbao, YuanbaoError } = await import(
    moduleUrl('core/services/yuanbao/index.ts')
  )

  await assert.rejects(
    () => searchYuanbao({ query: '   ' }),
    (error) => error instanceof YuanbaoError && error.code === 'empty-query',
  )

  globalThis.wx = {
    request(options) {
      options.success({ statusCode: 502, data: '' })
      return { abort() {} }
    },
  }
  await assert.rejects(
    () => searchYuanbao({ query: '天气' }),
    (error) => error instanceof YuanbaoError && error.code === 'http',
  )

  globalThis.wx = {
    request(options) {
      options.success({ statusCode: 429, data: '' })
      return { abort() {} }
    },
  }
  await assert.rejects(
    () => searchYuanbao({ query: '天气' }),
    (error) => error instanceof YuanbaoError && error.code === 'quota',
  )

  globalThis.wx = {
    request(options) {
      options.fail({ errMsg: 'request:fail timeout' })
      return { abort() {} }
    },
  }
  await assert.rejects(
    () => searchYuanbao({ query: '天气' }),
    (error) => error instanceof YuanbaoError && error.code === 'timeout',
  )

  globalThis.wx = {
    request(options) {
      options.fail({ errMsg: 'request:fail url not in domain list' })
      return { abort() {} }
    },
  }
  await assert.rejects(
    () => searchYuanbao({ query: '天气' }),
    (error) =>
      error instanceof YuanbaoError &&
      error.code === 'network' &&
      error.message.includes('wsa.tencentcloudapi.com'),
  )

  delete globalThis.wx
})

test('摘要：无结果与前三条的纯文本输出', async () => {
  const { summarizeYuanbaoResults } = await import(
    moduleUrl('core/services/yuanbao/index.ts')
  )
  assert.equal(summarizeYuanbaoResults('空', []), '元宝搜索「空」暂无结果')
  const summary = summarizeYuanbaoResults('AI', [
    { title: 'A', url: 'https://a', site: '站A', date: '', passage: '', content: '', score: 0, authorityLevel: 0, favicon: '', pics: [], deeplinks: [] },
    { title: 'B', url: 'https://b', site: '', date: '', passage: '', content: '', score: 0, authorityLevel: 0, favicon: '', pics: [], deeplinks: [] },
  ])
  assert.match(summary, /共 2 条结果/)
  assert.match(summary, /1\. A（站A）/)
  assert.match(summary, /2\. B/)
})
