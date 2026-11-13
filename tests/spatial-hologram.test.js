/* ==========================================================================
   spatial-hologram 单元测试
   - 用 Node TypeScript 类型擦除 + 动态 import 载入组件，不依赖小程序运行时
   - 覆盖：监听启动 / 基线校准 / 角度钳制 / 阻尼配置 / 禁用 / 隐藏 / 销毁
   - 覆盖 WXS：单实例阻尼循环 / 不叠加 rAF / 无动画环境直接落位
   - 运行：npm run test:hologram
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { pathToFileURL } = require('node:url')
const { registerHooks } = require('node:module')

const ROOT = path.resolve(__dirname, '..')
const COMPONENT_PATH = path.join(ROOT, 'subpackages/tools-core/components/spatial-hologram/index.ts')
const WXS_PATH = path.join(ROOT, 'subpackages/tools-core/components/spatial-hologram/hologram.wxs')

/* 组件内部新增了无扩展名 TS 依赖；Node 侧统一补 .ts 再解析 */
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

let cachedDefinition = null

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function createWxMock(options = {}) {
  const listeners = new Set()
  const calls = {
    start: 0,
    stop: 0,
    on: 0,
    off: 0,
  }

  const wx = {
    startDeviceMotionListening(option) {
      calls.start += 1
      if (options.failStart) {
        if (option && typeof option.fail === 'function') {
          option.fail({ errMsg: 'startDeviceMotionListening:fail' })
        }
        return
      }
      if (option && typeof option.success === 'function') {
        option.success()
      }
    },

    stopDeviceMotionListening(option) {
      calls.stop += 1
      if (option && typeof option.success === 'function') {
        option.success()
      }
    },

    onDeviceMotionChange(handler) {
      calls.on += 1
      listeners.add(handler)
    },

    offDeviceMotionChange(handler) {
      calls.off += 1
      listeners.delete(handler)
    },

    emitMotion(result) {
      listeners.forEach((handler) => handler(result))
    },

    listenerCount() {
      return listeners.size
    },

    calls,
  }

  return wx
}

async function loadComponentDefinition(options = {}) {
  const wx = createWxMock(options)

  // 组件方法在测试执行时才访问全局 wx，因此每次都要把当前 mock 放到全局
  globalThis.wx = wx

  if (!cachedDefinition) {
    let definition = null
    const previousComponent = globalThis.Component

    globalThis.Component = (config) => {
      definition = config
    }

    const target = pathToFileURL(COMPONENT_PATH).href

    try {
      await import(target)
    } finally {
      globalThis.Component = previousComponent
    }

    if (!definition) {
      throw new Error('Component definition was not captured')
    }
    cachedDefinition = definition
  }

  return { definition: cachedDefinition, wx }
}

function createInstance(definition, overrides = {}) {
  const properties = definition.properties || {}
  const data = {}

  Object.keys(properties).forEach((key) => {
    const conf = properties[key]
    data[key] = conf && 'value' in conf ? clone(conf.value) : undefined
  })

  const componentData = definition.data || {}
  Object.keys(componentData).forEach((key) => {
    data[key] = clone(componentData[key])
  })

  Object.keys(overrides).forEach((key) => {
    data[key] = overrides[key]
  })

  const instance = {
    data,
    setDataCalls: [],
    eventCalls: [],
  }

  instance.setData = function (patch) {
    this.setDataCalls.push(clone(patch))
    Object.keys(patch).forEach((key) => {
      this.data[key] = patch[key]
    })
  }

  instance.triggerEvent = function (name, detail) {
    this.eventCalls.push({ name, detail })
  }

  const methods = definition.methods || {}
  Object.keys(methods).forEach((name) => {
    instance[name] = methods[name].bind(instance)
  })

  return instance
}

function attach(instance, definition) {
  definition.lifetimes.attached.call(instance)
}

function detach(instance, definition) {
  definition.lifetimes.detached.call(instance)
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function lastTiltConfig(instance) {
  return instance.data.tiltConfig
}

test('attached 自动启动监听并写入 motionActive', async () => {
  const { definition, wx } = await loadComponentDefinition()
  const instance = createInstance(definition)

  attach(instance, definition)

  assert.equal(wx.calls.start, 1)
  assert.equal(wx.listenerCount(), 1)
  assert.equal(instance.data.motionActive, true)
})

test('autoStart=false 时不启动监听', async () => {
  const { definition, wx } = await loadComponentDefinition()
  const instance = createInstance(definition, { autoStart: false })

  attach(instance, definition)

  assert.equal(wx.calls.start, 0)
  assert.equal(wx.listenerCount(), 0)
  assert.equal(instance.data.motionActive, false)
})

test('首帧只建立基线，不立即改变 tiltConfig', async () => {
  const { definition, wx } = await loadComponentDefinition()
  const instance = createInstance(definition, { maxTilt: 8, sensitivity: 0.35 })

  attach(instance, definition)

  const before = lastTiltConfig(instance)
  wx.emitMotion({ alpha: 0, beta: 0.12, gamma: -0.08 })

  await wait(50)

  const after = lastTiltConfig(instance)
  assert.equal(after.targetX, before.targetX)
  assert.equal(after.targetY, before.targetY)
})

test('第二帧按 beta/gamma 增量计算并钳制到 maxTilt', async () => {
  const { definition, wx } = await loadComponentDefinition()
  const instance = createInstance(definition, {
    maxTilt: 4,
    sensitivity: 0.5,
    damping: 0.2,
  })

  attach(instance, definition)

  wx.emitMotion({ alpha: 0, beta: 0.2, gamma: -0.1 })
  wx.emitMotion({ alpha: 0, beta: 0.8, gamma: 0.6 })

  await wait(80)

  const config = lastTiltConfig(instance)
  assert.ok(config.targetX >= -4 && config.targetX <= 4)
  assert.ok(config.targetY >= -4 && config.targetY <= 4)
  assert.equal(config.damping, 0.2)
  assert.ok(config.epoch > 0)
})

test('damping 属性会被钳制到 0.05–0.5', async () => {
  const { definition } = await loadComponentDefinition()
  const instance = createInstance(definition, { damping: 2 })

  attach(instance, definition)
  definition.observers.damping.call(instance, 2)

  assert.equal(lastTiltConfig(instance).damping, 0.5)
})

test('enabled=false 会停止监听并回正', async () => {
  const { definition, wx } = await loadComponentDefinition()
  const instance = createInstance(definition)

  attach(instance, definition)
  definition.observers.enabled.call(instance, false)

  assert.equal(wx.calls.off, 1)
  assert.equal(wx.calls.stop, 1)
  assert.equal(wx.listenerCount(), 0)
  assert.equal(instance.data.motionActive, false)
  assert.equal(lastTiltConfig(instance).targetX, 0)
  assert.equal(lastTiltConfig(instance).targetY, 0)
})

test('页面 hide 会停止监听并按 resetOnHide 回正', async () => {
  const { definition, wx } = await loadComponentDefinition()
  const instance = createInstance(definition, { resetOnHide: true })

  attach(instance, definition)
  definition.pageLifetimes.hide.call(instance)

  assert.equal(wx.calls.off, 1)
  assert.equal(wx.calls.stop, 1)
  assert.equal(instance.data.motionActive, false)
  assert.equal(lastTiltConfig(instance).targetX, 0)
  assert.equal(lastTiltConfig(instance).targetY, 0)
})

test('页面 hide 且 resetOnHide=false 时保留当前目标角度', async () => {
  const { definition } = await loadComponentDefinition()
  const instance = createInstance(definition, { resetOnHide: false })

  attach(instance, definition)
  const before = lastTiltConfig(instance)
  definition.pageLifetimes.hide.call(instance)

  const after = lastTiltConfig(instance)
  assert.equal(after.targetX, before.targetX)
  assert.equal(after.targetY, before.targetY)
})

test('detached 会清理待提交的节流定时器', async () => {
  const { definition, wx } = await loadComponentDefinition()
  const instance = createInstance(definition)

  attach(instance, definition)
  wx.emitMotion({ alpha: 0, beta: 0.2, gamma: -0.1 })
  wx.emitMotion({ alpha: 0, beta: 0.8, gamma: 0.6 })

  const callsBeforeDetach = instance.setDataCalls.length
  detach(instance, definition)

  await wait(80)

  assert.equal(instance.setDataCalls.length, callsBeforeDetach)
  assert.equal(wx.listenerCount(), 0)
})

test('startDeviceMotionListening 失败时安全降级', async () => {
  const { definition, wx } = await loadComponentDefinition({ failStart: true })
  const instance = createInstance(definition)

  attach(instance, definition)

  assert.equal(instance.data.motionActive, false)
  assert.equal(wx.listenerCount(), 0)
})

test('WXS：阻尼循环收敛并直接 setStyle', () => {
  const source = fs.readFileSync(WXS_PATH, 'utf8')
  const moduleRef = { exports: {} }
  const context = {
    module: moduleRef,
    exports: moduleRef.exports,
    Math,
    Number,
    Boolean,
    console,
  }
  vm.createContext(context)
  vm.runInContext(source, context)

  const styles = []
  const frames = []
  const state = {}
  const scene = {
    setStyle(style) {
      styles.push(style)
    },
  }
  const owner = {
    getState() {
      return state
    },
    setState(next) {
      Object.assign(state, next)
    },
    selectComponent() {
      return scene
    },
    requestAnimationFrame(callback) {
      frames.push(callback)
    },
  }

  moduleRef.exports.onTiltChange({ targetX: 10, targetY: -5, damping: 0.2 }, null, owner)
  moduleRef.exports.onTiltChange({ targetX: 0, targetY: 0, damping: 0.2 }, null, owner)

  let steps = 0
  while (frames.length > 0 && steps < 200) {
    const frame = frames.shift()
    frame(0)
    steps += 1
  }

  assert.equal(state.running, false)
  assert.ok(steps > 0)
  const last = styles[styles.length - 1]
  assert.match(last.transform, /rotateX\(0\.000deg\)/)
  assert.match(last.transform, /rotateY\(0\.000deg\)/)
})

test('WXS：运行中重复下发目标不会叠加 rAF 循环', () => {
  const source = fs.readFileSync(WXS_PATH, 'utf8')
  const moduleRef = { exports: {} }
  const context = {
    module: moduleRef,
    exports: moduleRef.exports,
    Math,
    Number,
    Boolean,
    console,
  }
  vm.createContext(context)
  vm.runInContext(source, context)

  const frames = []
  const state = {}
  const scene = { setStyle() {} }
  const owner = {
    getState() {
      return state
    },
    setState(next) {
      Object.assign(state, next)
    },
    selectComponent() {
      return scene
    },
    requestAnimationFrame(callback) {
      frames.push(callback)
    },
  }

  moduleRef.exports.onTiltChange({ targetX: 10, targetY: 0, damping: 0.2 }, null, owner)
  moduleRef.exports.onTiltChange({ targetX: 0, targetY: 0, damping: 0.2 }, null, owner)
  moduleRef.exports.onTiltChange({ targetX: 20, targetY: 0, damping: 0.2 }, null, owner)

  assert.equal(frames.length, 1)
  assert.equal(state.running, true)
  assert.equal(state.targetX, 20)
})

test('WXS：缺少 rAF / getState 时直接应用终值', () => {
  const source = fs.readFileSync(WXS_PATH, 'utf8')
  const moduleRef = { exports: {} }
  const context = {
    module: moduleRef,
    exports: moduleRef.exports,
    Math,
    Number,
    Boolean,
    console,
  }
  vm.createContext(context)
  vm.runInContext(source, context)

  const styles = []
  const owner = {
    selectComponent() {
      return {
        setStyle(style) {
          styles.push(style)
        },
      }
    },
  }

  moduleRef.exports.onTiltChange({ targetX: 6, targetY: -3, damping: 0.2 }, null, owner)

  assert.equal(styles.length, 1)
  assert.match(styles[0].transform, /rotateX\(6\.000deg\)/)
  assert.match(styles[0].transform, /rotateY\(-3\.000deg\)/)
})
