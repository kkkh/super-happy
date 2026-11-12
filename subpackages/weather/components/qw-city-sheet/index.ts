/* ==========================================================================
   qw-city-sheet · 城市管理抽屉（GeoAPI v2）
   - 已保存城市 / 城市搜索 / 热门城市 / 附近景点
   - 最多 5 个保存城市；定位由页面统一处理权限
   ========================================================================== */

import {
  nearbyScenic,
  searchCities,
  searchScenic,
  topCities,
} from '../../lib/qweather/city'
import type { QwGeoItem } from '../../lib/qweather/types'

type ListKey = 'results' | 'top' | 'scenic'

interface CityTab {
  key: string
  label: string
}

const TABS: CityTab[] = [
  { key: 'saved', label: '已保存' },
  { key: 'search', label: '搜索' },
  { key: 'top', label: '热门' },
  { key: 'scenic', label: '附近景点' },
]

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '加载失败，请稍后重试'
}

Component({
  options: {
    virtualHost: true,
    styleIsolation: 'isolated',
  },

  properties: {
    show: { type: Boolean, value: false },
    cities: { type: Array, value: [] },
    current: { type: Object, value: null },
    locating: { type: Boolean, value: false },
  },

  data: {
    tab: 'saved',
    tabs: TABS,
    keyword: '',
    results: [] as QwGeoItem[],
    top: [] as QwGeoItem[],
    scenic: [] as QwGeoItem[],
    busy: false,
    error: '',
    topLoaded: false,
    scenicLoaded: false,
    scenicToken: '',
    searchHint: '输入城市名、拼音或 LocationID',
  },

  observers: {
    current(value: { lat?: number; lon?: number } | null) {
      const lat = value && typeof value.lat === 'number' ? value.lat : null
      const lon = value && typeof value.lon === 'number' ? value.lon : null
      const token = lat !== null && lon !== null ? `${lon},${lat}` : ''
      if (token === this.data.scenicToken) {
        return
      }
      this.setData({ scenic: [], scenicLoaded: false, scenicToken: token })
      if (this.data.show && this.data.tab === 'scenic') {
        void this.loadScenic()
      }
    },
    show(value: boolean) {
      if (!value) {
        return
      }
      this.setData({ error: '' })
      if (!this.data.topLoaded) {
        void this.loadTop()
      }
    },
  },

  methods: {
    listOf(key: ListKey): QwGeoItem[] {
      const record = this.data as unknown as Record<string, unknown>
      const value = record[key]
      return Array.isArray(value) ? (value as QwGeoItem[]) : []
    },

    async loadTop(): Promise<void> {
      if (this.data.busy) {
        return
      }
      this.setData({ busy: true, error: '' })
      try {
        const list = await topCities(12)
        this.setData({ top: list, topLoaded: true })
      } catch (error) {
        this.setData({ error: messageOf(error) })
      } finally {
        this.setData({ busy: false })
      }
    },

    async loadScenic(): Promise<void> {
      const current = this.data.current as { lat?: number; lon?: number } | null
      if (!current || typeof current.lat !== 'number' || typeof current.lon !== 'number') {
        this.setData({ error: '请先选择城市，再查看附近景点' })
        return
      }
      if (this.data.busy) {
        return
      }
      this.setData({ busy: true, error: '' })
      const token = this.data.scenicToken
      try {
        const list = await nearbyScenic(current.lat, current.lon, 20)
        if (this.data.scenicToken === token) {
          this.setData({ scenic: list, scenicLoaded: true })
        }
      } catch (error) {
        if (this.data.scenicToken === token) {
          this.setData({ error: messageOf(error) })
        }
      } finally {
        this.setData({ busy: false })
        /* 请求期间切换了城市：为当前城市补一次 */
        if (token !== this.data.scenicToken && this.data.show && this.data.tab === 'scenic') {
          void this.loadScenic()
        }
      }
    },

    async searchCity(): Promise<void> {
      const keyword = this.data.keyword.trim()
      if (!keyword) {
        this.setData({ error: '请输入城市名称' })
        return
      }
      if (this.data.busy) {
        return
      }
      this.setData({ busy: true, error: '' })
      try {
        const list = await searchCities(keyword, 12)
        this.setData({ results: list, tab: 'search' })
        if (!list.length) {
          this.setData({ error: '没有找到匹配城市，试试更完整的名称' })
        }
      } catch (error) {
        this.setData({ error: messageOf(error) })
      } finally {
        this.setData({ busy: false })
      }
    },

    async searchScenic(): Promise<void> {
      const keyword = this.data.keyword.trim()
      if (!keyword) {
        this.setData({ error: '请输入景点关键词' })
        return
      }
      const current = this.data.current as { id?: string; source?: string } | null
      if (this.data.busy) {
        return
      }
      this.setData({ busy: true, error: '' })
      try {
        const cityId = current && current.source !== 'poi' ? current.id || '' : ''
        const list = await searchScenic(keyword, cityId, 12)
        this.setData({ scenic: list, scenicLoaded: true, tab: 'scenic' })
        if (!list.length) {
          this.setData({ error: '没有找到匹配景点' })
        }
      } catch (error) {
        this.setData({ error: messageOf(error) })
      } finally {
        this.setData({ busy: false })
      }
    },

    onTab(event: WechatMiniprogram.TouchEvent): void {
      const tab = String(event.currentTarget.dataset.tab || '')
      if (!tab || tab === this.data.tab) {
        return
      }
      this.setData({
        tab,
        error: '',
        searchHint: tab === 'scenic' ? '输入景点名称，或查看附近景点' : '输入城市名、拼音或 LocationID',
      })
      if (tab === 'top' && !this.data.topLoaded) {
        void this.loadTop()
      }
      if (tab === 'scenic' && !this.data.scenicLoaded) {
        void this.loadScenic()
      }
    },

    onInput(event: WechatMiniprogram.Input): void {
      this.setData({ keyword: event.detail.value })
    },

    onConfirm(): void {
      if (this.data.tab === 'scenic') {
        void this.searchScenic()
        return
      }
      void this.searchCity()
    },

    onLocate(): void {
      this.triggerEvent('locate')
    },

    onPick(event: WechatMiniprogram.TouchEvent): void {
      const list = String(event.currentTarget.dataset.list || '') as ListKey
      const index = Number(event.currentTarget.dataset.index)
      if (!['results', 'top', 'scenic'].includes(list) || !Number.isFinite(index)) {
        return
      }
      const item = this.listOf(list)[index]
      if (item) {
        this.triggerEvent('select', { item })
      }
    },

    onSavedPick(event: WechatMiniprogram.TouchEvent): void {
      const index = Number(event.currentTarget.dataset.index)
      const cities = this.data.cities as Array<Record<string, unknown>>
      if (!Number.isFinite(index) || !cities[index]) {
        return
      }
      this.triggerEvent('select-saved', { index })
    },

    onRemove(event: WechatMiniprogram.TouchEvent): void {
      const token = String(event.currentTarget.dataset.token || '')
      if (token) {
        this.triggerEvent('remove', { token })
      }
    },

    onClose(): void {
      this.triggerEvent('close')
    },
  },
})
