/* ==========================================================================
   poster-generator · 纯本地极光海报绘制内核
   - IPosterData：工具名 / 分类 / 主结果 / 精准标签 / 输入参数 / 衍生结论
   - 信息层级：主结果发光大字 > 分类胶囊 > 微型玻璃参数 > 关键结论列表
   - 底部品牌：超欢渐变 Logo + 随机格言（带出处）+ 本地二维码
   - Canvas 2D + devicePixelRatio 高清缩放
   - Skyline 开发者工具不支持 <canvas>：自动切换离屏 Canvas 渲染
   - 本地静态二维码图片，onload/onerror/超时三重保护，绝不白屏
   ========================================================================== */

import type { IPosterData } from '../../core/toolbox/poster'
import { isDevtools } from '../../core/utils/platform'

export type { IPosterData, PosterParam } from '../../core/toolbox/poster'

/** 绘制入参：真实业务数据 + 工具 / 主题元信息 */
export interface PosterPayload extends IPosterData {
  toolId: string
  theme: 'light' | 'dark'
  date?: string
}

interface PosterGradient {
  addColorStop(offset: number, color: string): void
}

/** Canvas 2D 最小绘制契约：只声明本组件实际消费的 API */
interface PosterCtx {
  scale(x: number, y: number): void
  clearRect(x: number, y: number, w: number, h: number): void
  fillRect(x: number, y: number, w: number, h: number): void
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  arc(x: number, y: number, r: number, start: number, end: number): void
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void
  closePath(): void
  fill(): void
  stroke(): void
  save(): void
  restore(): void
  drawImage(image: unknown, x: number, y: number, w: number, h: number): void
  fillText(text: string, x: number, y: number): void
  measureText(text: string): { width: number }
  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ): unknown
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): unknown
  fillStyle: string | unknown
  strokeStyle: string | unknown
  lineWidth: number
  font: string
  textAlign: string
  textBaseline: string
  globalAlpha: number
  shadowColor: string
  shadowBlur: number
  shadowOffsetY: number
}

interface PosterCanvas {
  width: number
  height: number
  getContext(type: '2d'): PosterCtx | null
  createImage(): PosterImage
  toTempFilePath?: unknown
}

interface PosterImage {
  src: string
  width: number
  height: number
  onload: (() => void) | null
  onerror: (() => void) | null
}

const POSTER_W = 480
const POSTER_H = 720
const CONTENT_X = 36
const CONTENT_W = 408
const CONTENT_RIGHT = CONTENT_X + CONTENT_W
/* 海报右下角必须使用微信官方小程序码；旧文本二维码仅作资源缺失时的兜底 */
const QR_SRC = '/assets/miniprogram-qr.png'
const QR_FALLBACK_SRC = '/assets/poster-qr.png'
const QR_TIMEOUT = 1600

export interface PosterQuote {
  text: string
  source: string
}

/**
 * 随机格言池：经典、诗词与品牌短句混合。
 * 不绑定工具数量，后续新增工具无需改文案。
 */
export const POSTER_QUOTES: PosterQuote[] = [
  { text: '工欲善其事，必先利其器', source: '《论语》' },
  { text: '不积跬步，无以至千里', source: '《荀子》' },
  { text: '凡事预则立，不预则废', source: '《礼记》' },
  { text: '知者不惑，仁者不忧', source: '《论语》' },
  { text: '千里之行，始于足下', source: '《道德经》' },
  { text: '君子藏器于身，待时而动', source: '《周易》' },
  { text: '逝者如斯夫，不舍昼夜', source: '《论语》' },
  { text: '博观而约取，厚积而薄发', source: '苏轼' },
  { text: '纸上得来终觉浅，绝知此事要躬行', source: '陆游' },
  { text: '路漫漫其修远兮，吾将上下而求索', source: '屈原' },
  { text: '山不让尘，川不辞盈', source: '张华' },
  { text: '读书破万卷，下笔如有神', source: '杜甫' },
  { text: '日拱一卒，功不唐捐', source: '格言' },
  { text: '少即是多，慢即是快', source: '超欢' },
  { text: '把复杂留给工具，把简单留给自己', source: '超欢' },
  { text: '时间花在哪，结果就在哪', source: '超欢' },
]

export function pickPosterQuote(): PosterQuote {
  const index = Math.floor(Math.random() * POSTER_QUOTES.length)
  return POSTER_QUOTES[index] || { text: '少即是多，慢即是快', source: '超欢' }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 模拟器可能拿不到 pixelRatio：异常 / 缺失 / 0 一律回退到 2 */
function readPixelRatio(): number {
  try {
    const info = wx.getWindowInfo()
    const ratio =
      info &&
      typeof info.pixelRatio === 'number' &&
      Number.isFinite(info.pixelRatio) &&
      info.pixelRatio > 0
        ? info.pixelRatio
        : 2
    return clamp(ratio, 1, 3)
  } catch {
    return 2
  }
}

/** 手写圆角矩形，规避 roundRect 兼容性 */
function roundRect(
  ctx: PosterCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = clamp(r, 0, Math.min(w, h) / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

/**
 * 完整折行：
 * - 支持手动换行
 * - 超宽字符自动换行
 * - 达到 maxLines 后追加省略号，绝不溢出卡片
 */
export function wrapText(
  ctx: PosterCtx,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const safe = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines: string[] = []
  for (const paragraph of safe.split('\n')) {
    if (lines.length >= maxLines) {
      break
    }
    if (!paragraph) {
      lines.push('')
      continue
    }
    let current = ''
    const chars = Array.from(paragraph)
    for (const char of chars) {
      const next = current + char
      if (ctx.measureText(next).width <= maxWidth || current === '') {
        current = next
        continue
      }
      lines.push(current)
      current = char
      if (lines.length >= maxLines) {
        break
      }
    }
    if (current && lines.length < maxLines) {
      lines.push(current)
    }
  }

  if (lines.length > maxLines) {
    lines.length = maxLines
  }
  if (lines.length === maxLines) {
    const consumed = lines.join('').length
    if (consumed < Array.from(safe.replace(/\n/g, '')).length) {
      let last = lines[maxLines - 1]
      while (last && ctx.measureText(`${last}…`).width > maxWidth) {
        last = last.slice(0, -1)
      }
      lines[maxLines - 1] = `${last}…`
    }
  }
  return lines.length ? lines : ['']
}

/** 单行截断，避免参数值压到左侧标签 */
function truncateToWidth(ctx: PosterCtx, text: string, maxWidth: number): string {
  if (maxWidth <= 0) {
    return ''
  }
  if (ctx.measureText(text).width <= maxWidth) {
    return text
  }
  let result = text
  while (result.length > 0 && ctx.measureText(`${result}…`).width > maxWidth) {
    result = result.slice(0, -1)
  }
  return result ? `${result}…` : ''
}

function drawAurora(
  ctx: PosterCtx,
  x: number,
  y: number,
  radius: number,
  color: string,
): void {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius) as PosterGradient
  gradient.addColorStop(0, color)
  gradient.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, POSTER_W, POSTER_H)
}

/** 加载单张二维码图片：失败 / 超时都只返回 null，绝不阻断海报绘制 */
function loadQrSource(
  canvas: PosterCanvas,
  src: string,
): Promise<PosterImage | null> {
  return new Promise((resolve) => {
    let settled = false
    let image: PosterImage | null = null
    const finish = (result: PosterImage | null): void => {
      if (settled) {
        return
      }
      settled = true
      resolve(result)
    }

    try {
      image = canvas.createImage()
      image.onload = () => {
        console.log('【海报调试】二维码图片加载完成:', src)
        finish(image)
      }
      image.onerror = () => {
        console.warn('【海报调试】二维码图片加载失败:', src)
        finish(null)
      }
      image.src = src
    } catch (error) {
      console.warn('【海报调试】模拟器不支持 createImage，使用二维码占位', error)
      finish(null)
      return
    }

    setTimeout(() => {
      if (!settled) {
        console.warn('【海报调试】二维码图片加载超时:', src)
      }
      finish(null)
    }, QR_TIMEOUT)
  })
}

async function loadQrImage(canvas: PosterCanvas): Promise<PosterImage | null> {
  /* 官方码与兜底图并行加载：官方优先，缺失时不必再等第二个 1.6s 超时 */
  const officialPromise = loadQrSource(canvas, QR_SRC)
  const fallbackPromise = loadQrSource(canvas, QR_FALLBACK_SRC)
  const official = await officialPromise
  if (official) {
    return official
  }
  console.warn('【海报调试】官方小程序码不可用，回退旧海报二维码')
  return fallbackPromise
}

/** 主结果自适应：优先单行大字号；超宽再降到 28px 两行，绝不压到参数区 */
function fitMainResult(
  ctx: PosterCtx,
  text: string,
): { lines: string[]; lineHeight: number; size: number } {
  for (const size of [56, 48, 40, 34]) {
    ctx.font = `800 ${size}px sans-serif`
    if (ctx.measureText(text).width <= CONTENT_W) {
      return { lines: [text], lineHeight: size + 12, size }
    }
  }
  const size = 28
  ctx.font = `800 ${size}px sans-serif`
  return { lines: wrapText(ctx, text, CONTENT_W, 2), lineHeight: 34, size }
}

function drawCategoryPill(
  ctx: PosterCtx,
  category: string,
  dark: boolean,
): number {
  const text = category || '效率工具'
  ctx.font = '600 11px sans-serif'
  const pillW = Math.ceil(ctx.measureText(text).width) + 26
  const pillH = 26
  const x = CONTENT_RIGHT - pillW
  const y = 30

  roundRect(ctx, x, y, pillW, pillH, 13)
  ctx.fillStyle = dark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.72)'
  ctx.fill()
  ctx.strokeStyle = dark ? 'rgba(255,255,255,0.16)' : 'rgba(20,26,38,0.12)'
  ctx.lineWidth = 1
  ctx.stroke()

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = dark ? '#C6CEDE' : '#3D4658'
  ctx.fillText(text, x + pillW / 2, y + pillH / 2)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  return pillW
}

function drawPoster(
  ctx: PosterCtx,
  payload: PosterPayload,
  qrImage: PosterImage | null,
): void {
  console.log('【海报调试】开始绘制海报:', payload.toolName)

  const dark = payload.theme === 'dark'
  const ink = dark ? '#F5F7FC' : '#141A26'
  const ink3 = dark ? '#8A94AB' : '#6B7488'
  const accent = dark ? '#9F7CFF' : '#5B63F5'
  const accent2 = dark ? '#5FDCC7' : '#16826B'
  const glassFill = dark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.78)'
  const glassBorder = dark ? 'rgba(255,255,255,0.12)' : 'rgba(20,26,38,0.12)'
  const divider = dark ? 'rgba(255,255,255,0.12)' : 'rgba(20,26,38,0.12)'
  const extraText = dark ? 'rgba(255,255,255,0.7)' : 'rgba(20,26,38,0.7)'

  ctx.clearRect(0, 0, POSTER_W, POSTER_H)

  /* ---- 极光背景 ---- */
  const bg = ctx.createLinearGradient(0, 0, POSTER_W, POSTER_H) as PosterGradient
  if (dark) {
    bg.addColorStop(0, '#070A12')
    bg.addColorStop(0.52, '#10152A')
    bg.addColorStop(1, '#1A1030')
  } else {
    bg.addColorStop(0, '#E8EDF9')
    bg.addColorStop(0.48, '#F3EEFF')
    bg.addColorStop(1, '#E4F7FF')
  }
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, POSTER_W, POSTER_H)

  drawAurora(ctx, 60, 20, 300, dark ? 'rgba(159,124,255,0.5)' : 'rgba(159,124,255,0.42)')
  drawAurora(ctx, 440, 150, 300, dark ? 'rgba(56,189,248,0.34)' : 'rgba(56,189,248,0.34)')
  drawAurora(ctx, 380, 690, 330, dark ? 'rgba(217,70,239,0.3)' : 'rgba(217,70,239,0.26)')
  drawAurora(ctx, 10, 620, 260, dark ? 'rgba(95,220,199,0.22)' : 'rgba(95,220,199,0.2)')
  drawAurora(ctx, 240, 320, 260, dark ? 'rgba(159,124,255,0.16)' : 'rgba(159,124,255,0.18)')

  /* ---- 顶部：工具名 + 分类胶囊 ---- */
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'

  const pillW = drawCategoryPill(ctx, payload.category, dark)

  const titleMax = CONTENT_W - pillW - 16
  ctx.fillStyle = ink
  ctx.font = '800 26px sans-serif'
  const title = truncateToWidth(ctx, payload.toolName, titleMax)
  ctx.fillText(title, CONTENT_X, 34)

  ctx.beginPath()
  ctx.moveTo(CONTENT_X, 76)
  ctx.lineTo(CONTENT_RIGHT, 76)
  ctx.strokeStyle = divider
  ctx.lineWidth = 1
  ctx.stroke()

  /* ---- 主结果：精准标签 + 发光大字 ---- */
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  if (payload.resultLabel) {
    ctx.fillStyle = ink3
    ctx.font = '600 14px sans-serif'
    ctx.fillText(payload.resultLabel, POSTER_W / 2, 108)
  }

  const fitted = fitMainResult(ctx, payload.mainResult)
  ctx.save()
  ctx.shadowColor = dark ? 'rgba(159,124,255,0.55)' : 'rgba(109,120,255,0.35)'
  ctx.shadowBlur = 26
  ctx.fillStyle = accent
  ctx.font = `800 ${fitted.size}px sans-serif`
  let valueY = 140
  fitted.lines.forEach((line) => {
    ctx.fillText(line, POSTER_W / 2, valueY)
    valueY += fitted.lineHeight
  })
  ctx.restore()

  /* ---- 输入参数：两列微型玻璃面板，左浅灰 / 右纯白 ---- */
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  const params = payload.params.slice(0, 4)
  const cardW = 198
  const cardH = 36
  const cardGapX = 12
  const cardGapY = 8
  let paramsBottom = 272

  if (params.length > 0) {
    ctx.fillStyle = ink3
    ctx.font = '500 11px sans-serif'
    ctx.fillText('输入参数', CONTENT_X, 278)

    params.forEach((param, index) => {
      const col = index % 2
      const row = Math.floor(index / 2)
      const x = CONTENT_X + col * (cardW + cardGapX)
      const y = 300 + row * (cardH + cardGapY)

      roundRect(ctx, x, y, cardW, cardH, 10)
      ctx.fillStyle = glassFill
      ctx.fill()
      ctx.strokeStyle = glassBorder
      ctx.lineWidth = 1
      ctx.stroke()

      ctx.fillStyle = ink3
      ctx.font = '500 10px sans-serif'
      ctx.fillText(param.label, x + 12, y + 13)
      const labelWidth = ctx.measureText(param.label).width

      ctx.textAlign = 'right'
      ctx.fillStyle = ink
      ctx.font = '700 13px sans-serif'
      const maxValueWidth = cardW - 24 - labelWidth - 12
      const value = truncateToWidth(ctx, param.value, maxValueWidth)
      ctx.fillText(value, x + cardW - 12, y + 10)
      ctx.textAlign = 'left'
    })

    const rows = Math.ceil(params.length / 2)
    paramsBottom = 300 + rows * (cardH + cardGapY) - cardGapY
  }

  /* ---- 衍生干货：小圆点列表，每一条都是可分享结论 ---- */
  const extras = payload.extras.slice(0, 4)
  if (extras.length > 0) {
    const captionY = paramsBottom + 26
    ctx.fillStyle = ink3
    ctx.font = '500 11px sans-serif'
    ctx.fillText('关键结论', CONTENT_X, captionY)

    let extraY = captionY + 22
    extras.forEach((extra) => {
      ctx.fillStyle = accent2
      ctx.font = '700 12px sans-serif'
      ctx.fillText('•', CONTENT_X, extraY)

      ctx.fillStyle = extraText
      ctx.font = '400 15px sans-serif'
      const line = truncateToWidth(ctx, extra, 388)
      ctx.fillText(line, CONTENT_X + 16, extraY)
      extraY += 26
    })
  }

  /* ---- 底部：超欢渐变 Logo + Slogan + 二维码 ---- */
  ctx.beginPath()
  ctx.moveTo(CONTENT_X, 568)
  ctx.lineTo(CONTENT_RIGHT, 568)
  ctx.strokeStyle = divider
  ctx.lineWidth = 1
  ctx.stroke()

  const logoGradient = ctx.createLinearGradient(36, 582, 110, 614) as PosterGradient
  logoGradient.addColorStop(0, dark ? '#38BDF8' : '#2563EB')
  logoGradient.addColorStop(1, dark ? '#9F7CFF' : '#7C3AED')

  ctx.save()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.shadowColor = dark ? 'rgba(159,124,255,0.55)' : 'rgba(109,120,255,0.32)'
  ctx.shadowBlur = 18
  ctx.fillStyle = logoGradient
  ctx.font = '800 32px sans-serif'
  ctx.fillText('超欢', 36, 582)
  ctx.restore()

  /* 随机格言：不绑定工具数量，后续新增工具无需改文案 */
  const quote = pickPosterQuote()
  ctx.fillStyle = ink3
  ctx.font = '400 12px sans-serif'
  ctx.fillText(truncateToWidth(ctx, quote.text, 218), 112, 586)

  ctx.fillStyle = dark ? 'rgba(255,255,255,0.42)' : 'rgba(20,26,38,0.45)'
  ctx.font = '400 10px sans-serif'
  ctx.fillText(`— ${quote.source}`, 112, 604)

  /* 二维码：纯本地静态图，加载失败时只影响右下角占位 */
  console.log('【海报调试】开始绘制二维码:', qrImage ? '真实图片' : '占位图形')
  const qrSize = 84
  const qrX = 348
  const qrY = 584

  /* 官方小程序码自带白底，这里再补一张纯白微圆角卡片，暗色海报上更精致 */
  ctx.save()
  ctx.shadowColor = dark ? 'rgba(0,0,0,0.32)' : 'rgba(40,48,80,0.16)'
  ctx.shadowBlur = 16
  ctx.shadowOffsetY = 6
  roundRect(ctx, qrX - 5, qrY - 5, qrSize + 10, qrSize + 10, 10)
  ctx.fillStyle = '#FFFFFF'
  ctx.fill()
  ctx.strokeStyle = dark ? 'rgba(255,255,255,0.3)' : 'rgba(20,26,38,0.1)'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.restore()

  if (qrImage && qrImage.width > 0 && qrImage.height > 0) {
    ctx.drawImage(qrImage, qrX, qrY, qrSize, qrSize)
  } else {
    roundRect(ctx, qrX, qrY, qrSize, qrSize, 8)
    ctx.fillStyle = dark ? 'rgba(20,26,38,0.08)' : 'rgba(20,26,38,0.06)'
    ctx.fill()
    ctx.strokeStyle = ink3
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = ink3
    ctx.font = '600 12px sans-serif'
    ctx.fillText('QR', qrX + qrSize / 2, qrY + qrSize / 2)
  }

  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillStyle = ink3
  ctx.font = '400 10px sans-serif'
  ctx.fillText('长按识别体验', qrX + qrSize / 2, qrY + qrSize + 8)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
}

/**
 * 模拟器 / 页面 Canvas 不可用时的离屏渲染兜底。
 * Skyline 下开发者工具不支持 <canvas> 组件，但离屏 Canvas 可以正常绘制与导出。
 */
function createOffscreenPosterCanvas(dpr: number): PosterCanvas | null {
  try {
    if (typeof wx.createOffscreenCanvas !== 'function') {
      return null
    }
    const width = POSTER_W * dpr
    const height = POSTER_H * dpr
    const canvas = wx.createOffscreenCanvas({
      type: '2d',
      width,
      height,
    }) as unknown as PosterCanvas
    canvas.width = width
    canvas.height = height
    console.log('【海报调试】离屏 Canvas 创建成功:', width, '×', height)
    return canvas
  } catch (error) {
    console.warn('【海报调试】离屏 Canvas 创建失败:', error)
    return null
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

Component({
  options: {
    virtualHost: true,
    styleIsolation: 'isolated',
  },

  data: {
    canvasMounted: false,
    generating: false,
  },

  methods: {
    /** 打开隐藏 Canvas；使用 :if 避免常驻高分辨率绘制层 */
    mountCanvas(): Promise<void> {
      return new Promise((resolve) => {
        this.setData({ canvasMounted: true }, () => {
          setTimeout(() => resolve(), 60)
        })
      })
    },

    /**
     * 获取 Canvas 节点：模拟器首帧可能还没撑开节点，尺寸为 0。
     * - 节点缺失 / 尺寸为 0 / 查询无响应：延迟 100ms 重试，最多重试 3 次
     * - 节点存在但尺寸始终为 0：回退 480×720 逻辑尺寸继续绘制，避免模拟器灰屏
     * - 整体 2.5s 超时兜底，绝不永久卡 Loading
     */
    queryCanvas(): Promise<PosterCanvas> {
      return new Promise((resolve, reject) => {
        const self = this
        let finished = false
        let attempts = 0
        let attemptTimer = 0
        let overallTimer = 0
        const MAX_ATTEMPTS = 4
        const RETRY_DELAY = 100
        const ATTEMPT_TIMEOUT = 800
        const OVERALL_TIMEOUT = 2500

        function clearAttemptTimer(): void {
          if (attemptTimer) {
            clearTimeout(attemptTimer)
            attemptTimer = 0
          }
        }

        function finish(node: PosterCanvas): void {
          if (finished) {
            return
          }
          finished = true
          clearAttemptTimer()
          clearTimeout(overallTimer)
          console.log('【海报调试】Canvas 节点获取成功，共尝试', attempts, '次')
          resolve(node)
        }

        function fail(message: string): void {
          if (finished) {
            return
          }
          finished = true
          clearAttemptTimer()
          clearTimeout(overallTimer)
          console.error('【海报调试】Canvas 节点获取失败:', message)
          reject(new Error(message))
        }

        function scheduleRetry(reason: string): void {
          if (finished) {
            return
          }
          if (attempts >= MAX_ATTEMPTS) {
            fail(`海报 Canvas 初始化失败：${reason}`)
            return
          }
          console.warn(`【海报调试】${reason}，100ms 后重试（已尝试 ${attempts} 次）`)
          setTimeout(() => queryOnce(), RETRY_DELAY)
        }

        function queryOnce(): void {
          if (finished) {
            return
          }
          attempts += 1
          console.log(`【海报调试】查询 Canvas 节点：第 ${attempts} 次`)
          attemptTimer = setTimeout(() => {
            attemptTimer = 0
            if (!finished) {
              scheduleRetry('节点查询无响应')
            }
          }, ATTEMPT_TIMEOUT) as unknown as number

          self
            .createSelectorQuery()
            .select('#posterCanvas')
            .fields({ node: true, size: true })
            .exec((result: unknown[]) => {
              if (finished) {
                return
              }
              clearAttemptTimer()
              const entry = result && result[0]
              const record =
                entry && typeof entry === 'object'
                  ? (entry as { node?: PosterCanvas; width?: number; height?: number })
                  : null
              const node = record ? record.node : undefined
              const width = record && typeof record.width === 'number' ? record.width : 0
              const height = record && typeof record.height === 'number' ? record.height : 0
              console.log(
                '【海报调试】Canvas尺寸:',
                width,
                height,
                '节点:',
                Boolean(node),
                '第',
                attempts,
                '次',
              )
              if (node && typeof node.getContext === 'function' && width > 0 && height > 0) {
                finish(node)
                return
              }
              if (attempts >= MAX_ATTEMPTS && node && typeof node.getContext === 'function') {
                console.warn('【海报调试】尺寸始终为 0，回退逻辑尺寸 480×720 继续绘制')
                finish(node)
                return
              }
              scheduleRetry(width <= 0 || height <= 0 ? 'Canvas 尺寸为 0' : 'Canvas 节点不存在')
            })
        }

        overallTimer = setTimeout(() => {
          fail('海报 Canvas 查询超时')
        }, OVERALL_TIMEOUT) as unknown as number

        queryOnce()
      })
    },

    /** 生成海报，返回临时文件路径；永不 reject 白屏，失败由调用方提示 */
    async generate(payload: PosterPayload): Promise<string> {
      if (this.data.generating) {
        throw new Error('海报正在生成中')
      }
      this.setData({ generating: true })

      try {
        const dpr = readPixelRatio()
        console.log('【海报调试】Canvas尺寸:', POSTER_W, POSTER_H, 'DPR:', dpr)

        let canvas: PosterCanvas
        let usingOffscreen = false
        if (isDevtools()) {
          /* Skyline 开发者工具不支持 <canvas> 组件，直接走离屏 Canvas */
          const fallback = createOffscreenPosterCanvas(dpr)
          if (fallback) {
            canvas = fallback
            usingOffscreen = true
            console.log('【海报调试】模拟器通道：离屏 Canvas')
          } else {
            await this.mountCanvas()
            canvas = await this.queryCanvas()
            console.log('【海报调试】离屏 Canvas 不可用，回退页面 Canvas')
          }
        } else {
          await this.mountCanvas()
          try {
            canvas = await this.queryCanvas()
          } catch (error) {
            console.warn('【海报调试】页面 Canvas 不可用，尝试离屏 Canvas', error)
            const fallback = createOffscreenPosterCanvas(dpr)
            if (!fallback) {
              throw error
            }
            canvas = fallback
            usingOffscreen = true
          }
        }

        canvas.width = POSTER_W * dpr
        canvas.height = POSTER_H * dpr
        console.log('【海报调试】绘制通道:', usingOffscreen ? '离屏 Canvas' : '页面 Canvas')
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          throw new Error('Canvas 2D 上下文不可用')
        }
        ctx.scale(dpr, dpr)
        console.log('【海报调试】Canvas 2D 上下文就绪，画布像素:', canvas.width, '×', canvas.height)

        const qrImage = await loadQrImage(canvas)
        console.log('【海报调试】二维码状态:', qrImage ? '已加载' : '使用占位，继续绘制')
        drawPoster(ctx, payload, qrImage)
        console.log('【海报调试】绘制完成，开始导出')

        const filePath = await withTimeout(
          new Promise<string>((resolve, reject) => {
            wx.canvasToTempFilePath({
              canvas: canvas as unknown as WechatMiniprogram.Canvas,
              x: 0,
              y: 0,
              width: canvas.width,
              height: canvas.height,
              destWidth: canvas.width,
              destHeight: canvas.height,
              fileType: 'png',
              quality: 1,
              success: (res) => resolve(res.tempFilePath),
              fail: (error) => reject(new Error(error.errMsg || '海报导出失败')),
            })
          }),
          12000,
          '海报导出超时',
        )
        console.log('【海报调试】海报导出成功:', filePath)
        return filePath
      } catch (error) {
        console.error('【海报调试】海报生成失败:', error)
        throw error
      } finally {
        this.setData({ generating: false, canvasMounted: false })
        console.log('【海报调试】生成流程结束，画布已卸载')
      }
    },
  },
})
