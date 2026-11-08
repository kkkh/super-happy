/**
 * g-placeholder · 图片占位材质（素材缺失 / 加载失败时的优雅回退）
 * - 三色渐变球 + 网格纹理 + 字形徽记
 * 用法示例：
 *   <g-placeholder title="外卖总台" tone="aurora" glyph="grid" />
 */
import type { Tone } from '../../../../core/types/index'

interface PlaceholderData {
  phA: string
  phB: string
}

const TONE_VARS: Record<Tone, { a: string; b: string }> = {
  iris: { a: 'var(--g-ph-iris-a)', b: 'var(--g-ph-iris-b)' },
  aurora: { a: 'var(--g-ph-aurora-a)', b: 'var(--g-ph-aurora-b)' },
  amber: { a: 'var(--g-ph-amber-a)', b: 'var(--g-ph-amber-b)' },
}

Component({
  properties: {
    title: { type: String, value: '' },
    tone: { type: String, value: 'iris' },
    glyph: { type: String, value: 'image' },
  },

  data: {
    phA: 'var(--g-ph-iris-a)',
    phB: 'var(--g-ph-iris-b)',
  } as PlaceholderData,

  observers: {
    tone(value: string) {
      const conf = TONE_VARS[(value as Tone)] ?? TONE_VARS.iris
      this.setData({ phA: conf.a, phB: conf.b })
    },
  },
})
