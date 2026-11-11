/* ==========================================================================
   searchHistory · 搜索历史（仅本机）
   - 只存关键词文本，不存输入内容以外的任何信息
   - 去重、最新在前、最多 8 条；空串与超长直接丢弃
   ========================================================================== */
import { MAX_SEARCH_HISTORY, TBX_KEYS, readStorage, writeStorage } from './storage'

function sanitize(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return []
  }
  const seen = new Set<string>()
  const list: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') {
      continue
    }
    const text = item.trim().slice(0, 24)
    if (!text || seen.has(text)) {
      continue
    }
    seen.add(text)
    list.push(text)
    if (list.length >= MAX_SEARCH_HISTORY) {
      break
    }
  }
  return list
}

export function readSearchHistory(): string[] {
  return sanitize(readStorage(TBX_KEYS.searchHistory))
}

/** 写入一条关键词；返回最新列表 */
export function pushSearchHistory(keyword: string): string[] {
  const text = keyword.trim().slice(0, 24)
  if (!text) {
    return readSearchHistory()
  }
  const next = [text, ...readSearchHistory().filter((item) => item !== text)].slice(
    0,
    MAX_SEARCH_HISTORY,
  )
  writeStorage(TBX_KEYS.searchHistory, next)
  return next
}

/** 删除单条；返回最新列表 */
export function removeSearchHistory(keyword: string): string[] {
  const next = readSearchHistory().filter((item) => item !== keyword)
  writeStorage(TBX_KEYS.searchHistory, next)
  return next
}

export function clearSearchHistory(): void {
  writeStorage(TBX_KEYS.searchHistory, [])
}
