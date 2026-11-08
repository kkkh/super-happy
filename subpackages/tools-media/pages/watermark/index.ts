/* ==========================================================================
   水印工作台 · 旗舰级全能水印与防伪工作台
   - 选图即压缩：wx.getImageInfo + wx.compressImage / 离屏缩放，最大边 2000px
   - 预览双通道：DOM 图层负责 60fps 手势，隐藏 Canvas 负责真实合成与导出
   - 手势：单指拖拽、双指捏合 / 旋转 / 焦点补偿，全部在 gesture.wxs 内完成
   - 图层：多行文字（描边 / 底框 / 字间距 / 行间距 / 平铺 / 图章）+ 图片 Logo + 打码
   - 打码：马赛克与高斯模糊，框选区域，画布按 DPR 缩放绘制
   - 历史：每次手势结束 / 控件落定入栈，支持撤销与重做
   - 隐私：选图与保存全部走 ensurePrivacyAuthorized 前置拦截
   ========================================================================== */
import { createStoreBindings } from 'mobx-miniprogram-bindings'
import { uiStore } from '../../../../core/stores/ui'
import { toolboxStore } from '../../../../core/toolbox/store'
import { LIMITS } from '../../../../core/constants/index'
import { tapSuccess, tapTick, tapWarn } from '../../../../core/utils/haptics'
import { isDevtools } from '../../../../core/utils/platform'
import {
  chooseSingleImage,
  getImageInfo,
  saveImageToAlbum,
} from '../../lib/image'
import { toast } from '../../lib/ui'
import { useTracker } from '../../../../core/toolbox/tracker'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IWorkflowData } from '../../../../core/workflow/types'
import { workflowStore } from '../../../../core/workflow/workflowStore'

type WorkCtx = WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D
type WorkCanvas = WechatMiniprogram.Canvas | WechatMiniprogram.OffscreenCanvas
type WorkImage = ReturnType<WechatMiniprogram.OffscreenCanvas['createImage']>

type WatermarkTab = 'text' | 'logo' | 'mask' | 'preset'
type ActiveLayer = 'text' | 'logo' | ''
type MaskKind = 'mosaic' | 'blur'

interface TextLayer {
  text: string
  /** 中心点，相对整张图的百分比 */
  x: number
  y: number
  scale: number
  rotation: number
  /** 以 1000px 图宽为基准的字号 */
  fontSize: number
  color: string
  /** 以 1000px 图宽为基准的字间距 */
  letterSpacing: number
  lineHeight: number
  /** 0 – 100 */
  opacity: number
  outline: boolean
  bgEnabled: boolean
  /** 底框不透明度 0 – 100 */
  bgOpacity: number
  shadow: boolean
  tile: boolean
  stamp: boolean
}

interface LogoLayer {
  src: string
  x: number
  y: number
  /** Logo 宽度占整图宽度的比例 0.05 – 0.6 */
  scale: number
  rotation: number
  opacity: number
  /** 高宽比，绘制时保持原比例 */
  aspect: number
}

interface MaskRegion {
  id: string
  x: number
  y: number
  w: number
  h: number
  kind: MaskKind
  /** 马赛克块 / 模糊半径，以 1000px 图宽为基准 */
  strength: number
}

interface MaskView extends MaskRegion {
  boxStyle: string
  effectStyle: string
  kindClass: string
  labelStyle: string
  sizeText: string
}

interface TextLineView {
  key: string
  text: string
}

interface TextView {
  fontPx: number
  letterPx: number
  linePx: number
  padX: number
  padY: number
  color: string
  opacity: number
  background: string
  shadow: string
  stampPx: number
  radiusPx: number
}

interface LogoView {
  widthPx: number
  heightPx: number
  opacity: number
  scalePercent: number
}

interface GestureConfig {
  enabled: boolean
  mode: 'move' | 'mask'
  active: ActiveLayer
  x: number
  y: number
  scale: number
  rotation: number
}

interface GestureCommitDetail {
  type: 'text' | 'logo'
  x: number
  y: number
  scale: number
  rotation: number
}

interface MaskRectDetail {
  x: number
  y: number
  w: number
  h: number
}

interface EditorSnapshot {
  text: TextLayer
  logo: LogoLayer | null
  masks: MaskRegion[]
}

interface PreparedImage {
  path: string
  width: number
  height: number
  originalWidth: number
  originalHeight: number
  resized: boolean
}

interface WatermarkRuntime {
  destroyed: boolean
  renderTimer: number
  renderBusy: boolean
  renderQueued: boolean
  renderVersion: number
  previewFile: string
  sourceImage: WorkImage | null
  sourceImagePath: string
  logoImage: WorkImage | null
  logoImagePath: string
  canvas: WorkCanvas | null
  history: EditorSnapshot[]
  historyIndex: number
  restoreGuard: boolean
  gestureActive: boolean
  logoFiles: string[]
  themeBindings?: { destroyStoreBindings: () => void }
}

interface ColorOption {
  value: string
  label: string
}

interface PresetOption {
  key: string
  label: string
  desc: string
}

interface TabOption {
  key: WatermarkTab
  label: string
}

const MAX_SOURCE_EDGE = 2000
const MAX_LOGO_EDGE = 1200
/** 预览与导出最长边上限：DPR 放大受总像素约束，避免大图直接打爆 Canvas 内存 */
const PREVIEW_MAX_EDGE = 1200
const EXPORT_MAX_EDGE = 3200
const HISTORY_LIMIT = 40
const RENDER_DEBOUNCE = 200

const TABS: TabOption[] = [
  { key: 'text', label: '文字' },
  { key: 'logo', label: 'Logo' },
  { key: 'mask', label: '打码' },
  { key: 'preset', label: '预设' },
]

const COLORS: ColorOption[] = [
  { value: '#FFFFFF', label: '白' },
  { value: '#0B0F1A', label: '墨' },
  { value: '#FFD479', label: '金' },
  { value: '#6EE7C8', label: '薄荷' },
  { value: '#9F7CFF', label: '极光' },
  { value: '#FF6B5E', label: '朱砂' },
]

const PRESETS: PresetOption[] = [
  { key: 'minimal', label: '极简版权', desc: '右下角 · 小字号 · 半透明底框' },
  { key: 'tile', label: '全屏防盗', desc: '−30° 斜向平铺 · 投影 · 防裁剪' },
  { key: 'stamp', label: '微商打卡', desc: '正中央大字 · 日期 · 图章' },
]

const DEFAULT_TEXT: TextLayer = {
  text: '超欢 · 本机水印',
  x: 50,
  y: 50,
  scale: 1,
  rotation: 0,
  fontSize: 42,
  color: '#FFFFFF',
  letterSpacing: 1,
  lineHeight: 1.35,
  opacity: 100,
  outline: false,
  bgEnabled: false,
  bgOpacity: 36,
  shadow: true,
  tile: false,
  stamp: false,
}

const IS_DEVTOOLS = isDevtools()

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function unlinkQuietly(filePath: string): void {
  if (!filePath) {
    return
  }
  try {
    wx.getFileSystemManager().unlink({ filePath, fail: () => undefined })
  } catch {
    /* 文件系统不可用时忽略清理 */
  }
}

function readDpr(): number {
  try {
    const info = wx.getWindowInfo()
    return clamp(info.pixelRatio || 2, 1, 3)
  } catch {
    return 2
  }
}

function todayText(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}.${month}.${day}`
}

function buildTextLines(text: string): TextLineView[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  return lines.map((line, index) => ({
    key: String(index),
    text: line.length ? line : ' ',
  }))
}

function cloneText(layer: TextLayer): TextLayer {
  return { ...layer }
}

function cloneLogo(layer: LogoLayer | null): LogoLayer | null {
  return layer ? { ...layer } : null
}

function cloneMasks(masks: MaskRegion[]): MaskRegion[] {
  return masks.map((mask) => ({ ...mask }))
}

/** 判断文字亮度：亮字压深描边，暗字压亮描边 */
function isLightColor(hex: string): boolean {
  const value = hex.replace('#', '')
  if (value.length !== 6) {
    return true
  }
  const red = parseInt(value.slice(0, 2), 16)
  const green = parseInt(value.slice(2, 4), 16)
  const blue = parseInt(value.slice(4, 6), 16)
  return red * 0.299 + green * 0.587 + blue * 0.114 > 150
}

function buildOutlineShadow(color: string, size: number): string {
  const ink = isLightColor(color) ? 'rgba(7, 10, 18, 0.88)' : 'rgba(255, 255, 255, 0.9)'
  const offsets = [
    [-size, 0],
    [size, 0],
    [0, -size],
    [0, size],
    [-size, -size],
    [-size, size],
    [size, -size],
    [size, size],
  ]
  return offsets.map(([x, y]) => `${x}px ${y}px 0 ${ink}`).join(', ')
}

function buildTextShadow(layer: TextLayer, outlineSize: number): string {
  const parts: string[] = []
  if (layer.outline) {
    parts.push(buildOutlineShadow(layer.color, Math.max(1, outlineSize)))
  }
  if (layer.shadow) {
    parts.push('0 6px 18px rgba(0, 0, 0, 0.42)')
  }
  return parts.length ? parts.join(', ') : 'none'
}

function computeTextView(layer: TextLayer, displayW: number): TextView {
  const fontPx = Math.max(8, (layer.fontSize * displayW) / 1000)
  const letterPx = (layer.letterSpacing * displayW) / 1000
  const linePx = fontPx * layer.lineHeight
  const padX = Math.round(fontPx * 0.6)
  const padY = Math.round(fontPx * 0.35)
  const opacity = clamp(layer.opacity, 0, 100) / 100
  return {
    fontPx,
    letterPx,
    linePx,
    padX,
    padY,
    color: layer.color,
    opacity,
    background: layer.bgEnabled ? `rgba(0, 0, 0, ${clamp(layer.bgOpacity, 0, 100) / 100})` : 'transparent',
    shadow: buildTextShadow(layer, Math.round(fontPx / 26)),
    stampPx: Math.round(fontPx * 2.3),
    radiusPx: Math.round(fontPx * 0.42),
  }
}

function computeLogoView(layer: LogoLayer | null, displayW: number): LogoView {
  if (!layer) {
    return { widthPx: 0, heightPx: 0, opacity: 0, scalePercent: 0 }
  }
  const widthPx = Math.max(12, layer.scale * displayW)
  return {
    widthPx,
    heightPx: widthPx * (layer.aspect || 1),
    opacity: clamp(layer.opacity, 0, 100) / 100,
    scalePercent: Math.round(layer.scale * 100),
  }
}

function computeMaskViews(
  masks: MaskRegion[],
  displayW: number,
  displayH: number,
): MaskView[] {
  return masks.map((mask) => {
    const blurPx = Math.max(2, Math.round((mask.strength * displayW) / 1000))
    return {
      ...mask,
      kindClass: mask.kind === 'blur' ? 'wm-mask_blur' : 'wm-mask_mosaic',
      boxStyle: [
        `left: ${(mask.x * 100).toFixed(2)}%`,
        `top: ${(mask.y * 100).toFixed(2)}%`,
        `width: ${(mask.w * 100).toFixed(2)}%`,
        `height: ${(mask.h * 100).toFixed(2)}%`,
      ].join('; '),
      effectStyle:
        mask.kind === 'blur'
          ? `-webkit-backdrop-filter: blur(${blurPx}px); backdrop-filter: blur(${blurPx}px);`
          : `-webkit-backdrop-filter: blur(${Math.max(2, Math.round(blurPx / 3))}px) saturate(140%); backdrop-filter: blur(${Math.max(2, Math.round(blurPx / 3))}px) saturate(140%);`,
      labelStyle: mask.kind === 'blur' ? '模糊' : '马赛克',
      sizeText: `${Math.round(mask.w * 100)}% × ${Math.round(mask.h * 100)}%`,
    }
  })
}

function buildGestureConfig(
  enabled: boolean,
  mode: 'move' | 'mask',
  active: ActiveLayer,
  text: TextLayer,
  logo: LogoLayer | null,
): GestureConfig {
  if (active === 'logo' && logo) {
    return {
      enabled,
      mode,
      active,
      x: logo.x,
      y: logo.y,
      /* Logo 预览宽度已按 scale 计算，手势缩放以 1 为基线，落定后再乘回图层比例 */
      scale: 1,
      rotation: logo.rotation,
    }
  }
  /* 平铺水印由画布重复绘制，不参与单图层拖拽；框选打码仍然可用 */
  if (text.tile && mode === 'move') {
    return { enabled: false, mode, active: '', x: text.x, y: text.y, scale: text.scale, rotation: text.rotation }
  }
  return {
    enabled,
    mode,
    active: active === 'logo' ? '' : active,
    x: text.x,
    y: text.y,
    scale: text.scale,
    rotation: text.rotation,
  }
}

function loadCanvasImage(canvas: WorkCanvas, src: string): Promise<WorkImage> {
  return new Promise((resolve, reject) => {
    let settled = false
    const image = canvas.createImage()
    const timer = setTimeout(() => {
      if (settled) {
        return
      }
      settled = true
      reject(new Error('图片解码超时'))
    }, 8000)

    image.onload = () => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      resolve(image)
    }

    image.onerror = () => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      reject(new Error('图片解码失败，请换一张 JPG/PNG'))
    }

    image.src = src
  })
}

function exportCanvasFile(
  canvas: WorkCanvas,
  fileType: 'jpg' | 'png' = 'jpg',
): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas: canvas as unknown as WechatMiniprogram.Canvas,
      x: 0,
      y: 0,
      width: canvas.width,
      height: canvas.height,
      destWidth: canvas.width,
      destHeight: canvas.height,
      fileType,
      quality: fileType === 'png' ? 1 : 0.95,
      success: (result) => resolve(result.tempFilePath),
      fail: (error) => reject(new Error(error.errMsg || '图片导出失败')),
    })
  })
}

function createOffscreenCanvas(width: number, height: number): WorkCanvas | null {
  try {
    if (typeof wx.createOffscreenCanvas !== 'function') {
      return null
    }
    return wx.createOffscreenCanvas({
      type: '2d',
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
    }) as unknown as WorkCanvas
  } catch {
    return null
  }
}

function compressToSize(src: string, width: number, height: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof wx.compressImage !== 'function') {
      reject(new Error('当前环境不支持图片压缩'))
      return
    }
    wx.compressImage({
      src,
      quality: 92,
      compressedWidth: width,
      compressedHeight: height,
      success: (result) => resolve(result.tempFilePath),
      fail: (error) => reject(new Error(error.errMsg || '压缩失败')),
    })
  })
}

/** 基础库不支持按尺寸压缩时的兜底：离屏 Canvas 等比例重采样 */
async function resizeWithCanvas(
  src: string,
  width: number,
  height: number,
  fileType: 'jpg' | 'png' = 'jpg',
): Promise<string> {
  const canvas = createOffscreenCanvas(width, height)
  if (!canvas) {
    throw new Error('当前环境不支持离屏画布')
  }
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d') as unknown as WorkCtx | null
  if (!ctx) {
    throw new Error('画布上下文不可用')
  }
  const image = await loadCanvasImage(canvas, src)
  ctx.drawImage(image, 0, 0, width, height)
  return exportCanvasFile(canvas, fileType)
}

async function prepareImage(
  src: string,
  maxEdge: number,
  fileType: 'jpg' | 'png' = 'jpg',
): Promise<PreparedImage> {
  const info = await getImageInfo(src)
  const width = info.width
  const height = info.height
  if (!width || !height) {
    throw new Error('无法读取图片尺寸')
  }
  const longest = Math.max(width, height)
  if (longest <= maxEdge) {
    return {
      path: src,
      width,
      height,
      originalWidth: width,
      originalHeight: height,
      resized: false,
    }
  }

  const ratio = maxEdge / longest
  const targetW = Math.max(1, Math.round(width * ratio))
  const targetH = Math.max(1, Math.round(height * ratio))

  if (fileType !== 'png') {
    try {
      const path = await compressToSize(src, targetW, targetH)
      const compressed = await getImageInfo(path)
      return {
        path,
        width: compressed.width || targetW,
        height: compressed.height || targetH,
        originalWidth: width,
        originalHeight: height,
        resized: true,
      }
    } catch {
      /* wx.compressImage 不支持尺寸参数时走离屏重采样 */
    }
  }

  try {
    /* PNG 必须走画布重采样，避免透明 Logo 被压成 JPG 后出现黑底 */
    const path = await resizeWithCanvas(src, targetW, targetH, fileType)
    return {
      path,
      width: targetW,
      height: targetH,
      originalWidth: width,
      originalHeight: height,
      resized: true,
    }
  } catch {
    /* 极旧环境两条兜底都不可用：保留原图并由 drawImage 等比缩放，绝不阻断主流程 */
    return {
      path: src,
      width,
      height,
      originalWidth: width,
      originalHeight: height,
      resized: false,
    }
  }
}

function roundRectPath(
  ctx: WorkCtx,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + width - r, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + r)
  ctx.lineTo(x + width, y + height - r)
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  ctx.lineTo(x + r, y + height)
  ctx.quadraticCurveTo(x, y + height, x, y + height - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

interface TextMetrics {
  lines: string[]
  lineWidths: number[]
  charWidths: number[][]
  blockWidth: number
  blockHeight: number
  fontPx: number
  letterPx: number
  linePx: number
  padX: number
  padY: number
}

function measureTextBlock(ctx: WorkCtx, layer: TextLayer, imageW: number): TextMetrics | null {
  const lines = layer.text.replace(/\r\n/g, '\n').split('\n')
  if (!layer.text.trim() || !lines.length) {
    return null
  }
  const fontPx = Math.max(1, (layer.fontSize * imageW) / 1000)
  const letterPx = (layer.letterSpacing * imageW) / 1000
  const linePx = fontPx * layer.lineHeight
  const padX = fontPx * 0.6
  const padY = fontPx * 0.35

  ctx.font = `700 ${fontPx}px sans-serif`
  const lineWidths: number[] = []
  const charWidths: number[][] = []
  let maxWidth = 0

  for (const line of lines) {
    const widths: number[] = []
    let width = 0
    for (let index = 0; index < line.length; index += 1) {
      const char = line.charAt(index)
      const charWidth = ctx.measureText(char).width
      widths.push(charWidth)
      width += charWidth
      if (index < line.length - 1) {
        width += letterPx
      }
    }
    lineWidths.push(width)
    charWidths.push(widths)
    if (width > maxWidth) {
      maxWidth = width
    }
  }

  return {
    lines,
    lineWidths,
    charWidths,
    blockWidth: maxWidth + padX * 2,
    blockHeight: linePx * lines.length + padY * 2,
    fontPx,
    letterPx,
    linePx,
    padX,
    padY,
  }
}

function drawStamp(ctx: WorkCtx, centerX: number, centerY: number, size: number): void {
  ctx.save()
  ctx.translate(centerX, centerY)
  ctx.rotate(-0.18)
  ctx.globalAlpha = ctx.globalAlpha * 0.88
  ctx.strokeStyle = '#E5484D'
  ctx.lineWidth = Math.max(1, size * 0.1)
  ctx.beginPath()
  ctx.arc(0, 0, size * 0.5, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = '#E5484D'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `700 ${size * 0.3}px sans-serif`
  ctx.fillText('超欢', 0, -size * 0.06)
  ctx.font = `600 ${size * 0.11}px sans-serif`
  ctx.fillText('ORIGINAL', 0, size * 0.2)
  ctx.restore()
}

function drawTextBlock(
  ctx: WorkCtx,
  metrics: TextMetrics,
  layer: TextLayer,
  centerX: number,
  centerY: number,
  withStamp: boolean,
  useLayerTransform: boolean,
): void {
  const scale = clamp(layer.scale, 0.2, 4)
  const rotation = (layer.rotation * Math.PI) / 180
  const alpha = clamp(layer.opacity, 0, 100) / 100
  const blockW = metrics.blockWidth
  const blockH = metrics.blockHeight

  ctx.save()
  ctx.translate(centerX, centerY)
  if (useLayerTransform) {
    ctx.rotate(rotation)
    ctx.scale(scale, scale)
  }
  ctx.globalAlpha = alpha

  if (layer.shadow) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)'
    ctx.shadowBlur = metrics.fontPx * 0.32
    ctx.shadowOffsetX = metrics.fontPx * 0.08
    ctx.shadowOffsetY = metrics.fontPx * 0.16
  }

  if (layer.bgEnabled) {
    ctx.fillStyle = `rgba(0, 0, 0, ${clamp(layer.bgOpacity, 0, 100) / 100})`
    roundRectPath(ctx, -blockW / 2, -blockH / 2, blockW, blockH, metrics.fontPx * 0.42)
    ctx.fill()
  }

  const strokeWidth = metrics.fontPx / 14
  const outlineColor = isLightColor(layer.color)
    ? 'rgba(7, 10, 18, 0.82)'
    : 'rgba(255, 255, 255, 0.86)'

  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.font = `700 ${metrics.fontPx}px sans-serif`
  ctx.fillStyle = layer.color
  if (layer.outline) {
    ctx.strokeStyle = outlineColor
    ctx.lineWidth = strokeWidth
  }

  for (let lineIndex = 0; lineIndex < metrics.lines.length; lineIndex += 1) {
    const line = metrics.lines[lineIndex]
    const lineWidth = metrics.lineWidths[lineIndex]
    const charWidths = metrics.charWidths[lineIndex]
    let cursorX = -lineWidth / 2
    const cursorY =
      -blockH / 2 + metrics.padY + metrics.linePx / 2 + lineIndex * metrics.linePx
    for (let charIndex = 0; charIndex < line.length; charIndex += 1) {
      const char = line.charAt(charIndex)
      if (layer.outline) {
        ctx.strokeText(char, cursorX, cursorY)
      }
      ctx.fillText(char, cursorX, cursorY)
      cursorX += charWidths[charIndex] + metrics.letterPx
    }
  }

  if (withStamp) {
    const stamp = metrics.fontPx * 2.2
    drawStamp(ctx, blockW / 2 - stamp * 0.28, blockH / 2 - stamp * 0.36, stamp)
  }

  ctx.restore()
}

function drawTextLayer(
  ctx: WorkCtx,
  layer: TextLayer,
  imageW: number,
  imageH: number,
): void {
  const metrics = measureTextBlock(ctx, layer, imageW)
  if (!metrics) {
    return
  }

  if (layer.tile) {
    /* 先旋转整个平铺平面，再在平面内排布文字，得到真正的斜向防盗网 */
    const stepX = metrics.blockWidth + imageW * 0.06
    const stepY = metrics.blockHeight + imageH * 0.12
    const diagonal = Math.sqrt(imageW * imageW + imageH * imageH)
    const spanX = Math.ceil(diagonal / 2 / Math.max(1, stepX)) + 1
    const spanY = Math.ceil(diagonal / 2 / Math.max(1, stepY)) + 1
    ctx.save()
    ctx.translate(imageW / 2, imageH / 2)
    ctx.rotate((layer.rotation * Math.PI) / 180)
    ctx.scale(clamp(layer.scale, 0.2, 4), clamp(layer.scale, 0.2, 4))
    for (let row = -spanY; row <= spanY; row += 1) {
      for (let col = -spanX; col <= spanX; col += 1) {
        const offsetY = (row + (col % 2 === 0 ? 0 : 0.5)) * stepY
        drawTextBlock(ctx, metrics, layer, col * stepX, offsetY, false, false)
      }
    }
    ctx.restore()
    return
  }

  drawTextBlock(
    ctx,
    metrics,
    layer,
    (layer.x / 100) * imageW,
    (layer.y / 100) * imageH,
    layer.stamp,
    true,
  )
}

function drawLogoLayer(
  ctx: WorkCtx,
  layer: LogoLayer,
  image: WorkImage,
  imageW: number,
  imageH: number,
): void {
  const width = clamp(layer.scale, 0.02, 0.9) * imageW
  const height = width * (layer.aspect || 1)
  ctx.save()
  ctx.translate((layer.x / 100) * imageW, (layer.y / 100) * imageH)
  ctx.rotate((layer.rotation * Math.PI) / 180)
  ctx.globalAlpha = clamp(layer.opacity, 0, 100) / 100
  ctx.drawImage(image, -width / 2, -height / 2, width, height)
  ctx.restore()
}

/** 把源图区域降采样再放大：smooth=false 得到马赛克，smooth=true 得到柔和模糊 */
function redrawRegion(
  ctx: WorkCtx,
  image: WorkImage,
  x: number,
  y: number,
  width: number,
  height: number,
  cols: number,
  rows: number,
  smooth: boolean,
): boolean {
  const small = createOffscreenCanvas(cols, rows)
  if (!small) {
    return false
  }
  small.width = cols
  small.height = rows
  const smallCtx = small.getContext('2d') as unknown as WorkCtx | null
  if (!smallCtx) {
    return false
  }
  try {
    smallCtx.clearRect(0, 0, cols, rows)
    smallCtx.drawImage(image, x, y, width, height, 0, 0, cols, rows)
    ctx.save()
    ctx.imageSmoothingEnabled = smooth
    ctx.imageSmoothingQuality = smooth ? 'high' : 'low'
    ctx.drawImage(small, 0, 0, cols, rows, x, y, width, height)
    ctx.restore()
    return true
  } catch {
    return false
  }
}

function applyMosaic(
  ctx: WorkCtx,
  mask: MaskRegion,
  image: WorkImage,
  imageW: number,
  imageH: number,
): void {
  const x = mask.x * imageW
  const y = mask.y * imageH
  const width = mask.w * imageW
  const height = mask.h * imageH
  const block = clamp((mask.strength * imageW) / 1000, 4, imageW / 4)
  const cols = clamp(Math.round(width / block), 2, 64)
  const rows = clamp(Math.round(height / block), 2, 64)

  if (redrawRegion(ctx, image, x, y, width, height, cols, rows, false)) {
    return
  }

  ctx.save()
  ctx.fillStyle = 'rgba(7, 10, 18, 0.55)'
  ctx.fillRect(x, y, width, height)
  ctx.restore()
}

function applyBlur(
  ctx: WorkCtx,
  mask: MaskRegion,
  image: WorkImage,
  imageW: number,
  imageH: number,
): void {
  const x = mask.x * imageW
  const y = mask.y * imageH
  const width = mask.w * imageW
  const height = mask.h * imageH
  const radius = clamp((mask.strength * imageW) / 1000, 2, 80)
  const cols = clamp(Math.round(width / Math.max(3, radius * 1.6)), 3, 32)
  const rows = clamp(Math.round(height / Math.max(3, radius * 1.6)), 3, 32)

  if (redrawRegion(ctx, image, x, y, width, height, cols, rows, true)) {
    return
  }

  /* 极端环境下离屏画布不可用：退回原生 filter，再不行就压一层柔光 */
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, width, height)
  ctx.clip()
  ctx.filter = `blur(${Math.round(radius)}px)`
  ctx.drawImage(image, 0, 0, imageW, imageH)
  ctx.filter = 'none'
  ctx.restore()
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
    toolName: '水印工作台',
    themeClass: uiStore.themeClass,
    themeSwitching: false,

    navTop: 44,
    navRight: 16,
    stageHeight: 480,
    panelHeight: 180,

    tabs: TABS,
    activeTab: 'text' as WatermarkTab,
    colors: COLORS,
    presets: PRESETS,

    hasImage: false,
    choosing: false,
    saving: false,
    imagePath: '',
    imageW: 0,
    imageH: 0,
    imageMeta: '',
    displayW: 0,
    displayH: 0,
    surfaceLeft: 0,
    surfaceTop: 0,

    textLayer: cloneText(DEFAULT_TEXT),
    textLines: buildTextLines(DEFAULT_TEXT.text),
    textView: computeTextView(DEFAULT_TEXT, 0),
    tileRows: [0, 1, 2, 3, 4, 5],
    tileCells: [0, 1, 2],
    logoLayer: null as LogoLayer | null,
    logoView: computeLogoView(null, 0),
    masks: [] as MaskRegion[],
    maskViews: [] as MaskView[],
    maskKind: 'mosaic' as MaskKind,
    maskStrength: 18,
    maskDrawing: false,

    activeLayer: 'text' as ActiveLayer,
    gestureConfig: buildGestureConfig(false, 'move', 'text', DEFAULT_TEXT, null),

    previewSrc: '',
    previewVisible: false,
    undoAvailable: false,
    redoAvailable: false,
    panelAnchor: '',
    canvasMounted: false,
    /** 流转面板开关：由预览区按钮打开，关闭时反向复位 */
    workflowPanelVisible: false,
  },

  onLoad() {
    const runtime = this as unknown as WatermarkRuntime
    runtime.destroyed = false
    runtime.renderTimer = 0
    runtime.renderBusy = false
    runtime.renderQueued = false
    runtime.renderVersion = 0
    runtime.previewFile = ''
    runtime.sourceImage = null
    runtime.sourceImagePath = ''
    runtime.logoImage = null
    runtime.logoImagePath = ''
    runtime.canvas = null
    runtime.history = []
    runtime.historyIndex = -1
    runtime.restoreGuard = false
    runtime.gestureActive = false
    runtime.logoFiles = []

    this.setupInsets()
    toolboxStore.init()
    toolboxStore.recordOpen('watermark')
    runtime.themeBindings = createStoreBindings(this, {
      store: uiStore,
      fields: {
        themeClass: () => uiStore.themeClass,
        themeSwitching: () => uiStore.themeSwitching,
      },
      actions: [],
    })
  },

  onShow() {
    uiStore.syncNativeChrome()
    if (this.data.hasImage) {
      this.measureSurface()
    }
  },

  onUnload() {
    const runtime = this as unknown as WatermarkRuntime
    runtime.destroyed = true
    if (runtime.renderTimer) {
      clearTimeout(runtime.renderTimer)
      runtime.renderTimer = 0
    }
    if (runtime.themeBindings) {
      runtime.themeBindings.destroyStoreBindings()
      runtime.themeBindings = undefined
    }
    unlinkQuietly(this.data.imagePath)
    unlinkQuietly(runtime.previewFile)
    runtime.logoFiles.forEach((filePath) => unlinkQuietly(filePath))
    runtime.previewFile = ''
    runtime.logoFiles = []
    runtime.canvas = null
    runtime.sourceImage = null
    runtime.logoImage = null
    runtime.history = []
    runtime.historyIndex = -1
    /* 【防漏点】页面卸载：清空流转会话 / pendingJump / 撤销栈，图片进入孤儿队列 */
    workflowStore.clear()
  },

  setupInsets(): void {
    try {
      const windowInfo = wx.getWindowInfo()
      const capsule = wx.getMenuButtonBoundingClientRect()
      const navTop = Math.max(0, capsule.top || windowInfo.statusBarHeight || 20)
      const navBottom = Math.max(navTop + 44, (capsule.bottom || navTop + 44) + 8)
      const stageHeight = Math.round(windowInfo.windowHeight * 0.6)
      const safeBottom = windowInfo.safeArea
        ? Math.max(0, windowInfo.windowHeight - windowInfo.safeArea.bottom)
        : 0
      const panelHeight = Math.max(
        120,
        windowInfo.windowHeight - navBottom - stageHeight - 44 - safeBottom,
      )
      this.setData({
        navTop,
        navRight: Math.max(16, (windowInfo.windowWidth || 375) - capsule.left + 8),
        stageHeight,
        panelHeight,
      })
    } catch {
      this.setData({ navTop: 44, navRight: 16, stageHeight: 480, panelHeight: 180 })
    }
  },

  onBack(): void {
    /* 面板打开时优先关闭面板，避免物理返回直接丢流水线 */
    if (this.data.workflowPanelVisible) {
      tapTick()
      workflowStore.clear(false)
      this.setData({ workflowPanelVisible: false })
      return
    }
    tapTick()
    wx.navigateBack({
      fail: () => {
        wx.switchTab({ url: '/pages/index/index', fail: () => undefined })
      },
    })
  },

  /** 打开流转面板：只在合成预览就绪后允许，避免把未加水印的原图流转出去 */
  onWorkflowTap(): void {
    if (this.data.workflowPanelVisible || !this.data.hasImage) {
      return
    }
    if (!this.data.previewSrc) {
      tapWarn()
      toast('水印预览生成中，请稍后再试')
      return
    }
    tapTick()
    this.setData({ workflowPanelVisible: true })
  },

  /** 面板主动关闭：只复位开关，会话清理由面板按状态处理 */
  onWorkflowPanelClose(): void {
    if (!this.data.workflowPanelVisible) {
      return
    }
    this.setData({ workflowPanelVisible: false })
  },

  onTabTap(event: WechatMiniprogram.TouchEvent): void {
    const key = event.currentTarget.dataset.key as WatermarkTab
    if (!key || key === this.data.activeTab) {
      return
    }
    tapTick()
    const logo = this.data.logoLayer
    const activeLayer: ActiveLayer =
      key === 'text' ? 'text' : key === 'logo' && logo ? 'logo' : ''
    this.setData({
      activeTab: key,
      activeLayer,
      maskDrawing: false,
      gestureConfig: buildGestureConfig(
        this.data.hasImage,
        'move',
        activeLayer,
        this.data.textLayer,
        logo,
      ),
    })
    this.resetPanelScroll(key)
  },

  /** 切换 Tab 后把控制面板滚回顶部，避免沿用上一页的滚动位置 */
  resetPanelScroll(expectedTab: WatermarkTab): void {
    this.setData({ panelAnchor: '' })
    setTimeout(() => {
      if (this.data.activeTab !== expectedTab) {
        return
      }
      this.setData({ panelAnchor: 'wm-panel-top' })
    }, 30)
  },

  /* ---- 选图与压缩 ---- */
  async onChooseImage(): Promise<void> {
    if (this.data.choosing || this.data.saving) {
      return
    }
    const runtime = this as unknown as WatermarkRuntime
    this.setData({ choosing: true })
    let pickedPath = ''
    try {
      const image = await chooseSingleImage()
      if (!image) {
        return
      }
      pickedPath = image.path
      if (runtime.destroyed) {
        unlinkQuietly(pickedPath)
        pickedPath = ''
        return
      }
      if (image.size > LIMITS.MEDIA_SOURCE_BYTES) {
        toast('图片超过 50MB，请换一张或先截图')
        return
      }

      const prepared = await prepareImage(pickedPath, MAX_SOURCE_EDGE)
      if (runtime.destroyed) {
        if (prepared.path !== pickedPath) {
          unlinkQuietly(prepared.path)
        }
        unlinkQuietly(pickedPath)
        pickedPath = ''
        return
      }
      if (prepared.path !== pickedPath) {
        unlinkQuietly(pickedPath)
        pickedPath = ''
      }

      unlinkQuietly(this.data.imagePath)
      runtime.logoFiles.forEach((filePath) => unlinkQuietly(filePath))
      runtime.logoFiles = []
      runtime.sourceImage = null
      runtime.sourceImagePath = ''
      runtime.logoImage = null
      runtime.logoImagePath = ''
      unlinkQuietly(runtime.previewFile)
      runtime.previewFile = ''
      /* 换图瞬间作废旧图在途渲染，避免旧预览短暂盖住新图 */
      runtime.renderVersion += 1
      if (runtime.renderTimer) {
        clearTimeout(runtime.renderTimer)
        runtime.renderTimer = 0
      }

      this.setData(
        {
          hasImage: true,
          imagePath: prepared.path,
          imageW: prepared.width,
          imageH: prepared.height,
          imageMeta: prepared.resized
            ? `${prepared.width} × ${prepared.height} · 已压缩`
            : `${prepared.width} × ${prepared.height}`,
          previewSrc: '',
          previewVisible: false,
          activeTab: 'text',
          activeLayer: 'text',
          textLayer: cloneText(DEFAULT_TEXT),
          textLines: buildTextLines(DEFAULT_TEXT.text),
          logoLayer: null,
          logoView: computeLogoView(null, 0),
          masks: [],
          maskViews: [],
          maskKind: 'mosaic',
          maskStrength: 18,
          maskDrawing: false,
          undoAvailable: false,
          redoAvailable: false,
        },
        () => {
          this.layoutStage()
          this.resetPanelScroll('text')
        },
      )
      /* 成功交给页面后不再走 finally 的临时文件清理 */
      pickedPath = ''
    } catch (error) {
      if (!runtime.destroyed) {
        toast(error instanceof Error ? error.message : '选择图片失败')
      }
    } finally {
      if (pickedPath) {
        unlinkQuietly(pickedPath)
        pickedPath = ''
      }
      if (!runtime.destroyed) {
        this.setData({ choosing: false })
      }
    }
  },

  /**
   * Workflow 接收接口：图片已在流转层 saveFile 固化
   * - 复用 prepareImage 完成最大边压缩与尺寸读取
   * - 只做字段落位与既有布局调用，不改水印渲染 / 手势核心逻辑
   */
  async onReceiveWorkflow(data: IWorkflowData): Promise<boolean> {
    if (!data || data.type !== 'image' || typeof data.payload !== 'string' || !data.payload) {
      return false
    }
    const runtime = this as unknown as WatermarkRuntime
    if (runtime.destroyed || this.data.choosing || this.data.saving) {
      return false
    }

    let preparedPath = ''
    let adopted = false
    this.setData({ choosing: true })
    try {
      const prepared = await prepareImage(data.payload, MAX_SOURCE_EDGE)
      if (prepared.path !== data.payload) {
        preparedPath = prepared.path
      }
      if (runtime.destroyed) {
        if (preparedPath) {
          unlinkQuietly(preparedPath)
        }
        return false
      }

      /* 换图瞬间清理上一张源图 / Logo / 预览，避免旧资源占内存 */
      unlinkQuietly(this.data.imagePath)
      runtime.logoFiles.forEach((filePath) => unlinkQuietly(filePath))
      runtime.logoFiles = []
      runtime.sourceImage = null
      runtime.sourceImagePath = ''
      runtime.logoImage = null
      runtime.logoImagePath = ''
      unlinkQuietly(runtime.previewFile)
      runtime.previewFile = ''
      runtime.renderVersion += 1
      if (runtime.renderTimer) {
        clearTimeout(runtime.renderTimer)
        runtime.renderTimer = 0
      }

      this.setData(
        {
          hasImage: true,
          imagePath: prepared.path,
          imageW: prepared.width,
          imageH: prepared.height,
          imageMeta: prepared.resized
            ? `${prepared.width} × ${prepared.height} · 已压缩`
            : `${prepared.width} × ${prepared.height}`,
          previewSrc: '',
          previewVisible: false,
          activeTab: 'text',
          activeLayer: 'text',
          textLayer: cloneText(DEFAULT_TEXT),
          textLines: buildTextLines(DEFAULT_TEXT.text),
          logoLayer: null,
          logoView: computeLogoView(null, 0),
          masks: [],
          maskViews: [],
          maskKind: 'mosaic',
          maskStrength: 18,
          maskDrawing: false,
          undoAvailable: false,
          redoAvailable: false,
        },
        () => {
          this.layoutStage()
          this.resetPanelScroll('text')
        },
      )
      adopted = true
      return true
    } catch (error) {
      if (!adopted && preparedPath) {
        unlinkQuietly(preparedPath)
      }
      if (!runtime.destroyed) {
        toast(error instanceof Error ? error.message : '流转图片载入失败')
      }
      return false
    } finally {
      if (!runtime.destroyed) {
        this.setData({ choosing: false })
      }
    }
  },

  layoutStage(): Promise<void> {
    return new Promise((resolve) => {
      this.createSelectorQuery()
        .select('#wm-viewport')
        .boundingClientRect((rect: WechatMiniprogram.BoundingClientRectCallbackResult | null) => {
          const runtime = this as unknown as WatermarkRuntime
          if (runtime.destroyed) {
            resolve()
            return
          }
          const imageW = this.data.imageW
          const imageH = this.data.imageH
          if (!rect || !rect.width || !rect.height || !imageW || !imageH) {
            resolve()
            return
          }
          const aspect = imageW / imageH
          let displayW = rect.width
          let displayH = displayW / aspect
          if (displayH > rect.height) {
            displayH = rect.height
            displayW = displayH * aspect
          }
          const text = this.data.textLayer
          const logo = this.data.logoLayer
          const active = this.data.activeLayer
          this.setData(
            {
              displayW: Math.round(displayW),
              displayH: Math.round(displayH),
              textView: computeTextView(text, displayW),
              logoView: computeLogoView(logo, displayW),
              maskViews: computeMaskViews(this.data.masks, displayW, displayH),
              gestureConfig: buildGestureConfig(
                true,
                this.data.maskDrawing ? 'mask' : 'move',
                active,
                text,
                logo,
              ),
            },
            () => {
              this.measureSurface()
              this.resetHistory()
              this.scheduleRender(0)
              resolve()
            },
          )
        })
        .exec()
    })
  },

  /** 重新量取手势面在页面中的位置：键盘弹出 / 页面位移后仍能精确跟手 */
  measureSurface(): void {
    this.createSelectorQuery()
      .select('#wm-surface')
      .boundingClientRect(
        (boxRect: WechatMiniprogram.BoundingClientRectCallbackResult | null) => {
          if (!boxRect) {
            return
          }
          this.setData({ surfaceLeft: boxRect.left, surfaceTop: boxRect.top })
        },
      )
      .exec()
  },

  /* ---- Canvas 初始化 ---- */
  queryCanvas(): Promise<WorkCanvas> {
    return new Promise((resolve, reject) => {
      let attempts = 0
      const query = (): void => {
        this.createSelectorQuery()
          .select('#wm-canvas')
          .fields({ node: true, size: true })
          .exec((result) => {
            const first = result[0] as { node?: WorkCanvas } | null
            if (first && first.node) {
              resolve(first.node)
              return
            }
            attempts += 1
            if (attempts >= 4) {
              reject(new Error('画布节点不可用'))
              return
            }
            setTimeout(query, 100)
          })
      }
      query()
    })
  },

  async ensureCanvas(): Promise<WorkCanvas> {
    const runtime = this as unknown as WatermarkRuntime
    if (runtime.canvas) {
      return runtime.canvas
    }
    if (IS_DEVTOOLS) {
      const offscreen = createOffscreenCanvas(8, 8)
      if (!offscreen) {
        throw new Error('当前环境不支持画布')
      }
      runtime.canvas = offscreen
      return offscreen
    }

    this.setData({ canvasMounted: true })
    await new Promise<void>((resolve) => setTimeout(resolve, 80))
    try {
      runtime.canvas = await this.queryCanvas()
    } catch (error) {
      const offscreen = createOffscreenCanvas(8, 8)
      if (!offscreen) {
        throw error
      }
      runtime.canvas = offscreen
    }
    return runtime.canvas
  },

  async loadSourceImage(canvas: WorkCanvas): Promise<WorkImage> {
    const runtime = this as unknown as WatermarkRuntime
    if (runtime.sourceImage && runtime.sourceImagePath === this.data.imagePath) {
      return runtime.sourceImage
    }
    const image = await loadCanvasImage(canvas, this.data.imagePath)
    runtime.sourceImage = image
    runtime.sourceImagePath = this.data.imagePath
    return image
  },

  /* ---- 合成渲染 ---- */
  async renderComposite(scale: number): Promise<WorkCanvas> {
    const canvas = await this.ensureCanvas()
    const imageW = this.data.imageW
    const imageH = this.data.imageH
    if (!imageW || !imageH) {
      throw new Error('图片尺寸不可用')
    }

    canvas.width = Math.max(1, Math.round(imageW * scale))
    canvas.height = Math.max(1, Math.round(imageH * scale))
    const ctx = canvas.getContext('2d') as unknown as WorkCtx | null
    if (!ctx) {
      throw new Error('画布上下文不可用')
    }

    const source = await this.loadSourceImage(canvas)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.scale(scale, scale)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(source, 0, 0, imageW, imageH)

    for (const mask of this.data.masks) {
      if (mask.kind === 'blur') {
        applyBlur(ctx, mask, source, imageW, imageH)
      } else {
        applyMosaic(ctx, mask, source, imageW, imageH)
      }
    }

    drawTextLayer(ctx, this.data.textLayer, imageW, imageH)

    const logo = this.data.logoLayer
    if (logo && logo.src) {
      try {
        const logoImage = await this.loadLogoImage(canvas, logo.src)
        drawLogoLayer(ctx, logo, logoImage, imageW, imageH)
      } catch {
        /* Logo 解码失败时跳过该图层，不影响文字与打码导出 */
      }
    }

    return canvas
  },

  async loadLogoImage(canvas: WorkCanvas, src: string): Promise<WorkImage> {
    const runtime = this as unknown as WatermarkRuntime
    if (runtime.logoImage && runtime.logoImagePath === src) {
      return runtime.logoImage
    }
    const image = await loadCanvasImage(canvas, src)
    runtime.logoImage = image
    runtime.logoImagePath = src
    return image
  },

  scheduleRender(delay = RENDER_DEBOUNCE): void {
    const runtime = this as unknown as WatermarkRuntime
    if (runtime.destroyed) {
      return
    }
    runtime.renderVersion += 1
    if (runtime.renderTimer) {
      clearTimeout(runtime.renderTimer)
      runtime.renderTimer = 0
    }
    runtime.renderTimer = setTimeout(() => {
      runtime.renderTimer = 0
      void this.flushRender()
    }, delay) as unknown as number
  },

  async flushRender(): Promise<void> {
    const runtime = this as unknown as WatermarkRuntime
    if (runtime.destroyed || !this.data.hasImage) {
      return
    }
    if (this.data.saving) {
      return
    }
    if (runtime.gestureActive) {
      return
    }
    if (runtime.renderBusy) {
      runtime.renderQueued = true
      return
    }
    runtime.renderBusy = true
    runtime.renderQueued = false
    const version = runtime.renderVersion

    try {
      const longest = Math.max(this.data.imageW, this.data.imageH)
      const dpr = readDpr()
      const previewScale = clamp(Math.min(dpr, PREVIEW_MAX_EDGE / longest), 0.2, 3)
      const canvas = await this.renderComposite(previewScale)
      const filePath = await exportCanvasFile(canvas)

      if (
        runtime.destroyed ||
        version !== runtime.renderVersion ||
        !this.data.hasImage
      ) {
        unlinkQuietly(filePath)
        return
      }

      unlinkQuietly(runtime.previewFile)
      runtime.previewFile = filePath
      this.setData({ previewSrc: filePath, previewVisible: true })
    } catch {
      /* 预览渲染失败不阻断编辑，保存时会再次重试并给出明确错误 */
    } finally {
      runtime.renderBusy = false
      if (!runtime.destroyed && runtime.renderQueued) {
        runtime.renderQueued = false
        this.scheduleRender(0)
      }
    }
  },

  /* ---- 保存 ---- */
  async onSaveImage(): Promise<void> {
    if (this.data.saving || this.data.choosing) {
      return
    }
    if (!this.data.hasImage) {
      toast('请先选择一张图片')
      return
    }
    const runtime = this as unknown as WatermarkRuntime
    if (runtime.renderTimer) {
      clearTimeout(runtime.renderTimer)
      runtime.renderTimer = 0
    }
    /* 让在途预览结果失效，避免和导出抢同一块画布 */
    runtime.renderVersion += 1
    this.setData({ saving: true })
    let exported = ''
    try {
      const longest = Math.max(this.data.imageW, this.data.imageH)
      const exportScale = clamp(Math.min(readDpr(), EXPORT_MAX_EDGE / longest), 1, 3)
      const canvas = await this.renderComposite(exportScale)
      exported = await exportCanvasFile(canvas)
      if (runtime.destroyed) {
        unlinkQuietly(exported)
        return
      }
      const saved = await saveImageToAlbum(exported)
      if (saved) {
        /* 自定义工具页手动接入全局埋点：只记图层摘要，不记图片本身 */
        const layers: string[] = []
        if (this.data.textLayer.text.trim()) {
          layers.push('文字水印')
        }
        if (this.data.logoLayer) {
          layers.push('Logo')
        }
        if (this.data.masks.length) {
          layers.push(`打码 ${this.data.masks.length} 处`)
        }
        useTracker().record({
          toolId: 'watermark',
          toolName: '水印工作台',
          inputSummary: `原图 ${this.data.imageW}×${this.data.imageH}${
            layers.length ? ` · ${layers.join(' · ')}` : ''
          }`,
          outputSummary: `已合成并保存到相册 · ${this.data.imageW}×${this.data.imageH}`,
        })
        toast('水印图片已保存到相册')
      }
    } catch (error) {
      if (!runtime.destroyed) {
        toast(error instanceof Error ? error.message : '保存失败，请重试')
      }
    } finally {
      unlinkQuietly(exported)
      /* 导出后立刻缩回小画布，释放高分辨率后备存储 */
      const canvas = runtime.canvas
      if (canvas) {
        try {
          canvas.width = 8
          canvas.height = 8
        } catch {
          /* 个别环境不允许改尺寸时忽略 */
        }
      }
      if (!runtime.destroyed) {
        this.setData({ saving: false })
      }
    }
  },

  /* ---- 历史栈 ---- */
  captureSnapshot(): EditorSnapshot {
    return {
      text: cloneText(this.data.textLayer),
      logo: cloneLogo(this.data.logoLayer),
      masks: cloneMasks(this.data.masks),
    }
  },

  resetHistory(): void {
    const runtime = this as unknown as WatermarkRuntime
    runtime.history = [this.captureSnapshot()]
    runtime.historyIndex = 0
    this.setData({ undoAvailable: false, redoAvailable: false })
  },

  pushHistory(): void {
    const runtime = this as unknown as WatermarkRuntime
    if (runtime.restoreGuard) {
      return
    }
    const snapshot = this.captureSnapshot()
    const current = runtime.history[runtime.historyIndex]
    if (!current) {
      runtime.history = [snapshot]
      runtime.historyIndex = 0
      this.setData({ undoAvailable: false, redoAvailable: false })
      return
    }
    if (JSON.stringify(current) === JSON.stringify(snapshot)) {
      return
    }
    runtime.history = runtime.history.slice(0, runtime.historyIndex + 1)
    runtime.history.push(snapshot)
    if (runtime.history.length > HISTORY_LIMIT) {
      runtime.history.shift()
    }
    runtime.historyIndex = runtime.history.length - 1
    this.updateHistoryFlags()
  },

  updateHistoryFlags(): void {
    const runtime = this as unknown as WatermarkRuntime
    this.setData({
      undoAvailable: runtime.historyIndex > 0,
      redoAvailable: runtime.historyIndex >= 0 && runtime.historyIndex < runtime.history.length - 1,
    })
  },

  applySnapshot(snapshot: EditorSnapshot): void {
    const runtime = this as unknown as WatermarkRuntime
    runtime.restoreGuard = true
    const text = cloneText(snapshot.text)
    const logo = cloneLogo(snapshot.logo)
    const masks = cloneMasks(snapshot.masks)
    const active = this.data.activeLayer === 'logo' && !logo ? '' : this.data.activeLayer
    const lastMask = masks[masks.length - 1]
    this.setData(
      {
        textLayer: text,
        textLines: buildTextLines(text.text),
        textView: computeTextView(text, this.data.displayW),
        logoLayer: logo,
        logoView: computeLogoView(logo, this.data.displayW),
        masks,
        maskViews: computeMaskViews(masks, this.data.displayW, this.data.displayH),
        ...(lastMask ? { maskStrength: lastMask.strength } : {}),
        activeLayer: active,
        maskDrawing: false,
        previewVisible: false,
        gestureConfig: buildGestureConfig(
          this.data.hasImage,
          'move',
          active,
          text,
          logo,
        ),
      },
      () => {
        runtime.restoreGuard = false
      },
    )
    this.scheduleRender()
  },

  onUndo(): void {
    const runtime = this as unknown as WatermarkRuntime
    if (runtime.historyIndex <= 0) {
      return
    }
    tapTick()
    runtime.historyIndex -= 1
    const snapshot = runtime.history[runtime.historyIndex]
    if (snapshot) {
      this.applySnapshot(snapshot)
    }
    this.updateHistoryFlags()
  },

  onRedo(): void {
    const runtime = this as unknown as WatermarkRuntime
    if (runtime.historyIndex >= runtime.history.length - 1) {
      return
    }
    tapTick()
    runtime.historyIndex += 1
    const snapshot = runtime.history[runtime.historyIndex]
    if (snapshot) {
      this.applySnapshot(snapshot)
    }
    this.updateHistoryFlags()
  },

  /* ---- 文字图层 ---- */
  patchText(patch: Partial<TextLayer>, commit: boolean): void {
    const textLayer: TextLayer = { ...this.data.textLayer, ...patch }
    const logo = this.data.logoLayer
    this.setData({
      textLayer,
      textLines: buildTextLines(textLayer.text),
      textView: computeTextView(textLayer, this.data.displayW),
      previewVisible: false,
      gestureConfig: buildGestureConfig(
        this.data.hasImage,
        this.data.maskDrawing ? 'mask' : 'move',
        this.data.activeLayer,
        textLayer,
        logo,
      ),
    })
    if (commit) {
      this.pushHistory()
    }
    this.scheduleRender()
  },

  onTextInput(event: WechatMiniprogram.CustomEvent<{ value: string }>): void {
    const value = String(event.detail.value || '').slice(0, 160)
    this.patchText({ text: value }, false)
  },

  onTextBlur(): void {
    this.pushHistory()
    this.measureSurface()
  },

  onTextSliderInput(event: WechatMiniprogram.CustomEvent<{ value: number }>): void {
    const field = event.currentTarget.dataset.field as keyof TextLayer
    const value = Number(event.detail.value)
    if (!field || !Number.isFinite(value)) {
      return
    }
    this.patchText({ [field]: value } as Partial<TextLayer>, false)
  },

  onTextSliderChange(event: WechatMiniprogram.CustomEvent<{ value: number }>): void {
    this.onTextSliderInput(event)
    this.pushHistory()
  },

  onColorTap(event: WechatMiniprogram.TouchEvent): void {
    const color = event.currentTarget.dataset.color as string
    if (!color) {
      return
    }
    tapTick()
    this.patchText({ color }, true)
  },

  onToggleTap(event: WechatMiniprogram.TouchEvent): void {
    const field = event.currentTarget.dataset.field as keyof TextLayer
    if (field !== 'outline' && field !== 'bgEnabled' && field !== 'shadow' && field !== 'tile' && field !== 'stamp') {
      return
    }
    tapTick()
    const value = !Boolean(this.data.textLayer[field])
    this.patchText({ [field]: value } as Partial<TextLayer>, true)
    if (field === 'tile') {
      const layer = value ? '' : 'text'
      this.setData({
        activeLayer: layer,
        previewVisible: false,
        gestureConfig: buildGestureConfig(
          this.data.hasImage,
          this.data.maskDrawing ? 'mask' : 'move',
          layer,
          this.data.textLayer,
          this.data.logoLayer,
        ),
      })
    }
  },

  /* ---- Logo 图层 ---- */
  async onChooseLogo(): Promise<void> {
    if (this.data.choosing || this.data.saving) {
      return
    }
    const runtime = this as unknown as WatermarkRuntime
    this.setData({ choosing: true })
    let pickedPath = ''
    try {
      const image = await chooseSingleImage()
      if (!image) {
        return
      }
      pickedPath = image.path
      if (runtime.destroyed) {
        unlinkQuietly(pickedPath)
        pickedPath = ''
        return
      }
      if (image.size > LIMITS.MEDIA_SOURCE_BYTES) {
        toast('Logo 图片超过 50MB，请换一张')
        return
      }
      const prepared = await prepareImage(pickedPath, MAX_LOGO_EDGE, 'png')
      if (prepared.path !== pickedPath) {
        unlinkQuietly(pickedPath)
        pickedPath = ''
      }
      if (runtime.destroyed) {
        unlinkQuietly(prepared.path)
        if (pickedPath) {
          unlinkQuietly(pickedPath)
          pickedPath = ''
        }
        return
      }
      runtime.logoFiles.push(prepared.path)
      runtime.logoImage = null
      runtime.logoImagePath = ''
      const logo: LogoLayer = {
        src: prepared.path,
        x: 50,
        y: 80,
        scale: 0.24,
        rotation: 0,
        opacity: 92,
        aspect: prepared.height / prepared.width || 1,
      }
      this.setData({
        logoLayer: logo,
        logoView: computeLogoView(logo, this.data.displayW),
        activeTab: 'logo',
        activeLayer: 'logo',
        previewVisible: false,
        gestureConfig: buildGestureConfig(
          this.data.hasImage,
          this.data.maskDrawing ? 'mask' : 'move',
          'logo',
          this.data.textLayer,
          logo,
        ),
      })
      pickedPath = ''
      tapSuccess()
      this.pushHistory()
      this.resetPanelScroll('logo')
      this.scheduleRender()
    } catch (error) {
      if (!runtime.destroyed) {
        toast(error instanceof Error ? error.message : 'Logo 读取失败')
      }
    } finally {
      if (pickedPath) {
        unlinkQuietly(pickedPath)
        pickedPath = ''
      }
      if (!runtime.destroyed) {
        this.setData({ choosing: false })
      }
    }
  },

  patchLogo(patch: Partial<LogoLayer>, commit: boolean): void {
    const current = this.data.logoLayer
    if (!current) {
      return
    }
    const logo: LogoLayer = { ...current, ...patch }
    this.setData({
      logoLayer: logo,
      logoView: computeLogoView(logo, this.data.displayW),
      previewVisible: false,
      gestureConfig: buildGestureConfig(
        this.data.hasImage,
        this.data.maskDrawing ? 'mask' : 'move',
        this.data.activeLayer,
        this.data.textLayer,
        logo,
      ),
    })
    if (commit) {
      this.pushHistory()
    }
    this.scheduleRender()
  },

  onLogoSliderInput(event: WechatMiniprogram.CustomEvent<{ value: number }>): void {
    const field = event.currentTarget.dataset.field as 'scale' | 'opacity' | 'rotation'
    const value = Number(event.detail.value)
    if (!field || !Number.isFinite(value)) {
      return
    }
    if (field === 'scale') {
      this.patchLogo({ scale: value / 100 }, false)
      return
    }
    this.patchLogo({ [field]: value }, false)
  },

  onLogoSliderChange(event: WechatMiniprogram.CustomEvent<{ value: number }>): void {
    this.onLogoSliderInput(event)
    this.pushHistory()
  },

  onDeleteLogo(): void {
    if (!this.data.logoLayer) {
      return
    }
    tapWarn()
    this.setData({
      logoLayer: null,
      logoView: computeLogoView(null, this.data.displayW),
      previewVisible: false,
      activeLayer: this.data.activeLayer === 'logo' ? '' : this.data.activeLayer,
      gestureConfig: buildGestureConfig(
        this.data.hasImage,
        this.data.maskDrawing ? 'mask' : 'move',
        this.data.activeLayer === 'logo' ? '' : this.data.activeLayer,
        this.data.textLayer,
        null,
      ),
    })
    this.pushHistory()
    this.scheduleRender()
  },

  /* ---- 打码 ---- */
  onMaskKindTap(event: WechatMiniprogram.TouchEvent): void {
    const kind = event.currentTarget.dataset.kind as MaskKind
    if (kind !== 'mosaic' && kind !== 'blur') {
      return
    }
    tapTick()
    this.setData({ maskKind: kind })
  },

  onMaskSliderInput(event: WechatMiniprogram.CustomEvent<{ value: number }>): void {
    const value = Number(event.detail.value)
    if (!Number.isFinite(value)) {
      return
    }
    const masks = this.data.masks.length
      ? this.data.masks.map((mask, index) =>
          index === this.data.masks.length - 1 ? { ...mask, strength: value } : mask,
        )
      : this.data.masks
    this.setData({
      maskStrength: value,
      masks,
      maskViews: computeMaskViews(masks, this.data.displayW, this.data.displayH),
      previewVisible: false,
    })
    this.scheduleRender()
  },

  onMaskSliderChange(event: WechatMiniprogram.CustomEvent<{ value: number }>): void {
    /* 只收到 change 的环境（含无障碍/程序化赋值）也要把最终值写回最后一个区域 */
    this.onMaskSliderInput(event)
    this.pushHistory()
  },

  onStartMask(): void {
    if (!this.data.hasImage) {
      toast('请先选择一张图片')
      return
    }
    tapTick()
    const enabled = !this.data.maskDrawing
    /* 框选模式只负责画选框，退出时回到无激活图层状态，避免误拖文字 */
    const activeLayer: ActiveLayer = ''
    this.setData({
      maskDrawing: enabled,
      previewVisible: false,
      activeLayer,
      gestureConfig: buildGestureConfig(
        this.data.hasImage,
        enabled ? 'mask' : 'move',
        activeLayer,
        this.data.textLayer,
        this.data.logoLayer,
      ),
    })
    if (enabled) {
      toast('在画面上拖出一块区域，松手即打码')
    } else {
      this.scheduleRender(0)
    }
  },

  onMaskCommit(detail: MaskRectDetail): void {
    const runtime = this as unknown as WatermarkRuntime
    runtime.gestureActive = false
    if (runtime.destroyed || !this.data.hasImage) {
      return
    }
    const w = Number(detail.w)
    const h = Number(detail.h)
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 8 || h < 8) {
      return
    }
    const displayW = this.data.displayW || 1
    const displayH = this.data.displayH || 1
    const mask: MaskRegion = {
      id: `mask-${Date.now()}-${this.data.masks.length}`,
      x: clamp(Number(detail.x) / displayW, 0, 0.98),
      y: clamp(Number(detail.y) / displayH, 0, 0.98),
      w: clamp(w / displayW, 0.02, 1),
      h: clamp(h / displayH, 0.02, 1),
      kind: this.data.maskKind,
      strength: this.data.maskStrength,
    }
    mask.w = Math.min(mask.w, 1 - mask.x)
    mask.h = Math.min(mask.h, 1 - mask.y)

    const masks = [...this.data.masks, mask]
    this.setData({
      masks,
      maskViews: computeMaskViews(masks, displayW, displayH),
      maskDrawing: false,
      previewVisible: false,
      gestureConfig: buildGestureConfig(
        true,
        'move',
        '',
        this.data.textLayer,
        this.data.logoLayer,
      ),
    })
    tapSuccess()
    this.pushHistory()
    this.scheduleRender()
  },

  onDeleteMask(event: WechatMiniprogram.TouchEvent): void {
    const id = event.currentTarget.dataset.id as string
    if (!id) {
      return
    }
    const masks = this.data.masks.filter((mask) => mask.id !== id)
    this.setData({
      masks,
      maskViews: computeMaskViews(masks, this.data.displayW, this.data.displayH),
      previewVisible: false,
    })
    tapWarn()
    this.pushHistory()
    this.scheduleRender()
  },

  /* ---- 预设 ---- */
  applyPreset(key: string): void {
    if (!this.data.hasImage) {
      toast('请先选择一张图片')
      return
    }
    const base: TextLayer = { ...DEFAULT_TEXT }
    let patch: TextLayer

    if (key === 'minimal') {
      patch = {
        ...base,
        text: '© 超欢 · 仅限本人使用',
        x: 84,
        y: 90,
        scale: 1,
        rotation: 0,
        fontSize: 15,
        color: '#FFFFFF',
        letterSpacing: 0.5,
        lineHeight: 1.35,
        opacity: 100,
        outline: false,
        bgEnabled: true,
        bgOpacity: 36,
        shadow: false,
        tile: false,
        stamp: false,
      }
    } else if (key === 'tile') {
      patch = {
        ...base,
        text: '仅限本人使用 · 禁止转载',
        x: 50,
        y: 50,
        scale: 1,
        rotation: -30,
        fontSize: 38,
        color: '#FFFFFF',
        letterSpacing: 3,
        lineHeight: 1.2,
        opacity: 38,
        outline: false,
        bgEnabled: false,
        bgOpacity: 30,
        shadow: true,
        tile: true,
        stamp: false,
      }
    } else if (key === 'stamp') {
      patch = {
        ...base,
        text: `今日打卡\n${todayText()}`,
        x: 50,
        y: 42,
        scale: 1,
        rotation: 0,
        fontSize: 76,
        color: '#FFFFFF',
        letterSpacing: 2,
        lineHeight: 1.18,
        opacity: 100,
        outline: false,
        bgEnabled: false,
        bgOpacity: 30,
        shadow: true,
        tile: false,
        stamp: true,
      }
    } else {
      return
    }

    tapSuccess()
    const active: ActiveLayer = patch.tile ? '' : 'text'
    this.setData({
      textLayer: patch,
      textLines: buildTextLines(patch.text),
      textView: computeTextView(patch, this.data.displayW),
      activeTab: 'text',
      activeLayer: active,
      maskDrawing: false,
      previewVisible: false,
      gestureConfig: buildGestureConfig(
        true,
        'move',
        active,
        patch,
        this.data.logoLayer,
      ),
    })
    this.pushHistory()
    this.resetPanelScroll('text')
    this.scheduleRender(120)
  },

  onPresetTap(event: WechatMiniprogram.TouchEvent): void {
    const key = event.currentTarget.dataset.key as string
    if (key) {
      this.applyPreset(key)
    }
  },

  /* ---- 手势回调 ---- */
  onGestureStart(): void {
    const runtime = this as unknown as WatermarkRuntime
    runtime.gestureActive = true
    /* 作废在途渲染，避免预览图在手势中途盖住 DOM 图层 */
    runtime.renderVersion += 1
    if (runtime.renderTimer) {
      clearTimeout(runtime.renderTimer)
      runtime.renderTimer = 0
    }
    if (this.data.previewVisible) {
      this.setData({ previewVisible: false })
    }
  },

  onGestureCancel(): void {
    const runtime = this as unknown as WatermarkRuntime
    runtime.gestureActive = false
    /* 取消后重绘一次，避免展示上一次控件的旧预览 */
    this.scheduleRender(0)
  },

  onGestureCommit(detail: GestureCommitDetail): void {
    const runtime = this as unknown as WatermarkRuntime
    runtime.gestureActive = false
    const x = clamp(Number(detail.x), 0, 100)
    const y = clamp(Number(detail.y), 0, 100)
    const scale = clamp(Number(detail.scale) || 1, 0.2, 4)
    const rotation = Number(detail.rotation) || 0
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return
    }

    if (detail.type === 'logo') {
      const logo = this.data.logoLayer
      if (!logo) {
        return
      }
      const next: LogoLayer = {
        ...logo,
        x,
        y,
        scale: clamp(logo.scale * scale, 0.02, 0.9),
        rotation,
      }
      this.setData({
        logoLayer: next,
        logoView: computeLogoView(next, this.data.displayW),
        gestureConfig: buildGestureConfig(
          this.data.hasImage,
          this.data.maskDrawing ? 'mask' : 'move',
          'logo',
          this.data.textLayer,
          next,
        ),
      })
    } else {
      const text: TextLayer = { ...this.data.textLayer, x, y, scale, rotation }
      this.setData({
        textLayer: text,
        gestureConfig: buildGestureConfig(
          this.data.hasImage,
          this.data.maskDrawing ? 'mask' : 'move',
          'text',
          text,
          this.data.logoLayer,
        ),
      })
    }

    tapTick()
    this.pushHistory()
    this.scheduleRender()
  },

  /* ---- 重置 ---- */
  onReset(): void {
    if (this.data.saving) {
      return
    }
    wx.showModal({
      title: '清空工作台',
      content: '将移除当前图片、文字、Logo 与打码区域。',
      confirmText: '清空',
      cancelText: '取消',
      success: (result) => {
        if (!result.confirm) {
          return
        }
        this.clearWorkspace()
      },
    })
  },

  clearWorkspace(): void {
    const runtime = this as unknown as WatermarkRuntime
    unlinkQuietly(this.data.imagePath)
    unlinkQuietly(runtime.previewFile)
    runtime.previewFile = ''
    runtime.logoFiles.forEach((filePath) => unlinkQuietly(filePath))
    runtime.logoFiles = []
    runtime.sourceImage = null
    runtime.sourceImagePath = ''
    runtime.logoImage = null
    runtime.logoImagePath = ''
    runtime.canvas = null
    runtime.history = []
    runtime.historyIndex = -1
    runtime.renderVersion += 1
    if (runtime.renderTimer) {
      clearTimeout(runtime.renderTimer)
      runtime.renderTimer = 0
    }
    this.setData({
      hasImage: false,
      imagePath: '',
      imageW: 0,
      imageH: 0,
      imageMeta: '',
      displayW: 0,
      displayH: 0,
      previewSrc: '',
      previewVisible: false,
      textLayer: cloneText(DEFAULT_TEXT),
      textLines: buildTextLines(DEFAULT_TEXT.text),
      textView: computeTextView(DEFAULT_TEXT, 0),
      logoLayer: null,
      logoView: computeLogoView(null, 0),
      masks: [],
      maskViews: [],
      maskDrawing: false,
      activeLayer: 'text',
      activeTab: 'text',
      undoAvailable: false,
      redoAvailable: false,
      canvasMounted: false,
      gestureConfig: buildGestureConfig(false, 'move', 'text', DEFAULT_TEXT, null),
    })
  },
})
