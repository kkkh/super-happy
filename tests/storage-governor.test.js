/* ==========================================================================
   storage-governor · 存储治理单元测试
   - 缓存大小：KB / MB / 0 / 异常占位
   - 自动清理：7 天 / 30 天 / 永不三档与真实 tbx 存储联动
   - 幂等：重复清理不重复写、不误删收藏
   - 运行：npm test
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

async function loadGovernor() {
  return import(moduleUrl('core/services/storage-governor.ts'))
}

async function loadToolbox() {
  return import(moduleUrl('core/toolbox/store.ts'))
}

async function loadPreference() {
  return import(moduleUrl('core/stores/preference.ts'))
}

function installStorageMock(seed = {}) {
  const values = { ...seed }
  const writes = []
  globalThis.wx = {
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
    getStorageInfoSync() {
      return { currentSize: 18, keys: ['tbx:recent', 'tbx:favorites'] }
    },
    getDeviceInfo() {
      return { platform: 'node' }
    },
    getSystemInfoSync() {
      return { platform: 'node' }
    },
  }
  return { values, writes }
}

function resetToolbox(store) {
  store.inited = false
  store.recents = []
  store.recentAt = {}
}

test('缓存统计：KB / MB / 0 / 异常全部可读', async () => {
  const { readCacheSummary } = await loadGovernor()
  installStorageMock()

  try {
    globalThis.wx.getStorageInfoSync = () => ({ currentSize: 512, keys: ['a', 'b'] })
    const kb = readCacheSummary()
    assert.equal(kb.text, '512 KB')
    assert.equal(kb.detail, '2 个本机键 · 仅存 id 与偏好')

    globalThis.wx.getStorageInfoSync = () => ({ currentSize: 2048, keys: ['a'] })
    assert.equal(readCacheSummary().text, '2.0 MB')

    globalThis.wx.getStorageInfoSync = () => ({ currentSize: 0, keys: [] })
    assert.equal(readCacheSummary().text, '0 KB')

    globalThis.wx.getStorageInfoSync = () => {
      throw new Error('storage unavailable')
    }
    const broken = readCacheSummary()
    assert.equal(broken.text, '—')
    assert.equal(broken.detail, '存储信息暂不可用')
  } finally {
    delete globalThis.wx
  }
})

test('自动清理：7 天阈值真实裁剪 tbx:recent 与时间戳', async () => {
  const governor = await loadGovernor()
  const { toolboxStore } = await loadToolbox()
  const { preferenceStore } = await loadPreference()

  const now = new Date('2026-11-06T12:00:00+08:00').getTime()
  const day = 24 * 60 * 60 * 1000
  const seed = {
    'tbx:favorites': ['unit'],
    'tbx:recent': ['unit', 'tax', 'qr'],
    'tbx:recent.at': {
      unit: now - 2 * day,
      tax: now - 18 * day,
      qr: now - 45 * day,
    },
  }
  const mock = installStorageMock(seed)
  resetToolbox(toolboxStore)
  preferenceStore.autoCleanDays = 7

  try {
    toolboxStore.init()
    assert.deepEqual(toolboxStore.recents, ['unit', 'tax', 'qr'])

    const removed = governor.applyAutoClean(now)
    assert.equal(removed, 2)
    assert.deepEqual(toolboxStore.recents, ['unit'])
    assert.deepEqual(toolboxStore.recentAt, { unit: now - 2 * day })

    const recentWrite = mock.writes.find((item) => item.key === 'tbx:recent')
    assert.ok(recentWrite)
    assert.deepEqual(recentWrite.value, ['unit'])

    const timeWrite = mock.writes.find((item) => item.key === 'tbx:recent.at')
    assert.ok(timeWrite)
    assert.deepEqual(timeWrite.value, { unit: now - 2 * day })

    /* 幂等：第二次不再产生删除与写入 */
    const writeCount = mock.writes.length
    assert.equal(governor.applyAutoClean(now), 0)
    assert.equal(mock.writes.length, writeCount)
  } finally {
    resetToolbox(toolboxStore)
    preferenceStore.autoCleanDays = 30
    delete globalThis.wx
  }
})

test('自动清理：30 天保留 18 天记录、永不清理完全不动', async () => {
  const governor = await loadGovernor()
  const { toolboxStore } = await loadToolbox()
  const { preferenceStore } = await loadPreference()

  const now = new Date('2026-11-06T12:00:00+08:00').getTime()
  const day = 24 * 60 * 60 * 1000
  const seed = {
    'tbx:recent': ['unit', 'tax', 'qr'],
    'tbx:recent.at': {
      unit: now - 2 * day,
      tax: now - 18 * day,
      qr: now - 45 * day,
    },
  }
  installStorageMock(seed)
  resetToolbox(toolboxStore)

  try {
    toolboxStore.init()
    preferenceStore.autoCleanDays = 30
    assert.equal(governor.applyAutoClean(now), 1)
    assert.deepEqual(toolboxStore.recents, ['unit', 'tax'])

    resetToolbox(toolboxStore)
    installStorageMock(seed)
    toolboxStore.init()
    preferenceStore.autoCleanDays = 0
    assert.equal(governor.applyAutoClean(now), 0)
    assert.deepEqual(toolboxStore.recents, ['unit', 'tax', 'qr'])
  } finally {
    resetToolbox(toolboxStore)
    preferenceStore.autoCleanDays = 30
    delete globalThis.wx
  }
})

test('自动清理：不触碰收藏键', async () => {
  const governor = await loadGovernor()
  const { toolboxStore } = await loadToolbox()
  const { preferenceStore } = await loadPreference()

  const now = Date.now()
  const seed = {
    'tbx:favorites': ['unit', 'tax'],
    'tbx:recent': ['unit'],
    'tbx:recent.at': { unit: now - 40 * 24 * 60 * 60 * 1000 },
  }
  const mock = installStorageMock(seed)
  resetToolbox(toolboxStore)
  preferenceStore.autoCleanDays = 7

  try {
    toolboxStore.init()
    assert.equal(governor.applyAutoClean(now), 1)
    assert.deepEqual(toolboxStore.favorites, ['unit', 'tax'])
    assert.deepEqual(mock.values['tbx:favorites'], ['unit', 'tax'])
    assert.equal(
      mock.writes.some((item) => item.key === 'tbx:favorites'),
      false,
    )
  } finally {
    resetToolbox(toolboxStore)
    preferenceStore.autoCleanDays = 30
    delete globalThis.wx
  }
})

test('累计打开：recordOpen 持续递增，不受最近列表上限影响', async () => {
  const { toolboxStore } = await loadToolbox()
  const mock = installStorageMock({ 'tbx:usage': 5 })
  resetToolbox(toolboxStore)
  toolboxStore.usageCount = 0

  try {
    toolboxStore.init()
    assert.equal(toolboxStore.usageCount, 5)

    toolboxStore.recordOpen('unit')
    toolboxStore.recordOpen('unit')
    toolboxStore.recordOpen('tax')
    assert.equal(toolboxStore.usageCount, 8)
    assert.equal(mock.values['tbx:usage'], 8)
    assert.deepEqual(toolboxStore.recents, ['tax', 'unit'])

    /* 最近列表已满 / 反复打开同一工具，累计次数仍继续增长 */
    for (let index = 0; index < 20; index += 1) {
      toolboxStore.recordOpen('qr')
    }
    assert.equal(toolboxStore.usageCount, 28)
    assert.equal(mock.values['tbx:usage'], 28)
    assert.equal(toolboxStore.recents[0], 'qr')
    assert.ok(toolboxStore.recents.length <= 12)
  } finally {
    resetToolbox(toolboxStore)
    toolboxStore.usageCount = 0
    delete globalThis.wx
  }
})
