/* ==========================================================================
   隐私中心 · 权限快照、版本确认与重置范围
   - wx.getSetting / wx.getPrivacySetting 的状态映射与不可用降级
   - app:privacy.version 读写与变更判定
   - 重置全部只删约定范围，保留 gallery 与 app:storage.version
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

async function loadPrivacyCenter() {
  return import(moduleUrl('subpackages/grow/lib/privacy-center.ts'))
}

function installWxMock(options = {}) {
  const values = { ...(options.seed || {}) }
  const files = new Set(options.files || [])
  const dirs = new Set(['/user/backups', '/user/exports'])
  const wxMock = {
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
    env: { USER_DATA_PATH: '/user' },
    getFileSystemManager() {
      return {
        accessSync(dir) {
          if (!dirs.has(dir)) {
            throw new Error('missing')
          }
        },
        mkdirSync(dir) {
          dirs.add(dir)
        },
        readdirSync(dir) {
          const prefix = `${dir}/`
          return Array.from(files)
            .filter((file) => file.startsWith(prefix))
            .map((file) => file.slice(prefix.length))
        },
        unlinkSync(file) {
          files.delete(file)
        },
      }
    },
  }
  if (options.auth !== null) {
    wxMock.getSetting = ({ success }) => success({ authSetting: options.auth || {} })
  }
  if (options.privacy !== null) {
    wxMock.getPrivacySetting = ({ success }) =>
      success(
        options.privacy || {
          needAuthorization: false,
          privacyContractName: '超欢隐私保护指引',
        },
      )
  }
  if (options.openSetting !== null) {
    wxMock.openSetting = ({ success, fail }) =>
      options.openSetting === false ? fail() : success()
  }
  if (options.openContract !== null) {
    wxMock.openPrivacyContract = ({ success, fail }) =>
      options.openContract === false ? fail() : success()
  }
  globalThis.wx = wxMock
  return { values, files, dirs }
}

test('权限快照：定位 / 相册 / 隐私指引状态与系统一致', async () => {
  installWxMock({
    auth: { 'scope.userFuzzyLocation': true, 'scope.writePhotosAlbum': false },
    privacy: { needAuthorization: true, privacyContractName: '超欢隐私保护指引' },
    seed: { 'app:privacy.version': 3 },
  })
  const privacy = await loadPrivacyCenter()
  const snapshot = await privacy.permissionSnapshot()
  const byKey = Object.fromEntries(snapshot.permissions.map((item) => [item.key, item]))
  assert.equal(byKey.location.status, 'granted')
  assert.equal(byKey.album.status, 'denied')
  assert.equal(byKey.privacy.status, 'unset')
  assert.equal(byKey.privacy.detail, '《超欢隐私保护指引》')
  assert.equal(snapshot.contractName, '超欢隐私保护指引')
  assert.equal(snapshot.versionChanged, false)
})

test('权限快照：API 不可用时降级为 unavailable', async () => {
  installWxMock({ auth: null, privacy: null })
  const privacy = await loadPrivacyCenter()
  const snapshot = await privacy.permissionSnapshot()
  assert.ok(snapshot.permissions.every((item) => item.status === 'unavailable'))
  assert.equal(snapshot.contractName, '')
  assert.equal(snapshot.versionChanged, true)
})

test('隐私指引已同意时状态为 granted', async () => {
  installWxMock({
    auth: {},
    privacy: { needAuthorization: false, privacyContractName: '指引' },
    seed: { 'app:privacy.version': 3 },
  })
  const privacy = await loadPrivacyCenter()
  const snapshot = await privacy.permissionSnapshot()
  assert.equal(snapshot.permissions.find((item) => item.key === 'privacy').status, 'granted')
})

test('隐私指引版本：确认后写回并消除变更提示', async () => {
  const { values } = installWxMock()
  const privacy = await loadPrivacyCenter()
  assert.equal(privacy.readPrivacyVersion(), 0)
  assert.equal(privacy.privacyVersionChanged(), true)
  assert.equal(privacy.ackPrivacyVersion(2), true)
  assert.equal(values['app:privacy.version'], 2)
  assert.equal(privacy.privacyVersionChanged(), true)
  assert.equal(privacy.ackPrivacyVersion(3), true)
  assert.equal(values['app:privacy.version'], 3)
  assert.equal(privacy.readPrivacyVersion(), 3)
  assert.equal(privacy.privacyVersionChanged(), false)
  assert.equal(privacy.ackPrivacyVersion(0), false)
  assert.equal(privacy.privacyVersionChanged(), false)
})

test('跳转：系统设置 / 隐私指引成功、失败与不支持', async () => {
  installWxMock()
  const privacy = await loadPrivacyCenter()
  assert.equal(await privacy.openPrivacySetting(), true)
  assert.equal(await privacy.openPrivacyContract(), true)

  installWxMock({ openSetting: false, openContract: false })
  assert.equal(await privacy.openPrivacySetting(), false)
  assert.equal(await privacy.openPrivacyContract(), false)

  installWxMock({ openSetting: null, openContract: null })
  assert.equal(await privacy.openPrivacySetting(), false)
  assert.equal(await privacy.openPrivacyContract(), false)
})

test('重置全部：删除约定范围，保留 gallery 与存储版本', async () => {
  const { values, files } = installWxMock({
    seed: {
      'tbx:recent': ['unit'],
      'tbx:draft.unit': { v: 1, mode: '', input: { value: '1' }, at: 1 },
      'weather:cities:v1': [],
      'qweather:cities:v1': [],
      'qweather:cache:v2': {},
      'focus:ledger:v1': [],
      'diag:errors.v1': [],
      'cyber:auto:v1': [],
      'toolbox:meeting-timer.hud.v1': { left: 0, top: 0 },
      'app:prefs.v1': { version: 1 },
      'app:prefs.v0': { version: 0 },
      'app:privacy.version': 1,
      'app:backup.at': 1,
      'app:storage.version': 1,
      'gallery.theme.mode': 'dark',
      'gallery.works.favorites': ['a'],
      'unrelated:key': true,
    },
    files: ['/user/backups/超欢备份-20261111.json', '/user/exports/a.txt'],
  })
  const privacy = await loadPrivacyCenter()
  const result = privacy.resetAllLocalData()
  assert.equal(result.removedKeys, 13)
  assert.equal(result.backups, 1)
  for (const key of [
    'tbx:recent',
    'tbx:draft.unit',
    'weather:cities:v1',
    'qweather:cities:v1',
    'qweather:cache:v2',
    'focus:ledger:v1',
    'diag:errors.v1',
    'cyber:auto:v1',
    'toolbox:meeting-timer.hud.v1',
    'app:prefs.v1',
    'app:prefs.v0',
    'app:privacy.version',
    'app:backup.at',
  ]) {
    assert.equal(values[key], undefined, `${key} 应被删除`)
  }
  assert.equal(values['app:storage.version'], 1)
  assert.equal(values['gallery.theme.mode'], 'dark')
  assert.deepEqual(values['gallery.works.favorites'], ['a'])
  assert.equal(values['unrelated:key'], true)
  assert.equal(files.size, 0)
})

test('设置页与 legal 已接入隐私中心契约', () => {
  const settingsTs = fs.readFileSync(
    path.join(ROOT, 'subpackages/grow/pages/settings/index.ts'),
    'utf8',
  )
  const settingsWxml = fs.readFileSync(
    path.join(ROOT, 'subpackages/grow/pages/settings/index.wxml'),
    'utf8',
  )
  const legalWxml = fs.readFileSync(
    path.join(ROOT, 'subpackages/grow/pages/legal/index.wxml'),
    'utf8',
  )
  const constants = fs.readFileSync(path.join(ROOT, 'core/constants/index.ts'), 'utf8')

  assert.match(settingsTs, /refreshPrivacyCenter\(\)/)
  assert.match(settingsTs, /onPrivacyPermissionTap\(/)
  assert.match(settingsTs, /onPrivacyVersionAck\(/)
  assert.match(settingsTs, /resetAllLocalData\(\)/)
  assert.match(settingsWxml, /隐私中心/)
  assert.match(settingsWxml, /隐私保护指引已更新/)
  assert.match(settingsWxml, /重置全部本机数据/)
  assert.match(settingsWxml, /onPrivacyConfirm/)
  assert.match(legalWxml, /app:privacy\.version/)
  assert.match(legalWxml, /privacyVersion/)
  assert.match(constants, /PRIVACY_VERSION\s*=\s*3/)
  assert.match(constants, /privacyVersion:\s*'app:privacy\.version'/)
})
