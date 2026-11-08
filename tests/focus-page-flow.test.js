/* ==========================================================================
   Focus Page Flow · 页面编排集成测试
   - onLoad → boot 生成 key/stats → 开始专注
   - 25min 到期 → record 结算 → 战报 → 完成 → 短休 → 跳过 → idle
   - 设置页外部清空 → onShow 重新 bootstrap 回 idle
   - 运行：npm test
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { registerHooks } = require('node:module')

const ROOT = path.resolve(__dirname, '..')
const PAGE_TS = path.join(ROOT, 'subpackages/life/pages/focus/index.ts')
const BINDINGS_SHIM = pathToFileURL(
  path.join(__dirname, 'helpers/mobx-bindings-simple-shim.mjs'),
).href
const FOCUS = 25 * 60 * 1000
const KEY = '07'.repeat(32)

globalThis.Behavior = (config) => config
globalThis.Component = (config) => config

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier === 'mobx-miniprogram-bindings' &&
      !String(context.parentURL || '').includes('mobx-bindings-shim')
    ) {
      return { url: BINDINGS_SHIM, shortCircuit: true }
    }
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

function wait(ms = 20) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createCanvas() {
  const ctx = {
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineCap: '',
    scale() {},
    clearRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    stroke() {},
    fill() {},
    createLinearGradient() {
      return { addColorStop() {} }
    },
    createRadialGradient() {
      return { addColorStop() {} }
    },
  }
  const node = {
    width: 0,
    height: 0,
    getContext() {
      return ctx
    },
    requestAnimationFrame(callback) {
      return setTimeout(() => callback(Date.now()), 30)
    },
    cancelAnimationFrame(handle) {
      clearTimeout(handle)
    },
  }
  return node
}

function installWx(seed = {}) {
  const values = new Map(Object.entries(seed))
  const node = createCanvas()
  const toasts = []
  globalThis.wx = {
    env: { USER_DATA_PATH: '/tmp' },
    nextTick(callback) {
      callback()
    },
    getDeviceInfo() {
      return { platform: 'node' }
    },
    getSystemInfoSync() {
      return { platform: 'node' }
    },
    getWindowInfo() {
      return {
        pixelRatio: 2,
        windowWidth: 375,
        windowHeight: 667,
        statusBarHeight: 20,
      }
    },
    getStorageSync(key) {
      return values.has(key) ? values.get(key) : ''
    },
    setStorageSync(key, value) {
      values.set(key, value)
    },
    removeStorageSync(key) {
      values.delete(key)
    },
    getRandomValues(option) {
      option.success({ randomValues: new Uint8Array(32).fill(7) })
    },
    getScreenBrightness(option) {
      option.success({ value: 0.8 })
    },
    setScreenBrightness(option) {
      option.complete?.()
    },
    setKeepScreenOn() {},
    enableAlertBeforeUnload() {},
    disableAlertBeforeUnload() {},
    navigateBack() {},
    reLaunch() {},
    canvasToTempFilePath(option) {
      option.success({ tempFilePath: '/tmp/focus-nebula.png' })
    },
    createSelectorQuery() {
      const query = {
        select() {
          return query
        },
        fields() {
          return query
        },
        exec(callback) {
          setTimeout(() => {
            callback([{ node, width: 260, height: 260 }])
          }, 0)
        },
      }
      return query
    },
    showToast(option) {
      toasts.push(option)
    },
  }
  return { values, node, toasts }
}

let cachedDefinition = null

async function loadPageDefinition() {
  if (cachedDefinition) {
    return cachedDefinition
  }
  installWx()
  let definition = null
  const previousPage = globalThis.Page
  globalThis.Page = (config) => {
    definition = config
  }
  try {
    await import(pathToFileURL(PAGE_TS).href)
  } finally {
    globalThis.Page = previousPage
  }
  if (!definition) {
    throw new Error('focus page definition was not captured')
  }
  cachedDefinition = definition
  return definition
}

function createPage(definition) {
  const instance = {
    data: JSON.parse(JSON.stringify(definition.data || {})),
    setData(patch, callback) {
      Object.assign(this.data, patch)
      if (typeof callback === 'function') {
        callback()
      }
    },
    createSelectorQuery() {
      return globalThis.wx.createSelectorQuery()
    },
    selectComponent() {
      return null
    },
  }
  for (const key of Object.keys(definition)) {
    if (typeof definition[key] === 'function') {
      instance[key] = definition[key].bind(instance)
    }
  }
  return instance
}

async function bootPage(seed = {}) {
  const definition = await loadPageDefinition()
  const preference = await import(
    pathToFileURL(path.join(ROOT, 'core/stores/preference.ts')).href
  )
  /* 静音：避免测试留下 2.2s Toast 定时器，也避免真实 WebAudio 路径 */
  preference.preferenceStore.sound = false
  installWx(seed)
  const page = createPage(definition)
  page.onLoad()
  for (let index = 0; index < 8 && !page.data.ready; index += 1) {
    await wait(10)
  }
  assert.equal(page.data.ready, true, 'focus page boot 未完成')
  return page
}

test('完整一轮：开始 → 到期结算 → 战报 → 完成 → 跳过短休 → idle', async () => {
  const page = await bootPage()
  try {
    page.openSetup()
    page.setData({ tagDraft: '写代码' })
    page.onStartFocus()
    await wait(10)

    assert.equal(page.data.fsmView, 'focusing')
    assert.equal(page.session.fsm, 'focusing')
    assert.equal(page.session.tag, '写代码')
    assert.equal(page.data.primaryLabel, '暂停')
    assert.equal(page.data.secondaryLabel, '放弃')
    assert.equal(globalThis.wx.getStorageSync('focus:session:v1').fsm, 'focusing')

    const now = Date.now()
    page.session.startedAt = now - FOCUS
    page.session.phaseStartedAt = now - FOCUS
    page.session.phaseEndsAt = now
    page.session.phaseTotalMs = FOCUS
    page.tick()
    await wait(40)

    assert.equal(page.data.reportOpen, true)
    assert.equal(page.data.reportMinutes, 25)
    assert.equal(page.data.reportBreaches, 0)
    assert.equal(page.data.reportLevel, 1)
    assert.ok(page.data.reportLevelLabel.includes('初识心流'))
    assert.ok(page.data.nebulaPath)
    assert.equal(page.session.fsm, 'breaking')
    assert.equal(page.data.fsmView, 'report')
    assert.equal(page.data.guardBlocked, true)

    const stats = globalThis.wx.getStorageSync('focus:stats:v1')
    assert.equal(stats.completedCount, 1)
    assert.equal(stats.todayFocusMs, FOCUS)
    assert.equal(stats.lastAppliedRecordId, `rec-${page.session.id}`)
    const ledger = globalThis.wx.getStorageSync('focus:ledger:v1')
    assert.equal(ledger.length, 1)
    assert.equal(ledger[0].focusedMs, FOCUS)

    page.closeReport()
    await wait(10)
    assert.equal(page.data.reportOpen, false)
    assert.equal(page.data.fsmView, 'breaking')
    assert.ok(page.data.clock.startsWith('05:0'))
    assert.equal(page.data.guardBlocked, true)

    page.onPrimaryTap()
    assert.equal(page.data.modalShow, true)
    page.onModalConfirm()
    assert.equal(page.data.modalShow, false)
    assert.equal(page.session, null)
    assert.equal(page.data.fsmView, 'idle')
    assert.equal(page.data.guardBlocked, false)
    assert.equal(globalThis.wx.getStorageSync('focus:session:v1'), '')
  } finally {
    page.onUnload()
  }
})

test('暂停 / 继续：剩余时间冻结与恢复后仍可完成', async () => {
  const page = await bootPage()
  try {
    page.onStartFocus()
    await wait(5)
    const before = page.session.phaseEndsAt
    page.pauseFocus()
    assert.equal(page.data.fsmView, 'paused')
    assert.equal(page.session.fsm, 'paused')
    assert.ok(page.session.remainingMs > 0)
    assert.equal(page.session.remainingMs < FOCUS, true)

    page.resumeFocus()
    assert.equal(page.data.fsmView, 'focusing')
    assert.equal(page.session.fsm, 'focusing')
    assert.ok(page.session.phaseEndsAt >= before - 1000)
    assert.equal(
      Math.abs(
        page.session.phaseEndsAt -
          page.session.phaseStartedAt -
          page.session.phaseTotalMs,
      ) <= 1000,
      true,
    )
  } finally {
    page.onUnload()
  }
})

test('preparing 取消：不产生 session，回到 idle', async () => {
  const page = await bootPage()
  try {
    page.openSetup()
    assert.equal(page.data.setupOpen, true)
    assert.equal(page.data.fsmView, 'preparing')
    assert.equal(page.session, null)
    assert.equal(globalThis.wx.getStorageSync('focus:session:v1'), '')

    page.onSetupClose()
    assert.equal(page.data.setupOpen, false)
    assert.equal(page.data.fsmView, 'idle')
    assert.equal(page.session, null)
  } finally {
    page.onUnload()
  }
})

test('外部清空 focus:*：onShow 重新 bootstrap，旧会话不复活', async () => {
  const page = await bootPage()
  try {
    page.onStartFocus()
    await wait(5)
    assert.equal(page.data.fsmView, 'focusing')

    for (const key of [
      'focus:session:v1',
      'focus:prefs:v1',
      'focus:key:v1',
      'focus:ledger:v1',
      'focus:stats:v1',
      'focus:brightness:v1',
    ]) {
      globalThis.wx.removeStorageSync(key)
    }
    page.onShow()
    for (let index = 0; index < 8 && !page.data.ready; index += 1) {
      await wait(10)
    }
    assert.equal(page.data.ready, true)
    assert.equal(page.session, null)
    assert.equal(page.data.fsmView, 'idle')
    assert.equal(globalThis.wx.getStorageSync('focus:key:v1'), KEY)
  } finally {
    page.onUnload()
  }
})

test('keyLost：有账本/统计但 key 缺失时冻结，不生成新 key', async () => {
  const stats = {
    version: 1,
    totalFocusMs: 100 * 60 * 1000,
    completedCount: 4,
    level: 2,
    streakDays: 1,
    lastCompletedDate: '2026-11-08',
    todayDate: '2026-11-08',
    todayFocusMs: 25 * 60 * 1000,
    continuousFocusMs: 0,
    lastAppliedRecordId: 'rec-old',
    updatedAt: Date.now(),
    signature: 'old-signature',
  }
  const page = await bootPage({ 'focus:stats:v1': stats })
  try {
    assert.equal(page.data.evidenceBroken, true)
    assert.equal(page.data.primaryDisabled, true)
    assert.equal(globalThis.wx.getStorageSync('focus:key:v1'), '')
    assert.equal(page.session, null)
    assert.equal(page.data.fsmView, 'idle')
    assert.ok(page.data.statusSub.includes('无法验证'))
  } finally {
    page.onUnload()
  }
})
