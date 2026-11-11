/* ==========================================================================
   批 3 · 证件照换底（id-photo）
   - 引擎：纯色 / 渐变 / 纹理 / 复杂背景智能识别、漫水换底、肩部保护、羽化
   - 契约：tools-media / 页面 / 参数滑块 / 注册 / 帮助 / 图片工作流 / 隐私
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { registerHooks } = require('node:module')

const ROOT = path.resolve(__dirname, '..')
const URL_ROOT = `${require('node:url').pathToFileURL(ROOT).href}/`
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !path.extname(specifier)) {
      return nextResolve(`${specifier}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})

async function loadIdPhoto() {
  return import(`${URL_ROOT}subpackages/tools-media/lib/idphoto.ts`)
}

const BLUE = { r: 67, g: 142, b: 219 }
const DARK_BLUE = { r: 20, g: 60, b: 120 }
const GREEN = { r: 20, g: 200, b: 40 }
const RED = { r: 217, g: 0, b: 27 }
const SKIN = { r: 200, g: 120, b: 90 }
const GRAY_A = { r: 128, g: 128, b: 128 }
const GRAY_B = { r: 170, g: 170, b: 170 }
const JACKET = { r: 35, g: 38, b: 45 }

function isSubject(x, y, width, height) {
  return (
    x >= Math.floor(width / 3) &&
    x < Math.floor((width * 2) / 3) &&
    y >= Math.floor(height / 5) &&
    y < Math.floor((height * 4) / 5)
  )
}

function makePixels(width, height, colorAt) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4
      const color = colorAt(x, y)
      data[index] = color.r
      data[index + 1] = color.g
      data[index + 2] = color.b
      data[index + 3] = 255
    }
  }
  return data
}

function makeSolid(width, height, background, foreground = SKIN) {
  return makePixels(width, height, (x, y) =>
    isSubject(x, y, width, height) ? foreground : background,
  )
}

function makeGradient(width, height, left, right, foreground = SKIN) {
  return makePixels(width, height, (x, y) => {
    if (isSubject(x, y, width, height)) {
      return foreground
    }
    const t = x / (width - 1)
    return {
      r: left.r + (right.r - left.r) * t,
      g: left.g + (right.g - left.g) * t,
      b: left.b + (right.b - left.b) * t,
    }
  })
}

function makeChecker(width, height, a, b, foreground = SKIN) {
  return makePixels(width, height, (x, y) => {
    if (isSubject(x, y, width, height)) {
      return foreground
    }
    return (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0 ? a : b
  })
}

function makeSplit(width, height, left, right, foreground = SKIN) {
  return makePixels(width, height, (x, y) => {
    if (isSubject(x, y, width, height)) {
      return foreground
    }
    return x < width / 2 ? left : right
  })
}

function pixelAt(data, width, x, y) {
  const offset = (y * width + x) * 4
  return Array.from(data.slice(offset, offset + 3))
}

test('证件照：纯色 / 渐变 / 纹理 / 复杂背景都可识别，不再直接拒绝', async () => {
  const idphoto = await loadIdPhoto()
  const width = 120
  const height = 160

  const solid = idphoto.analyzeIdPhotoBackground(
    makeSolid(width, height, BLUE),
    width,
    height,
  )
  assert.ok(solid)
  assert.equal(solid.ok, true)
  assert.equal(solid.backgroundType, 'solid')
  assert.equal(solid.confidence, 'high')

  const gradient = idphoto.analyzeIdPhotoBackground(
    makeGradient(width, height, BLUE, DARK_BLUE),
    width,
    height,
  )
  assert.ok(gradient)
  assert.equal(gradient.backgroundType, 'gradient')

  const textured = idphoto.analyzeIdPhotoBackground(
    makeChecker(width, height, GRAY_A, GRAY_B),
    width,
    height,
  )
  assert.ok(textured)
  assert.equal(textured.backgroundType, 'textured')

  const complex = idphoto.analyzeIdPhotoBackground(
    makeSplit(width, height, BLUE, GREEN),
    width,
    height,
  )
  assert.ok(complex)
  assert.equal(complex.backgroundType, 'complex')
  assert.equal(complex.confidence, 'low')
})

test('证件照：纯色背景换底，保留主体与角点替换', async () => {
  const idphoto = await loadIdPhoto()
  const width = 120
  const height = 160
  const data = makeSolid(width, height, BLUE)
  const result = idphoto.autoReplaceIdPhotoBackground(data, width, height, RED, {
    tolerance: 28,
    featherRadius: 1,
    edgeProtect: 60,
  })
  assert.ok(result)
  assert.equal(result.backgroundType, 'solid')
  assert.equal(result.confidence, 'high')
  assert.ok(result.removedRatio > 0.5)
  assert.ok(result.changed > 0)
  assert.deepEqual(pixelAt(result.data, width, 0, 0), [217, 0, 27])
  assert.deepEqual(pixelAt(result.data, width, 60, 80), [200, 120, 90])
})

test('证件照：渐变与纹理背景也能换底', async () => {
  const idphoto = await loadIdPhoto()
  const width = 120
  const height = 160

  const gradient = idphoto.autoReplaceIdPhotoBackground(
    makeGradient(width, height, BLUE, DARK_BLUE),
    width,
    height,
    RED,
    { tolerance: 28, featherRadius: 1, edgeProtect: 60 },
  )
  assert.ok(gradient)
  assert.equal(gradient.backgroundType, 'gradient')
  assert.ok(gradient.removedRatio > 0.5)
  assert.deepEqual(pixelAt(gradient.data, width, 0, 0), [217, 0, 27])
  assert.deepEqual(pixelAt(gradient.data, width, 60, 80), [200, 120, 90])

  const textured = idphoto.autoReplaceIdPhotoBackground(
    makeChecker(width, height, GRAY_A, GRAY_B),
    width,
    height,
    RED,
    { tolerance: 32, featherRadius: 1, edgeProtect: 60 },
  )
  assert.ok(textured)
  assert.equal(textured.backgroundType, 'textured')
  assert.ok(textured.removedRatio > 0.5)
  assert.deepEqual(pixelAt(textured.data, width, 0, 0), [217, 0, 27])
  assert.deepEqual(pixelAt(textured.data, width, 60, 80), [200, 120, 90])
})

test('证件照：复杂分割背景不再报错，仍尝试换底', async () => {
  const idphoto = await loadIdPhoto()
  const width = 120
  const height = 160
  const data = makeSplit(width, height, BLUE, GREEN)
  const result = idphoto.autoReplaceIdPhotoBackground(data, width, height, RED, {
    tolerance: 32,
    featherRadius: 1,
    edgeProtect: 60,
  })
  assert.ok(result)
  assert.equal(result.backgroundType, 'complex')
  assert.equal(result.confidence, 'low')
  assert.ok(result.removedRatio > 0.5)
  assert.deepEqual(pixelAt(result.data, width, 0, 0), [217, 0, 27])
  assert.deepEqual(pixelAt(result.data, width, 60, 80), [200, 120, 90])
})

test('证件照：底部肩部衣物不会被当作背景删除', async () => {
  const idphoto = await loadIdPhoto()
  const width = 120
  const height = 160
  const data = makePixels(width, height, (_x, y) =>
    y >= Math.floor(height * 0.78) ? JACKET : BLUE,
  )
  const result = idphoto.autoReplaceIdPhotoBackground(data, width, height, RED, {
    tolerance: 28,
    featherRadius: 1,
    edgeProtect: 60,
  })
  assert.ok(result)
  assert.deepEqual(pixelAt(result.data, width, 0, 0), [217, 0, 27])
  assert.deepEqual(pixelAt(result.data, width, 60, Math.floor(height * 0.95)), [35, 38, 45])
  assert.ok(result.removedRatio < 0.9)
})

test('证件照：羽化半径与边缘混合', async () => {
  const idphoto = await loadIdPhoto()
  const width = 120
  const height = 160
  const data = makeSolid(width, height, BLUE)

  const hard = idphoto.autoReplaceIdPhotoBackground(data, width, height, RED, {
    tolerance: 28,
    featherRadius: 0,
    edgeProtect: 60,
  })
  assert.ok(hard)
  assert.equal(hard.featherRadius, 0)
  assert.deepEqual(pixelAt(hard.data, width, 39, 80), [217, 0, 27])
  assert.deepEqual(pixelAt(hard.data, width, 40, 80), [200, 120, 90])

  const soft = idphoto.autoReplaceIdPhotoBackground(data, width, height, RED, {
    tolerance: 28,
    featherRadius: 2,
    edgeProtect: 60,
  })
  assert.ok(soft)
  assert.equal(soft.featherRadius, 2)
  const edge = pixelAt(soft.data, width, 40, 80)
  assert.notDeepEqual(edge, [217, 0, 27])
  assert.notDeepEqual(edge, [200, 120, 90])
})

test('证件照：输出尺寸、默认羽化与非法输入', async () => {
  const idphoto = await loadIdPhoto()
  assert.deepEqual(idphoto.idPhotoOutputSize(3000, 4000), {
    width: 900,
    height: 1200,
    scale: 0.3,
  })
  assert.deepEqual(idphoto.idPhotoOutputSize(800, 1000), {
    width: 800,
    height: 1000,
    scale: 1,
  })
  assert.equal(idphoto.idPhotoOutputSize(0, 100), null)
  assert.equal(idphoto.idPhotoFeatherRadius(1200), 2)
  assert.equal(idphoto.idPhotoFeatherRadius(400), 1)
  assert.equal(idphoto.idPhotoFeatherRadius(0), 1)

  assert.equal(
    idphoto.autoReplaceIdPhotoBackground(new Uint8ClampedArray(4), 1, 1, RED),
    null,
  )
  assert.equal(idphoto.analyzeIdPhotoBackground(new Uint8ClampedArray(4), 1, 1), null)
  assert.equal(idphoto.idPhotoBackgroundByKey('green'), null)
})

test('证件照：垂直渐变识别与多背景簇统计', async () => {
  const idphoto = await loadIdPhoto()
  const width = 120
  const height = 160
  const vertical = makePixels(width, height, (x, y) => {
    if (isSubject(x, y, width, height)) {
      return SKIN
    }
    const t = y / (height - 1)
    return {
      r: BLUE.r + (DARK_BLUE.r - BLUE.r) * t,
      g: BLUE.g + (DARK_BLUE.g - BLUE.g) * t,
      b: BLUE.b + (DARK_BLUE.b - BLUE.b) * t,
    }
  })
  const gradient = idphoto.analyzeIdPhotoBackground(vertical, width, height)
  assert.ok(gradient)
  assert.equal(gradient.backgroundType, 'gradient')
  assert.ok(gradient.clusterCount >= 2)

  const split = idphoto.analyzeIdPhotoBackground(
    makeSplit(width, height, BLUE, GREEN),
    width,
    height,
  )
  assert.ok(split)
  assert.equal(split.backgroundType, 'complex')
  assert.ok(split.clusterCount >= 2)
  assert.ok(split.maxDistance <= 90)
})

function makeTransitionRing(width, height, background, ring) {
  const margin = 4
  const thickness = 6
  return makePixels(width, height, (x, y) => {
    if (isSubject(x, y, width, height)) {
      return SKIN
    }
    const outer =
      x >= margin && x < width - margin && y >= margin && y < height - margin
    const inner =
      x >= margin + thickness &&
      x < width - margin - thickness &&
      y >= margin + thickness &&
      y < height - margin - thickness
    return outer && !inner ? ring : background
  })
}

test('证件照：容差越高移除越多，边缘保护越高越保守', async () => {
  const idphoto = await loadIdPhoto()
  const width = 120
  const height = 160
  const ring = { r: 67, g: 102, b: 219 }
  const data = makeTransitionRing(width, height, BLUE, ring)

  const lowTolerance = idphoto.autoReplaceIdPhotoBackground(data, width, height, RED, {
    tolerance: 12,
    featherRadius: 0,
    edgeProtect: 60,
  })
  const highTolerance = idphoto.autoReplaceIdPhotoBackground(data, width, height, RED, {
    tolerance: 48,
    featherRadius: 0,
    edgeProtect: 60,
  })
  assert.ok(lowTolerance && highTolerance)
  assert.ok(
    highTolerance.removedRatio > lowTolerance.removedRatio,
    '提高容差应能跨越过渡色环',
  )

  const lowProtect = idphoto.autoReplaceIdPhotoBackground(data, width, height, RED, {
    tolerance: 48,
    featherRadius: 0,
    edgeProtect: 0,
  })
  const highProtect = idphoto.autoReplaceIdPhotoBackground(data, width, height, RED, {
    tolerance: 48,
    featherRadius: 0,
    edgeProtect: 100,
  })
  assert.ok(lowProtect && highProtect)
  assert.ok(
    lowProtect.removedRatio > highProtect.removedRatio,
    '提高边缘保护应减少跨越边缘的移除',
  )
})

test('证件照：参数越界会被夹取', async () => {
  const idphoto = await loadIdPhoto()
  const width = 120
  const height = 160
  const data = makeSolid(width, height, BLUE)

  const low = idphoto.autoReplaceIdPhotoBackground(data, width, height, RED, {
    tolerance: 0,
    featherRadius: 99,
    edgeProtect: -20,
  })
  assert.ok(low)
  assert.equal(low.threshold, 8)
  assert.equal(low.featherRadius, 6)

  const high = idphoto.autoReplaceIdPhotoBackground(data, width, height, RED, {
    tolerance: 999,
    featherRadius: -5,
    edgeProtect: 999,
  })
  assert.ok(high)
  assert.equal(high.threshold, 64)
  assert.equal(high.featherRadius, 0)
})

test('证件照：顶部头发不参与背景模型，不会被误删', async () => {
  const idphoto = await loadIdPhoto()
  const width = 120
  const height = 160
  const data = makePixels(width, height, (x, y) => {
    if (y < 24 && x >= 48 && x < 72) {
      return { r: 18, g: 16, b: 14 }
    }
    if (isSubject(x, y, width, height)) {
      return SKIN
    }
    return BLUE
  })
  const analysis = idphoto.analyzeIdPhotoBackground(data, width, height)
  assert.ok(analysis)
  assert.equal(analysis.backgroundType, 'solid')

  const result = idphoto.autoReplaceIdPhotoBackground(data, width, height, RED, {
    tolerance: 28,
    featherRadius: 1,
    edgeProtect: 60,
  })
  assert.ok(result)
  assert.deepEqual(pixelAt(result.data, width, 0, 0), [217, 0, 27])
  assert.deepEqual(pixelAt(result.data, width, 60, 10), [18, 16, 14])
})

test('证件照：主体内部与背景同色的区域靠连通性保留', async () => {
  const idphoto = await loadIdPhoto()
  const width = 120
  const height = 160
  const data = makePixels(width, height, (x, y) => {
    if (isSubject(x, y, width, height)) {
      return x >= 55 && x < 65 && y >= 70 && y < 90 ? BLUE : SKIN
    }
    return BLUE
  })
  const result = idphoto.autoReplaceIdPhotoBackground(data, width, height, RED, {
    tolerance: 28,
    featherRadius: 0,
    edgeProtect: 60,
  })
  assert.ok(result)
  assert.deepEqual(pixelAt(result.data, width, 0, 0), [217, 0, 27])
  assert.deepEqual(pixelAt(result.data, width, 60, 80), [67, 142, 219])
})

test('证件照：同一输入重复计算结果一致', async () => {
  const idphoto = await loadIdPhoto()
  const width = 120
  const height = 160
  const data = makeGradient(width, height, BLUE, DARK_BLUE)
  const options = { tolerance: 30, featherRadius: 2, edgeProtect: 55 }
  const first = idphoto.autoReplaceIdPhotoBackground(data, width, height, RED, options)
  const second = idphoto.autoReplaceIdPhotoBackground(data, width, height, RED, options)
  assert.ok(first && second)
  assert.equal(first.changed, second.changed)
  assert.equal(first.removedRatio, second.removedRatio)
  assert.deepEqual(
    Array.from(first.data.slice(0, 6400)),
    Array.from(second.data.slice(0, 6400)),
  )
})

test('证件照契约：页面 / 参数滑块 / 注册 / 帮助 / 图片工作流 / 隐私', async () => {
  const app = JSON.parse(read('app.json'))
  const media = app.subpackages.find((item) => item.root === 'subpackages/tools-media')
  assert.ok(media, 'app.json 缺少 tools-media 分包')
  assert.ok(media.pages.includes('pages/id-photo/index'), 'tools-media 未注册 id-photo 页面')

  for (const ext of ['.ts', '.json', '.wxml', '.wxss']) {
    assert.ok(
      fs.existsSync(path.join(ROOT, `subpackages/tools-media/pages/id-photo/index${ext}`)),
      `缺少证件照换底页面文件 ${ext}`,
    )
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'subpackages/tools-media/lib/idphoto.ts')))

  const pageJson = JSON.parse(read('subpackages/tools-media/pages/id-photo/index.json'))
  assert.equal(pageJson.navigationBarTitleText, '证件照换底')

  const wxml = read('subpackages/tools-media/pages/id-photo/index.wxml')
  assert.match(wxml, /tool-id="id-photo"/)
  assert.match(wxml, /bind:tap="onChoose"/)
  assert.match(wxml, /bindtap="onBackground"/)
  assert.match(wxml, /bind:run="onRun"/)
  assert.match(wxml, /bindtap="onPreview"/)
  assert.match(wxml, /bind:tap="onSave"/)
  assert.match(wxml, /背景容差/)
  assert.match(wxml, /边缘保护/)
  assert.match(wxml, /边缘羽化/)
  assert.match(wxml, /onToleranceChange/)
  assert.match(wxml, /onEdgeProtectChange/)
  assert.match(wxml, /onFeatherChange/)
  assert.match(wxml, /不做人脸识别/)

  const ts = read('subpackages/tools-media/pages/id-photo/index.ts')
  assert.match(ts, /onShareAppMessage\s*\(/)
  assert.match(ts, /onShareTimeline\s*\(/)
  assert.match(ts, /chooseSingleImage/)
  assert.match(ts, /autoReplaceIdPhotoBackground/)
  assert.match(ts, /render\s*\(/)
  assert.equal(/detectBackground/.test(ts), false, '页面不得再使用纯色背景检测')
  assert.equal(
    /wx\.request|uploadFile|downloadFile/.test(ts),
    false,
    '证件照换底不得联网',
  )

  const registry = read('core/toolbox/registry.ts')
  assert.match(registry, /id: 'id-photo'/)
  assert.match(registry, /name: '证件照换底'/)
  assert.match(registry, /weight: 58/)
  assert.match(registry, /sensitive: 'privacy'/)
  assert.match(registry, /智能/)
  assert.match(registry, /不提取人脸特征/)
  assert.match(registry, /subpackages\/tools-media\/pages\/id-photo\/index/)
  assert.match(read('subpackages/grow/lib/help.ts'), /'id-photo': \{/)
  assert.match(read('subpackages/grow/lib/help.ts'), /复杂背景/)
  assert.match(read('scripts/check-budget.js'), /pages\/id-photo/)
  assert.match(read('scripts/e2e-tools.js'), /id: 'id-photo'/)

  const config = await import(`${URL_ROOT}core/workflow/workflowConfig.ts`)
  assert.equal(config.WORKFLOW_ROUTING['id-photo'], 'jump')
  assert.deepEqual(config.WORKFLOW_ACCEPTS['id-photo'], ['image'])

  const source = await import(`${URL_ROOT}core/workflow/workflowSource.ts`)
  assert.deepEqual(source.WORKFLOW_SOURCE_KEYS['id-photo'].image, ['outputPath'])

  const adapters = await import(`${URL_ROOT}core/workflow/workflowAdapters.ts`)
  assert.ok(adapters.getWorkflowAdapter('id-photo'), '缺少 id-photo 图片适配器')
})
