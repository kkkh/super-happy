/* ==========================================================================
   perf · 性能采样纯函数契约
   - 抽样边界 / 环形缓冲 / 首条指标保留 / storage 不可用降级
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = path.resolve(__dirname, '..')
const moduleUrl = (relative) => pathToFileURL(path.join(ROOT, relative)).href

async function loadPerf() {
  return import(moduleUrl('core/utils/perf.ts'))
}

test('perf：抽样命中边界正确', async () => {
  const { shouldSample, PERF_SAMPLE_RATE } = await loadPerf()
  assert.equal(shouldSample(0), true)
  assert.equal(shouldSample(PERF_SAMPLE_RATE), false)
  assert.equal(shouldSample(0.999), false)
})

test('perf：环形缓冲只保留最近 N 条', async () => {
  const { pushPerfSample, PERF_MAX_SAMPLES } = await loadPerf()
  let list = []
  for (let i = 0; i < PERF_MAX_SAMPLES + 5; i += 1) {
    list = pushPerfSample(list, { at: i })
  }
  assert.equal(list.length, PERF_MAX_SAMPLES)
  assert.equal(list[list.length - 1].at, PERF_MAX_SAMPLES + 4)
})

test('perf：只保留入口页首条指标，后续页面不覆盖', async () => {
  const { mergePerfEntries } = await loadPerf()
  let sample = mergePerfEntries({ at: 1 }, [
    { name: 'appLaunch', duration: 1200 },
    { name: 'firstRender', duration: 300, path: 'pages/index/index' },
  ])
  sample = mergePerfEntries(sample, [
    { name: 'appLaunch', duration: 9999 },
    { name: 'firstRender', duration: 8888, path: 'pages/mine/index' },
  ])
  assert.equal(sample.appLaunch, 1200)
  assert.equal(sample.firstRender, 300)
  assert.equal(sample.route, 'pages/index/index')
})

test('perf：storage 不可用时读取返回空数组', async () => {
  const { readPerfSamples } = await loadPerf()
  assert.deepEqual(readPerfSamples(), [])
})

test('perf：摘要文案优先展示启动与首屏', async () => {
  const { summarizePerfSamples } = await loadPerf()
  assert.equal(summarizePerfSamples([]), '暂无采样')
  const text = summarizePerfSamples([
    { at: 1, appLaunch: 1200.4, firstRender: 380.6, downloadPackage: 900 },
  ])
  assert.equal(text, '启动 1200ms · 首屏 381ms · 下载 900ms · 共 1 次')
})

test('perf：分行摘要不把「共 N 次」单独留在一行', async () => {
  const { summarizePerfLines } = await loadPerf()
  assert.deepEqual(summarizePerfLines([]), ['暂无采样'])
  assert.deepEqual(
    summarizePerfLines([{ at: 1, appLaunch: 1200, firstRender: 380, downloadPackage: 900 }]),
    ['启动 1200ms · 首屏 380ms', '下载 900ms · 共 1 次'],
  )
  assert.deepEqual(
    summarizePerfLines([{ at: 1, appLaunch: 1500, firstRender: 420 }]),
    ['启动 1500ms · 首屏 420ms · 共 1 次'],
  )
})

test('perf：从本机存储读取采样并生成摘要', async () => {
  const store = new Map([
    ['perf:samples.v1', [{ at: 1, appLaunch: 1500, firstRender: 420 }]],
  ])
  globalThis.wx = {
    getStorageSync: (key) => (store.has(key) ? store.get(key) : ''),
  }
  try {
    const { readPerfSamples, summarizePerfSamples } = await loadPerf()
    const list = readPerfSamples()
    assert.equal(list.length, 1)
    assert.equal(summarizePerfSamples(list), '启动 1500ms · 首屏 420ms · 共 1 次')
  } finally {
    delete globalThis.wx
  }
})
