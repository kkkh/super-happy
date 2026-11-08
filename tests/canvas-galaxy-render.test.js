/* ==========================================================================
   Canvas Galaxy 渲染层 · 专项单元测试
   - 文字 AABB 防重叠：重叠只画一个，拉开距离都画
   - 文字越界裁剪：超出 Canvas 边缘不画
   - 双主题：白昼黑字 + 白描边，夜航白字 + 暗描边
   - 降级模式：完全不画文字
   - 相机平移出界：文字跟随裁剪
   - 最小排斥距离：30 < 40 时被推开
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
    if (specifier.startsWith('.') && !path.extname(specifier)) {
      try {
        return nextResolve(`${specifier}.ts`, context)
      } catch {
        /* 非 TS 模块回退 */
      }
    }
    return nextResolve(specifier, context)
  },
})

async function loadGalaxy() {
  const module = await import(
    pathToFileURL(path.join(ROOT, 'subpackages/grow/utils/canvasGalaxy.ts')).href
  )
  return module
}

function createTextCtx() {
  const records = []
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    shadowColor: '',
    shadowBlur: 0,
    lineWidth: 1,
    font: '',
    textAlign: '',
    textBaseline: '',
    globalAlpha: 1,
    save() {},
    restore() {},
    clearRect() {},
    setTransform() {},
    translate() {},
    scale() {},
    beginPath() {},
    arc() {},
    fill() {},
    stroke() {},
    fillText(text) {
      records.push({
        text,
        fill: this.fillStyle,
        shadow: this.shadowColor,
        blur: this.shadowBlur,
      })
    },
    measureText(text) {
      return { width: text.length * 8 }
    },
    createRadialGradient() {
      return { addColorStop() {} }
    },
  }
  return { ctx, records }
}

function makeNode(id, label) {
  return {
    id,
    label,
    kind: 'history',
    value: `${label} value`,
    weight: 1,
  }
}

test('Canvas 文字 AABB：完全重叠只绘制一个标签', async () => {
  const { GalaxyEngine } = await loadGalaxy()
  const engine = new GalaxyEngine({ width: 320, height: 240, theme: 'dark' })
  engine.setNodes([makeNode('a', 'alpha'), makeNode('b', 'beta')])
  const [a, b] = engine.getParticles()
  a.x = 0
  a.y = 0
  a.vx = 0
  a.vy = 0
  b.x = 0
  b.y = 0
  b.vx = 0
  b.vy = 0

  const { ctx, records } = createTextCtx()
  engine.draw(ctx)
  assert.equal(records.length, 1, '重叠标签只能保留一个')
})

test('Canvas 文字 AABB：拉开纵向距离后两个标签都绘制', async () => {
  const { GalaxyEngine } = await loadGalaxy()
  const engine = new GalaxyEngine({ width: 320, height: 240, theme: 'dark' })
  engine.setNodes([makeNode('a', 'alpha'), makeNode('b', 'beta')])
  const [a, b] = engine.getParticles()
  a.x = 0
  a.y = 0
  b.x = 0
  b.y = 32
  a.vx = a.vy = b.vx = b.vy = 0

  const { ctx, records } = createTextCtx()
  engine.draw(ctx)
  assert.equal(records.length, 2, '间距足够时不得误杀标签')
})

test('Canvas 文字越界裁剪：贴近右边缘的标签不绘制', async () => {
  const { GalaxyEngine } = await loadGalaxy()
  const engine = new GalaxyEngine({ width: 320, height: 240, theme: 'dark' })
  engine.setNodes([makeNode('edge', 'edge-label')])
  const particle = engine.getParticles()[0]
  particle.x = 150
  particle.y = 0
  particle.vx = particle.vy = 0

  const { ctx, records } = createTextCtx()
  engine.draw(ctx)
  assert.equal(records.length, 0, '文字右边界超出 Canvas 时必须跳过')
})

test('Canvas 双主题：setTheme 实时切换文字色与描边', async () => {
  const { GalaxyEngine } = await loadGalaxy()
  const engine = new GalaxyEngine({ width: 320, height: 240, theme: 'dark' })
  engine.setNodes([makeNode('theme', 'rmb')])
  const particle = engine.getParticles()[0]
  particle.x = 0
  particle.y = 0
  particle.vx = particle.vy = 0

  const dark = createTextCtx()
  engine.draw(dark.ctx)
  assert.equal(dark.records.length, 1)
  assert.equal(dark.records[0].fill, 'rgba(255,255,255,0.9)')
  assert.equal(dark.records[0].shadow, 'rgba(0,0,0,0.65)')
  assert.equal(dark.records[0].blur, 2)

  engine.setTheme('light')
  const light = createTextCtx()
  engine.draw(light.ctx)
  assert.equal(light.records.length, 1)
  assert.equal(light.records[0].fill, 'rgba(0,0,0,0.75)')
  assert.equal(light.records[0].shadow, 'rgba(255,255,255,0.8)')
  assert.equal(light.records[0].blur, 2)
})

test('Canvas 降级模式：跳过所有文字绘制', async () => {
  const { GalaxyEngine } = await loadGalaxy()
  const engine = new GalaxyEngine({ width: 320, height: 240, theme: 'dark' })
  engine.setNodes([makeNode('one', 'one-label')])
  engine.setDegraded(true)

  const { ctx, records } = createTextCtx()
  engine.draw(ctx)
  assert.equal(records.length, 0)
})

test('Canvas 相机平移：文字随星球移出视口后不再绘制', async () => {
  const { GalaxyEngine } = await loadGalaxy()
  const engine = new GalaxyEngine({ width: 320, height: 240, theme: 'dark' })
  engine.setNodes([makeNode('pan', 'panned')])
  const particle = engine.getParticles()[0]
  particle.x = 0
  particle.y = 0
  particle.vx = particle.vy = 0

  const before = createTextCtx()
  engine.draw(before.ctx)
  assert.equal(before.records.length, 1)

  engine.pan(-240, 0)
  const after = createTextCtx()
  engine.draw(after.ctx)
  assert.equal(after.records.length, 0, '平移出界后文字必须被裁剪')
})

test('Canvas 最小排斥距离：30px 间距应被推到 40px 以上', async () => {
  const { GalaxyEngine } = await loadGalaxy()
  const engine = new GalaxyEngine({ width: 320, height: 240 })
  engine.setNodes([makeNode('left', 'L'), makeNode('right', 'R')])
  const [left, right] = engine.getParticles()
  left.x = 0
  left.y = 0
  right.x = 30
  right.y = 0
  left.vx = left.vy = right.vx = right.vy = 0

  const before = Math.abs(right.x - left.x)
  assert.equal(before, 30)
  for (let index = 0; index < 24; index += 1) {
    engine.step(16)
  }
  const after = Math.hypot(right.x - left.x, right.y - left.y)
  assert.ok(after > before, `排斥后间距应变大，实际 ${after}`)
})
