/* ==========================================================================
   水印工作台 · WXS 手势内核回归
   - 静态红线：WXS 事件必须用 {{}} 绑定、Skyline 坐标必须走 data-box-*、禁止 setState
   - 行为断言：拖拽落点、双指 2× 焦点补偿、框选矩形、取消复位
   - 运行：npm test
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '..')
const PAGE_DIR = path.join(ROOT, 'subpackages/tools-media/pages/watermark')
const WXS_PATH = path.join(PAGE_DIR, 'gesture.wxs')
const WXML_PATH = path.join(PAGE_DIR, 'index.wxml')

function loadGesture() {
  const code = fs.readFileSync(WXS_PATH, 'utf8')
  const sandbox = { module: { exports: {} }, exports: {}, console }
  vm.createContext(sandbox)
  vm.runInContext(code, sandbox)
  return sandbox.module.exports
}

function createOwner() {
  const styles = []
  const calls = []
  const owner = {
    styles,
    calls,
    selectComponent(selector) {
      return {
        selector,
        setStyle(style) {
          styles.push({ selector, style })
        },
      }
    },
    callMethod(name, detail) {
      calls.push({ name, detail })
    },
  }
  return owner
}

function box(dataset = {}) {
  return {
    currentTarget: {
      dataset,
      offsetLeft: 0,
      offsetTop: 0,
      offsetWidth: 0,
      offsetHeight: 0,
    },
  }
}

function touch(x, y, identifier = 1) {
  return { identifier, clientX: x, clientY: y, pageX: x, pageY: y }
}

const CONFIG = {
  enabled: true,
  mode: 'move',
  active: 'text',
  x: 50,
  y: 50,
  scale: 1,
  rotation: 0,
}

test('静态红线：WXS 事件绑定、Skyline 坐标、禁止 setState', () => {
  const wxml = fs.readFileSync(WXML_PATH, 'utf8')
  const wxs = fs.readFileSync(WXS_PATH, 'utf8')

  assert.ok(
    wxml.includes('bindtouchstart="{{gesture.onTouchStart}}"'),
    'WXS 事件必须用 {{}} 绑定，否则会被当成页面方法',
  )
  assert.ok(
    wxml.includes('catchtouchmove="{{gesture.onTouchMove}}"'),
    'WXS touchmove 必须用 {{}} 绑定',
  )
  assert.ok(wxml.includes('data-box-left'), '必须把手势面 left 传给 WXS')
  assert.ok(wxml.includes('data-box-top'), '必须把手势面 top 传给 WXS')
  assert.ok(wxml.includes('data-box-w'), '必须把手势面宽度传给 WXS')
  assert.ok(wxml.includes('data-box-h'), '必须把手势面高度传给 WXS')
  assert.equal(wxs.includes('ownerInstance.setState('), false, 'Skyline 页面 WXS 没有 setState')
  assert.equal(wxs.includes('ownerInstance.getState('), false, '页面 WXS 不应依赖 getState')
})

test('拖拽：读取 data-box-* 后按画布百分比落点', () => {
  const gesture = loadGesture()
  const owner = createOwner()
  const dataset = { boxLeft: 10, boxTop: 20, boxW: 200, boxH: 100 }
  const event = box(dataset)

  gesture.onConfigChange(CONFIG, null, owner)
  gesture.onTouchStart({ ...event, touches: [touch(110, 70)] }, owner)
  gesture.onTouchMove({ ...event, touches: [touch(150, 90)] }, owner)
  gesture.onTouchEnd({ ...event, touches: [], changedTouches: [touch(150, 90)] }, owner)

  const commit = owner.calls.find((call) => call.name === 'onGestureCommit')
  assert.ok(commit, '拖拽必须提交手势')
  assert.equal(commit.detail.type, 'text')
  assert.ok(Math.abs(commit.detail.x - 70) < 0.001, `x 应为 70，实际 ${commit.detail.x}`)
  assert.ok(Math.abs(commit.detail.y - 70) < 0.001, `y 应为 70，实际 ${commit.detail.y}`)
  assert.ok(
    owner.styles.some((item) => item.selector === '#wm-layer-text'),
    '拖拽必须实时 setStyle 到文字图层',
  )
})

test('双指：2× 缩放且手指中心下的焦点不漂移', () => {
  const gesture = loadGesture()
  const owner = createOwner()
  const dataset = { boxLeft: 0, boxTop: 0, boxW: 200, boxH: 200 }
  const event = box(dataset)

  gesture.onConfigChange(CONFIG, null, owner)
  gesture.onTouchStart(
    { ...event, touches: [touch(80, 100), touch(120, 100)] },
    owner,
  )
  gesture.onTouchMove(
    { ...event, touches: [touch(60, 100), touch(140, 100)] },
    owner,
  )
  gesture.onTouchEnd({ ...event, touches: [], changedTouches: [] }, owner)

  const commit = owner.calls.find((call) => call.name === 'onGestureCommit')
  assert.ok(commit, '捏合必须提交手势')
  assert.ok(Math.abs(commit.detail.scale - 2) < 0.001, `scale 应为 2，实际 ${commit.detail.scale}`)
  assert.ok(Math.abs(commit.detail.x - 50) < 0.001, `焦点 x 不应漂移，实际 ${commit.detail.x}`)
  assert.ok(Math.abs(commit.detail.y - 50) < 0.001, `焦点 y 不应漂移，实际 ${commit.detail.y}`)
})

test('框选：松手回传像素矩形并换算为有效区域', () => {
  const gesture = loadGesture()
  const owner = createOwner()
  const dataset = { boxLeft: 0, boxTop: 0, boxW: 200, boxH: 100 }
  const event = box(dataset)

  gesture.onConfigChange({ ...CONFIG, mode: 'mask', active: '' }, null, owner)
  gesture.onTouchStart({ ...event, touches: [touch(20, 20)] }, owner)
  gesture.onTouchMove({ ...event, touches: [touch(120, 80)] }, owner)
  gesture.onTouchEnd({ ...event, touches: [], changedTouches: [touch(120, 80)] }, owner)

  const commit = owner.calls.find((call) => call.name === 'onMaskCommit')
  assert.ok(commit, '框选必须提交矩形')
  assert.equal(commit.detail.x, 20)
  assert.equal(commit.detail.y, 20)
  assert.equal(commit.detail.w, 100)
  assert.equal(commit.detail.h, 60)
})

test('框选过小：视为取消，不产生打码区域', () => {
  const gesture = loadGesture()
  const owner = createOwner()
  const event = box({ boxLeft: 0, boxTop: 0, boxW: 200, boxH: 100 })

  gesture.onConfigChange({ ...CONFIG, mode: 'mask', active: '' }, null, owner)
  gesture.onTouchStart({ ...event, touches: [touch(20, 20)] }, owner)
  gesture.onTouchMove({ ...event, touches: [touch(23, 23)] }, owner)
  gesture.onTouchEnd({ ...event, touches: [], changedTouches: [touch(23, 23)] }, owner)

  assert.equal(
    owner.calls.some((call) => call.name === 'onMaskCommit'),
    false,
    '过小框选不应产生打码区域',
  )
  assert.ok(
    owner.calls.some((call) => call.name === 'onGestureCancel'),
    '过小框选必须通知页面解除手势态',
  )
})

test('取消：手势不提交，图层视觉回到配置位置', () => {
  const gesture = loadGesture()
  const owner = createOwner()
  const event = box({ boxLeft: 0, boxTop: 0, boxW: 200, boxH: 100 })

  gesture.onConfigChange(CONFIG, null, owner)
  gesture.onTouchStart({ ...event, touches: [touch(100, 50)] }, owner)
  gesture.onTouchMove({ ...event, touches: [touch(150, 90)] }, owner)
  gesture.onTouchCancel({ ...event, touches: [] }, owner)

  assert.equal(
    owner.calls.some((call) => call.name === 'onGestureCommit'),
    false,
    'touchcancel 不应提交手势',
  )
  const reset = owner.styles[owner.styles.length - 1]
  assert.equal(reset.style.left, '50.000%')
  assert.equal(reset.style.top, '50.000%')
  assert.ok(reset.style.transform.includes('scale(1.000)'))
})
