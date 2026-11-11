/* ==========================================================================
   全链路版本更新守门 · 回归测试
   - 静态断言：App 只暂存不弹窗 / 40 个页面全部有 update-guard
   - 静态断言：看门狗、原生降级、全局互斥、AES 等高危阻塞
   - 静态断言：第三操作“查看更新日志”直达设置页版本区块
   - 行为断言：待更新标记与全局阻塞计数可写可读可清
   - 运行：npm test
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { registerHooks } = require('node:module')

const ROOT = path.resolve(__dirname, '..')

/* 与其它 TS 单测一致：补全无扩展名相对导入 */
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
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const app = JSON.parse(read('app.json'))

test('app.ts 只暂存 updateManager，失败时给出全局提示', () => {
  const source = read('app.ts')
  assert.match(source, /updateManager/)
  assert.match(source, /hasUpdate = true/)
  assert.match(source, /promptState/)
  assert.match(source, /blockers/)
  assert.match(source, /onUpdateFailed/)
  assert.match(source, /wx\.showToast/)
  assert.match(source, /网络波动/)
  assert.equal(source.includes('wx.showModal'), false)
})

test('update-guard 是全局组件，41 个页面全部覆盖', () => {
  assert.match(
    read('app.json'),
    /"update-guard"\s*:\s*"\/components\/update-guard\/index"/,
  )
  const shell = read('components/glass-tool-shell/index.wxml')
  assert.match(shell, /<update-guard/)
  assert.match(shell, /state === 'running'/)
  assert.match(shell, /workflowPanelVisible/)

  const pages = [
    ...app.pages,
    ...app.subpackages.flatMap((subpackage) =>
      subpackage.pages.map((page) => `${subpackage.root}/${page}`),
    ),
  ]
  assert.ok(pages.length >= 41)
  for (const page of pages) {
    const wxml = read(`${page}.wxml`)
    const covered =
      /<update-guard/.test(wxml) ||
      (/<glass-tool-shell/.test(wxml) && /<update-guard/.test(shell))
    assert.ok(covered, `${page} 未挂载 update-guard`)
  }
})

test('guard 保留渲染看门狗、原生降级与跨页面互斥', () => {
  const guard = read('components/update-guard/index.ts')
  const wxml = read('components/update-guard/index.wxml')
  const modalTs = read('components/glass-modal/index.ts')

  assert.match(guard, /RENDER_WATCHDOG_MS = 1500/)
  assert.match(guard, /MODAL_EXIT_MS = 260/)
  assert.match(guard, /fallbackToNative/)
  assert.match(guard, /wx\.showModal/)
  assert.match(guard, /applyUpdate\(\)/)
  assert.match(guard, /promptState/)
  assert.match(guard, /promptOwner/)
  assert.match(guard, /notifyUpdateGuards/)
  assert.match(guard, /holdUpdatePrompt/)
  assert.match(guard, /releaseUpdatePrompt/)
  assert.match(wxml, /bind:opened="onOpened"/)
  assert.match(wxml, /extra-text/)
  assert.match(wxml, /mask-closable="\{\{false\}\}"/)
  assert.match(modalTs, /triggerEvent\('opened'\)/)
})

test('高危操作只排队不打断：AES / 快照 / 页面弹窗均传入 blocked', () => {
  const settings = read('subpackages/grow/pages/settings/index.wxml')
  const cockpit = read('subpackages/grow/pages/cockpit/index.wxml')
  const hash = read('subpackages/tools-core/pages/hash/index.wxml')
  const textDiff = read('subpackages/tools-core/pages/text-diff/index.wxml')
  const profile = read('subpackages/grow/pages/profile/index.wxml')
  const watermark = read('subpackages/tools-media/pages/watermark/index.wxml')
  const index = read('pages/index/index.wxml')

  assert.match(settings, /vaultBusy/)
  assert.match(settings, /travelBusy/)
  assert.match(settings, /transportBusy/)
  assert.match(settings, /pilotRunning/)
  assert.match(cockpit, /confirmShow/)
  assert.match(hash, /update-blocked="\{\{tooLongShow\}\}"/)
  assert.match(textDiff, /update-blocked="\{\{tooLongShow\}\}"/)
  assert.match(profile, /cardShow/)
  assert.match(watermark, /blocked="\{\{saving\}\}"/)
  assert.match(index, /updateNavHold/)
})

test('“查看更新日志”直达设置页版本区块并展开', () => {
  const guard = read('components/update-guard/index.ts')
  const settingsTs = read('subpackages/grow/pages/settings/index.ts')
  const settingsWxml = read('subpackages/grow/pages/settings/index.wxml')

  assert.match(guard, /ROUTES\.settings.*changelog=1/)
  assert.match(settingsTs, /query\.changelog === '1'/)
  assert.match(settingsTs, /changelogOpen: true/)
  assert.match(settingsTs, /scrollTarget: 'settings-changelog'/)
  assert.match(settingsWxml, /scroll-into-view="\{\{scrollTarget\}\}"/)
  assert.match(settingsWxml, /id="settings-changelog"/)
})

test('“稍后”写入待更新标记，设置页据此显示红点', () => {
  const guard = read('components/update-guard/index.ts')
  const service = read('core/services/update.ts')
  const settingsTs = read('subpackages/grow/pages/settings/index.ts')
  const settingsWxml = read('subpackages/grow/pages/settings/index.wxml')

  assert.match(guard, /markUpdatePending\(\)/)
  assert.match(service, /UPDATE_PENDING_KEY = 'hasPendingUpdate'/)
  assert.match(service, /setStorageSync\(UPDATE_PENDING_KEY, true\)/)
  assert.match(settingsTs, /readUpdatePending\(\)/)
  assert.match(settingsWxml, /settings-update-dot/)
})

test('全局阻塞计数可增可减，不会变负', async () => {
  const mod = await import(pathToFileURL(path.join(ROOT, 'core/services/update.ts')).href)
  const hub = {
    updateManager: null,
    hasUpdate: true,
    updateReadyListeners: [],
    promptState: 'idle',
    promptOwner: '',
    blockers: 0,
  }
  mod.holdUpdatePrompt(hub)
  mod.holdUpdatePrompt(hub)
  assert.equal(hub.blockers, 2)
  mod.releaseUpdatePrompt(hub)
  assert.equal(hub.blockers, 1)
  mod.releaseUpdatePrompt(hub)
  assert.equal(hub.blockers, 0)
  mod.releaseUpdatePrompt(hub)
  assert.equal(hub.blockers, 0)
})

test('单个 guard 回调异常不影响其它页面', async () => {
  const mod = await import(pathToFileURL(path.join(ROOT, 'core/services/update.ts')).href)
  const hub = {
    updateManager: null,
    hasUpdate: true,
    updateReadyListeners: [],
    promptState: 'idle',
    promptOwner: '',
    blockers: 0,
  }
  let healthy = 0
  hub.updateReadyListeners.push(() => {
    throw new Error('broken guard')
  })
  hub.updateReadyListeners.push(() => {
    healthy += 1
  })
  assert.doesNotThrow(() => mod.notifyUpdateGuards(hub))
  assert.equal(healthy, 1)
})

test('待更新标记可写、可读、可清', async () => {
  const values = new Map()
  globalThis.wx = {
    setStorageSync(key, value) {
      values.set(key, value)
    },
    getStorageSync(key) {
      return values.has(key) ? values.get(key) : ''
    },
    removeStorageSync(key) {
      values.delete(key)
    },
  }
  const mod = await import(pathToFileURL(path.join(ROOT, 'core/services/update.ts')).href)

  assert.equal(mod.readUpdatePending(), false)
  assert.equal(mod.markUpdatePending(), true)
  assert.equal(values.get('hasPendingUpdate'), true)
  assert.equal(mod.readUpdatePending(), true)
  mod.clearUpdatePending()
  assert.equal(mod.readUpdatePending(), false)
})

test('Storage 异常时标记函数不抛出', async () => {
  globalThis.wx = {
    setStorageSync() {
      throw new Error('storage full')
    },
    getStorageSync() {
      throw new Error('storage unavailable')
    },
    removeStorageSync() {
      throw new Error('storage unavailable')
    },
  }
  const mod = await import(pathToFileURL(path.join(ROOT, 'core/services/update.ts')).href)

  assert.equal(mod.markUpdatePending(), false)
  assert.equal(mod.readUpdatePending(), false)
  assert.doesNotThrow(() => mod.clearUpdatePending())
})

test('getApp 尚未就绪时读取 globalData 返回 null', async () => {
  globalThis.getApp = () => {
    throw new Error('app not ready')
  }
  const mod = await import(pathToFileURL(path.join(ROOT, 'core/services/update.ts')).href)
  assert.equal(mod.readUpdateGlobalData(), null)
})
