/* ==========================================================================
   批量图片压缩 · 纯函数与串行调度契约
   - ≤9 张、≤12MP、总源 ≤80MB、输出长边 ≤2048
   - 串行顺序、取消边界
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = path.resolve(__dirname, '..')

async function load() {
  return import(
    pathToFileURL(path.join(ROOT, 'subpackages/tools-media/lib/compress-batch.ts')).href
  )
}

test('批量压缩：输出长边不超过 2048，原尺寸也压到 2048', async () => {
  const { batchOutputEdge, targetBatchSize } = await load()

  assert.equal(batchOutputEdge(0), 2048)
  assert.equal(batchOutputEdge(4096), 2048)
  assert.equal(batchOutputEdge(750), 750)
  assert.deepEqual(targetBatchSize(4096, 2048, 0), {
    width: 2048,
    height: 1024,
    scaled: true,
  })
  assert.deepEqual(targetBatchSize(3000, 2000, 750), {
    width: 750,
    height: 500,
    scaled: true,
  })
  assert.deepEqual(targetBatchSize(800, 600, 1920), {
    width: 800,
    height: 600,
    scaled: false,
  })
})

test('批量压缩：单张 12MP 边界', async () => {
  const { isBatchSourceTooLarge } = await load()
  assert.equal(isBatchSourceTooLarge(4000, 3000), false)
  assert.equal(isBatchSourceTooLarge(4001, 3000), true)
  assert.equal(isBatchSourceTooLarge(0, 0), false)
})

test('批量压缩：按 9 张与总源 80MB 截断', async () => {
  const { MAX_BATCH_IMAGES, MAX_BATCH_SOURCE_BYTES, truncateBatchByBytes } = await load()

  const nine = Array.from({ length: 12 }, (_, index) => ({ id: index, size: 1024 }))
  const limited = truncateBatchByBytes(nine)
  assert.equal(limited.items.length, MAX_BATCH_IMAGES)
  assert.equal(limited.dropped, 3)

  const large = [
    { id: 'a', size: 50 * 1024 * 1024 },
    { id: 'b', size: 31 * 1024 * 1024 },
    { id: 'c', size: 1024 },
  ]
  const bytesLimited = truncateBatchByBytes(large)
  assert.deepEqual(
    bytesLimited.items.map((item) => item.id),
    ['a', 'c'],
  )
  assert.equal(bytesLimited.dropped, 1)
  assert.ok(bytesLimited.bytes <= MAX_BATCH_SOURCE_BYTES)
})

test('批量压缩：串行执行并在任务边界取消', async () => {
  const { runSerialBatch } = await load()
  const order = []
  let cancelled = false
  const result = await runSerialBatch(
    ['a', 'b', 'c'],
    async (item) => {
      order.push(item)
      if (item === 'b') {
        cancelled = true
      }
    },
    () => cancelled,
  )
  assert.deepEqual(order, ['a', 'b'])
  assert.equal(result.cancelled, true)
  assert.equal(result.processed, 2)

  const complete = await runSerialBatch([1, 2, 3], async () => undefined)
  assert.deepEqual(complete, { cancelled: false, processed: 3 })
})

test('压缩页：批量网格、取消、保存全部入口齐全', () => {
  const wxml = fs.readFileSync(
    path.join(ROOT, 'subpackages/tools-media/pages/compress/index.wxml'),
    'utf8',
  )
  const ts = fs.readFileSync(
    path.join(ROOT, 'subpackages/tools-media/pages/compress/index.ts'),
    'utf8',
  )
  assert.match(wxml, /batch-grid/)
  assert.match(wxml, /bind:tap="onCancel"/)
  assert.match(wxml, /bind:tap="onSaveAll"/)
  assert.match(wxml, /bind:tap="onSaveItem"/)
  assert.match(ts, /runSerialBatch/)
  assert.match(ts, /MAX_BATCH_IMAGES/)
  assert.match(ts, /cleanupPaths/)
})
