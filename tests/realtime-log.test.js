/* ==========================================================================
   realtime-log · 线上实时日志契约
   - 无 wx / 无 API 时静默失败
   - 同文案 30s 去重、分级写入、会话配额封顶
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { registerHooks } = require('node:module')

const ROOT = path.resolve(__dirname, '..')

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
const moduleUrl = (relative) => pathToFileURL(path.join(ROOT, relative)).href

async function load() {
  return import(moduleUrl('core/services/realtime-log.ts'))
}

test('realtime-log：无 wx 时静默返回 false', async () => {
  const mod = await load()
  mod.resetRealtimeLogForTest()
  assert.equal(mod.logRealtime('error', 'blackbox', 'boom'), false)
})

test('realtime-log：同文案去重与分级写入', async () => {
  const calls = []
  globalThis.wx = {
    getRealtimeLogManager: () => ({
      info: (...args) => calls.push(['info', ...args]),
      warn: (...args) => calls.push(['warn', ...args]),
      error: (...args) => calls.push(['error', ...args]),
    }),
  }
  const mod = await load()
  mod.resetRealtimeLogForTest()
  try {
    assert.equal(mod.logRealtime('error', 'blackbox', 'boom', { route: 'pages/index/index' }), true)
    assert.equal(mod.logRealtime('error', 'blackbox', 'boom'), false)
    assert.equal(mod.logRealtime('warn', 'blackbox', 'boom'), true)
    assert.equal(calls.length, 2)
    assert.equal(calls[0][0], 'error')
    assert.equal(calls[1][0], 'warn')
  } finally {
    delete globalThis.wx
    mod.resetRealtimeLogForTest()
  }
})

test('realtime-log：会话配额封顶 100 条', async () => {
  let count = 0
  globalThis.wx = {
    getRealtimeLogManager: () => ({
      info: () => {
        count += 1
      },
      warn: () => {
        count += 1
      },
      error: () => {
        count += 1
      },
    }),
  }
  const mod = await load()
  mod.resetRealtimeLogForTest()
  try {
    for (let i = 0; i < 120; i += 1) {
      mod.logRealtime('error', 'blackbox', `unique-${i}`)
    }
    assert.equal(count, 100)
  } finally {
    delete globalThis.wx
    mod.resetRealtimeLogForTest()
  }
})

test('realtime-log：黑匣子错误自动转发并带路由', async () => {
  const calls = []
  const store = new Map()
  globalThis.getCurrentPages = () => [{ route: 'pages/index/index' }]
  globalThis.wx = {
    getStorageSync: (key) => (store.has(key) ? store.get(key) : ''),
    setStorageSync: (key, value) => store.set(key, value),
    getRealtimeLogManager: () => ({
      info: () => {},
      warn: (...args) => calls.push(['warn', ...args]),
      error: (...args) => calls.push(['error', ...args]),
    }),
  }
  const mod = await load()
  mod.resetRealtimeLogForTest()
  try {
    const blackbox = await import(moduleUrl('core/utils/blackbox.ts'))
    blackbox.recordDiagnostic('app-error', new Error('boom'))
    assert.equal(calls.length, 1)
    assert.equal(calls[0][0], 'error')
    assert.ok(String(calls[0][1]).includes('app-error'))
    assert.ok(String(calls[0][1]).includes('boom'))
  } finally {
    delete globalThis.wx
    delete globalThis.getCurrentPages
    mod.resetRealtimeLogForTest()
  }
})
