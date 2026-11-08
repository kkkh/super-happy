/* ==========================================================================
   privacy-guard × update-guard 联动测试
   - 隐私授权弹窗打开：全局 blockers +1
   - 关闭：blockers -1，并延迟唤醒更新守门组件
   - 页面销毁时兜底释放，计数永不为负
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { registerHooks } = require('node:module')

const ROOT = path.resolve(__dirname, '..')
const PRIVACY_URL = pathToFileURL(
  path.join(ROOT, 'components/privacy-guard/index.ts'),
).href
const BINDINGS_SHIM = pathToFileURL(
  path.join(__dirname, 'helpers/mobx-bindings-shim.mjs'),
).href

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

let privacyConfig = null
globalThis.Behavior = (config) => config
globalThis.Component = (config) => {
  privacyConfig = config
  return config
}
globalThis.wx = {
  env: { USER_DATA_PATH: '' },
  getDeviceInfo() {
    return { platform: 'node' }
  },
  getSystemInfoSync() {
    return { platform: 'node' }
  },
}

async function loadPrivacy() {
  if (!privacyConfig) {
    await import(PRIVACY_URL)
  }
  return privacyConfig
}

function createHub() {
  const hub = {
    updateManager: null,
    hasUpdate: true,
    updateReadyListeners: [],
    promptState: 'idle',
    promptOwner: '',
    blockers: 0,
  }
  globalThis.getApp = () => ({ globalData: hub })
  return hub
}

function createInstance() {
  return {
    data: { visible: false, referrer: '' },
    blockerHeld: false,
    setData(patch) {
      Object.assign(this.data, patch)
    },
  }
}

function useClock(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.after(() => {
    try {
      t.mock.timers.runAll()
    } catch {
      /* 已释放 */
    }
    try {
      t.mock.timers.reset()
    } catch {
      /* 已释放 */
    }
  })
}

test('隐私弹窗打开/关闭严格增减 blockers，并延迟唤醒', async (t) => {
  useClock(t)
  const config = await loadPrivacy()
  const hub = createHub()
  const inst = createInstance()
  let woken = 0
  hub.updateReadyListeners.push(() => {
    woken += 1
  })

  config.observers.visible.call(inst, true)
  assert.equal(hub.blockers, 1)
  assert.equal(inst.blockerHeld, true)

  /* 重复 true 不得重复计数 */
  config.observers.visible.call(inst, true)
  assert.equal(hub.blockers, 1)

  config.observers.visible.call(inst, false)
  assert.equal(hub.blockers, 0)
  assert.equal(inst.blockerHeld, false)
  t.mock.timers.tick(419)
  assert.equal(woken, 0)
  t.mock.timers.tick(1)
  assert.equal(woken, 1)
})

test('页面销毁时释放仍持有的阻塞，计数不会泄漏', async (t) => {
  useClock(t)
  const config = await loadPrivacy()
  const hub = createHub()
  const inst = createInstance()

  config.observers.visible.call(inst, true)
  assert.equal(hub.blockers, 1)

  config.lifetimes.detached.call(inst)
  assert.equal(hub.blockers, 0)
  assert.equal(inst.blockerHeld, false)
})

test('未持有阻塞时 detached 不会把计数减成负数', async (t) => {
  useClock(t)
  const config = await loadPrivacy()
  const hub = createHub()
  const inst = createInstance()

  config.lifetimes.detached.call(inst)
  assert.equal(hub.blockers, 0)
})
