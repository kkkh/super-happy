/**
 * g-meter · 技能量表（五格填充，重播动画）
 * - replay 键变化时整组量表重新生长（分组切换场景）
 * 用法示例：
 *   <g-meter level="{{item.level}}" tone="iris" replay="{{activeIndex}}" />
 */
Component({
  properties: {
    level: { type: Number, value: 3 },
    tone: { type: String, value: 'iris' },
    /** 重播键：值变化即重启动画 */
    replay: { type: Number, value: 0 },
  },

  data: {
    cells: [1, 2, 3, 4, 5],
    /* 原实现：animKey 仅改 animation-delay，既无法可靠重启，也会让延迟无限累加
       现改为奇偶动画名切换（animation-name 变化才是可靠的重启信号） */
    replayCycle: 0,
  },

  observers: {
    replay() {
      this.setData({ replayCycle: (this.data.replayCycle + 1) % 2 })
    },
  },
})
