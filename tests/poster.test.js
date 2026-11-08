/* ==========================================================================
   极光海报 · 单元测试
   - wrapText 折行与省略号保护
   - 本地静态二维码 / 无 getUnlimitedQRCode
   - 预览保存：隐私授权、相册写入、1.3 秒自动关闭
   - 生成 / 保存动画：骨架交叉淡入、延一帧揭示、保存成功覆盖层
   - 权限拒绝：showModal 引导
   - glass-tool-shell：结果回退与生成调度
   - 运行：npm test
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { registerHooks } = require('node:module')

const ROOT = path.resolve(__dirname, '..')
const GENERATOR_DIR = path.join(ROOT, 'components/poster-generator')
const PREVIEW_DIR = path.join(ROOT, 'components/poster-preview')
const SHELL_DIR = path.join(ROOT, 'components/glass-tool-shell')
const QR_PATH = path.join(ROOT, 'assets/poster-qr.png')
const MP_QR_PATH = path.join(ROOT, 'assets/miniprogram-qr.png')
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

function moduleUrl(file) {
  return pathToFileURL(file).href
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function installWxMock(options = {}) {
  const calls = {
    save: 0,
    modal: 0,
    actionSheet: 0,
    vibrate: 0,
    shareImage: 0,
    shareImagePath: '',
    actionSheetItems: [],
    canvasOptions: null,
    savedPath: '',
  }
  globalThis.wx = {
    env: { USER_DATA_PATH: '' },
    vibrateShort() {
      calls.vibrate += 1
    },
    getDeviceInfo() {
      return { platform: 'node' }
    },
    getSystemInfoSync() {
      return { platform: 'node' }
    },
    getWindowInfo() {
      return { pixelRatio: options.pixelRatio || 2 }
    },
    getStorageSync() {
      return ''
    },
    setStorageSync() {},
    nextTick(callback) {
      callback()
    },
    requirePrivacyAuthorize(option) {
      if (options.privacyDenied) {
        if (option && typeof option.fail === 'function') {
          option.fail({ errMsg: 'requirePrivacyAuthorize:fail auth deny' })
        }
        return
      }
      if (option && typeof option.success === 'function') {
        option.success({})
      }
    },
    saveImageToPhotosAlbum(option) {
      calls.save += 1
      calls.savedPath = option && option.filePath ? option.filePath : ''
      if (options.saveFail) {
        if (option && typeof option.fail === 'function') {
          option.fail({ errMsg: options.saveFail })
        }
        return
      }
      if (option && typeof option.success === 'function') {
        option.success({ errMsg: 'saveImageToPhotosAlbum:ok' })
      }
    },
    showModal(option) {
      calls.modal += 1
      if (option && typeof option.success === 'function') {
        option.success({ confirm: false, cancel: true })
      }
    },
    showShareImageMenu(option) {
      calls.shareImage += 1
      calls.shareImagePath = option && option.path ? option.path : ''
      if (options.shareFail) {
        if (option && typeof option.fail === 'function') {
          option.fail({ errMsg: options.shareFail })
        }
        return
      }
      if (option && typeof option.success === 'function') {
        option.success({ errMsg: 'showShareImageMenu:ok' })
      }
    },
    showActionSheet(option) {
      calls.actionSheet += 1
      calls.actionSheetItems = option && Array.isArray(option.itemList) ? option.itemList.slice() : []
      if (options.actionSheetCancel) {
        if (option && typeof option.fail === 'function') {
          option.fail({ errMsg: 'showActionSheet:fail cancel' })
        }
        return
      }
      if (option && typeof option.success === 'function') {
        option.success({ tapIndex: 0 })
      }
    },
    openSetting() {},
    canvasToTempFilePath(option) {
      calls.canvasOptions = option
      if (options.canvasFail) {
        if (option && typeof option.fail === 'function') {
          option.fail({ errMsg: options.canvasFail })
        }
        return
      }
      if (option && typeof option.success === 'function') {
        option.success({ tempFilePath: 'wxfile://poster.png' })
      }
    },
  }
  return calls
}

let capturedComponent = null
const componentCache = new Map()

async function loadDefinition(file) {
  if (componentCache.has(file)) {
    return componentCache.get(file)
  }
  capturedComponent = null
  const previous = globalThis.Component
  globalThis.Component = (config) => {
    capturedComponent = config
  }
  try {
    await import(moduleUrl(file))
  } finally {
    globalThis.Component = previous
  }
  if (!capturedComponent) {
    throw new Error(`Component definition not captured: ${file}`)
  }
  componentCache.set(file, capturedComponent)
  return capturedComponent
}

async function loadGeneratorModule() {
  installWxMock()
  await loadDefinition(path.join(GENERATOR_DIR, 'index.ts'))
  return import(moduleUrl(path.join(GENERATOR_DIR, 'index.ts')))
}

function createComponent(definition, overrides = {}) {
  const properties = definition.properties || {}
  const props = {}
  Object.keys(properties).forEach((key) => {
    const config = properties[key]
    props[key] = config && 'value' in config ? clone(config.value) : undefined
  })

  const instance = {
    data: { ...clone(definition.data || {}), ...props, ...overrides },
    setDataCalls: [],
    events: [],
    setData(patch, callback) {
      this.setDataCalls.push(clone(patch))
      Object.assign(this.data, clone(patch))
      if (typeof callback === 'function') {
        callback()
      }
    },
    triggerEvent(name, detail) {
      this.events.push({ name, detail: clone(detail) })
    },
  }

  const methods = definition.methods || {}
  Object.keys(methods).forEach((name) => {
    instance[name] = methods[name].bind(instance)
  })
  return instance
}

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

/** 统一构造绘制入参，避免每个用例重复业务字段 */
function posterPayload(overrides = {}) {
  return {
    toolName: '单位换算',
    category: '单位换算',
    mainResult: '100 厘米',
    resultLabel: '换算结果',
    params: [
      { label: '输入数值', value: '1 米' },
      { label: '目标单位', value: '厘米' },
    ],
    extras: ['毫米 1000', '千米 0.001'],
    toolId: 'unit',
    theme: 'dark',
    ...overrides,
  }
}

/**
 * 构造假 Canvas：imageMode 控制二维码 onload / onerror / 永不回调。
 * 用于覆盖 DPR、二维码失败、导出失败等边界。
 */
function createGeneratorHarness(generator, options = {}) {
  const scaleCalls = []
  const ctx = {
    scale(x, y) {
      scaleCalls.push([x, y])
    },
    measureText(text) {
      return { width: Array.from(text).length * 10 }
    },
    createRadialGradient() {
      return { addColorStop() {} }
    },
    createLinearGradient() {
      return { addColorStop() {} }
    },
    clearRect() {},
    fillRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    arcTo() {},
    closePath() {},
    fill() {},
    stroke() {},
    save() {},
    restore() {},
    drawImage() {},
    fillText() {},
  }

  function createImage() {
    const image = {
      width: 96,
      height: 96,
      onload: null,
      onerror: null,
    }
    let imageSource = ''
    Object.defineProperty(image, 'src', {
      get() {
        return imageSource
      },
      set(value) {
        imageSource = value
        const mode = options.imageMode || 'load'
        if (mode === 'load') {
          setTimeout(() => {
            if (typeof image.onload === 'function') {
              image.onload()
            }
          }, 50)
        }
        if (mode === 'error') {
          setTimeout(() => {
            if (typeof image.onerror === 'function') {
              image.onerror()
            }
          }, 0)
        }
      },
    })
    return image
  }

  const canvas = {
    width: 0,
    height: 0,
    getContext() {
      return ctx
    },
    createImage,
  }

  generator.createSelectorQuery = () => ({
    select() {
      return this
    },
    fields() {
      return this
    },
    exec(callback) {
      callback([{ node: canvas, width: 480, height: 720 }])
    },
  })

  return { canvas, createImage, scaleCalls }
}


test('海报格言：文案简短、出处完整，随机选择可用', async () => {
  const { POSTER_QUOTES, pickPosterQuote } = await loadGeneratorModule()
  assert.ok(POSTER_QUOTES.length >= 10, '格言池至少 10 条')
  for (const quote of POSTER_QUOTES) {
    assert.ok(quote.text.length > 0)
    assert.ok(Array.from(quote.text).length <= 18, `格言过长：${quote.text}`)
    assert.ok(quote.source.length > 0, `缺少出处：${quote.text}`)
  }
  const picked = pickPosterQuote()
  assert.ok(picked.text)
  assert.ok(picked.source)
})

test('wrapText：超宽文本自动折行并加省略号', async () => {
  const { wrapText } = await loadGeneratorModule()
  const ctx = {
    measureText(text) {
      return { width: Array.from(text).length * 10 }
    },
  }

  const lines = wrapText(ctx, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 100, 2)
  assert.equal(lines.length, 2)
  assert.ok(lines[1].endsWith('…'))
  for (const line of lines) {
    assert.ok(ctx.measureText(line).width <= 100, `溢出：${line}`)
  }
})

test('wrapText：手动换行、空文本与恰好占满不误加省略号', async () => {
  const { wrapText } = await loadGeneratorModule()
  const ctx = {
    measureText(text) {
      return { width: Array.from(text).length * 10 }
    },
  }

  assert.deepEqual(wrapText(ctx, '第一行\n第二行', 100, 3), ['第一行', '第二行'])
  assert.deepEqual(wrapText(ctx, '', 100, 3), [''])
  assert.deepEqual(wrapText(ctx, 'ABCDEFGHIJ', 100, 1), ['ABCDEFGHIJ'])
  /* 边界：maxLines 为 0 时安全返回空行，不抛异常 */
  assert.deepEqual(wrapText(ctx, 'ABC', 100, 0), [''])
  /* 边界：1000 字符超长文本必须收敛到 maxLines */
  const longLines = wrapText(ctx, 'A'.repeat(1000), 100, 3)
  assert.equal(longLines.length, 3)
  assert.ok(longLines[2].endsWith('…'))
})

test('poster-generator：pixelRatio 3 高清导出与二维码加载闭环', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const calls = installWxMock({ pixelRatio: 3 })
  const definition = await loadDefinition(path.join(GENERATOR_DIR, 'index.ts'))
  const generator = createComponent(definition)

  const scaleCalls = []
  const ctx = {
    scale(x, y) {
      scaleCalls.push([x, y])
    },
    measureText(text) {
      return { width: Array.from(text).length * 10 }
    },
    createRadialGradient() {
      return { addColorStop() {} }
    },
    createLinearGradient() {
      return { addColorStop() {} }
    },
    clearRect() {},
    fillRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    arcTo() {},
    closePath() {},
    fill() {},
    stroke() {},
    save() {},
    restore() {},
    drawImage() {},
    fillText() {},
  }

  function createImage() {
    const image = {
      width: 96,
      height: 96,
      onload: null,
      onerror: null,
    }
    let imageSource = ''
    Object.defineProperty(image, 'src', {
      get() {
        return imageSource
      },
      set(value) {
        imageSource = value
        setTimeout(() => {
          if (typeof image.onload === 'function') {
            image.onload()
          }
        }, 50)
      },
    })
    return image
  }

  const canvas = {
    width: 0,
    height: 0,
    getContext() {
      return ctx
    },
    createImage,
  }

  generator.createSelectorQuery = () => ({
    select() {
      return this
    },
    fields() {
      return this
    },
    exec(callback) {
      callback([{ node: canvas, width: 480, height: 720 }])
    },
  })

  try {
    const promise = generator.generate(posterPayload({ theme: 'dark' }))

    t.mock.timers.tick(60)
    await flushPromises()
    t.mock.timers.tick(50)
    await flushPromises()
    const posterPath = await promise

    assert.equal(posterPath, 'wxfile://poster.png')
    assert.equal(canvas.width, 480 * 3)
    assert.equal(canvas.height, 720 * 3)
    assert.deepEqual(scaleCalls[0], [3, 3])
    assert.equal(calls.canvasOptions.width, 480 * 3)
    assert.equal(calls.canvasOptions.height, 720 * 3)
    assert.equal(generator.data.generating, false)
    assert.equal(generator.data.canvasMounted, false)
  } finally {
    t.mock.timers.reset()
    delete globalThis.wx
  }
})

test('poster-generator：Canvas 查询超时不卡 Loading', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  installWxMock()
  const definition = await loadDefinition(path.join(GENERATOR_DIR, 'index.ts'))
  const generator = createComponent(definition)

  generator.createSelectorQuery = () => ({
    select() {
      return this
    },
    fields() {
      return this
    },
    exec() {
      /* 模拟平台不回调：必须由 2.5 秒超时兜底 */
    },
  })

  try {
    const promise = generator.generate(posterPayload({ theme: 'light' }))

    t.mock.timers.tick(60)
    await flushPromises()
    t.mock.timers.tick(2600)
    await flushPromises()

    await assert.rejects(promise, /Canvas 查询超时/)
    assert.equal(generator.data.generating, false)
    assert.equal(generator.data.canvasMounted, false)
  } finally {
    t.mock.timers.reset()
    delete globalThis.wx
  }
})

test('poster-generator：节点尺寸为 0 时重试，第三次拿到真实尺寸', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  installWxMock()
  const definition = await loadDefinition(path.join(GENERATOR_DIR, 'index.ts'))
  const generator = createComponent(definition)
  const canvas = {
    width: 0,
    height: 0,
    getContext() {
      return {}
    },
  }
  let calls = 0
  generator.createSelectorQuery = () => ({
    select() {
      return this
    },
    fields() {
      return this
    },
    exec(callback) {
      calls += 1
      const ready = calls >= 3
      callback([{ node: canvas, width: ready ? 480 : 0, height: ready ? 720 : 0 }])
    },
  })

  try {
    const promise = generator.queryCanvas()
    t.mock.timers.tick(100)
    await flushPromises()
    t.mock.timers.tick(100)
    await flushPromises()
    const node = await promise
    assert.equal(calls, 3, '前两次尺寸为 0 必须重试')
    assert.ok(node)
  } finally {
    t.mock.timers.reset()
    delete globalThis.wx
  }
})

test('poster-generator：模拟器尺寸始终为 0 时回退逻辑尺寸继续绘制', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  installWxMock()
  const definition = await loadDefinition(path.join(GENERATOR_DIR, 'index.ts'))
  const generator = createComponent(definition)
  const canvas = {
    width: 0,
    height: 0,
    getContext() {
      return {}
    },
  }
  let calls = 0
  generator.createSelectorQuery = () => ({
    select() {
      return this
    },
    fields() {
      return this
    },
    exec(callback) {
      calls += 1
      callback([{ node: canvas, width: 0, height: 0 }])
    },
  })

  try {
    const promise = generator.queryCanvas()
    t.mock.timers.tick(100)
    t.mock.timers.tick(100)
    t.mock.timers.tick(100)
    const node = await promise
    assert.equal(calls, 4, '首次 + 3 次重试')
    assert.ok(node, '节点存在时不得因尺寸为 0 而失败')
  } finally {
    t.mock.timers.reset()
    delete globalThis.wx
  }
})

test('poster-generator：模拟器改走离屏 Canvas，不查询页面节点', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  installWxMock({ pixelRatio: 2 })
  const definition = await loadDefinition(path.join(GENERATOR_DIR, 'index.ts'))
  const generator = createComponent(definition)
  const harness = createGeneratorHarness(generator)

  globalThis.wx.getDeviceInfo = () => ({ platform: 'devtools' })
  let queryCalls = 0
  generator.createSelectorQuery = () => {
    queryCalls += 1
    throw new Error('模拟器不应查询页面 Canvas')
  }
  let options = null
  globalThis.wx.createOffscreenCanvas = (input) => {
    options = input
    return harness.canvas
  }

  try {
    const promise = generator.generate(posterPayload({ theme: 'light' }))
    t.mock.timers.tick(50)
    await flushPromises()
    const path = await promise

    assert.equal(path, 'wxfile://poster.png')
    assert.equal(queryCalls, 0, 'Skyline 模拟器必须绕过页面 Canvas')
    assert.deepEqual(options, { type: '2d', width: 960, height: 1440 })
    assert.equal(harness.canvas.width, 960)
    assert.equal(harness.canvas.height, 1440)
    assert.equal(generator.data.generating, false)
    assert.equal(generator.data.canvasMounted, false)
  } finally {
    t.mock.timers.reset()
    delete globalThis.wx
  }
})

test('poster-generator：节点始终不存在时最终失败且不永久挂起', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  installWxMock()
  const definition = await loadDefinition(path.join(GENERATOR_DIR, 'index.ts'))
  const generator = createComponent(definition)
  let calls = 0
  generator.createSelectorQuery = () => ({
    select() {
      return this
    },
    fields() {
      return this
    },
    exec(callback) {
      calls += 1
      callback([])
    },
  })

  try {
    const promise = generator.queryCanvas()
    t.mock.timers.tick(100)
    t.mock.timers.tick(100)
    t.mock.timers.tick(100)
    await assert.rejects(promise, /海报 Canvas 初始化失败/)
    assert.equal(calls, 4)
  } finally {
    t.mock.timers.reset()
    delete globalThis.wx
  }
})

test('poster-generator：二维码加载失败仍导出占位海报', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  installWxMock()
  const definition = await loadDefinition(path.join(GENERATOR_DIR, 'index.ts'))
  const generator = createComponent(definition)
  createGeneratorHarness(generator, { imageMode: 'error' })

  try {
    const promise = generator.generate(posterPayload({ theme: 'dark' }))

    t.mock.timers.tick(60)
    await flushPromises()
    t.mock.timers.tick(0)
    await flushPromises()
    const posterPath = await promise

    assert.equal(posterPath, 'wxfile://poster.png')
    assert.equal(generator.data.generating, false)
  } finally {
    t.mock.timers.reset()
    delete globalThis.wx
  }
})

test('poster-generator：导出失败必须复位且可重试', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  installWxMock({ canvasFail: 'canvasToTempFilePath:fail system error' })
  const definition = await loadDefinition(path.join(GENERATOR_DIR, 'index.ts'))
  const generator = createComponent(definition)
  createGeneratorHarness(generator, { imageMode: 'load' })

  try {
    const promise = generator.generate(posterPayload({ theme: 'light' }))

    t.mock.timers.tick(60)
    await flushPromises()
    t.mock.timers.tick(50)
    await flushPromises()

    await assert.rejects(promise, /canvasToTempFilePath:fail/)
    assert.equal(generator.data.generating, false)
    assert.equal(generator.data.canvasMounted, false)
  } finally {
    t.mock.timers.reset()
    delete globalThis.wx
  }
})

test('poster-generator：并发生成被拒绝，二维码超时仍可导出', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  installWxMock()
  const definition = await loadDefinition(path.join(GENERATOR_DIR, 'index.ts'))
  const generator = createComponent(definition)
  createGeneratorHarness(generator, { imageMode: 'never' })

  try {
    const first = generator.generate(posterPayload({ theme: 'dark' }))
    await assert.rejects(
      generator.generate(posterPayload({ theme: 'dark' })),
      /正在生成中/,
    )

    t.mock.timers.tick(60)
    await flushPromises()
    t.mock.timers.tick(1600)
    await flushPromises()
    const posterPath = await first

    assert.equal(posterPath, 'wxfile://poster.png')
    assert.equal(generator.data.generating, false)
  } finally {
    t.mock.timers.reset()
    delete globalThis.wx
  }
})

test('海报素材：官方小程序码存在且禁用 getUnlimitedQRCode', () => {
  const mpStat = fs.statSync(MP_QR_PATH)
  assert.ok(mpStat.size > 0, '官方小程序码资源为空')
  const mpBuffer = fs.readFileSync(MP_QR_PATH)
  assert.equal(mpBuffer[0], 0x89)
  assert.equal(mpBuffer.slice(1, 4).toString('ascii'), 'PNG')
  const width = mpBuffer.readUInt32BE(16)
  const height = mpBuffer.readUInt32BE(20)
  assert.equal(width, height, '小程序码必须为正方形')
  assert.ok(width >= 384, '小程序码分辨率过低')

  /* 旧文本二维码仅作为资源缺失时的兜底，仍必须存在 */
  assert.ok(fs.statSync(QR_PATH).size > 0)

  const stat = fs.statSync(QR_PATH)
  const buffer = fs.readFileSync(QR_PATH)
  assert.equal(buffer[0], 0x89)
  assert.equal(buffer.slice(1, 4).toString('ascii'), 'PNG')

  const generator = fs.readFileSync(path.join(GENERATOR_DIR, 'index.ts'), 'utf8')
  const preview = fs.readFileSync(path.join(PREVIEW_DIR, 'index.ts'), 'utf8')
  const previewWxml = fs.readFileSync(path.join(PREVIEW_DIR, 'index.wxml'), 'utf8')
  const previewWxss = fs.readFileSync(path.join(PREVIEW_DIR, 'index.wxss'), 'utf8')
  const shell = fs.readFileSync(path.join(SHELL_DIR, 'index.ts'), 'utf8')
  const shellWxml = fs.readFileSync(path.join(SHELL_DIR, 'index.wxml'), 'utf8')

  assert.ok(generator.includes('pixelRatio'))
  assert.ok(generator.includes('wrapText'))
  assert.ok(generator.includes('canvasToTempFilePath'))
  assert.ok(preview.includes('ensurePrivacyAuthorized'))
  assert.ok(preview.includes('saveImageToPhotosAlbum'))
  assert.ok(preview.includes('showActionSheet'))
  assert.ok(preview.includes('openSetting'))
  assert.ok(previewWxml.includes('bindlongpress="onLongPress"'))
  assert.ok(previewWxss.includes('.poster-preview_saver .poster-preview__panel'))
  assert.ok(previewWxss.includes('transform: none'))
  assert.ok(previewWxss.includes('transition: opacity 220ms linear'))
  assert.ok(shell.includes('useMotion'))
  assert.ok(shell.includes('useSound'))

  /* 动画衔接契约：壳层必须把生成状态透传给预览 */
  assert.ok(shellWxml.includes('loading="{{isGenerating}}"'))
  assert.ok(shellWxml.includes('error="{{posterError}}"'))
  assert.match(shellWxml, /aura[\s\S]{0,80}loading="\{\{isGenerating\}\}"/)
  assert.match(previewWxml, /aura[\s\S]{0,80}loading="\{\{saving\}\}"/)
  assert.ok(preview.includes("message: '已保存到相册'"))
  assert.ok(shell.includes('POSTER_START_DELAY = 560'))
  assert.ok(shell.includes('POSTER_SAVER_DELAY = 240'))
  /* 骨架常驻交叉淡出，而不是 wx:if 瞬间卸载 */
  assert.ok(previewWxml.includes('poster-preview__skeleton_out'))
  assert.ok(previewWxss.includes('.poster-preview__skeleton_out'))
  assert.ok(previewWxml.includes('poster-preview__saved'))
  assert.ok(previewWxml.includes('success="{{saved}}"'))
  assert.ok(previewWxml.includes('success-text="已保存"'))
  assert.ok(preview.includes('showShareImageMenu'))
  assert.ok(previewWxml.includes('bind:tap="onShareTap"'))
  assert.ok(previewWxml.includes('分享海报'))
  /* 大图过渡只允许 opacity / transform，禁止逐帧 filter blur */
  assert.equal(previewWxss.includes('filter: blur(10px)'), false)
  /* 绘制内核必须消费真实业务字段，禁止回退成废话 */
  assert.ok(generator.includes('isDevtools'))
  assert.ok(generator.includes('createOffscreenCanvas'))
  assert.ok(generator.includes('/assets/miniprogram-qr.png'))
  assert.ok(generator.includes('/assets/poster-qr.png'))
  assert.ok(generator.includes('payload.mainResult'))
  assert.ok(generator.includes('payload.resultLabel'))
  assert.ok(generator.includes('payload.params'))
  assert.ok(generator.includes('payload.category'))
  assert.ok(generator.includes('payload.extras'))
  assert.ok(generator.includes('POSTER_QUOTES'))
  assert.equal(generator.includes('20 个极客效率工具'), false)
  assert.equal(
    `${generator}${preview}${shell}`.includes('getUnlimitedQRCode'),
    false,
  )
})

test('预览保存：隐私通过 -> 写入相册 -> 成功覆盖层 -> 1.3 秒后平滑关闭', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const calls = installWxMock()
  const preference = await import(moduleUrl(path.join(ROOT, 'core/stores/preference.ts')))
  preference.preferenceStore.sound = false
  const definition = await loadDefinition(path.join(PREVIEW_DIR, 'index.ts'))
  const preview = createComponent(definition, {
    imagePath: 'wxfile://poster.png',
    show: true,
    mounted: true,
    active: true,
  })

  try {
    preview.savePoster()
    await flushPromises()
    assert.equal(calls.save, 1)
    assert.equal(calls.vibrate, 1, '保存成功必须触发一次全局成功震动 / 音效')
    assert.equal(preview.data.saving, false)
    assert.equal(preview.data.saved, true, '保存成功必须先展示成功覆盖层')

    /* 成功覆盖层期间重复点击不得二次写相册、叠加自动关闭定时器 */
    preview.savePoster()
    await flushPromises()
    assert.equal(calls.save, 1)

    /* 1.3 秒阅读停留 → 触发关闭 → 560ms 退场动画结束后才卸载 */
    t.mock.timers.tick(1300)
    assert.ok(preview.events.some((event) => event.name === 'close'))
    assert.equal(preview.data.closing, true)
    assert.equal(preview.data.mounted, true)

    t.mock.timers.tick(560)
    assert.equal(preview.data.mounted, false)
    assert.ok(preview.events.some((event) => event.name === 'closed'))
  } finally {
    t.mock.timers.reset()
    delete globalThis.wx
  }
})

test('预览动画：图片 onload 延一帧再淡入，骨架完成交叉淡出', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const calls = installWxMock()
  const preference = await import(moduleUrl(path.join(ROOT, 'core/stores/preference.ts')))
  preference.preferenceStore.sound = false
  const definition = await loadDefinition(path.join(PREVIEW_DIR, 'index.ts'))
  const preview = createComponent(definition, {
    imagePath: 'wxfile://poster.png',
    mounted: true,
  })

  try {
    preview.onImageLoad()
    assert.equal(preview.data.imageReady, false, '必须保留一帧透明态给淡入过渡')
    t.mock.timers.tick(24)
    assert.equal(preview.data.imageReady, true)
    assert.equal(calls.vibrate, 1)

    /* 缓存回放可能重复 onload：不得重复播放成功反馈 */
    preview.onImageLoad()
    t.mock.timers.tick(24)
    assert.equal(calls.vibrate, 1)
  } finally {
    t.mock.timers.reset()
    delete globalThis.wx
  }
})

test('海报分享：调用微信原生图片分享接口并传入海报路径', async () => {
  const calls = installWxMock()
  const preference = await import(moduleUrl(path.join(ROOT, 'core/stores/preference.ts')))
  preference.preferenceStore.sound = false
  const definition = await loadDefinition(path.join(PREVIEW_DIR, 'index.ts'))

  try {
    const preview = createComponent(definition, {
      imagePath: 'wxfile://poster.png',
      mounted: true,
    })
    preview.onShareTap()
    await flushPromises()
    assert.equal(calls.shareImage, 1)
    assert.equal(calls.shareImagePath, 'wxfile://poster.png')

    const empty = createComponent(definition, { imagePath: '' })
    empty.onShareTap()
    assert.equal(calls.shareImage, 1, '空图片不得调起分享')
  } finally {
    delete globalThis.wx
  }
})

test('海报分享：取消不警示，失败触发全局警示反馈', async () => {
  const calls = installWxMock({ shareFail: 'showShareImageMenu:fail cancel' })
  const preference = await import(moduleUrl(path.join(ROOT, 'core/stores/preference.ts')))
  preference.preferenceStore.sound = false
  const definition = await loadDefinition(path.join(PREVIEW_DIR, 'index.ts'))
  const preview = createComponent(definition, {
    imagePath: 'wxfile://poster.png',
    mounted: true,
  })

  try {
    preview.onShareTap()
    assert.equal(calls.shareImage, 1)
    assert.equal(calls.vibrate, 0, '用户取消分享不应警示')
  } finally {
    delete globalThis.wx
  }

  const failCalls = installWxMock({ shareFail: 'showShareImageMenu:fail system error' })
  const failing = createComponent(definition, {
    imagePath: 'wxfile://poster.png',
    mounted: true,
  })
  try {
    failing.onShareTap()
    assert.equal(failCalls.shareImage, 1)
    assert.equal(failCalls.vibrate, 1, '分享失败必须触发全局警示反馈')
  } finally {
    delete globalThis.wx
  }
})

test('海报分享：接口不可用时安全降级并警示', async () => {
  const calls = installWxMock()
  delete globalThis.wx.showShareImageMenu
  const preference = await import(moduleUrl(path.join(ROOT, 'core/stores/preference.ts')))
  preference.preferenceStore.sound = false
  const definition = await loadDefinition(path.join(PREVIEW_DIR, 'index.ts'))
  const preview = createComponent(definition, {
    imagePath: 'wxfile://poster.png',
    mounted: true,
  })

  try {
    preview.onShareTap()
    assert.equal(calls.shareImage, 0)
    assert.equal(calls.vibrate, 1, '不支持分享时必须警示')
  } finally {
    delete globalThis.wx
  }
})

test('预览保存：隐私拒绝 -> 弹窗引导，不写相册', async () => {
  const calls = installWxMock({ privacyDenied: true })
  const preference = await import(moduleUrl(path.join(ROOT, 'core/stores/preference.ts')))
  preference.preferenceStore.sound = false
  const definition = await loadDefinition(path.join(PREVIEW_DIR, 'index.ts'))
  const preview = createComponent(definition, { imagePath: 'wxfile://poster.png' })

  try {
    preview.savePoster()
    await flushPromises()
    assert.equal(calls.save, 0)
    assert.equal(calls.modal, 1)
    assert.equal(calls.vibrate, 1, '相册权限被拒必须触发全局警示震动 / 音效')
  } finally {
    delete globalThis.wx
  }
})

test('预览长按：ActionSheet 选项与保存链路', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const calls = installWxMock()
  const preference = await import(moduleUrl(path.join(ROOT, 'core/stores/preference.ts')))
  preference.preferenceStore.sound = false
  const definition = await loadDefinition(path.join(PREVIEW_DIR, 'index.ts'))
  const preview = createComponent(definition, {
    imagePath: 'wxfile://poster.png',
    mounted: true,
  })

  try {
    preview.onLongPress()
    await flushPromises()
    assert.deepEqual(calls.actionSheetItems, ['保存到相册'])
    assert.equal(calls.save, 1)
    assert.equal(calls.savedPath, 'wxfile://poster.png')
    assert.equal(preview.data.saving, false)
  } finally {
    t.mock.timers.reset()
    delete globalThis.wx
  }
})

test('全局静震：预览打开成功不触发震动', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const calls = installWxMock()
  const preference = await import(moduleUrl(path.join(ROOT, 'core/stores/preference.ts')))
  preference.preferenceStore.sound = false
  preference.preferenceStore.haptics = 'off'
  const definition = await loadDefinition(path.join(PREVIEW_DIR, 'index.ts'))
  const preview = createComponent(definition, {
    imagePath: 'wxfile://poster.png',
    show: true,
  })

  try {
    preview.openPreview()
    t.mock.timers.tick(30)
    assert.equal(preview.data.active, true)
    assert.equal(calls.vibrate, 0)
  } finally {
    preference.preferenceStore.haptics = 'light'
    t.mock.timers.reset()
    delete globalThis.wx
  }
})

test('焦点静震：预览打开 / 揭示 / 关闭均不触发震动', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const calls = installWxMock()
  const preference = await import(moduleUrl(path.join(ROOT, 'core/stores/preference.ts')))
  preference.preferenceStore.sound = false
  preference.preferenceStore.haptics = 'light'
  const definition = await loadDefinition(path.join(PREVIEW_DIR, 'index.ts'))
  const preview = createComponent(definition, {
    imagePath: 'wxfile://poster.png',
    show: true,
    haptic: 'none',
  })

  try {
    preview.openPreview()
    t.mock.timers.tick(30)
    preview.markImageReady()
    preview.writeAlbum()
    await flushPromises()
    preview.requestClose('close')
    assert.equal(calls.vibrate, 0, 'haptic=none 必须完全静震')
  } finally {
    t.mock.timers.reset()
    delete globalThis.wx
  }
})

test('预览保存：非权限失败不弹权限引导', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const calls = installWxMock({ saveFail: 'saveImageToPhotosAlbum:fail system error' })
  const preference = await import(moduleUrl(path.join(ROOT, 'core/stores/preference.ts')))
  preference.preferenceStore.sound = false
  const definition = await loadDefinition(path.join(PREVIEW_DIR, 'index.ts'))
  const preview = createComponent(definition, { imagePath: 'wxfile://poster.png' })

  try {
    preview.savePoster()
    await flushPromises()
    assert.equal(calls.save, 1)
    assert.equal(calls.modal, 0, '非权限错误不应误弹权限引导')
    assert.equal(calls.vibrate, 1, '保存失败必须触发全局警示震动 / 音效')
    assert.equal(preview.data.saving, false)
  } finally {
    t.mock.timers.reset()
    delete globalThis.wx
  }
})

test('预览长按：取消与空图片都不触发保存', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const calls = installWxMock({ actionSheetCancel: true })
  const preference = await import(moduleUrl(path.join(ROOT, 'core/stores/preference.ts')))
  preference.preferenceStore.sound = false
  const definition = await loadDefinition(path.join(PREVIEW_DIR, 'index.ts'))
  const preview = createComponent(definition, { imagePath: 'wxfile://poster.png' })

  try {
    preview.onLongPress()
    await flushPromises()
    assert.equal(calls.actionSheet, 1)
    assert.equal(calls.save, 0, '取消 ActionSheet 不应保存')

    const empty = createComponent(definition, { imagePath: '' })
    empty.onLongPress()
    assert.equal(calls.actionSheet, 1, '空图片不应唤起 ActionSheet')
  } finally {
    t.mock.timers.reset()
    delete globalThis.wx
  }
})

test('glass-tool-shell：先开预览骨架再绘制，失败保留错误态', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  installWxMock()
  const preference = await import(moduleUrl(path.join(ROOT, 'core/stores/preference.ts')))
  preference.preferenceStore.sound = false
  const definition = await loadDefinition(path.join(SHELL_DIR, 'index.ts'))
  const shell = createComponent(definition, {
    hasResult: true,
    toolId: 'unit',
    title: '单位换算',
  })
  shell.selectComponent = () => ({
    generate() {
      return Promise.reject(new Error('canvas failed'))
    },
  })

  try {
    shell.onGeneratePoster()
    /* 点击即入场：预览骨架先出现，不再等生成完成才硬弹 */
    assert.equal(shell.data.posterVisible, true)
    assert.equal(shell.data.isGenerating, true)

    t.mock.timers.tick(560)
    await flushPromises()

    assert.equal(shell.data.isGenerating, false)
    assert.equal(shell.data.posterVisible, true, '失败时保留预览展示错误态')
    assert.equal(shell.data.posterError, '极光海报生成失败，请关闭后重试')
    assert.equal(shell.data.posterPath, '')

    shell.onPosterClosed()
    assert.equal(shell.data.posterVisible, false)
    assert.equal(shell.data.posterError, '')
  } finally {
    t.mock.timers.reset()
    delete globalThis.wx
  }
})

test('glass-tool-shell：显式 posterValue 优先于页面自动回退', async () => {
  installWxMock()
  const definition = await loadDefinition(path.join(SHELL_DIR, 'index.ts'))
  const shell = createComponent(definition, {
    hasResult: true,
    posterValue: '显式结果',
  })
  globalThis.getCurrentPages = () => [{ data: { result: '页面结果' } }]

  try {
    assert.equal(shell.resolvePosterValue(), '显式结果')
  } finally {
    delete globalThis.getCurrentPages
    delete globalThis.wx
  }
})

test('glass-button：loading 使用节奏圆点 + 成功勾选，避免 Skyline 小方块', () => {
  const buttonWxml = fs.readFileSync(
    path.join(ROOT, 'components/glass-button/index.wxml'),
    'utf8',
  )
  const buttonWxss = fs.readFileSync(
    path.join(ROOT, 'components/glass-button/index.wxss'),
    'utf8',
  )

  assert.ok(buttonWxml.includes('glass-button__dots'))
  assert.equal(buttonWxml.includes('glass-button__loader'), false)
  assert.equal(buttonWxml.includes('glass-button__spinner'), false)
  assert.equal((buttonWxml.match(/glass-button__dot_/g) || []).length, 6)
  assert.ok(buttonWxss.includes('.glass-button__dots'))
  assert.ok(buttonWxss.includes('glass-button-dot-pulse'))
  assert.equal(buttonWxss.includes('glass-button-loader-pulse'), false)
  assert.equal(buttonWxss.includes('glass-button-spin'), false)
  assert.equal(buttonWxss.includes('border-top-color: transparent'), false)

  /* 生成 / 保存按钮的加载过渡：标签交叉淡入 + 流光，不允许硬切 */
  assert.ok(buttonWxml.includes('glass-button__label-idle'))
  assert.ok(buttonWxml.includes('glass-button__label-loading'))
  assert.ok(buttonWxml.includes('glass-button__loading-sheen'))
  assert.ok(buttonWxss.includes('.glass-button__label-loading_in'))
  assert.ok(buttonWxss.includes('glass-button-loading-sheen'))

  /* 保存成功态：勾选弹入 + 薄荷光晕，但绝不触发 box-shadow 过渡 */
  assert.ok(buttonWxml.includes('glass-button__label-success'))
  assert.ok(buttonWxml.includes('glass-button__check'))
  assert.ok(buttonWxml.includes('glass-button__success-tint'))
  assert.ok(buttonWxss.includes('.glass-button__success-tint_on'))
  assert.ok(buttonWxss.includes('glass-button-check-in'))
  /* 极致效果：主扫光无限循环 + 反向薄荷副扫光 + 呼吸光晕 + 成功涟漪 */
  assert.ok(buttonWxss.includes('animation: glass-button-loading-sheen 1100ms ease-in-out infinite'))
  assert.equal(buttonWxss.includes('glass-button-loading-sheen 900ms ease-out 1 both'), false)
  assert.ok(buttonWxml.includes('glass-button__loading-sheen_soft'))
  assert.ok(buttonWxss.includes('glass-button-loading-sheen-soft 2200ms'))
  assert.ok(buttonWxml.includes('glass-button__aura'))
  assert.ok(buttonWxss.includes('glass-button-aura 1600ms'))
  assert.ok(buttonWxml.includes('glass-button__success-ring'))
  assert.ok(buttonWxss.includes('glass-button-success-ring'))
  assert.ok(buttonWxss.includes('glass-button-check-glow'))
})

test('glass-tool-shell：结果字段回退 + 生成调度闭环', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  installWxMock()
  const preference = await import(moduleUrl(path.join(ROOT, 'core/stores/preference.ts')))
  preference.preferenceStore.sound = false
  const definition = await loadDefinition(path.join(SHELL_DIR, 'index.ts'))
  const shell = createComponent(definition, {
    hasResult: true,
    toolId: 'unit',
    title: '单位换算',
    desc: '长度 · 质量 · 温度 · 面积',
  })

  let payload = null
  shell.selectComponent = () => ({
    generate(input) {
      payload = input
      return Promise.resolve('wxfile://poster.png')
    },
  })
  globalThis.getCurrentPages = () => [
    { data: { result: '123', formula: '1 m = 100 cm' } },
  ]

  try {
    assert.equal(shell.resolvePosterValue(), '123')
    assert.equal(shell.resolvePosterSubtitle(), '1 m = 100 cm')

    shell.onGeneratePoster()
    /* 骨架先行：绘制延后到入场动画落位之后 */
    assert.equal(shell.data.posterVisible, true)
    assert.equal(shell.data.isGenerating, true)
    assert.equal(shell.data.posterPath, '')
    assert.equal(payload, null)

    t.mock.timers.tick(560)
    await flushPromises()

    assert.ok(payload)
    assert.equal(payload.mainResult, '123')
    assert.equal(payload.toolName, '单位换算')
    assert.equal(payload.category, '计算换算', '兜底分类来自工具注册表')
    assert.deepEqual(payload.extras, ['1 m = 100 cm'], '兜底说明进入 extras')
    assert.equal(shell.data.posterVisible, true)
    assert.equal(shell.data.posterPath, 'wxfile://poster.png')
    assert.equal(shell.data.isGenerating, false)

    shell.onPosterClosed()
    assert.equal(shell.data.posterVisible, false)
    assert.equal(shell.data.posterPath, '')
  } finally {
    delete globalThis.getCurrentPages
    t.mock.timers.reset()
    delete globalThis.wx
  }
})

test('IPosterData：主结果必填、参数过滤并限制为 4 组', async () => {
  const { normalizePosterData } = await import(
    moduleUrl(path.join(ROOT, 'core/toolbox/poster.ts'))
  )

  assert.equal(normalizePosterData(null), null)
  assert.equal(normalizePosterData('x'), null)
  assert.equal(normalizePosterData({ toolName: '房贷试算' }), null)

  const normalized = normalizePosterData({
    toolName: '  房贷试算  ',
    category: '财务计算',
    mainResult: '¥5,368.00',
    resultLabel: '每月月供',
    params: [
      { label: '贷款金额', value: '100 万元' },
      { label: '', value: '空标签' },
      { label: 'A', value: '1' },
      { label: 'B', value: '2' },
      { label: 'C', value: '3' },
      { label: 'D', value: '4' },
    ],
    extras: ['总利息约 932,480 元', '', '利息占比 38.1%', '总还款 1,616,562 元', '第五条', '第六条'],
  })

  assert.equal(normalized.toolName, '房贷试算')
  assert.equal(normalized.category, '财务计算')
  assert.equal(normalized.mainResult, '¥5,368.00')
  assert.equal(normalized.resultLabel, '每月月供')
  assert.equal(normalized.params.length, 4, '最多保留 4 组参数')
  assert.ok(normalized.params.every((param) => param.label && param.value))
  assert.equal(normalized.extras.length, 4, '最多保留 4 条衍生结论')
  assert.ok(normalized.extras.every((item) => item.length > 0))
})

test('glass-tool-shell：posterData 优先，真实业务参数进入绘制', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  installWxMock()
  const preference = await import(moduleUrl(path.join(ROOT, 'core/stores/preference.ts')))
  preference.preferenceStore.sound = false
  const definition = await loadDefinition(path.join(SHELL_DIR, 'index.ts'))
  const shell = createComponent(definition, {
    hasResult: true,
    toolId: 'loan',
    title: '房贷试算',
    posterData: {
      toolName: '房贷试算',
      category: '财务计算',
      mainResult: '¥5,368.00',
      resultLabel: '每月月供',
      params: [
        { label: '贷款金额', value: '100 万元' },
        { label: '年利率', value: '3.50%' },
        { label: '贷款年限', value: '30 年' },
        { label: '还款方式', value: '等额本息' },
      ],
      extras: ['总利息 ¥932,480.00', '利息占比 36.6%', '总还款 ¥1,616,562.00'],
    },
  })

  let payload = null
  shell.selectComponent = () => ({
    generate(input) {
      payload = input
      return Promise.resolve('wxfile://poster.png')
    },
  })

  try {
    shell.onGeneratePoster()
    t.mock.timers.tick(560)
    await flushPromises()

    assert.ok(payload)
    assert.equal(payload.toolName, '房贷试算')
    assert.equal(payload.mainResult, '¥5,368.00')
    assert.equal(payload.resultLabel, '每月月供')
    assert.equal(payload.params.length, 4)
    assert.equal(payload.params[0].value, '100 万元')
    assert.equal(payload.category, '财务计算')
    assert.deepEqual(payload.extras, [
      '总利息 ¥932,480.00',
      '利息占比 36.6%',
      '总还款 ¥1,616,562.00',
    ])
    assert.equal(shell.data.posterPath, 'wxfile://poster.png')
  } finally {
    t.mock.timers.reset()
    delete globalThis.wx
  }
})

test('工具页数据契约：22 个工具页全部传递真实 posterData', () => {
  const roots = ['tools-core', 'tools-media']
  const toolPages = []
  for (const root of roots) {
    const base = path.join(ROOT, 'subpackages', root, 'pages')
    for (const entry of fs.readdirSync(base)) {
      const wxmlPath = path.join(base, entry, 'index.wxml')
      if (!fs.existsSync(wxmlPath)) {
        continue
      }
      const wxml = fs.readFileSync(wxmlPath, 'utf8')
      if (!wxml.includes('<glass-tool-shell')) {
        continue
      }
      toolPages.push({ name: entry, wxmlPath })
    }
  }

  assert.equal(toolPages.length, 22, '工具页数量必须为 22')
  for (const page of toolPages) {
    const wxml = fs.readFileSync(page.wxmlPath, 'utf8')
    const tsPath = page.wxmlPath.replace(/\.wxml$/, '.ts')
    const ts = fs.readFileSync(tsPath, 'utf8')

    assert.ok(
      wxml.includes('poster-data="{{posterData}}"'),
      `${page.name} 未把 posterData 传给 glass-tool-shell`,
    )
    assert.ok(
      ts.includes('posterData: null as IPosterData | null'),
      `${page.name} 未声明 posterData`,
    )
    assert.ok(
      ts.includes('posterData: poster'),
      `${page.name} 未在计算成功后回填真实业务数据`,
    )
    assert.ok(ts.includes("category: '"), `${page.name} 缺部分类胶囊字段`)
    assert.match(ts, /extras: \[|extras,/, `${page.name} 缺少衍生结论 extras`)
  }
})

test('新工具海报：Hash / 文本对比复用壳层入口，不重复引入海报组件', () => {
  const pages = ['hash', 'text-diff']
  for (const name of pages) {
    const dir = path.join(ROOT, 'subpackages/tools-core/pages', name)
    const wxml = fs.readFileSync(path.join(dir, 'index.wxml'), 'utf8')
    const json = fs.readFileSync(path.join(dir, 'index.json'), 'utf8')

    assert.ok(wxml.includes('poster-data="{{posterData}}"'), `${name} 未传 posterData`)
    assert.ok(wxml.includes('poster-enabled="{{true}}"'), `${name} 未开启海报入口`)
    assert.equal(
      wxml.includes('poster-enabled="{{false}}"'),
      false,
      `${name} 仍关闭海报入口`,
    )
    /* 壳层已内置 poster-generator / poster-preview，页面不得再引入副本 */
    assert.equal(json.includes('poster-generator'), false, `${name} 重复引入绘制器`)
    assert.equal(json.includes('poster-preview'), false, `${name} 重复引入预览层`)
  }

  const hashTs = fs.readFileSync(
    path.join(ROOT, 'subpackages/tools-core/pages/hash/index.ts'),
    'utf8',
  )
  assert.ok(hashTs.includes("toolName: 'Hash 与加密'"))
  assert.ok(hashTs.includes('resultLabel: input.algorithmLabel'))
  assert.ok(hashTs.includes("label: '输入摘要'"))
  assert.ok(hashTs.includes("label: '模式'"))
  assert.ok(hashTs.includes("extras: ['极客级本地加密计算']"))
  assert.ok(hashTs.includes('POSTER_HEX_LIMIT = 32'), '必须截取前 32 位')
  assert.ok(hashTs.includes('POSTER_INPUT_LIMIT = 10'), '输入摘要必须截取前 10 个字符')
  assert.match(
    hashTs,
    /posterData:[\s\S]{0,120}buildHashPoster/,
    '大小写切换需同步海报',
  )

  const diffTs = fs.readFileSync(
    path.join(ROOT, 'subpackages/tools-core/pages/text-diff/index.ts'),
    'utf8',
  )
  assert.ok(diffTs.includes("toolName: '专业文本对比'"))
  assert.ok(diffTs.includes("resultLabel: '比对结果'"))
  assert.ok(diffTs.includes("label: '原文本长度'"))
  assert.ok(diffTs.includes("label: '新文本长度'"))
  assert.ok(diffTs.includes('差异率 '))
  assert.ok(diffTs.includes('新增: ${input.insertCount} 处'))
  assert.ok(diffTs.includes('删除: ${input.deleteCount} 处'))
  assert.ok(diffTs.includes('耗时: ${input.elapsedMs}ms'))
})
