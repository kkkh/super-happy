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
