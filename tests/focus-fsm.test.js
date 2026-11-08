/* ==========================================================================
   focus-fsm · 状态机 / 时间戳 / 长短休 / Overheat / 恢复 单元测试
   - 时间戳唯一真相：不做 setInterval 递减
   - 新 session 从 stats 初始化；第 4 轮长休；2h Overheat 优先
   - 运行：npm test
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { registerHooks } = require('node:module')

const ROOT = path.resolve(__dirname, '..')
const NOW = new Date(2026, 10, 8, 12, 0, 0).getTime()
const MIN = 60 * 1000
const FOCUS = 25 * MIN
const SHORT = 5 * MIN
const LONG = 15 * MIN
const LOCK = 30 * MIN
const OVERHEAT = 120 * MIN

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

async function load(relative) {
  return import(pathToFileURL(path.join(ROOT, relative)).href)
}

async function fsm() {
  return load('subpackages/life/lib/focus-fsm.ts')
}

function session(module, overrides = {}) {
  return module.createFocusSession({
    id: 'session-1',
    tag: '深度工作',
    audio: AUDIO,
    stats: { completedCount: 0, continuousFocusMs: 0 },
    now: NOW,
    ...overrides,
  })
}

test('新 session：从 stats 初始化 completedFocus / cycle / continuousFocusMs', async () => {
  const module = await fsm()
  const first = session(module)
  assert.equal(first.fsm, 'focusing')
  assert.equal(first.completedFocus, 0)
  assert.equal(first.cycle, 1)
  assert.equal(first.continuousFocusMs, 0)
  assert.equal(first.phaseTotalMs, FOCUS)
  assert.equal(first.phaseEndsAt, NOW + FOCUS)
  assert.equal(first.lastHeartbeatAt, NOW)
  assert.equal(first.confidence, 'high')

  const fourth = session(module, {
    stats: { completedCount: 3, continuousFocusMs: 90 * MIN },
  })
  assert.equal(fourth.cycle, 4)
  assert.equal(fourth.completedFocus, 3)
  assert.equal(fourth.continuousFocusMs, 90 * MIN)

  const wrapped = session(module, {
    stats: { completedCount: 4, continuousFocusMs: 0 },
  })
  assert.equal(wrapped.cycle, 1)
})

test('时间戳剩余：focusing 由 endsAt 推导，paused 冻结', async () => {
  const module = await fsm()
  const value = session(module)
  assert.equal(module.focusRemainingMs(value, NOW + 10 * MIN), 15 * MIN)

  const paused = module.pauseFocusSession(value, NOW + 10 * MIN)
  assert.equal(paused.fsm, 'paused')
  assert.equal(paused.remainingMs, 15 * MIN)
  assert.equal(module.focusRemainingMs(paused, NOW + 2 * 60 * MIN), 15 * MIN)
})

test('继续：phaseEndsAt 重设且时间戳保持一致，完成仍记 25min', async () => {
  const module = await fsm()
  const value = session(module)
  const paused = module.pauseFocusSession(value, NOW + 10 * MIN)
  const resumedAt = NOW + 2 * 60 * MIN
  const resumed = module.resumeFocusSession(paused, resumedAt)
  assert.equal(resumed.fsm, 'focusing')
  assert.equal(resumed.phaseStartedAt, resumedAt - 10 * MIN)
  assert.equal(resumed.phaseEndsAt, resumedAt + 15 * MIN)
  assert.ok(
    Math.abs(resumed.phaseEndsAt - resumed.phaseStartedAt - resumed.phaseTotalMs) <= 1000,
  )
  assert.equal(module.focusRemainingMs(resumed, resumedAt), 15 * MIN)

  const done = module.completeFocusSession(resumed, resumed.phaseEndsAt)
  assert.ok(done)
  assert.equal(done.record.focusedMs, FOCUS)
  assert.equal(done.record.startedAt, NOW)
  assert.equal(done.record.endedAt, resumed.phaseEndsAt)
  assert.equal(done.record.breaches, 0)
})

test('第 1 轮短休：completedFocus +1、连续专注 +25min、休息 5min', async () => {
  const module = await fsm()
  const value = session(module)
  const done = module.completeFocusSession(value, NOW + FOCUS)
  assert.ok(done)
  assert.equal(done.kind, 'short')
  assert.equal(done.session.fsm, 'breaking')
  assert.equal(done.session.completedFocus, 1)
  assert.equal(done.session.continuousFocusMs, FOCUS)
  assert.equal(done.session.phaseTotalMs, SHORT)
  assert.equal(done.session.phaseEndsAt, NOW + FOCUS + SHORT)
  assert.equal(done.session.lockUntil, undefined)
})

test('第 4 轮长休：15min，完成后连续值由调用方清零', async () => {
  const module = await fsm()
  const value = session(module, {
    stats: { completedCount: 3, continuousFocusMs: 90 * MIN },
  })
  const done = module.completeFocusSession(value, NOW + FOCUS)
  assert.ok(done)
  assert.equal(done.kind, 'long')
  assert.equal(done.session.completedFocus, 4)
  assert.equal(done.session.continuousFocusMs, 115 * MIN)
  assert.equal(done.session.phaseTotalMs, LONG)

  const early = module.finishBreakSession(done.session, done.session.phaseEndsAt - 1)
  assert.equal(early, null)
  const ended = module.finishBreakSession(done.session, done.session.phaseEndsAt)
  assert.deepEqual(ended, { kind: 'long', resetContinuous: true })

  const skipped = module.finishBreakSession(done.session, done.session.phaseStartedAt, true)
  assert.deepEqual(skipped, { kind: 'long', resetContinuous: true })
})

test('Overheat 优先于长休：2h 触发、锁 30min、completedFocus 仍 +1', async () => {
  const module = await fsm()
  const value = session(module, {
    stats: { completedCount: 3, continuousFocusMs: 100 * MIN },
  })
  const done = module.completeFocusSession(value, NOW + FOCUS)
  assert.ok(done)
  assert.equal(done.kind, 'overheat')
  assert.equal(done.session.fsm, 'overheat')
  assert.equal(done.session.completedFocus, 4)
  assert.equal(done.session.continuousFocusMs, 125 * MIN)
  assert.equal(done.session.phaseTotalMs, LOCK)
  assert.equal(done.session.lockUntil, NOW + FOCUS + LOCK)
})

test('Overheat 锁定：到期前不可继续，到期 / 强制返回均清零连续值', async () => {
  const module = await fsm()
  const value = session(module, {
    stats: { completedCount: 1, continuousFocusMs: 100 * MIN },
  })
  const done = module.completeFocusSession(value, NOW + FOCUS)
  assert.ok(done)
  assert.equal(done.session.fsm, 'overheat')
  assert.equal(
    module.finishOverheatSession(done.session, done.session.lockUntil - 1),
    null,
  )
  assert.deepEqual(
    module.finishOverheatSession(done.session, done.session.lockUntil),
    { resetContinuous: true },
  )
  assert.deepEqual(
    module.finishOverheatSession(done.session, done.session.phaseStartedAt, true),
    { resetContinuous: true },
  )
})

test('Glitch：breaches++ 且计时不暂停', async () => {
  const module = await fsm()
  const value = session(module)
  const at = NOW + 5 * MIN
  const glitched = module.markFocusBreach(value, at)
  assert.equal(glitched.fsm, 'focusing')
  assert.equal(glitched.breaches, 1)
  assert.equal(module.focusRemainingMs(glitched, at), FOCUS - 5 * MIN)
  const twice = module.markFocusBreach(glitched, at + MIN)
  assert.equal(twice.breaches, 2)
  assert.equal(module.focusRemainingMs(twice, at + MIN), FOCUS - 6 * MIN)
})

test('心跳：180s 缺失降 low，新心跳恢复 high', async () => {
  const module = await fsm()
  const value = session(module)
  assert.equal(
    module.refreshFocusConfidence(value, NOW + 200 * 1000).confidence,
    'low',
  )
  const beaten = module.markFocusHeartbeat(value, NOW + 200 * 1000)
  assert.equal(beaten.confidence, 'high')
  assert.equal(
    module.refreshFocusConfidence(beaten, NOW + 259 * 1000).confidence,
    'high',
  )

  const noHeartbeat = { ...value, lastHeartbeatAt: undefined }
  assert.equal(
    module.refreshFocusConfidence(noHeartbeat, NOW).confidence,
    'low',
  )
})

test('冷启动恢复：focusing 未来 / 到期自动完成', async () => {
  const module = await fsm()
  const value = session(module)
  const alive = module.restoreFocusSession(value, NOW + 10 * MIN)
  assert.equal(alive.action, 'focusing')
  assert.ok(alive.session)

  const expired = module.restoreFocusSession(value, NOW + FOCUS + 1)
  assert.equal(expired.action, 'complete')
  assert.ok(expired.completion)
  assert.equal(expired.completion.session.fsm, 'breaking')
  assert.equal(expired.session.fsm, 'breaking')
  assert.equal(expired.session.completedFocus, 1)
})

test('冷启动恢复：paused 原样、短休到期 idle、长休到期清零', async () => {
  const module = await fsm()
  const value = session(module)
  const paused = module.pauseFocusSession(value, NOW + 10 * MIN)
  const restored = module.restoreFocusSession(paused, NOW + 2 * 60 * MIN)
  assert.equal(restored.action, 'paused')
  assert.equal(restored.session.remainingMs, 15 * MIN)

  const shortDone = module.completeFocusSession(value, NOW + FOCUS)
  const shortIdle = module.restoreFocusSession(
    shortDone.session,
    shortDone.session.phaseEndsAt,
  )
  assert.equal(shortIdle.action, 'idle')
  assert.equal(shortIdle.session, null)
  assert.equal(shortIdle.resetContinuous, false)

  const longValue = session(module, {
    stats: { completedCount: 3, continuousFocusMs: 90 * MIN },
  })
  const longDone = module.completeFocusSession(longValue, NOW + FOCUS)
  const longIdle = module.restoreFocusSession(
    longDone.session,
    longDone.session.phaseEndsAt,
  )
  assert.equal(longIdle.action, 'idle')
  assert.equal(longIdle.resetContinuous, true)
})

test('冷启动恢复：Overheat 冷却中 / 到期解除', async () => {
  const module = await fsm()
  const value = session(module, {
    stats: { completedCount: 1, continuousFocusMs: 100 * MIN },
  })
  const done = module.completeFocusSession(value, NOW + FOCUS)
  const cooling = module.restoreFocusSession(done.session, done.session.lockUntil - 1)
  assert.equal(cooling.action, 'cooling')
  assert.ok(cooling.session)
  const unlocked = module.restoreFocusSession(done.session, done.session.lockUntil)
  assert.equal(unlocked.action, 'idle')
  assert.equal(unlocked.resetContinuous, true)
})

test('非法转移：paused 不能直接完成，breaking 不能暂停，focusing 不能继续', async () => {
  const module = await fsm()
  const value = session(module)
  const paused = module.pauseFocusSession(value, NOW + 10 * MIN)
  assert.equal(module.completeFocusSession(paused, NOW + 30 * MIN), null)

  const done = module.completeFocusSession(value, NOW + FOCUS)
  assert.ok(done)
  assert.equal(module.pauseFocusSession(done.session, NOW + FOCUS).fsm, 'breaking')

  const noop = module.resumeFocusSession(value, NOW + MIN)
  assert.equal(noop.fsm, 'focusing')
  assert.equal(noop.phaseEndsAt, value.phaseEndsAt)
})
