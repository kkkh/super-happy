/* ==========================================================================
   和风天气 · 数据层 / 图标 / 端点 / 凭据 / 页面契约
   - 20 个 API 端点覆盖 8 组能力，27 个范围变体全部登记
   - 官方图标 507 个，文件名与 API icon 字段一致
   - 解析层对缺失字段兜底；缓存 TTL / 城市隔离可用
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { registerHooks } = require('node:module')

const ROOT = path.resolve(__dirname, '..')
const URL_ROOT = `${pathToFileURL(ROOT).href}/`
const ICON_ROOT = path.join(ROOT, 'subpackages/weather/assets/icons')

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !path.extname(specifier)) {
      try {
        return nextResolve(`${specifier}.ts`, context)
      } catch {
        /* 回退 */
      }
    }
    return nextResolve(specifier, context)
  },
})

async function load(relative) {
  return import(`${URL_ROOT}${relative}`)
}

test('端点：URL 构造、坐标精度与 27 个目录变体', async () => {
  const E = await load('subpackages/weather/lib/qweather/endpoints.ts')
  assert.equal(E.lngLat(39.90421, 116.40743), '116.41,39.9')
  assert.equal(E.latLonPath(39.90421, 116.40743), '39.9/116.41')

  const city = {
    id: '101010100',
    name: '北京',
    lat: 39.9,
    lon: 116.41,
    utcOffset: '+08:00',
  }

  assert.match(E.weatherCurrent(city).path, /^\/weather\/v1\/current\/39\.9\/116\.41\?/)
  assert.match(E.weatherCurrent(city).path, /localTime=true/)
  assert.match(E.weatherDailyV1(city, 10).path, /days=10/)
  assert.match(E.weatherHourlyV1(city, 240).path, /hours=240/)
  assert.match(E.weatherNowV7(city).path, /^\/v7\/weather\/now\?location=101010100/)
  /* 景点 POI 的 LocationID 不被天气接口接受，必须改用经纬度 */
  assert.match(
    E.weatherNowV7({ id: '10101010007A', source: 'poi', lat: 39.94, lon: 116.41 }).path,
    /^\/v7\/weather\/now\?location=116\.41(%2C|,)39\.94/,
  )
  assert.match(E.weatherDailyV7(city, 30).path, /^\/v7\/weather\/30d\?/)
  assert.match(E.weatherDailyV7(city, 7).path, /^\/v7\/weather\/7d\?/)
  assert.match(E.weatherDailyV7(city, 3).path, /^\/v7\/weather\/3d\?/)
  assert.match(E.weatherDailyV7(city, 15).path, /^\/v7\/weather\/15d\?/)
  assert.match(E.weatherHourlyV7(city, 24).path, /^\/v7\/weather\/24h\?/)
  assert.match(E.weatherHourlyV7(city, 72).path, /^\/v7\/weather\/72h\?/)
  assert.match(E.weatherHourlyV7(city, 168).path, /^\/v7\/weather\/168h\?/)
  assert.match(E.minutely(city).path, /^\/v7\/minutely\/5m\?location=116\.41(%2C|,)39\.9/)
  assert.match(E.airCurrent(city).path, /^\/airquality\/v1\/current\/39\.9\/116\.41/)
  assert.match(E.history(city, '20260101').path, /date=20260101/)
  /* 时光机只接受城市 LocationID；景点必须使用所属城市 ID */
  assert.match(
    E.history({ id: '10101010018A', parentId: '101010100', source: 'poi', lat: 39.91, lon: 116.39 }, '20260101').path,
    /location=101010100/,
  )
  assert.match(E.weatherAlert(city).path, /^\/weatheralert\/v1\/current/)
  assert.match(E.indices(city, 3).path, /^\/v7\/indices\/3d\?type=0/)
  assert.match(E.astronomySun(city, '2026-01-01').path, /date=20260101/)
  assert.match(E.astronomyMoon(city, '2026-01-01').path, /date=20260101/)
  assert.match(E.astronomySolar({ city, date: '2026-01-01', time: '1200', tz: '0800', alt: 0 }).path, /tz=0800/)

  const catalog = E.endpointCatalog(city, '2026-01-01')
  const keys = catalog.map((item) => item.key)
  assert.equal(catalog.length, 27, '端点目录必须覆盖 27 个范围变体')
  assert.equal(new Set(keys).size, 27, '端点 key 不得重复')
  const groups = new Set(catalog.map((item) => item.group))
  for (const group of ['GeoAPI', '天气预报', '分钟预报', '空气质量', '天气指数', '天文', '预警', '时光机']) {
    assert.ok(groups.has(group), `缺少 ${group} 组`)
  }
  for (const item of catalog) {
    assert.ok(item.path.startsWith('/'), `${item.key} 路径必须以 / 开头`)
    assert.ok(item.label && item.description, `${item.key} 缺少说明`)
  }
  /* Geo 结果不进入持久缓存 */
  for (const item of catalog.filter((entry) => entry.group === 'GeoAPI')) {
    assert.equal(item.cacheable, false, `${item.key} 不应落盘缓存`)
  }
})

test('图标：507 个官方 SVG，关键图标齐全且命名合法', () => {
  const files = fs.readdirSync(ICON_ROOT).filter((name) => name.endsWith('.svg'))
  assert.equal(files.length, 507, '官方图标必须全量入库')
  for (const file of files) {
    assert.match(file, /^(\d{3,4}(-fill)?|qweather(-fill)?)\.svg$/, `非法图标文件名：${file}`)
    const content = fs.readFileSync(path.join(ICON_ROOT, file), 'utf8')
    assert.ok(content.length > 0, `${file} 为空文件`)
    assert.ok(!content.includes('currentColor'), `${file} 仍依赖 currentColor，image 渲染会变黑`)
    assert.match(content, /fill="#ffffff"/, `${file} 缺少白色填充`)
    assert.match(content, /width="128" height="128"/, `${file} 未设置高分屏渲染尺寸`)
  }
  assert.ok(files.includes('qweather.svg'), '缺少品牌图标 qweather.svg')
  for (const code of ['100', '100-fill', '150', '800', '801', '802', '803', '804', '805', '806', '807', '1001', '1011', '9999']) {
    assert.ok(files.includes(`${code}.svg`), `缺少关键图标 ${code}.svg`)
  }
  assert.ok(fs.existsSync(path.join(ICON_ROOT, 'LICENSE.md')), '缺少图标许可文件')
  assert.ok(fs.existsSync(path.join(ICON_ROOT, 'LICENSE.txt')), '缺少随包上传的 LICENSE.txt')
})

test('图标映射：夜间转换、预警、月相与风向文案', async () => {
  const icons = await load('subpackages/weather/lib/qweather/icons.ts')
  assert.equal(icons.normalizeIconCode(100, true), '150')
  assert.equal(icons.normalizeIconCode(103, true), '153')
  assert.equal(icons.normalizeIconCode(101, false), '101')
  assert.equal(icons.normalizeIconCode('bad'), '9999')
  assert.equal(icons.iconPath(100), '/subpackages/weather/assets/icons/100.svg')
  assert.equal(icons.iconPath(100, { fill: true }), '/subpackages/weather/assets/icons/100-fill.svg')
  assert.equal(icons.iconPath('bad', { fill: true }), '/subpackages/weather/assets/icons/9999.svg')
  assert.equal(icons.warningIconPath('1006'), '/subpackages/weather/assets/icons/1006.svg')
  assert.equal(icons.warningIconPath('200'), '/subpackages/weather/assets/icons/9999.svg')
  assert.equal(icons.moonIconPath('804'), '/subpackages/weather/assets/icons/804.svg')
  assert.equal(icons.moonIconPath('1'), '/subpackages/weather/assets/icons/9999.svg')
  assert.equal(icons.fallbackIconPath(true), '/subpackages/weather/assets/icons/9999.svg')
  assert.equal(icons.compassText('ne'), '东北风')
  assert.equal(icons.uvText(8), '8 · 强')
})

test('解析：实时 / 每日 / 逐小时 / 分钟降水', async () => {
  const P = await load('subpackages/weather/lib/qweather/parse.ts')

  const current = P.parseCurrentV1(
    {
      validTime: '2026-01-01T10:30+08:00',
      temperature: { value: 12.4, unit: '°C' },
      feelsLike: { value: 10.1, unit: '°C' },
      condition: { code: '101', text: '多云' },
      wind: {
        direction: { degree: 45, compass: 'ne' },
        speed: { value: 3.2, unit: 'm/s' },
        scale: 2,
      },
      windGust: { value: 6.1, unit: 'm/s' },
      precipitation: {
        amount: { value: 0.2, unit: 'mm' },
        intensity: { value: 0.6, unit: 'mm/h' },
        type: 'rain',
      },
      pressure: { value: 1013, unit: 'hPa' },
      visibility: { value: 12000, unit: 'm' },
      dewPoint: { value: 4, unit: '°C' },
      humidity: 0.62,
      cloudCover: 0.8,
      uvIndex: 4,
    },
    '100',
  )
  assert.equal(current.icon, '100')
  assert.equal(current.tempText, '12°')
  assert.equal(current.humidityText, '62%')
  assert.equal(current.visibilityText, '12.0 km')
  assert.equal(current.wind.text, '东北风 · 2 级 · 3.2 m/s')
  assert.equal(current.precipTypeText, '雨')
  assert.equal(current.precipIntensityText, '0.6 mm/h')

  /* v1 实况没有 validTime 时，服务层会用 v7 obsTime 兜底 */
  const currentWithObsTime = P.parseCurrentV1({}, '', '2026-01-01T10:30+08:00')
  assert.equal(currentWithObsTime.validTimeText, '10:30')

  const daily = P.parseDailyV1({
    days: [
      {
        forecastStartTime: '2026-01-01T00:00+08:00',
        temperatureMax: { value: 18, unit: '°C' },
        temperatureMin: { value: 3, unit: '°C' },
        temperatureAvg: { value: 10, unit: '°C' },
        uvIndexMax: 6,
        astro: {
          sunrise: '2026-01-01T07:30+08:00',
          sunset: '2026-01-01T17:05+08:00',
          astronomicalDawn: '2026-01-01T05:20+08:00',
          nauticalDawn: '2026-01-01T05:50+08:00',
          civilDawn: '2026-01-01T06:20+08:00',
          astronomicalDusk: '2026-01-01T18:30+08:00',
          nauticalDusk: '2026-01-01T18:00+08:00',
          civilDusk: '2026-01-01T17:30+08:00',
          moonrise: '2026-01-01T20:10+08:00',
          moonset: '2026-01-01T09:20+08:00',
          moonPhase: 'full-moon',
        },
        daytime: {
          forecastStartTime: '2026-01-01T07:00+08:00',
          forecastEndTime: '2026-01-01T19:00+08:00',
          condition: { code: '100', text: '晴' },
          wind: { direction: { degree: 90, compass: 'e' }, speed: { value: 2, unit: 'm/s' }, scale: 1 },
          precipitation: { amount: { value: 0, unit: 'mm' }, probability: 0.1, type: 'rain' },
          humidity: 0.4,
          cloudCover: 0.2,
        },
        nighttime: { condition: { code: '150', text: '晴' }, humidity: 0.7, cloudCover: 0.3 },
      },
    ],
  })
  assert.equal(daily.length, 1)
  assert.equal(daily[0].iconDay, '100')
  assert.equal(daily[0].iconNight, '150')
  assert.equal(daily[0].tempMaxText, '18°')
  assert.equal(daily[0].popText, '10%')
  assert.equal(daily[0].moonPhase, '满月')
  assert.equal(daily[0].moonIcon, '804')
  assert.equal(daily[0].sunriseText, '07:30')
  assert.equal(daily[0].astro.astronomicalDawn, '05:20')
  assert.equal(daily[0].astro.astronomicalDusk, '18:30')
  assert.equal(daily[0].daytime.periodText, '07:00–19:00')
  assert.equal(daily[0].daytime.precipTypeText, '雨')

  const hourlyV7 = P.parseHourlyV7({
    hourly: [
      {
        fxTime: '2026-01-01T11:00+08:00',
        temp: '15',
        icon: '101',
        text: '多云',
        windDir: '东北风',
        wind360: '45',
        windScale: '2',
        windSpeed: '6',
        humidity: '55',
        precip: '0.0',
        pop: '10',
        pressure: '1012',
        vis: '20',
        dew: '6',
        cloud: '40',
      },
    ],
  })
  assert.equal(hourlyV7.length, 1, 'v7 逐小时必须读取 hourly 字段')
  assert.equal(hourlyV7[0].hourText, '11:00')
  assert.equal(hourlyV7[0].tempText, '15°')
  assert.equal(hourlyV7[0].popText, '10%')
  assert.equal(hourlyV7[0].windText, '东北风 · 2 级 · 6 km/h')

  const dailyV7 = P.parseDailyV7({
    daily: [
      {
        fxDate: '2026-01-01',
        tempMax: '18',
        tempMin: '3',
        textDay: '晴',
        textNight: '多云',
        iconDay: '100',
        iconNight: '151',
        windDirDay: '东北风',
        wind360Day: '45',
        windScaleDay: '3-4',
        windSpeedDay: '6',
        precip: '0.0',
        humidity: '55',
        cloud: '20',
        pressure: '1012',
        vis: '20',
        uvIndex: '6',
      },
    ],
  })
  assert.equal(dailyV7.length, 1)
  assert.equal(dailyV7[0].tempMaxText, '18°', 'v7 顶层最高温必须来自 tempMax')
  assert.equal(dailyV7[0].tempMinText, '3°', 'v7 顶层最低温必须来自 tempMin')
  assert.equal(dailyV7[0].daytime.tempMaxText, '—', 'v7 昼夜没有独立温度，不应伪造')
  assert.equal(dailyV7[0].tempAvgText, '11°')
  assert.equal(dailyV7[0].windDayText, '东北风 · 3-4 级 · 6 km/h', 'v7 风力区间必须保留')

  const hourlyV1 = P.parseHourlyV1({
    hours: [
      {
        forecastTime: '2026-01-01T12:00+08:00',
        condition: { code: '300', text: '小雨' },
        temperature: { value: 12, unit: '°C' },
        wind: { direction: { degree: 90, compass: 'e' }, speed: { value: 2, unit: 'm/s' }, scale: 1 },
        precipitation: {
          amount: { value: 0.4, unit: 'mm' },
          intensity: { value: 0.8, unit: 'mm/h' },
          type: 'rain',
          probability: 0.6,
        },
      },
    ],
  })
  assert.equal(hourlyV1[0].precipTypeText, '雨')
  assert.equal(hourlyV1[0].precipIntensityText, '0.8 mm/h')
  assert.equal(hourlyV1[0].popText, '60%')

  const minutely = P.parseMinutely({
    summary: '未来两小时有雨',
    updateTime: '2026-01-01T10:30+08:00',
    minutely: [
      { fxTime: '2026-01-01T10:35+08:00', precip: '0.12', type: 'rain' },
      { fxTime: '2026-01-01T10:40+08:00', precip: '0.30', type: 'rain' },
    ],
  })
  assert.equal(minutely.points.length, 2)
  assert.equal(minutely.totalPrecipText, '0.42 mm')
  assert.equal(minutely.maxPrecipText, '0.30 mm')
  assert.equal(minutely.hasRain, true)
  assert.equal(minutely.typeText, '雨')
  assert.equal(minutely.peakTimeText, '10:40')
})

test('解析：空气质量 / 预警 / 指数 / 天文 / 时光机', async () => {
  const P = await load('subpackages/weather/lib/qweather/parse.ts')

  const air = P.parseAirCurrent({
    indexes: [
      {
        code: 'cn-mee',
        name: 'AQI',
        aqi: 72,
        aqiDisplay: '72',
        level: '2',
        category: '良',
        color: { red: 255, green: 200, blue: 0, alpha: 1 },
        primaryPollutant: { code: 'pm2p5', name: 'PM2.5', fullName: '细颗粒物' },
        health: {
          effect: '可接受',
          advice: { generalPopulation: '一般人群可正常活动。', sensitivePopulation: '儿童、老年人应减少户外活动' },
        },
      },
    ],
    pollutants: [
      {
        code: 'pm2p5',
        name: 'PM2.5',
        fullName: '细颗粒物',
        concentration: { value: 42, unit: 'μg/m³' },
        subIndexes: [{ code: 'cn-mee', aqi: 72, aqiDisplay: '72' }],
      },
    ],
    stations: [{ name: '天安门' }, { name: '奥体中心' }],
  })
  assert.equal(air.primary.code, 'cn-mee')
  assert.equal(air.primary.category, '良')
  assert.equal(air.stationsText, '天安门 · 奥体中心')
  assert.equal(air.generalAdvice, '可正常活动。', '一般人群前缀不应在标签外重复')
  assert.equal(air.pollutants[0].valueText, '42 μg/m³')

  const airHourIndex = {
    code: 'cn-mee',
    name: 'AQI',
    aqi: 80,
    aqiDisplay: '80',
    category: '良',
    color: { red: 255, green: 200, blue: 0, alpha: 1 },
    primaryPollutant: { code: 'pm2p5', name: 'PM2.5' },
    health: { effect: '可接受', advice: { generalPopulation: '正常活动', sensitivePopulation: '减少户外' } },
  }
  const airHourly = P.parseAirHourly({
    hours: [
      {
        forecastTime: '2026-01-01T12:00+08:00',
        indexes: [airHourIndex],
        pollutants: [
          { code: 'pm2p5', name: 'PM2.5', concentration: { value: 42, unit: 'μg/m³' }, subIndexes: [] },
        ],
      },
    ],
  })
  assert.equal(airHourly[0].hourText, '12:00')
  assert.equal(airHourly[0].indexes.length, 1)
  assert.equal(airHourly[0].pollutants.length, 1)

  const airDaily = P.parseAirDaily({
    days: [
      {
        forecastStartTime: '2026-01-01T00:00+08:00',
        indexes: [airHourIndex],
        pollutants: [],
      },
    ],
  })
  assert.equal(airDaily[0].dateText, '01-01')
  assert.equal(airDaily[0].indexes.length, 1)
  assert.equal(airDaily[0].indexes[0].category, '良')

  const alerts = P.parseAlerts({
    alerts: [
      {
        id: 'alert-1',
        eventType: { name: '大风', code: '1006' },
        severity: 'moderate',
        color: { code: 'yellow' },
        headline: '大风黄色预警',
        description: '阵风 8 级',
        instruction: '远离广告牌',
        senderName: '北京市气象台',
        issuedTime: '2026-01-01T09:00+08:00',
        onsetTime: '2026-01-01T10:00+08:00',
        expireTime: '2026-01-01T21:00+08:00',
        messageType: { code: 'alert' },
        criteria: '阵风 8 级以上',
        responseTypes: [{ name: '交通管制' }],
        icon: '1006',
      },
    ],
  })
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0].severityText, '中等 · 黄色')
  assert.equal(alerts[0].event, '大风')
  assert.equal(alerts[0].icon, '1006')
  assert.equal(alerts[0].eventCode, '1006')
  assert.equal(alerts[0].messageTypeText, '发布')
  assert.equal(alerts[0].onsetText, '10:00')
  assert.equal(alerts[0].criteria, '阵风 8 级以上')
  assert.equal(alerts[0].responseTypesText, '交通管制')

  const indices = P.parseIndices({
    daily: [
      { date: '2026-01-01', type: '1', name: '运动指数', level: '3', category: '较不宜', text: '风较大' },
      { date: '2026-01-01', type: '2', name: '洗车指数', level: '2', category: '较适宜', text: '无雨' },
    ],
  })
  assert.equal(indices.length, 1)
  assert.equal(indices[0].items.length, 2)
  assert.equal(indices[0].items[0].name, '运动指数')

  const sun = P.parseSun({
    sunrise: '2026-01-01T07:30+08:00',
    sunset: '2026-01-01T17:05+08:00',
  })
  assert.equal(sun.dayLengthText, '9 小时 35 分')
  assert.equal(sun.sunriseText, '07:30')

  const moonHours = Array.from({ length: 24 }, (_, index) => {
    const hour = String(index).padStart(2, '0')
    return index < 20
      ? { fxTime: `2026-01-01T${hour}:00+08:00`, name: '蛾眉月', icon: '801', illumination: '12' }
      : { fxTime: `2026-01-01T${hour}:00+08:00`, name: '上弦月', icon: '802', illumination: '48' }
  })
  const moon = P.parseMoon({
    moonrise: '2026-01-01T08:10+08:00',
    moonset: '2026-01-01T20:20+08:00',
    updateTime: '2026-01-01T02:00+08:00',
    moonPhase: moonHours,
  })
  assert.equal(moon.phases.length, 2, '逐小时重复月相必须按相位去重')
  assert.equal(moon.current.name, '蛾眉月', '当前月相应取最接近 updateTime 的相位')
  assert.equal(moon.current.illuminationText, '12%')

  const solar = P.parseSolar({
    solarElevationAngle: '32.5',
    solarAzimuthAngle: '210.4',
    solarHour: '1201',
    hourAngle: '15.2',
  })
  assert.equal(solar.elevationText, '32.5°')
  assert.equal(solar.azimuthText, '210.4°')
  assert.equal(solar.solarHourText, '12:01')

  const history = P.parseHistory({
    weatherDaily: {
      date: '2026-01-01',
      tempMax: '18',
      tempMin: '3',
      humidity: '45',
      precip: '0.0',
      pressure: '1013',
      sunrise: '07:30',
      sunset: '17:05',
      moonPhase: '满月',
    },
    weatherHourly: [
      { time: '2026-01-01T00:00+08:00', temp: '5', icon: '150', text: '晴', humidity: '50', windDir: '北风', windScale: '2', windSpeed: '7', precip: '0.0', pressure: '1015' },
    ],
  })
  assert.equal(history.daily.tempMaxText, '18°')
  assert.equal(history.daily.moonPhase, '满月')
  assert.equal(history.hourly.length, 1)
  assert.equal(history.hourly[0].timeText, '00:00')
})

test('错误映射：域名白名单 / 超时 / 401 都有可执行文案', async () => {
  const { QWeatherError, describeQWeatherError } = await load(
    'subpackages/weather/lib/qweather/client.ts',
  )
  const domain = new QWeatherError('network', '网络不可用，请检查网络后重试', {
    detail: 'request:fail url not in domain list',
  })
  assert.match(describeQWeatherError(domain), /request 合法域名/)
  const timeout = new QWeatherError('network', '网络不可用，请检查网络后重试', {
    detail: 'request:fail timeout',
  })
  assert.match(describeQWeatherError(timeout), /timeout/)
  const auth = new QWeatherError('auth', '和风天气凭据无效或已过期，请重新生成 Token', {
    status: 401,
    detail: 'invalid token',
  })
  assert.match(describeQWeatherError(auth), /invalid token/)
})

test('缓存：TTL、城市隔离与清空', async () => {
  const values = new Map()
  global.wx = {
    getStorageSync(key) {
      return values.has(key) ? values.get(key) : undefined
    },
    setStorageSync(key, value) {
      values.set(key, value)
    },
    removeStorageSync(key) {
      values.delete(key)
    },
  }
  const cache = await load('subpackages/weather/lib/qweather/cache.ts')
  cache.clearQwCache()
  cache.writeQwCache('weather|current|101010100', { temp: 1 }, 60_000, '+08:00')
  assert.deepEqual(cache.readQwCache('weather|current|101010100'), { temp: 1 })

  cache.writeQwCache('weather|current|101010100|expire', { temp: 2 }, 1, '+08:00')
  await new Promise((resolve) => setTimeout(resolve, 8))
  assert.equal(cache.readQwCache('weather|current|101010100|expire'), null)

  cache.writeQwCache('weather|current|101010100', { temp: 3 }, 60_000, '+08:00')
  cache.writeQwCache('weather|current|101020100', { temp: 4 }, 60_000, '+08:00')
  cache.clearQwCacheForCity('101010100')
  assert.equal(cache.readQwCache('weather|current|101010100'), null)
  assert.deepEqual(cache.readQwCache('weather|current|101020100'), { temp: 4 })

  values.set('qweather:cache:v1', { legacy: true })
  cache.clearLegacyQwCache()
  assert.equal(values.has('qweather:cache:v1'), false)
})

test('城市本地日期：时区换算与逐日递增', async () => {
  const D = await load('subpackages/weather/lib/qweather/date.ts')
  for (const offset of ['+08:00', '-05:00', '+14:00', '-12:00', '']) {
    const today = D.todayKeyFor(offset)
    const yesterday = D.dateKeyForOffset(offset, -1)
    assert.match(today, /^\d{4}-\d{2}-\d{2}$/)
    assert.equal(
      Date.parse(today) - Date.parse(yesterday),
      86_400_000,
      `${offset || '设备时区'} 的昨天必须恰好相差一天`,
    )
  }
  assert.equal(D.todayKeyFor('+08:00'), D.dateKeyForOffset('+08:00', 0))
  assert.match(D.dateKeyForOffset('bad-offset', 1), /^\d{4}-\d{2}-\d{2}$/)

  /* 固定 UTC 00:30：+14 已是当天 14:30，-12 仍是前一天 12:30 */
  const realNow = Date.now
  try {
    Date.now = () => Date.UTC(2026, 0, 1, 0, 30)
    assert.equal(D.todayKeyFor('+14:00'), '2026-01-01')
    assert.equal(D.todayKeyFor('-12:00'), '2025-12-31')
    assert.equal(D.dateKeyForOffset('+25:00'), D.todayKeyFor(''))
  } finally {
    Date.now = realNow
  }
})

test('缺失字段：统一显示「—」，不伪造 0 值', async () => {
  const P = await load('subpackages/weather/lib/qweather/parse.ts')

  const emptyCurrent = P.parseCurrentV1({})
  assert.equal(emptyCurrent.tempText, '—')
  assert.equal(emptyCurrent.feelsLikeText, '—')
  assert.equal(emptyCurrent.gustText, '—')
  assert.equal(emptyCurrent.precipText, '—')
  assert.equal(emptyCurrent.precipIntensityText, '—')
  assert.equal(emptyCurrent.pressureText, '—')
  assert.equal(emptyCurrent.visibilityText, '—')
  assert.equal(emptyCurrent.dewPointText, '—')
  assert.equal(emptyCurrent.wind.text, '—')
  assert.equal(emptyCurrent.wind.heroText, '—')

  /* null / 空串同样是缺失值，不能被 Number() 转成 0 */
  const nullCurrent = P.parseCurrentV1({
    temperature: { value: null, unit: '°C' },
    pressure: { value: '', unit: 'hPa' },
    wind: { speed: { value: null, unit: 'm/s' } },
  })
  assert.equal(nullCurrent.tempText, '—')
  assert.equal(nullCurrent.pressureText, '—')
  assert.equal(nullCurrent.wind.text, '—')

  const nullHour = P.parseHourlyV7({ hourly: [{ fxTime: '2026-01-01T11:00+08:00', temp: null, humidity: null }] })[0]
  assert.equal(nullHour.tempText, '—')
  assert.equal(nullHour.humidityText, '—')

  const emptyHour = P.parseHourlyV1({ hours: [{}] })[0]
  assert.equal(emptyHour.hourText, '—')
  assert.equal(emptyHour.precipText, '—')
  assert.equal(emptyHour.gustText, '—')
  assert.equal(emptyHour.pressureText, '—')

  const dailyV7 = P.parseDailyV7({
    daily: [{ fxDate: '2026-01-01', tempMax: '18', tempMin: '3', pop: '40' }],
  })[0]
  assert.equal(dailyV7.popText, '40%', 'v7 daily 必须读取 pop')
  assert.equal(dailyV7.precipText, '—', 'v7 缺失降水时不得显示 0.0 mm')

  const emptyMinutely = P.parseMinutely({})
  assert.equal(emptyMinutely.summary, '暂无分钟级降水数据')
  assert.equal(emptyMinutely.typeText, '暂无数据')
  assert.equal(emptyMinutely.peakTimeText, '—')

  const ice = P.parseMinutely({
    minutely: [{ fxTime: '2026-01-01T10:35+08:00', precip: '0.1', type: 'ice' }],
  })
  assert.equal(ice.typeText, '冰粒 / 冻雨')
})

test('凭据：config-local 存在且 JWT 结构合法、有效期不超过 24 小时', () => {
  const file = path.join(ROOT, 'subpackages/weather/config-local.ts')
  assert.ok(fs.existsSync(file), '缺少 config-local.ts（应先运行 ensure 脚本）')
  const source = fs.readFileSync(file, 'utf8')
  const host = /QWEATHER_HOST = '([^']+)'/.exec(source)
  const token = /QWEATHER_TOKEN = '([^']*)'/.exec(source)
  const apiKey = /QWEATHER_API_KEY = '([^']*)'/.exec(source)
  assert.ok(host && host[1], 'API Host 为空')
  assert.ok(token && apiKey, '缺少 Token / API KEY 字段')
  /* CI 与首次检出使用 config.example.ts 的占位配置，不要求真实凭据落库；有凭据时再校验结构 */
  if (!token[1] && !apiKey[1]) {
    return
  }

  if (token[1]) {
    const parts = token[1].split('.')
    assert.equal(parts.length, 3, 'JWT 必须为三段')
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    assert.equal(header.alg, 'EdDSA')
    assert.ok(header.kid, 'JWT 缺少 kid')
    assert.ok(payload.iss && payload.sub, 'JWT 缺少 iss / sub')
    assert.ok(Number.isFinite(payload.iat) && Number.isFinite(payload.exp))
    assert.equal(payload.exp - payload.iat, 86400, 'JWT 有效期必须为 24 小时')
    assert.ok(payload.exp * 1000 > Date.now(), 'JWT 已过期，请运行 npm run qweather:token')
  }
})

test('页面契约：路由、组件、注册表与工作流全部接入', async () => {
  const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'))
  const weather = app.subpackages.find((item) => item.root === 'subpackages/weather')
  assert.ok(weather, 'app.json 缺少 weather 分包')
  assert.ok(weather.pages.includes('pages/home/index'))

  const pageDir = path.join(ROOT, 'subpackages/weather/pages/home')
  for (const ext of ['.ts', '.json', '.wxml', '.wxss']) {
    assert.ok(fs.existsSync(`${pageDir}/index${ext}`), `缺少 index${ext}`)
  }
  const pageJson = JSON.parse(fs.readFileSync(`${pageDir}/index.json`, 'utf8'))
  assert.ok(pageJson.usingComponents['qw-screen'], '页面缺少主屏组件 qw-screen')

  const screenDir = path.join(ROOT, 'subpackages/weather/components/qw-screen')
  const screenJson = JSON.parse(fs.readFileSync(`${screenDir}/index.json`, 'utf8'))
  for (const name of [
    'qw-hero',
    'qw-minutely',
    'qw-alerts',
    'qw-hourly',
    'qw-daily',
    'qw-air',
    'qw-indices',
    'qw-astronomy',
    'qw-history',
    'qw-city-sheet',
    'qw-api-sheet',
  ]) {
    assert.ok(screenJson.usingComponents[name], `主屏组件缺少 ${name}`)
  }
  assert.ok(fs.statSync(path.join(pageDir, 'index.ts')).size < 24 * 1024)

  const { TOOLS } = await load('core/toolbox/registry.ts')
  const tool = TOOLS.find((item) => item.id === 'qweather')
  assert.ok(tool, 'registry 缺少 qweather')
  assert.equal(tool.route, '/subpackages/weather/pages/home/index')
  assert.ok(tool.draftExcluded, 'qweather 应排除草稿')

  const config = await load('core/workflow/workflowConfig.ts')
  assert.equal(config.WORKFLOW_ROUTING.qweather, 'jump')
  assert.deepEqual(config.WORKFLOW_ACCEPTS.qweather, [])

  const source = fs.readFileSync(path.join(pageDir, 'index.wxml'), 'utf8')
  assert.match(source, /workflow-receiver tool-id="qweather"/)
  assert.match(source, /workflow-panel/)
  assert.match(source, /<update-guard/)
})
