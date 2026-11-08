/* ==========================================================================
   最近使用保留策略 · 纯函数
   - 只按时间戳裁剪，不改变顺序、不触碰收藏
   - 缺失时间戳的旧记录按「刚刚打开」处理，升级后不会被误删
   - days <= 0 表示永不清理，原样返回
   ========================================================================== */
export interface RetentionResult {
  ids: string[]
  recentAt: Record<string, number>
  removed: string[]
}

const DAY_MS = 24 * 60 * 60 * 1000

export function pruneRecentIds(
  ids: string[],
  recentAt: Record<string, number>,
  days: number,
  now: number,
): RetentionResult {
  const source = Array.isArray(ids) ? ids : []
  if (!(days > 0) || !Number.isFinite(now)) {
    return {
      ids: source.slice(),
      recentAt: { ...recentAt },
      removed: [],
    }
  }

  const cutoff = now - days * DAY_MS
  const kept: string[] = []
  const nextTimes: Record<string, number> = {}
  const removed: string[] = []

  for (const id of source) {
    if (typeof id !== 'string' || !id) {
      continue
    }
    const raw = recentAt[id]
    const at =
      typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : now
    if (at < cutoff) {
      removed.push(id)
      continue
    }
    kept.push(id)
    nextTimes[id] = at
  }

  return { ids: kept, recentAt: nextTimes, removed }
}
