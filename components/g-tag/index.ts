/**
 * g-tag · 语义标签（三色调 soft 底 + 描边）
 * 用法示例：
 *   <g-tag tone="iris">Vue</g-tag>
 *   <g-tag tone="amber" solid>净忻</g-tag>
 */
Component({
  properties: {
    tone: { type: String, value: 'iris' },
    /** 实底强调（徽章场景） */
    solid: { type: Boolean, value: false },
  },
})
