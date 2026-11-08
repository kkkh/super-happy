/* ==========================================================================
   专业文本对比引擎 · tools-core 分包本地实现
   - 使用 Google diff-match-patch，字符级结果 + 行级优化
   - 忽略大小写 / 空格通过「归一化 + 原索引映射」实现，渲染仍使用原文
   - 所有返回文本都有原文覆盖保证，不丢字符
   ========================================================================== */
import DiffMatchPatch from 'diff-match-patch'

export interface TextDiffOptions {
  ignoreCase: boolean
  /** 忽略空格 / Tab / CR，但保留换行以维持行级结构 */
  ignoreSpace: boolean
}

export interface DiffSegment {
  type: 'equal' | 'insert' | 'delete'
  text: string
}

export interface TextDiffStats {
  /** 处数 = 新增块 + 删除块 */
  changeCount: number
  insertCount: number
  deleteCount: number
}

export interface TextDiffResult {
  originalSegments: DiffSegment[]
  modifiedSegments: DiffSegment[]
  stats: TextDiffStats
  /** `[-删除-]{+新增+}` 标注文本，用于复制 / 流转 */
  annotatedText: string
  elapsedMs: number
  /** 是否触发了算法超时（结果仍可用，但可能不是最优切分） */
  timedOut: boolean
}

interface NormalizedText {
  text: string
  /** 归一化第 i 个字符对应的原文 UTF-16 下标 */
  map: number[]
}

interface RawSegment {
  type: DiffSegment['type']
  start: number
  end: number
}

const OP_DELETE = -1
const OP_EQUAL = 0
const OP_INSERT = 1

/** 行级优化阈值：超大文本跳过语义清理，避免二次 O(n²) 卡顿 */
const SEMANTIC_CLEANUP_LIMIT = 30000
/** 50k 文本的硬预算，单位毫秒；diff-match-patch 超时后返回当前最优结果 */
const DIFF_TIMEOUT_MS = 1800
/** 算法内部超时，单位秒（库的 Diff_Timeout 以秒计） */
const DIFF_LIB_TIMEOUT_S = 1.5

/**
 * 归一化：保留原文索引映射
 * - ignoreCase：逐字符 lower，长度变化时保留原字符
 * - ignoreSpace：跳过空格 / Tab / CR，保留 \n 以维持行级切分
 */
function normalizeText(source: string, options: TextDiffOptions): NormalizedText {
  const map: number[] = []
  let text = ''
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (
      options.ignoreSpace &&
      (char === ' ' ||
        char === '\t' ||
        char === '\r' ||
        char === '\u00A0' ||
        char === '\u3000')
    ) {
      continue
    }
    let normalized = char
    if (options.ignoreCase) {
      const lower = char.toLowerCase()
      if (lower.length === 1) {
        normalized = lower
      }
    }
    text += normalized
    map.push(index)
  }
  return { text, map }
}

/**
 * 归一化下标 → 原文下标
 * 段尾使用「下一个保留字符的原文起点」，自动把被忽略的空白归入相邻段
 */
function boundary(normalized: NormalizedText, index: number, sourceLength: number): number {
  if (index <= 0) {
    return 0
  }
  if (index >= normalized.text.length) {
    return sourceLength
  }
  return normalized.map[index] ?? sourceLength
}

function mergeAdjacent(segments: DiffSegment[]): DiffSegment[] {
  const merged: DiffSegment[] = []
  segments.forEach((segment) => {
    if (!segment.text) {
      return
    }
    const last = merged[merged.length - 1]
    if (last && last.type === segment.type) {
      last.text += segment.text
      return
    }
    merged.push({ type: segment.type, text: segment.text })
  })
  return merged
}

/**
 * 把归一化区间还原为原文区间
 * 同时补齐段间 / 首尾被忽略的空白，保证原文 100% 覆盖
 */
function finalizeSide(source: string, raw: RawSegment[]): DiffSegment[] {
  const output: DiffSegment[] = []
  let cursor = 0
  raw.forEach((segment) => {
    const start = Math.max(cursor, Math.min(segment.start, source.length))
    const end = Math.max(start, Math.min(segment.end, source.length))
    if (start > cursor) {
      output.push({ type: 'equal', text: source.slice(cursor, start) })
    }
    if (end > start) {
      output.push({ type: segment.type, text: source.slice(start, end) })
    }
    cursor = Math.max(cursor, end)
  })
  if (cursor < source.length) {
    output.push({ type: 'equal', text: source.slice(cursor) })
  }
  return mergeAdjacent(output)
}

function countSegments(segments: DiffSegment[], type: DiffSegment['type']): number {
  return segments.filter((segment) => segment.type === type).length
}

export function computeTextDiff(
  original: string,
  modified: string,
  options: TextDiffOptions,
): TextDiffResult {
  const startedAt = Date.now()
  const normalizedOriginal = normalizeText(original, options)
  const normalizedModified = normalizeText(modified, options)

  const dmp = new DiffMatchPatch()
  dmp.Diff_Timeout = DIFF_LIB_TIMEOUT_S
  const deadline = startedAt + DIFF_TIMEOUT_MS
  let diffs: Array<[number, string]> = []
  try {
    diffs = dmp.diff_main(
      normalizedOriginal.text,
      normalizedModified.text,
      true,
      deadline,
    )
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Diff 引擎执行失败')
  }

  const totalLength = normalizedOriginal.text.length + normalizedModified.text.length
  if (totalLength <= SEMANTIC_CLEANUP_LIMIT) {
    try {
      dmp.diff_cleanupSemantic(diffs)
    } catch {
      /* 语义清理失败不影响基础 diff 结果 */
    }
  } else {
    try {
      dmp.diff_cleanupMerge(diffs)
    } catch {
      /* 合并失败保留原始切分 */
    }
  }

  const originalRaw: RawSegment[] = []
  const modifiedRaw: RawSegment[] = []
  let originalCursor = 0
  let modifiedCursor = 0
  let annotatedText = ''

  diffs.forEach(([operation, value]) => {
    if (!value) {
      return
    }
    const length = value.length
    if (operation === OP_EQUAL) {
      const originalStart = boundary(normalizedOriginal, originalCursor, original.length)
      const originalEnd = boundary(
        normalizedOriginal,
        originalCursor + length,
        original.length,
      )
      const modifiedStart = boundary(normalizedModified, modifiedCursor, modified.length)
      const modifiedEnd = boundary(
        normalizedModified,
        modifiedCursor + length,
        modified.length,
      )
      originalRaw.push({ type: 'equal', start: originalStart, end: originalEnd })
      modifiedRaw.push({ type: 'equal', start: modifiedStart, end: modifiedEnd })
      annotatedText += original.slice(originalStart, originalEnd)
      originalCursor += length
      modifiedCursor += length
      return
    }

    if (operation === OP_DELETE) {
      const start = boundary(normalizedOriginal, originalCursor, original.length)
      const end = boundary(normalizedOriginal, originalCursor + length, original.length)
      originalRaw.push({ type: 'delete', start, end })
      annotatedText += `[-${original.slice(start, end)}-]`
      originalCursor += length
      return
    }

    if (operation === OP_INSERT) {
      const start = boundary(normalizedModified, modifiedCursor, modified.length)
      const end = boundary(normalizedModified, modifiedCursor + length, modified.length)
      modifiedRaw.push({ type: 'insert', start, end })
      annotatedText += `{+${modified.slice(start, end)}+}`
      modifiedCursor += length
    }
  })

  const originalSegments = finalizeSide(original, originalRaw)
  const modifiedSegments = finalizeSide(modified, modifiedRaw)
  const insertCount = countSegments(modifiedSegments, 'insert')
  const deleteCount = countSegments(originalSegments, 'delete')
  const elapsedMs = Date.now() - startedAt
  const timedOut = elapsedMs >= DIFF_LIB_TIMEOUT_S * 1000 - 50

  return {
    originalSegments,
    modifiedSegments,
    stats: {
      changeCount: insertCount + deleteCount,
      insertCount,
      deleteCount,
    },
    annotatedText,
    elapsedMs,
    timedOut,
  }
}

/** 生成可复制 / 可流转的精简差异报告 */
export function buildDiffReport(original: string, modified: string, result: TextDiffResult): string {
  const lines: string[] = [
    '文本对比报告',
    `共发现 ${result.stats.changeCount} 处差异（+新增 ${result.stats.insertCount} 处，-删除 ${result.stats.deleteCount} 处）`,
    `旧文本 ${Array.from(original).length} 字符 · 新文本 ${Array.from(modified).length} 字符 · 耗时 ${result.elapsedMs}ms`,
    '',
    '【差异标注】',
    result.annotatedText || '（两段文本完全一致）',
  ]
  return lines.join('\n')
}

/** 生成双栏可读高亮文本（纯文本标注，不依赖 rich-text） */
export function buildHighlightedText(result: TextDiffResult): string {
  const original = result.originalSegments
    .map((segment) =>
      segment.type === 'delete' ? `[-${segment.text}-]` : segment.text,
    )
    .join('')
  const modified = result.modifiedSegments
    .map((segment) =>
      segment.type === 'insert' ? `{+${segment.text}+}` : segment.text,
    )
    .join('')
  return `--- 原文本\n${original}\n\n+++ 新文本\n${modified}`
}
