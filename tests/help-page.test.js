/* ==========================================================================
   帮助页 · 单一渲染路径行为回归
   - 浏览 / 搜索共用 groups，不再维护第二份 results 卡片模板
   - 搜索为空时只标记 searchEmpty，清空后恢复全部分组
   - tool 查询参数仍能自动展开对应工具
   - 运行：npm test
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { registerHooks } = require('node:module')

const ROOT = path.resolve(__dirname, '..')
const PAGE_TS = path.join(ROOT, 'subpackages/grow/pages/help/index.ts')
const BINDINGS_SHIM = pathToFileURL(
  path.join(__dirname, 'helpers/mobx-bindings-shim.mjs'),
).href

globalThis.Behavior = (config) => config
globalThis.Component = (config) => config

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier === 'mobx-miniprogram-bindings' &&
      !String(context.parentURL || '').includes('mobx-bindings-shim')
    ) {
      return { url: BINDINGS_SHIM, shortCircuit: true }
    }
    if (specifier.startsWith('.') && !path.extname(specifier)) {
      return nextResolve(`${specifier}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})

let pendingTicks = []

function flushNextTick() {
  const queue = pendingTicks
  pendingTicks = []
  queue.forEach((callback) => callback())
}

function installWxMock() {
  const values = {}
  pendingTicks = []
  globalThis.wx = {
    env: { USER_DATA_PATH: '' },
    nextTick(callback) {
      pendingTicks.push(callback)
    },
    getStorageSync(key) {
      return key in values ? values[key] : ''
    },
    setStorageSync(key, value) {
      values[key] = value
    },
    removeStorageSync(key) {
      delete values[key]
    },
    getAppBaseInfo() {
      return { theme: 'dark' }
    },
    getSystemInfoSync() {
      return { platform: 'node' }
    },
    getDeviceInfo() {
      return { platform: 'node' }
    },
    getWindowInfo() {
      return { statusBarHeight: 20, windowWidth: 375 }
    },
    getStorageInfoSync() {
      return { currentSize: 0, keys: [] }
    },
    onThemeChange() {
      /* 静默 */
    },
    setNavigationBarColor() {
      /* 静默 */
    },
    setBackgroundColor() {
      /* 静默 */
    },
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

let cachedDefinition = null

async function loadHelpDefinition() {
  if (cachedDefinition) {
    return cachedDefinition
  }

  installWxMock()
  let definition = null
  const previousPage = globalThis.Page
  globalThis.Page = (config) => {
    definition = config
  }

  try {
    await import(pathToFileURL(PAGE_TS).href)
  } finally {
    globalThis.Page = previousPage
  }

  if (!definition) {
    throw new Error('help page definition was not captured')
  }
  cachedDefinition = definition
  return definition
}

function createPage(definition) {
  const instance = {
    data: clone(definition.data || {}),
    setData(patch) {
      Object.assign(this.data, clone(patch))
    },
  }

  Object.keys(definition).forEach((key) => {
    if (typeof definition[key] === 'function') {
      instance[key] = definition[key].bind(instance)
    }
  })

  return instance
}

async function bootHelp(query) {
  const definition = await loadHelpDefinition()
  installWxMock()
  const page = createPage(definition)
  page.onLoad(query)
  flushNextTick()
  return page
}

function cleanup(page) {
  if (page && typeof page.onUnload === 'function') {
    page.onUnload()
  }
  delete globalThis.wx
}

test('帮助页：搜索与浏览共用 groups，空态独立', async () => {
  const page = await bootHelp()

  try {
    const totalGroups = page.data.groups.length
    assert.ok(totalGroups > 1, '浏览态应渲染多个分组')
    assert.equal(page.data.searchEmpty, false)

    page.onSearchInput({ detail: { value: 'json' } })
    assert.equal(page.data.keyword, 'json')
    assert.equal(page.data.groups.length, 1)
    assert.equal(page.data.groups[0].key, 'search')
    assert.equal(page.data.groups[0].title, '搜索结果')
    assert.ok(page.data.groups[0].entries.length > 0)
    assert.equal(page.data.searchEmpty, false)

    const first = page.data.groups[0].entries[0]
    page.onToggleEntry({ currentTarget: { dataset: { id: first.id } } })
    const toggled = page.data.groups[0].entries.find((entry) => entry.id === first.id)
    assert.equal(toggled.expanded, true)

    page.onSearchInput({ detail: { value: '不存在的能力zzz' } })
    assert.equal(page.data.groups[0].entries.length, 0)
    assert.equal(page.data.searchEmpty, true)

    page.onSearchInput({ detail: { value: '   ' } })
    assert.equal(page.data.keyword, '')
    assert.equal(page.data.searchEmpty, false)
    assert.equal(page.data.groups.length, totalGroups)
  } finally {
    cleanup(page)
  }
})

test('帮助页：tool 查询参数自动展开对应工具', async () => {
  const page = await bootHelp({ tool: 'unit' })

  try {
    const entries = page.data.groups.reduce((all, group) => all.concat(group.entries), [])
    const unit = entries.find((entry) => entry.id === 'unit')
    assert.ok(unit, '缺少 unit 帮助条目')
    assert.equal(unit.expanded, true)
  } finally {
    cleanup(page)
  }
})
