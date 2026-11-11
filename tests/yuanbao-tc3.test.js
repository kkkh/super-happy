/* ==========================================================================
   元宝搜索 · TC3 请求路径
   - 服务密钥为空时自动切换 wsa.tencentcloudapi.com + TC3 头
   - 请求体必须是固定的 JSON 字符串，保证签名与实际字节一致
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { registerHooks } = require('node:module')

const ROOT = path.resolve(__dirname, '..')
const FAKE_CONFIG = `data:text/javascript,${encodeURIComponent(
  "export const YUANBAO_CONFIG = { apiKey: '', secretId: 'AKIDTEST', secretKey: 'SECRETTEST', endpoint: 'https://api.wsa.cloud.tencent.com/SearchPro', timeout: 1000 }",
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
      Pages: ['{"title":"TC3 结果","url":"https://example.com/tc3","passage":"摘要"}'],
      Query: '人工智能',
      Version: 'standard',
      RequestId: 'req-tc3',
    },
  }
}

test('TC3：URL、签名头、版本与字符串请求体', async () => {
  const captured = []
  globalThis.wx = {
    request(options) {
      captured.push(options)
      options.success({ statusCode: 200, data: payload() })
      return { abort() {} }
    },
  }

  try {
    const { searchYuanbao } = await import(moduleUrl('core/services/yuanbao/index.ts'))
    const result = await searchYuanbao({ query: '人工智能', cnt: 10 })
    const request = captured[0]

    assert.equal(request.url, 'https://wsa.tencentcloudapi.com/')
    assert.match(request.header.Authorization, /^TC3-HMAC-SHA256 Credential=AKIDTEST\//)
    assert.equal(request.header['X-TC-Action'], 'SearchPro')
    assert.equal(request.header['X-TC-Version'], '2025-05-08')
    assert.match(request.header['X-TC-Timestamp'], /^\d+$/)
    assert.equal(typeof request.data, 'string')
    assert.deepEqual(JSON.parse(request.data), { Query: '人工智能', Cnt: 10 })
    assert.equal(result.results.length, 1)
    assert.equal(result.results[0].title, 'TC3 结果')
  } finally {
    delete globalThis.wx
  }
})

function moduleUrl(relative) {
  return pathToFileURL(path.join(ROOT, relative)).href
}
