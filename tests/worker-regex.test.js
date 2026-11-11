/* ==========================================================================
   Worker 沙箱 · 降级边界
   - regex 必须由 Worker 执行：不可用时直接拒绝，禁止主线程降级
   - 其他任务在 Worker 不可用时仍可主线程兜底
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { registerHooks } = require('node:module')

const ROOT = path.resolve(__dirname, '..')
const URL_ROOT = `${require('node:url').pathToFileURL(ROOT).href}/`

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !path.extname(specifier)) {
      return nextResolve(`${specifier}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})

async function loadWorker() {
  global.wx = {}
  return import(`${URL_ROOT}core/services/worker.ts`)
}

test('Worker 不可用：regex 直接拒绝，不落到主线程', async () => {
  const { WorkerSandbox } = await loadWorker()
  const sandbox = new WorkerSandbox({ fallbackToMainThread: true })
  await assert.rejects(
    sandbox.runTask('regex', { pattern: 'a', flags: 'g', text: 'a' }),
    (error) => error.code === 'UNAVAILABLE',
  )
  sandbox.dispose()
})

test('Worker 不可用：text-stats 仍可主线程降级', async () => {
  const { WorkerSandbox } = await loadWorker()
  const sandbox = new WorkerSandbox({ fallbackToMainThread: true })
  const result = await sandbox.runTask('text-stats', { text: 'a' })
  assert.equal(result.codePoints, 1)
  sandbox.dispose()
})

test('Worker 冷启动握手：300ms 只计执行时间', async () => {
  global.wx = {
    createWorker: () => {
      let handler = null
      return {
        onMessage(fn) {
          handler = fn
        },
        postMessage(message) {
          if (message.kind === 'ping') {
            /* 真机形态：直接回传消息体，不包 { message } */
            setTimeout(() => handler({ kind: 'pong', id: message.id }), 60)
            return
          }
          if (message.kind === 'task') {
            setTimeout(
              () => handler({ kind: 'done', id: message.id, ok: true, data: { matches: [], truncated: false } }),
              0,
            )
          }
        },
        terminate() {},
      }
    },
  }
  const { WorkerSandbox } = await import(`${URL_ROOT}core/services/worker.ts`)
  const sandbox = new WorkerSandbox({ fallbackToMainThread: true })
  const result = await sandbox.runTask(
    'regex',
    { pattern: 'a', flags: 'g', text: 'a' },
    { timeout: 30 },
  )
  assert.deepEqual(result, { matches: [], truncated: false })
  sandbox.dispose()
  delete global.wx
})

test('Worker 握手超时：regex 拒绝且不无限等待', async () => {
  global.wx = {
    createWorker: () => ({
      onMessage() {},
      postMessage() {},
      terminate() {},
    }),
  }
  const { WorkerSandbox } = await import(`${URL_ROOT}core/services/worker.ts`)
  const sandbox = new WorkerSandbox({ fallbackToMainThread: true, startupTimeout: 30 })
  await assert.rejects(
    sandbox.runTask('regex', { pattern: 'a', flags: 'g', text: 'a' }),
    (error) => error.code === 'UNAVAILABLE',
  )
  sandbox.dispose()
  delete global.wx
})
