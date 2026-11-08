/* ==========================================================================
   App 层版本更新守护 · 单元测试
   - onUpdateReady：只暂存、广播、并在 dismissed 后重新获得展示机会
   - onUpdateFailed：置 false + 原生 Toast，不抛异常
   - onCheckForUpdate：确认无更新时清理待更新红点
   - 边界：基础库不支持 / getUpdateManager 抛异常 / 监听器异常隔离
   - 运行：npm test
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { registerHooks } = require('node:module')

const ROOT = path.resolve(__dirname, '..')
const APP_URL = pathToFileURL(path.join(ROOT, 'app.ts')).href
const PENDING_KEY = 'hasPendingUpdate'

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

let appConfig = null
globalThis.App = (config) => {
  appConfig = config
  return config
}
globalThis.Behavior = (config) => config
globalThis.Component = (config) => config

/* app.ts 在 import 时会构造音效引擎，必须先有最小 wx 运行时 */
globalThis.wx = {
  env: { USER_DATA_PATH: '' },
  getDeviceInfo() {
    return { platform: 'node' }
  },
  getSystemInfoSync() {
    return { platform: 'node' }
  },
}

async function loadApp() {
  if (!appConfig) {
    await import(APP_URL)
  }
  return appConfig
}

function createManager() {
  const callbacks = {}
  return {
    callbacks,
    onCheckForUpdate(listener) {
      callbacks.check = listener
    },
    onUpdateReady(listener) {
      callbacks.ready = listener
    },
    onUpdateFailed(listener) {
      callbacks.failed = listener
    },
    applyUpdate() {
      callbacks.apply = (callbacks.apply || 0) + 1
    },
  }
}

function installEnv() {
  const storage = new Map()
  const toasts = []
  const manager = createManager()
  const state = {
    canIUse: true,
    managerThrows: false,
    getUpdateManagerCalls: 0,
  }
  globalThis.wx = {
    getDeviceInfo() {
      return { platform: 'node' }
    },
    getSystemInfoSync() {
      return { platform: 'node' }
    },
    canIUse() {
      return state.canIUse
    },
    getUpdateManager() {
      state.getUpdateManagerCalls += 1
      if (state.managerThrows) {
        throw new Error('manager unavailable')
      }
      return manager
    },
    showToast(options) {
      toasts.push(options)
    },
    getStorageSync(key) {
      return storage.has(key) ? storage.get(key) : ''
    },
    setStorageSync(key, value) {
      storage.set(key, value)
    },
    removeStorageSync(key) {
      storage.delete(key)
    },
  }
  return { storage, toasts, manager, state }
}

function resetHub(config) {
  Object.assign(config.globalData, {
    updateManager: null,
    hasUpdate: false,
    updateReadyListeners: [],
    promptState: 'idle',
    promptOwner: '',
    blockers: 0,
  })
}

function install(config) {
  config.installUpdateGuard.call({ globalData: config.globalData })
}

test('onUpdateReady 只置标记并广播，不直接弹窗', async () => {
  const config = await loadApp()
  const { manager } = installEnv()
  resetHub(config)
  install(config)

  let notified = 0
  config.globalData.updateReadyListeners.push(() => {
    notified += 1
  })
  manager.callbacks.ready()

  assert.equal(config.globalData.hasUpdate, true)
  assert.equal(config.globalData.updateManager, manager)
  assert.equal(config.globalData.promptState, 'idle')
  assert.equal(notified, 1)
  assert.equal(typeof globalThis.wx.showModal, 'undefined')
})

test('dismissed 后新包就绪重新获得展示机会；custom 状态不被重置', async () => {
  const config = await loadApp()
  const { manager } = installEnv()
  resetHub(config)
  install(config)

  config.globalData.promptState = 'dismissed'
  config.globalData.promptOwner = 'old-guard'
  manager.callbacks.ready()
  assert.equal(config.globalData.promptState, 'idle')
  assert.equal(config.globalData.promptOwner, '')

  config.globalData.promptState = 'custom'
  config.globalData.promptOwner = 'active-guard'
  manager.callbacks.ready()
  assert.equal(config.globalData.promptState, 'custom')
  assert.equal(config.globalData.promptOwner, 'active-guard')
})

test('onUpdateFailed 置 false 并给出原生全局 Toast', async () => {
  const config = await loadApp()
  const { manager, toasts } = installEnv()
  resetHub(config)
  install(config)
  config.globalData.hasUpdate = true

  assert.doesNotThrow(() => manager.callbacks.failed())
  assert.equal(config.globalData.hasUpdate, false)
  assert.equal(toasts.length, 1)
  assert.match(toasts[0].title, /网络波动/)
  assert.equal(toasts[0].icon, 'none')
})

test('onCheckForUpdate 无更新时清理红点；有更新时保留', async () => {
  const config = await loadApp()
  const { manager, storage } = installEnv()
  resetHub(config)
  install(config)

  storage.set(PENDING_KEY, true)
  manager.callbacks.check({ hasUpdate: false })
  assert.equal(storage.has(PENDING_KEY), false)

  storage.set(PENDING_KEY, true)
  manager.callbacks.check({ hasUpdate: true })
  assert.equal(storage.get(PENDING_KEY), true)
})

test('基础库不支持 getUpdateManager 时安全跳过', async () => {
  const config = await loadApp()
  const { state } = installEnv()
  resetHub(config)
  state.canIUse = false

  assert.doesNotThrow(() => install(config))
  assert.equal(state.getUpdateManagerCalls, 0)
  assert.equal(config.globalData.updateManager, null)
})

test('getUpdateManager 抛异常时不崩溃，管理器保持空', async () => {
  const config = await loadApp()
  const { state } = installEnv()
  resetHub(config)
  state.managerThrows = true

  assert.doesNotThrow(() => install(config))
  assert.equal(config.globalData.updateManager, null)
})

test('单个页面监听器异常不影响其它页面收到更新', async () => {
  const config = await loadApp()
  const { manager } = installEnv()
  resetHub(config)
  install(config)

  let healthy = 0
  config.globalData.updateReadyListeners.push(() => {
    throw new Error('broken page guard')
  })
  config.globalData.updateReadyListeners.push(() => {
    healthy += 1
  })

  assert.doesNotThrow(() => manager.callbacks.ready())
  assert.equal(healthy, 1)
})
