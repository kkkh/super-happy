/* ==========================================================================
   qw-api-sheet · API 覆盖自检抽屉
   - 展示已开通 8 组 API 的全部端点与实测状态
   - 支持单个重测 / 全部重测 / 重置，仅由页面发起真实请求
   ========================================================================== */

interface EndpointView {
  key: string
  label: string
  group: string
  description: string
  status: string
  latency: number
  count: number
  error: string
}

interface EndpointGroup {
  name: string
  rows: EndpointView[]
}

const GROUP_ORDER = [
  'GeoAPI',
  '天气预报',
  '分钟预报',
  '空气质量',
  '天气指数',
  '天文',
  '预警',
  '时光机',
]

function groupOf(list: EndpointView[]): EndpointGroup[] {
  const map = new Map<string, EndpointView[]>()
  list.forEach((item) => {
    const rows = map.get(item.group) || []
    rows.push(item)
    map.set(item.group, rows)
  })
  return GROUP_ORDER.filter((name) => map.has(name)).map((name) => ({
    name,
    rows: map.get(name) || [],
  }))
}

Component({
  options: {
    virtualHost: true,
    styleIsolation: 'isolated',
  },

  properties: {
    show: { type: Boolean, value: false },
    endpoints: { type: Array, value: [] },
    running: { type: Boolean, value: false },
    progress: { type: String, value: '' },
    host: { type: String, value: '' },
    auth: { type: String, value: 'JWT · Ed25519' },
  },

  data: {
    groups: [] as EndpointGroup[],
    total: 0,
    okCount: 0,
    failCount: 0,
    pendingCount: 0,
  },

  observers: {
    endpoints(value: EndpointView[]) {
      const list = Array.isArray(value) ? value : []
      this.setData({
        groups: groupOf(list),
        total: list.length,
        okCount: list.filter((item) => item.status === 'ok').length,
        failCount: list.filter((item) => item.status === 'error').length,
        pendingCount: list.filter((item) => item.status === 'idle' || item.status === 'loading').length,
      })
    },
  },

  methods: {
    onRun(event: WechatMiniprogram.TouchEvent): void {
      const key = String(event.currentTarget.dataset.key || '')
      if (!key || this.data.running) {
        return
      }
      this.triggerEvent('run', { key })
    },

    onRunAll(): void {
      if (this.data.running) {
        return
      }
      this.triggerEvent('runall')
    },

    onReset(): void {
      if (this.data.running) {
        return
      }
      this.triggerEvent('reset')
    },

    onClose(): void {
      this.triggerEvent('close')
    },
  },
})
