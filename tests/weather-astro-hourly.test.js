/* ==========================================================================
   全息气象 · 日出日落 / 24 小时插值单元测试
   - NOAA 算法用 UTC 分钟断言，避免测试机时区影响
   - 极昼 / 极夜显式返回；24h 结果必须落在官方温度区间内
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

const DAYS = [
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
  {
    date: '2026-11-10',
    week: '2',
    weekLabel: '周二',
    dayweather: '多云',
    nightweather: '阴',
    daytemp: 15,
    nighttemp: -1,
    daywind: '西南',
    nightwind: '北',
    daypower: '1-3',
    nightpower: '1-3',
  },
  {
    date: '2026-11-11',
    week: '3',
    weekLabel: '周三',
    dayweather: '小雨',
    nightweather: '中雨',
    daytemp: 14,
    nighttemp: 0,
    daywind: '北',
    nightwind: '东北',
    daypower: '1-3',
    nightpower: '1-3',
  },
  {
    date: '2026-11-12',
    week: '4',
    weekLabel: '周四',
    dayweather: '晴',
    nightweather: '晴',
    daytemp: 13,
    nighttemp: 1,
    daywind: '北',
    nightwind: '北',
    daypower: '1-3',
    nightpower: '1-3',
  },
]

test('日出日落：北京 2026-11-09 的时刻落在合理区间', async () => {
  const astro = await load('subpackages/tools-core/weather/weatherAstro.ts')
  const times = astro.computeSunTimes(39.9042, 116.4074, new Date(2026, 10, 9))
  assert.equal(times.kind, 'normal')
  assert.match(times.sunrise, /^\d{2}:\d{2}$/)
  assert.match(times.sunset, /^\d{2}:\d{2}$/)
  /* 北京 11 月日出约 06:45–07:00（UTC 分钟约 -50），日落约 17:00–17:10 */
  assert.ok(times.sunriseMinutes > -80 && times.sunriseMinutes < -20)
  assert.ok(times.sunsetMinutes > 520 && times.sunsetMinutes < 590)
})

test('日出日落：高纬度极昼 / 极夜显式返回，不产生 NaN', async () => {
  const astro = await load('subpackages/tools-core/weather/weatherAstro.ts')
  const summer = astro.computeSunTimes(80, 20, new Date(2026, 5, 21))
  assert.equal(summer.kind, 'polar-day')
  assert.equal(summer.sunrise, '极昼')
  assert.equal(summer.sunset, '极昼')

  const winter = astro.computeSunTimes(80, 20, new Date(2026, 11, 21))
  assert.equal(winter.kind, 'polar-night')
  assert.equal(winter.sunrise, '极夜')
  assert.equal(winter.sunset, '极夜')
})

test('日出日落：非法经纬度返回占位，不抛错', async () => {
  const astro = await load('subpackages/tools-core/weather/weatherAstro.ts')
  for (const [lat, lng] of [
    [91, 0],
    [-91, 0],
    [0, 181],
    [Number.NaN, 120],
  ]) {
    const times = astro.computeSunTimes(lat, lng, new Date(2026, 10, 9))
    assert.equal(times.kind, 'normal')
    assert.equal(times.sunrise, '—')
    assert.equal(times.sunset, '—')
  }
})

test('24 小时推算：生成 24 个点，首点对应当前小时，温度不越界', async () => {
  const hourly = await load('subpackages/tools-core/weather/weatherHourly.ts')
  const now = new Date(2026, 10, 9, 9, 20, 0)
  const points = hourly.buildHourlyForecast(DAYS, now)
  assert.equal(points.length, 24)
  assert.equal(points[0].hour, 9)
  assert.equal(points[0].label, '09:00')
  assert.equal(points[23].hour, 8)
  const min = Math.min(...DAYS.map((day) => Math.min(day.daytemp, day.nighttemp))) - 1
  const max = Math.max(...DAYS.map((day) => Math.max(day.daytemp, day.nighttemp))) + 1
  for (const point of points) {
    assert.equal(Number.isInteger(point.temp), true)
    assert.ok(point.temp >= min && point.temp <= max)
    assert.equal(typeof point.isNight, 'boolean')
  }
  const aria = hourly.hourlyAriaText(points)
  assert.match(aria, /24 小时温度推算/)
  assert.match(aria, /仅供参考/)
})

test('24 小时推算：缺温度 / 空预报返回空数组，不补 0', async () => {
  const hourly = await load('subpackages/tools-core/weather/weatherHourly.ts')
  assert.deepEqual(hourly.buildHourlyForecast([], new Date()), [])
  const empty = [{ ...DAYS[0], daytemp: null, nighttemp: null }]
  assert.deepEqual(hourly.buildHourlyForecast(empty, new Date()), [])
  assert.match(hourly.hourlyAriaText([]), /暂无/)
})
