/* ==========================================================================
   diffToRichText · 将 Diff Segment 转为 rich-text Nodes
   - 每个 Diff 块只生成一个节点，绝不按字符拆节点
   - 超过 5000 个差异块自动降级为单节点纯文本，防止渲染层卡死
   - 使用 white-space: pre-wrap 保留换行，不额外生成 <br> 节点
   ========================================================================== */
import type { DiffSegment } from './diffEngine'

export interface RichTextTextNode {
  type: 'text'
  text: string
}

export interface RichTextNode {
  name: string
  attrs?: Record<string, string>
  children?: RichTextTextNode[]
}

export interface RichTextRenderResult {
  nodes: RichTextNode[]
  /** 是否因差异块过多而降级为纯文本 */
  compacted: boolean
  nodeCount: number
}

const MAX_NODES = 5000
const BASE_STYLE =
  'font-size:26rpx;line-height:1.8;white-space:pre-wrap;word-break:break-all;'
const INSERT_STYLE =
  `${BASE_STYLE}background-color:rgba(52,211,153,0.2);font-weight:600;`
const DELETE_STYLE =
  `${BASE_STYLE}background-color:rgba(248,113,113,0.2);font-weight:600;text-decoration:line-through;`

function styleFor(type: DiffSegment['type']): string {
  if (type === 'insert') {
    return INSERT_STYLE
  }
  if (type === 'delete') {
    return DELETE_STYLE
  }
  return BASE_STYLE
}

function textNode(text: string): RichTextNode {
  return {
    name: 'span',
    attrs: { style: BASE_STYLE },
    children: [{ type: 'text', text }],
  }
}

/**
 * 转换入口
 * - 正常情况：一个 Diff 块 = 一个 span 节点
 * - 极端差异：节点数 > 5000 时降级为单节点，页面显示降级提示
 */
export function diffSegmentsToRichText(segments: DiffSegment[]): RichTextRenderResult {
  const meaningful = segments.filter((segment) => segment.text)
  if (meaningful.length === 0) {
    return {
      nodes: [textNode('（暂无内容）')],
      compacted: false,
      nodeCount: 1,
    }
  }

  if (meaningful.length > MAX_NODES) {
    const plain = meaningful.map((segment) => segment.text).join('')
    return {
      nodes: [textNode(plain)],
      compacted: true,
      nodeCount: 1,
    }
  }

  const nodes: RichTextNode[] = meaningful.map((segment) => ({
    name: 'span',
    attrs: { style: styleFor(segment.type) },
    children: [{ type: 'text', text: segment.text }],
  }))
  return { nodes, compacted: false, nodeCount: nodes.length }
}
