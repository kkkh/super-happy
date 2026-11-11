/* ==========================================================================
   批 1 · 正则测试（regex）
   - Worker 真实实现：分组、flags、空匹配、非法模式、500 截断
   - 沙箱：300ms 超时终止，Worker 不可用直接拒绝
   - 契约：页面 / 注册 / 帮助 / jump 工作流与来源字段
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { registerHooks } = require('node:module')

const ROOT = path.resolve(__dirname, '..')
const URL_ROOT = `${require('node:url').pathToFileURL(ROOT).href}/`
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')
const WORKER_SOURCE = read('workers/compute.js')

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !path.extname(specifier)) {
      return nextResolve(`${specifier}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})

/** 在 vm 中加载真实 Worker 入口，注入任务并取回第一条消息 */
function runWorkerTask(task, payload) {
  let handler = null
  const outbox = []
  const context = {
    worker: {
      onMessage(fn) {
        handler = fn
      },
      postMessage(message) {
        outbox.push(message)
      },
    },
  }
  vm.createContext(context)
  vm.runInContext(WORKER_SOURCE, context)
  assert.equal(typeof handler, 'function', 'Worker 未注册 onMessage')
  handler({ message: { kind: 'task', id: 't1', task, payload } })
  assert.equal(outbox.length, 1, 'Worker 未返回结果')
  return outbox[0]
}

test('正则：分组、起止位置与匹配值', () => {
  const done = runWorkerTask('regex', {
    pattern: '(\\d{4})-(\\d{2})',
    flags: '',
    text: '2020-12',
  })
  assert.equal(done.ok, true)
  assert.equal(done.data.matches.length, 1)
  assert.equal(
    JSON.stringify({
      index: done.data.matches[0].index,
      end: done.data.matches[0].end,
      value: done.data.matches[0].value,
      groups: done.data.matches[0].groups,
    }),
    JSON.stringify({ index: 0, end: 7, value: '2020-12', groups: ['2020', '12'] }),
  )
})

test('正则：flags 生效，非法 flag 被过滤', () => {
  const insensitive = runWorkerTask('regex', {
    pattern: 'a',
    flags: 'gi',
    text: 'A a',
  })
  assert.equal(insensitive.ok, true)
  assert.equal(insensitive.data.matches.length, 2)

  const single = runWorkerTask('regex', { pattern: 'a', flags: 'i', text: 'A a' })
  assert.equal(single.ok, true)
  assert.equal(single.data.matches.length, 1)

  const filtered = runWorkerTask('regex', { pattern: 'a', flags: 'gx', text: 'aa' })
  assert.equal(filtered.ok, true)
  assert.equal(filtered.data.matches.length, 2)
})

test('正则：空匹配手动推进 lastIndex，不进入死循环', () => {
  const done = runWorkerTask('regex', { pattern: 'a*', flags: 'g', text: 'bb' })
  assert.equal(done.ok, true)
  assert.equal(done.data.matches.length, 3)
  assert.equal(
    JSON.stringify(
      done.data.matches.map((match) => [match.index, match.end, match.value]),
    ),
    JSON.stringify([
      [0, 0, ''],
      [1, 1, ''],
      [2, 2, ''],
    ]),
  )
})

test('正则：非法模式由 Worker 返回错误，不崩溃', () => {
  const done = runWorkerTask('regex', { pattern: '(', flags: 'g', text: 'a' })
  assert.equal(done.ok, false)
  assert.equal(done.error.code, 'WORKER_ERROR')
  assert.match(done.error.message, /Invalid|Unterminated|regular/i)
})

test('正则：300ms 上限内超时终止', async () => {
  global.wx = {
    createWorker: () => {
      let handler = null
      return {
        onMessage(fn) {
          handler = fn
        },
        postMessage(message) {
          if (message.kind === 'ping') {
            setTimeout(() => handler({ message: { kind: 'pong', id: message.id } }), 0)
          }
        },
        terminate() {},
      }
    },
  }
  const { WorkerSandbox } = await import(`${URL_ROOT}core/services/worker.ts`)
  const sandbox = new WorkerSandbox({ fallbackToMainThread: true })
  await assert.rejects(
    sandbox.runTask(
      'regex',
      { pattern: 'a', flags: 'g', text: 'a' },
      { timeout: 30 },
    ),
    (error) => error.code === 'TIMEOUT',
  )
  sandbox.dispose()
  delete global.wx
})

test('正则：500 条截断与页面契约', async () => {
  const truncated = runWorkerTask('regex', {
    pattern: 'a',
    flags: 'g',
    text: 'a'.repeat(501),
  })
  assert.equal(truncated.ok, true)
  assert.equal(truncated.data.matches.length, 500)
  assert.equal(truncated.data.truncated, true)

  const exact = runWorkerTask('regex', {
    pattern: 'a',
    flags: 'g',
    text: 'a'.repeat(500),
  })
  assert.equal(exact.ok, true)
  assert.equal(exact.data.matches.length, 500)
  assert.equal(exact.data.truncated, false)

  const app = JSON.parse(read('app.json'))
  const core = app.subpackages.find((item) => item.root === 'subpackages/tools-core')
  assert.ok(core.pages.includes('pages/regex/index'), 'app.json 未注册页面')

  for (const ext of ['.ts', '.json', '.wxml', '.wxss']) {
    assert.ok(
      fs.existsSync(path.join(ROOT, `subpackages/tools-core/pages/regex/index${ext}`)),
      `缺少页面文件 ${ext}`,
    )
  }

  const wxml = read('subpackages/tools-core/pages/regex/index.wxml')
  assert.match(wxml, /tool-id="regex"/)
  assert.match(wxml, /can-run="\{\{canRun\}\}"/)
  assert.match(wxml, /bindtap="onCopy"/)
  assert.match(wxml, /poster-data="\{\{posterData\}\}"/)

  const ts = read('subpackages/tools-core/pages/regex/index.ts')
  assert.match(ts, /onShareAppMessage\s*\(/)
  assert.match(ts, /onShareTimeline\s*\(/)
  assert.match(ts, /onReceiveWorkflow\s*\(/)
  assert.match(ts, /core\/services\/worker/)
  assert.match(ts, /runTaskHandle\('regex'/)
  assert.equal(/new RegExp\(/.test(ts), false, '页面不得自行构造正则')
  assert.equal(/wx\.request|uploadFile|downloadFile/.test(ts), false)

  const registry = read('core/toolbox/registry.ts')
  assert.match(registry, /id: 'regex'/)
  assert.match(registry, /weight: 72/)
  assert.match(read('subpackages/grow/lib/help.ts'), /regex: \{/)

  const config = await import(`${URL_ROOT}core/workflow/workflowConfig.ts`)
  assert.equal(config.WORKFLOW_ROUTING.regex, 'jump')
  assert.deepEqual(config.WORKFLOW_ACCEPTS.regex, ['text'])

  const source = await import(`${URL_ROOT}core/workflow/workflowSource.ts`)
  assert.deepEqual(source.WORKFLOW_SOURCE_KEYS.regex.text, ['regexSummary'])
})
