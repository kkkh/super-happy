/* ==========================================================================
   全息专注引擎 · P0 加密契约测试
   - SHA-256 / HMAC-SHA256 RFC 4231 标准向量
   - canonicalSession / canonicalRecord / canonicalStats 固定顺序
   - 签名 / 验签 / tamper / keyLost
   - 运行：npm test
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const nodeCrypto = require('node:crypto')
const { pathToFileURL } = require('node:url')
const { registerHooks } = require('node:module')

const ROOT = path.resolve(__dirname, '..')

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !path.extname(specifier)) {
      try {
        return nextResolve(`${specifier}.ts`, context)
      } catch {
        /* 非 TS 模块回退 */
      }
    }
    return nextResolve(specifier, context)
  },
})

function moduleUrl(relative) {
  return pathToFileURL(path.join(ROOT, relative)).href
}

async function load(relative) {
  return import(moduleUrl(relative))
}

function nodeSha256(text) {
  return nodeCrypto.createHash('sha256').update(text, 'utf8').digest('hex')
}

function nodeHmac(keyHex, text) {
  return nodeCrypto
    .createHmac('sha256', Buffer.from(keyHex, 'hex'))
    .update(text, 'utf8')
    .digest('hex')
}

const KEY_HEX = 'ab'.repeat(32)

function makeSession(overrides = {}) {
  return {
    version: 1,
    id: 's-1',
    fsm: 'focusing',
    tag: '写代码',
    startedAt: 1000,
    phaseStartedAt: 1200,
    phaseEndsAt: 1501200,
    phaseTotalMs: 1500000,
    remainingMs: 0,
    cycle: 2,
    completedFocus: 1,
    continuousFocusMs: 1500000,
    breaches: 0,
    audio: {
      rain: true,
      fire: false,
      keyboard: false,
      volumes: { rain: 0.45, fire: 0.3, keyboard: 0.25 },
      masterVolume: 0.55,
      bgm: true,
    },
    updatedAt: 1600,
    lockUntil: undefined,
    lastHeartbeatAt: 1550,
    confidence: 'high',
    signature: '',
    ...overrides,
  }
}

function makeRecord(overrides = {}) {
  return {
    version: 1,
    id: 'rec-s-1',
    tag: '写代码',
    startedAt: 1000,
    endedAt: 1501000,
    focusedMs: 1500000,
    breaches: 1,
    seed: 123456789,
    level: 3,
    confidence: 'high',
    signature: '',
    ...overrides,
  }
}

function makeStats(overrides = {}) {
  return {
    version: 1,
    totalFocusMs: 9000000,
    completedCount: 6,
    level: 3,
    streakDays: 4,
    lastCompletedDate: '2026-11-08',
    todayDate: '2026-11-08',
    todayFocusMs: 1500000,
    continuousFocusMs: 3000000,
    lastAppliedRecordId: 'rec-s-1',
    updatedAt: 1501000,
    signature: '',
    ...overrides,
  }
}

test('SHA-256：标准向量 / UTF-8 / 多块输入', async () => {
  const crypto = await load('subpackages/life/lib/focus-crypto.ts')

  assert.equal(
    crypto.sha256Hex(''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  )
  assert.equal(
    crypto.sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  )

  const samples = ['心流 · 写代码', 'a'.repeat(1000), '🙂 emoji', 'line\nbreak']
  for (const sample of samples) {
    assert.equal(crypto.sha256Hex(sample), nodeSha256(sample), `SHA-256 不符：${sample}`)
  }
})

test('HMAC-SHA256：RFC 4231 标准向量', async () => {
  const crypto = await load('subpackages/life/lib/focus-crypto.ts')

  assert.equal(
    crypto.hmacSha256Hex('0b'.repeat(20), 'Hi There'),
    'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
  )
  assert.equal(
    crypto.hmacSha256Hex('4a656665', 'what do ya want for nothing?'),
    '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
  )
  assert.equal(
    crypto.hmacSha256Bytes('aa'.repeat(20), new Uint8Array(50).fill(0xdd)),
    '773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe',
  )
})

test('HMAC-SHA256：中文 / 64 位 key 与 Node 结果一致', async () => {
  const crypto = await load('subpackages/life/lib/focus-crypto.ts')
  const message = '心流 · 写代码 · 25 分钟'
  assert.equal(crypto.hmacSha256Hex(KEY_HEX, message), nodeHmac(KEY_HEX, message))
})

test('canonical 顺序固定，tag 里的引号 / 竖线不破坏签名', async () => {
  const crypto = await load('subpackages/life/lib/focus-crypto.ts')
  const record = makeRecord({ tag: 'a"|b\\c' })

  const canonical = crypto.canonicalRecord(record)
  assert.equal(
    canonical,
    JSON.stringify([
      1,
      record.id,
      record.tag,
      record.startedAt,
      record.endedAt,
      record.focusedMs,
      record.breaches,
      record.seed,
      record.level,
      record.confidence,
    ]),
  )

  record.signature = crypto.signRecord(record, KEY_HEX)
  const check = crypto.verifyRecord(record, KEY_HEX)
  assert.equal(check.verified, true)
  assert.equal(check.tainted, false)
  assert.equal(check.reason, 'ok')
})

test('Session / Record / Stats：签名、验签、tamper、keyLost', async () => {
  const crypto = await load('subpackages/life/lib/focus-crypto.ts')

  const session = makeSession()
  session.signature = crypto.signSession(session, KEY_HEX)
  assert.equal(crypto.verifySessionSignature(session, KEY_HEX), true)
  const tamperedSession = makeSession({ tag: '读书' })
  tamperedSession.signature = session.signature
  assert.equal(crypto.verifySessionSignature(tamperedSession, KEY_HEX), false)
  assert.equal(crypto.verifySessionSignature(session, ''), false)

  const record = makeRecord()
  record.signature = crypto.signRecord(record, KEY_HEX)
  assert.equal(crypto.verifyRecord(record, KEY_HEX).verified, true)

  const tamperedRecord = makeRecord({ breaches: 2 })
  tamperedRecord.signature = record.signature
  const tamperedCheck = crypto.verifyRecord(tamperedRecord, KEY_HEX)
  assert.equal(tamperedCheck.verified, false)
  assert.equal(tamperedCheck.tainted, true)
  assert.equal(tamperedCheck.reason, 'signature')

  const keyLost = crypto.verifyRecord(record, '')
  assert.equal(keyLost.verified, false)
  assert.equal(keyLost.tainted, false)
  assert.equal(keyLost.reason, 'keyLost')

  const stats = makeStats()
  stats.signature = crypto.signStats(stats, KEY_HEX)
  assert.equal(crypto.verifyStatsSignature(stats, KEY_HEX), true)
  const tamperedStats = makeStats({ todayFocusMs: 1500001 })
  tamperedStats.signature = stats.signature
  assert.equal(crypto.verifyStatsSignature(tamperedStats, KEY_HEX), false)
})

test('key / seed：32 字节 key、32-bit 无符号 seed', async () => {
  const crypto = await load('subpackages/life/lib/focus-crypto.ts')

  const bytes = new Uint8Array(32).fill(0xab)
  assert.equal(crypto.keyHexFromBytes(bytes), 'ab'.repeat(32))
  assert.throws(() => crypto.keyHexFromBytes(new Uint8Array(31)))

  assert.equal(crypto.seedFromBytes(new Uint8Array([0x12, 0x34, 0x56, 0x78])), 0x12345678)
  assert.equal(crypto.seedFromBytes(new Uint8Array([0xff, 0xff, 0xff, 0xff])), 0xffffffff)
  assert.throws(() => crypto.seedFromBytes(new Uint8Array(3)))

  assert.equal(crypto.isValidKeyHex(KEY_HEX), true)
  assert.equal(crypto.isValidKeyHex('ab'), false)
  assert.equal(crypto.isValidKeyHex(`zz${'0'.repeat(62)}`), false)
})
