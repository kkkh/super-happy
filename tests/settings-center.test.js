/* ==========================================================================
   Settings Center · 选项抽屉回归测试
   - 静态断言：选项列表直接渲染在页面内、抽屉使用半屏高度、不再依赖 glass-picker
   - 行为断言：震动 / 清理抽屉都能渲染三项、点击后写 Store、关闭抽屉
   - 联动断言：MobX storeBindings 立即把主页面文案刷新
   - 运行：npm test
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { registerHooks } = require('node:module')

const ROOT = path.resolve(__dirname, '..')
const PAGE_DIR = path.join(ROOT, 'subpackages/grow/pages/settings')
const PAGE_TS = path.join(PAGE_DIR, 'index.ts')
const PAGE_WXML = path.join(PAGE_DIR, 'index.wxml')
const PAGE_JSON = path.join(PAGE_DIR, 'index.json')
const BINDINGS_SHIM = pathToFileURL(
  path.join(__dirname, 'helpers/mobx-bindings-shim.mjs'),
).href

/* mobx-miniprogram-bindings 在模块加载时会调用小程序全局 Behavior/Component */
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
        /* 不是 TS 模块时回退原始路径 */
      }
    }
    return nextResolve(specifier, context)
  },
})

function moduleUrl(relative) {
  return pathToFileURL(path.join(ROOT, relative)).href
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

/* 模拟 wx.nextTick 的异步队列：一次 flush 执行全部待回调 */
let pendingTicks = []

function flushNextTick() {
  const queue = pendingTicks
  pendingTicks = []
  queue.forEach((callback) => callback())
}

function installWxMock(seed = {}) {
  const values = { ...seed }
  const writes = []
  pendingTicks = []
  globalThis.wx = {
    env: { USER_DATA_PATH: '' },
    nextTick(callback) {
      pendingTicks.push(callback)
    },
    vibrateShort() {
      /* 静默 */
    },
    getDeviceInfo() {
      return { platform: 'node' }
    },
    getSystemInfoSync() {
      return { platform: 'node' }
    },
    getWindowInfo() {
      return { statusBarHeight: 20, windowWidth: 375 }
    },
    getMenuButtonBoundingClientRect() {
      return { top: 24, left: 280, bottom: 56 }
    },
    getStorageInfoSync() {
      return { currentSize: 18, keys: ['tbx:recent', 'tbx:favorites'] }
    },
    getStorageSync(key) {
      return key in values ? values[key] : ''
    },
    setStorageSync(key, value) {
      values[key] = value
      writes.push({ key, value })
    },
    removeStorageSync(key) {
      delete values[key]
    },
  }
  return { values, writes }
}

let cachedDefinition = null

async function loadSettingsDefinition() {
  if (cachedDefinition) {
    return cachedDefinition
  }

  installWxMock()
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
    throw new Error('settings page definition was not captured')
  }
  cachedDefinition = definition
  return definition
}

async function loadStores() {
  const preference = await import(moduleUrl('core/stores/preference.ts'))
  const toolbox = await import(moduleUrl('core/toolbox/store.ts'))
  return { preference, toolbox }
}

function createPage(definition) {
  const instance = {
    data: clone(definition.data || {}),
    setData(patch) {
      Object.assign(this.data, clone(patch))
    },
  }

  Object.keys(definition).forEach((key) => {
    if (typeof definition[key] === 'function') {
      instance[key] = definition[key].bind(instance)
    }
  })

  return instance
}

async function bootPage(query) {
  const definition = await loadSettingsDefinition()
  const { preference, toolbox } = await loadStores()

  preference.preferenceStore.inited = false
  preference.preferenceStore.applySnapshot(preference.DEFAULT_PREFERENCE)
  toolbox.toolboxStore.inited = false
  toolbox.toolboxStore.recents = []
  toolbox.toolboxStore.recentAt = {}
  toolbox.toolboxStore.favorites = []

  installWxMock()
  const page = createPage(definition)
  page.onLoad(query)
  /* 刷新 storeBindings 初始值 */
  flushNextTick()
  /* 关闭音效，避免测试触碰音频写入路径 */
  preference.preferenceStore.sound = false
  flushNextTick()

  return { page, preference, toolbox }
}

function cleanup(page, preference, toolbox) {
  if (page && typeof page.onUnload === 'function') {
    page.onUnload()
  }
  preference.preferenceStore.inited = false
  preference.preferenceStore.applySnapshot(preference.DEFAULT_PREFERENCE)
  toolbox.toolboxStore.inited = false
  toolbox.toolboxStore.recents = []
  toolbox.toolboxStore.recentAt = {}
  toolbox.toolboxStore.favorites = []
  delete globalThis.wx
}

function tapOption(value) {
  return {
    currentTarget: {
      dataset: { value },
    },
  }
}

test('静态结构：选项直接渲染在页面内，抽屉使用 half 高度', () => {
  const wxml = fs.readFileSync(PAGE_WXML, 'utf8')
  const json = JSON.parse(fs.readFileSync(PAGE_JSON, 'utf8'))
  const ts = fs.readFileSync(PAGE_TS, 'utf8')

  assert.match(wxml, /<!-- 这里是选项列表的渲染 -->/)
  assert.match(wxml, /wx:for="{{pickerOptions}}"/)
  assert.match(wxml, /data-value="{{item.value}}"/)
  assert.match(wxml, /bindtap="onPickerOptionTap"/)
  assert.match(wxml, /size="half"/)
  assert.doesNotMatch(wxml, /<glass-picker/)
  assert.equal('glass-picker' in (json.usingComponents || {}), false)
  assert.ok(json.usingComponents['glass-bottom-sheet'])

  assert.match(ts, /这里是点击选中后的状态更新与关闭抽屉逻辑/)
  for (const label of ['关闭', '轻震', '重震', '7 天', '30 天', '永不清理']) {
    assert.ok(ts.includes(label), `缺少选项文案：${label}`)
  }
})

test('更新日志 query：进入设置页自动展开并定位版本区块', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { page, preference, toolbox } = await bootPage({ changelog: '1' })

  try {
    assert.equal(page.data.changelogOpen, true)
    assert.equal(page.data.scrollTarget, 'settings-changelog')
  } finally {
    cleanup(page, preference, toolbox)
  }
})

test('震动抽屉：渲染三选项，选中后写 Store、刷新高亮并关闭', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { page, preference, toolbox } = await bootPage()

  try {
    page.onHapticsTap()
    assert.equal(page.data.pickerShow, true)
    assert.deepEqual(
      page.data.pickerOptions.map((option) => option.label),
      ['关闭', '轻震', '重震'],
    )
    assert.equal(page.data.pickerOptions[1].active, true)
    assert.equal(page.pickerKind, 'haptics')

    page.onPickerOptionTap(tapOption('heavy'))
    flushNextTick()

    assert.equal(preference.preferenceStore.haptics, 'heavy')
    assert.equal(preference.preferenceStore.hapticsLabel, '重震')
    /* storeBindings 通过 wx.nextTick 同步刷新主页面文案 */
    assert.equal(page.data.hapticsLabel, '重震')

    assert.equal(page.data.pickerShow, false)
    assert.equal(page.pickerKind, '')
    const active = page.data.pickerOptions.filter((option) => option.active)
    assert.equal(active.length, 1)
    assert.equal(active[0].value, 'heavy')
  } finally {
    cleanup(page, preference, toolbox)
  }
})

test('清理抽屉：渲染三选项，选中后写 Store 并刷新文案', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { page, preference, toolbox } = await bootPage()

  try {
    page.onCleanTap()
    assert.equal(page.data.pickerShow, true)
    assert.deepEqual(
      page.data.pickerOptions.map((option) => option.label),
      ['7 天', '30 天', '永不清理'],
    )
    assert.equal(page.data.pickerOptions[1].active, true)
    assert.equal(page.pickerKind, 'clean')

    page.onPickerOptionTap(tapOption('7'))
    flushNextTick()

    assert.equal(preference.preferenceStore.autoCleanDays, 7)
    assert.equal(preference.preferenceStore.autoCleanLabel, '7 天')
    assert.equal(page.data.autoCleanLabel, '7 天')
    assert.equal(page.data.pickerShow, false)
    assert.equal(page.pickerKind, '')

    const active = page.data.pickerOptions.filter((option) => option.active)
    assert.equal(active.length, 1)
    assert.equal(active[0].value, '7')
  } finally {
    cleanup(page, preference, toolbox)
  }
})

test('非法选项值：不写 Store，也不关闭抽屉', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { page, preference, toolbox } = await bootPage()

  try {
    page.onHapticsTap()
    const before = preference.preferenceStore.haptics

    page.onPickerOptionTap(tapOption('ultra'))

    assert.equal(preference.preferenceStore.haptics, before)
    assert.equal(page.data.pickerShow, true)
    assert.equal(page.pickerKind, 'haptics')
  } finally {
    cleanup(page, preference, toolbox)
  }
})

test('抽屉关闭：onPickerClose 复位状态且不写 Store', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { page, preference, toolbox } = await bootPage()

  try {
    page.onCleanTap()
    const before = preference.preferenceStore.autoCleanDays
    page.onPickerClose()

    assert.equal(page.data.pickerShow, false)
    assert.equal(page.pickerKind, '')
    assert.equal(preference.preferenceStore.autoCleanDays, before)
  } finally {
    cleanup(page, preference, toolbox)
  }
})
