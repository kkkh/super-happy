/* ==========================================================================
   span / watermark 流转修复 · 单元测试
   - span：单日期 / 日期范围 / 反向范围 / 纯天数 / 上下文 / 非法载荷
   - span：默认表单不误触覆盖确认，接收后 formTouched 置真
   - watermark：无图、无预览、有预览、已打开、关闭复位
   - watermark：面板打开时物理返回只关面板，不退出页面
   - 运行：npm test
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { registerHooks } = require('node:module')

const ROOT = path.resolve(__dirname, '..')
const BINDINGS_SHIM = pathToFileURL(
  path.join(__dirname, 'helpers/mobx-bindings-shim.mjs'),
).href

globalThis.Behavior = (config) => config

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

function moduleUrl(relative) {
  return pathToFileURL(path.join(ROOT, relative)).href
}

/** 最小 wx 环境：页面模块 import 时会读取主题 / 偏好 */
function installWxMock() {
  const calls = { navigateBack: 0, switchTab: 0 }
  globalThis.wx = {
    env: { USER_DATA_PATH: '' },
    getAppBaseInfo() {
      return { theme: 'dark' }
    },
    getDeviceInfo() {
      return { platform: 'node' }
    },
    getSystemInfoSync() {
      return { platform: 'node' }
    },
    getWindowInfo() {
      return {
        pixelRatio: 2,
        windowWidth: 375,
        windowHeight: 667,
        statusBarHeight: 20,
        safeArea: { bottom: 667 },
      }
    },
    getMenuButtonBoundingClientRect() {
      return { top: 26, bottom: 66, left: 278 }
    },
    getStorageSync() {
      return ''
    },
    setStorageSync() {},
    removeStorageSync() {},
    nextTick(callback) {
      callback()
    },
    vibrateShort() {},
    navigateBack() {
      calls.navigateBack += 1
    },
    switchTab() {
      calls.switchTab += 1
    },
  }
  return calls
}

let capturedPage = null
const pageCache = new Map()

async function loadPageDefinition(relative) {
  if (pageCache.has(relative)) {
    return pageCache.get(relative)
  }
  const previous = globalThis.Page
  capturedPage = null
  globalThis.Page = (config) => {
    capturedPage = config
  }
  try {
    await import(moduleUrl(relative))
  } finally {
    globalThis.Page = previous
  }
  if (!capturedPage) {
    throw new Error(`Page definition not captured: ${relative}`)
  }
  pageCache.set(relative, capturedPage)
  return capturedPage
}

function createPageInstance(definition, overrides = {}) {
  const instance = {
    data: { ...structuredClone(definition.data || {}), ...overrides },
    setDataCalls: [],
    setData(patch, callback) {
      this.setDataCalls.push(patch)
      Object.assign(this.data, patch)
      if (typeof callback === 'function') {
        callback()
      }
    },
  }
  Object.keys(definition).forEach((key) => {
    if (typeof definition[key] === 'function') {
      instance[key] = definition[key].bind(instance)
    }
  })
  return instance
}

test('span 接收：过去日期解析为「该日期 → 今天」并自动计算', async () => {
  installWxMock()
  const date = await import(moduleUrl('subpackages/tools-core/lib/date.ts'))
  const definition = await loadPageDefinition(
    'subpackages/tools-core/pages/span/index.ts',
  )
  const page = createPageInstance(definition)
  const today = date.todayISO()
  const past = date.addDays(today, -10)

  assert.equal(page.data.formTouched, false)
  assert.equal(
    page.onReceiveWorkflow({ type: 'text', payload: past }),
    true,
  )
  assert.equal(page.data.start, past)
  assert.equal(page.data.end, today)
  assert.equal(page.data.formTouched, true)
  assert.equal(page.data.hasResult, true)
  assert.equal(page.data.error, '')
})

test('span 接收：未来日期解析为「今天 → 该日期」', async () => {
  installWxMock()
  const date = await import(moduleUrl('subpackages/tools-core/lib/date.ts'))
  const definition = await loadPageDefinition(
    'subpackages/tools-core/pages/span/index.ts',
  )
  const page = createPageInstance(definition)
  const today = date.todayISO()
  const future = date.addDays(today, 15)

  assert.equal(
    page.onReceiveWorkflow({ type: 'text', payload: future }),
    true,
  )
  assert.equal(page.data.start, today)
  assert.equal(page.data.end, future)
  assert.equal(page.data.hasResult, true)
})

test('span 接收：日期范围原样落位，反向范围自动纠正', async () => {
  installWxMock()
  const definition = await loadPageDefinition(
    'subpackages/tools-core/pages/span/index.ts',
  )
  const page = createPageInstance(definition)

  assert.equal(
    page.onReceiveWorkflow({
      type: 'text',
      payload: '2027-01-01 至 2027-01-31',
    }),
    true,
  )
  assert.equal(page.data.start, '2027-01-01')
  assert.equal(page.data.end, '2027-01-31')

  assert.equal(
    page.onReceiveWorkflow({
      type: 'text',
      payload: '2027-02-28 → 2027-02-01',
    }),
    true,
  )
  assert.equal(page.data.start, '2027-02-01')
  assert.equal(page.data.end, '2027-02-28')
})

test('span 接收：纯天数以当前开始日为锚点向后推算', async () => {
  installWxMock()
  const date = await import(moduleUrl('subpackages/tools-core/lib/date.ts'))
  const definition = await loadPageDefinition(
    'subpackages/tools-core/pages/span/index.ts',
  )
  const page = createPageInstance(definition, { start: '2027-01-01' })

  assert.equal(page.onReceiveWorkflow({ type: 'text', payload: '7' }), true)
  assert.equal(page.data.start, '2027-01-01')
  assert.equal(page.data.end, date.addDays('2027-01-01', 7))
  assert.equal(page.data.calendarDays, 7)
})

test('span 接收：应用来源页的包含开始日 / 排除周末上下文', async () => {
  installWxMock()
  const definition = await loadPageDefinition(
    'subpackages/tools-core/pages/span/index.ts',
  )
  const page = createPageInstance(definition)

  assert.equal(
    page.onReceiveWorkflow({
      type: 'text',
      payload: '2027-03-01 至 2027-03-31',
      context: { spanIncludeStart: true, spanExcludeWeekend: false },
    }),
    true,
  )
  assert.equal(page.data.includeStart, true)
  assert.equal(page.data.excludeWeekend, false)
  assert.equal(page.data.calendarDays, 31)
})

test('span 接收：非法载荷 / 非法日期不污染当前表单', async () => {
  installWxMock()
  const definition = await loadPageDefinition(
    'subpackages/tools-core/pages/span/index.ts',
  )
  const page = createPageInstance(definition, {
    start: '2027-01-01',
    end: '2027-01-31',
    hasResult: true,
  })

  assert.equal(page.onReceiveWorkflow({ type: 'text', payload: 'not-a-date' }), false)
  assert.equal(page.onReceiveWorkflow({ type: 'text', payload: '2026-02-30' }), false)
  assert.equal(page.onReceiveWorkflow({ type: 'image', payload: '/tmp/a.png' }), false)
  assert.equal(page.onReceiveWorkflow({ type: 'text', payload: '   ' }), false)
  assert.equal(page.data.start, '2027-01-01')
  assert.equal(page.data.end, '2027-01-31')
  assert.equal(page.data.hasResult, true)
})

test('watermark 发起端：无图 / 无预览 / 有预览 / 已打开', async () => {
  const calls = installWxMock()
  const preference = await import(moduleUrl('core/stores/preference.ts'))
  preference.preferenceStore.sound = false
  preference.preferenceStore.haptics = 'off'
  const definition = await loadPageDefinition(
    'subpackages/tools-media/pages/watermark/index.ts',
  )

  const empty = createPageInstance(definition, { hasImage: false })
  empty.onWorkflowTap()
  assert.equal(empty.data.workflowPanelVisible, false)
  assert.equal(empty.setDataCalls.length, 0)

  const noPreview = createPageInstance(definition, {
    hasImage: true,
    previewSrc: '',
  })
  noPreview.onWorkflowTap()
  assert.equal(noPreview.data.workflowPanelVisible, false)

  const { toastStore } = await import(
    moduleUrl('components/glass-toast/toast.ts')
  )
  assert.equal(toastStore.current.message, '水印预览生成中，请稍后再试')
  toastStore.clear()

  const ready = createPageInstance(definition, {
    hasImage: true,
    previewSrc: '/tmp/watermark-preview.png',
  })
  ready.onWorkflowTap()
  assert.equal(ready.data.workflowPanelVisible, true)

  const open = createPageInstance(definition, {
    hasImage: true,
    previewSrc: '/tmp/watermark-preview.png',
    workflowPanelVisible: true,
  })
  open.onWorkflowTap()
  assert.equal(open.data.workflowPanelVisible, true)
  assert.equal(open.setDataCalls.length, 0)

  ready.onWorkflowPanelClose()
  assert.equal(ready.data.workflowPanelVisible, false)
  assert.equal(calls.navigateBack, 0)
})

test('watermark 发起端：面板打开时物理返回只关面板', async () => {
  const calls = installWxMock()
  const preference = await import(moduleUrl('core/stores/preference.ts'))
  preference.preferenceStore.sound = false
  preference.preferenceStore.haptics = 'off'
  const definition = await loadPageDefinition(
    'subpackages/tools-media/pages/watermark/index.ts',
  )

  const opened = createPageInstance(definition, { workflowPanelVisible: true })
  opened.onBack()
  assert.equal(opened.data.workflowPanelVisible, false)
  assert.equal(calls.navigateBack, 0, '面板打开时不得直接退出页面')

  const closed = createPageInstance(definition, { workflowPanelVisible: false })
  closed.onBack()
  assert.equal(calls.navigateBack, 1)
})
