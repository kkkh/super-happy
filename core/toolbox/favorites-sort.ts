/* ==========================================================================
   收藏页排序 · 纯函数
   - recent：沿用 store 的收藏时间倒序
   - name：中文名称升序
   - category：固定 calc → date → text → media → life → work，同分类按 weight 降序
   ========================================================================== */
import type { FavoriteSort, ToolCategory, ToolMeta } from './types'

export const FAVORITE_SORTS: FavoriteSort[] = ['recent', 'name', 'category']

export const FAVORITE_SORT_LABELS: Record<FavoriteSort, string> = {
  recent: '最近收藏',
  name: '名称',
  category: '分类',
}

const CATEGORY_ORDER: ToolCategory[] = ['calc', 'date', 'text', 'media', 'life', 'work']
const CATEGORY_INDEX = new Map<ToolCategory, number>(
  CATEGORY_ORDER.map((category, index) => [category, index]),
)

export function isFavoriteSort(value: unknown): value is FavoriteSort {
  return typeof value === 'string' && FAVORITE_SORTS.includes(value as FavoriteSort)
}

/** 返回新数组，不修改 store 中的收藏顺序 */
export function sortFavoriteTools(tools: ToolMeta[], sort: FavoriteSort): ToolMeta[] {
  if (sort === 'name') {
    return [...tools].sort((left, right) =>
      left.name.localeCompare(right.name, 'zh-Hans-CN'),
    )
  }
  if (sort === 'category') {
    return [...tools].sort((left, right) => {
      const leftIndex = CATEGORY_INDEX.get(left.category) ?? CATEGORY_ORDER.length
      const rightIndex = CATEGORY_INDEX.get(right.category) ?? CATEGORY_ORDER.length
      if (leftIndex !== rightIndex) {
        return leftIndex - rightIndex
      }
      if (left.weight !== right.weight) {
        return right.weight - left.weight
      }
      return 0
    })
  }
  return [...tools]
}
