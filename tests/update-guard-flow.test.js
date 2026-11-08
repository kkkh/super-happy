/* ==========================================================================
   update-guard · 全局更新流程单元测试
   - 组件级行为：渲染看门狗 / 原生降级 / 互斥锁 / 页面交棒
   - 高危阻塞：blocked 只排队，解除后 420ms 再呼出
   - 用户动作：立即重启 / 稍后 / 查看更新日志
   - 边界：页面隐藏、页面销毁、applyUpdate 失败、manager 缺失、早期 getApp
   - 运行：npm test
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { registerHooks } = require('node:module')

const ROOT = path.resolve(__dirname, '..')
const GUARD_URL = pathToFileURL(
  path.join(ROOT, 'components/update-guard/index.ts'),
).href
const SERVICE_URL = pathToFileURL(
  path.join(ROOT, 'core/services/update.ts'),
).href
const PENDING_KEY = 'hasPendingUpdate'
const SETTINGS_URL = '/subpackages/grow/pages/settings/index?changelog=1'

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

/* Component 构造器在 import 时执行一次，这里捕获最终配置 */
let guardConfig = null
globalThis.Behavior = (config) => config
globalThis.Component = (config) => {
  guardConfig = config
  return config
}

async function loadGuardConfig() {
  if (!guardConfig) {
    await import(GUARD_URL)
  }
  return guardConfig
}

async function loadService() {
  return import(SERVICE_URL)
}

function createEnv(hasUpdate = true) {
  const storage = new Map()
  const calls = {
    apply: 0,
    modal: [],
    toast: [],
    navigate: [],
    redirect: [],
  }
  const manager = {
    applyUpdate() {
      calls.apply += 1
    },
  }
  const hub = {
    updateManager: manager,
    hasUpdate,
    updateReadyListeners: [],
    promptState: 'idle',
    promptOwner: '',
    blockers: 0,
  }
  const wx = {
    getStorageSync(key) {
      return storage.has(key) ? storage.get(key) : ''
    },
    setStorageSync(key, value) {
      storage.set(key, value)
    },
    removeStorageSync(key) {
      storage.delete(key)
    },
    showModal(options) {
      calls.modal.push(options)
    },
    showToast(options) {
      calls.toast.push(options)
    },
    navigateTo(options) {
      calls.navigate.push(options.url)
    },
    redirectTo(options) {
      calls.redirect.push(options.url)
    },
  }
  globalThis.wx = wx
  globalThis.getApp = () => ({ globalData: hub })
  return { storage, calls, hub, manager, wx }
}

function createGuard(config, blocked = false, show = true) {
  const data = { ...config.data, blocked }
  const inst = {
    data,
    token: '',
    visible: false,
    destroyed: false,
    active: false,
    confirmed: false,
    resolved: false,
    blockerHeld: false,
    nativeOpen: false,
    settleTimer: 0,
    watchdog: 0,
    fallbackTimer: 0,
    unsubscribe: null,
    setData(patch, callback) {
      Object.assign(this.data, patch)
      if (typeof callback === 'function') {
        callback()
      }
    },
    triggerEvent() {
      /* 组件事件由测试直接调用方法，不重复派发 */
    },
  }
  for (const [name, method] of Object.entries(config.methods)) {
    inst[name] = method.bind(inst)
  }
  config.lifetimes.attached.call(inst)
  if (show) {
    config.pageLifetimes.show.call(inst)
  }
  return inst
}

function setBlocked(config, inst, value) {
  inst.data.blocked = value
  config.observers.blocked.call(inst)
}

function hide(config, inst) {
  config.pageLifetimes.hide.call(inst)
}

function show(config, inst) {
  config.pageLifetimes.show.call(inst)
}

function detach(config, inst) {
  config.lifetimes.detached.call(inst)
}

function fireUpdateReady(hub) {
  hub.updateReadyListeners.slice().forEach((listener) => listener())
}

function useClock(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.after(() => {
    try {
      /* 先把跨测试残留的 service wake / guard 定时器跑完，避免污染下一个用例 */
      t.mock.timers.runAll()
    } catch {
      /* 定时器已释放 */
    }
    try {
      t.mock.timers.reset()
    } catch {
      /* 测试环境已释放 */
    }
  })
}

test('未就绪保持静默；下载完成立即接管且只抢一次锁', async (t) => {
  useClock(t)
  const config = await loadGuardConfig()
  const { hub } = createEnv(false)
  const inst = createGuard(config)

  t.mock.timers.tick(120)
  assert.equal(inst.data.modalShow, false)
  assert.equal(hub.promptState, 'idle')

  hub.hasUpdate = true
  fireUpdateReady(hub)
  assert.equal(inst.data.modalShow, true)
  assert.equal(hub.promptState, 'custom')
  assert.match(hub.promptOwner, /^update-guard-/)
  detach(config, inst)
})

test('1.5s 未确认渲染时降级原生；确认重启调用 applyUpdate', async (t) => {
  useClock(t)
  const config = await loadGuardConfig()
  const { calls, hub, storage } = createEnv()
  const inst = createGuard(config)

  t.mock.timers.tick(120)
  assert.equal(inst.data.modalShow, true)

  t.mock.timers.tick(1500)
  assert.equal(inst.data.modalShow, false)
  assert.equal(hub.promptState, 'native')

  t.mock.timers.tick(40)
  assert.equal(calls.modal.length, 1)
  const options = calls.modal[0]
  assert.match(options.title, /发现全新极光版本/)
  assert.match(options.content, /重启小程序/)
  assert.equal(options.confirmText, '立即重启')
  assert.equal(options.cancelText, '稍后')
  assert.equal(options.showCancel, undefined)

  options.success({ confirm: true, cancel: false })
  options.complete()
  assert.equal(calls.apply, 1)
  assert.equal(storage.has(PENDING_KEY), false)
  assert.equal(hub.promptState, 'dismissed')
  assert.equal(inst.data.modalShow, false)
  detach(config, inst)
})

test('opened 后看门狗不再降级；“稍后”写红点且不再重复打扰', async (t) => {
  useClock(t)
  const config = await loadGuardConfig()
  const { calls, hub, storage } = createEnv()
  const inst = createGuard(config)

  t.mock.timers.tick(120)
  inst.onOpened()
  t.mock.timers.tick(2000)
  assert.equal(inst.data.modalShow, true)
  assert.equal(calls.modal.length, 0)

  inst.onCancel()
  assert.equal(storage.get(PENDING_KEY), true)
  assert.equal(hub.promptState, 'dismissed')
  assert.equal(inst.data.modalShow, false)

  t.mock.timers.tick(1000)
  assert.equal(inst.data.modalShow, false)
  assert.equal(calls.modal.length, 0)
  detach(config, inst)
})

test('异常关闭（遮罩/系统）等同“稍后”，绝不丢提醒', async (t) => {
  useClock(t)
  const config = await loadGuardConfig()
  const { hub, storage } = createEnv()
  const inst = createGuard(config)

  t.mock.timers.tick(120)
  inst.onClose({ detail: { source: 'mask' } })
  assert.equal(storage.get(PENDING_KEY), true)
  assert.equal(hub.promptState, 'dismissed')
  assert.equal(inst.data.modalShow, false)
  detach(config, inst)
})

test('“稍后”是会话级全局状态，换页后也不会立刻再弹', async (t) => {
  useClock(t)
  const config = await loadGuardConfig()
  const { hub } = createEnv()
  const first = createGuard(config)
  t.mock.timers.tick(120)
  first.onCancel()
  assert.equal(hub.promptState, 'dismissed')
  detach(config, first)

  const second = createGuard(config)
  t.mock.timers.tick(420)
  assert.equal(second.data.modalShow, false)
  assert.equal(hub.promptState, 'dismissed')
  detach(config, second)
})

test('全局互斥：第二个页面不叠层；切页后交棒且旧事件失效', async (t) => {
  useClock(t)
  const config = await loadGuardConfig()
  const { hub, storage } = createEnv()
  const first = createGuard(config)
  t.mock.timers.tick(120)
  assert.equal(first.data.modalShow, true)

  const second = createGuard(config)
  t.mock.timers.tick(120)
  assert.equal(second.data.modalShow, false)
  assert.equal(hub.promptOwner, first.token)

  hide(config, first)
  assert.equal(first.data.modalShow, false)
  assert.equal(hub.promptState, 'custom')
  assert.equal(hub.promptOwner, second.token)
  assert.equal(second.data.modalShow, true)

  /* 旧页面的排队事件不得写红点或抢回锁 */
  first.onCancel()
  assert.equal(storage.has(PENDING_KEY), false)
  assert.equal(hub.promptState, 'custom')
  assert.equal(hub.promptOwner, second.token)

  detach(config, second)
})

test('高危操作 blocked 只排队，解除后等待 420ms 才呼出', async (t) => {
  useClock(t)
  const config = await loadGuardConfig()
  const { hub } = createEnv()
  const inst = createGuard(config, true)

  t.mock.timers.tick(120)
  assert.equal(inst.data.modalShow, false)
  assert.equal(hub.blockers, 1)

  setBlocked(config, inst, false)
  assert.equal(hub.blockers, 0)
  t.mock.timers.tick(419)
  assert.equal(inst.data.modalShow, false)
  t.mock.timers.tick(1)
  assert.equal(inst.data.modalShow, true)
  assert.equal(hub.promptState, 'custom')

  detach(config, inst)
})

test('页面隐藏释放阻塞；再次显示重新持有，不泄漏计数', async (t) => {
  useClock(t)
  const config = await loadGuardConfig()
  const { hub } = createEnv()
  const inst = createGuard(config, true)

  t.mock.timers.tick(120)
  assert.equal(hub.blockers, 1)
  hide(config, inst)
  assert.equal(hub.blockers, 0)

  show(config, inst)
  assert.equal(hub.blockers, 1)
  t.mock.timers.tick(500)
  assert.equal(inst.data.modalShow, false)

  detach(config, inst)
  assert.equal(hub.blockers, 0)
})

test('“查看更新日志”跳转设置页 changelog，并写红点后收口', async (t) => {
  useClock(t)
  const config = await loadGuardConfig()
  const { calls, hub, storage } = createEnv()
  const inst = createGuard(config)

  t.mock.timers.tick(120)
  inst.onExtra()
  assert.deepEqual(calls.navigate, [SETTINGS_URL])
  assert.equal(storage.get(PENDING_KEY), true)
  assert.equal(hub.promptState, 'dismissed')
  assert.equal(inst.data.modalShow, false)
  detach(config, inst)
})

test('applyUpdate 抛异常时写红点并提示，不崩溃', async (t) => {
  useClock(t)
  const config = await loadGuardConfig()
  const { calls, hub, storage } = createEnv()
  hub.updateManager = {
    applyUpdate() {
      throw new Error('apply failed')
    },
  }
  const inst = createGuard(config)

  t.mock.timers.tick(120)
  assert.doesNotThrow(() => inst.onConfirm())
  assert.equal(storage.get(PENDING_KEY), true)
  assert.ok(calls.toast.some((item) => /重启失败/.test(item.title)))
  assert.equal(hub.promptState, 'dismissed')
  detach(config, inst)
})

test('更新管理器缺失时写红点并提示', async (t) => {
  useClock(t)
  const config = await loadGuardConfig()
  const { calls, hub, storage } = createEnv()
  hub.updateManager = null
  const inst = createGuard(config)

  t.mock.timers.tick(120)
  inst.onConfirm()
  assert.equal(storage.get(PENDING_KEY), true)
  assert.ok(calls.toast.some((item) => /新版本已就绪/.test(item.title)))
  detach(config, inst)
})

test('原生弹窗失败时写红点、Toast、并停止重复呼出', async (t) => {
  useClock(t)
  const config = await loadGuardConfig()
  const { calls, hub, storage } = createEnv()
  const inst = createGuard(config)

  t.mock.timers.tick(120)
  t.mock.timers.tick(1500)
  t.mock.timers.tick(40)
  const options = calls.modal[0]
  options.fail({ errMsg: 'showModal:fail' })
  options.complete()

  assert.equal(storage.get(PENDING_KEY), true)
  assert.ok(calls.toast.some((item) => /新版本已就绪/.test(item.title)))
  assert.equal(hub.promptState, 'dismissed')
  fireUpdateReady(hub)
  t.mock.timers.tick(500)
  assert.equal(inst.data.modalShow, false)
  assert.equal(calls.modal.length, 1)
  detach(config, inst)
})

test('自定义阶段页面隐藏归还锁；原生阶段隐藏保持状态等回调', async (t) => {
  useClock(t)
  const config = await loadGuardConfig()

  const customEnv = createEnv()
  const custom = createGuard(config)
  t.mock.timers.tick(120)
  hide(config, custom)
  assert.equal(customEnv.hub.promptState, 'idle')
  assert.equal(customEnv.hub.promptOwner, '')
  assert.equal(custom.data.modalShow, false)
  detach(config, custom)

  const nativeEnv = createEnv()
  const native = createGuard(config)
  t.mock.timers.tick(120)
  t.mock.timers.tick(1500)
  t.mock.timers.tick(40)
  assert.equal(nativeEnv.hub.promptState, 'native')
  hide(config, native)
  assert.equal(nativeEnv.hub.promptState, 'native')

  const options = nativeEnv.calls.modal[0]
  options.success({ confirm: false, cancel: true })
  options.complete()
  assert.equal(nativeEnv.storage.get(PENDING_KEY), true)
  assert.equal(nativeEnv.hub.promptState, 'dismissed')
  detach(config, native)
})

test('页面销毁后交还全局锁，下一个页面可继续接管', async (t) => {
  useClock(t)
  const config = await loadGuardConfig()
  const { hub } = createEnv()
  const first = createGuard(config)
  t.mock.timers.tick(120)
  assert.equal(hub.promptState, 'custom')

  detach(config, first)
  assert.equal(hub.promptState, 'idle')
  assert.equal(hub.promptOwner, '')
  assert.equal(hub.updateReadyListeners.length, 0)

  const second = createGuard(config)
  t.mock.timers.tick(120)
  assert.equal(second.data.modalShow, true)
  assert.equal(hub.promptOwner, second.token)
  detach(config, second)
})

test('极早启动 getApp 不可用时，页面 show 补绑监听器', async (t) => {
  useClock(t)
  const config = await loadGuardConfig()
  const { hub } = createEnv()
  const originalGetApp = globalThis.getApp
  globalThis.getApp = () => {
    throw new Error('app not ready')
  }

  const inst = createGuard(config, false, false)
  assert.equal(hub.updateReadyListeners.length, 0)

  globalThis.getApp = originalGetApp
  show(config, inst)
  assert.equal(hub.updateReadyListeners.length, 1)

  hub.hasUpdate = true
  fireUpdateReady(hub)
  assert.equal(inst.data.modalShow, true)
  detach(config, inst)
})

test('阻塞计数归零后延迟 420ms 广播，期间不重复通知', async (t) => {
  useClock(t)
  const service = await loadService()
  const { hub } = createEnv()
  let notified = 0
  hub.updateReadyListeners.push(() => {
    notified += 1
  })

  service.holdUpdatePrompt(hub)
  service.holdUpdatePrompt(hub)
  assert.equal(hub.blockers, 2)

  service.releaseUpdatePrompt(hub)
  t.mock.timers.tick(420)
  assert.equal(notified, 0)

  service.releaseUpdatePrompt(hub)
  t.mock.timers.tick(419)
  assert.equal(notified, 0)
  t.mock.timers.tick(1)
  assert.equal(notified, 1)
})

test('新版本晚到：页面已显示时由全局监听器唤醒', async (t) => {
  useClock(t)
  const config = await loadGuardConfig()
  const { hub } = createEnv(false)
  const inst = createGuard(config)

  t.mock.timers.tick(120)
  assert.equal(inst.data.modalShow, false)

  hub.hasUpdate = true
  t.mock.timers.tick(600)
  assert.equal(inst.data.modalShow, false)

  fireUpdateReady(hub)
  assert.equal(inst.data.modalShow, true)
  assert.equal(hub.promptState, 'custom')
  detach(config, inst)
})
