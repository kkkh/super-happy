/* ==========================================================================
   图片压缩 · 批量串行管线（≤9 张）+ 最大边缩放
   - 只从相册选择；在本机处理，不上传
   - 串行压缩，单张失败不阻断其余；支持取消与临时文件清理
   ========================================================================== */
import { copyText, toast } from '../../lib/ui'
import { tapSuccess, tapTick } from '../../../../core/utils/haptics'
import {
  chooseImages,
  formatBytes,
  getFileSize,
  getImageInfo,
  saveImageToAlbum,
  type PickedImage,
} from '../../lib/image'
import {
  MAX_BATCH_IMAGES,
  isBatchSourceTooLarge,
  runSerialBatch,
  targetBatchSize,
  truncateBatchByBytes,
} from '../../lib/compress-batch'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'

type BatchStatus = 'pending' | 'processing' | 'done' | 'failed' | 'rejected'

interface CompressItem {
  id: string
  name: string
  originalPath: string
  originalSize: number
  originalSizeText: string
  originalWidth: number
  originalHeight: number
  compressedPath: string
  compressedSize: number
  compressedSizeText: string
  compressedWidth: number
  compressedHeight: number
  ratioValue: number
  savedText: string
  status: BatchStatus
  statusText: string
  error: string
}

interface CompressRuntime {
  destroyed: boolean
  cancelled: boolean
  seq: number
}

interface QualityOption {
  key: string
  label: string
  quality: number
}

interface EdgeOption {
  key: string
  label: string
  edge: number
}

const QUALITIES: QualityOption[] = [
  { key: 'high', label: '高清', quality: 90 },
  { key: 'balanced', label: '均衡', quality: 75 },
  { key: 'small', label: '轻巧', quality: 55 },
]

const EDGES: EdgeOption[] = [
  { key: 'origin', label: '原尺寸', edge: 0 },
  { key: '1920', label: '1920', edge: 1920 },
  { key: '1280', label: '1280', edge: 1280 },
  { key: '750', label: '750', edge: 750 },
]

const STATUS_TEXT: Record<BatchStatus, string> = {
  pending: '等待',
  processing: '处理中',
  done: '完成',
  failed: '失败',
  rejected: '已跳过',
}

function unlinkQuietly(filePath: string): void {
  if (!filePath) {
    return
  }
  try {
    wx.getFileSystemManager().unlink({ filePath, fail: () => undefined })
  } catch {
    // 文件系统不可用时忽略清理
  }
}

function cleanupPaths(items: CompressItem[]): void {
  items.forEach((item) => {
    unlinkQuietly(item.originalPath)
    unlinkQuietly(item.compressedPath)
  })
}

function decorate(item: CompressItem): CompressItem {
  return {
    ...item,
    originalSizeText: formatBytes(item.originalSize),
    compressedSizeText: item.compressedSize > 0 ? formatBytes(item.compressedSize) : '',
    statusText: STATUS_TEXT[item.status],
  }
}

function initialData() {
  return {
    items: [] as CompressItem[],
    totalCount: 0,
    doneCount: 0,
    failedCount: 0,
    sourceTotalText: '—',
    totalOriginalText: '—',
    totalCompressedText: '—',
    totalSavedText: '',
    totalRatioValue: 0,
    processingName: '',
    processingIndex: 0,
    processingTotal: 0,
    progressPercent: 0,
    compressing: false,
    cancelling: false,
    savingAll: false,
    savingId: '',
    shellState: 'idle',
    hasResult: false,
    error: '',
    posterData: null as IPosterData | null,
  }
}

function compressImage(
  src: string,
  quality: number,
  width: number | null,
  height: number | null,
): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.compressImage({
      src,
      quality,
      compressedWidth: width ?? undefined,
      compressedHeight: height ?? undefined,
      success: (result) => resolve(result.tempFilePath),
      fail: (error) => {
        if (width && height) {
          /* 低版本基础库不支持按尺寸压缩时，退回纯质量压缩 */
          wx.compressImage({
            src,
            quality,
            success: (fallback) => resolve(fallback.tempFilePath),
            fail: (fallbackError) =>
              reject(new Error(fallbackError.errMsg || error.errMsg || '压缩失败')),
          })
          return
        }
        reject(new Error(error.errMsg || '压缩失败'))
      },
    })
  })
}

Page({
  /* 此处是处理工具页分享与深链参数校验的边界 */
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: '图片压缩',
    kicker: '图片处理',
    desc: '本机批量压缩、前后体积对比',
    qualities: QUALITIES,
    edges: EDGES,
    qualityKey: 'balanced',
    edgeKey: '1920',
    ...initialData(),
  },

  onLoad() {
    const runtime = this as unknown as CompressRuntime
    runtime.destroyed = false
    runtime.cancelled = false
    runtime.seq = 0
  },

  onUnload() {
    const runtime = this as unknown as CompressRuntime
    runtime.destroyed = true
    runtime.cancelled = true
    runtime.seq += 1
    const items = this.data.items as CompressItem[]
    items.forEach((item) => unlinkQuietly(item.originalPath))
    if (!this.data.savingAll && !this.data.savingId) {
      items.forEach((item) => unlinkQuietly(item.compressedPath))
    }
  },

  async onChoose() {
    if (this.data.compressing || this.data.savingAll || this.data.savingId) {
      return
    }
    const runtime = this as unknown as CompressRuntime
    tapTick()
    this.setData({ shellState: 'running', error: '' })
    try {
      const picked = await chooseImages(MAX_BATCH_IMAGES)
      if (!picked.length) {
        this.setData({ shellState: this.data.items.length ? 'done' : 'idle' })
        return
      }
      if (runtime.destroyed) {
        picked.forEach((item) => unlinkQuietly(item.path))
        return
      }

      const prepared: Array<{
        image: PickedImage
        width: number
        height: number
        rejected: boolean
      }> = []
      for (const image of picked) {
        let width = image.width
        let height = image.height
        if (!width || !height) {
          try {
            const info = await getImageInfo(image.path)
            width = info.width
            height = info.height
          } catch {
            /* 尺寸读取失败时按未知处理，交给压缩阶段 */
          }
        }
        if (runtime.destroyed) {
          picked.forEach((item) => unlinkQuietly(item.path))
          return
        }
        prepared.push({
          image,
          width,
          height,
          rejected: isBatchSourceTooLarge(width, height),
        })
      }

      const limited = truncateBatchByBytes(
        prepared
          .filter((entry) => !entry.rejected)
          .map((entry) => ({ entry, size: entry.image.size })),
      )
      const kept = new Set(limited.items.map((item) => item.entry))
      if (limited.dropped > 0) {
        toast(`最多 ${MAX_BATCH_IMAGES} 张且总源不超过 80MB，已保留前 ${kept.size + prepared.filter((entry) => entry.rejected).length} 张`)
      }

      const items: CompressItem[] = []
      prepared.forEach((entry, index) => {
        if (!entry.rejected && !kept.has(entry)) {
          unlinkQuietly(entry.image.path)
          return
        }
        items.push(
          decorate({
            id: `img-${index}`,
            name: `图片 ${index + 1}`,
            originalPath: entry.image.path,
            originalSize: entry.image.size,
            originalSizeText: formatBytes(entry.image.size),
            originalWidth: entry.width,
            originalHeight: entry.height,
            compressedPath: '',
            compressedSize: 0,
            compressedSizeText: '',
            compressedWidth: 0,
            compressedHeight: 0,
            ratioValue: 0,
            savedText: '',
            status: entry.rejected ? 'rejected' : 'pending',
            statusText: entry.rejected ? STATUS_TEXT.rejected : STATUS_TEXT.pending,
            error: entry.rejected ? '超过 12MP，已跳过' : '',
          }),
        )
      })

      cleanupPaths(this.data.items as CompressItem[])
      if (!items.length) {
        this.setData({
          ...initialData(),
          error: '所选图片总源超过 80MB，请减少张数或换图',
          shellState: 'error',
        })
        return
      }
      const sourceBytes = items.reduce((sum, item) => sum + item.originalSize, 0)
      this.setData({
        ...initialData(),
        items,
        totalCount: items.length,
        sourceTotalText: formatBytes(sourceBytes),
        hasResult: items.length > 0,
        shellState: items.length ? 'running' : 'idle',
      })
      if (items.some((item) => item.status === 'pending')) {
        this.compressBatch()
      } else {
        this.finishBatch(items)
      }
    } catch (error) {
      if (runtime.destroyed) {
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      this.setData({
        error: message || '选择图片失败',
        shellState: 'error',
      })
    }
  },

  onQuality(event: WechatMiniprogram.TouchEvent) {
    this.switchOption('quality', String(event.currentTarget.dataset.key || ''))
  },

  onEdge(event: WechatMiniprogram.TouchEvent) {
    this.switchOption('edge', String(event.currentTarget.dataset.key || ''))
  },

  switchOption(kind: 'quality' | 'edge', key: string) {
    if (this.data.compressing) {
      toast('正在压缩，请先取消')
      return
    }
    if (this.data.savingAll || this.data.savingId) {
      return
    }
    if (kind === 'quality') {
      if (!QUALITIES.some((item) => item.key === key) || key === this.data.qualityKey) {
        return
      }
      tapTick()
      this.setData({ qualityKey: key }, () => {
        if (this.data.items.length) {
          this.compressBatch()
        }
      })
      return
    }
    if (!EDGES.some((item) => item.key === key) || key === this.data.edgeKey) {
      return
    }
    tapTick()
    this.setData({ edgeKey: key }, () => {
      if (this.data.items.length) {
        this.compressBatch()
      }
    })
  },

  onCancel() {
    if (!this.data.compressing || this.data.cancelling) {
      return
    }
    const runtime = this as unknown as CompressRuntime
    runtime.cancelled = true
    tapTick()
    this.setData({ cancelling: true })
  },

  async compressBatch() {
    const runtime = this as unknown as CompressRuntime
    if (runtime.destroyed || this.data.compressing) {
      return
    }
    const quality =
      QUALITIES.find((item) => item.key === this.data.qualityKey) ?? QUALITIES[1]
    const edge = EDGES.find((item) => item.key === this.data.edgeKey) ?? EDGES[1]
    const items = (this.data.items as CompressItem[]).map((item) => {
      if (item.status === 'rejected') {
        return item
      }
      unlinkQuietly(item.compressedPath)
      return decorate({
        ...item,
        compressedPath: '',
        compressedSize: 0,
        compressedSizeText: '',
        compressedWidth: 0,
        compressedHeight: 0,
        ratioValue: 0,
        savedText: '',
        status: 'pending',
        statusText: STATUS_TEXT.pending,
        error: '',
      })
    })
    const entries = items
      .map((item, index) => ({ item, index }))
      .filter((entry) => entry.item.status !== 'rejected')
    if (!entries.length) {
      this.finishBatch(items)
      return
    }

    runtime.cancelled = false
    runtime.seq += 1
    const seq = runtime.seq
    this.setData({
      items,
      compressing: true,
      cancelling: false,
      error: '',
      shellState: 'running',
      doneCount: 0,
      failedCount: 0,
      progressPercent: 0,
      processingTotal: entries.length,
      processingIndex: 0,
      processingName: '',
      totalSavedText: '',
      totalRatioValue: 0,
      posterData: null,
    })

    const result = await runSerialBatch(
      entries,
      async (entry, order) => {
        if (runtime.destroyed || runtime.cancelled) {
          return
        }
        const current = items[entry.index]
        items[entry.index] = decorate({
          ...current,
          status: 'processing',
          statusText: STATUS_TEXT.processing,
        })
        this.setData({
          items: items.slice(),
          processingIndex: order + 1,
          processingName: current.name,
        })

        const target = targetBatchSize(current.originalWidth, current.originalHeight, edge.edge)
        let created = ''
        try {
          const path = await compressImage(
            current.originalPath,
            quality.quality,
            target.scaled ? target.width : null,
            target.scaled ? target.height : null,
          )
          created = path
          if (runtime.destroyed || runtime.cancelled) {
            unlinkQuietly(path)
            return
          }
          const size = await getFileSize(path)
          let width = target.width
          let height = target.height
          try {
            const info = await getImageInfo(path)
            width = info.width
            height = info.height
          } catch {
            /* 尺寸读取失败时沿用目标尺寸 */
          }
          if (runtime.destroyed || runtime.cancelled) {
            unlinkQuietly(path)
            return
          }
          const ratio =
            current.originalSize > 0 ? (1 - size / current.originalSize) * 100 : 0
          items[entry.index] = decorate({
            ...current,
            compressedPath: path,
            compressedSize: size,
            compressedWidth: width,
            compressedHeight: height,
            ratioValue: Math.max(0, ratio),
            savedText:
              ratio >= 0
                ? `已节省 ${ratio.toFixed(1)}%`
                : `体积增加 ${Math.abs(ratio).toFixed(1)}%`,
            status: 'done',
            statusText: STATUS_TEXT.done,
            error: '',
          })
        } catch (error) {
          unlinkQuietly(created)
          const message = error instanceof Error ? error.message : String(error)
          items[entry.index] = decorate({
            ...current,
            status: 'failed',
            statusText: STATUS_TEXT.failed,
            error: message || '压缩失败',
          })
        }
        this.setData({
          items: items.slice(),
          progressPercent: Math.round(((order + 1) / entries.length) * 100),
        })
      },
      () => runtime.destroyed || runtime.cancelled,
    )

    if (runtime.destroyed || seq !== runtime.seq) {
      return
    }
    if (result.cancelled) {
      cleanupPaths(items)
      this.setData({ ...initialData() })
      toast('已取消，临时文件已清理')
      return
    }
    this.finishBatch(items)
  },

  finishBatch(items: CompressItem[]) {
    const done = items.filter((item) => item.status === 'done')
    const failed = items.filter(
      (item) => item.status === 'failed' || item.status === 'rejected',
    )
    const original = done.reduce((sum, item) => sum + item.originalSize, 0)
    const compressed = done.reduce((sum, item) => sum + item.compressedSize, 0)
    const ratio = original > 0 ? (1 - compressed / original) * 100 : 0
    const sourceBytes = items.reduce((sum, item) => sum + item.originalSize, 0)
    const quality =
      QUALITIES.find((item) => item.key === this.data.qualityKey) ?? QUALITIES[1]
    const edge = EDGES.find((item) => item.key === this.data.edgeKey) ?? EDGES[1]
    const poster: IPosterData | null = done.length
      ? {
          toolName: '图片压缩',
          category: '图片处理',
          mainResult: `${Math.abs(ratio).toFixed(1)}%`,
          resultLabel: ratio >= 0 ? '总体积节省' : '总体积增加',
          params: [
            { label: '压缩质量', value: quality.label },
            { label: '最长边', value: edge.label },
            { label: '图片', value: `${done.length} / ${items.length} 张` },
          ],
          extras: [
            `原图合计 ${formatBytes(original)}`,
            `压缩后合计 ${formatBytes(compressed)}`,
            `首张 ${done[0].savedText}`,
          ],
        }
      : null

    this.setData({
      items,
      totalCount: items.length,
      doneCount: done.length,
      failedCount: failed.length,
      sourceTotalText: formatBytes(sourceBytes),
      totalOriginalText: original > 0 ? formatBytes(original) : '—',
      totalCompressedText: compressed > 0 ? formatBytes(compressed) : '—',
      totalSavedText:
        original > 0
          ? ratio >= 0
            ? `已节省 ${ratio.toFixed(1)}%`
            : `体积增加 ${Math.abs(ratio).toFixed(1)}%`
          : '',
      totalRatioValue: original > 0 ? Math.max(0, ratio) : 0,
      processingName: '',
      processingIndex: 0,
      progressPercent: done.length ? 100 : 0,
      compressing: false,
      cancelling: false,
      hasResult: items.length > 0,
      shellState: 'done',
      error: '',
      posterData: poster,
    })
  },

  onSaveItem(event: WechatMiniprogram.TouchEvent) {
    if (this.data.savingAll || this.data.savingId) {
      return
    }
    const id = String(event.currentTarget.dataset.id || '')
    const item = (this.data.items as CompressItem[]).find(
      (entry) => entry.id === id && entry.status === 'done',
    )
    if (!item || !item.compressedPath) {
      return
    }
    const runtime = this as unknown as CompressRuntime
    this.setData({ savingId: id })
    saveImageToAlbum(item.compressedPath)
      .then((ok) => {
        if (runtime.destroyed) {
          return
        }
        this.setData({ savingId: '' })
        if (ok) {
          toast('已保存到相册')
        }
      })
      .catch(() => {
        if (runtime.destroyed) {
          return
        }
        this.setData({ savingId: '' })
        toast('保存失败，请重试')
      })
  },

  async onSaveAll() {
    if (this.data.savingAll || this.data.savingId || this.data.compressing) {
      return
    }
    const targets = (this.data.items as CompressItem[]).filter(
      (item) => item.status === 'done' && item.compressedPath,
    )
    if (!targets.length) {
      toast('没有可保存的图片')
      return
    }
    const runtime = this as unknown as CompressRuntime
    this.setData({ savingAll: true })
    let saved = 0
    let failed = 0
    for (const item of targets) {
      if (runtime.destroyed) {
        break
      }
      this.setData({ savingId: item.id })
      const ok = await saveImageToAlbum(item.compressedPath)
      if (ok) {
        saved += 1
      } else {
        failed += 1
      }
    }
    if (runtime.destroyed) {
      return
    }
    this.setData({ savingAll: false, savingId: '' })
    if (failed > 0) {
      toast(`已保存 ${saved} 张，${failed} 张失败`)
    } else {
      tapSuccess()
      toast(`已保存 ${saved} 张到相册`)
    }
  },

  onCopyInfo() {
    const items = this.data.items as CompressItem[]
    const lines = [
      '图片压缩结果',
      `图片：${this.data.doneCount} / ${this.data.totalCount} 张完成`,
      `原图合计：${this.data.totalOriginalText}`,
      `压缩后合计：${this.data.totalCompressedText}`,
      this.data.totalSavedText,
      ...items.map((item, index) => {
        if (item.status === 'done') {
          return `${index + 1}. ${item.name}：${item.originalSizeText} → ${item.compressedSizeText}（${item.savedText}）`
        }
        return `${index + 1}. ${item.name}：${item.error || item.statusText}`
      }),
    ].filter((line) => Boolean(line))
    copyText(lines.join('\n'), '压缩信息已复制')
  },

  onExample() {
    this.onChoose()
  },

  onReset() {
    if (this.data.compressing) {
      toast('正在处理，请先取消')
      return
    }
    if (this.data.savingAll || this.data.savingId) {
      toast('正在保存，请稍候')
      return
    }
    cleanupPaths(this.data.items as CompressItem[])
    this.setData({ ...initialData() })
  },
})
