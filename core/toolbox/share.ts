/* ==========================================================================
   工具分享 · 首页与 26 个工具页的统一分享载荷
   - 分享路径统一回首页，并携带 ?tool=xxx，由首页深链逻辑安全跳转
   - 非法/缺失工具一律回退到工具箱首页，绝不生成坏路径
   ========================================================================== */
import { TOOL_IDS, TOOLS } from './registry'
import type { ToolMeta } from './types'

const HOME_PATH = '/pages/index/index'
const GENERIC_TITLE = `超欢 · ${TOOLS.length} 个实用工具，气象实时在线`

export interface SharePayload {
  title: string
  path: string
}

export interface TimelinePayload {
  title: string
  query: string
}

function toolById(toolId: string): ToolMeta | null {
  if (!toolId) {
    return null
  }
  return TOOLS.find((tool) => tool.id === toolId) ?? null
}

/** 当前页面路由对应的工具；找不到返回 null */
export function currentPageTool(): ToolMeta | null {
  try {
    const pages = getCurrentPages()
    const page = pages.length ? pages[pages.length - 1] : null
    const route = page && typeof page.route === 'string' ? page.route : ''
    if (!route) {
      return null
    }
    const normalized = route.startsWith('/') ? route.slice(1) : route
    return TOOLS.find((tool) => tool.route.replace(/^\/+/, '') === normalized) ?? null
  } catch {
    return null
  }
}

/** 解析分享深链里的 ?tool= 参数；非法参数一律返回 null，绝不产生坏跳转 */
export function parseToolDeepLink(raw: unknown): ToolMeta | null {
  if (typeof raw !== 'string') {
    return null
  }
  let toolId = raw.trim()
  if (!toolId) {
    return null
  }
  try {
    toolId = decodeURIComponent(toolId)
  } catch {
    return null
  }
  if (!toolId || !TOOL_IDS.has(toolId)) {
    return null
  }
  return toolById(toolId)
}

/** 指定工具 id 的分享载荷；非法 id 回退首页 */
export function sharePayloadForTool(toolId: string): SharePayload {
  const tool = toolById(toolId)
  return {
    title: tool ? `${tool.name} · 超欢工具箱` : GENERIC_TITLE,
    path: tool
      ? `${HOME_PATH}?tool=${encodeURIComponent(tool.id)}`
      : HOME_PATH,
  }
}

/** 指定工具 id 的朋友圈载荷；非法 id 回退首页 */
export function timelinePayloadForTool(toolId: string): TimelinePayload {
  const tool = toolById(toolId)
  return {
    title: tool ? `${tool.name} · 超欢工具箱` : GENERIC_TITLE,
    query: tool ? `tool=${encodeURIComponent(tool.id)}` : '',
  }
}

/** 工具页直接调用：按当前路由反查工具 */
export function sharePayloadForCurrentPage(): SharePayload {
  const tool = currentPageTool()
  return sharePayloadForTool(tool ? tool.id : '')
}

/** 工具页直接调用：按当前路由反查工具 */
export function timelinePayloadForCurrentPage(): TimelinePayload {
  const tool = currentPageTool()
  return timelinePayloadForTool(tool ? tool.id : '')
}
