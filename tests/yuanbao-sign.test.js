/* ==========================================================================
   元宝搜索 · SHA-256 / HMAC / TC3 签名回归
   - 与 Node crypto 对照，保证纯 TS 实现与官方算法一致
   - 覆盖中文 UTF-8、固定时间戳与 Authorization 拼接
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
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

test('SHA-256：ASCII / 中文与 Node crypto 一致', async () => {
  const { sha256Hex } = await import(moduleUrl('core/services/yuanbao/sign.ts'))
  for (const text of ['abc', '', '人工智能发展现状', 'A'.repeat(200)]) {
    assert.equal(sha256Hex(text), crypto.createHash('sha256').update(text, 'utf8').digest('hex'))
  }
})

test('HMAC-SHA256：RFC 4231 向量一致', async () => {
  const { hmacSha256Bytes, bytesToHex, utf8Bytes } = await import(
    moduleUrl('core/services/yuanbao/sign.ts')
  )
  const digest = bytesToHex(
    hmacSha256Bytes(utf8Bytes('key'), 'The quick brown fox jumps over the lazy dog'),
  )
  assert.equal(digest, 'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8')
})

test('TC3：固定输入与 Node crypto 参考签名一致', async () => {
  const { signTc3 } = await import(moduleUrl('core/services/yuanbao/sign.ts'))
  const input = {
    secretId: 'AKIDTEST',
    secretKey: 'SECRETTEST',
    host: 'wsa.tencentcloudapi.com',
    service: 'wsa',
    action: 'SearchPro',
    version: '2025-05-08',
    payload: '{"Query":"人工智能","Cnt":10}',
    timestamp: 1760000000,
  }

  const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex')
  const hmac = (key, text) => crypto.createHmac('sha256', key).update(text, 'utf8').digest()
  const date = '2025-10-09'
  const canonicalHeaders =
    'content-type:application/json; charset=utf-8\nhost:wsa.tencentcloudapi.com\nx-tc-action:searchpro\n'
  const signedHeaders = 'content-type;host;x-tc-action'
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${sha256(input.payload)}`
  const scope = `${date}/wsa/tc3_request`
  const stringToSign = `TC3-HMAC-SHA256\n${input.timestamp}\n${scope}\n${sha256(canonicalRequest)}`
  const secretDate = hmac(`TC3${input.secretKey}`, date)
  const secretService = hmac(secretDate, 'wsa')
  const secretSigning = hmac(secretService, 'tc3_request')
  const signature = hmac(secretSigning, stringToSign).toString('hex')
  const expected = `TC3-HMAC-SHA256 Credential=${input.secretId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  const result = signTc3(input)
  assert.equal(result.date, date)
  assert.equal(result.authorization, expected)
  assert.equal(result.headers.Authorization, expected)
  assert.equal(result.headers['X-TC-Action'], 'SearchPro')
  assert.equal(result.headers['X-TC-Version'], '2025-05-08')
  assert.equal(result.headers['X-TC-Timestamp'], '1760000000')
  assert.equal(result.headers['Content-Type'], 'application/json; charset=utf-8')
})
