/* ==========================================================================
   cockpit-chart · 数据驾驶舱 Canvas 绘制内核
   - 双主题调色板：白昼（深实色、零发光）/ 夜航（极光渐变、霓虹光晕）
   - 环形图：蓝紫极光 createLinearGradient，按进度从 0 旋转生长到最终占比
   - 折线图：从左向右「流星式」生长，头部带动态光核
   - 全部使用逻辑像素绘制，DPR 缩放由页面在挂载 Canvas 时完成
   - 不写死任何主题色：调色板唯一真相源在此，WXSS 图例变量与之同值
   ========================================================================== */

export type ChartTheme = 'day' | 'night'

/** Canvas 不能消费 WXSS 变量；显式与页面字体栈保持一致 */
const CHART_FONT = '"SF Pro Display", "PingFang SC", "Helvetica Neue", sans-serif'

export interface ChartSlice {
  code: string
  label: string
  value: number
  percent: number
}

export interface ChartPoint {
  label: string
  value: number
}

/** Canvas 2D 最小绘制契约：只声明驾驶舱实际消费的 API */
export interface ChartGradient {
  addColorStop(offset: number, color: string): void
}

export interface ChartCtx {
  save(): void
  restore(): void
  scale(x: number, y: number): void
  clearRect(x: number, y: number, width: number, height: number): void
  beginPath(): void
  closePath(): void
  arc(x: number, y: number, radius: number, start: number, end: number, counterclockwise?: boolean): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  fill(): void
  stroke(): void
  fillText(text: string, x: number, y: number): void
  measureText(text: string): { width: number }
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): ChartGradient
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): ChartGradient
  fillStyle: string | ChartGradient
  strokeStyle: string | ChartGradient
  lineWidth: number
  lineJoin: string
  font: string
  textAlign: string
  textBaseline: string
  shadowColor: string
  shadowBlur: number
  globalAlpha: number
}

export interface ChartCanvas {
  width: number
  height: number
  getContext(type: '2d'): ChartCtx | null
  requestAnimationFrame?: (callback: (time: number) => void) => number
  cancelAnimationFrame?: (handle: number) => void
}

export interface ChartPalette {
  slices: Record<string, [string, string]>
  axis: string
  grid: string
  track: string
  centerMain: string
  centerSub: string
  lineFrom: string
  lineTo: string
  areaFrom: string
  areaTo: string
  head: string
  headGlow: string
  shadow: string
  value: string
}

/** 夜航：霓虹发光开启，线条亮青 / 亮紫，背景保持深空玻璃 */
const NIGHT_PALETTE: ChartPalette = {
  slices: {
    calc: ['#5B7BFF', '#8A93EC'],
    date: ['#54CFB2', '#5FD0FF'],
    text: ['#A97BFF', '#6B76DC'],
    media: ['#FF8FD0', '#A97BFF'],
    life: ['#E9C68D', '#FFCF8A'],
    work: ['#5FD0FF', '#7FA6FF'],
  },
  axis: 'rgba(255, 255, 255, 0.62)',
  grid: 'rgba(255, 255, 255, 0.08)',
  track: 'rgba(255, 255, 255, 0.06)',
  centerMain: '#F4F6FB',
  centerSub: 'rgba(255, 255, 255, 0.68)',
  lineFrom: '#7FE0C8',
  lineTo: '#8A93EC',
  areaFrom: 'rgba(138, 147, 236, 0.24)',
  areaTo: 'rgba(138, 147, 236, 0)',
  head: '#DCE6FF',
  headGlow: 'rgba(138, 147, 236, 0.42)',
  shadow: 'rgba(100, 150, 255, 0.6)',
  value: 'rgba(255, 255, 255, 0.75)',
}

/** 白昼：关闭发光防止发灰，改用加深实色保证锐利对比 */
const DAY_PALETTE: ChartPalette = {
  slices: {
    calc: ['#2F4FD8', '#4453B8'],
    date: ['#0E7A66', '#0F6FA8'],
    text: ['#6A3FB8', '#4453B8'],
    media: ['#B03A8C', '#6A3FB8'],
    life: ['#8E6A24', '#B8863B'],
    work: ['#0F6FA8', '#2F4FD8'],
  },
  axis: 'rgba(0, 0, 0, 0.72)',
  grid: 'rgba(15, 25, 45, 0.08)',
  track: 'rgba(15, 25, 45, 0.06)',
  centerMain: '#151926',
  centerSub: 'rgba(0, 0, 0, 0.72)',
  lineFrom: '#2F4FD8',
  lineTo: '#6A3FB8',
  areaFrom: 'rgba(47, 79, 216, 0.16)',
  areaTo: 'rgba(47, 79, 216, 0)',
  head: '#2F4FD8',
  headGlow: 'rgba(47, 79, 216, 0.14)',
  shadow: 'rgba(0, 0, 0, 0)',
  value: 'rgba(0, 0, 0, 0.72)',
}

export function paletteFor(theme: ChartTheme): ChartPalette {
  return theme === 'night' ? NIGHT_PALETTE : DAY_PALETTE
}

function slicePairFor(code: string, palette: ChartPalette): [string, string] {
  return palette.slices[code] ?? palette.slices.calc
}

/** 缓动：生长前段快、尾段收束，避免机械匀速 */
export function easeOutCubic(progress: number): number {
  const clamped = Math.max(0, Math.min(1, progress))
  return 1 - Math.pow(1 - clamped, 3)
}

/* --------------------------------------------------------------------------
   环形图
   - progress：0 → 1，切片按占比依次展开，视觉上从 0% 旋转到最终比例
   - 缺口随生长保留，切片收尾处自动收敛，不会出现重叠毛刺
   -------------------------------------------------------------------------- */
export function drawDonutChart(
  ctx: ChartCtx,
  width: number,
  height: number,
  slices: ChartSlice[],
  total: number,
  progress: number,
  theme: ChartTheme,
  glow = true,
): void {
  const palette = paletteFor(theme)
  const size = Math.min(width, height)
  const centerX = width / 2
  const centerY = height / 2
  const outerRadius = Math.max(24, size / 2 - 8)
  const innerRadius = outerRadius * 0.64
  const ringRadius = (outerRadius + innerRadius) / 2
  const ringWidth = outerRadius - innerRadius
  const gap = 0.026

  ctx.clearRect(0, 0, width, height)

  /* 底环：空态与生长中的结构骨架，避免画布看起来是空的 */
  ctx.save()
  ctx.beginPath()
  ctx.arc(centerX, centerY, ringRadius, 0, Math.PI * 2)
  ctx.lineWidth = ringWidth
  ctx.strokeStyle = palette.track
  ctx.stroke()
  ctx.restore()

  let cursor = -Math.PI / 2
  if (total > 0) {
    slices.forEach((slice) => {
      const allotment = Math.max(0, Math.min(1, slice.percent)) * Math.PI * 2
      const sweep = allotment * Math.max(0, Math.min(1, progress))
      const start = cursor + gap / 2
      const end = cursor + sweep - gap / 2

      if (sweep > gap * 1.5 && end > start) {
        ctx.save()
        if (theme === 'night' && glow) {
          ctx.shadowColor = palette.shadow
          ctx.shadowBlur = 14
        } else {
          ctx.shadowBlur = 0
        }

        ctx.beginPath()
        ctx.arc(centerX, centerY, outerRadius, start, end, false)
        ctx.arc(centerX, centerY, innerRadius, end, start, true)
        ctx.closePath()

        const gradient = ctx.createLinearGradient(
          centerX - outerRadius,
          centerY - outerRadius,
          centerX + outerRadius,
          centerY + outerRadius,
        )
        const pair = slicePairFor(slice.code, palette)
        gradient.addColorStop(0, pair[0])
        gradient.addColorStop(1, pair[1])
        ctx.fillStyle = gradient
        ctx.fill()
        ctx.restore()
      }

      /* 游标按最终占比推进，动画不会改变切片之间的相对位置 */
      cursor += allotment
    })
  }

  /* 内圈细描边：让中心留白与玻璃卡片有清晰边界 */
  ctx.save()
  ctx.beginPath()
  ctx.arc(centerX, centerY, innerRadius, 0, Math.PI * 2)
  ctx.lineWidth = 1
  ctx.strokeStyle = palette.track
  ctx.stroke()
  ctx.restore()

  const mainSize = Math.round(size * 0.115)
  const subSize = Math.round(size * 0.062)
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = palette.centerMain
  ctx.font = `700 ${mainSize}px ${CHART_FONT}`
  ctx.fillText(String(Math.max(0, Math.round(total))), centerX, centerY - mainSize * 0.12)
  ctx.fillStyle = palette.centerSub
  ctx.font = `400 ${subSize}px ${CHART_FONT}`
  ctx.fillText('条轨迹', centerX, centerY + mainSize * 0.92)
  ctx.restore()
}

/* --------------------------------------------------------------------------
   折线图
   - 7 个日桶固定等距，progress 控制绘制到第几个点，形成流星生长
   - maxValue 至少为 3，避免全 0 时坐标轴贴底且刻度重复
   -------------------------------------------------------------------------- */
/** Y 轴上限对齐 3 等分，保证刻度全部是互不重复的整数 */
function niceMax(value: number): number {
  const safe = Math.max(1, value)
  const step = Math.ceil(safe / 3)
  return Math.max(3, step * 3)
}

export function drawLineChart(
  ctx: ChartCtx,
  width: number,
  height: number,
  points: ChartPoint[],
  progress: number,
  theme: ChartTheme,
  glow = true,
): void {
  const palette = paletteFor(theme)
  ctx.clearRect(0, 0, width, height)

  const paddingLeft = 28
  const paddingRight = 14
  const paddingTop = 22
  const paddingBottom = 26
  const plotWidth = Math.max(1, width - paddingLeft - paddingRight)
  const plotHeight = Math.max(1, height - paddingTop - paddingBottom)
  const baseline = paddingTop + plotHeight
  const count = points.length
  const maxValue = niceMax(count ? Math.max(...points.map((point) => point.value)) : 0)
  const axisSize = Math.max(10, Math.round(Math.min(width, height) * 0.052))

  ctx.save()
  ctx.textBaseline = 'middle'

  /* 横向网格与 Y 轴刻度 */
  const gridRows = 3
  for (let row = 0; row <= gridRows; row += 1) {
    const ratio = row / gridRows
    const y = baseline - plotHeight * ratio
    ctx.beginPath()
    ctx.moveTo(paddingLeft, y)
    ctx.lineTo(paddingLeft + plotWidth, y)
    ctx.lineWidth = 1
    ctx.strokeStyle = palette.grid
    ctx.stroke()

    ctx.fillStyle = palette.axis
    ctx.font = `400 ${axisSize}px ${CHART_FONT}`
    ctx.textAlign = 'right'
    ctx.fillText(String(Math.round(maxValue * ratio)), paddingLeft - 8, y)
  }

  /* X 轴日期：最后一个固定为「今天」 */
  ctx.textAlign = 'center'
  ctx.font = `400 ${axisSize}px ${CHART_FONT}`
  points.forEach((point, index) => {
    const x = count === 1 ? paddingLeft : paddingLeft + (plotWidth * index) / (count - 1)
    ctx.fillStyle = index === count - 1 ? palette.centerMain : palette.axis
    ctx.fillText(point.label, x, baseline + 14)
  })
  ctx.restore()

  if (count === 0) {
    return
  }

  const eased = Math.max(0, Math.min(1, progress))
  const headPosition = eased * (count - 1)
  const fullIndex = Math.floor(headPosition)
  const fraction = headPosition - fullIndex

  const drawn: Array<{ x: number; y: number; value: number; real: boolean }> = []
  for (let index = 0; index <= fullIndex && index < count; index += 1) {
    const value = points[index].value
    drawn.push({
      x: count === 1 ? paddingLeft : paddingLeft + (plotWidth * index) / (count - 1),
      y: baseline - (plotHeight * Math.min(value, maxValue)) / maxValue,
      value,
      real: true,
    })
  }
  if (fraction > 0 && fullIndex < count - 1) {
    const from = points[fullIndex].value
    const to = points[fullIndex + 1].value
    const index = fullIndex + fraction
    drawn.push({
      x: paddingLeft + (plotWidth * index) / (count - 1),
      y: baseline - (plotHeight * Math.min(from + (to - from) * fraction, maxValue)) / maxValue,
      value: from + (to - from) * fraction,
      real: false,
    })
  }

  if (drawn.length >= 2) {
    /* 面积：从折线向下渐隐，不抢线条主体 */
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(drawn[0].x, baseline)
    drawn.forEach((point) => ctx.lineTo(point.x, point.y))
    ctx.lineTo(drawn[drawn.length - 1].x, baseline)
    ctx.closePath()
    const area = ctx.createLinearGradient(0, paddingTop, 0, baseline)
    area.addColorStop(0, palette.areaFrom)
    area.addColorStop(1, palette.areaTo)
    ctx.fillStyle = area
    ctx.fill()
    ctx.restore()

    /* 折线主体：夜航开霓虹，白昼纯实色 */
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(drawn[0].x, drawn[0].y)
    for (let index = 1; index < drawn.length; index += 1) {
      ctx.lineTo(drawn[index].x, drawn[index].y)
    }
    const stroke = ctx.createLinearGradient(paddingLeft, 0, paddingLeft + plotWidth, 0)
    stroke.addColorStop(0, palette.lineFrom)
    stroke.addColorStop(1, palette.lineTo)
    ctx.strokeStyle = stroke
    ctx.lineJoin = 'round'
    ctx.lineWidth = theme === 'night' ? 2.6 : 2.2
    if (theme === 'night' && glow) {
      ctx.shadowColor = palette.shadow
      ctx.shadowBlur = 12
    } else {
      ctx.shadowBlur = 0
    }
    ctx.stroke()
    ctx.restore()
  }

  /* 原始节点小圆点 + 数值；插值点不参与，避免字随动画跳动 */
  drawn.forEach((point) => {
    if (!point.real) {
      return
    }
    ctx.save()
    ctx.beginPath()
    ctx.arc(point.x, point.y, theme === 'night' ? 2.8 : 2.4, 0, Math.PI * 2)
    ctx.fillStyle = palette.lineFrom
    ctx.fill()
    ctx.restore()

    if (point.value > 0) {
      ctx.save()
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      ctx.fillStyle = palette.value
      ctx.font = `500 ${axisSize}px ${CHART_FONT}`
      ctx.fillText(String(Math.round(point.value)), point.x, point.y - 7)
      ctx.restore()
    }
  })

  /* 流星头部：光环 + 亮核，夜航最强、白昼收敛 */
  if (drawn.length) {
    const head = drawn[drawn.length - 1]
    ctx.save()
    ctx.beginPath()
    ctx.arc(head.x, head.y, theme === 'night' ? 11 : 7, 0, Math.PI * 2)
    const glow = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, theme === 'night' ? 11 : 7)
    glow.addColorStop(0, palette.headGlow)
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = glow
    ctx.fill()

    ctx.beginPath()
    ctx.arc(head.x, head.y, theme === 'night' ? 3.4 : 2.8, 0, Math.PI * 2)
    ctx.fillStyle = palette.head
    if (theme === 'night' && glow) {
      ctx.shadowColor = palette.shadow
      ctx.shadowBlur = 10
    }
    ctx.fill()
    ctx.restore()
  }
}

/* --------------------------------------------------------------------------
   动画计划
   - 省电 / 关闭动画时必须直接落终态，否则只会画出第 0 帧（坐标轴 + 首个点）
   - 时长被倍率压到 0 时同样按终态处理
   -------------------------------------------------------------------------- */
export type ChartMotionLevel = 'full' | 'lite' | 'saver'

export interface ChartAnimationPlan {
  duration: number
  firstFrame: 0 | 1
}

export function planChartAnimation(
  animate: boolean,
  level: ChartMotionLevel,
  durationScale: number,
  baseDuration: number,
): ChartAnimationPlan {
  if (!animate || level === 'saver') {
    return { duration: 0, firstFrame: 1 }
  }
  const duration = Math.max(0, Math.round(baseDuration * durationScale))
  return duration > 0 ? { duration, firstFrame: 0 } : { duration: 0, firstFrame: 1 }
}

/* --------------------------------------------------------------------------
   动画驱动器
   - 优先使用 Canvas 节点的 requestAnimationFrame；离屏 / 旧环境回退 setTimeout
   - watchdog：部分 Skyline 真机 rAF 不回帧时，在时长后强制落终态
   - 返回 cancel，页面 onHide / onUnload / 重绘前必须调用
   -------------------------------------------------------------------------- */
export interface ChartAnimator {
  cancel(): void
}

export function animateChart(
  canvas: ChartCanvas | null,
  duration: number,
  paint: (progress: number) => void,
): ChartAnimator {
  let finished = false
  let frameHandle = 0
  let timer = 0
  let watchdog = 0
  const start = Date.now()

  const canRaf = Boolean(canvas && typeof canvas.requestAnimationFrame === 'function')

  const clearWatchdog = (): void => {
    if (watchdog) {
      clearTimeout(watchdog)
      watchdog = 0
    }
  }

  if (duration <= 0) {
    paint(1)
    return { cancel() {} }
  }

  const step = (): void => {
    if (finished) {
      return
    }
    const raw = Math.min(1, (Date.now() - start) / duration)
    paint(easeOutCubic(raw))
    if (raw >= 1) {
      finished = true
      clearWatchdog()
      return
    }
    schedule()
  }

  const schedule = (): void => {
    if (canRaf && canvas && typeof canvas.requestAnimationFrame === 'function') {
      frameHandle = canvas.requestAnimationFrame(step)
      return
    }
    timer = setTimeout(step, 16) as unknown as number
  }

  /* rAF 存在但真机不回帧的兜底：时长 + 220ms 后直接画终态 */
  watchdog = setTimeout(() => {
    watchdog = 0
    if (finished) {
      return
    }
    finished = true
    if (frameHandle && canvas && typeof canvas.cancelAnimationFrame === 'function') {
      canvas.cancelAnimationFrame(frameHandle)
    }
    frameHandle = 0
    paint(1)
  }, duration + 220) as unknown as number

  schedule()

  return {
    cancel(): void {
      finished = true
      clearWatchdog()
      if (frameHandle && canvas && typeof canvas.cancelAnimationFrame === 'function') {
        canvas.cancelAnimationFrame(frameHandle)
      }
      if (timer) {
        clearTimeout(timer)
        timer = 0
      }
      frameHandle = 0
    },
  }
}
