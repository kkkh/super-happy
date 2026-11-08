/* ==========================================================================
   glass-slider · 手势与防抖单元测试
   - 静态断言：catchtouchmove 阻断页面滚动
   - 行为断言：32ms 节流、拖动中只发 input、松手才发 change
   - 边界断言：松手补算最终位置、disabled、touchcancel、越界钳制
   - 运行：npm test
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { registerHooks } = require('node:module')

const ROOT = path.resolve(__dirname, '..')
const SLIDER_DIR = path.join(ROOT, 'components/glass-slider')
const WXML_PATH = path.join(SLIDER_DIR, 'index.wxml')
const MODULE_PATH = path.join(SLIDER_DIR, 'index.ts')

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

const wxCalls = { vibrate: 0 }

function installWxMock() {
  globalThis.wx = {
    env: { USER_DATA_PATH: '' },
    vibrateShort() {
      wxCalls.vibrate += 1
    },
    getDeviceInfo() {
      return { platform: 'node' }
    },
    getSystemInfoSync() {
      return { platform: 'node' }
    },
    getStorageSync() {
      return ''
    },
    setStorageSync() {}
  }
}

async function loadPreference() {
  return import(pathToFileURL(path.join(ROOT, 'core/stores/preference.ts')).href)
}

let cachedDefinition = null

async function loadSliderDefinition() {
  installWxMock()
  const preference = await loadPreference()
  /* 关闭音效，避免测试触碰音频写入路径 */
  preference.preferenceStore.sound = false

  if (cachedDefinition) {
    return cachedDefinition
  }

  let definition = null
  const previousComponent = globalThis.Component
  globalThis.Component = (config) => {
    definition = config
  }

  try {
    await import(pathToFileURL(MODULE_PATH).href)
  } finally {
    globalThis.Component = previousComponent
  }

  if (!definition) {
    throw new Error('slider component definition was not captured')
  }
  cachedDefinition = definition
  return definition
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function createSlider(definition, overrides = {}, rect = { left: 0, width: 300 }) {
  const properties = definition.properties || {}
  const props = {}
  Object.keys(properties).forEach((key) => {
    const config = properties[key]
    props[key] = config && 'value' in config ? clone(config.value) : undefined
  })

  const data = { ...clone(definition.data || {}), ...props, ...overrides }
  const setDataCalls = []
  const events = []

  const query = {
    select() {
      return query
    },
    boundingClientRect(callback) {
      callback(rect)
      return query
    },
    exec() {
      return query
    },
  }

  const instance = {
    data,
    setData(patch) {
      setDataCalls.push(clone(patch))
      Object.assign(this.data, patch)
    },
    triggerEvent(name, detail) {
      events.push({ name, detail: clone(detail) })
    },
    createSelectorQuery() {
      return query
    },
    setDataCalls,
    events,
  }

  const methods = definition.methods || {}
  Object.keys(methods).forEach((name) => {
    instance[name] = methods[name].bind(instance)
  })

  if (definition.lifetimes && definition.lifetimes.attached) {
    definition.lifetimes.attached.call(instance)
  }
  if (definition.lifetimes && definition.lifetimes.ready) {
    definition.lifetimes.ready.call(instance)
  }

  return instance
}

function touchEvent(clientX) {
  return {
    touches: [{ clientX }],
    changedTouches: [{ clientX }],
  }
}

function eventsOf(instance, name) {
  return instance.events.filter((event) => event.name === name)
}

function withFakeClock(start, run) {
  const originalNow = Date.now
  let now = start
  Date.now = () => now
  try {
    return run({
      advance(delta) {
        now += delta
      },
      now() {
        return now
      },
    })
  } finally {
    Date.now = originalNow
  }
}

test('WXML：滑轨必须使用 catchtouchmove 阻断滚动', () => {
  const source = fs.readFileSync(WXML_PATH, 'utf8')
  assert.match(source, /catchtouchmove="onTouchMove"/)
  assert.match(source, /bindtouchstart="onTouchStart"/)
  assert.match(source, /bindtouchend="onTouchEnd"/)
  assert.match(source, /bindtouchcancel="onTouchCancel"/)
})

test('滑块防抖：32ms 内的连续拖动不重复 setData / input', async () => {
  const definition = await loadSliderDefinition()

  await withFakeClock(1000, async (clock) => {
    const slider = createSlider(definition)

    slider.onTouchStart(touchEvent(0))
    assert.equal(eventsOf(slider, 'input').length, 1)

    /* 第一次 move 距 start 已超过 32ms，正常放行 */
    slider.onTouchMove(touchEvent(30))
    assert.equal(eventsOf(slider, 'input').length, 2)

    /* 同一毫秒内高频拖动：必须被节流丢弃 */
    slider.onTouchMove(touchEvent(120))
    slider.onTouchMove(touchEvent(300))
    assert.equal(eventsOf(slider, 'input').length, 2)
    assert.equal(eventsOf(slider, 'change').length, 0)

    clock.advance(40)
    slider.onTouchMove(touchEvent(300))
    assert.equal(eventsOf(slider, 'input').length, 3)

    slider.onTouchEnd(touchEvent(300))
    assert.equal(eventsOf(slider, 'change').length, 1)
    assert.deepEqual(eventsOf(slider, 'change')[0].detail, { value: 2 })
    assert.equal(slider.data.percent, 100)
    assert.equal(slider.data.displayValue, '2')
    assert.equal(slider.data.dragging, false)
  })
})

test('滑块防抖：最后一次 move 被节流时，touchend 仍补算最终值', async () => {
  const definition = await loadSliderDefinition()

  await withFakeClock(1000, async (clock) => {
    const slider = createSlider(definition)

    slider.onTouchStart(touchEvent(0))
    slider.onTouchMove(touchEvent(30))
    clock.advance(5)
    slider.onTouchMove(touchEvent(300))
    assert.equal(eventsOf(slider, 'input').length, 2)

    slider.onTouchEnd(touchEvent(300))
    const changes = eventsOf(slider, 'change')
    assert.equal(changes.length, 1)
    assert.deepEqual(changes[0].detail, { value: 2 })
    assert.equal(slider.data.percent, 100)
  })
})

test('滑块边界：disabled 时完全忽略手势', async () => {
  const definition = await loadSliderDefinition()
  const slider = createSlider(definition, { disabled: true })

  slider.onTouchStart(touchEvent(0))
  slider.onTouchMove(touchEvent(300))
  slider.onTouchEnd(touchEvent(300))

  assert.equal(slider.events.length, 0)
  assert.equal(slider.data.dragging, false)
  assert.equal(slider.data.percent, 0)
})

test('滑块边界：touchcancel 以最后有效值提交 change', async () => {
  const definition = await loadSliderDefinition()
  const slider = createSlider(definition)

  slider.onTouchStart(touchEvent(150))
  slider.onTouchCancel()

  const changes = eventsOf(slider, 'change')
  assert.equal(changes.length, 1)
  assert.deepEqual(changes[0].detail, { value: 1 })
  assert.equal(slider.data.dragging, false)
})

test('滑块边界：外部传值越界时钳制到 min / max', async () => {
  const definition = await loadSliderDefinition()

  const high = createSlider(definition, { value: 5 })
  assert.equal(high.data.percent, 100)
  assert.equal(high.data.displayValue, '2')

  const low = createSlider(definition, { value: -3 })
  assert.equal(low.data.percent, 0)
  assert.equal(low.data.displayValue, '0')
})
