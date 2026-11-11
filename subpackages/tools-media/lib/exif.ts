/* ==========================================================================
   图片信息 · 尺寸 / 体积 / 格式 / 方向
   - 只读取 wx.getImageInfo 暴露的元信息与文件大小
   - 不解析 GPS、设备型号、拍摄时间等 EXIF 隐私字段
   - 纯函数归一化，可在 Node 单测；wx 调用只出现在 readImageMeta
   ========================================================================== */

export interface ImageMetaInput {
  width?: unknown
  height?: unknown
  size?: unknown
  type?: unknown
  orientation?: unknown
  path?: unknown
}

export interface ImageMeta {
  width: number
  height: number
  widthText: string
  size: number
  sizeText: string
  type: string
  typeLabel: string
  orientation: string
  orientationLabel: string
  ratioText: string
  megapixelsText: string
  path: string
  fileName: string
}

const TYPE_LABELS: Record<string, string> = {
  jpg: 'JPEG',
  jpeg: 'JPEG',
  png: 'PNG',
  gif: 'GIF',
  webp: 'WebP',
  bmp: 'BMP',
  heic: 'HEIC',
  heif: 'HEIF',
  avif: 'AVIF',
  svg: 'SVG',
}

const ORIENTATION_LABELS: Record<string, string> = {
  up: '正常',
  down: '旋转 180°',
  left: '逆时针 90°',
  right: '顺时针 90°',
  'up-mirrored': '水平镜像',
  'down-mirrored': '垂直镜像',
  'left-mirrored': '逆时针 90° + 镜像',
  'right-mirrored': '顺时针 90° + 镜像',
}

function safeInt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0
  }
  const rounded = Math.floor(value)
  return rounded > 0 ? rounded : 0
}

/** 字节 → 可读体积；与图片工具文案保持一致 */
export function formatImageSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '—'
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function fileNameOf(path: string): string {
  if (!path) {
    return ''
  }
  const clean = path.split('?')[0]
  const name = clean.split('/').pop() ?? ''
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

function extensionOf(path: string): string {
  const name = fileNameOf(path)
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** 格式标签：优先 wx 返回值，缺失时从文件扩展名回退 */
export function typeLabelOf(type: unknown, path: string): string {
  const raw = (typeof type === 'string' ? type : '').toLowerCase().replace(/^image\//, '')
  const key = raw || extensionOf(path)
  return TYPE_LABELS[key] ?? (key ? key.toUpperCase() : '未知')
}

export function orientationLabelOf(orientation: unknown): string {
  const key = typeof orientation === 'string' ? orientation.toLowerCase() : ''
  return ORIENTATION_LABELS[key] ?? '未知'
}

function gcd(left: number, right: number): number {
  let a = left
  let b = right
  while (b) {
    const next = a % b
    a = b
    b = next
  }
  return a
}

/** 宽高比：能约成小整数时显示 4 : 3，否则退化为 1.50 : 1 */
export function aspectRatioText(width: number, height: number): string {
  if (width <= 0 || height <= 0) {
    return '—'
  }
  const divisor = gcd(width, height)
  const left = width / divisor
  const right = height / divisor
  if (left <= 40 && right <= 40) {
    return `${left} : ${right}`
  }
  const ratio = width / height
  return `${ratio >= 10 ? ratio.toFixed(1) : ratio.toFixed(2)} : 1`
}

export function megapixelsText(width: number, height: number): string {
  const wan = (width * height) / 10000
  return wan >= 100 ? `${Math.round(wan)} 万像素` : `${wan.toFixed(1)} 万像素`
}

/**
 * 归一化图片元信息
 * - 宽高缺失 / 为 0 / 非有限数视为损坏文件，返回 null
 * - size 缺失按 0 处理，展示为“—”
 */
export function normalizeImageMeta(input: ImageMetaInput | null | undefined): ImageMeta | null {
  if (!input || typeof input !== 'object') {
    return null
  }
  const width = safeInt(input.width)
  const height = safeInt(input.height)
  if (!width || !height) {
    return null
  }
  const size = safeInt(input.size)
  const path = typeof input.path === 'string' ? input.path : ''
  const type = typeof input.type === 'string' ? input.type.toLowerCase() : ''
  const orientation =
    typeof input.orientation === 'string' && input.orientation
      ? input.orientation.toLowerCase()
      : 'up'
  return {
    width,
    height,
    widthText: `${width} × ${height}`,
    size,
    sizeText: formatImageSize(size),
    type,
    typeLabel: typeLabelOf(type, path),
    orientation,
    orientationLabel: orientationLabelOf(orientation),
    ratioText: aspectRatioText(width, height),
    megapixelsText: megapixelsText(width, height),
    path,
    fileName: fileNameOf(path) || '本地图片',
  }
}

/** 复制 / 流转摘要：尺寸 · 格式 · 体积（非正向时附方向） */
export function exifSummary(meta: ImageMeta): string {
  const parts = [meta.widthText, meta.typeLabel, meta.sizeText]
  if (meta.orientation !== 'up') {
    parts.push(`方向 ${meta.orientationLabel}`)
  }
  return parts.join(' · ')
}

function fileSizeOf(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    try {
      wx.getFileSystemManager().getFileInfo({
        filePath,
        success: (result) => {
          const size = typeof result.size === 'number' && result.size > 0 ? result.size : 0
          resolve(size)
        },
        fail: () => resolve(0),
      })
    } catch {
      resolve(0)
    }
  })
}

/** 读取本地图片元信息；失败时抛出可直接展示的中文错误 */
export function readImageMeta(filePath: string): Promise<ImageMeta> {
  if (!filePath) {
    return Promise.reject(new Error('请先选择图片'))
  }
  return new Promise((resolve, reject) => {
    try {
      wx.getImageInfo({
        src: filePath,
        success: (info) => {
          void fileSizeOf(filePath).then((size) => {
            const meta = normalizeImageMeta({
              width: info.width,
              height: info.height,
              size,
              type: (info as unknown as { type?: string }).type,
              orientation: info.orientation,
              path: filePath,
            })
            if (!meta) {
              reject(new Error('图片信息不完整，文件可能已损坏'))
              return
            }
            resolve(meta)
          })
        },
        fail: () => reject(new Error('图片读取失败，请换一张 JPG / PNG')),
      })
    } catch {
      reject(new Error('当前环境不支持读取图片信息'))
    }
  })
}
