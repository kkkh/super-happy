/* ==========================================================================
   Cockpit Focus Card · 今日 / 连续 / 等级 / 标签 / 记录开关
   - todayDate 非今天 → 今日 0
   - lastCompletedDate 早于昨天 → 连续 0
   - isHistoryTrackingEnabled=false → 隐藏小卡
   - 运行：npm test
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { registerHooks } = require('node:module')

const ROOT = path.resolve(__dirname, '..')
const PAGE_TS = path.join(ROOT, 'subpackages/grow/pages/cockpit/index.ts')
const BINDINGS_SHIM = pathToFileURL(
  path.join(__dirname, 'helpers/mobx-bindings-shim.mjs'),
).href

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

function dateKey(timestamp) {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function shiftDate(days) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return dateKey(date.getTime())
}

function installWx(seed = {}) {
  const values = new Map(Object.entries(seed))
  globalThis.wx = {
    env: { USER_DATA_PATH: '' },
    getDeviceInfo() {
      return { platform: 'node' }
    },
    getSystemInfoSync() {
      return { platform: 'node' }
    },
    getWindowInfo() {
      return { pixelRatio: 2, windowWidth: 375, windowHeight: 667 }
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
  }
  return values
}

let cachedPage = null

async function loadPageDefinition() {
  if (cachedPage) {
    return cachedPage
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
    throw new Error('cockpit page definition was not captured')
  }
  cachedPage = definition
  return definition
}

function createPage(definition) {
  const instance = {
    data: JSON.parse(JSON.stringify(definition.data || {})),
    setData(patch) {
      Object.assign(this.data, patch)
    },
  }
  for (const key of Object.keys(definition)) {
    if (typeof definition[key] === 'function') {
      instance[key] = definition[key].bind(instance)
    }
  }
  return instance
}

async function loadPreference() {
  const module = await import(
    pathToFileURL(path.join(ROOT, 'core/stores/preference.ts')).href
  )
  return module.preferenceStore
}

function focusStats(overrides = {}) {
  return {
    version: 1,
    totalFocusMs: 50 * 60 * 1000,
    completedCount: 2,
    level: 1,
    streakDays: 0,
    lastCompletedDate: '',
    todayDate: '',
    todayFocusMs: 0,
    continuousFocusMs: 0,
    lastAppliedRecordId: '',
    updatedAt: Date.now(),
    signature: '',
    ...overrides,
  }
}

test('专注小卡：今日分钟 / 累计完成 / 连续天数 / 等级 / 隐私标签', async () => {
  const definition = await loadPageDefinition()
  const preference = await loadPreference()
  preference.isHistoryTrackingEnabled = true
  const today = dateKey(Date.now())
  installWx({
    'focus:stats:v1': focusStats({
      completedCount: 3,
      level: 2,
      streakDays: 2,
      todayDate: today,
      todayFocusMs: 25 * 60 * 1000,
      lastCompletedDate: today,
    }),
    'focus:ledger:v1': [
      {
        version: 1,
        id: 'rec-focus-1',
        tag: '深度工作',
        startedAt: Date.now() - 25 * 60 * 1000,
        endedAt: Date.now(),
        focusedMs: 25 * 60 * 1000,
        breaches: 1,
        seed: 1,
        level: 2,
        confidence: 'high',
        signature: 'x',
      },
    ],
  })

  const page = createPage(definition)
  page.refreshFocusCard()
  assert.equal(page.data.focusCardVisible, true)
  assert.equal(page.data.focusHasData, true)
  assert.equal(page.data.focusTodayMinutes, 25)
  assert.equal(page.data.focusCompleted, 3)
  assert.equal(page.data.focusStreak, 2)
  assert.equal(page.data.focusLevelLabel, 'Lv.2 渐入佳境')
  assert.equal(page.data.focusRecentTag, '已脱敏')

  page.setData({ masked: false })
  page.refreshFocusCard()
  assert.equal(page.data.focusRecentTag, '深度工作')
})

test('专注小卡：todayDate 过期今日归零；连续断档归零', async () => {
  const definition = await loadPageDefinition()
  const preference = await loadPreference()
  preference.isHistoryTrackingEnabled = true
  installWx({
    'focus:stats:v1': focusStats({
      completedCount: 9,
      level: 3,
      streakDays: 8,
      todayDate: shiftDate(-1),
      todayFocusMs: 40 * 60 * 1000,
      lastCompletedDate: shiftDate(-3),
    }),
  })
  const page = createPage(definition)
  page.refreshFocusCard()
  assert.equal(page.data.focusTodayMinutes, 0)
  assert.equal(page.data.focusCompleted, 9)
  assert.equal(page.data.focusStreak, 0)
  assert.equal(page.data.focusLevelLabel, 'Lv.3 稳定心流')
})

test('专注小卡：昨天完成仍显示连续；空态不虚构数据', async () => {
  const definition = await loadPageDefinition()
  const preference = await loadPreference()
  preference.isHistoryTrackingEnabled = true
  installWx({
    'focus:stats:v1': focusStats({
      completedCount: 1,
      level: 1,
      streakDays: 4,
      todayDate: shiftDate(-1),
      todayFocusMs: 25 * 60 * 1000,
      lastCompletedDate: shiftDate(-1),
    }),
  })
  const page = createPage(definition)
  page.refreshFocusCard()
  assert.equal(page.data.focusStreak, 4)
  assert.equal(page.data.focusTodayMinutes, 0)

  installWx()
  page.refreshFocusCard()
  assert.equal(page.data.focusHasData, false)
  assert.equal(page.data.focusTodayMinutes, 0)
  assert.equal(page.data.focusCompleted, 0)
  assert.equal(page.data.focusStreak, 0)
  assert.equal(page.data.focusLevelLabel, 'Lv.1 初识心流')
})

test('专注小卡：关闭计算轨迹开关后整卡隐藏', async () => {
  const definition = await loadPageDefinition()
  const preference = await loadPreference()
  const page = createPage(definition)
  preference.isHistoryTrackingEnabled = false
  page.refreshFocusCard()
  assert.equal(page.data.focusCardVisible, false)

  preference.isHistoryTrackingEnabled = true
  page.refreshFocusCard()
  assert.equal(page.data.focusCardVisible, true)
  preference.isHistoryTrackingEnabled = true
})
