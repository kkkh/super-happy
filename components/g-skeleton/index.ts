/**
 * g-skeleton · 骨架屏（微光扫过材质）
 * 用于真实异步：云图加载、生成中占位。禁止用于假延迟。
 * 用法示例：
 *   <g-skeleton rows="{{3}}" card />
 */
Component({
  properties: {
    rows: { type: Number, value: 3 },
    /** 卡片形态（外层玻璃卡） */
    card: { type: Boolean, value: false },
    /** 头像形态 */
    avatar: { type: Boolean, value: false },
  },

  data: {
    rowList: [0, 1, 2],
  },

  lifetimes: {
    attached() {
      this.syncRows()
    },
  },

  observers: {
    rows() {
      this.syncRows()
    },
  },

  methods: {
    syncRows() {
      const list: number[] = []
      const rows = Math.max(1, Math.floor(this.data.rows))
      for (let i = 0; i < rows; i += 1) {
        list.push(i)
      }
      this.setData({ rowList: list })
    },
  },
})
