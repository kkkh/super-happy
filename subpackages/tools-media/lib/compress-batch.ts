/* ==========================================================================
   批量图片压缩管线 · 纯函数 + 串行调度
   - 最多 9 张、单张 ≤12MP、单批总源 ≤80MB、输出长边 ≤2048
   - 串行执行，支持取消；页面负责选择文件、压缩与临时文件清理
   ========================================================================== */

export const MAX_BATCH_IMAGES = 9
export const MAX_BATCH_SOURCE_BYTES = 80 * 1024 * 1024
export const MAX_BATCH_EDGE = 2048
export const MAX_BATCH_PIXELS = 12_000_000

export interface BatchSize {
  width: number
  height: number
  scaled: boolean
}

/** 批量输出长边：用户选择 0（原尺寸）时仍压到 2048 */
export function batchOutputEdge(edge: number): number {
  return Math.min(edge > 0 ? edge : MAX_BATCH_EDGE, MAX_BATCH_EDGE)
}

/** 按长边等比缩放；尺寸异常时原样返回 */
export function targetBatchSize(width: number, height: number, edge: number): BatchSize {
  const maxSide = Math.max(width, height)
  if (!Number.isFinite(maxSide) || maxSide <= 0) {
    return { width, height, scaled: false }
  }
  const cap = batchOutputEdge(edge)
  const scale = maxSide > cap ? cap / maxSide : 1
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
    scaled: scale < 1,
  }
}

/** 单张源图超过 12MP 拒绝 */
export function isBatchSourceTooLarge(width: number, height: number): boolean {
  return width > 0 && height > 0 && width * height > MAX_BATCH_PIXELS
}

/** 按张数与总源体积截断；返回保留项、丢弃数与保留总字节 */
export function truncateBatchByBytes<T extends { size: number }>(
  items: T[],
  limit = MAX_BATCH_SOURCE_BYTES,
): { items: T[]; dropped: number; bytes: number } {
  const kept: T[] = []
  let bytes = 0
  let dropped = 0
  for (const item of items) {
    if (kept.length >= MAX_BATCH_IMAGES || bytes + item.size > limit) {
      dropped += 1
      continue
    }
    kept.push(item)
    bytes += item.size
  }
  return { items: kept, dropped, bytes }
}

export interface SerialBatchResult {
  cancelled: boolean
  processed: number
}

/**
 * 串行执行批量任务；每个任务结束后让出事件循环，便于进度渲染。
 * 取消只在任务边界生效，不打断正在进行的单张压缩。
 */
export async function runSerialBatch<T>(
  items: T[],
  worker: (item: T, index: number) => Promise<void>,
  isCancelled?: () => boolean,
): Promise<SerialBatchResult> {
  let processed = 0
  for (let index = 0; index < items.length; index += 1) {
    if (isCancelled && isCancelled()) {
      return { cancelled: true, processed }
    }
    await worker(items[index], index)
    processed += 1
    if (isCancelled && isCancelled()) {
      return { cancelled: true, processed }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  return { cancelled: false, processed }
}
