/* ==========================================================================
   focus-nebula · 同 seed 确定性 / 枯萎 / 低置信度 / Canvas 绘制
   - 运行：npm test
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
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
        /* 非 TS 模块回退原始路径 */
      }
    }
    return nextResolve(specifier, context)
  },
})

async function loadNebula() {
  return import(pathToFileURL(path.join(ROOT, 'subpackages/life/lib/focus-nebula.ts')).href)
}

function mockContext() {
  const calls = {
    cleared: 0,
    gradients: [],
    arcs: [],
    fills: 0,
    fillStyles: [],
  }
  const ctx = {
    globalAlpha: 1,
    fillStyle: '',
    clearRect() {
      calls.cleared += 1
    },
    createRadialGradient() {
      const gradient = {
        stops: [],
        addColorStop(offset, color) {
          this.stops.push([offset, color])
        },
      }
      calls.gradients.push(gradient)
      return gradient
    },
    beginPath() {},
    arc(x, y, radius) {
      calls.arcs.push({ x, y, radius })
    },
    fill() {
      calls.fills += 1
      if (typeof ctx.fillStyle === 'string') {
        calls.fillStyles.push(ctx.fillStyle)
      }
    },
  }
  return { ctx, calls }
}

test('星云：同 seed 完全可复现，不同 seed 不同', async () => {
  const nebula = await loadNebula()
  const first = nebula.createNebulaScene(123456)
  const second = nebula.createNebulaScene(123456)
  assert.deepEqual(first, second)
  assert.equal(first.points.length, 60)
  assert.equal(first.width, 750)
  assert.equal(first.height, 1000)
  assert.equal(first.core.x, 0.5)
  assert.equal(first.core.y, 0.42)

  const other = nebula.createNebulaScene(654321)
  assert.notDeepEqual(first.points, other.points)
  assert.equal(other.points.length, 60)
})

test('星云：坐标 / alpha / 半径全部在合法范围，数量可裁剪', async () => {
  const nebula = await loadNebula()
  const scene = nebula.createNebulaScene(7)
  for (const point of scene.points) {
    assert.ok(point.x >= 0 && point.x <= 1)
    assert.ok(point.y >= 0 && point.y <= 1)
    assert.ok(point.alpha >= 0 && point.alpha <= 1)
    assert.ok(point.r > 0)
    assert.ok([0, 1, 2].includes(point.colorIndex))
  }
  assert.equal(nebula.createNebulaScene(7, { starCount: 12 }).points.length, 12)
  assert.equal(nebula.createNebulaScene(7, { starCount: 0 }).points.length, 0)
  assert.equal(nebula.createNebulaScene(7, { starCount: 80 }).points.length, 60)
  assert.equal(nebula.createNebulaScene(7, { width: 600, height: 800 }).width, 600)
})

test('星云：tainted 枯萎 → 去光晕、danger 色、低透明度', async () => {
  const nebula = await loadNebula()
  const normal = nebula.createNebulaScene(99)
  const withered = nebula.createNebulaScene(99, { tainted: true })
  assert.equal(withered.tainted, true)
  assert.ok(withered.core.alpha < normal.core.alpha)
  assert.ok(withered.points[0].alpha < normal.points[0].alpha)

  const { ctx, calls } = mockContext()
  nebula.renderNebulaScene(ctx, withered)
  assert.equal(calls.gradients.length, 0, '枯萎态不画核心光晕')
  assert.equal(calls.arcs.length, 60)
  assert.ok(calls.fillStyles.every((color) => color.startsWith('rgba(255,122,99,')))
})

test('星云：confidence=low 降低透明度和核心亮度', async () => {
  const nebula = await loadNebula()
  const high = nebula.createNebulaScene(42)
  const low = nebula.createNebulaScene(42, { confidence: 'low' })
  assert.equal(low.confidence, 'low')
  assert.ok(low.core.alpha < high.core.alpha)
  assert.ok(low.points[0].alpha < high.points[0].alpha)
  assert.ok(low.points[1].alpha < high.points[1].alpha)
})

test('星云：正常绘制 = clear + 光晕 + 60 星点', async () => {
  const nebula = await loadNebula()
  const scene = nebula.createNebulaScene(2026)
  const { ctx, calls } = mockContext()
  nebula.renderNebulaScene(ctx, scene)
  assert.equal(calls.cleared, 1)
  assert.equal(calls.gradients.length, 1)
  assert.equal(calls.gradients[0].stops.length, 3)
  assert.ok(calls.gradients[0].stops[2][1].endsWith(',0)'))
  assert.equal(calls.arcs.length, 61, '1 个核心 + 60 个星点')
  assert.equal(calls.fills, 61)
  assert.equal(ctx.globalAlpha, 1)
})

test('hexToRgba：合法 / 非法 / alpha 钳制', async () => {
  const nebula = await loadNebula()
  assert.equal(nebula.hexToRgba('#8f9bff', 0.5), 'rgba(143,155,255,0.5)')
  assert.equal(nebula.hexToRgba('#000000', 1), 'rgba(0,0,0,1)')
  assert.equal(nebula.hexToRgba('#fff', 1), 'rgba(143,155,255,1)')
  assert.equal(nebula.hexToRgba('red', 2), 'rgba(143,155,255,1)')
  assert.equal(nebula.hexToRgba('#ffffff', -1), 'rgba(255,255,255,0)')
})

test('星云摘要：正常 / 低置信度 / 枯萎', async () => {
  const nebula = await loadNebula()
  assert.equal(nebula.nebulaSummary(nebula.createNebulaScene(1)), '星云已生成')
  assert.equal(
    nebula.nebulaSummary(nebula.createNebulaScene(1, { confidence: 'low' })),
    '星云已生成 · 记录置信度较低',
  )
  assert.equal(
    nebula.nebulaSummary(nebula.createNebulaScene(1, { tainted: true })),
    '本机记录校验失败，本次星云已枯萎',
  )
})
