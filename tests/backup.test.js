/* ==========================================================================
   备份与恢复 · 纯函数与原子写入契约
   - 覆盖归一化、严格校验、256KB 上限、原子导入与失败回滚
   - 文件读写与分享由页面驱动，Node 侧只验证可离线部分
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { registerHooks } = require('node:module')
const { pathToFileURL } = require('node:url')

const ROOT = path.resolve(__dirname, '..')

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !path.extname(specifier)) {
      return nextResolve(`${specifier}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})

function moduleUrl(relative) {
  return pathToFileURL(path.join(ROOT, relative)).href
}

async function loadBackup() {
  return import(moduleUrl('subpackages/grow/lib/backup.ts'))
}

async function loadPreference() {
  return import(moduleUrl('core/stores/preference.ts'))
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
    getStorageInfoSync() {
      return { keys: Object.keys(values) }
    },
    getDeviceInfo() {
      return { platform: 'node' }
    },
    getSystemInfoSync() {
      return { platform: 'node' }
    },
  }
  return values
}

function memoryAdapter(seed = {}) {
  const values = new Map(Object.entries(seed))
  const writes = []
  return {
    values,
    writes,
    has(key) {
      return values.has(key)
    },
    read(key) {
      return values.get(key)
    },
    write(key, value) {
      values.set(key, value)
      writes.push(key)
      return true
    },
    remove(key) {
      values.delete(key)
      writes.push(`!${key}`)
      return true
    },
  }
}

function sampleSource() {
  return {
    favorites: ['loan', 'ghost', 'loan', 'unit'],
    recent: [
      'unit',
      'tax',
      'loan',
      'deposit',
      'radix',
      'ledger',
      'date-format',
      'text-convert',
      'regex',
      'photo-edit',
      'worktime',
      'wellness',
      'random-pick',
      'vcard',
    ],
    recentAt: {
      unit: 1760000000000,
      tax: 1760000000001,
      ghost: 1760000000002,
    },
    searchHistory: ['房贷', ' 图片 ', '房贷', '', 'a'.repeat(40)],
    weather: {
      cities: [{ adcode: '110000' }, { adcode: '310000' }, { adcode: '440300' }, {}, {}, {}],
      current: '110000',
    },
    focus: {
      key: 'a'.repeat(64),
      ledger: Array.from({ length: 60 }, (_, index) => ({ id: `rec-${index}` })),
      stats: { completedCount: 3 },
    },
    prefs: { haptics: 'light', sound: true },
  }
}

test('备份归一化：工具 id、时间戳、搜索词与容量上限', async () => {
  const { buildBackup } = await loadBackup()
  const file = buildBackup(sampleSource(), 1760000000000)

  assert.equal(file.app, 'chao-huan-toolbox')
  assert.equal(file.v, 1)
  assert.equal(file.exportedAt, 1760000000000)
  assert.deepEqual(file.data.favorites, ['loan', 'unit'])
  assert.equal(file.data.recent.length, 12)
  assert.deepEqual(file.data.recentAt, {
    unit: 1760000000000,
    tax: 1760000000001,
  })
  assert.deepEqual(file.data.searchHistory, ['房贷', '图片', 'a'.repeat(24)])
  assert.equal(file.data.weather.cities.length, 5)
  assert.equal(file.data.focus.ledger.length, 50)
  assert.equal(file.data.focus.key, 'a'.repeat(64))
})

test('备份校验：app / 版本 / 必填字段与未知字段', async () => {
  const { buildBackup, validateBackup } = await loadBackup()
  const valid = buildBackup(sampleSource(), 1760000000000)

  assert.equal(validateBackup(valid).ok, true)
  assert.equal(validateBackup({ ...valid, app: 'other' }).reason, 'invalid')
  assert.equal(validateBackup({ ...valid, v: 2 }).reason, 'version')
  assert.equal(validateBackup({ ...valid, data: {} }).reason, 'invalid')

  const withExtra = {
    ...valid,
    extra: 'drop-me',
    data: { ...valid.data, extra: 'drop-me' },
  }
  const normalized = validateBackup(withExtra)
  assert.equal(normalized.ok, true)
  assert.equal('extra' in normalized.file, false)
  assert.equal('extra' in normalized.file.data, false)
})

test('备份校验：focus 字段类型非法直接拒绝', async () => {
  const { buildBackup, validateBackup } = await loadBackup()
  const valid = buildBackup(sampleSource(), 1760000000000)

  for (const focus of [
    { key: 123 },
    { ledger: 'nope' },
    { stats: [] },
  ]) {
    const result = validateBackup({ ...valid, data: { ...valid.data, focus } })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'invalid')
  }
})

test('备份解析：空文本 / 非 JSON / 超过 256KB', async () => {
  const { parseBackupText, BACKUP_MAX_BYTES } = await loadBackup()

  assert.equal(parseBackupText('   ').reason, 'empty')
  assert.equal(parseBackupText('not-json').reason, 'invalid')
  assert.equal(parseBackupText('x'.repeat(BACKUP_MAX_BYTES + 1)).reason, 'too-large')
})

test('原子导入：写入全部目标键且不触碰 usage/history', async () => {
  const { buildBackup, applyBackupToStorage } = await loadBackup()
  const file = buildBackup(sampleSource(), 1760000000000)
  const adapter = memoryAdapter({ 'tbx:usage': 9, 'tbx:history': ['keep'] })

  const result = applyBackupToStorage(file, adapter)
  assert.equal(result.ok, true)
  assert.deepEqual(result.counts, {
    favorites: 2,
    recent: 12,
    searchHistory: 3,
    weatherCities: 5,
    focusRecords: 50,
  })
  assert.deepEqual(adapter.values.get('tbx:favorites'), file.data.favorites)
  assert.deepEqual(adapter.values.get('tbx:recent'), file.data.recent)
  assert.equal(adapter.values.get('weather:current:v1'), '110000')
  assert.equal(adapter.values.get('focus:key:v1'), 'a'.repeat(64))
  assert.equal(adapter.values.get('tbx:usage'), 9)
  assert.deepEqual(adapter.values.get('tbx:history'), ['keep'])
})

test('原子导入：任一键写入失败时逆序回滚并保留原数据', async () => {
  const { buildBackup, applyBackupToStorage } = await loadBackup()
  const file = buildBackup(sampleSource(), 1760000000000)
  const base = memoryAdapter({
    'tbx:favorites': ['unit'],
    'tbx:recent': ['unit'],
    'tbx:recent.at': { unit: 1 },
  })
  const failing = {
    ...base,
    write(key, value) {
      if (key === 'tbx:searchHistory') {
        return false
      }
      return base.write(key, value)
    },
  }

  const result = applyBackupToStorage(file, failing)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'write-failed')
  assert.deepEqual(base.values.get('tbx:favorites'), ['unit'])
  assert.deepEqual(base.values.get('tbx:recent'), ['unit'])
  assert.deepEqual(base.values.get('tbx:recent.at'), { unit: 1 })
  assert.equal(base.values.has('tbx:searchHistory'), false)
})

test('完整导入：写入 Storage 后刷新 toolboxStore / preferenceStore', async () => {
  installStorageMock()
  const { buildBackup, applyBackup } = await loadBackup()
  const { preferenceStore, DEFAULT_PREFERENCE } = await loadPreference()
  const file = buildBackup(sampleSource(), 1760000000000)

  const result = applyBackup(file)
  assert.equal(result.ok, true)
  assert.deepEqual(wx.getStorageSync('tbx:favorites'), file.data.favorites)
  assert.deepEqual(wx.getStorageSync('tbx:recent'), file.data.recent)
  assert.equal(wx.getStorageSync('weather:current:v1'), '110000')
  assert.equal(wx.getStorageSync('app:prefs.v1').haptics, 'light')
  assert.equal(preferenceStore.haptics, 'light')

  preferenceStore.applySnapshot(DEFAULT_PREFERENCE)
})

test('备份文件命名与时间展示使用本地时间', async () => {
  const { backupFileName, formatBackupAt } = await loadBackup()
  const at = new Date(2026, 10, 11, 8, 5).getTime()

  assert.equal(backupFileName(at), '超欢备份-20261111.json')
  assert.equal(formatBackupAt(at), '2026-11-11 08:05')
  assert.equal(formatBackupAt(0), '')
})

test('备份服务：只写本机目录，不发起网络请求', () => {
  const source = fs.readFileSync(path.join(ROOT, 'subpackages/grow/lib/backup.ts'), 'utf8')

  assert.equal(/wx\.request|uploadFile|downloadFile/.test(source), false)
  assert.match(source, /USER_DATA_PATH/)
  assert.match(source, /chooseMessageFile/)
  assert.match(source, /BACKUP_MAX_BYTES = 256 \* 1024/)
})
