/* ==========================================================================
   cockpit-chart · Canvas 绘制与主题/光效回归
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { registerHooks } = require('node:module')

const ROOT = path.resolve(__dirname, '..')

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !path.extname(specifier)) {
      try {
        return nextResolve(`${specifier}.ts`, context)
      } catch {
        /* 不是 TS 模块时回退原始路径 */
      }
    }
    return nextResolve(specifier, context)
  },
})

function moduleUrl(relative) {
  return pathToFileURL(path.join(ROOT, relative)).href
}

function makeCtx() {
  const texts = []
  const shadowBlurValues = []
  let shadowBlur = 0
  const gradient = { addColorStop() {} }
  const ctx = {
    save() {},
    restore() {},
    scale() {},
    clearRect() {},
    beginPath() {},
    closePath() {},
    arc() {},
    moveTo() {},
    lineTo() {},
    fill() {},
    stroke() {},
    fillText(text) {
      texts.push(String(text))
    },
    measureText() {
      return { width: 0 }
    },
    createLinearGradient() {
      return gradient
    },
    createRadialGradient() {
      return gradient
    },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineJoin: '',
    font: '',
    textAlign: '',
    textBaseline: '',
    shadowColor: '',
    globalAlpha: 1,
    get shadowBlur() {
      return shadowBlur
    },
    set shadowBlur(value) {
      shadowBlur = value
      shadowBlurValues.push(value)
    },
  }
  return { ctx, texts, shadowBlurValues }
}

const slices = [
  { code: 'calc', label: '计算换算', value: 3, percent: 0.3 },
  { code: 'date', label: '日期时间', value: 2, percent: 0.2 },
  { code: 'text', label: '文本处理', value: 5, percent: 0.5 },
]
const points = [
  { label: '1/1', value: 0 },
  { label: '1/2', value: 1 },
  { label: '1/3', value: 3 },
  { label: '今天', value: 5 },
]

test('环形图：中心总量、分类文字与主题字体正常绘制', async () => {
  const { drawDonutChart } = await import(moduleUrl('subpackages/grow/lib/cockpit-chart.ts'))
  const { ctx, texts } = makeCtx()
  drawDonutChart(ctx, 320, 200, slices, 10, 1, 'day', false)
  assert.ok(texts.includes('10'))
  assert.ok(texts.includes('条轨迹'))
  assert.ok(ctx.font.includes('SF Pro Display'))
  assert.ok(ctx.font.includes('PingFang SC'))
})

test('环形图：夜航关闭光效后不再设置霓虹阴影', async () => {
  const { drawDonutChart } = await import(moduleUrl('subpackages/grow/lib/cockpit-chart.ts'))

  const glow = makeCtx()
  drawDonutChart(glow.ctx, 320, 200, slices, 10, 1, 'night', true)
  assert.ok(Math.max(...glow.shadowBlurValues) > 0)

  const plain = makeCtx()
  drawDonutChart(plain.ctx, 320, 200, slices, 10, 1, 'night', false)
  assert.equal(Math.max(...plain.shadowBlurValues), 0)
})

test('折线图：全 0 数据也有 0..3 刻度，夜航光效可关闭', async () => {
  const { drawLineChart } = await import(moduleUrl('subpackages/grow/lib/cockpit-chart.ts'))

  const zeroPoints = points.map((point) => ({ label: point.label, value: 0 }))
  const day = makeCtx()
  drawLineChart(day.ctx, 320, 220, zeroPoints, 1, 'day', false)
  assert.ok(day.texts.includes('0'))
  assert.ok(day.texts.includes('3'))
  assert.equal(Math.max(...day.shadowBlurValues), 0)

  const night = makeCtx()
  drawLineChart(night.ctx, 320, 220, points, 1, 'night', true)
  assert.ok(Math.max(...night.shadowBlurValues) > 0)
  assert.ok(night.texts.includes('今天'))
})

test('动画驱动：progress 从 0 走向 1，cancel 后不再回调', async () => {
  const { animateChart } = await import(moduleUrl('subpackages/grow/lib/cockpit-chart.ts'))
  const frames = []
  const animator = animateChart(null, 40, (progress) => frames.push(progress))
  await new Promise((resolve) => setTimeout(resolve, 90))
  animator.cancel()
  assert.ok(frames.length >= 2)
  assert.equal(frames[frames.length - 1], 1)

  const cancelled = []
  const second = animateChart(null, 40, (progress) => cancelled.push(progress))
  second.cancel()
  await new Promise((resolve) => setTimeout(resolve, 80))
  assert.equal(cancelled.length, 0)
})

test('调色板：白昼/夜航与 WXSS 变量同源', async () => {
  const fs = require('node:fs')
  const { paletteFor } = await import(moduleUrl('subpackages/grow/lib/cockpit-chart.ts'))
  const wxss = fs.readFileSync(
    path.join(ROOT, 'subpackages/grow/pages/cockpit/index.wxss'),
    'utf8',
  )

  for (const theme of ['day', 'night']) {
    const palette = paletteFor(theme)
    for (const [code, pair] of Object.entries(palette.slices)) {
      const prefix = theme === 'day' ? 'theme-light' : 'theme-dark'
      const block = wxss.slice(wxss.indexOf(`.cockpit-page.${prefix}`))
      const scoped = block.slice(0, block.indexOf('}'))
      assert.ok(scoped.includes(`--chart-${code}-a: ${pair[0].toLowerCase()}`))
      assert.ok(scoped.includes(`--chart-${code}-b: ${pair[1].toLowerCase()}`))
    }
  }
})
