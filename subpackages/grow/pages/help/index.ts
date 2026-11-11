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
import { profile } from '../../../../core/data/resume-data'
import { copyText, toast } from '../../../../core/services/feedback'
import { canShareFile, cleanupExport, sharePrepared } from '../../../../core/services/export'
import {
  buildDiagnosticPreviewFromDevice,
  prepareDiagnosticFile,
} from '../../../../core/services/diagnostics'
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
  diagnosticPath: string
  diagnosticName: string
  diagnosticSeq: number
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
    /* 反馈与诊断包 */
    feedbackOpen: false,
    feedbackEmail: profile.email,
    diagnosticBusy: false,
    diagnosticPreview: '',
    diagnosticBytes: 0,
    diagnosticEntries: 0,
    diagnosticDropped: 0,
    diagnosticFileReady: false,
    diagnosticShareSupported: false,
  },

  onLoad(query?: Record<string, string | undefined>) {
    const runtime = this as unknown as HelpRuntime
    runtime.destroyed = false
    runtime.expanded = new Set<string>()
    runtime.diagnosticPath = ''
    runtime.diagnosticName = ''
    runtime.diagnosticSeq = 0
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
    if (runtime.diagnosticPath) {
      cleanupExport(runtime.diagnosticPath)
      runtime.diagnosticPath = ''
      runtime.diagnosticName = ''
    }
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

  /* ---- 反馈与诊断 ---- */
  onOpenFeedback(): void {
    const runtime = this as unknown as HelpRuntime
    if (runtime.destroyed) {
      return
    }
    if (runtime.diagnosticPath) {
      cleanupExport(runtime.diagnosticPath)
      runtime.diagnosticPath = ''
      runtime.diagnosticName = ''
    }
    runtime.diagnosticSeq += 1
    const preview = buildDiagnosticPreviewFromDevice()
    this.setData({
      feedbackOpen: true,
      diagnosticBusy: false,
      diagnosticPreview: preview.text,
      diagnosticBytes: preview.bytes,
      diagnosticEntries: preview.entries,
      diagnosticDropped: preview.dropped,
      diagnosticFileReady: false,
      diagnosticShareSupported: canShareFile(),
    })
  },

  onFeedbackClose(): void {
    const runtime = this as unknown as HelpRuntime
    runtime.diagnosticSeq += 1
    if (runtime.diagnosticPath) {
      cleanupExport(runtime.diagnosticPath)
      runtime.diagnosticPath = ''
      runtime.diagnosticName = ''
    }
    this.setData({
      feedbackOpen: false,
      diagnosticBusy: false,
      diagnosticFileReady: false,
    })
  },

  onCopyDiagnostic(): void {
    void copyText(this.data.diagnosticPreview, '诊断包已复制')
  },

  onCopyEmail(): void {
    void copyText(this.data.feedbackEmail, '邮箱已复制')
  },

  onExportDiagnostic(): void {
    const runtime = this as unknown as HelpRuntime
    if (runtime.destroyed || this.data.diagnosticBusy) {
      return
    }
    if (this.data.diagnosticFileReady && runtime.diagnosticPath) {
      sharePrepared(runtime.diagnosticPath, runtime.diagnosticName)
        .then((outcome) => {
          if (runtime.destroyed) {
            return
          }
          if (outcome === 'shared') {
            toast('诊断文件已分享')
            return
          }
          if (outcome === 'cancelled') {
            toast('已取消分享')
            return
          }
          if (outcome === 'unsupported') {
            toast('当前基础库不支持文件分享')
            return
          }
          toast('分享失败，请稍后重试')
        })
        .catch(() => {
          if (!runtime.destroyed) {
            toast('分享失败，请稍后重试')
          }
        })
      return
    }

    this.setData({ diagnosticBusy: true })
    const seq = runtime.diagnosticSeq
    prepareDiagnosticFile({
      text: this.data.diagnosticPreview,
      bytes: this.data.diagnosticBytes,
      entries: this.data.diagnosticEntries,
      dropped: this.data.diagnosticDropped,
    })
      .then((result) => {
        if (runtime.destroyed) {
          return
        }
        if (seq !== runtime.diagnosticSeq || !this.data.feedbackOpen) {
          if (result.ok) {
            cleanupExport(result.path)
          }
          return
        }
        if (!result.ok) {
          this.setData({ diagnosticBusy: false })
          toast(this.diagnosticReasonText(result.reason))
          return
        }
        runtime.diagnosticPath = result.path
        runtime.diagnosticName = result.name
        this.setData({ diagnosticBusy: false, diagnosticFileReady: true })
        toast('诊断文件已生成，请再次点击分享')
      })
      .catch(() => {
        if (!runtime.destroyed) {
          this.setData({ diagnosticBusy: false })
          toast('诊断文件生成失败，请稍后重试')
        }
      })
  },

  diagnosticReasonText(reason: 'empty' | 'too-large' | 'write-failed' | 'unsupported'): string {
    switch (reason) {
      case 'empty':
        return '诊断内容为空'
      case 'too-large':
        return '诊断包超过 50KB，请稍后重试'
      case 'write-failed':
        return '诊断文件写入失败，请稍后重试'
      default:
        return '当前基础库不支持文件操作'
    }
  },
})
