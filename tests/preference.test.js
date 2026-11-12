/* ==========================================================================
   全局偏好 + 最近使用保留策略 · 单元测试
   - 覆盖损坏 Storage、非法枚举、旧版字段迁移、Feature Flag 白名单
   - 覆盖 7 / 30 / 永不 三档裁剪与缺失时间戳兜底
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

async function loadPreference() {
  return import(moduleUrl('core/stores/preference.ts'))
}

async function loadRetention() {
  return import(moduleUrl('core/toolbox/retention.ts'))
}

/** 安装可读写的 Storage mock；返回写入记录用于断言迁移落盘 */
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
    getDeviceInfo() {
      return { platform: 'node' }
    },
    getSystemInfoSync() {
      return { platform: 'node' }
    },
  }
  return { values, writes }
}

function resetPreference(store, defaults) {
  store.inited = false
  store.applySnapshot(defaults)
}

test('偏好归一化：非对象输入全部回退默认值', async () => {
  const { DEFAULT_PREFERENCE, normalizePreference } = await loadPreference()

  for (const raw of [undefined, null, 0, 123, true, 'oops', [], ['unit']]) {
    assert.deepEqual(normalizePreference(raw), DEFAULT_PREFERENCE)
  }
})

test('偏好归一化：合法字段完整映射', async () => {
  const { normalizePreference } = await loadPreference()

  const snapshot = normalizePreference({
    haptics: 'heavy',
    sound: false,
    lightEffects: false,
    motion: 'saver',
    autoCleanDays: 0,
    favoriteSort: 'category',
    flags: { enable_ai_assist: true },
  })

  assert.deepEqual(snapshot, {
    version: 1,
    haptics: 'heavy',
    sound: false,
    lightEffects: false,
    motion: 'saver',
    autoCleanDays: 0,
    isPrivacyMasked: true,
    isHistoryTrackingEnabled: true,
    fontScale: 'standard',
    favoriteSort: 'category',
    flags: { enable_ai_assist: true },
  })
})

test('偏好归一化：非法枚举与类型逐项回退', async () => {
  const { normalizePreference, DEFAULT_PREFERENCE } = await loadPreference()

  const snapshot = normalizePreference({
    haptics: 'ultra',
    sound: 'maybe',
    lightEffects: 2,
    motion: 'turbo',
    autoCleanDays: 15,
  })

  assert.equal(snapshot.haptics, DEFAULT_PREFERENCE.haptics)
  assert.equal(snapshot.sound, DEFAULT_PREFERENCE.sound)
  assert.equal(snapshot.lightEffects, DEFAULT_PREFERENCE.lightEffects)
  assert.equal(snapshot.motion, DEFAULT_PREFERENCE.motion)
  assert.equal(snapshot.autoCleanDays, DEFAULT_PREFERENCE.autoCleanDays)
  assert.equal(snapshot.fontScale, DEFAULT_PREFERENCE.fontScale)
})

test('隐私盾偏好：默认开启，非法值回退，切换后持久化可恢复', async () => {
  const {
    normalizePreference,
    DEFAULT_PREFERENCE,
    preferenceStore,
  } = await loadPreference()

  assert.equal(DEFAULT_PREFERENCE.isPrivacyMasked, true)
  assert.equal(normalizePreference({ isPrivacyMasked: 'maybe' }).isPrivacyMasked, true)
  assert.equal(normalizePreference({ isPrivacyMasked: 'false' }).isPrivacyMasked, false)
  assert.equal(normalizePreference({ privacyMasked: false }).isPrivacyMasked, false)

  resetPreference(preferenceStore, DEFAULT_PREFERENCE)
  const mock = installStorageMock()

  try {
    const written = preferenceStore.setPrivacyMasked(false)
    assert.equal(written, true)
    assert.equal(preferenceStore.isPrivacyMasked, false)
    const record = mock.writes.find((item) => item.key === 'app:prefs.v1')
    assert.ok(record, '切换隐私盾必须写入 v1 偏好')
    assert.equal(record.value.isPrivacyMasked, false)

    /* 模拟下次进入驾驶舱：重新初始化后沿用关闭状态 */
    preferenceStore.inited = false
    preferenceStore.applySnapshot(DEFAULT_PREFERENCE)
    preferenceStore.init()
    assert.equal(preferenceStore.isPrivacyMasked, false)
  } finally {
    delete globalThis.wx
    resetPreference(preferenceStore, DEFAULT_PREFERENCE)
  }
})

test('轨迹记录偏好：默认开启，关闭后持久化，非法值回退', async () => {
  const { normalizePreference, DEFAULT_PREFERENCE, preferenceStore } = await loadPreference()

  assert.equal(DEFAULT_PREFERENCE.isHistoryTrackingEnabled, true)
  assert.equal(
    normalizePreference({ isHistoryTrackingEnabled: 'false' }).isHistoryTrackingEnabled,
    false,
  )
  assert.equal(
    normalizePreference({ isHistoryTrackingEnabled: 'maybe' }).isHistoryTrackingEnabled,
    true,
  )

  resetPreference(preferenceStore, DEFAULT_PREFERENCE)
  const mock = installStorageMock()

  try {
    const written = preferenceStore.setHistoryTrackingEnabled(false)
    assert.equal(written, true)
    assert.equal(preferenceStore.isHistoryTrackingEnabled, false)
    const record = mock.writes.find((item) => item.key === 'app:prefs.v1')
    assert.ok(record, '暂停轨迹记录必须写入 v1 偏好')
    assert.equal(record.value.isHistoryTrackingEnabled, false)

    preferenceStore.inited = false
    preferenceStore.applySnapshot(DEFAULT_PREFERENCE)
    preferenceStore.init()
    assert.equal(preferenceStore.isHistoryTrackingEnabled, false)
  } finally {
    delete globalThis.wx
    resetPreference(preferenceStore, DEFAULT_PREFERENCE)
  }
})

test('偏好归一化：兼容 v0 的 vibrate / reduceMotion / autoClearDays', async () => {
  const { normalizePreference } = await loadPreference()

  const snapshot = normalizePreference({
    vibrate: false,
    soundEnabled: false,
    reduceMotion: true,
    autoClearDays: 7,
  })

  assert.equal(snapshot.haptics, 'off')
  assert.equal(snapshot.sound, false)
  assert.equal(snapshot.motion, 'lite')
  assert.equal(snapshot.autoCleanDays, 7)
})

test('偏好归一化：布尔 / 数字 / 中文旧值也能收敛', async () => {
  const { normalizePreference } = await loadPreference()

  assert.equal(normalizePreference({ haptics: true }).haptics, 'light')
  assert.equal(normalizePreference({ haptics: 2 }).haptics, 'heavy')
  assert.equal(normalizePreference({ haptics: '重震' }).haptics, 'heavy')
  assert.equal(normalizePreference({ motion: 2 }).motion, 'saver')
  assert.equal(normalizePreference({ motion: '精简' }).motion, 'lite')
  assert.equal(normalizePreference({ autoClearDays: 'never' }).autoCleanDays, 0)
  assert.equal(normalizePreference({ autoCleanDays: '7' }).autoCleanDays, 7)
})

test('Feature Flag 白名单：未知键不会注入运行时', async () => {
  const { normalizePreference } = await loadPreference()

  const snapshot = normalizePreference({
    flags: {
      enable_ai_assist: true,
      evil_flag: true,
    },
    evil_top_level: true,
  })

  assert.deepEqual(snapshot.flags, { enable_ai_assist: true })
  assert.equal('evil_flag' in snapshot.flags, false)
  assert.equal('evil_top_level' in snapshot.flags, false)
})

test('偏好解析：JSON 字符串可用，损坏内容回退默认值', async () => {
  const { parsePreference, DEFAULT_PREFERENCE } = await loadPreference()

  assert.deepEqual(parsePreference('{"haptics":"off","sound":false}'), {
    ...DEFAULT_PREFERENCE,
    haptics: 'off',
    sound: false,
  })

  for (const raw of ['{', 'null', '[]', '123', 'true']) {
    assert.deepEqual(parsePreference(raw), DEFAULT_PREFERENCE)
  }
})

test('偏好解析：fallback 不会被原地修改', async () => {
  const { parsePreference, DEFAULT_PREFERENCE } = await loadPreference()

  const snapshot = parsePreference(
    { haptics: 'heavy' },
    { ...DEFAULT_PREFERENCE, flags: { enable_ai_assist: false } },
  )
  snapshot.flags.enable_ai_assist = true

  assert.equal(DEFAULT_PREFERENCE.flags.enable_ai_assist, false)
})

test('最近使用裁剪：7 天 / 30 天 / 永不三档', async () => {
  const { pruneRecentIds } = await loadRetention()
  const now = new Date('2026-11-06T12:00:00+08:00').getTime()
  const day = 24 * 60 * 60 * 1000
  const ids = ['unit', 'tax', 'qr']
  const recentAt = {
    unit: now - 2 * day,
    tax: now - 18 * day,
    qr: now - 45 * day,
  }

  const seven = pruneRecentIds(ids, recentAt, 7, now)
  assert.deepEqual(seven.ids, ['unit'])
  assert.deepEqual(seven.removed, ['tax', 'qr'])
  assert.deepEqual(seven.recentAt, { unit: recentAt.unit })

  const thirty = pruneRecentIds(ids, recentAt, 30, now)
  assert.deepEqual(thirty.ids, ['unit', 'tax'])
  assert.deepEqual(thirty.removed, ['qr'])

  const never = pruneRecentIds(ids, recentAt, 0, now)
  assert.deepEqual(never.ids, ids)
  assert.deepEqual(never.removed, [])
  assert.deepEqual(never.recentAt, recentAt)
})

test('最近使用裁剪：缺失时间戳按 now 保留，旧记录升级不误删', async () => {
  const { pruneRecentIds } = await loadRetention()
  const now = Date.now()
  const result = pruneRecentIds(['unit', 'tax'], { unit: now - 100 * 1000 }, 7, now)

  assert.deepEqual(result.ids, ['unit', 'tax'])
  assert.deepEqual(result.removed, [])
  assert.equal(result.recentAt.tax, now)
  assert.equal(result.recentAt.unit, now - 100 * 1000)
})

test('最近使用裁剪：非法 id 与负阈值安全处理', async () => {
  const { pruneRecentIds } = await loadRetention()
  const now = Date.now()

  const filtered = pruneRecentIds(['unit', '', null, 'tax'], {}, 7, now)
  assert.deepEqual(filtered.ids, ['unit', 'tax'])
  assert.deepEqual(filtered.removed, [])

  /* 负阈值等价于永不清理：原样返回，不做任何改写 */
  const negative = pruneRecentIds(['unit', 'tax'], { unit: now - 400 * 24 * 3600 * 1000 }, -7, now)
  assert.deepEqual(negative.ids, ['unit', 'tax'])
  assert.deepEqual(negative.removed, [])
})

test('偏好迁移：v0 字段完整迁移并写入 v1', async () => {
  const { preferenceStore, DEFAULT_PREFERENCE } = await loadPreference()
  resetPreference(preferenceStore, DEFAULT_PREFERENCE)
  const mock = installStorageMock({
    'app:prefs.v0': {
      vibrate: false,
      sound: false,
      reduceMotion: true,
      autoClearDays: 7,
      flags: { enable_ai_assist: true },
    },
  })

  try {
    preferenceStore.init()
    assert.equal(preferenceStore.haptics, 'off')
    assert.equal(preferenceStore.sound, false)
    assert.equal(preferenceStore.motion, 'lite')
    assert.equal(preferenceStore.autoCleanDays, 7)
    assert.equal(preferenceStore.flags.enable_ai_assist, true)

    const write = mock.writes.find((item) => item.key === 'app:prefs.v1')
    assert.ok(write, '迁移后必须写入 v1')
    assert.equal(write.value.haptics, 'off')
    assert.equal(write.value.motion, 'lite')
    assert.equal(write.value.autoCleanDays, 7)
  } finally {
    delete globalThis.wx
    resetPreference(preferenceStore, DEFAULT_PREFERENCE)
  }
})

test('偏好迁移：v1 存在时优先于 v0，且不被旧值覆盖', async () => {
  const { preferenceStore, DEFAULT_PREFERENCE } = await loadPreference()
  resetPreference(preferenceStore, DEFAULT_PREFERENCE)
  installStorageMock({
    'app:prefs.v1': {
      haptics: 'heavy',
      sound: true,
      lightEffects: false,
      motion: 'saver',
      autoCleanDays: 0,
      flags: { enable_ai_assist: false },
    },
    'app:prefs.v0': {
      haptics: 'off',
      sound: false,
      motion: 'full',
      autoCleanDays: 30,
    },
  })

  try {
    preferenceStore.init()
    assert.equal(preferenceStore.haptics, 'heavy')
    assert.equal(preferenceStore.sound, true)
    assert.equal(preferenceStore.lightEffects, false)
    assert.equal(preferenceStore.motion, 'saver')
    assert.equal(preferenceStore.autoCleanDays, 0)
  } finally {
    delete globalThis.wx
    resetPreference(preferenceStore, DEFAULT_PREFERENCE)
  }
})

test('偏好迁移：v0 缺失时回退 tbx:prefs，非法旧值仍被清洗', async () => {
  const { preferenceStore, DEFAULT_PREFERENCE } = await loadPreference()
  resetPreference(preferenceStore, DEFAULT_PREFERENCE)
  installStorageMock({
    'tbx:prefs': {
      vibrate: true,
      sound: false,
      animation: 'turbo',
      autoCleanDays: 'never',
      evil_flag: true,
    },
  })

  try {
    preferenceStore.init()
    assert.equal(preferenceStore.haptics, 'light')
    assert.equal(preferenceStore.sound, false)
    assert.equal(preferenceStore.motion, DEFAULT_PREFERENCE.motion)
    assert.equal(preferenceStore.autoCleanDays, 0)
    assert.deepEqual(preferenceStore.flags, DEFAULT_PREFERENCE.flags)
  } finally {
    delete globalThis.wx
    resetPreference(preferenceStore, DEFAULT_PREFERENCE)
  }
})

test('偏好 Store：Storage 读写全部抛错也不白屏', async () => {
  const { preferenceStore, DEFAULT_PREFERENCE } = await loadPreference()
  resetPreference(preferenceStore, DEFAULT_PREFERENCE)
  globalThis.wx = {
    getStorageSync() {
      throw new Error('storage corrupted')
    },
    setStorageSync() {
      throw new Error('storage unavailable')
    },
  }

  try {
    const { preferenceStore, DEFAULT_PREFERENCE } = await loadPreference()
    assert.doesNotThrow(() => preferenceStore.init())
    assert.equal(preferenceStore.haptics, DEFAULT_PREFERENCE.haptics)
    assert.equal(preferenceStore.sound, DEFAULT_PREFERENCE.sound)
    assert.equal(preferenceStore.motion, DEFAULT_PREFERENCE.motion)
    assert.equal(preferenceStore.autoCleanDays, DEFAULT_PREFERENCE.autoCleanDays)
    assert.deepEqual(preferenceStore.flags, DEFAULT_PREFERENCE.flags)
  } finally {
    delete globalThis.wx
  }
})
