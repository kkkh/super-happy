/* ==========================================================================
   全息气象 · 官方字段解析 / 天气码 / 错误码 / 网络层单元测试
   - 固定样本来自高德真实响应形状（含 week 数字、city=[]、局域网）
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

function moduleUrl(relative) {
  return pathToFileURL(path.join(ROOT, relative)).href
}

async function load(relative) {
  return import(moduleUrl(relative))
}

const LIVE_BODY = {
  status: '1',
  info: 'OK',
  infocode: '10000',
  count: '1',
  lives: [
    {
      province: '北京',
      city: '东城区',
      adcode: '110101',
      weather: '晴',
      temperature: '7',
      winddirection: '西南',
      windpower: '≤3',
      humidity: '40',
      reporttime: '2026-11-09 10:34:04',
    },
  ],
}

function forecastBody(casts) {
  return {
    status: '1',
    info: 'OK',
    infocode: '10000',
    forecasts: [
      {
        city: '北京市',
        province: '北京',
        adcode: '110000',
        reporttime: '2026-11-09 10:34:04',
        casts,
      },
    ],
  }
}

const CASTS = [
  {
    date: '2026-11-09',
    week: '1',
    dayweather: '晴',
    nightweather: '晴',
    daytemp: '12',
    nighttemp: '-2',
    daywind: '西南',
    nightwind: '西南',
    daypower: '1-3',
    nightpower: '1-3',
  },
  {
    date: '2026-11-10',
    week: '2',
    dayweather: '多云',
    nightweather: '阴',
    daytemp: '15',
    nighttemp: '-1',
    daywind: '西南',
    nightwind: '北',
    daypower: '1-3',
    nightpower: '1-3',
  },
  {
    date: '2026-11-11',
    week: '3',
    dayweather: '小雨',
    nightweather: '中雨',
    daytemp: '14',
    nighttemp: '0',
    daywind: '北',
    nightwind: '东北',
    daypower: '1-3',
    nightpower: '1-3',
  },
  {
    date: '2026-11-12',
    week: '4',
    dayweather: '晴',
    nightweather: '晴',
    daytemp: '13',
    nighttemp: '1',
    daywind: '北',
    nightwind: '北',
    daypower: '1-3',
    nightpower: '1-3',
  },
]

test('实况：严格解析 9 个官方字段，温度与湿度转数字', async () => {
  const parse = await load('subpackages/tools-core/weather/weatherParse.ts')
  const live = parse.parseLiveWeather(LIVE_BODY)
  assert.ok(live)
  assert.equal(live.province, '北京')
  assert.equal(live.city, '东城区')
  assert.equal(live.adcode, '110101')
  assert.equal(live.weather, '晴')
  assert.equal(live.temperature, 7)
  assert.equal(live.winddirection, '西南')
  assert.equal(live.windpower, '≤3')
  assert.equal(live.humidity, 40)
  assert.equal(live.reporttime, '2026-11-09 10:34:04')
  assert.equal(parse.buildWeatherSummary(live), '东城区 晴 7℃')
})

test('实况：缺 weather / 非法 adcode 返回 null，绝不伪造', async () => {
  const parse = await load('subpackages/tools-core/weather/weatherParse.ts')
  assert.equal(parse.parseLiveWeather({ status: '1', lives: [] }), null)
  assert.equal(parse.parseLiveWeather({ lives: [{ adcode: '110101' }] }), null)
  assert.equal(
    parse.parseLiveWeather({ lives: [{ adcode: 'abc', weather: '晴' }] }),
    null,
  )
})

test('预报：4 天字段全量解析，week 1-4 归一化为周一至周四', async () => {
  const parse = await load('subpackages/tools-core/weather/weatherParse.ts')
  const forecast = parse.parseForecastWeather(forecastBody(CASTS))
  assert.ok(forecast)
  assert.equal(forecast.days.length, 4)
  assert.deepEqual(
    forecast.days.map((day) => day.weekLabel),
    ['周一', '周二', '周三', '周四'],
  )
  const first = forecast.days[0]
  assert.equal(first.date, '2026-11-09')
  assert.equal(first.dayweather, '晴')
  assert.equal(first.nightweather, '晴')
  assert.equal(first.daytemp, 12)
  assert.equal(first.nighttemp, -2)
  assert.equal(first.daywind, '西南')
  assert.equal(first.nightwind, '西南')
  assert.equal(first.daypower, '1-3')
  assert.equal(first.nightpower, '1-3')
  assert.equal(parse.formatWeek('7'), '周日')
  assert.equal(parse.formatWeek('周一'), '周一')
})

test('预报：接口只返回 3 天时按实际长度降级，不补造第 4 天', async () => {
  const parse = await load('subpackages/tools-core/weather/weatherParse.ts')
  const forecast = parse.parseForecastWeather(forecastBody(CASTS.slice(0, 3)))
  assert.ok(forecast)
  assert.equal(forecast.days.length, 3)
})

test('预报：casts 非数组 / 日期非法返回 null', async () => {
  const parse = await load('subpackages/tools-core/weather/weatherParse.ts')
  assert.equal(parse.parseForecastWeather({ forecasts: [] }), null)
  assert.equal(
    parse.parseForecastWeather(forecastBody([{ date: 'bad', week: '1' }])),
    null,
  )
})

test('reporttime：手写组件解析，格式化为 11-09 10:34，不依赖 iOS new Date', async () => {
  const parse = await load('subpackages/tools-core/weather/weatherParse.ts')
  const time = parse.parseAmapTime('2026-11-09 10:34:04')
  assert.ok(time)
  assert.equal(time.year, 2026)
  assert.equal(time.month, 11)
  assert.equal(parse.formatReportTime('2026-11-09 10:34:04'), '11-09 10:34')
  assert.equal(parse.formatReportTime('bad'), 'bad')
  assert.equal(parse.parseAmapTime('2026-11-09T10:34:04'), null)
})

test('逆地理：直辖市 city=[] 时回退 province，adcode 保留', async () => {
  const parse = await load('subpackages/tools-core/weather/weatherParse.ts')
  const result = parse.parseRegeo({
    status: '1',
    regeocode: {
      addressComponent: {
        province: '北京市',
        city: [],
        district: '东城区',
        adcode: '110101',
        level: null,
      },
    },
  })
  assert.ok(result)
  assert.equal(result.province, '北京市')
  assert.equal(result.city, '北京市')
  assert.equal(result.district, '东城区')
  assert.equal(result.adcode, '110101')
})

test('IP 定位：正常解析；局域网 / 空 city / 空 adcode 一律跳过', async () => {
  const parse = await load('subpackages/tools-core/weather/weatherParse.ts')
  const normal = parse.parseIpLocation({
    status: '1',
    province: '山西省',
    city: '长治市',
    adcode: '140400',
    rectangle: '112.9876685,36.0873091;113.2431006,36.29399392',
  })
  assert.ok(normal)
  assert.equal(normal.city, '长治市')
  assert.ok(normal.center)
  assert.equal(normal.center.lng > 112 && normal.center.lng < 114, true)

  assert.equal(
    parse.parseIpLocation({ status: '1', province: '局域网', city: [], adcode: [] }),
    null,
  )
  assert.equal(
    parse.parseIpLocation({ status: '1', province: '北京市', city: '北京市', adcode: '' }),
    null,
  )
})

test('行政区搜索：解析 name / adcode / level / center，去重并限制 8 条', async () => {
  const parse = await load('subpackages/tools-core/weather/weatherParse.ts')
  const results = parse.parseDistrictSearch({
    status: '1',
    districts: [
      { name: '杭州市', adcode: '330100', level: 'city', center: '120.209903,30.246566' },
      { name: '杭州市', adcode: '330100', level: 'city', center: '120.209903,30.246566' },
      { name: '西湖区', adcode: '330106', level: 'district', center: '120.13,30.26' },
      { name: '非法', adcode: 'abc', level: 'city', center: '' },
    ],
  })
  assert.equal(results.length, 2)
  assert.equal(results[0].adcode, '330100')
  assert.equal(results[0].name, '杭州市')
  assert.ok(results[0].center)
})

test('天气码：官方 60+ 现象全部映射，未知走兜底且保留原文', async () => {
  const code = await load('subpackages/tools-core/weather/weatherCode.ts')
  const entries = Object.entries(code.WEATHER_PHENOMENA)
  assert.ok(entries.length >= 60)
  for (const [label, family] of entries) {
    assert.equal(code.resolveWeather(label).family, family)
  }
  assert.equal(code.resolveWeather('雷阵雨').family, 'thunder')
  assert.equal(code.resolveWeather('大雨').family, 'heavyRain')
  assert.equal(code.resolveWeather('雨夹雪').family, 'sleet')
  assert.equal(code.resolveWeather('强浓雾').family, 'fog')
  assert.equal(code.resolveWeather('强沙尘暴').family, 'dust')
  assert.deepEqual(code.resolveWeather('冰雹'), { label: '冰雹', family: 'unknown' })
})

test('环境音场景：降水类 → 雨声，风沙雾 → 风声，晴 → 无', async () => {
  const code = await load('subpackages/tools-core/weather/weatherCode.ts')
  assert.equal(code.ambientSceneFor('rain'), 'rain')
  assert.equal(code.ambientSceneFor('heavyRain'), 'rain')
  assert.equal(code.ambientSceneFor('thunder'), 'rain')
  assert.equal(code.ambientSceneFor('wind'), 'wind')
  assert.equal(code.ambientSceneFor('haze'), 'wind')
  assert.equal(code.ambientSceneFor('clear'), null)
})

test('错误码：10009 平台不符给出 Web服务指引，未知码兜底', async () => {
  const diag = await load('subpackages/tools-core/weather/weatherDiagnostics.ts')
  const info = diag.describeInfoCode('10009')
  assert.equal(info.label, 'USERKEY_PLAT_NOMATCH')
  assert.match(info.advice, /Web服务/)
  assert.equal(info.severity, 'error')
  assert.equal(diag.describeInfoCode('10003').severity, 'error')
  assert.equal(diag.describeInfoCode('32000').label, 'ENGINE_RESPONSE_DATA_ERROR')
  assert.equal(diag.describeInfoCode('99999').label, 'UNKNOWN_INFOCODE')
  assert.equal(diag.describeInfoCode('').code, '—')
})

test('网络层：成功解析实况；10009 抛 WeatherError；未配置 Key 不发请求', async () => {
  const serviceModule = await load('subpackages/tools-core/weather/weatherService.ts')
  const { WeatherService, WeatherError } = serviceModule
  let calls = 0
  const okTransport = () => {
    calls += 1
    return {
      promise: Promise.resolve({ statusCode: 200, data: LIVE_BODY }),
      abort() {},
    }
  }
  const service = new WeatherService({ key: 'test-key', transport: okTransport })
  const live = await service.fetchLive('110101').promise
  assert.equal(live.temperature, 7)
  assert.equal(calls, 1)
  assert.equal(service.maskedKey().includes('test-key'), false)

  const failTransport = () => ({
    promise: Promise.resolve({
      statusCode: 200,
      data: { status: '0', info: 'USERKEY_PLAT_NOMATCH', infocode: '10009' },
    }),
    abort() {},
  })
  const failing = new WeatherService({ key: 'test-key', transport: failTransport })
  await assert.rejects(failing.fetchLive('110101').promise, (error) => {
    assert.ok(error instanceof WeatherError)
    assert.equal(error.kind, 'api')
    assert.equal(error.infocode, '10009')
    return true
  })

  let configCalls = 0
  const configService = new WeatherService({
    key: '',
    transport: () => {
      configCalls += 1
      return { promise: Promise.resolve({ statusCode: 200, data: LIVE_BODY }), abort() {} }
    },
  })
  await assert.rejects(configService.fetchLive('110101').promise, (error) => {
    return error instanceof WeatherError && error.kind === 'config'
  })
  assert.equal(configCalls, 0)
})
