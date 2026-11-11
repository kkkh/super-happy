/* ==========================================================================
   history-snapshots · Cyber 快照轨迹清理回归
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

function installStorageMock(seed = {}) {
  const values = { ...seed }
  globalThis.wx = {
    getStorageSync(key) {
      return key in values ? values[key] : ''
    },
    setStorageSync(key, value) {
      values[key] = value
    },
    removeStorageSync(key) {
      delete values[key]
    },
    getDeviceInfo() {
      return { platform: 'node' }
    },
  }
  return values
}

function makeSlot(id, history) {
  const snapshot = {
    themeMode: 'dark',
    preference: { version: 1 },
    history,
  }
  const payload = JSON.stringify({
    version: 1,
    createdAt: Date.now(),
    label: id,
    checksum: '00000000',
    snapshot,
  })
  return {
    id,
    label: id,
    createdAt: Date.now(),
    time: '10:00',
    bytes: payload.length,
    payload,
  }
}

function parseSlot(slot) {
  return JSON.parse(slot.payload)
}

test('快照清理：统计并清空 auto/hot/时间轴帧中的 history，保留其他字段', async () => {
  const history = [
    { id: 'h-1', toolId: 'loan', timestamp: 1 },
    { id: 'h-2', toolId: 'unit', timestamp: 2 },
  ]
  const auto = [makeSlot('auto-1', history)]
  const hot = [makeSlot('hot-1', history)]
  const frames = [
    { id: 'tt-1', label: '帧 1', createdAt: 1, themeMode: 'dark', preference: {}, toolbox: {}, history },
    { id: 'tt-2', label: '帧 2', createdAt: 2, themeMode: 'dark', preference: {}, toolbox: {}, history },
  ]
  const values = installStorageMock({
    'cyber:auto:v1': auto,
    'cyber:hot:v1': hot,
    'cyber:frames:v1': frames,
  })

  try {
    const { countHistoryInSnapshots, purgeHistoryFromSnapshots } = await import(
      moduleUrl('core/toolbox/history-snapshots.ts')
    )
    const { crc32Hex } = await import(moduleUrl('core/toolbox/crc32.ts'))

    assert.equal(countHistoryInSnapshots(), 8)
    const result = purgeHistoryFromSnapshots()
    assert.equal(result.slots, 3)
    assert.equal(result.records, 8)

    for (const key of ['cyber:auto:v1', 'cyber:hot:v1']) {
      const slot = values[key][0]
      const envelope = parseSlot(slot)
      assert.deepEqual(envelope.snapshot.history, [])
      assert.equal(envelope.snapshot.themeMode, 'dark')
      assert.equal(envelope.snapshot.preference.version, 1)
      assert.equal(envelope.checksum, crc32Hex(JSON.stringify(envelope.snapshot)))
      assert.equal(slot.bytes, slot.payload.length)
    }
    assert.deepEqual(
      values['cyber:frames:v1'].map((frame) => frame.history),
      [[], []],
    )
    assert.equal(values['cyber:frames:v1'][0].label, '帧 1')
    assert.equal(countHistoryInSnapshots(), 0)
  } finally {
    delete globalThis.wx
  }
})

test('单条删除：从所有快照中移除指定 id，其他轨迹保留', async () => {
  const history = [
    { id: 'h-1', toolId: 'loan', timestamp: 1 },
    { id: 'h-2', toolId: 'unit', timestamp: 2 },
    { id: 'h-3', toolId: 'tax', timestamp: 3 },
  ]
  const values = installStorageMock({
    'cyber:auto:v1': [makeSlot('auto-1', history)],
    'cyber:hot:v1': [makeSlot('hot-1', history)],
    'cyber:frames:v1': [
      { id: 'tt-1', label: '帧 1', createdAt: 1, themeMode: 'dark', preference: {}, toolbox: {}, history },
      { id: 'tt-2', label: '帧 2', createdAt: 2, themeMode: 'dark', preference: {}, toolbox: {}, history },
    ],
  })

  try {
    const { purgeHistoryRecordFromSnapshots } = await import(
      moduleUrl('core/toolbox/history-snapshots.ts')
    )
    const { crc32Hex } = await import(moduleUrl('core/toolbox/crc32.ts'))

    const removed = purgeHistoryRecordFromSnapshots('h-2')
    assert.equal(removed, 4)
    for (const key of ['cyber:auto:v1', 'cyber:hot:v1']) {
      const envelope = parseSlot(values[key][0])
      assert.deepEqual(
        envelope.snapshot.history.map((item) => item.id),
        ['h-1', 'h-3'],
      )
      assert.equal(envelope.checksum, crc32Hex(JSON.stringify(envelope.snapshot)))
    }
    assert.deepEqual(
      values['cyber:frames:v1'].map((frame) => frame.history.map((item) => item.id)),
      [
        ['h-1', 'h-3'],
        ['h-1', 'h-3'],
      ],
    )

    const missing = purgeHistoryRecordFromSnapshots('h-9')
    assert.equal(missing, 0)
  } finally {
    delete globalThis.wx
  }
})

test('坏快照：无效 payload / 非 v1 数据不参与统计与清理', async () => {
  const values = installStorageMock({
    'cyber:auto:v1': [{ id: 'bad', payload: '{broken' }],
    'cyber:hot:v1': [
      {
        id: 'old-version',
        payload: JSON.stringify({ version: 2, snapshot: { history: [{ id: 'x' }] } }),
      },
    ],
  })

  try {
    const { countHistoryInSnapshots, purgeHistoryFromSnapshots } = await import(
      moduleUrl('core/toolbox/history-snapshots.ts')
    )
    assert.equal(countHistoryInSnapshots(), 0)
    const result = purgeHistoryFromSnapshots()
    assert.equal(result.slots, 0)
    assert.equal(result.records, 0)
    assert.equal(values['cyber:auto:v1'][0].payload, '{broken')
  } finally {
    delete globalThis.wx
  }
})
