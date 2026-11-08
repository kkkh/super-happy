/* ==========================================================================
   全局埋点 · 工具结果 → historyStore
   - useTracker()：工具页 / 自定义页可直接调用 record(payload)
   - recordToolResult()：glass-tool-shell 的自动拦截入口
   - 输入 / 输出全部收敛为摘要，单条最长 140 / 160 字
   - 主题在结果产生时快照为「白昼 / 夜航」，供驾驶舱生成效率周报
   ========================================================================== */
import { TOOLS } from './registry'
import { normalizePosterData, resolvePosterCategory } from './poster'
import { maskSensitiveText } from './privacy'
import { historyStore, type HistoryRecord } from '../stores/history'
import { preferenceStore } from '../stores/preference'
import { uiStore } from '../stores/ui'
import type { ToolCategory } from './types'

export interface TrackPayload {
  toolId: string
  toolName?: string
  category?: ToolCategory
  /** 工具页标准海报数据：params / mainResult / extras 已是安全摘要 */
  poster?: unknown
  inputSummary?: string
  outputSummary?: string
}

function joinSummary(parts: string[], max: number): string {
  const text = parts.filter(Boolean).join(' · ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

export function recordToolResult(payload: TrackPayload): HistoryRecord | null {
  if (!payload || !payload.toolId) {
    return null
  }
  preferenceStore.init()
  if (!preferenceStore.isHistoryTrackingEnabled) {
    return null
  }
  const meta = TOOLS.find((tool) => tool.id === payload.toolId)
  const poster = normalizePosterData(payload.poster)
  const inputSummary =
    payload.inputSummary ||
    (poster
      ? joinSummary(
          poster.params.map((param) => `${param.label} ${param.value}`),
          140,
        )
      : '')
  const outputSummary =
    payload.outputSummary ||
    (poster
      ? joinSummary(
          [
            poster.resultLabel ? `${poster.resultLabel} ${poster.mainResult}` : poster.mainResult,
            ...poster.extras,
          ],
          160,
        )
      : '')

  /* 埋点即分类：金额 / 密码 / 健康等按字段 label 预计算掩码；
     单位、分类、普通换算文案保持可读，渲染层无需再猜 */
  const inputMasked = payload.inputSummary
    ? maskSensitiveText(payload.inputSummary)
    : poster
      ? joinSummary(
          poster.params.map(
            (param) => `${param.label} ${maskSensitiveText(param.value, param.label)}`,
          ),
          140,
        )
      : ''
  const outputMasked = payload.outputSummary
    ? maskSensitiveText(payload.outputSummary)
    : poster
      ? joinSummary(
          [
            poster.resultLabel
              ? `${poster.resultLabel} ${maskSensitiveText(poster.mainResult, poster.resultLabel)}`
              : maskSensitiveText(poster.mainResult),
            ...poster.extras.map((item) => maskSensitiveText(item)),
          ],
          160,
        )
      : ''

  /* 没有结果摘要不写入，避免把「只点了按钮但未出结果」也记成轨迹 */
  if (!outputSummary) {
    return null
  }

  const category = meta?.category ?? payload.category ?? 'calc'
  return historyStore.record({
    toolId: payload.toolId,
    toolName: payload.toolName || poster?.toolName || meta?.name || '效率工具',
    category,
    categoryLabel: poster?.category || resolvePosterCategory(category),
    icon: meta?.icon || '·',
    night: uiStore.resolvedTheme === 'dark',
    themeLabel: uiStore.resolvedThemeLabel,
    inputSummary,
    outputSummary,
    inputMasked,
    outputMasked,
  })
}

/** 小程序里的「Hook」：返回稳定的埋点 API，不依赖 React */
export function useTracker(): { record: (payload: TrackPayload) => HistoryRecord | null } {
  return {
    record: recordToolResult,
  }
}
