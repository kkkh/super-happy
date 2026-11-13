/* ==========================================================================
   批 2 · 圆角头像（avatar）
   - 引擎：中心裁切、三种形状、输出尺寸、透明边角、源图缩放
   - 契约：页面 / 注册 / 帮助 / 图片工作流 / 适配器 / 包体清单
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

async function loadAvatar() {
  return import(`${URL_ROOT}subpackages/tools-media/lib/avatar.ts`)
}

test('头像：中心裁切坐标覆盖横图 / 竖图 / 方图', async () => {
  const avatar = await loadAvatar()
  assert.deepEqual(avatar.avatarCropRect(1200, 800), { x: 200, y: 0, size: 800 })
  assert.deepEqual(avatar.avatarCropRect(800, 1200), { x: 0, y: 200, size: 800 })
  assert.deepEqual(avatar.avatarCropRect(600, 600), { x: 0, y: 0, size: 600 })
  assert.equal(avatar.avatarCropRect(31, 200), null)
  assert.equal(avatar.avatarCropRect(0, 200), null)
})

test('头像：三种形状的圆角半径', async () => {
  const avatar = await loadAvatar()
  assert.equal(avatar.avatarRadius('circle', 512), 256)
  assert.equal(avatar.avatarRadius('round12', 512), 61)
  assert.equal(avatar.avatarRadius('round25', 512), 128)
  assert.equal(avatar.avatarRadius('round12', 256), 31)
  assert.equal(avatar.avatarRadius('round25', 256), 64)
})

test('头像：输出尺寸只接受 256 / 512 / 1024', async () => {
  const avatar = await loadAvatar()
  assert.equal(avatar.avatarOutputSize(256), 256)
  assert.equal(avatar.avatarOutputSize(512), 512)
  assert.equal(avatar.avatarOutputSize(1024), 1024)
  assert.equal(avatar.avatarOutputSize(300), null)
  assert.equal(avatar.avatarOutputSize(0), null)
  assert.deepEqual(avatar.AVATAR_SIZES, [256, 512, 1024])
})

test('头像：四角透明与源图 2048 缩放', async () => {
  const avatar = await loadAvatar()
  const size = 512
  assert.equal(avatar.avatarAlphaAt('circle', size, 1, 1), 0, '圆形左上角透明')
  assert.equal(avatar.avatarAlphaAt('circle', size, size / 2, size / 2), 255, '圆形中心保留')
  assert.equal(avatar.avatarAlphaAt('round12', size, 0, 0), 0, '圆角左上角透明')
  assert.equal(avatar.avatarAlphaAt('round25', size, 0, 0), 0, '大圆角左上角透明')
  assert.equal(avatar.avatarAlphaAt('round12', size, size / 2, size / 2), 255)
  assert.equal(avatar.avatarAlphaAt('circle', size, size + 1, 0), 0, '越界透明')

  assert.equal(avatar.avatarSourceScale(1000, 800), 1)
  assert.equal(avatar.avatarSourceScale(4096, 3000), 0.5)
  assert.equal(avatar.avatarSourceScale(1024, 2048), 1)
  assert.equal(Math.round(4096 * avatar.avatarSourceScale(4096, 3000)), 2048)
})

test('头像契约：页面 / 注册 / 帮助 / 图片工作流 / 适配器 / 包体清单', async () => {
  const app = JSON.parse(read('app.json'))
  const media = app.subpackages.find((item) => item.root === 'subpackages/tools-media')
  assert.ok(media.pages.includes('pages/avatar/index'), 'app.json 未注册页面')

  for (const ext of ['.ts', '.json', '.wxml', '.wxss']) {
    assert.ok(
      fs.existsSync(path.join(ROOT, `subpackages/tools-media/pages/avatar/index${ext}`)),
      `缺少页面文件 ${ext}`,
    )
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'subpackages/tools-media/lib/avatar.ts')), '缺少头像引擎')

  const wxml = read('subpackages/tools-media/pages/avatar/index.wxml')
  assert.match(wxml, /tool-id="avatar"/)
  assert.match(wxml, /show-run="\{\{false\}\}"/)
  assert.match(wxml, /id="avatar-canvas"/)
  assert.match(wxml, /type="2d"/)
  assert.match(wxml, /bind:tap="onSave"/)
  assert.match(wxml, /bind:tap="onPreview"/)

  const ts = read('subpackages/tools-media/pages/avatar/index.ts')
  assert.match(ts, /onShareAppMessage\s*\(/)
  assert.match(ts, /onShareTimeline\s*\(/)
  assert.match(ts, /avatarOutputSize/)
  assert.match(ts, /avatarCropRect/)
  assert.match(ts, /exportCanvas\(canvas, size, size, 'png'/)
  assert.match(ts, /onUnload\s*\(\)/)
  assert.equal(/wx\.request|uploadFile|downloadFile/.test(ts), false, '不得联网')

  const registry = read('core/toolbox/registry.ts')
  assert.match(registry, /id: 'avatar'/)
  assert.match(registry, /weight: 75/)
  assert.match(registry, /sensitive: 'privacy'/)
  assert.match(read('subpackages/grow/lib/help.ts'), /avatar: \{/)
  assert.match(read('scripts/check-budget.js'), /pages\/avatar/)
  assert.match(read('scripts/e2e-tools.js'), /id: 'avatar'/)

  const config = await import(`${URL_ROOT}core/workflow/workflowConfig.ts`)
  assert.equal(config.WORKFLOW_ROUTING.avatar, 'jump')
  assert.deepEqual(config.WORKFLOW_ACCEPTS.avatar, ['image'])

  const source = await import(`${URL_ROOT}core/workflow/workflowSource.ts`)
  assert.deepEqual(source.WORKFLOW_SOURCE_KEYS.avatar.image, ['outputPath'])

  const adapters = await import(`${URL_ROOT}core/workflow/workflowAdapters.ts`)
  assert.ok(adapters.getWorkflowAdapter('avatar'), '缺少 avatar 图片适配器')
})

test('头像 / 九宫格：源图 12MP 上限与压缩工具一致', () => {
  const limits = read('core/constants/index.ts')
  const avatar = read('subpackages/tools-media/pages/avatar/index.ts')
  const nineGrid = read('subpackages/tools-media/pages/nine-grid/index.ts')

  assert.match(limits, /MEDIA_SOURCE_PIXELS:\s*12_000_000/)
  assert.match(avatar, /LIMITS\.MEDIA_SOURCE_PIXELS/)
  assert.match(nineGrid, /LIMITS\.MEDIA_SOURCE_PIXELS/)
})
