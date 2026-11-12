/* ==========================================================================
   元宝搜索 · 自定义时效归一化
   - 最近 N：天 1–30 / 月 1–12 / 年 1–5
   - 日期区间：完整、不倒序、不晚于今天
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = path.resolve(__dirname, '..')

async function load() {
  return import(
    pathToFileURL(path.join(ROOT, 'subpackages/tools-core/lib/freshness.ts')).href
  )
}

test('自定义时效：最近 N 归一化为官方额度', async () => {
  const { normalizeCustomFreshness } = await load()

  assert.deepEqual(
    normalizeCustomFreshness({ mode: 'recent', n: '7', unit: 'd', start: '', end: '' }),
    { freshness: 'd7', error: '' },
  )
  assert.deepEqual(
    normalizeCustomFreshness({ mode: 'recent', n: '3', unit: 'm', start: '', end: '' }),
    { freshness: 'm3', error: '' },
  )
  assert.deepEqual(
    normalizeCustomFreshness({ mode: 'recent', n: '2', unit: 'y', start: '', end: '' }),
    { freshness: 'y2', error: '' },
  )
})

test('自定义时效：最近 N 越界与非法输入', async () => {
  const { normalizeCustomFreshness } = await load()
  const cases = [
    { n: '0', unit: 'd', message: /1–30/ },
    { n: '31', unit: 'd', message: /1–30/ },
    { n: '13', unit: 'm', message: /1–12/ },
    { n: '6', unit: 'y', message: /1–5/ },
    { n: '2.5', unit: 'd', message: /整数/ },
    { n: '', unit: 'd', message: /整数/ },
  ]
  cases.forEach((item) => {
    const result = normalizeCustomFreshness({
      mode: 'recent',
      n: item.n,
      unit: item.unit,
      start: '',
      end: '',
    })
    assert.equal(result.freshness, '')
    assert.match(result.error, item.message)
  })
})

test('自定义时效：日期区间校验与输出', async () => {
  const { normalizeCustomFreshness, todayISO } = await load()

  assert.deepEqual(
    normalizeCustomFreshness({
      mode: 'day',
      n: '',
      unit: 'd',
      start: '2026-01-15',
      end: '',
    }),
    { freshness: '2026-01-15', error: '' },
  )
  assert.match(
    normalizeCustomFreshness({ mode: 'day', n: '', unit: 'd', start: '', end: '' }).error,
    /请选择日期/,
  )
  assert.match(
    normalizeCustomFreshness({
      mode: 'day',
      n: '',
      unit: 'd',
      start: '2999-01-01',
      end: '',
    }).error,
    /不能晚于今天/,
  )

  const ok = normalizeCustomFreshness({
    mode: 'range',
    n: '',
    unit: 'd',
    start: '2026-01-01',
    end: '2026-01-31',
  })
  assert.deepEqual(ok, { freshness: '2026-01-01,2026-01-31', error: '' })

  assert.match(
    normalizeCustomFreshness({ mode: 'range', n: '', unit: 'd', start: '', end: '2026-01-31' }).error,
    /完整/,
  )
  assert.match(
    normalizeCustomFreshness({
      mode: 'range',
      n: '',
      unit: 'd',
      start: '2026-02-01',
      end: '2026-01-31',
    }).error,
    /不能晚于结束日期/,
  )
  assert.match(
    normalizeCustomFreshness({
      mode: 'range',
      n: '',
      unit: 'd',
      start: '2026-01-01',
      end: '2999-01-01',
    }).error,
    /不能晚于今天/,
  )
  assert.match(todayISO(), /^\d{4}-\d{2}-\d{2}$/)
})
