/* ==========================================================================
   魔法棒 + 指令面板 · 单元测试
   - 首页红线：搜索 input / bindinput / keyword 逻辑保持原样
   - 布局：魔法棒安全区 + 44px 玻璃方块；面板顶部避开状态栏
   - 面板：30 条内置命令、模糊匹配、带参路由、受控开关与 close 事件
   - 首页：openPalette / closePalette 不触碰 keyword / results
   - 运行：npm test
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { registerHooks } = require('node:module')

const ROOT = path.resolve(__dirname, '..')
const HOME_TS = path.join(ROOT, 'pages/index/index.ts')
const HOME_WXML = path.join(ROOT, 'pages/index/index.wxml')
const HOME_WXSS = path.join(ROOT, 'pages/index/index.wxss')
const HOME_JSON = path.join(ROOT, 'pages/index/index.json')
const PALETTE_TS = path.join(ROOT, 'components/command-palette/index.ts')
const PALETTE_WXML = path.join(ROOT, 'components/command-palette/index.wxml')
const PALETTE_WXSS = path.join(ROOT, 'components/command-palette/index.wxss')
const BINDINGS_SHIM = pathToFileURL(
  path.join(__dirname, 'helpers/mobx-bindings-shim.mjs'),
).href

/* mobx-miniprogram-bindings 在模块加载时会调用小程序全局 Behavior */
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

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function installWxMock() {
  globalThis.wx = {
    env: { USER_DATA_PATH: '' },
    vibrateShort() {
      /* 静默 */
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

let capturedComponent = null
const componentCache = new Map()

async function loadComponentDefinition(relative) {
  if (componentCache.has(relative)) {
    return componentCache.get(relative)
  }

  capturedComponent = null
  const previousComponent = globalThis.Component
  globalThis.Component = (config) => {
    capturedComponent = config
  }

  try {
    await import(moduleUrl(relative))
  } finally {
    globalThis.Component = previousComponent
  }

  if (!capturedComponent) {
    throw new Error(`component definition not captured: ${relative}`)
  }
  componentCache.set(relative, capturedComponent)
  return capturedComponent
}

async function loadPaletteModule() {
  return import(moduleUrl('components/command-palette/palette.ts'))
}

async function loadPreferenceModule() {
  return import(moduleUrl('core/stores/preference.ts'))
}

function createPageInstance(definition) {
  const instance = {
    data: clone(definition.data || {}),
    setDataCalls: [],
    setData(patch) {
      this.setDataCalls.push(clone(patch))
      Object.assign(this.data, clone(patch))
    },
  }

  const methods = definition.methods || {}
  Object.keys(methods).forEach((name) => {
    instance[name] = methods[name].bind(instance)
  })

  return instance
}

function createComponentInstance(definition, overrides = {}) {
  const properties = definition.properties || {}
  const props = {}
  Object.keys(properties).forEach((key) => {
    const config = properties[key]
    props[key] = config && 'value' in config ? clone(config.value) : undefined
  })

  const instance = {
    data: { ...clone(definition.data || {}), ...props, ...overrides },
    setDataCalls: [],
    setData(patch) {
      this.setDataCalls.push(clone(patch))
      Object.assign(this.data, clone(patch))
    },
    triggerEvent() {},
  }

  const methods = definition.methods || {}
  Object.keys(methods).forEach((name) => {
    instance[name] = methods[name].bind(instance)
  })

  return instance
}

test('首页红线：搜索 input 与 bindinput 原样保留', () => {
  const wxml = fs.readFileSync(HOME_WXML, 'utf8')
  const ts = fs.readFileSync(HOME_TS, 'utf8')

  assert.ok(wxml.includes('class="home-search__input"'))
  assert.ok(wxml.includes('value="{{keyword}}"'))
  assert.ok(wxml.includes('bindinput="onSearchInput"'))
  assert.ok(wxml.includes('bindconfirm="onSearchConfirm"'))
  assert.ok(ts.includes('onSearchInput('))
  assert.ok(ts.includes('keyword'))
})

test('布局：魔法棒使用安全区定位，面板顶部避开状态栏', () => {
  const homeWxml = fs.readFileSync(HOME_WXML, 'utf8')
  const homeWxss = fs.readFileSync(HOME_WXSS, 'utf8')
  const homeJson = JSON.parse(fs.readFileSync(HOME_JSON, 'utf8'))
  const paletteWxss = fs.readFileSync(PALETTE_WXSS, 'utf8')

  assert.ok(homeWxml.includes('class="magic-wand"'))
  assert.ok(homeWxml.includes('magic-wand__glass'))
  assert.ok(homeWxml.includes('show="{{showPalette}}"'))
  assert.ok(homeWxml.includes('bind:close="closePalette"'))
  assert.doesNotMatch(homeWxml, /magicTop/)
  assert.ok(homeJson.usingComponents['command-palette'])

  const paletteWxml = fs.readFileSync(PALETTE_WXML, 'utf8')
  const paletteTs = fs.readFileSync(PALETTE_TS, 'utf8')
  assert.ok(paletteWxml.includes('wx:for="{{searchResults}}"'))
  assert.ok(paletteWxml.includes('searchResults.length === 0'))
  assert.ok(paletteWxml.includes('glass-palette__close_text'))
  assert.ok(paletteWxml.includes('没有找到相关工具或指令') || paletteTs.includes('没有找到相关工具或指令'))
  assert.equal((paletteWxml.match(/×/g) || []).length, 1, '页面只能出现一个 X 图标')

  assert.ok(homeWxss.includes('top: calc(env(safe-area-inset-top, 0px) + 44px);'))
  assert.ok(homeWxss.includes('width: 44px;'))
  assert.ok(homeWxss.includes('height: 44px;'))
  assert.ok(homeWxss.includes('filter: drop-shadow'))
  assert.ok(homeWxss.includes('width: 56px;'))
  assert.ok(homeWxss.includes('width: 30px;'))
  assert.ok(homeWxss.includes('height: 30px;'))
  assert.ok(homeWxss.includes('saturate(1.2)'))

  assert.ok(paletteWxss.includes('padding-top: calc(env(safe-area-inset-top, 0px) + 72px);'))
  assert.ok(paletteWxss.includes('height: 62vh;'))
  assert.ok(paletteWxss.includes('--sg-glass-bg-strong'))
  assert.ok(paletteWxss.includes('max-height: 44vh;'))
  assert.ok(paletteWxss.includes('glass-palette__results_inner'))
})

test('魔法棒图标：内嵌 PNG 为 96x96 透明栅格图', () => {
  const ts = fs.readFileSync(HOME_TS, 'utf8')
  const match = ts.match(/const MAGIC_WAND_SVG =\s*'data:image\/png;base64,([^']+)'/)
  assert.ok(match, '未找到内嵌 PNG 图标')

  const buffer = Buffer.from(match[1], 'base64')
  assert.equal(buffer[0], 0x89)
  assert.equal(buffer.slice(1, 4).toString('ascii'), 'PNG')
  /* PNG IHDR：宽高位于第 16–23 字节 */
  assert.equal(buffer.readUInt32BE(16), 96)
  assert.equal(buffer.readUInt32BE(20), 96)
  assert.equal(ts.includes('data:image/svg+xml'), false)
})

test('指令数据：内置命令覆盖全部工具与导航', async () => {
  const { BUILTIN_COMMANDS, buildPaletteUrl, filterPaletteCommands } =
    await loadPaletteModule()
  const { TOOLS } = await import(pathToFileURL(path.join(ROOT, 'core/toolbox/registry.ts')).href)

  /* 每个工具必须有命令，外加 6 个全局导航命令 */
  assert.equal(
    BUILTIN_COMMANDS.filter((command) => command.id.startsWith('tool:')).length,
    TOOLS.length,
  )
  assert.equal(BUILTIN_COMMANDS.length, TOOLS.length + 6)
  assert.ok(BUILTIN_COMMANDS.some((command) => command.id === 'tool:radix'))

  const qr = filterPaletteCommands(BUILTIN_COMMANDS, '二维码', 8)
  assert.ok(qr.length > 0)
  assert.equal(qr[0].id, 'tool:qr')

  const legal = filterPaletteCommands(BUILTIN_COMMANDS, '隐私', 8)
  assert.ok(legal.some((command) => command.id === 'nav-legal'))

  const legalCommand = BUILTIN_COMMANDS.find((command) => command.id === 'nav-legal')
  assert.ok(legalCommand)
  assert.equal(buildPaletteUrl(legalCommand), '/pages/legal/index?section=privacy')

  const defaultResults = filterPaletteCommands(BUILTIN_COMMANDS, '', 8)
  assert.equal(defaultResults.length, 8)
})

test('指令匹配：图片、拼音全拼与首字母都能扩大命中', async () => {
  const { BUILTIN_COMMANDS, filterPaletteCommands } = await loadPaletteModule()

  /* 媒体工具持续增加，扩大到 12 才能验证「分类别名覆盖整组」而非只看权重前 8 */
  const imageResults = filterPaletteCommands(BUILTIN_COMMANDS, '图片', 12)
  const imageIds = imageResults.map((command) => command.id)
  assert.ok(imageIds.includes('tool:compress'), '图片应命中图片压缩')
  assert.ok(imageIds.includes('tool:palette'), '图片应命中图片取色')
  assert.ok(imageIds.includes('tool:qr-decode'), '图片应命中二维码识别')

  const fullPinyin = filterPaletteCommands(BUILTIN_COMMANDS, 'tupian', 8)
  assert.ok(fullPinyin.some((command) => command.id === 'tool:compress'))

  const initials = filterPaletteCommands(BUILTIN_COMMANDS, 'jgg', 8)
  assert.ok(initials.some((command) => command.id === 'tool:nine-grid'))

  const taxPinyin = filterPaletteCommands(BUILTIN_COMMANDS, 'geshui', 8)
  assert.ok(taxPinyin.some((command) => command.id === 'tool:tax'))
})

test('面板输入：allCommands 为空时自动重建数据源并命中媒体工具', async () => {
  const definition = await loadComponentDefinition('components/command-palette/index.ts')
  const instance = createComponentInstance(definition, { allCommands: [], maxResults: 12 })

  try {
    instance.onInput({ detail: { value: '图片' } })
    assert.equal(instance.data.query, '图片')
    /* 工具命令随注册表增长，这里只校验下限 30（当前 56 个工具 + 6 个导航命令 = 62） */
    assert.ok(instance.data.allCommands.length >= 30)
    assert.equal(instance.data.dataSourceReady, true)
    const ids = instance.data.searchResults.map((command) => command.id)
    assert.ok(ids.includes('tool:compress'))
    assert.ok(ids.includes('tool:palette'))
    assert.ok(ids.includes('tool:qr-decode'))
    assert.ok(ids.includes('tool:color'))
  } finally {
    /* 无定时器与全局副作用，无需额外清理 */
  }
})

test('面板空结果：searchResults 必须为空数组，清空后恢复默认结果', async () => {
  const definition = await loadComponentDefinition('components/command-palette/index.ts')
  const instance = createComponentInstance(definition)

  try {
    instance.syncCommands()
    instance.onInput({ detail: { value: '绝不存在的关键词' } })
    assert.equal(instance.data.query, '绝不存在的关键词')
    assert.deepEqual(instance.data.searchResults, [])
    assert.equal(instance.data.dataSourceReady, true)

    instance.onClear()
    assert.equal(instance.data.query, '')
    assert.equal(instance.data.searchResults.length, 12)
    assert.equal(instance.data.activeIndex, 0)
    assert.equal(instance.data.focusInput, true)
  } finally {
    /* 无定时器与全局副作用，无需额外清理 */
  }
})

test('面板数据源为空：searchResults 为空数组，dataSourceReady 为 false', async () => {
  const definition = await loadComponentDefinition('components/command-palette/index.ts')
  const instance = createComponentInstance(definition, {
    useBuiltins: false,
    commands: [],
  })

  const originalError = console.error
  console.error = () => {}
  try {
    assert.doesNotThrow(() => instance.syncCommands())
    assert.deepEqual(instance.data.allCommands, [])
    assert.deepEqual(instance.data.searchResults, [])
    assert.equal(instance.data.dataSourceReady, false)

    assert.doesNotThrow(() => instance.onInput({ detail: { value: '图片' } }))
    assert.deepEqual(instance.data.searchResults, [])
    assert.equal(instance.data.dataSourceReady, false)
  } finally {
    console.error = originalError
  }
})

test('面板输入容错：缺失 detail / 非字符串 value 不阻断渲染', async () => {
  const definition = await loadComponentDefinition('components/command-palette/index.ts')
  const instance = createComponentInstance(definition)
  instance.syncCommands()

  assert.doesNotThrow(() => instance.onInput({}))
  assert.equal(instance.data.query, '')
  assert.equal(instance.data.searchResults.length, 12)

  assert.doesNotThrow(() => instance.onInput({ detail: { value: 123 } }))
  assert.equal(instance.data.query, '')
  assert.equal(instance.data.searchResults.length, 12)

  assert.doesNotThrow(() => instance.onResultTap({ currentTarget: { dataset: { index: 'bad' } } }))
})

test('样式回归：通透玻璃底板、键盘安全 padding、玻璃空状态', () => {
  const homeWxss = fs.readFileSync(HOME_WXSS, 'utf8')
  const paletteWxss = fs.readFileSync(PALETTE_WXSS, 'utf8')

  const surface = homeWxss.match(/\.magic-wand__surface \{[\s\S]*?\}/)
  assert.ok(surface, '未找到魔法棒玻璃面板样式')
  assert.ok(surface[0].includes('rgba(255, 255, 255, 0.16)'))
  assert.equal(surface[0].includes('background-color: var(--glass-bg-strong)'), false)

  const inner = paletteWxss.match(/\.glass-palette__results_inner \{[\s\S]*?\}/)
  assert.ok(inner, '未找到结果区内容容器样式')
  assert.ok(inner[0].includes('calc(48rpx + env(safe-area-inset-bottom, 0px))'))

  const empty = paletteWxss.match(/\.glass-palette__empty \{[\s\S]*?\}/)
  assert.ok(empty, '未找到空状态样式')
  assert.ok(empty[0].includes('background-color: var(--glass-bg-soft)'))
})

test('面板组件：受控 show 同步 Store，关闭时回传 close 事件', async () => {
  installWxMock()
  const definition = await loadComponentDefinition('components/command-palette/index.ts')
  const { paletteStore } = await loadPaletteModule()

  try {
    assert.ok(definition.properties.show)
    assert.equal(typeof definition.observers.show, 'function')
    assert.equal(typeof definition.methods.requestClose, 'function')

    const events = []
    const instance = {
      data: {},
      triggerEvent(name, detail) {
        events.push({ name, detail: clone(detail) })
      },
    }

    paletteStore.visible = false
    definition.observers.show.call(instance, true)
    assert.equal(paletteStore.visible, true)

    definition.observers.show.call(instance, false)
    assert.equal(paletteStore.visible, false)

    definition.methods.requestClose.call(instance, 'mask')
    assert.equal(paletteStore.visible, false)
    assert.deepEqual(events, [{ name: 'close', detail: { source: 'mask' } }])
  } finally {
    paletteStore.visible = false
    delete globalThis.wx
  }
})

test('面板打开：30ms 后激活并渲染默认结果列表', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const definition = await loadComponentDefinition('components/command-palette/index.ts')
  const instance = createComponentInstance(definition)

  try {
    definition.methods.openPalette.call(instance)
    assert.equal(instance.data.mounted, true)
    assert.equal(instance.data.active, false)

    t.mock.timers.tick(30)
    assert.equal(instance.data.active, true)
    assert.equal(instance.data.focusInput, true)
    assert.equal(instance.data.query, '')
    /* 工具命令随注册表增长，这里只校验下限 30（当前 26 个工具 + 6 个导航命令 = 32） */
    assert.ok(instance.data.allCommands.length >= 30)
    assert.equal(instance.data.searchResults.length, 12)
    assert.equal(instance.data.searchResults[0].id, 'nav-home')
  } finally {
    t.mock.timers.reset()
  }
})

test('首页状态隔离：开关面板不触碰 keyword / results', async () => {
  installWxMock()
  const preference = await loadPreferenceModule()
  preference.preferenceStore.sound = false
  const palette = await loadPaletteModule()
  const definition = await loadComponentDefinition('pages/index/index.ts')

  try {
    const page = createPageInstance(definition)
    assert.equal(page.data.showPalette, false)
    assert.equal(page.data.keyword, '')
    assert.equal(typeof page.openPalette, 'function')
    assert.equal(typeof page.closePalette, 'function')

    page.data.keyword = '二维码'
    page.data.results = [{ id: 'qr', name: '二维码生成' }]
    const keywordBefore = page.data.keyword
    const resultsBefore = clone(page.data.results)

    page.openPalette()
    assert.equal(page.data.showPalette, true)
    assert.equal(palette.paletteStore.visible, true)
    assert.equal(page.data.keyword, keywordBefore)
    assert.deepEqual(page.data.results, resultsBefore)

    const callsAfterOpen = page.setDataCalls.length
    page.openPalette()
    assert.equal(page.setDataCalls.length, callsAfterOpen)

    page.closePalette()
    assert.equal(page.data.showPalette, false)
    assert.equal(palette.paletteStore.visible, false)
    assert.equal(page.data.keyword, keywordBefore)
    assert.deepEqual(page.data.results, resultsBefore)
  } finally {
    palette.paletteStore.visible = false
    preference.preferenceStore.sound = true
    delete globalThis.wx
  }
})
