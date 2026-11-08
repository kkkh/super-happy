/* ==========================================================================
   focus-storage · 会话 / 偏好 / key / ledger / stats / 亮度 单元测试
   - 损坏 JSON 与「键不存在」必须区分
   - 签名失败 / keyLost / 字段白名单
   - ledger 50 条上限与按 id 幂等；stats lastAppliedRecordId 防重复
   - 写入失败保留 session，可用同一 record.id 重试
   - 运行：npm test
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { registerHooks } = require('node:module')

const ROOT = path.resolve(__dirname, '..')
const KEY = '0f'.repeat(32)
const NOW = new Date(2026, 10, 8, 12, 0, 0).getTime()
const MIN = 60 * 1000
const HOUR = 60 * MIN
const FOCUS = 25 * MIN
const AUDIO = {
  rain: true,
  fire: false,
  keyboard: false,
  volumes: { rain: 0.45, fire: 0.3, keyboard: 0.25 },
  masterVolume: 0.55,
  bgm: true,
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !path.extname(specifier)) {
      try {
        return nextResolve(`${specifier}.ts`, context)
      } catch {
        /* 非 TS 模块回退原始路径 */
      }
    }
    return nextResolve(specifier, context)
  },
})

async function loadLibs() {
  const [storage, fsm, level, crypto] = await Promise.all([
    import(pathToFileURL(path.join(ROOT, 'subpackages/life/lib/focus-storage.ts')).href),
    import(pathToFileURL(path.join(ROOT, 'subpackages/life/lib/focus-fsm.ts')).href),
    import(pathToFileURL(path.join(ROOT, 'subpackages/life/lib/focus-level.ts')).href),
    import(pathToFileURL(path.join(ROOT, 'subpackages/life/lib/focus-crypto.ts')).href),
  ])
  return { storage, fsm, level, crypto }
}

function installWxMock(options = {}) {
  const storage = new Map()
  const fail = new Set()
  const randomQueue = options.randomQueue || []
  globalThis.wx = {
    getStorageSync(key) {
      return storage.has(key) ? storage.get(key) : ''
    },
    setStorageSync(key, value) {
      if (fail.has(key)) {
        throw new Error(`fail:${key}`)
      }
      storage.set(key, value)
    },
    removeStorageSync(key) {
      if (fail.has(key)) {
        throw new Error(`fail:${key}`)
      }
      storage.delete(key)
    },
    getRandomValues(option) {
      const bytes = randomQueue.shift() || new Uint8Array(32).fill(9)
      if (typeof option.success === 'function') {
        option.success({ randomValues: bytes })
      }
    },
  }
  return { storage, fail, randomQueue }
}

function createSession(module, overrides = {}) {
  return module.createFocusSession({
    id: 'session-1',
    tag: '深度工作',
    audio: AUDIO,
    stats: { completedCount: 0, continuousFocusMs: 0 },
    now: NOW,
    ...overrides,
  })
}

function createRecord(storage, key, index = 0, overrides = {}) {
  return storage.buildFocusRecord(
    {
      sessionId: `s-${index}`,
      tag: '深度工作',
      startedAt: NOW + index * HOUR,
      endedAt: NOW + index * HOUR + FOCUS,
      focusedMs: FOCUS,
      breaches: index % 2,
      level: 1 + (index % 6),
      confidence: 'high',
      seed: index,
      ...overrides,
    },
    key,
  )
}

test('偏好：默认值 / 保存读取 / 越界钳制 / 损坏回默认', async () => {
  installWxMock()
  const { storage } = await loadLibs()
  const defaults = storage.defaultFocusPrefs()
  assert.equal(defaults.version, 1)
  assert.equal(defaults.rain, true)
  assert.equal(defaults.fire, false)
  assert.equal(defaults.keyboard, false)
  assert.equal(defaults.volumes.rain, 0.45)
  assert.equal(defaults.masterVolume, 0.55)
  assert.equal(defaults.bgm, true)
  assert.equal(defaults.flipDetection, true)

  storage.saveFocusPrefs({
    version: 1,
    rain: false,
    fire: true,
    keyboard: false,
    volumes: { rain: -0.2, fire: 1.6, keyboard: 0.5 },
    masterVolume: 2,
    bgm: false,
    flipDetection: false,
  })
  const loaded = storage.loadFocusPrefs()
  assert.equal(loaded.rain, false)
  assert.equal(loaded.fire, true)
  assert.equal(loaded.volumes.rain, 0)
  assert.equal(loaded.volumes.fire, 1)
  assert.equal(loaded.masterVolume, 1)
  assert.equal(loaded.bgm, false)
  assert.equal(loaded.flipDetection, false)

  globalThis.wx.setStorageSync('focus:prefs:v1', '{bad')
  assert.deepEqual(storage.loadFocusPrefs(), defaults)
  globalThis.wx.setStorageSync('focus:prefs:v1', { version: 2 })
  assert.deepEqual(storage.loadFocusPrefs(), defaults)
})

test('key：生成 / 复用 / 大写归一 / 异步 getRandomValues', async () => {
  const mock = installWxMock({ randomQueue: [new Uint8Array(32).fill(1)] })
  const { storage } = await loadLibs()
  const seed = new Uint8Array(32).fill(7)
  const generated = storage.ensureFocusKey(seed)
  assert.equal(generated, '07'.repeat(32))
  assert.equal(storage.readFocusKey(), generated)
  /* 已有 key 时不得被新随机数覆盖 */
  assert.equal(storage.ensureFocusKey(new Uint8Array(32).fill(8)), generated)

  globalThis.wx.setStorageSync('focus:key:v1', KEY.toUpperCase())
  assert.equal(storage.readFocusKey(), KEY)
  assert.equal(storage.writeFocusKey('not-a-key'), false)

  globalThis.wx.removeStorageSync('focus:key:v1')
  const asyncKey = await storage.ensureFocusKeyAsync()
  assert.equal(asyncKey, '01'.repeat(32))
  assert.equal(mock.storage.get('focus:key:v1'), asyncKey)
})

test('key：getRandomValues 不可用 / 失败 → keyLost，不回退 Math.random', async () => {
  const mock = installWxMock()
  const { storage } = await loadLibs()
  globalThis.wx.getRandomValues = undefined
  assert.equal(storage.ensureFocusKey(), '')
  assert.equal(await storage.ensureFocusKeyAsync(), '')
  assert.equal(mock.storage.has('focus:key:v1'), false)

  globalThis.wx.getRandomValues = (option) => {
    if (typeof option.fail === 'function') {
      option.fail()
    }
  }
  assert.equal(await storage.ensureFocusKeyAsync(), '')
  assert.equal(mock.storage.has('focus:key:v1'), false)
})

test('session：保存 / 读取 / 签名 / 字段白名单', async () => {
  installWxMock()
  const { storage, fsm, crypto } = await loadLibs()
  const value = createSession(fsm)
  assert.equal(storage.saveFocusSession(value, KEY), true)
  const loaded = storage.loadFocusSession(KEY)
  assert.equal(loaded.reason, 'ok')
  assert.ok(loaded.session)
  assert.equal(loaded.session.id, 'session-1')
  assert.equal(loaded.session.tag, '深度工作')
  assert.equal(loaded.session.phaseEndsAt, NOW + FOCUS)
  assert.equal(loaded.session.lastHeartbeatAt, NOW)
  assert.ok(crypto.verifySessionSignature(loaded.session, KEY))

  const raw = globalThis.wx.getStorageSync('focus:session:v1')
  globalThis.wx.setStorageSync('focus:session:v1', { ...raw, extra: 'strip-me' })
  const stripped = storage.loadFocusSession(KEY)
  assert.equal(stripped.reason, 'ok')
  assert.equal('extra' in stripped.session, false)
})

test('session：损坏 JSON / 版本 / fsm / phase 超限 / remaining 越界', async () => {
  installWxMock()
  const { storage, fsm } = await loadLibs()
  const valid = createSession(fsm)
  assert.equal(storage.saveFocusSession(valid, KEY), true)

  globalThis.wx.setStorageSync('focus:session:v1', '{bad')
  assert.deepEqual(storage.loadFocusSession(KEY), { session: null, reason: 'corrupt' })

  globalThis.wx.setStorageSync('focus:session:v1', { ...valid, version: 2 })
  assert.deepEqual(storage.loadFocusSession(KEY), { session: null, reason: 'corrupt' })

  globalThis.wx.setStorageSync('focus:session:v1', { ...valid, fsm: 'idle' })
  assert.deepEqual(storage.loadFocusSession(KEY), { session: null, reason: 'corrupt' })

  globalThis.wx.setStorageSync('focus:session:v1', {
    ...valid,
    phaseTotalMs: 7 * HOUR,
    phaseEndsAt: valid.phaseStartedAt + 7 * HOUR,
  })
  assert.deepEqual(storage.loadFocusSession(KEY), { session: null, reason: 'corrupt' })

  globalThis.wx.setStorageSync('focus:session:v1', {
    ...valid,
    fsm: 'paused',
    phaseTotalMs: FOCUS,
    phaseEndsAt: valid.phaseStartedAt + FOCUS,
    remainingMs: FOCUS + 1,
  })
  assert.deepEqual(storage.loadFocusSession(KEY), { session: null, reason: 'corrupt' })
})

test('session：6h 只校验 phase，不误杀 10 小时前的长暂停', async () => {
  installWxMock()
  const { storage, fsm } = await loadLibs()
  const oldStart = NOW - 10 * HOUR
  const value = fsm.createFocusSession({
    id: 'old-paused',
    tag: '深度工作',
    audio: AUDIO,
    stats: { completedCount: 2, continuousFocusMs: 50 * MIN },
    now: oldStart,
  })
  const paused = fsm.pauseFocusSession(value, oldStart + 10 * MIN)
  assert.equal(storage.saveFocusSession(paused, KEY), true)
  const loaded = storage.loadFocusSession(KEY)
  assert.equal(loaded.reason, 'ok')
  assert.equal(loaded.session.fsm, 'paused')
  assert.equal(loaded.session.startedAt, oldStart)
})

test('session：overheat 缺 lockUntil / 签名篡改 / keyLost', async () => {
  installWxMock()
  const { storage, fsm } = await loadLibs()
  const value = createSession(fsm, {
    stats: { completedCount: 1, continuousFocusMs: 100 * MIN },
  })
  const overheat = fsm.completeFocusSession(value, NOW + FOCUS).session
  assert.equal(storage.saveFocusSession(overheat, KEY), true)
  const rawOverheat = globalThis.wx.getStorageSync('focus:session:v1')
  delete rawOverheat.lockUntil
  globalThis.wx.setStorageSync('focus:session:v1', rawOverheat)
  assert.deepEqual(storage.loadFocusSession(KEY), { session: null, reason: 'corrupt' })

  assert.equal(storage.saveFocusSession(overheat, KEY), true)
  const tampered = globalThis.wx.getStorageSync('focus:session:v1')
  tampered.breaches = 99
  globalThis.wx.setStorageSync('focus:session:v1', tampered)
  assert.deepEqual(storage.loadFocusSession(KEY), { session: null, reason: 'signature' })

  assert.equal(storage.saveFocusSession(overheat, KEY), true)
  globalThis.wx.removeStorageSync('focus:key:v1')
  assert.deepEqual(storage.loadFocusSession(''), { session: null, reason: 'keyLost' })
})

test('session：写入失败返回 false，重试成功；idle 只删 session', async () => {
  const mock = installWxMock()
  const { storage, fsm } = await loadLibs()
  const value = createSession(fsm)
  mock.fail.add('focus:session:v1')
  assert.equal(storage.saveFocusSession(value, KEY), false)
  assert.deepEqual(storage.loadFocusSession(KEY), { session: null, reason: 'none' })
  mock.fail.delete('focus:session:v1')
  assert.equal(storage.saveFocusSession(value, KEY), true)
  assert.equal(storage.loadFocusSession(KEY).reason, 'ok')

  const stats = storage.createEmptyFocusStats(NOW, KEY)
  assert.ok(stats)
  assert.equal(storage.saveFocusStats(stats, KEY), true)
  assert.equal(storage.clearFocusSession(), true)
  assert.deepEqual(storage.loadFocusSession(KEY), { session: null, reason: 'none' })
  assert.equal(storage.loadFocusStats(KEY).stats.completedCount, 0)
})

test('ledger：50 条上限、最新在前、按 id 幂等', async () => {
  installWxMock()
  const { storage } = await loadLibs()
  for (let index = 0; index <= 50; index += 1) {
    const record = createRecord(storage, KEY, index)
    assert.ok(record)
    assert.equal(storage.appendFocusRecord(record).ok, true)
  }
  const loaded = storage.loadFocusLedger(KEY)
  assert.equal(loaded.entries.length, 50)
  assert.equal(loaded.corruptCount, 0)
  assert.equal(loaded.entries[0].record.id, 'rec-s-50')
  assert.equal(loaded.entries[49].record.id, 'rec-s-1')
  assert.ok(loaded.entries.every((entry) => entry.verified))

  const duplicate = storage.appendFocusRecord(createRecord(storage, KEY, 50))
  assert.equal(duplicate.duplicate, true)
  assert.equal(duplicate.records.length, 50)
})

test('ledger：损坏项跳过、tainted 保留展示、keyLost 三态', async () => {
  installWxMock()
  const { storage } = await loadLibs()
  const valid = createRecord(storage, KEY, 3)
  const tainted = createRecord(storage, KEY, 4)
  tainted.breaches = 99
  globalThis.wx.setStorageSync('focus:ledger:v1', [valid, tainted, { bad: true }])
  const loaded = storage.loadFocusLedger(KEY)
  assert.equal(loaded.entries.length, 2)
  assert.equal(loaded.corruptCount, 1)
  const verified = loaded.entries.find((entry) => entry.record.id === 'rec-s-3')
  const taintedEntry = loaded.entries.find((entry) => entry.record.id === 'rec-s-4')
  assert.equal(verified.verified, true)
  assert.equal(taintedEntry.verified, false)
  assert.equal(taintedEntry.reason, 'signature')

  const keyLost = storage.loadFocusLedger('')
  assert.equal(keyLost.keyLost, true)
  assert.ok(keyLost.entries.every((entry) => entry.reason === 'keyLost'))

  globalThis.wx.setStorageSync('focus:ledger:v1', '{bad')
  const corrupt = storage.loadFocusLedger(KEY)
  assert.equal(corrupt.entries.length, 0)
  assert.equal(corrupt.corruptCount, 1)
})

test('record：id / 稳定 seed / 签名 / 非法输入', async () => {
  installWxMock()
  const { storage, crypto } = await loadLibs()
  const input = {
    sessionId: 'session-1',
    tag: '深度工作',
    startedAt: NOW - FOCUS,
    endedAt: NOW,
    focusedMs: FOCUS,
    breaches: 2,
    level: 99,
    confidence: 'low',
  }
  const first = storage.buildFocusRecord(input, KEY)
  const second = storage.buildFocusRecord(input, KEY)
  assert.ok(first)
  assert.ok(second)
  assert.equal(first.id, 'rec-session-1')
  assert.equal(first.seed, second.seed)
  assert.equal(first.level, 6)
  assert.equal(first.confidence, 'low')
  assert.ok(crypto.verifyRecord(first, KEY).verified)

  const later = storage.buildFocusRecord({ ...input, endedAt: NOW + 1 }, KEY)
  assert.notEqual(later.seed, first.seed)

  assert.equal(
    storage.buildFocusRecord({ ...input, endedAt: NOW - HOUR }, KEY),
    null,
  )

  const unsigned = storage.buildFocusRecord(input, '')
  assert.equal(unsigned.signature, '')
  assert.equal(crypto.verifyRecord(unsigned, '').reason, 'keyLost')
})

test('stats：空统计签名 / 保存读取 / 篡改 / 损坏 / 白名单', async () => {
  installWxMock()
  const { storage, crypto } = await loadLibs()
  const empty = storage.createEmptyFocusStats(NOW, KEY)
  assert.ok(empty)
  assert.equal(storage.saveFocusStats(empty, KEY), true)
  const loaded = storage.loadFocusStats(KEY)
  assert.equal(loaded.reason, 'ok')
  assert.equal(loaded.tainted, false)
  assert.equal(loaded.stats.completedCount, 0)
  assert.equal(loaded.stats.todayDate, '2026-11-08')
  assert.ok(crypto.verifyStatsSignature(loaded.stats, KEY))

  const raw = globalThis.wx.getStorageSync('focus:stats:v1')
  globalThis.wx.setStorageSync('focus:stats:v1', { ...raw, totalFocusMs: 123456, extra: 1 })
  const tampered = storage.loadFocusStats(KEY)
  assert.equal(tampered.reason, 'signature')
  assert.equal(tampered.tainted, true)
  assert.equal(tampered.stats.totalFocusMs, 123456)
  assert.equal('extra' in tampered.stats, false)

  globalThis.wx.setStorageSync('focus:stats:v1', '{bad')
  assert.deepEqual(storage.loadFocusStats(KEY), {
    stats: null,
    reason: 'corrupt',
    tainted: false,
  })

  globalThis.wx.removeStorageSync('focus:stats:v1')
  assert.deepEqual(storage.loadFocusStats(KEY), {
    stats: null,
    reason: 'none',
    tainted: false,
  })
})

test('settle：首次结算写入 ledger + stats，重复 record.id 不重复计数', async () => {
  installWxMock()
  const { storage } = await loadLibs()
  const key = storage.ensureFocusKey(new Uint8Array(32).fill(7))
  const stats = storage.createEmptyFocusStats(NOW, key)
  const record = createRecord(storage, key, 0)
  const first = storage.settleFocusRecord(record, {
    keyHex: key,
    stats,
    continuousFocusMs: FOCUS,
    now: NOW,
  })
  assert.equal(first.ok, true)
  assert.equal(first.applied, true)
  assert.equal(first.stats.completedCount, 1)
  assert.equal(first.stats.totalFocusMs, FOCUS)
  assert.equal(first.stats.lastAppliedRecordId, 'rec-s-0')
  assert.equal(first.records.length, 1)

  const persisted = storage.loadFocusStats(key)
  assert.equal(persisted.reason, 'ok')
  assert.equal(persisted.stats.completedCount, 1)
  assert.equal(storage.loadFocusLedger(key).entries.length, 1)

  const again = storage.settleFocusRecord(record, {
    keyHex: key,
    stats: persisted.stats,
    continuousFocusMs: FOCUS,
    now: NOW,
  })
  assert.equal(again.ok, true)
  assert.equal(again.applied, false)
  assert.equal(again.stats.completedCount, 1)
  assert.equal(again.records.length, 1)
})

test('settle：ledger 写失败不更新 stats；重试后只计一次', async () => {
  const mock = installWxMock()
  const { storage } = await loadLibs()
  const key = storage.ensureFocusKey(new Uint8Array(32).fill(7))
  const stats = storage.createEmptyFocusStats(NOW, key)
  const record = createRecord(storage, key, 0)

  mock.fail.add('focus:ledger:v1')
  const failed = storage.settleFocusRecord(record, {
    keyHex: key,
    stats,
    continuousFocusMs: FOCUS,
    now: NOW,
  })
  assert.equal(failed.ok, false)
  assert.equal(failed.applied, false)
  assert.equal(failed.stats.completedCount, 0)
  assert.equal(storage.loadFocusStats(key).reason, 'none')

  mock.fail.delete('focus:ledger:v1')
  const retried = storage.settleFocusRecord(record, {
    keyHex: key,
    stats,
    continuousFocusMs: FOCUS,
    now: NOW,
  })
  assert.equal(retried.ok, true)
  assert.equal(retried.applied, true)
  assert.equal(storage.loadFocusStats(key).stats.completedCount, 1)
  assert.equal(storage.loadFocusLedger(key).entries.length, 1)
})

test('settle：stats 写失败保留 ledger，重试不重复', async () => {
  const mock = installWxMock()
  const { storage } = await loadLibs()
  const key = storage.ensureFocusKey(new Uint8Array(32).fill(7))
  const stats = storage.createEmptyFocusStats(NOW, key)
  const record = createRecord(storage, key, 0)

  mock.fail.add('focus:stats:v1')
  const failed = storage.settleFocusRecord(record, {
    keyHex: key,
    stats,
    continuousFocusMs: FOCUS,
    now: NOW,
  })
  assert.equal(failed.ok, false)
  assert.equal(failed.applied, false)
  assert.equal(storage.loadFocusStats(key).reason, 'none')
  assert.equal(storage.loadFocusLedger(key).entries.length, 1)

  mock.fail.delete('focus:stats:v1')
  const retried = storage.settleFocusRecord(record, {
    keyHex: key,
    stats,
    continuousFocusMs: FOCUS,
    now: NOW,
  })
  assert.equal(retried.ok, true)
  assert.equal(retried.applied, true)
  assert.equal(storage.loadFocusStats(key).stats.completedCount, 1)
  assert.equal(storage.loadFocusLedger(key).entries.length, 1)
})

test('settle：tainted / keyLost 只写 ledger，不加 stats', async () => {
  installWxMock()
  const { storage } = await loadLibs()
  const stats = storage.createEmptyFocusStats(NOW, KEY)
  const record = createRecord(storage, KEY, 0)
  record.breaches = 99
  const tainted = storage.settleFocusRecord(record, {
    keyHex: KEY,
    stats,
    continuousFocusMs: FOCUS,
    now: NOW,
  })
  assert.equal(tainted.ok, false)
  assert.equal(tainted.applied, false)
  assert.equal(tainted.reason, 'signature')
  assert.equal(tainted.stats.completedCount, 0)
  assert.equal(storage.loadFocusLedger(KEY).entries.length, 1)

  const valid = createRecord(storage, KEY, 1)
  const keyLost = storage.settleFocusRecord(valid, {
    keyHex: '',
    stats,
    continuousFocusMs: FOCUS,
    now: NOW,
  })
  assert.equal(keyLost.ok, false)
  assert.equal(keyLost.applied, false)
  assert.equal(keyLost.reason, 'keyLost')
  assert.equal(keyLost.stats.completedCount, 0)
})

test('亮度：owned 标记 / 越界拒绝 / 损坏 null / 清除', async () => {
  installWxMock()
  const { storage } = await loadLibs()
  assert.equal(storage.saveFocusBrightness(0.3), true)
  assert.deepEqual(storage.loadFocusBrightness(), {
    version: 1,
    original: 0.3,
    owned: true,
  })
  assert.equal(storage.saveFocusBrightness(-0.1), false)
  assert.equal(storage.saveFocusBrightness(1.1), false)
  assert.equal(storage.saveFocusBrightness(Number.NaN), false)

  globalThis.wx.setStorageSync('focus:brightness:v1', '{bad')
  assert.equal(storage.loadFocusBrightness(), null)
  globalThis.wx.setStorageSync('focus:brightness:v1', { version: 2, original: 0.5, owned: true })
  assert.equal(storage.loadFocusBrightness(), null)

  assert.equal(storage.clearFocusBrightness(), true)
  assert.equal(storage.loadFocusBrightness(), null)
})

test('清空专注数据：6 个 key 全部删除，stats / ledger 归零', async () => {
  const mock = installWxMock()
  const { storage, fsm } = await loadLibs()
  const key = storage.ensureFocusKey(new Uint8Array(32).fill(7))
  const session = createSession(fsm, { id: 'clear-me' })
  storage.saveFocusSession(session, key)
  storage.saveFocusPrefs(storage.defaultFocusPrefs())
  const stats = storage.createEmptyFocusStats(NOW, key)
  storage.saveFocusStats(stats, key)
  storage.appendFocusRecord(createRecord(storage, key, 0))
  storage.saveFocusBrightness(0.4)

  assert.equal(mock.storage.size, 6)
  assert.equal(storage.clearFocusData(), 6)
  assert.equal(mock.storage.size, 0)
  assert.deepEqual(storage.loadFocusSession(key), { session: null, reason: 'none' })
  assert.equal(storage.loadFocusStats(key).reason, 'none')
  assert.equal(storage.loadFocusLedger(key).entries.length, 0)
  assert.equal(storage.readFocusKey(), '')
  assert.equal(storage.loadFocusBrightness(), null)
})
