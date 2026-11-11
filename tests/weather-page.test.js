/* ==========================================================================
   全息气象 · 页面静态契约回归
   - 官方字段一个不少；禁用字段一个不多
   - 生命周期彻底清理；双 Canvas 几何与 DPR 复位
   - 诚实的预警 / AQI 降级；Key 不进仓库、不进日志
   - 运行：npm test
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const PAGE = 'subpackages/tools-core/pages/weather/index'
const SERVICE = 'subpackages/tools-core/weather/weatherService.ts'
const CONFIG = 'subpackages/tools-core/weather/config.ts'
const CACHE = 'subpackages/tools-core/weather/weatherCache.ts'
const AUDIO = 'subpackages/tools-core/weather/weatherAudio.ts'

test('注册表：weather 已注册，路由真实存在', () => {
  const registry = read('core/toolbox/registry.ts')
  assert.match(registry, /id: 'weather'/)
  assert.match(registry, /route: '\/subpackages\/tools-core\/pages\/weather\/index'/)
  assert.match(registry, /name: '全息气象'/)
  const app = JSON.parse(read('app.json'))
  const toolsCore = app.subpackages.find((item) => item.root === 'subpackages/tools-core')
  assert.ok(toolsCore)
  assert.ok(toolsCore.pages.includes('pages/weather/index'))
  for (const ext of ['.ts', '.json', '.wxml', '.wxss']) {
    assert.ok(fs.existsSync(path.join(ROOT, `${PAGE}${ext}`)), `缺少 ${PAGE}${ext}`)
  }
})

test('定位：只声明 getFuzzyLocation，不申请精确 GPS', () => {
  const app = JSON.parse(read('app.json'))
  assert.deepEqual(app.requiredPrivateInfos, ['getFuzzyLocation'])
  assert.match(app.permission['scope.userFuzzyLocation'].desc, /定位当前城市/)
  const page = read(`${PAGE}.ts`)
  const wxml = read(`${PAGE}.wxml`)
  const location = read('subpackages/tools-core/weather/weatherLocation.ts')
  assert.match(location, /getFuzzyLocation/)
  assert.equal(location.includes('wx.getLocation'), false)
  assert.match(page, /locateByIp/)
  assert.match(location, /局域网/)
  assert.match(location, /ensurePrivacyAuthorized/)
  /* 未申请 / 已拒绝必须有明确引导，而不是静默走 IP */
  assert.match(location, /readFuzzyLocationPermission/)
  assert.match(location, /scope\.userFuzzyLocation/)
  assert.match(page, /beginLocationFlow/)
  assert.match(page, /openLocationPrompt/)
  assert.match(page, /wx\.openSetting/)
  assert.match(wxml, /onUseCurrentLocation/)
  assert.match(wxml, /glass-modal/)
  assert.match(read(`${PAGE}.json`), /glass-modal/)
})

test('实况模板：9 个官方字段全部展示，禁用字段一个不多', () => {
  const wxml = read(`${PAGE}.wxml`)
  for (const field of [
    'cityName',
    'province',
    'adcode',
    'weatherName',
    'temperatureText',
    'winddirection',
    'windpower',
    'humidityText',
    'reporttimeText',
  ]) {
    assert.ok(wxml.includes(`{{${field}`), `实况字段未渲染：${field}`)
  }
  for (const forbidden of ['气压', '能见度', 'PM2.5', 'PM10', 'pm2.5', 'pm10', 'pressure', 'visibility']) {
    assert.equal(wxml.includes(forbidden), false, `出现了禁用字段：${forbidden}`)
  }
})

test('预报模板：4 天 10 个官方字段全部展示，无 7 天 / 逐小时实况', () => {
  const wxml = read(`${PAGE}.wxml`)
  for (const field of [
    'item.date',
    'item.weekLabel',
    'item.dayweather',
    'item.nightweather',
    'item.daytempText',
    'item.nighttempText',
    'item.daywind',
    'item.nightwind',
    'item.daypower',
    'item.nightpower',
  ]) {
    assert.ok(wxml.includes(`{{${field}`), `预报字段未渲染：${field}`)
  }
  assert.equal(wxml.includes('7 天'), false)
  assert.match(wxml, /不是逐小时实况/)
})

test('诚实降级：预警不是“暂无”，AQI 明确标准 API 不含', () => {
  const wxml = read(`${PAGE}.wxml`)
  const page = read(`${PAGE}.ts`)
  const text = wxml + page
  assert.equal(text.includes('暂无气象预警'), false)
  assert.ok(text.includes('预警数据未接入，请以官方发布为准'))
  assert.ok(text.includes('标准天气 API 不含该数据'))
  assert.ok(text.includes('高级能力需商务咨询'))
})

test('生命周期：onHide 中止请求 / 停动画 / 挂起音频，onUnload 彻底释放', () => {
  const ts = read(`${PAGE}.ts`)
  assert.equal(ts.includes('setInterval'), false)
  assert.match(ts, /abortRequests/)
  assert.match(ts, /fx\.stop\(\)/)
  assert.match(ts, /fx\.dispose\(\)/)
  assert.match(ts, /audio\.suspend\(\)/)
  assert.match(ts, /audio\.dispose\(\)/)
  assert.match(ts, /offNetworkStatusChange/)
  assert.match(ts, /offAudioInterruption/)
  assert.match(ts, /offWindowResize/)
  assert.match(ts, /destroyStoreBindings/)
  assert.match(ts, /runtime\.reactions/)
})

test('Canvas：双画布、DPR 复位、无 setInterval、无 backdrop-filter', () => {
  const ts = read(`${PAGE}.ts`)
  const wxml = read(`${PAGE}.wxml`)
  const wxss = read(`${PAGE}.wxss`)
  assert.match(wxml, /id="weather-fx"/)
  assert.match(wxml, /id="weather-chart"/)
  assert.match(wxml, /id="weather-hourly"/)
  assert.match(ts, /setTransform/)
  assert.match(ts, /type: '2d'|getContext\('2d'\)/)
  assert.match(ts, /pixelRatio/)
  assert.equal(wxss.includes('backdrop-filter:'), false)
  assert.match(wxss, /\.weather-fx[\s\S]*pointer-events: none/)
  assert.match(wxss, /@media \(prefers-reduced-motion: reduce\)/)
  assert.match(wxss, /\.weather-page--low/)
})

test('手势：横滑切城市、双击回定位、5 击诊断有仲裁窗口', () => {
  const ts = read(`${PAGE}.ts`)
  assert.match(ts, /Math\.abs\(dx\) > 60/)
  assert.match(ts, /Math\.abs\(dx\) > Math\.abs\(dy\) \* 1\.5/)
  assert.match(ts, /runtime\.tapCount >= 5/)
  assert.match(ts, /350/)
  assert.match(ts, /2500/)
  assert.match(ts, /locateCurrent/)
})

test('缓存：实况 15min / 预报 30min / 负缓存 60s / 城市 5 个 / 手动刷新 60s', () => {
  const cache = read(CACHE)
  assert.match(cache, /LIVE_TTL_MS = 15 \* 60 \* 1000/)
  assert.match(cache, /FORECAST_TTL_MS = 30 \* 60 \* 1000/)
  assert.match(cache, /NEGATIVE_TTL_MS = 60 \* 1000/)
  assert.match(cache, /MANUAL_REFRESH_CD_MS = 60 \* 1000/)
  assert.match(cache, /MAX_CITIES = 5/)
  const page = read(`${PAGE}.ts`)
  assert.match(page, /readManualRefreshAt/)
  assert.match(read(`${PAGE}.wxml`), /refresher-enabled/)
  assert.match(read(`${PAGE}.wxml`), /bindrefresherrefresh="onRefresherRefresh"/)
})

test('错误码：10009 平台不符、10003 日限、10004 过频均有明确指引', () => {
  const diag = read('subpackages/tools-core/weather/weatherDiagnostics.ts')
  for (const code of ['10001', '10003', '10004', '10005', '10006', '10009', '10010', '10044']) {
    assert.ok(diag.includes(`'${code}'`), `错误码缺失：${code}`)
  }
  assert.match(diag, /Web服务/)
  const page = read(`${PAGE}.ts`)
  assert.match(page, /Key 平台不符/)
  assert.match(page, /今日天气额度已用完/)
  assert.match(page, /请求过于频繁/)
})

test('Key：只在 Web服务 URL、不进页面、不写仓库、诊断脱敏', () => {
  const service = read(SERVICE)
  assert.match(service, /https:\/\/restapi\.amap\.com/)
  assert.equal(/jscode=/.test(service), false)
  assert.match(service, /maskedKey/)
  const config = read(CONFIG)
  assert.equal(/d8e6385ec5c4d488bdad11fb1480e6bb/.test(config), false)
  assert.ok(read('.gitignore').includes('subpackages/tools-core/weather/config.local.ts'))
  const example = read('subpackages/tools-core/weather/config.example.ts')
  assert.match(example, /AMAP_WEB_SERVICE_KEY = ''/)
  const page = read(`${PAGE}.ts`)
  assert.equal(/d8e6385ec5c4d488bdad11fb1480e6bb/.test(page), false)
  const diag = read('subpackages/tools-core/weather/weatherDiagnostics.ts')
  assert.match(diag, /Key 完整值/)
})

test('环境音：WebAudio 合成、用户手势开启、hide 挂起、unload 关闭', () => {
  const audio = read(AUDIO)
  assert.match(audio, /createBuffer/)
  assert.match(audio, /createBiquadFilter/)
  assert.match(audio, /setEnabled/)
  assert.match(audio, /suspend/)
  assert.match(audio, /dispose/)
  const page = read(`${PAGE}.ts`)
  assert.match(page, /onToggleAmbient/)
  assert.match(page, /ambientSceneFor/)
  assert.match(read(`${PAGE}.wxml`), /bindchange="onToggleAmbient"/)
})

test('图表：4 天双折线 + 24h 推算 + 文字摘要，图表本身 aria-hidden', () => {
  const chart = read('subpackages/tools-core/weather/weatherChart.ts')
  assert.match(chart, /drawForecastChart/)
  assert.match(chart, /drawHourlyChart/)
  assert.match(chart, /forecastAriaText/)
  assert.match(chart, /daytemp/)
  assert.match(chart, /nighttemp/)
  const wxml = read(`${PAGE}.wxml`)
  assert.match(wxml, /aria-hidden="true"/)
  assert.match(wxml, /aria-label="{{chartAria}}"/)
  assert.match(wxml, /aria-label="{{hourlyAria}}"/)
})

test('流转：自定义页必须有 receiver + panel，并暴露天气摘要来源', () => {
  const wxml = read(`${PAGE}.wxml`)
  assert.match(wxml, /<workflow-receiver tool-id="weather" \/>/)
  assert.match(wxml, /<workflow-panel/)
  assert.match(read(`${PAGE}.ts`), /weatherSummary/)
  assert.match(
    read('core/workflow/workflowSource.ts'),
    /weather:\s*\{[^}]*'weatherSummary'[^}]*'weatherText'/,
  )
  assert.match(read('core/workflow/workflowConfig.ts'), /weather: 'jump'/)
  assert.match(read('core/workflow/workflowConfig.ts'), /weather: \[\]/)
})

test('页面 json：使用组件路径真实存在，禁用页面滚动交给 scroll-view', () => {
  const json = JSON.parse(read(`${PAGE}.json`))
  assert.equal(json.disableScroll, true)
  for (const [name, componentPath] of Object.entries(json.usingComponents)) {
    const normalized = componentPath.startsWith('/')
      ? componentPath.slice(1)
      : path.join(path.dirname(`${PAGE}.json`), componentPath)
    for (const ext of ['.ts', '.json', '.wxml']) {
      assert.ok(fs.existsSync(path.join(ROOT, `${normalized}${ext}`)), `${name} 缺少 ${ext}`)
    }
  }
  assert.ok(json.usingComponents['weather-glyph'])
  assert.ok(json.usingComponents['workflow-receiver'])
  assert.ok(json.usingComponents['workflow-panel'])
  assert.ok(json.usingComponents['g-icon'])
})

test('胶囊安全区：运行时读取胶囊 top / height / left，并注入内联安全距离', () => {
  const ts = read(`${PAGE}.ts`)
  assert.match(ts, /wx\.getMenuButtonBoundingClientRect/)
  assert.match(ts, /getWindowInfo/)
  assert.match(ts, /navTopPx/)
  assert.match(ts, /navRowHeightPx/)
  assert.match(ts, /navRightInsetPx/)
  assert.match(ts, /capsuleHeight \+ 8/)
  assert.match(ts, /windowWidth - capsuleLeft \+ 8/)
  assert.match(ts, /measureNavBar/)
  assert.match(ts, /onWindowResize/)

  const wxml = read(`${PAGE}.wxml`)
  assert.match(wxml, /class="weather-nav" style="padding-top: {{navTopPx}}px;"/)
  assert.match(wxml, /class="weather-nav__row" style="height: {{navRowHeightPx}}px;"/)
  assert.match(wxml, /class="weather-nav__actions" style="right: {{navRightInsetPx}}px;"/)
  assert.match(wxml, /aria-label="城市管理"/)
  assert.match(wxml, /<g-icon name="pin"/)

  const wxss = read(`${PAGE}.wxss`)
  assert.equal(wxss.includes('padding-top: var(--glass-safe-top)'), false)
  assert.equal(wxss.includes('height: 96rpx;'), false)
  assert.match(wxss, /justify-content: flex-start/)
})

test('天气图标：标准 SVG 双主题资产，禁止 border / rotate 拼几何', () => {
  const glyphRoot = 'subpackages/tools-core/components/weather-glyph'
  const wxml = read(`${glyphRoot}/index.wxml`)
  assert.match(wxml, /<image/)
  assert.match(wxml, /src="{{iconSrc}}"/)
  assert.match(wxml, /mode="aspectFit"/)

  const ts = read(`${glyphRoot}/index.ts`)
  assert.match(ts, /\$\{safeTone\}\/\$\{safeFamily\}\.svg/)
  assert.match(ts, /clearNight/)
  assert.match(ts, /partlyNight/)
  assert.match(ts, /night: true|night: {/)
  assert.match(ts, /FAMILIES/)

  const wxss = read(`${glyphRoot}/index.wxss`)
  assert.equal(wxss.includes('border-radius'), false)
  assert.equal(wxss.includes('rotate'), false)
  assert.equal(wxss.includes('box-shadow'), false)

  const families = [
    'clear',
    'clearNight',
    'partly',
    'partlyNight',
    'cloudy',
    'overcast',
    'wind',
    'haze',
    'rain',
    'heavyRain',
    'thunder',
    'snow',
    'sleet',
    'dust',
    'fog',
    'tornado',
    'hot',
    'cold',
    'unknown',
  ]
  for (const tone of ['dark', 'light']) {
    for (const family of families) {
      const icon = read(`${glyphRoot}/icons/${tone}/${family}.svg`)
      assert.match(icon, /viewBox="0 0 64 64"/)
      assert.match(icon, /stroke-linecap="round"/)
      assert.match(icon, /stroke-linejoin="round"/)
      assert.equal(icon.includes('<style'), false)
      assert.equal(icon.includes('%'), false)
    }
  }
})
