/* ==========================================================================
   环境光主题 + 对比度守护 · 单元测试
   - 纯函数断言：WCAG 对比度、反色策略、大字号阈值
   - 环境光：分类映射、昼夜相位、预设、样式输出
   - 运行：npm test
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')

async function loadEngines() {
  const ambient = await import('../core/theme/ambient-theme.ts')
  const contrast = await import('../core/theme/contrast-guardian.ts')
  return { ambient, contrast }
}

test('对比度：纯黑 / 纯白达到 21:1', async () => {
  const { contrast } = await loadEngines()
  const black = contrast.parseColor('#000000')
  const white = contrast.parseColor('#ffffff')

  assert.ok(black)
  assert.ok(white)
  assert.equal(Math.round(contrast.contrastRatio(black, white)), 21)
})

test('对比度：白字在深灰上不达标时自动反色', async () => {
  const { contrast } = await loadEngines()
  const result = contrast.ensureContrast({
    textColor: '#ffffff',
    backgroundColor: '#888888',
    fontSizePx: 16,
  })

  assert.equal(result.tone, 'inverted')
  assert.ok(result.passes)
  assert.ok(result.ratio >= 4.5)
  assert.match(result.foreground, /0,0,0/)
  assert.match(result.style, /color:/)
  assert.match(result.style, /text-shadow:/)
})

test('对比度：大字号阈值 3:1', async () => {
  const { contrast } = await loadEngines()
  assert.equal(contrast.requiredRatio(24, false), 3)
  assert.equal(contrast.requiredRatio(18.66, true), 3)
  assert.equal(contrast.requiredRatio(16, false), 4.5)
})

test('对比度：透明背景先与画布色合成', async () => {
  const { contrast } = await loadEngines()
  const result = contrast.ensureContrast({
    textColor: '#ffffff',
    backgroundColor: 'rgba(0,0,0,0.5)',
    fontSizePx: 16,
    canvasColor: '#f4f5f1',
  })

  assert.ok(result.passes)
  assert.ok(result.ratio >= result.requiredRatio)
})

test('环境光：media 分类映射暖橙紫', async () => {
  const { ambient } = await loadEngines()
  const state = ambient.resolveAmbientTheme(
    'auto',
    'media',
    new Date(2026, 10, 5, 10, 0, 0),
  )

  assert.equal(state.scene, 'warm')
  assert.equal(state.className, 'sg-ambient-warm')
  assert.match(state.style, /--sg-ambient-a:/)
  assert.match(state.style, /--sg-ambient-intensity:/)
})

test('环境光：深夜相位降低亮度并增加朦胧度', async () => {
  const { ambient } = await loadEngines()
  const day = ambient.resolveAmbientTheme(
    'auto',
    'calc',
    new Date(2026, 10, 5, 12, 0, 0),
  )
  const night = ambient.resolveAmbientTheme(
    'auto',
    'calc',
    new Date(2026, 10, 5, 23, 30, 0),
  )

  assert.ok(night.intensity < day.intensity)
  assert.ok(night.haze > day.haze)
  assert.equal(night.phase, 'night')
})

test('环境光：手动 night 预设覆盖分类', async () => {
  const { ambient } = await loadEngines()
  const state = ambient.resolveAmbientTheme('night', 'media')

  assert.equal(state.scene, 'night')
  assert.equal(state.className, 'sg-ambient-night')
  assert.ok(state.intensity <= 0.5)
})

test('环境光：工具 id 映射 category', async () => {
  const { ambient } = await loadEngines()
  ambient.setAmbientToolCategoryResolver((toolId) => {
    if (toolId === 'qr') {
      return 'media'
    }
    if (toolId === 'wordcount') {
      return 'text'
    }
    return 'home'
  })

  assert.equal(ambient.categoryForTool('qr'), 'media')
  assert.equal(ambient.categoryForTool('wordcount'), 'text')
  assert.equal(ambient.categoryForTool('unknown'), 'home')

  ambient.setAmbientToolCategoryResolver(null)
})

test('环境光引擎：订阅立即收到状态，dispose 清理', async () => {
  const { ambient } = await loadEngines()
  const engine = new ambient.AmbientThemeEngine({
    clockIntervalMs: 15000,
  })
  const seen = []

  const unsubscribe = engine.subscribe((state) => {
    seen.push(state.scene)
  })
  engine.setPreset('mint')
  assert.equal(engine.getState().scene, 'mint')
  assert.deepEqual(seen, ['iris', 'mint'])

  unsubscribe()
  engine.dispose()
  assert.equal(seen.length, 2)
})

test('对比度审计：返回逐项结果与标签', async () => {
  const { contrast } = await loadEngines()
  const entries = contrast.auditContrast([
    {
      label: '主标题',
      textColor: '#ffffff',
      backgroundColor: '#1a2238',
      fontSizePx: 28,
      bold: true,
    },
    {
      label: '辅助文字',
      textColor: '#777777',
      backgroundColor: '#f4f5f1',
      fontSizePx: 16,
    },
  ])

  assert.equal(entries.length, 2)
  assert.equal(entries[0].label, '主标题')
  assert.equal(entries[0].passes, true)
  assert.equal(entries[1].label, '辅助文字')
  assert.ok(entries[1].ratio >= entries[1].requiredRatio)
})
