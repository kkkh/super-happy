/* ==========================================================================
   字号档 · 纯函数、持久化、对比度与页面契约
   - 三档映射 / 旧快照兼容 / 非法值 / 持久化失败
   - check-contrast 作为门禁的一部分在测试内复用
   - 5 页、设置页、外壳、TabBar 与共享组件契约
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { registerHooks } = require('node:module')
const { pathToFileURL } = require('node:url')

const ROOT = path.resolve(__dirname, '..')

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !path.extname(specifier)) {
      return nextResolve(`${specifier}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})

function moduleUrl(relative) {
  return pathToFileURL(path.join(ROOT, relative)).href
}

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8')
}

function installStorageMock(seed = {}) {
  const values = { ...seed }
  const writes = []
  globalThis.wx = {
    getStorageSync(key) {
      return key in values ? values[key] : ''
    },
    setStorageSync(key, value) {
      values[key] = value
      writes.push({ key, value })
    },
    removeStorageSync(key) {
      delete values[key]
    },
    getDeviceInfo() {
      return { platform: 'node' }
    },
    getSystemInfoSync() {
      return { platform: 'node' }
    },
  }
  return { values, writes }
}

async function loadModules() {
  const preference = await import(moduleUrl('core/stores/preference.ts'))
  const fontScale = await import(moduleUrl('core/services/font-scale.ts'))
  return { preference, fontScale }
}

function resetPreference(preference) {
  preference.preferenceStore.inited = false
  preference.preferenceStore.applySnapshot(preference.DEFAULT_PREFERENCE)
}

test('字号档：三档因子与类名映射', async () => {
  const { fontScale } = await loadModules()
  assert.equal(fontScale.scaleFor('standard'), 1)
  assert.equal(fontScale.scaleFor('large'), 1.15)
  assert.equal(fontScale.scaleFor('xlarge'), 1.3)
  assert.equal(fontScale.fontScaleClass('standard'), 'fs-standard')
  assert.equal(fontScale.fontScaleClass('large'), 'fs-large')
  assert.equal(fontScale.fontScaleClass('xlarge'), 'fs-xlarge')
})

test('字号档归一化：英文 / 中文 / 数值 / 非法值', async () => {
  const { preference } = await loadModules()
  assert.equal(preference.normalizeFontScale('large'), 'large')
  assert.equal(preference.normalizeFontScale(' 特大 '), 'xlarge')
  assert.equal(preference.normalizeFontScale('大'), 'large')
  assert.equal(preference.normalizeFontScale(1), 'standard')
  assert.equal(preference.normalizeFontScale(1.15), 'large')
  assert.equal(preference.normalizeFontScale('1.3'), 'xlarge')
  assert.equal(preference.normalizeFontScale('giant'), 'standard')
  assert.equal(preference.normalizeFontScale(undefined, 'large'), 'large')
  assert.equal(preference.parseFontScale('giant'), null)
})

test('字号档：写入 app:prefs.v1，重新 init 后恢复', async () => {
  const { preference, fontScale } = await loadModules()
  resetPreference(preference)
  const mock = installStorageMock()

  try {
    const result = fontScale.applyFontScale('large')
    assert.equal(result.scale, 'large')
    assert.equal(result.persisted, true)
    assert.equal(result.className, 'fs-large')
    const write = mock.writes.find((item) => item.key === 'app:prefs.v1')
    assert.ok(write, '切换字号必须写入 v1 偏好')
    assert.equal(write.value.fontScale, 'large')

    preference.preferenceStore.inited = false
    preference.preferenceStore.applySnapshot(preference.DEFAULT_PREFERENCE)
    preference.preferenceStore.init()
    assert.equal(preference.preferenceStore.fontScale, 'large')
    assert.equal(fontScale.currentFontScale(), 'large')
    assert.equal(fontScale.syncFontScaleClass(), 'fs-large')
  } finally {
    delete globalThis.wx
    resetPreference(preference)
  }
})

test('字号档：旧快照缺失字段回退标准，其他字段保留', async () => {
  const { preference } = await loadModules()
  resetPreference(preference)
  installStorageMock({
    'app:prefs.v1': {
      haptics: 'heavy',
      sound: false,
      motion: 'saver',
      autoCleanDays: 7,
    },
  })

  try {
    preference.preferenceStore.init()
    assert.equal(preference.preferenceStore.fontScale, 'standard')
    assert.equal(preference.preferenceStore.haptics, 'heavy')
    assert.equal(preference.preferenceStore.sound, false)
    assert.equal(preference.preferenceStore.motion, 'saver')
  } finally {
    delete globalThis.wx
    resetPreference(preference)
  }
})

test('字号档：非法值不改 Store，持久化失败仍会话生效', async () => {
  const { preference, fontScale } = await loadModules()
  resetPreference(preference)

  try {
    const invalid = fontScale.applyFontScale('giant')
    assert.equal(invalid.persisted, false)
    assert.equal(preference.preferenceStore.fontScale, 'standard')
    assert.equal(preference.preferenceStore.setFontScale('giant'), false)

    globalThis.wx = {
      setStorageSync() {
        throw new Error('storage unavailable')
      },
    }
    const fallback = fontScale.applyFontScale('xlarge')
    assert.equal(fallback.persisted, false)
    assert.equal(preference.preferenceStore.fontScale, 'xlarge')
    assert.equal(preference.preferenceStore.snapshot().fontScale, 'xlarge')
  } finally {
    delete globalThis.wx
    resetPreference(preference)
  }
})

test('对比度门禁：正文达标，按钮设计债仅 warning', () => {
  const { analyzeContrast } = require('../scripts/check-contrast.js')
  const result = analyzeContrast(read('app.wxss'))
  assert.equal(result.ok, true, result.failures.join('\n'))
  assert.ok(result.checks.length > 0)
  assert.ok(result.warnings.some((item) => item.includes('按钮')))
  assert.ok(
    result.checks.some(
      (item) =>
        item.theme === 'light' &&
        item.token === '--glass-text-3' &&
        item.background === 'canvas' &&
        item.ratio >= 4.5,
    ),
  )
})

test('页面契约：5 页接入 fsClass，设置页有字号入口', () => {
  const pages = [
    ['pages/index/index.wxml', 'pages/index/index.ts', 'pages/index/index.wxss'],
    ['pages/favorites/index.wxml', 'pages/favorites/index.ts', 'pages/favorites/index.wxss'],
    ['pages/mine/index.wxml', 'pages/mine/index.ts', 'pages/mine/index.wxss'],
    ['subpackages/grow/pages/help/index.wxml', 'subpackages/grow/pages/help/index.ts', 'subpackages/grow/pages/help/index.wxss'],
    [
      'subpackages/grow/pages/settings/index.wxml',
      'subpackages/grow/pages/settings/index.ts',
      'subpackages/grow/pages/settings/index.wxss',
    ],
  ]

  for (const [wxml, ts, wxss] of pages) {
    assert.match(read(wxml), /\{\{fsClass\}\}/, `${wxml} 缺少 fsClass`)
    assert.match(read(ts), /syncFontScaleClass/, `${ts} 缺少 syncFontScaleClass`)
    assert.match(read(wxss), /var\(--fs-scale/, `${wxss} 缺少字号 token`)
  }

  const settingsWxml = read('subpackages/grow/pages/settings/index.wxml')
  const settingsTs = read('subpackages/grow/pages/settings/index.ts')
  assert.match(settingsWxml, /字号大小/)
  assert.match(settingsWxml, /onFontScaleTap/)
  assert.match(settingsTs, /FONT_SCALE_OPTIONS/)
  assert.match(settingsTs, /applyFontScale\(/)
})

test('共享组件契约：外壳 / TabBar / 按钮 / 文字令牌', () => {
  const shellTs = read('components/glass-tool-shell/index.ts')
  const shellWxml = read('components/glass-tool-shell/index.wxml')
  assert.match(shellTs, /pageLifetimes/)
  assert.match(shellTs, /syncFontScaleClass/)
  assert.match(shellWxml, /aria-role="status"/)

  const tabBarTs = read('custom-tab-bar/index.ts')
  const tabBarWxss = read('custom-tab-bar/index.wxss')
  assert.match(tabBarTs, /fsClass/)
  assert.match(tabBarTs, /pageLifetimes/)
  assert.match(tabBarWxss, /\.fs-xlarge/)
  assert.match(tabBarWxss, /var\(--fs-scale/)

  const buttonWxss = read('components/glass-button/index.wxss')
  assert.match(buttonWxss, /min-height:\s*calc\(64rpx \* var\(--fs-scale/)
  assert.match(buttonWxss, /color:\s*currentColor/)

  for (const file of [
    'components/glass-tool-card/index.wxss',
    'components/g-navbar/index.wxss',
    'components/glass-bottom-sheet/index.wxss',
    'components/glass-modal/index.wxss',
    'components/glass-toast/index.wxss',
    'components/command-palette/index.wxss',
    'components/glass-slider/index.wxss',
  ]) {
    assert.match(read(file), /var\(--fs-scale/, `${file} 缺少字号 token`)
  }

  assert.match(read('components/glass-toast/index.wxss'), /--toast-accent:\s*var\(--glass-accent-text\)/)
  assert.match(read('components/glass-toast/index.wxss'), /--toast-accent:\s*var\(--glass-danger-text\)/)
  assert.match(read('pages/index/index.wxss'), /\.home-hero-action\s*\{[^}]*min-width:\s*184rpx/s)
})

test('动效契约：系统减少动态时降级', () => {
  assert.match(read('app.wxss'), /@media \(prefers-reduced-motion:\s*reduce\)/)
  assert.match(
    read('components/glass-tool-shell/index.wxss'),
    /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.tool-shell__workflow-halo[\s\S]*?animation:\s*none/,
  )
})

/** 已迁移字号的 WXSS：app + 共享组件 + TabBar + 5 个高频页 */
function migratedWxssFiles() {
  const files = [
    path.join(ROOT, 'app.wxss'),
    path.join(ROOT, 'custom-tab-bar/index.wxss'),
  ]
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.name.endsWith('.wxss')) {
        files.push(full)
      }
    }
  }
  for (const dir of ['components', 'pages', 'subpackages/grow/pages']) {
    walk(path.join(ROOT, dir))
  }
  return files
}

test('字号降级契约：每个 calc 字号前必须有字面量原值', () => {
  const failures = []

  for (const file of migratedWxssFiles()) {
    let literalSeen = false
    for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
      const line = raw.trim()
      if (line.includes('{')) {
        literalSeen = false
      }
      if (/^font-size:\s*[\d.]+rpx;/.test(line)) {
        literalSeen = true
      }
      if (/^font-size:\s*calc\(/.test(line)) {
        if (!literalSeen) {
          failures.push(`${path.relative(ROOT, file)}：${line}`)
        }
        literalSeen = false
      }
    }
  }

  assert.deepEqual(failures, [], `缺少字面量降级：\n${failures.join('\n')}`)
})

test('帮助页契约：单一卡片模板，搜索结果复用 groups', () => {
  const wxml = read('subpackages/grow/pages/help/index.wxml')
  assert.equal((wxml.match(/class="help-card"/g) || []).length, 1)
  assert.match(wxml, /wx:for="\{\{group\.entries\}\}"/)
  assert.match(wxml, /wx:if="\{\{searchEmpty\}\}"/)
  assert.equal(wxml.includes('wx:for="{{results}}"'), false)
})
