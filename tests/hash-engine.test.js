/* ==========================================================================
   Hash 与加密引擎 · 单元测试
   - 标准测试向量：MD5 / SHA-1 / SHA-256 / SHA-512
   - HMAC-MD5 / HMAC-SHA256 标准向量
   - UTF-8 中文 + Emoji、大小写转换、算法列表
   - 空文本 / 空密钥 / 100,000 字符上限拦截
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
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

async function loadHashEngine() {
  return import(moduleUrl('subpackages/tools-core/utils/hashEngine.ts'))
}

function hashOf(engine, text, algorithm, hmac = false, secret = '') {
  return engine.computeHash(text, { algorithm, hmac, secret })
}

test('标准向量：MD5("abc")', async () => {
  const engine = await loadHashEngine()
  const result = hashOf(engine, 'abc', 'md5')
  assert.equal(result.hex, '900150983cd24fb0d6963f7d28e17f72')
  assert.equal(result.algorithmLabel, 'MD5')
  assert.equal(result.modeLabel, '普通 Hash')
})

test('标准向量：SHA-1("abc")', async () => {
  const engine = await loadHashEngine()
  const result = hashOf(engine, 'abc', 'sha1')
  assert.equal(result.hex, 'a9993e364706816aba3e25717850c26c9cd0d89d')
})

test('标准向量：SHA-256("abc")', async () => {
  const engine = await loadHashEngine()
  const result = hashOf(engine, 'abc', 'sha256')
  assert.equal(
    result.hex,
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  )
  assert.equal(result.algorithmLabel, 'SHA-256')
})

test('标准向量：SHA-512("abc")', async () => {
  const engine = await loadHashEngine()
  const result = hashOf(engine, 'abc', 'sha512')
  assert.equal(
    result.hex,
    'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a' +
      '2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
  )
})

test('标准向量：HMAC-MD5 与 HMAC-SHA256', async () => {
  const engine = await loadHashEngine()
  const message = 'The quick brown fox jumps over the lazy dog'
  const hmacMd5 = hashOf(engine, message, 'md5', true, 'key')
  const hmacSha256 = hashOf(engine, message, 'sha256', true, 'key')

  assert.equal(hmacMd5.hex, '80070713463e7749b90c2dc24911e275')
  assert.equal(hmacMd5.modeLabel, 'HMAC')
  assert.equal(
    hmacSha256.hex,
    'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8',
  )
})

test('UTF-8：中文 + Emoji 与 Node 标准结果一致', async () => {
  const engine = await loadHashEngine()
  const result = hashOf(engine, '中文😀', 'sha256')
  assert.equal(
    result.hex,
    'e973a1c1b41c5c9f4fbac31fcc311536dfffd003bfb914580455170a599953fa',
  )
  assert.equal(result.inputChars, 3, 'Emoji 按一个码点计')
})

test('大小写转换：formatHash 与结果元信息', async () => {
  const engine = await loadHashEngine()
  const result = hashOf(engine, 'abc', 'sha256')
  const lower = engine.formatHash(result.hex, 'lower')
  const upper = engine.formatHash(result.hex, 'upper')

  assert.equal(lower, result.hex)
  assert.equal(upper, result.hex.toUpperCase())
  assert.equal(result.inputChars, 3)
  assert.ok(result.elapsedMs >= 0)
})

test('算法列表：四种算法齐全且顺序稳定', async () => {
  const engine = await loadHashEngine()
  assert.deepEqual(
    engine.HASH_ALGORITHMS.map((item) => item.key),
    ['md5', 'sha1', 'sha256', 'sha512'],
  )
})

test('空文本：拒绝计算', async () => {
  const engine = await loadHashEngine()
  assert.throws(
    () => hashOf(engine, '', 'sha256'),
    /请输入需要计算 Hash 的文本/,
  )
  assert.throws(
    () => hashOf(engine, '   \n\t', 'sha256'),
    /请输入需要计算 Hash 的文本/,
  )
})

test('HMAC 空密钥：拒绝计算', async () => {
  const engine = await loadHashEngine()
  assert.throws(
    () => hashOf(engine, 'abc', 'sha256', true, ''),
    /HMAC 模式必须填写密钥/,
  )
  assert.throws(
    () => hashOf(engine, 'abc', 'sha256', true, '   '),
    /HMAC 模式必须填写密钥/,
  )
})

test('100,000 字符上限：超出拒绝计算', async () => {
  const engine = await loadHashEngine()
  const text = 'a'.repeat(engine.MAX_HASH_CHARS + 1)
  assert.throws(
    () => hashOf(engine, text, 'sha256'),
    /100,000|字符上限/,
  )
})
