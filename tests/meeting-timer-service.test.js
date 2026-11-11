/* ==========================================================================
   会议倒计时全局服务 · 状态机与跨页面能力
   - 开始 / 暂停 / 继续 / 重置
   - 结束时间点次日标记、订阅快照、到期补算
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { registerHooks } = require('node:module')

const ROOT = path.resolve(__dirname, '..')
const URL_ROOT = `${require('node:url').pathToFileURL(ROOT).href}/`

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !path.extname(specifier)) {
      return nextResolve(`${specifier}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})

function installWx() {
  const calls = { vibrate: 0 }
  global.wx = {
    vibrateShort() {
      calls.vibrate += 1
    },
  }
  return calls
}

async function loadService() {
  const service = await import(`${URL_ROOT}core/services/meetingTimer.ts`)
  const preference = await import(`${URL_ROOT}core/stores/preference.ts`)
  return { service, preference }
}

test('倒计时服务：开始 / 暂停 / 继续 / 重置', async () => {
  installWx()
  const { service } = await loadService()
  const store = service.meetingTimerStore
  service.resetMeetingTimer()

  const now = Date.now()
  const plan = service.startMeetingTimer(5, now)
  assert.ok(plan)
  assert.equal(plan.deadline, now + 300_000)
  assert.equal(store.phase, 'running')
  assert.equal(store.totalMs, 300_000)
  assert.equal(store.deadlineLabel, '现在起 5 分钟')

  assert.equal(service.pauseMeetingTimer(), true)
  assert.equal(store.phase, 'paused')
  const paused = store.remainingMs
  assert.ok(paused > 295_000 && paused <= 300_000, `暂停剩余异常: ${paused}`)

  assert.equal(service.resumeMeetingTimer(), true)
  assert.equal(store.phase, 'running')
  assert.ok(store.deadline >= Date.now() + paused - 1000)
  assert.equal(service.pauseMeetingTimer(), true)
  assert.equal(service.pauseMeetingTimer(), false, '暂停中不能重复暂停')

  service.resetMeetingTimer()
  assert.equal(store.phase, 'idle')
  assert.equal(store.totalMs, 0)
  assert.equal(store.remainingMs, 0)
  assert.equal(store.deadlineLabel, '')
})

test('倒计时服务：结束时间点早于当前标记次日', async () => {
  installWx()
  const { service } = await loadService()
  service.resetMeetingTimer()
  const now = new Date(2026, 10, 10, 22, 30, 0).getTime()
  const plan = service.startMeetingTimerAt('09:00', now)
  assert.ok(plan)
  assert.equal(plan.nextDay, true)
  assert.equal(service.meetingTimerStore.nextDay, true)
  assert.equal(service.meetingTimerStore.deadlineLabel, '次日 09:00')
  assert.equal(service.meetingTimerStore.totalText, '10 小时 30 分钟')
  service.resetMeetingTimer()
})

test('倒计时服务：订阅快照与取消订阅', async () => {
  installWx()
  const { service } = await loadService()
  service.resetMeetingTimer()
  const snapshots = []
  const unsubscribe = service.subscribeMeetingTimer((snapshot) => {
    snapshots.push(snapshot.phase)
  })
  assert.ok(snapshots.length >= 1)
  service.startMeetingTimer(5)
  assert.ok(snapshots.includes('running'))
  service.pauseMeetingTimer()
  assert.equal(snapshots[snapshots.length - 1], 'paused')

  const before = snapshots.length
  unsubscribe()
  service.resetMeetingTimer()
  assert.equal(snapshots.length, before, '取消订阅后不再收到快照')
})

test('倒计时服务：回前台按截止时间补算并结束', async () => {
  const calls = installWx()
  const { service, preference } = await loadService()
  preference.preferenceStore.sound = false
  service.resetMeetingTimer()
  service.startMeetingTimer(1)
  service.meetingTimerStore.deadline = Date.now() - 1
  service.syncMeetingTimer()
  assert.equal(service.meetingTimerStore.phase, 'finished')
  assert.equal(service.meetingTimerStore.remainingMs, 0)
  assert.ok(calls.vibrate >= 1, '结束时必须震动')
  service.resetMeetingTimer()
})
