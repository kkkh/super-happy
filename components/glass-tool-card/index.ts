/* ==========================================================================
   glass-tool-card · 工具页统一玻璃卡片
   - 三种语义：input（输入区）/ result（结果区）/ note（说明区）
   - 统一承接标题行、内容区、结果空态、底部动作
   - 内部只使用 glass-card 与 --glass-* / --sg-* 令牌
   ========================================================================== */
Component({
  options: {
    multipleSlots: true,
    styleIsolation: 'isolated',
    addGlobalClass: true,
  },

  properties: {
    variant: { type: String, value: 'input' },
    label: { type: String, value: '' },
    code: { type: String, value: '' },
    hasResult: { type: Boolean, value: false },
    emptyTitle: { type: String, value: '输入内容后，结果会显示在这里' },
    emptySub: { type: String, value: '所有计算只在本机完成' },
    showActions: { type: Boolean, value: false },
    tone: { type: String, value: '' },
    depth: { type: String, value: '' },
  },

  data: {
    isResult: false,
    cardTone: 'neutral',
    cardDepth: 'soft',
  },

  observers: {
    'variant, tone, depth'(variant: string, tone: string, depth: string) {
      const isResult = variant === 'result'
      const fallbackTone = isResult ? 'iris' : variant === 'note' ? 'amber' : 'neutral'
      this.setData({
        isResult,
        cardTone: tone || fallbackTone,
        cardDepth: depth || (isResult ? 'deep' : 'soft'),
      })
    },
  },

  lifetimes: {
    attached() {
      const variant = this.data.variant
      const isResult = variant === 'result'
      const fallbackTone = isResult ? 'iris' : variant === 'note' ? 'amber' : 'neutral'
      this.setData({
        isResult,
        cardTone: this.data.tone || fallbackTone,
        cardDepth: this.data.depth || (isResult ? 'deep' : 'soft'),
      })
    },
  },
})
