/* ==========================================================================
   批 2 · 会议倒计时（meeting-timer）
   - 引擎：剩余计算、跨日、后台恢复、归零、卸载清理
   - 契约：页面 / 注册 / 帮助 / jump 无注入 / 论据来源 / 包体清单
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { registerHooks } = require('node:module')

const ROOT = path.resolve(__dirname, '..')
const URL_ROOT = `${require('node:url').pathToFileURL(ROOT).href}/`
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !path.extname(specifier)) {
      return nextResolve(`${specifier}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})

async function loadTimer() {
  return import(`${URL_ROOT}subpackages/tools-daily/lib/timer.ts`)
}

test('倒计时：剩余时间由截止时间戳推导，格式化向上取整', async () => {
  const timer = await loadTimer()
  const now = new Date(2026, 10, 10, 10, 0, 0).getTime()
  const plan = timer.planDuration(5, now)
  assert.ok(plan)
  assert.equal(plan.deadline, now + 300_000)
  assert.equal(timer.remainingMs(now + 61_000, plan.deadline), 239_000)
  assert.equal(timer.formatRemaining(239_000), '03:59')
  assert.equal(timer.formatRemaining(300_000), '05:00')
  assert.equal(timer.formatRemaining(999), '00:01')
  assert.equal(timer.formatRemaining(0), '00:00')
  assert.equal(timer.formatRemaining(3_600_000), '60:00')
})

test('倒计时：结束时间点早于当前顺延次日', async () => {
  const timer = await loadTimer()
  const now = new Date(2026, 10, 10, 22, 30, 0).getTime()
  const next = timer.planDeadline('09:00', now)
  assert.ok(next)
  assert.equal(next.nextDay, true)
  assert.equal(next.totalMs, 37_800_000)
  const tomorrow = new Date(2026, 10, 11, 9, 0, 0).getTime()
  assert.equal(next.deadline, tomorrow)

  const sameDay = timer.planDeadline('23:00', now)
  assert.ok(sameDay)
  assert.equal(sameDay.nextDay, false)
  assert.equal(sameDay.totalMs, 1_800_000)
})

test('倒计时：切后台再回来按截止时间补算，进度同步', async () => {
  const timer = await loadTimer()
  const startedAt = new Date(2026, 10, 10, 9, 0, 0).getTime()
  const plan = timer.planDuration(10, startedAt)
  assert.ok(plan)
  const hideAt = startedAt + 180_000
  const showAt = startedAt + 420_000
  assert.equal(timer.remainingMs(hideAt, plan.deadline), 420_000)
  assert.equal(timer.remainingMs(showAt, plan.deadline), 180_000)
  assert.equal(timer.formatRemaining(180_000), '03:00')
  assert.equal(timer.timerProgress(180_000, plan.totalMs), 70)
})

test('倒计时：时长 / 结束时间边界与归零', async () => {
  const timer = await loadTimer()
  const now = new Date(2026, 10, 10, 10, 0, 0).getTime()
  assert.equal(timer.planDuration(0, now), null)
  assert.equal(timer.planDuration(-5, now), null)
  assert.equal(timer.planDuration(1441, now), null)
  assert.equal(timer.planDuration(1.5, now), null)
  assert.ok(timer.planDuration(1440, now))
  assert.equal(timer.planDeadline('24:00', now), null)
  assert.equal(timer.planDeadline('09:60', now), null)
  assert.equal(timer.planDeadline('', now), null)

  assert.equal(timer.remainingMs(now, now), 0)
  assert.equal(timer.remainingMs(now, now - 1), 0)
  assert.equal(timer.timerProgress(0, 600_000), 100)
  assert.equal(timer.timerProgress(600_000, 600_000), 0)
  assert.equal(timer.timerProgress(0, 0), 0)
})

test('倒计时：页面卸载释放画布，计时交给全局服务', () => {
  const ts = read('subpackages/tools-daily/pages/meeting-timer/index.ts')
  assert.match(ts, /onUnload\s*\(\)/)
  assert.match(ts, /state\.canvas = null/)
  assert.match(ts, /state\.ctx = null/)
  assert.match(ts, /subscribeMeetingTimer/)
  assert.match(ts, /onTogglePause/)
  assert.match(ts, /pauseMeetingTimer/)
  assert.match(ts, /resumeMeetingTimer/)
  assert.match(ts, /resetMeetingTimer/)
  assert.equal(/requestSubscribeMessage/.test(ts), false, '不得申请订阅消息')
  assert.equal(/wx\.request|uploadFile|downloadFile/.test(ts), false, '不得联网')

  const service = read('core/services/meetingTimer.ts')
  assert.match(service, /MEETING_TIMER_WARN_MS = 5000/)
  assert.match(service, /vibrate\('heavy'\)/)
  assert.match(service, /clearInterval/)
  assert.match(service, /syncMeetingTimer/)
  assert.match(read('app.ts'), /suspendMeetingTimer/)
})

test('倒计时契约：页面 / 注册 / 帮助 / jump 无注入 / 包体清单', async () => {
  const app = JSON.parse(read('app.json'))
  const daily = app.subpackages.find((item) => item.root === 'subpackages/tools-daily')
  assert.ok(daily.pages.includes('pages/meeting-timer/index'), 'app.json 未注册页面')

  for (const ext of ['.ts', '.json', '.wxml', '.wxss']) {
    assert.ok(
      fs.existsSync(path.join(ROOT, `subpackages/tools-daily/pages/meeting-timer/index${ext}`)),
      `缺少页面文件 ${ext}`,
    )
  }

  const wxml = read('subpackages/tools-daily/pages/meeting-timer/index.wxml')
  assert.match(wxml, /tool-id="meeting-timer"/)
  assert.match(wxml, /bind:run="onRun"/)
  assert.match(wxml, /id="timer-ring"/)
  assert.match(wxml, /type="2d"/)
  assert.match(wxml, /bindtap="onCopy"/)
  assert.match(wxml, /bind:tap="onTogglePause"/)
  assert.match(wxml, /bind:tap="onReset"/)
  assert.match(wxml, /timer-status--/)
  assert.match(wxml, /不发送订阅消息/)

  const ts = read('subpackages/tools-daily/pages/meeting-timer/index.ts')
  assert.match(ts, /onShareAppMessage\s*\(/)
  assert.match(ts, /onShareTimeline\s*\(/)
  assert.match(ts, /meetingTimerStore/)
  assert.match(ts, /ensureCanvas/)

  for (const ext of ['.ts', '.json', '.wxml', '.wxss']) {
    assert.ok(
      fs.existsSync(path.join(ROOT, `components/meeting-timer-hud/index${ext}`)),
      `缺少 HUD 组件 ${ext}`,
    )
  }
  const hudWxml = read('components/meeting-timer-hud/index.wxml')
  assert.match(hudWxml, /onTouchStart/)
  assert.match(hudWxml, /catchtouchmove="onTouchMove"/)
  assert.match(hudWxml, /onTouchEnd/)
  assert.match(hudWxml, /可拖动/)
  const hudTs = read('components/meeting-timer-hud/index.ts')
  assert.match(hudTs, /savedLeft/)
  assert.match(hudTs, /readStoredPosition/)
  assert.match(hudTs, /writeStoredPosition/)
  assert.match(hudTs, /getStorageSync/)
  assert.match(hudTs, /setStorageSync/)
  assert.match(hudTs, /safeBottom/)
  assert.match(hudTs, /defaultLeft = EDGE_PAD \+ 8/)
  assert.match(read('core/constants/index.ts'), /meetingTimerHud: 'toolbox:meeting-timer\.hud\.v1'/)
  assert.match(read('app.json'), /"meeting-timer-hud"/)
  assert.match(read('components/glass-tool-shell/index.wxml'), /<meeting-timer-hud/)
  assert.match(read('components/g-navbar/index.wxml'), /<meeting-timer-hud/)
  assert.match(read('pages/index/index.wxml'), /<meeting-timer-hud/)
  assert.match(read('pages/favorites/index.wxml'), /<meeting-timer-hud/)
  assert.match(read('pages/mine/index.wxml'), /<meeting-timer-hud/)

  const registry = read('core/toolbox/registry.ts')
  assert.match(registry, /id: 'meeting-timer'/)
  assert.match(registry, /weight: 73/)
  assert.match(read('subpackages/grow/lib/help.ts'), /'meeting-timer': \{/)
  assert.match(read('scripts/check-budget.js'), /pages\/meeting-timer/)
  assert.match(read('scripts/e2e-tools.js'), /id: 'meeting-timer'/)

  const config = await import(`${URL_ROOT}core/workflow/workflowConfig.ts`)
  assert.equal(config.WORKFLOW_ROUTING['meeting-timer'], 'jump')
  assert.deepEqual(config.WORKFLOW_ACCEPTS['meeting-timer'], [])

  const source = await import(`${URL_ROOT}core/workflow/workflowSource.ts`)
  assert.deepEqual(source.WORKFLOW_SOURCE_KEYS['meeting-timer'].text, ['timerText'])

  const adapters = await import(`${URL_ROOT}core/workflow/workflowAdapters.ts`)
  assert.ok(adapters.getWorkflowAdapter('meeting-timer'), '缺少 meeting-timer 适配器')
})
