/* ==========================================================================
   App Brightness · focus:brightness:v1 stale 兜底
   - owned=true → 恢复 original 并删除 key
   - owned=false / 损坏 / 越界 → 不改亮度、不抛错
   - 运行：npm test
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { registerHooks } = require('node:module')

const ROOT = path.resolve(__dirname, '..')
const STALE_KEY = 'focus:brightness:v1'

registerHooks({
  resolve(specifier, context, nextResolve) {
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

let appConfig = null
globalThis.App = (config) => {
  appConfig = config
  return config
}
globalThis.Behavior = (config) => config
globalThis.Component = (config) => config

/* app.ts 在 import 时构造音效引擎，必须先有最小 wx 运行时 */
globalThis.wx = {
  env: { USER_DATA_PATH: '' },
  getDeviceInfo() {
    return { platform: 'node' }
  },
  getSystemInfoSync() {
    return { platform: 'node' }
  },
}

async function loadBrightness() {
  const module = await import(pathToFileURL(path.join(ROOT, 'app.ts')).href)
  assert.ok(appConfig, 'App 配置应被捕获')
  return module.restoreStaleFocusBrightness
}

function installWx(options = {}) {
  const values = new Map(Object.entries(options.seed || {}))
  const brightness = []
  globalThis.wx = {
    getDeviceInfo() {
      return { platform: 'node' }
    },
    getSystemInfoSync() {
      return { platform: 'node' }
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
    setScreenBrightness(option) {
      brightness.push(option.value)
      if (options.brightnessFail) {
        option.fail?.()
        return
      }
      option.success?.()
      option.complete?.()
    },
  }
  return { values, brightness }
}

test('owned=true：恢复 original 并删除 stale key', async () => {
  const restore = await loadBrightness()
  const { values, brightness } = installWx({
    seed: {
      [STALE_KEY]: { version: 1, original: 0.7, owned: true },
    },
  })
  restore()
  assert.deepEqual(brightness, [0.7])
  assert.equal(values.has(STALE_KEY), false)
})

test('JSON 字符串存档同样可以恢复', async () => {
  const restore = await loadBrightness()
  const { values, brightness } = installWx({
    seed: {
      [STALE_KEY]: JSON.stringify({ version: 1, original: 0.45, owned: true }),
    },
  })
  restore()
  assert.deepEqual(brightness, [0.45])
  assert.equal(values.has(STALE_KEY), false)
})

test('恢复失败：保留 stale key，下次 onLaunch 继续兜底', async () => {
  const restore = await loadBrightness()
  const { values, brightness } = installWx({
    seed: {
      [STALE_KEY]: { version: 1, original: 0.7, owned: true },
    },
    brightnessFail: true,
  })
  restore()
  assert.deepEqual(brightness, [0.7])
  assert.equal(values.has(STALE_KEY), true)
})

test('owned=false：不改亮度，也不删除 key', async () => {
  const restore = await loadBrightness()
  const { values, brightness } = installWx({
    seed: {
      [STALE_KEY]: { version: 1, original: 0.6, owned: false },
    },
  })
  restore()
  assert.deepEqual(brightness, [])
  assert.equal(values.has(STALE_KEY), true)
})

test('损坏 JSON / 越界 original：不抛错；越界清理 stale key', async () => {
  const restore = await loadBrightness()
  const broken = installWx({ seed: { [STALE_KEY]: '{bad' } })
  assert.doesNotThrow(() => restore())
  assert.deepEqual(broken.brightness, [])

  const outOfRange = installWx({
    seed: { [STALE_KEY]: { version: 1, original: 1.4, owned: true } },
  })
  assert.doesNotThrow(() => restore())
  assert.deepEqual(outOfRange.brightness, [])
  assert.equal(outOfRange.values.has(STALE_KEY), false)

  const missing = installWx()
  assert.doesNotThrow(() => restore())
  assert.deepEqual(missing.brightness, [])
})
