/* ==========================================================================
   device-tier · 设备档位与动效上限契约
   - 机型档位 / 性能分 / 内存三路判定与未知回退
   - auto 与显式档位的限档规则
   - 存储不可用时的降级行为
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = path.resolve(__dirname, '..')
const moduleUrl = (relative) => pathToFileURL(path.join(ROOT, relative)).href

async function loadTier() {
  return import(moduleUrl('core/utils/device-tier.ts'))
}

test('device-tier：机型档位映射', async () => {
  const { tierFromModelLevel } = await loadTier()
  assert.equal(tierFromModelLevel(1), 'high')
  assert.equal(tierFromModelLevel(2), 'mid')
  assert.equal(tierFromModelLevel(3), 'low')
  assert.equal(tierFromModelLevel(0), null)
  assert.equal(tierFromModelLevel(-1), null)
})

test('device-tier：性能分与内存兜底映射', async () => {
  const { tierFromBenchmark, tierFromMemory } = await loadTier()
  assert.equal(tierFromBenchmark(25), 'high')
  assert.equal(tierFromBenchmark(12), 'mid')
  assert.equal(tierFromBenchmark(3), 'low')
  assert.equal(tierFromBenchmark(-1), null)
  assert.equal(tierFromMemory(6144), 'high')
  assert.equal(tierFromMemory(3072), 'mid')
  assert.equal(tierFromMemory(2048), 'low')
  assert.equal(tierFromMemory(0), null)
})

test('device-tier：auto 取设备上限，显式档位不得越权', async () => {
  const { effectiveMotion, motionCeiling } = await loadTier()
  assert.equal(motionCeiling('high'), 'full')
  assert.equal(motionCeiling('mid'), 'lite')
  assert.equal(motionCeiling('low'), 'saver')

  assert.equal(effectiveMotion('auto', 'high'), 'full')
  assert.equal(effectiveMotion('auto', 'mid'), 'lite')
  assert.equal(effectiveMotion('auto', 'low'), 'saver')

  assert.equal(effectiveMotion('full', 'low'), 'saver')
  assert.equal(effectiveMotion('full', 'mid'), 'lite')
  assert.equal(effectiveMotion('lite', 'high'), 'lite')
  assert.equal(effectiveMotion('saver', 'high'), 'saver')
})

test('device-tier：限档判定只在被压制时为真', async () => {
  const { isMotionCapped } = await loadTier()
  assert.equal(isMotionCapped('auto', 'high'), false)
  assert.equal(isMotionCapped('auto', 'mid'), true)
  assert.equal(isMotionCapped('auto', 'low'), true)
  assert.equal(isMotionCapped('full', 'high'), false)
  assert.equal(isMotionCapped('full', 'low'), true)
  assert.equal(isMotionCapped('saver', 'low'), false)
})

test('device-tier：存储不可用时回退高档且提示未关闭', async () => {
  const { bootstrapDeviceTier, readCachedTier, readMotionHintDismissed } = await loadTier()
  assert.equal(bootstrapDeviceTier(), 'high')
  assert.equal(readCachedTier(), null)
  assert.equal(readMotionHintDismissed(), false)
})
