/* ==========================================================================
   offline-banner · 全局离线提示
   - 在线时完全不渲染（配合 virtualHost，零宿主节点、零布局影响）
   - 断网：展开 3s 后收起为「离线」小胶囊，点击可再次展开
   - 恢复联网：短暂显示「网络已恢复」1.8s
   - 页面栈多实例：断网事件时全部展开，可见页一定可见；
     新页面 60s 内挂载只显示收起态，避免每跳一页弹一次
   ========================================================================== */
import { storeBindingsBehavior } from 'mobx-miniprogram-bindings'
import { networkStore } from '../../core/stores/network'
import { tapTick } from '../../core/utils/haptics'

const EXPAND_MS = 3000
const RECOVER_MS = 1800
/** 新挂载页面在此窗口内不再自动展开，只显示收起胶囊 */
const REPEAT_WINDOW_MS = 60000

let lastOfflineNoticeAt = 0

interface BannerRuntime {
  timer: number
  ready: boolean
  wasOffline: boolean
}

Component({
  behaviors: [storeBindingsBehavior],

  properties: {
    /** tab：Tab 页顶部空白带；page：自定义导航下方 */
    variant: {
      type: String,
      value: 'page',
    },
    /** page 变体的下移量（rpx），默认 112 */
    offset: {
      type: Number,
      value: 112,
    },
  },

  /* 官方 d.ts 尚未覆盖 behavior 注入的 storeBindings */
  // @ts-expect-error storeBindings 由 storeBindingsBehavior 注入
  storeBindings: {
    store: networkStore,
    fields: {
      offline: () => networkStore.offline,
    },
    actions: {},
  },

  data: {
    offline: networkStore.offline,
    visible: false,
    mode: 'offline' as 'offline' | 'recovered',
    expanded: false,
    topStyle: '',
  },

  lifetimes: {
    attached() {
      const runtime = this as unknown as BannerRuntime
      runtime.timer = 0
      runtime.ready = true
      runtime.wasOffline = this.data.offline

      /* 组件可能先于 App.onLaunch 挂载，这里幂等补一次 */
      networkStore.init()
      this.syncTopStyle()

      if (this.data.offline) {
        this.enterOffline(false)
      }
    },

    detached() {
      const runtime = this as unknown as BannerRuntime
      runtime.ready = false
      this.clearTimer()
    },
  },

  observers: {
    'variant, offset'() {
      this.syncTopStyle()
    },

    offline(value: boolean) {
      const runtime = this as unknown as BannerRuntime
      if (!runtime || !runtime.ready) {
        return
      }
      if (value) {
        this.enterOffline(true)
      } else if (runtime.wasOffline) {
        this.enterRecovered()
      }
      runtime.wasOffline = value
    },
  },

  methods: {
    syncTopStyle() {
      if (this.data.variant === 'tab') {
        this.setData({ topStyle: '' })
        return
      }
      const offset = Number(this.data.offset) || 112
      this.setData({
        topStyle: `top: calc(env(safe-area-inset-top) + ${offset}rpx);`,
      })
    },

    clearTimer() {
      const runtime = this as unknown as BannerRuntime
      if (runtime.timer) {
        clearTimeout(runtime.timer)
        runtime.timer = 0
      }
    },

    startCollapseTimer() {
      const runtime = this as unknown as BannerRuntime
      this.clearTimer()
      runtime.timer = setTimeout(() => {
        runtime.timer = 0
        this.setData({ expanded: false })
      }, EXPAND_MS) as unknown as number
    },

    /** 断网：展开一次；同一次断网内新挂载的页面只显示收起态 */
    enterOffline(fromEvent: boolean) {
      const shouldExpand = fromEvent || Date.now() - lastOfflineNoticeAt > REPEAT_WINDOW_MS
      if (shouldExpand) {
        lastOfflineNoticeAt = Date.now()
      }
      this.clearTimer()
      this.setData({
        visible: true,
        mode: 'offline',
        expanded: shouldExpand,
      })
      if (shouldExpand) {
        this.startCollapseTimer()
      }
    },

    enterRecovered() {
      const runtime = this as unknown as BannerRuntime
      this.clearTimer()
      runtime.timer = setTimeout(() => {
        runtime.timer = 0
        this.setData({ visible: false, expanded: false })
      }, RECOVER_MS) as unknown as number
      this.setData({
        visible: true,
        mode: 'recovered',
        expanded: true,
      })
    },
    onTap() {
      if (this.data.mode === 'recovered') {
        return
      }
      tapTick()
      if (this.data.expanded) {
        this.clearTimer()
        this.setData({ expanded: false })
        return
      }
      this.setData({ expanded: true })
      this.startCollapseTimer()
    },
  },
})
