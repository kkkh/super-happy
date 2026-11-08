/* ==========================================================================
   spatial-hologram 测试 harness
   - Node TypeScript 类型擦除 + 动态 import 载入组件
   - 全局 Component / wx mock，模拟小程序组件生命周期
   - 供 unit / integration 测试复用
   ========================================================================== */
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { registerHooks } = require('node:module')

const ROOT = path.resolve(__dirname, '../..')
const COMPONENT_PATH = path.join(ROOT, 'components/spatial-hologram/index.ts')

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

async function loadComponentDefinition(wx = createWxMock()) {
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

module.exports = {
  clone,
  createWxMock,
  loadComponentDefinition,
  createInstance,
  attach,
  detach,
  wait,
  lastTiltConfig,
}
