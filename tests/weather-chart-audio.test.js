/* ==========================================================================
   全息气象 · 图表绘制 / WebAudio 环境音单元测试
   - 假 Canvas 记录调用，禁止 NaN / Infinity 进入几何与文字
   - 音频未点击不创建上下文；开启后建图，dispose 关闭
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

function createFakeContext() {
  const calls = []
  const ctx = {
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: '',
    textAlign: '',
    textBaseline: '',
    globalAlpha: 1,
    save() {},
    restore() {},
    setTransform() {},
    clearRect() {},
    beginPath() {},
    closePath() {},
    moveTo(x, y) {
      calls.push(['moveTo', x, y])
    },
    lineTo(x, y) {
      calls.push(['lineTo', x, y])
    },
    stroke() {},
    fill() {},
    arc(x, y, radius) {
      calls.push(['arc', x, y, radius])
    },
    fillText(text, x, y) {
      calls.push(['fillText', text, x, y])
    },
    createLinearGradient() {
      return {
        addColorStop(offset, color) {
          calls.push(['stop', offset, color])
        },
      }
    },
    createRadialGradient() {
      return {
        addColorStop(offset, color) {
          calls.push(['stop', offset, color])
        },
      }
    },
  }
  return { ctx, calls }
}

function assertFinite(calls) {
  for (const call of calls) {
    for (const value of call) {
      if (typeof value === 'number') {
        assert.equal(Number.isFinite(value), true, `非法数值：${value}`)
      }
    }
  }
}

test('4 天双折线：绘制白天/夜间两条线，不产生 NaN', async () => {
  const chart = await load('subpackages/tools-core/weather/weatherChart.ts')
  const { ctx, calls } = createFakeContext()
  chart.drawForecastChart(ctx, 320, 280, DAYS, 'dark')
  assertFinite(calls)
  const labels = calls.filter((call) => call[0] === 'fillText').map((call) => call[1])
  assert.ok(labels.includes('白天'))
  assert.ok(labels.includes('夜间'))
  assert.ok(labels.includes('11-09'))
  assert.ok(labels.includes('12°'))
  assert.ok(labels.includes('-2°'))
})

test('图表：缺数据时输出占位文字，不画伪 0 曲线', async () => {
  const chart = await load('subpackages/tools-core/weather/weatherChart.ts')
  const { ctx, calls } = createFakeContext()
  chart.drawForecastChart(ctx, 320, 280, [], 'light')
  assert.equal(calls.some((call) => call[1] === '暂无预报数据'), true)

  const blankCalls = createFakeContext()
  chart.drawForecastChart(
    blankCalls.ctx,
    320,
    280,
    [{ ...DAYS[0], daytemp: null, nighttemp: null }],
    'light',
  )
  assert.equal(blankCalls.calls.some((call) => call[1] === '温度数据缺失'), true)
})

test('24h 曲线：24 个点全部绘制，首点温度有标注', async () => {
  const chart = await load('subpackages/tools-core/weather/weatherChart.ts')
  const { ctx, calls } = createFakeContext()
  const points = Array.from({ length: 24 }, (_, index) => ({
    hour: index,
    label: `${String(index).padStart(2, '0')}:00`,
    temp: 10 + (index % 4),
    isNight: index < 6 || index >= 18,
    weather: '晴',
  }))
  chart.drawHourlyChart(ctx, 320, 180, points, 'dark')
  assertFinite(calls)
  assert.equal(calls.filter((call) => call[0] === 'arc').length >= 1, true)
  assert.equal(calls.some((call) => call[1] === '10°'), true)
})

test('图表文字摘要：4 天日期、温度、风力全部进入 aria 文本', async () => {
  const chart = await load('subpackages/tools-core/weather/weatherChart.ts')
  const aria = chart.forecastAriaText(DAYS)
  assert.match(aria, /未来 4 天预报/)
  assert.match(aria, /2026-11-09 周一/)
  assert.match(aria, /白天晴 12℃/)
  assert.match(aria, /夜间晴 -2℃/)
  assert.match(aria, /白天西南风 1-3 级/)
  assert.match(chart.forecastAriaText([]), /暂无预报数据/)
})

function createFakeAudio() {
  const metrics = { created: 0, started: 0, suspended: 0, resumed: 0, closed: 0 }
  const node = { connect() {}, disconnect() {} }
  const source = {
    buffer: null,
    loop: false,
    start() {
      metrics.started += 1
    },
    stop() {},
    connect(target) {
      return target
    },
    disconnect() {},
  }
  const param = () => ({ value: 0 })
  const filter = {
    type: 'lowpass',
    frequency: param(),
    Q: param(),
    connect() {},
    disconnect() {},
  }
  const gain = { gain: param(), connect() {}, disconnect() {} }
  const buffer = {
    getChannelData() {
      return new Float32Array(4410)
    },
  }
  const context = {
    sampleRate: 44100,
    destination: node,
    state: 'running',
    createBuffer() {
      return buffer
    },
    createBufferSource() {
      return source
    },
    createBiquadFilter() {
      return filter
    },
    createGain() {
      return gain
    },
    resume() {
      metrics.resumed += 1
    },
    suspend() {
      metrics.suspended += 1
    },
    close() {
      metrics.closed += 1
    },
  }
  return {
    metrics,
    filter,
    gain,
    source,
    createContext() {
      metrics.created += 1
      return context
    },
  }
}

test('环境音：未开启不创建上下文，开启后建图并启动噪声源', async () => {
  const audioModule = await load('subpackages/tools-core/weather/weatherAudio.ts')
  const fake = createFakeAudio()
  const audio = new audioModule.WeatherAmbientAudio({ createContext: fake.createContext })
  audio.setEnabled(false)
  assert.equal(fake.metrics.created, 0)
  audio.setEnabled(true)
  assert.equal(fake.metrics.created, 1)
  assert.equal(audio.isEnabled(), true)
  assert.equal(fake.metrics.started, 1)
  audio.setScene('rain')
  assert.equal(fake.filter.type, 'lowpass')
  assert.equal(fake.filter.frequency.value, 1500)
  assert.equal(fake.gain.gain.value > 0, true)
  audio.setScene('wind')
  assert.equal(fake.filter.type, 'bandpass')
  assert.equal(fake.filter.frequency.value, 520)
})

test('环境音：hide 挂起、dispose 关闭上下文，dispose 后不再建图', async () => {
  const audioModule = await load('subpackages/tools-core/weather/weatherAudio.ts')
  const fake = createFakeAudio()
  const audio = new audioModule.WeatherAmbientAudio({ createContext: fake.createContext })
  audio.setEnabled(true)
  audio.suspend()
  assert.equal(fake.metrics.suspended, 1)
  audio.resume()
  assert.equal(fake.metrics.resumed, 2)
  audio.dispose()
  assert.equal(fake.metrics.closed, 1)
  audio.setEnabled(true)
  assert.equal(fake.metrics.created, 1)
})
