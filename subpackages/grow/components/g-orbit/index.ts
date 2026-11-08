/**
 * g-orbit · 纯 CSS 轨道徽章
 * - 原 Lottie 只服务问候页一个徽章，运行时体积约 212KB；改用 CSS 轨道仪
 * - 双环 + 12 刻度 + 双卫星反向缓行 + 核心呼吸，零 JS 动画循环
 */
Component({
  properties: {
    /** 显示尺寸（rpx），正方形 */
    size: { type: Number, value: 280 },
  },

  data: {
    ticks: [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330],
  },
})
