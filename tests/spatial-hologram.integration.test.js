/* ==========================================================================
   spatial-hologram 集成测试
   - 模拟宿主页面：多实例挂载、页面 show/hide、单实例禁用/卸载
   - 验证多实例传感器监听、基线、节流、定时器与生命周期互不串扰
   - 验证 WXS 多 ownerInstance 状态隔离
   - 运行：npm run test:integration:hologram
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const {
  createWxMock,
  loadComponentDefinition,
  createInstance,
  attach,
  detach,
  wait,
  lastTiltConfig,
} = require('./helpers/spatial-hologram-harness')

const WXS_PATH = path.resolve(
  __dirname,
  '../subpackages/tools-core/components/spatial-hologram/hologram.wxs',
)

function createHostPage(definition) {
  const mounted = []

  return {
    mount(instance) {
      if (mounted.includes(instance)) {
        return
      }
      attach(instance, definition)
      mounted.push(instance)
    },

    show() {
      mounted.forEach((instance) => {
        definition.pageLifetimes.show.call(instance)
      })
    },

    hide() {
      mounted.forEach((instance) => {
        definition.pageLifetimes.hide.call(instance)
      })
    },

    unmount(instance) {
      const index = mounted.indexOf(instance)
      if (index < 0) {
        return
      }
      mounted.splice(index, 1)
      detach(instance, definition)
    },

    unmountAll() {
      [...mounted].forEach((instance) => {
        detach(instance, definition)
      })
      mounted.length = 0
    },

    count() {
      return mounted.length
    },
  }
}

function createWxsOwner() {
  const frames = []
  const styles = []
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
  return { owner, frames, styles, state }
}

function runFrames(frames, maxSteps = 300) {
  let steps = 0
  while (frames.length > 0 && steps < maxSteps) {
    const frame = frames.shift()
    frame(0)
    steps += 1
  }
  return steps
}

test('同一页面挂载两个实例：监听、基线与角度互不串扰', async () => {
  const wx = createWxMock()
  const { definition } = await loadComponentDefinition(wx)
  const page = createHostPage(definition)

  const a = createInstance(definition, {
    maxTilt: 4,
    sensitivity: 0.2,
    damping: 0.2,
  })
  const b = createInstance(definition, {
    maxTilt: 12,
    sensitivity: 0.8,
    damping: 0.2,
  })

  page.mount(a)
  page.mount(b)

  assert.equal(wx.calls.start, 2)
  assert.equal(wx.listenerCount(), 2)
  assert.equal(a.data.motionActive, true)
  assert.equal(b.data.motionActive, true)

  wx.emitMotion({ alpha: 0, beta: 0.2, gamma: 0.1 })
  wx.emitMotion({ alpha: 0, beta: 0.9, gamma: -0.4 })
  await wait(80)

  const tiltA = lastTiltConfig(a)
  const tiltB = lastTiltConfig(b)

  assert.ok(tiltA.targetX >= -4 && tiltA.targetX <= 4)
  assert.ok(tiltA.targetY >= -4 && tiltA.targetY <= 4)
  assert.ok(tiltB.targetX >= -12 && tiltB.targetX <= 12)
  assert.ok(tiltB.targetY >= -12 && tiltB.targetY <= 12)
  assert.notEqual(tiltA.targetX, tiltB.targetX)
  assert.notEqual(tiltA.targetY, tiltB.targetY)

  page.unmountAll()
  assert.equal(wx.listenerCount(), 0)
})

test('页面 hide / show 同时作用于所有实例', async () => {
  const wx = createWxMock()
  const { definition } = await loadComponentDefinition(wx)
  const page = createHostPage(definition)

  const a = createInstance(definition)
  const b = createInstance(definition)

  page.mount(a)
  page.mount(b)
  assert.equal(wx.listenerCount(), 2)

  page.hide()

  assert.equal(wx.calls.off, 2)
  assert.equal(wx.calls.stop, 2)
  assert.equal(wx.listenerCount(), 0)
  assert.equal(a.data.motionActive, false)
  assert.equal(b.data.motionActive, false)
  assert.equal(lastTiltConfig(a).targetX, 0)
  assert.equal(lastTiltConfig(b).targetX, 0)

  page.show()

  assert.equal(wx.calls.start, 4)
  assert.equal(wx.listenerCount(), 2)
  assert.equal(a.data.motionActive, true)
  assert.equal(b.data.motionActive, true)

  page.unmountAll()
  assert.equal(wx.listenerCount(), 0)
})

test('单实例 enabled=false 不影响同页其它实例', async () => {
  const wx = createWxMock()
  const { definition } = await loadComponentDefinition(wx)
  const page = createHostPage(definition)

  const a = createInstance(definition)
  const b = createInstance(definition)

  page.mount(a)
  page.mount(b)
  assert.equal(wx.listenerCount(), 2)

  definition.observers.enabled.call(a, false)

  assert.equal(wx.listenerCount(), 1)
  assert.equal(a.data.motionActive, false)
  assert.equal(b.data.motionActive, true)
  assert.equal(lastTiltConfig(a).targetX, 0)

  wx.emitMotion({ alpha: 0, beta: 0.2, gamma: 0.1 })
  wx.emitMotion({ alpha: 0, beta: 0.9, gamma: -0.4 })
  await wait(80)

  assert.ok(lastTiltConfig(b).targetX !== 0)

  page.unmountAll()
  assert.equal(wx.listenerCount(), 0)
})

test('卸载一个实例后另一个实例继续接收传感器', async () => {
  const wx = createWxMock()
  const { definition } = await loadComponentDefinition(wx)
  const page = createHostPage(definition)

  const a = createInstance(definition)
  const b = createInstance(definition)

  page.mount(a)
  page.mount(b)
  assert.equal(wx.listenerCount(), 2)

  page.unmount(a)

  assert.equal(wx.listenerCount(), 1)
  assert.equal(b.data.motionActive, true)

  wx.emitMotion({ alpha: 0, beta: 0.2, gamma: 0.1 })
  wx.emitMotion({ alpha: 0, beta: 0.9, gamma: -0.4 })
  await wait(80)

  assert.ok(lastTiltConfig(b).targetX !== 0)

  page.unmountAll()
  assert.equal(wx.listenerCount(), 0)
})

test('多次挂载 / 卸载不泄漏监听器', async () => {
  const wx = createWxMock()
  const { definition } = await loadComponentDefinition(wx)

  for (let index = 0; index < 4; index += 1) {
    const instance = createInstance(definition)
    attach(instance, definition)
    assert.equal(wx.listenerCount(), 1)
    assert.equal(instance.data.motionActive, true)

    detach(instance, definition)
    assert.equal(wx.listenerCount(), 0)
  }

  assert.equal(wx.calls.on, 4)
  assert.equal(wx.calls.off, 4)
})

test('单实例 hide 清理自己的定时器，不打断另一个实例', async () => {
  const wx = createWxMock()
  const { definition } = await loadComponentDefinition(wx)
  const page = createHostPage(definition)

  const a = createInstance(definition, { resetOnHide: true })
  const b = createInstance(definition, { resetOnHide: true })

  page.mount(a)
  page.mount(b)

  wx.emitMotion({ alpha: 0, beta: 0.2, gamma: 0.1 })
  wx.emitMotion({ alpha: 0, beta: 0.9, gamma: -0.4 })

  await wait(10)
  definition.pageLifetimes.hide.call(a)

  assert.equal(wx.listenerCount(), 1)
  assert.equal(lastTiltConfig(a).targetX, 0)
  assert.equal(lastTiltConfig(a).targetY, 0)

  await wait(80)

  assert.ok(lastTiltConfig(b).targetX !== 0)
  assert.ok(lastTiltConfig(b).targetY !== 0)

  page.unmountAll()
  assert.equal(wx.listenerCount(), 0)
})

test('同页实例可使用不同的 resetOnHide 策略', async () => {
  const wx = createWxMock()
  const { definition } = await loadComponentDefinition(wx)
  const page = createHostPage(definition)

  const a = createInstance(definition, { resetOnHide: true })
  const b = createInstance(definition, { resetOnHide: false })

  page.mount(a)
  page.mount(b)

  wx.emitMotion({ alpha: 0, beta: 0.2, gamma: 0.1 })
  wx.emitMotion({ alpha: 0, beta: 0.9, gamma: -0.4 })
  await wait(80)

  const beforeB = lastTiltConfig(b)
  page.hide()

  assert.equal(lastTiltConfig(a).targetX, 0)
  assert.equal(lastTiltConfig(a).targetY, 0)
  assert.equal(lastTiltConfig(b).targetX, beforeB.targetX)
  assert.equal(lastTiltConfig(b).targetY, beforeB.targetY)

  page.unmountAll()
})

test('页面卸载后停止监听并清理所有实例', async () => {
  const wx = createWxMock()
  const { definition } = await loadComponentDefinition(wx)
  const page = createHostPage(definition)

  const a = createInstance(definition)
  const b = createInstance(definition)

  page.mount(a)
  page.mount(b)
  wx.emitMotion({ alpha: 0, beta: 0.2, gamma: 0.1 })
  wx.emitMotion({ alpha: 0, beta: 0.9, gamma: -0.4 })

  page.hide()

  const aCalls = a.setDataCalls.length
  const bCalls = b.setDataCalls.length

  page.unmountAll()
  await wait(80)

  assert.equal(wx.listenerCount(), 0)
  assert.equal(a.setDataCalls.length, aCalls)
  assert.equal(b.setDataCalls.length, bCalls)
})

test('WXS 多实例状态隔离：各自收敛到各自目标', () => {
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

  const first = createWxsOwner()
  const second = createWxsOwner()

  moduleRef.exports.onTiltChange(
    { targetX: 10, targetY: -5, damping: 0.2 },
    null,
    first.owner,
  )
  moduleRef.exports.onTiltChange(
    { targetX: -12, targetY: 8, damping: 0.2 },
    null,
    second.owner,
  )

  assert.equal(first.state.targetX, 10)
  assert.equal(first.state.targetY, -5)
  assert.equal(second.state.targetX, -12)
  assert.equal(second.state.targetY, 8)

  assert.match(first.styles[0].transform, /rotateX\(10\.000deg\)/)
  assert.match(first.styles[0].transform, /rotateY\(-5\.000deg\)/)
  assert.match(second.styles[0].transform, /rotateX\(-12\.000deg\)/)
  assert.match(second.styles[0].transform, /rotateY\(8\.000deg\)/)

  moduleRef.exports.onTiltChange(
    { targetX: 0, targetY: 0, damping: 0.2 },
    null,
    first.owner,
  )
  runFrames(first.frames)
  runFrames(second.frames)

  assert.equal(first.state.running, false)
  assert.match(first.styles[first.styles.length - 1].transform, /rotateX\(0\.000deg\)/)
  assert.equal(second.state.targetX, -12)
})
