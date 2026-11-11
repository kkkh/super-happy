/* ==========================================================================
   tool-session · 工具会话层
   - 元数据、敏感文案、收藏与最近使用的唯一入口
   - 外壳只依赖 resolveToolSession，页面不再手写 kicker / privacy
   ========================================================================== */
import { TOOLS } from './registry'
import { toolboxStore } from './store'
import type { FavoriteToggleResult, ToolMeta, ToolSensitivity } from './types'

export type FavoriteSortMode = 'recent' | 'name' | 'category'

export interface ToolSession {
  meta: ToolMeta | undefined
  kicker: string
  sensitive: ToolSensitivity
  privacyText: string
}

/** 敏感提示统一文案：privacy / personal / finance / health */
export function privacyTextFor(sensitive: ToolSensitivity | string): string {
  if (sensitive === 'privacy') {
    return '图片只在本机处理，不会上传服务器'
  }
  if (sensitive === 'personal') {
    return '名片信息只在本机生成，不读取通讯录、不上传'
  }
  if (sensitive === 'finance') {
    return '试算结果仅供参考，不构成金融建议'
  }
  if (sensitive === 'health') {
    return '结果仅供参考，不构成医疗建议'
  }
  return ''
}

/** 由 toolId 解析出会话信息；未知 id 返回安全兜底 */
export function resolveToolSession(toolId: string): ToolSession {
  const meta = TOOLS.find((tool) => tool.id === toolId)
  return {
    meta,
    kicker: (meta?.category ?? 'tool').toUpperCase(),
    sensitive: meta?.sensitive ?? '',
    privacyText: meta?.privacyNote || privacyTextFor(meta?.sensitive ?? ''),
  }
}

/** 最近使用：只做去重入栈，不替代 recordOpen 的累计打开职责 */
export function recordRecentOnce(toolId: string): void {
  toolboxStore.recordRecent(toolId)
}

export function toggleFavoriteTool(toolId: string): FavoriteToggleResult {
  return toolboxStore.toggleFavorite(toolId)
}

export function removeFavorites(ids: string[]): boolean {
  return toolboxStore.removeFavorites(ids)
}

export function clearFavorites(): boolean {
  return toolboxStore.clearFavorites()
}

/** 收藏排序：recent 保持 store 的收藏时间倒序 */
export function favoriteToolsSorted(mode: FavoriteSortMode): ToolMeta[] {
  const tools = toolboxStore.favoriteTools()
  if (mode === 'name') {
    return [...tools].sort((left, right) => left.name.localeCompare(right.name, 'zh'))
  }
  if (mode === 'category') {
    return [...tools].sort(
      (left, right) => left.category.localeCompare(right.category) || right.weight - left.weight,
    )
  }
  return tools
}
