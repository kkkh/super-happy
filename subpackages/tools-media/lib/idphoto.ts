/* ==========================================================================
   证件照智能换底引擎 · 纯函数
   - 不再拒绝复杂背景：边缘自适应背景模型 + 漫水填充 + 边缘保护 + Alpha 抠图
   - 背景模型只从顶部与左右上半区采样，避开肩部衣物；底部仅作匹配种子
   - 支持纯色 / 渐变 / 纹理 / 复杂背景；可调容差、边缘保护与羽化
   - 只做像素级处理，不读取人脸、不提取特征、不上传
   ========================================================================== */

export type IdPhotoBackgroundKey = 'white' | 'blue' | 'red'

export interface Rgb {
  r: number
  g: number
  b: number
}

export interface IdPhotoBackground {
  key: IdPhotoBackgroundKey
  label: string
  hex: string
  rgb: Rgb
}

export const ID_PHOTO_BACKGROUNDS: IdPhotoBackground[] = [
  {
    key: 'white',
    label: '白底',
    hex: '#FFFFFF',
    rgb: { r: 255, g: 255, b: 255 },
  },
  {
    key: 'blue',
    label: '蓝底',
    hex: '#438EDB',
    rgb: { r: 67, g: 142, b: 219 },
  },
  {
    key: 'red',
    label: '红底',
    hex: '#D9001B',
    rgb: { r: 217, g: 0, b: 27 },
  },
]

export const ID_PHOTO_MAX_SOURCE_PIXELS = 12 * 1000 * 1000
export const ID_PHOTO_MAX_OUTPUT_EDGE = 1200
export const ID_PHOTO_DEFAULT_TOLERANCE = 28
export const ID_PHOTO_DEFAULT_FEATHER = 2
export const ID_PHOTO_DEFAULT_EDGE_PROTECT = 60

/** 背景模型边缘采样时允许的 YCbCr 距离 */
const MODEL_MATCH_DISTANCE = 26
/** 最多保留的背景色簇数量 */
const MAX_CLUSTERS = 6

export type IdPhotoBackgroundType = 'solid' | 'gradient' | 'textured' | 'complex'
export type IdPhotoConfidence = 'high' | 'medium' | 'low'

export interface IdPhotoAnalysis {
  ok: boolean
  background: Rgb
  backgroundType: IdPhotoBackgroundType
  confidence: IdPhotoConfidence
  /** 边缘像素到最近背景簇的最大距离 */
  maxDistance: number
  /** 边缘像素到最近背景簇的平均距离 */
  borderSpread: number
  clusterCount: number
}

export interface IdPhotoMatteOptions {
  /** 背景容差 10–60，默认 28 */
  tolerance?: number
  /** 羽化半径 0–6，默认 2；0 表示硬边 */
  featherRadius?: number
  /** 边缘保护 0–100，默认 60；越高越不容易吃到头发与肩线 */
  edgeProtect?: number
}

export interface IdPhotoMatteResult {
  data: Uint8ClampedArray
  changed: number
  removedRatio: number
  featherRadius: number
  threshold: number
  backgroundType: IdPhotoBackgroundType
  confidence: IdPhotoConfidence
  clusterCount: number
}

export interface IdPhotoOutputSize {
  width: number
  height: number
  scale: number
}

interface YCbCr {
  y: number
  cb: number
  cr: number
}

interface Cluster extends YCbCr, Rgb {
  count: number
}

interface BorderModel {
  analysis: IdPhotoAnalysis
  clusters: Cluster[]
  yBuf: Uint8Array
  cbBuf: Uint8Array
  crBuf: Uint8Array
  edge: Uint8Array
  expectedY: Uint8Array
  expectedCb: Uint8Array
  expectedCr: Uint8Array
  width: number
  height: number
}

export function idPhotoBackgroundByKey(key: string): IdPhotoBackground | null {
  return ID_PHOTO_BACKGROUNDS.find((item) => item.key === key) ?? null
}

export function rgbDistance(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b)
}

/** 输出尺寸：长边不超过 1200，保持原比例；不放大 */
export function idPhotoOutputSize(width: number, height: number): IdPhotoOutputSize | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }
  const longEdge = Math.max(width, height)
  const scale = longEdge > ID_PHOTO_MAX_OUTPUT_EDGE ? ID_PHOTO_MAX_OUTPUT_EDGE / longEdge : 1
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  }
}

/** 默认羽化半径：输出长边 ×2/1000，至少 1px */
export function idPhotoFeatherRadius(longEdge: number): number {
  if (!Number.isFinite(longEdge) || longEdge <= 0) {
    return 1
  }
  return Math.max(1, Math.round(longEdge * 0.002))
}

function clampByte(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : Math.round(value)
}

function toYCbCr(r: number, g: number, b: number): YCbCr {
  return {
    y: clampByte(0.299 * r + 0.587 * g + 0.114 * b),
    cb: clampByte(128 - 0.168736 * r - 0.331264 * g + 0.5 * b),
    cr: clampByte(128 + 0.5 * r - 0.418688 * g - 0.081312 * b),
  }
}

/** YCbCr 加权距离平方：色度权重更高，对阴影更宽容 */
function yccDistanceSq(a: YCbCr, b: YCbCr): number {
  const dy = a.y - b.y
  const dcb = a.cb - b.cb
  const dcr = a.cr - b.cr
  return dy * dy * 0.64 + (dcb * dcb + dcr * dcr) * 1.21
}

function nearestClusterDistanceSq(
  y: number,
  cb: number,
  cr: number,
  clusters: readonly Cluster[],
): { distance: number; cluster: Cluster | null } {
  let best = Number.POSITIVE_INFINITY
  let bestCluster: Cluster | null = null
  for (const cluster of clusters) {
    const dy = y - cluster.y
    const dcb = cb - cluster.cb
    const dcr = cr - cluster.cr
    const distance = dy * dy * 0.64 + (dcb * dcb + dcr * dcr) * 1.21
    if (distance < best) {
      best = distance
      bestCluster = cluster
    }
  }
  return { distance: best, cluster: bestCluster }
}

/** 可分离盒式模糊 alpha（0–1） */
function blurAlpha(
  alpha: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  if (radius <= 0) {
    return alpha
  }
  const window = radius * 2 + 1
  const temp = new Float32Array(width * height)
  const result = new Float32Array(width * height)
  for (let y = 0; y < height; y += 1) {
    const row = y * width
    for (let x = 0; x < width; x += 1) {
      let sum = 0
      for (let offset = -radius; offset <= radius; offset += 1) {
        sum += alpha[row + Math.min(width - 1, Math.max(0, x + offset))]
      }
      temp[row + x] = sum / window
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0
      for (let offset = -radius; offset <= radius; offset += 1) {
        sum += temp[Math.min(height - 1, Math.max(0, y + offset)) * width + x]
      }
      result[y * width + x] = sum / window
    }
  }
  return result
}

function validPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): boolean {
  return (
    Boolean(data) &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width >= 8 &&
    height >= 8 &&
    data.length >= width * height * 4
  )
}

/** 从顶部外圈与左右上半区建立背景色簇，避开肩部衣物与顶部头发 */
function buildClusters(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  band: number,
): {
  clusters: Cluster[]
  samples: number
  maxDistance: number
  spread: number
  neighborVariation: number
} {
  const bins = 32768
  const counts = new Uint32Array(bins)
  const sumR = new Float32Array(bins)
  const sumG = new Float32Array(bins)
  const sumB = new Float32Array(bins)
  let samples = 0
  const upper = Math.max(band, Math.floor(height * 0.78))
  const leftOuter = Math.floor(width * 0.4)
  const rightOuter = Math.ceil(width * 0.6)

  const addPixel = (x: number, y: number): void => {
    const offset = (y * width + x) * 4
    const r = data[offset]
    const g = data[offset + 1]
    const b = data[offset + 2]
    const bin = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
    counts[bin] += 1
    sumR[bin] += r
    sumG[bin] += g
    sumB[bin] += b
    samples += 1
  }

  /* 顶部只取左右外圈，避免把顶部头发当成背景 */
  for (let y = 0; y < band; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x < leftOuter || x >= rightOuter) {
        addPixel(x, y)
      }
    }
  }
  /* 左右只取上半区，避开肩部与衣领 */
  for (let x = 0; x < band; x += 1) {
    for (let y = 0; y < upper; y += 1) {
      addPixel(x, y)
      addPixel(width - 1 - x, y)
    }
  }

  const minimum = Math.max(2, Math.round(samples * 0.004))
  const ranked: number[] = []
  for (let bin = 0; bin < bins; bin += 1) {
    if (counts[bin] >= minimum) {
      ranked.push(bin)
    }
  }
  ranked.sort((a, b) => counts[b] - counts[a])

  const clusters: Cluster[] = []
  for (const bin of ranked) {
    const count = counts[bin]
    if (count <= 0) {
      continue
    }
    const r = sumR[bin] / count
    const g = sumG[bin] / count
    const b = sumB[bin] / count
    const ycc = toYCbCr(r, g, b)
    const near = clusters.some((cluster) => yccDistanceSq(cluster, ycc) < 100)
    if (near) {
      continue
    }
    clusters.push({ r, g, b, count, ...ycc })
    if (clusters.length >= MAX_CLUSTERS) {
      break
    }
  }
  if (clusters.length === 0) {
    let r = 0
    let g = 0
    let b = 0
    for (let bin = 0; bin < bins; bin += 1) {
      if (counts[bin] > 0) {
        r += sumR[bin]
        g += sumG[bin]
        b += sumB[bin]
      }
    }
    const total = Math.max(1, samples)
    const ycc = toYCbCr(r / total, g / total, b / total)
    clusters.push({ r: r / total, g: g / total, b: b / total, count: total, ...ycc })
  }

  /* 边缘离散度：采样区像素到最近簇的距离 */
  let total = 0
  let max = 0
  const scan = (x: number, y: number): void => {
    const offset = (y * width + x) * 4
    const ycc = toYCbCr(data[offset], data[offset + 1], data[offset + 2])
    const { distance } = nearestClusterDistanceSq(ycc.y, ycc.cb, ycc.cr, clusters)
    const value = Math.sqrt(distance)
    total += value
    if (value > max) {
      max = value
    }
  }
  for (let y = 0; y < band; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x < leftOuter || x >= rightOuter) {
        scan(x, y)
      }
    }
  }
  for (let x = 0; x < band; x += 1) {
    for (let y = 0; y < upper; y += 1) {
      scan(x, y)
      scan(width - 1 - x, y)
    }
  }

  return {
    clusters,
    samples,
    maxDistance: max,
    spread: samples > 0 ? total / samples : 0,
    neighborVariation: measureNeighborVariation(data, width, upper, band),
  }
}

/** 边缘相邻像素平均色差，用来区分纯色 / 渐变与纹理背景 */
function measureNeighborVariation(
  data: Uint8ClampedArray,
  width: number,
  upper: number,
  band: number,
): number {
  let total = 0
  let count = 0
  const delta = (a: number, b: number): number => {
    const ao = a * 4
    const bo = b * 4
    return (
      (Math.abs(data[ao] - data[bo]) +
        Math.abs(data[ao + 1] - data[bo + 1]) +
        Math.abs(data[ao + 2] - data[bo + 2])) /
      3
    )
  }
  for (let y = 0; y < band; y += 1) {
    for (let x = 1; x < width; x += 1) {
      total += delta(y * width + x - 1, y * width + x)
      count += 1
    }
  }
  for (let x = 0; x < band; x += 1) {
    for (let y = 1; y < upper; y += 1) {
      total += delta((y - 1) * width + x, y * width + x)
      total += delta((y - 1) * width + (width - 1 - x), y * width + (width - 1 - x))
      count += 2
    }
  }
  return count > 0 ? total / count : 0
}

/** 对单条边缘按背景簇过滤后求平均；没有匹配时返回 null */
function edgeAverage(
  data: Uint8ClampedArray,
  width: number,
  clusters: readonly Cluster[],
  points: readonly number[],
): Rgb | null {
  let r = 0
  let g = 0
  let b = 0
  let count = 0
  const limit = MODEL_MATCH_DISTANCE * MODEL_MATCH_DISTANCE
  for (const point of points) {
    const offset = point * 4
    const ycc = toYCbCr(data[offset], data[offset + 1], data[offset + 2])
    const { distance } = nearestClusterDistanceSq(ycc.y, ycc.cb, ycc.cr, clusters)
    if (distance <= limit) {
      r += data[offset]
      g += data[offset + 1]
      b += data[offset + 2]
      count += 1
    }
  }
  if (count === 0) {
    return null
  }
  return { r: r / count, g: g / count, b: b / count }
}

function buildBorderAverages(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  band: number,
  clusters: readonly Cluster[],
): {
  top: Rgb[]
  bottom: Rgb[]
  left: Rgb[]
  right: Rgb[]
} {
  const fallback = clusters[0]
    ? { r: clusters[0].r, g: clusters[0].g, b: clusters[0].b }
    : { r: 255, g: 255, b: 255 }

  const top: Rgb[] = new Array(width)
  const bottom: Rgb[] = new Array(width)
  const left: Rgb[] = new Array(height)
  const right: Rgb[] = new Array(height)

  for (let x = 0; x < width; x += 1) {
    const points: number[] = []
    for (let y = 0; y < band; y += 1) {
      points.push(y * width + x)
    }
    top[x] = edgeAverage(data, width, clusters, points) ?? fallback
  }

  let lastTop = fallback
  for (let x = 0; x < width; x += 1) {
    if (top[x]) {
      lastTop = top[x]
    } else {
      top[x] = lastTop
    }
  }
  let nextTop = fallback
  for (let x = width - 1; x >= 0; x -= 1) {
    if (top[x]) {
      nextTop = top[x]
    } else {
      top[x] = nextTop
    }
  }

  for (let x = 0; x < width; x += 1) {
    const points: number[] = []
    for (let y = height - band; y < height; y += 1) {
      points.push(y * width + x)
    }
    bottom[x] = edgeAverage(data, width, clusters, points) ?? top[x]
  }

  let lastLeft = fallback
  for (let y = 0; y < height; y += 1) {
    const points: number[] = []
    for (let x = 0; x < band; x += 1) {
      points.push(y * width + x)
    }
    const average = edgeAverage(data, width, clusters, points)
    if (average) {
      lastLeft = average
    }
    left[y] = lastLeft
  }

  let lastRight = fallback
  for (let y = 0; y < height; y += 1) {
    const points: number[] = []
    for (let x = width - band; x < width; x += 1) {
      points.push(y * width + x)
    }
    const average = edgeAverage(data, width, clusters, points)
    if (average) {
      lastRight = average
    }
    right[y] = lastRight
  }

  return { top, bottom, left, right }
}

function buildModel(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): BorderModel | null {
  if (!validPixels(data, width, height)) {
    return null
  }
  const count = width * height
  const band = Math.max(2, Math.min(24, Math.round(Math.min(width, height) * 0.02)))
  const yBuf = new Uint8Array(count)
  const cbBuf = new Uint8Array(count)
  const crBuf = new Uint8Array(count)

  for (let index = 0; index < count; index += 1) {
    const offset = index * 4
    const ycc = toYCbCr(data[offset], data[offset + 1], data[offset + 2])
    yBuf[index] = ycc.y
    cbBuf[index] = ycc.cb
    crBuf[index] = ycc.cr
  }

  const edge = new Uint8Array(count)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      const left = x > 0 ? index - 1 : index
      const right = x < width - 1 ? index + 1 : index
      const up = y > 0 ? index - width : index
      const down = y < height - 1 ? index + width : index
      const dy = Math.abs(yBuf[right] - yBuf[left]) + Math.abs(yBuf[down] - yBuf[up])
      const dcb =
        Math.abs(cbBuf[right] - cbBuf[left]) + Math.abs(cbBuf[down] - cbBuf[up])
      const dcr =
        Math.abs(crBuf[right] - crBuf[left]) + Math.abs(crBuf[down] - crBuf[up])
      edge[index] = Math.min(255, Math.round(dy * 0.6 + dcb * 0.7 + dcr * 0.7))
    }
  }

  const model = buildClusters(data, width, height, band)
  const averages = buildBorderAverages(data, width, height, band, model.clusters)

  const topY = new Uint8Array(width)
  const topCb = new Uint8Array(width)
  const topCr = new Uint8Array(width)
  const bottomY = new Uint8Array(width)
  const bottomCb = new Uint8Array(width)
  const bottomCr = new Uint8Array(width)
  const leftY = new Uint8Array(height)
  const leftCb = new Uint8Array(height)
  const leftCr = new Uint8Array(height)
  const rightY = new Uint8Array(height)
  const rightCb = new Uint8Array(height)
  const rightCr = new Uint8Array(height)

  for (let x = 0; x < width; x += 1) {
    const t = toYCbCr(averages.top[x].r, averages.top[x].g, averages.top[x].b)
    topY[x] = t.y
    topCb[x] = t.cb
    topCr[x] = t.cr
    const b = toYCbCr(averages.bottom[x].r, averages.bottom[x].g, averages.bottom[x].b)
    bottomY[x] = b.y
    bottomCb[x] = b.cb
    bottomCr[x] = b.cr
  }
  for (let y = 0; y < height; y += 1) {
    const l = toYCbCr(averages.left[y].r, averages.left[y].g, averages.left[y].b)
    leftY[y] = l.y
    leftCb[y] = l.cb
    leftCr[y] = l.cr
    const r = toYCbCr(averages.right[y].r, averages.right[y].g, averages.right[y].b)
    rightY[y] = r.y
    rightCb[y] = r.cb
    rightCr[y] = r.cr
  }

  const expectedY = new Uint8Array(count)
  const expectedCb = new Uint8Array(count)
  const expectedCr = new Uint8Array(count)
  for (let y = 0; y < height; y += 1) {
    const ty = height > 1 ? y / (height - 1) : 0
    const row = y * width
    for (let x = 0; x < width; x += 1) {
      const tx = width > 1 ? x / (width - 1) : 0
      const vY = topY[x] * (1 - ty) + bottomY[x] * ty
      const vCb = topCb[x] * (1 - ty) + bottomCb[x] * ty
      const vCr = topCr[x] * (1 - ty) + bottomCr[x] * ty
      const hY = leftY[y] * (1 - tx) + rightY[y] * tx
      const hCb = leftCb[y] * (1 - tx) + rightCb[y] * tx
      const hCr = leftCr[y] * (1 - tx) + rightCr[y] * tx
      const wx = Math.abs(tx - 0.5)
      const wy = Math.abs(ty - 0.5)
      const weightVertical = Math.min(0.8, Math.max(0.2, 0.5 + (wx - wy) * 0.8))
      expectedY[row + x] = clampByte(vY * weightVertical + hY * (1 - weightVertical))
      expectedCb[row + x] = clampByte(vCb * weightVertical + hCb * (1 - weightVertical))
      expectedCr[row + x] = clampByte(vCr * weightVertical + hCr * (1 - weightVertical))
    }
  }

  const corners = [
    averages.top[0],
    averages.top[width - 1],
    averages.bottom[0],
    averages.bottom[width - 1],
  ]
  let edgeVariation = 0
  for (let i = 0; i < corners.length; i += 1) {
    for (let j = i + 1; j < corners.length; j += 1) {
      edgeVariation = Math.max(edgeVariation, rgbDistance(corners[i], corners[j]))
    }
  }

  let backgroundType: IdPhotoBackgroundType
  if (model.neighborVariation > 4) {
    backgroundType = 'textured'
  } else if (edgeVariation > 160) {
    backgroundType = 'complex'
  } else if (edgeVariation > 22) {
    backgroundType = 'gradient'
  } else if (model.clusters.length >= 4 && edgeVariation > 10) {
    backgroundType = 'gradient'
  } else {
    backgroundType = 'solid'
  }
  let confidence: IdPhotoConfidence
  if (backgroundType === 'solid') {
    confidence = 'high'
  } else if (backgroundType === 'gradient') {
    confidence = edgeVariation <= 120 ? 'high' : 'medium'
  } else if (backgroundType === 'textured') {
    confidence = model.maxDistance <= 90 ? 'medium' : 'low'
  } else {
    confidence = 'low'
  }

  let weight = 0
  let r = 0
  let g = 0
  let b = 0
  for (const cluster of model.clusters) {
    weight += cluster.count
    r += cluster.r * cluster.count
    g += cluster.g * cluster.count
    b += cluster.b * cluster.count
  }
  weight = weight || 1
  const background = {
    r: clampByte(r / weight),
    g: clampByte(g / weight),
    b: clampByte(b / weight),
  }

  return {
    analysis: {
      ok: true,
      background,
      backgroundType,
      confidence,
      maxDistance: model.maxDistance,
      borderSpread: model.spread,
      clusterCount: model.clusters.length,
    },
    clusters: model.clusters,
    yBuf,
    cbBuf,
    crBuf,
    edge,
    expectedY,
    expectedCb,
    expectedCr,
    width,
    height,
  }
}

/** 只分析背景类型与置信度，不执行换底 */
export function analyzeIdPhotoBackground(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): IdPhotoAnalysis | null {
  const model = buildModel(data, width, height)
  return model ? model.analysis : null
}

/** 漫水填充：只从图像边缘向内扩散，避免删掉人物内部的近色区域 */
function floodBackground(
  model: BorderModel,
  threshold: number,
  edgeLimit: number,
): { mask: Uint8Array; count: number } {
  const { width, height, yBuf, cbBuf, crBuf, edge, clusters } = model
  const count = width * height
  const mask = new Uint8Array(count)
  const queue = new Int32Array(count)
  let head = 0
  let tail = 0
  const thresholdSq = threshold * threshold
  const seedSq = thresholdSq * 1.44
  const cx = width / 2
  const cy = height * 0.6
  const rx = width * 0.45
  const ry = height * 0.55

  const distanceSq = (index: number): number => {
    const dy = yBuf[index] - model.expectedY[index]
    const dcb = cbBuf[index] - model.expectedCb[index]
    const dcr = crBuf[index] - model.expectedCr[index]
    let best = dy * dy * 0.64 + (dcb * dcb + dcr * dcr) * 1.21
    for (const cluster of clusters) {
      const cdY = yBuf[index] - cluster.y
      const cdCb = cbBuf[index] - cluster.cb
      const cdCr = crBuf[index] - cluster.cr
      const next = cdY * cdY * 0.64 + (cdCb * cdCb + cdCr * cdCr) * 1.21
      if (next < best) {
        best = next
      }
    }
    return best
  }

  const prior = (x: number, y: number): number => {
    const nx = (x - cx) / rx
    const ny = (y - cy) / ry
    return nx * nx + ny * ny < 1 ? 0.85 : 1.05
  }

  const tryPush = (index: number, x: number, y: number): void => {
    if (mask[index]) {
      return
    }
    const distance = distanceSq(index)
    const limit = thresholdSq * prior(x, y)
    if (distance > limit) {
      return
    }
    if (edge[index] > edgeLimit && distance > limit * 0.2) {
      return
    }
    mask[index] = 1
    queue[tail++] = index
  }

  for (let x = 0; x < width; x += 1) {
    if (distanceSq(x) <= seedSq) {
      mask[x] = 1
      queue[tail++] = x
    }
    const bottom = (height - 1) * width + x
    if (distanceSq(bottom) <= seedSq) {
      mask[bottom] = 1
      queue[tail++] = bottom
    }
  }
  for (let y = 0; y < height; y += 1) {
    const left = y * width
    if (distanceSq(left) <= seedSq) {
      mask[left] = 1
      queue[tail++] = left
    }
    const right = y * width + width - 1
    if (distanceSq(right) <= seedSq) {
      mask[right] = 1
      queue[tail++] = right
    }
  }

  while (head < tail) {
    const index = queue[head++]
    const x = index % width
    const y = (index - x) / width
    if (x > 0) {
      tryPush(index - 1, x - 1, y)
    }
    if (x < width - 1) {
      tryPush(index + 1, x + 1, y)
    }
    if (y > 0) {
      tryPush(index - width, x, y - 1)
    }
    if (y < height - 1) {
      tryPush(index + width, x, y + 1)
    }
  }

  let removed = 0
  for (let index = 0; index < count; index += 1) {
    if (mask[index]) {
      removed += 1
    }
  }
  return { mask, count: removed }
}

/**
 * 智能换底：
 * - 边缘背景模型 + 漫水填充，支持纯色 / 渐变 / 纹理 / 复杂背景
 * - 只替换与边缘连通的背景，保留人物内部的近色衣物
 * - 边缘保护与 Alpha 羽化，减少发丝与肩线的硬边
 */
export function autoReplaceIdPhotoBackground(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  target: Rgb,
  options: IdPhotoMatteOptions = {},
): IdPhotoMatteResult | null {
  const model = buildModel(data, width, height)
  if (!model) {
    return null
  }
  const count = width * height
  const tolerance = Math.min(64, Math.max(8, Math.round(options.tolerance ?? ID_PHOTO_DEFAULT_TOLERANCE)))
  const feather = Math.min(6, Math.max(0, Math.round(options.featherRadius ?? ID_PHOTO_DEFAULT_FEATHER)))
  const protect = Math.min(100, Math.max(0, options.edgeProtect ?? ID_PHOTO_DEFAULT_EDGE_PROTECT))
  const typeFactor =
    model.analysis.backgroundType === 'complex'
      ? 1.4
      : model.analysis.backgroundType === 'textured'
        ? 1.2
        : model.analysis.backgroundType === 'gradient'
          ? 1.05
          : 1
  const threshold = tolerance * typeFactor
  const baseEdge = 20 + (100 - protect) * 1.6
  const edgeLimit =
    baseEdge * (model.analysis.backgroundType === 'textured' || model.analysis.backgroundType === 'complex' ? 1.35 : 1)

  let result = floodBackground(model, threshold, edgeLimit)
  if (result.count < count * 0.01) {
    const aggressive = floodBackground(model, threshold * 1.6, edgeLimit * 1.3)
    if (aggressive.count > result.count) {
      result = aggressive
    }
  } else if (result.count > count * 0.94) {
    const conservative = floodBackground(model, threshold * 0.7, edgeLimit * 0.6)
    if (conservative.count < result.count) {
      result = conservative
    }
  }

  /* 去除抗锯齿彩边：只把贴近背景或弱边缘的前景边界并入背景 */
  const dilated = new Uint8Array(result.mask)
  const thresholdSq = threshold * threshold
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      if (result.mask[index]) {
        continue
      }
      const nearBackground =
        (x > 0 && result.mask[index - 1]) ||
        (x < width - 1 && result.mask[index + 1]) ||
        (y > 0 && result.mask[index - width]) ||
        (y < height - 1 && result.mask[index + width])
      if (!nearBackground) {
        continue
      }
      const dy = model.yBuf[index] - model.expectedY[index]
      const dcb = model.cbBuf[index] - model.expectedCb[index]
      const dcr = model.crBuf[index] - model.expectedCr[index]
      const distance = dy * dy * 0.64 + (dcb * dcb + dcr * dcr) * 1.21
      if (distance <= thresholdSq * 2.2 || model.edge[index] < edgeLimit * 0.6) {
        dilated[index] = 1
      }
    }
  }

  const alpha = new Float32Array(count)
  let removed = 0
  for (let index = 0; index < count; index += 1) {
    if (dilated[index]) {
      alpha[index] = 0
      removed += 1
    } else {
      alpha[index] = 1
    }
  }
  const softened = blurAlpha(alpha, width, height, feather)

  const output = new Uint8ClampedArray(data)
  let changed = 0
  for (let index = 0; index < count; index += 1) {
    const a = softened[index]
    if (a >= 0.999) {
      continue
    }
    const offset = index * 4
    const weight = 1 - a
    const nextR = data[offset] * a + target.r * weight
    const nextG = data[offset + 1] * a + target.g * weight
    const nextB = data[offset + 2] * a + target.b * weight
    output[offset] = clampByte(nextR)
    output[offset + 1] = clampByte(nextG)
    output[offset + 2] = clampByte(nextB)
    output[offset + 3] = data[offset + 3]
    if (
      output[offset] !== data[offset] ||
      output[offset + 1] !== data[offset + 1] ||
      output[offset + 2] !== data[offset + 2]
    ) {
      changed += 1
    }
  }

  const removedRatio = removed / count
  let confidence = model.analysis.confidence
  if (removedRatio < 0.015 || removedRatio > 0.97) {
    confidence = 'low'
  }

  return {
    data: output,
    changed,
    removedRatio,
    featherRadius: feather,
    threshold,
    backgroundType: model.analysis.backgroundType,
    confidence,
    clusterCount: model.analysis.clusterCount,
  }
}
