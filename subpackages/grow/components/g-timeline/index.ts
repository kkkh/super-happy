/**
 * g-timeline · 成长时间线（三纪元纵轴）
 * 左轨道 + 纪元节点（tone 辉光）+ 里程碑卡（展开态为组件内部 UI 状态）
 * 用法示例：
 *   <g-timeline eras="{{timelineEras}}" />
 */
import { tapTick } from '../../../../core/utils/haptics'
import type { TimelineEra } from '../../../../core/types/index'

/** 视图态纪元：把展开状态预计算进数据，规避 WXML 动态键取值 */
interface TimelineViewEra extends TimelineEra {
  open: boolean
}

Component({
  properties: {
    eras: { type: Array, value: [] },
  },

  data: {
    viewEras: [] as TimelineViewEra[],
  },

  observers: {
    eras() {
      this.syncEras()
    },
  },

  lifetimes: {
    attached() {
      this.syncEras()
    },
  },

  methods: {
    syncEras() {
      const eras = (this.data.eras ?? []) as TimelineEra[]
      /* 初始 attached 阶段 data.viewEras 可能尚未就绪，取默认空数组兜底 */
      const previous = (this.data.viewEras ?? []) as TimelineViewEra[]
      const openIds = new Set(previous.filter((era) => era.open).map((era) => era.id))
      this.setData({
        viewEras: eras.map((era) => ({ ...era, open: openIds.has(era.id) })),
      })
    },

    /** 纪元卡展开/收起 */
    onEraTap(event: WechatMiniprogram.TouchEvent) {
      const { id } = event.currentTarget.dataset as { id: string }
      const eras = (this.data.viewEras ?? []) as TimelineViewEra[]
      const index = eras.findIndex((era) => era.id === id)
      if (index < 0) {
        return
      }
      tapTick()
      this.setData({ [`viewEras[${index}].open`]: !eras[index].open })
    },
  },
})
