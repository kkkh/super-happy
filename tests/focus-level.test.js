/* ==========================================================================
   focus-level · 等级 / 累计 / 连续天数 单元测试
   - L1–L6 阈值边界
   - verified 才计数；tainted 不加等级；keyLost 冻结
   - 今日跨天重置、连续天数规则、时钟异常
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
const HOUR = 60 * 60 * 1000
const FOCUS = 25 * 60 * 1000
const NOW = new Date(2026, 10, 8, 12, 0, 0).getTime()
const TODAY = '2026-11-08'

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

function moduleUrl(relative) {
  return pathToFileURL(path.join(ROOT, relative)).href
}

async function load(relative) {
  return import(moduleUrl(relative))
}

function record(overrides = {}) {
  return {
    version: 1,
    id: 'rec-session-1',
    tag: '深度工作',
    startedAt: NOW - FOCUS,
    endedAt: NOW,
    focusedMs: FOCUS,
    breaches: 0,
    seed: 123456,
    level: 1,
    confidence: 'high',
    signature: 'x',
    ...overrides,
  }
}

function check(value, overrides = {}) {
  return {
    record: value,
    verified: true,
    tainted: false,
    reason: 'ok',
    ...overrides,
  }
}

test('等级阈值：L1–L6 边界与异常输入', async () => {
  const level = await load('subpackages/life/lib/focus-level.ts')
  assert.equal(level.levelFromFocusMs(0), 1)
  assert.equal(level.levelFromFocusMs(2 * HOUR - 1), 1)
  assert.equal(level.levelFromFocusMs(2 * HOUR), 2)
  assert.equal(level.levelFromFocusMs(8 * HOUR - 1), 2)
  assert.equal(level.levelFromFocusMs(8 * HOUR), 3)
  assert.equal(level.levelFromFocusMs(20 * HOUR), 4)
  assert.equal(level.levelFromFocusMs(50 * HOUR), 5)
  assert.equal(level.levelFromFocusMs(100 * HOUR), 6)
  assert.equal(level.levelFromFocusMs(200 * HOUR), 6)
  assert.equal(level.levelFromFocusMs(-1), 1)
  assert.equal(level.levelFromFocusMs(Number.NaN), 1)
})

test('等级文案与下一级门槛', async () => {
  const level = await load('subpackages/life/lib/focus-level.ts')
  assert.equal(level.LEVEL_LABELS.length, 6)
  assert.equal(level.levelLabel(1), '初识心流')
  assert.equal(level.levelLabel(3), '稳定心流')
  assert.equal(level.levelLabel(6), '心流传奇')
  assert.equal(level.levelLabel(99), '心流传奇')
  assert.equal(level.nextLevelAt(1), 2 * HOUR)
  assert.equal(level.nextLevelAt(5), 100 * HOUR)
  assert.equal(level.nextLevelAt(6), null)
})

test('空 stats：签名有效、今日日期正确、等级 L1', async () => {
  const level = await load('subpackages/life/lib/focus-level.ts')
  const crypto = await load('subpackages/life/lib/focus-crypto.ts')
  const stats = level.createEmptyFocusStats(NOW, KEY)
  assert.equal(stats.totalFocusMs, 0)
  assert.equal(stats.completedCount, 0)
  assert.equal(stats.level, 1)
  assert.equal(stats.streakDays, 0)
  assert.equal(stats.todayDate, TODAY)
  assert.equal(stats.todayFocusMs, 0)
  assert.equal(stats.lastAppliedRecordId, '')
  assert.ok(crypto.verifyStatsSignature(stats, KEY))
})

test('verified 记录：累加终身 / 今日 / 完成数 / 连续 / 连续专注', async () => {
  const level = await load('subpackages/life/lib/focus-level.ts')
  const crypto = await load('subpackages/life/lib/focus-crypto.ts')
  const stats = level.createEmptyFocusStats(NOW, KEY)
  const result = level.applyFocusRecordToStats(stats, check(record()), {
    now: NOW,
    keyHex: KEY,
    continuousFocusMs: FOCUS,
  })
  assert.equal(result.applied, true)
  assert.equal(result.reason, 'ok')
  assert.equal(result.stats.totalFocusMs, FOCUS)
  assert.equal(result.stats.completedCount, 1)
  assert.equal(result.stats.todayFocusMs, FOCUS)
  assert.equal(result.stats.streakDays, 1)
  assert.equal(result.stats.lastCompletedDate, TODAY)
  assert.equal(result.stats.continuousFocusMs, FOCUS)
  assert.equal(result.stats.lastAppliedRecordId, 'rec-session-1')
  assert.equal(result.stats.level, 1)
  assert.ok(crypto.verifyStatsSignature(result.stats, KEY))
})

test('同一 record.id 重复结算：lastAppliedRecordId 防重复', async () => {
  const level = await load('subpackages/life/lib/focus-level.ts')
  const stats = level.createEmptyFocusStats(NOW, KEY)
  const first = level.applyFocusRecordToStats(stats, check(record()), {
    now: NOW,
    keyHex: KEY,
  })
  const second = level.applyFocusRecordToStats(first.stats, check(record()), {
    now: NOW,
    keyHex: KEY,
  })
  assert.equal(second.applied, false)
  assert.equal(second.reason, 'ok')
  assert.equal(second.stats.completedCount, 1)
  assert.equal(second.stats.totalFocusMs, FOCUS)
})

test('同日第二条：连续天数不变，今日继续累加', async () => {
  const level = await load('subpackages/life/lib/focus-level.ts')
  const stats = level.createEmptyFocusStats(NOW, KEY)
  const first = level.applyFocusRecordToStats(stats, check(record()), {
    now: NOW,
    keyHex: KEY,
  })
  const secondRecord = record({
    id: 'rec-session-2',
    startedAt: NOW,
    endedAt: NOW + HOUR,
  })
  const second = level.applyFocusRecordToStats(first.stats, check(secondRecord), {
    now: NOW + HOUR,
    keyHex: KEY,
  })
  assert.equal(second.applied, true)
  assert.equal(second.stats.completedCount, 2)
  assert.equal(second.stats.streakDays, 1)
  assert.equal(second.stats.todayFocusMs, FOCUS * 2)
})

test('连续天数：昨天 +1，中间断档回到 1', async () => {
  const level = await load('subpackages/life/lib/focus-level.ts')
  const base = level.createEmptyFocusStats(NOW, KEY)
  const yesterday = level.applyFocusRecordToStats(
    {
      ...base,
      streakDays: 3,
      lastCompletedDate: '2026-11-07',
    },
    check(record()),
    { now: NOW, keyHex: KEY },
  )
  assert.equal(yesterday.stats.streakDays, 4)

  const gap = level.applyFocusRecordToStats(
    {
      ...base,
      streakDays: 9,
      lastCompletedDate: '2026-11-05',
    },
    check(record({ id: 'rec-gap' })),
    { now: NOW, keyHex: KEY },
  )
  assert.equal(gap.stats.streakDays, 1)
})

test('跨天结算：todayFocusMs 重置为本次专注，不累加昨天', async () => {
  const level = await load('subpackages/life/lib/focus-level.ts')
  const base = level.createEmptyFocusStats(NOW, KEY)
  const result = level.applyFocusRecordToStats(
    {
      ...base,
      todayDate: '2026-11-07',
      todayFocusMs: 30 * 60 * 1000,
    },
    check(record()),
    { now: NOW, keyHex: KEY },
  )
  assert.equal(result.stats.todayDate, TODAY)
  assert.equal(result.stats.todayFocusMs, FOCUS)
})

test('tainted / keyLost：不改 stats、不加等级', async () => {
  const level = await load('subpackages/life/lib/focus-level.ts')
  const base = level.createEmptyFocusStats(NOW, KEY)
  const high = {
    ...base,
    totalFocusMs: 7 * HOUR + 59 * 60 * 1000,
    level: 2,
  }
  const tainted = level.applyFocusRecordToStats(
    high,
    check(record(), { verified: false, tainted: true, reason: 'signature' }),
    { now: NOW, keyHex: KEY },
  )
  assert.equal(tainted.applied, false)
  assert.equal(tainted.reason, 'signature')
  assert.equal(tainted.stats.totalFocusMs, high.totalFocusMs)
  assert.equal(tainted.stats.level, 2)

  const keyLost = level.applyFocusRecordToStats(base, check(record()), {
    now: NOW,
    keyHex: 'not-a-key',
  })
  assert.equal(keyLost.applied, false)
  assert.equal(keyLost.reason, 'keyLost')
  assert.equal(keyLost.stats.completedCount, 0)
})

test('等级跃迁：7h59m + 25min 跨过 8h → L3', async () => {
  const level = await load('subpackages/life/lib/focus-level.ts')
  const base = level.createEmptyFocusStats(NOW, KEY)
  const near = {
    ...base,
    totalFocusMs: 7 * HOUR + 59 * 60 * 1000,
    level: 2,
    completedCount: 19,
  }
  const result = level.applyFocusRecordToStats(near, check(record()), {
    now: NOW,
    keyHex: KEY,
  })
  assert.equal(result.stats.totalFocusMs, 8 * HOUR + 24 * 60 * 1000)
  assert.equal(result.stats.level, 3)
})

test('异常记录：时钟回拨 / 时长超跨度 / 超 6h / 空 id 全部拒绝', async () => {
  const level = await load('subpackages/life/lib/focus-level.ts')
  const base = level.createEmptyFocusStats(NOW, KEY)
  const clock = level.applyFocusRecordToStats(
    base,
    check(record({ startedAt: NOW, endedAt: NOW - 1000 })),
    { now: NOW, keyHex: KEY },
  )
  assert.equal(clock.applied, false)
  assert.equal(clock.reason, 'clock')

  const span = level.applyFocusRecordToStats(
    base,
    check(record({ startedAt: NOW - 60 * 1000, endedAt: NOW, focusedMs: FOCUS })),
    { now: NOW, keyHex: KEY },
  )
  assert.equal(span.applied, false)
  assert.equal(span.reason, 'clock')

  const tooLong = level.applyFocusRecordToStats(
    base,
    check(record({ focusedMs: 6 * HOUR + 1, startedAt: NOW - 7 * HOUR })),
    { now: NOW, keyHex: KEY },
  )
  assert.equal(tooLong.applied, false)
  assert.equal(tooLong.reason, 'corrupt')

  const noId = level.applyFocusRecordToStats(
    base,
    check(record({ id: '' })),
    { now: NOW, keyHex: KEY },
  )
  assert.equal(noId.applied, false)
  assert.equal(noId.reason, 'corrupt')
})
