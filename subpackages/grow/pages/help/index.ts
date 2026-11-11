/* ==========================================================================
   help · 使用指南
   - 覆盖 registry 全部工具；搜索复用 searchTools，与首页结果一致
   - 卡片展开查看步骤、提示与常见问题；一键跳转工具
   ========================================================================== */
import { createStoreBindings } from 'mobx-miniprogram-bindings'
import { uiStore } from '../../../../core/stores/ui'
import { HOME_SECTIONS, TOOLS, searchTools } from '../../../../core/toolbox/registry'
import { HELP_ENTRIES, type ToolHelp } from '../../lib/help'
import type { ToolMeta } from '../../../../core/toolbox/types'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'

interface HelpEntryView extends ToolMeta {
  summary: string
  steps: string[]
  tips: string[]
  faq: ToolHelp['faq']
  expanded: boolean
}

interface HelpGroupView {
  key: string
  title: string
  hint: string
  entries: HelpEntryView[]
}

interface HelpRuntime {
  themeBindings?: { destroyStoreBindings: () => void }
  destroyed: boolean
  /** 已展开的 toolId 集合，切换搜索时保留 */
  expanded: Set<string>
}

function toEntryView(tool: ToolMeta, expanded: Set<string>): HelpEntryView {
  const help = HELP_ENTRIES[tool.id]
  return {
    ...tool,
    summary: help?.summary ?? tool.desc,
    steps: help?.steps ?? [],
    tips: help?.tips ?? [],
    faq: help?.faq ?? [],
    expanded: expanded.has(tool.id),
  }
}

function buildGroups(expanded: Set<string>): HelpGroupView[] {
  return HOME_SECTIONS.map((section) => ({
    key: section.key,
    title: section.title,
    hint: section.hint,
    entries: TOOLS.filter((tool) => section.categories.includes(tool.category)).map((tool) =>
      toEntryView(tool, expanded),
    ),
  }))
}

Page({
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    themeClass: '',
    keyword: '',
    groups: [] as HelpGroupView[],
    results: [] as HelpEntryView[],
    /* 空结果推荐：取权重最高的 3 个工具 */
    recommended: [] as Array<{ id: string; name: string; route: string }>,
  },

  onLoad(query?: Record<string, string | undefined>) {
    const runtime = this as unknown as HelpRuntime
    runtime.destroyed = false
    runtime.expanded = new Set<string>()
    const toolId = String(query?.tool || '')
    if (toolId) {
      runtime.expanded.add(toolId)
    }
    runtime.themeBindings = createStoreBindings(this, {
      store: uiStore,
      fields: { themeClass: () => uiStore.themeClass },
      actions: [],
    })
    this.setData({
      groups: buildGroups(runtime.expanded),
      recommended: [...TOOLS]
        .sort((left, right) => right.weight - left.weight)
        .slice(0, 3)
        .map((tool) => ({ id: tool.id, name: tool.name, route: tool.route })),
    })
  },

  onUnload() {
    const runtime = this as unknown as HelpRuntime
    runtime.destroyed = true
    if (runtime.themeBindings) {
      runtime.themeBindings.destroyStoreBindings()
      runtime.themeBindings = undefined
    }
  },

  onSearchInput(event: WechatMiniprogram.Input) {
    const keyword = String(event.detail.value || '')
    const runtime = this as unknown as HelpRuntime
    if (!keyword.trim()) {
      /* 清空搜索：重建分组，保持展开态与 expanded 集合一致 */
      this.setData({ keyword: '', results: [], groups: buildGroups(runtime.expanded) })
      return
    }
    this.setData({
      keyword,
      results: searchTools(keyword).map((tool) => toEntryView(tool, runtime.expanded)),
    })
  },

  onToggleEntry(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    if (!id) {
      return
    }
    const runtime = this as unknown as HelpRuntime
    if (runtime.expanded.has(id)) {
      runtime.expanded.delete(id)
    } else {
      runtime.expanded.add(id)
    }
    const groups = this.data.keyword ? this.data.groups : buildGroups(runtime.expanded)
    const results = this.data.keyword
      ? searchTools(this.data.keyword).map((tool) => toEntryView(tool, runtime.expanded))
      : this.data.results
    this.setData({ groups, results })
  },

  onOpenTool(event: WechatMiniprogram.TouchEvent) {
    const route = String(event.currentTarget.dataset.route || '')
    if (!route) {
      return
    }
    wx.navigateTo({ url: route })
  },
})
