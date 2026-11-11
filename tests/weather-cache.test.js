/* ==========================================================================
   全息气象 · 分层缓存 / 城市表单元测试
   - 实况 15min、预报 30min、失败负缓存 60s
   - 城市最多 5 个；非法 adcode / 重复 / 脏 source 一律清洗
   - 运行：npm test
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { registerHooks } = require('node:module')

const ROOT = path.resolve(__dirname, '..')
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !specifier.endsWith('.ts')) {
      try {
        return nextResolve(`${specifier}.ts`, context)
      } catch {
        /* 非 TS 模块回退 */
      }
    }
    return nextResolve(specifier, context)
  },
})

async function load(relative) {
  return import(pathToFileURL(path.join(ROOT, relative)).href)
}

function createStorage() {
  const map = new Map()
  return {
    map,
    get(key) {
      return map.get(key)
    },
    set(key, value) {
      map.set(key, value)
    },
    remove(key) {
      map.delete(key)
    },
  }
}

const LIVE = {
  province: '北京',
  city: '东城区',
  adcode: '110101',
  weather: '晴',
  temperature: 7,
  winddirection: '西南',
  windpower: '≤3',
  humidity: 40,
  reporttime: '2026-11-09 10:34:04',
}

const FORECAST = {
  province: '北京',
  city: '北京市',
  adcode: '110000',
  reporttime: '2026-11-09 10:34:04',
  days: [
    {
      date: '2026-11-09',
      week: '1',
      weekLabel: '周一',
      dayweather: '晴',
      nightweather: '晴',
      daytemp: 12,
      nighttemp: -2,
      daywind: '西南',
      nightwind: '西南',
      daypower: '1-3',
      nightpower: '1-3',
    },
  ],
}

test('实况缓存：15 分钟内新鲜，超过 15 分钟 stale 但仍可展示', async () => {
  const cache = await load('subpackages/tools-core/weather/weatherCache.ts')
  const storage = createStorage()
  const now = 1_000_000
  cache.writeLiveCache(storage, LIVE, now)

  const fresh = cache.readLiveCache(storage, '110101', now + 60_000)
  assert.ok(fresh)
  assert.equal(fresh.data.temperature, 7)
  assert.equal(fresh.stale, false)
  assert.equal(fresh.ageMs, 60_000)

  const stale = cache.readLiveCache(storage, '110101', now + 16 * 60_000)
  assert.ok(stale)
  assert.equal(stale.stale, true)
})

test('实况缓存：非法 adcode / 损坏条目返回 null', async () => {
  const cache = await load('subpackages/tools-core/weather/weatherCache.ts')
  const storage = createStorage()
  assert.equal(cache.readLiveCache(storage, 'abc', 0), null)
  cache.writeLiveCache(storage, { ...LIVE, adcode: 'bad' }, 0)
  assert.equal(cache.readLiveCache(storage, 'bad', 0), null)
  cache.writeLiveCache(storage, { ...LIVE, adcode: '110000' }, 0, '110101')
  assert.ok(cache.readLiveCache(storage, '110101', 0))
  storage.set(cache.WEATHER_CACHE_KEYS.live('110101'), {
    version: 1,
    fetchedAt: 'bad',
    reporttime: '',
    data: LIVE,
  })
  assert.equal(cache.readLiveCache(storage, '110101', 0), null)
})

test('预报缓存：30 分钟 TTL，按请求 adcode 写入', async () => {
  const cache = await load('subpackages/tools-core/weather/weatherCache.ts')
  const storage = createStorage()
  const now = 2_000_000
  cache.writeForecastCache(storage, FORECAST, '110101', now)
  const fresh = cache.readForecastCache(storage, '110101', now + 29 * 60_000)
  assert.ok(fresh)
  assert.equal(fresh.stale, false)
  assert.equal(fresh.data.days.length, 1)
  const stale = cache.readForecastCache(storage, '110101', now + 31 * 60_000)
  assert.ok(stale)
  assert.equal(stale.stale, true)
})

test('负缓存：60 秒内命中，超过 60 秒失效', async () => {
  const cache = await load('subpackages/tools-core/weather/weatherCache.ts')
  const storage = createStorage()
  const now = 3_000_000
  cache.writeNegativeCache(storage, '110101', 'api', now)
  assert.equal(cache.hasRecentFailure(storage, '110101', 'api', now + 30_000), true)
  assert.equal(cache.hasRecentFailure(storage, '110101', 'api', now + 61_000), false)
  assert.equal(cache.hasRecentFailure(storage, '110101', 'network', now + 30_000), false)
})

test('城市表：最多 5 个、去重、非法 adcode 与脏 source 清洗', async () => {
  const cache = await load('subpackages/tools-core/weather/weatherCache.ts')
  const storage = createStorage()
  const cities = cache.writeCities(storage, [
    { adcode: '110101', name: '东城区', province: '北京', city: '北京', source: 'fuzzy', updatedAt: 1 },
    { adcode: '110101', name: '重复', province: '北京', city: '北京', source: 'manual', updatedAt: 2 },
    { adcode: '330100', name: '杭州市', province: '浙江', city: '杭州', source: 'good', updatedAt: 3 },
    { adcode: 'bad', name: '非法', province: '', city: '', source: 'manual', updatedAt: 4 },
    { adcode: '310000', name: '上海市', province: '上海', city: '上海', source: 'manual', updatedAt: 5 },
    { adcode: '440300', name: '深圳市', province: '广东', city: '深圳', source: 'manual', updatedAt: 6 },
    { adcode: '510100', name: '成都市', province: '四川', city: '成都', source: 'manual', updatedAt: 7 },
    { adcode: '420100', name: '武汉市', province: '湖北', city: '武汉', source: 'manual', updatedAt: 8 },
  ])
  assert.equal(cities.length, 5)
  assert.equal(cities[0].adcode, '110101')
  assert.equal(cities[1].source, 'manual')
  assert.equal(cache.readCities(storage).length, 5)
  assert.equal(cache.findCity(cities, '330100').name, '杭州市')
  assert.equal(cache.findCity(cities, 'bad'), null)
})

test('城市表：当前 adcode、手动刷新时间、清理缓存、环境音/实验偏好', async () => {
  const cache = await load('subpackages/tools-core/weather/weatherCache.ts')
  const storage = createStorage()
  cache.writeCurrentAdcode(storage, '110101')
  assert.equal(cache.readCurrentAdcode(storage), '110101')
  cache.writeCurrentAdcode(storage, 'bad')
  assert.equal(cache.readCurrentAdcode(storage), '110101')

  cache.writeManualRefreshAt(storage, 123)
  assert.equal(cache.readManualRefreshAt(storage), 123)
  cache.writeAmbientEnabled(storage, true)
  assert.equal(cache.readAmbientEnabled(storage), true)
  cache.writeLabEnabled(storage, true)
  assert.equal(cache.readLabEnabled(storage), true)

  cache.writeLiveCache(storage, LIVE, 1)
  cache.writeForecastCache(storage, FORECAST, '110101', 1)
  cache.writeNegativeCache(storage, '110101', 'api', 1)
  cache.removeCityCache(storage, '110101')
  assert.equal(cache.readLiveCache(storage, '110101', 2), null)
  assert.equal(cache.readForecastCache(storage, '110101', 2), null)
  assert.equal(cache.hasRecentFailure(storage, '110101', 'api', 2), false)
})
