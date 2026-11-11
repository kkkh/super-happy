/* ==========================================================================
   weather/weatherChart · 4 天双折线 + 24h 推算曲线（纯 Canvas 2D）
   - 只接收 CSS 像素尺寸；DPR 变换由页面统一 setTransform
   - 温度全相等时强制留出上下空间；缺数据不伪造 0
   - 图表本身 aria-hidden，页面另提供文字摘要
   ========================================================================== */
import type { ForecastDay, HourlyPoint } from './types'

export interface ChartGradient {
  addColorStop: (offset: number, color: string) => void
}

export interface ChartContext {
  setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => void
  clearRect: (x: number, y: number, width: number, height: number) => void
  beginPath: () => void
  closePath: () => void
  moveTo: (x: number, y: number) => void
  lineTo: (x: number, y: number) => void
  stroke: () => void
  fill: () => void
  arc: (x: number, y: number, radius: number, start: number, end: number) => void
  createLinearGradient: (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ) => ChartGradient
  fillText: (text: string, x: number, y: number) => void
  save: () => void
  restore: () => void
  font: string
  fillStyle: string | ChartGradient
  strokeStyle: string | ChartGradient
  lineWidth: number
  lineCap: string
  textAlign: string
  textBaseline: string
  globalAlpha: number
}

type ThemeMode = 'dark' | 'light'

interface ChartPalette {
  text: string
  dim: string
  grid: string
  day: string
  night: string
  accent: string
  dayArea: string
  hourlyArea: string
}

const DARK: ChartPalette = {
  text: '#F5F7FC',
  dim: '#8A94AB',
  grid: 'rgba(255, 255, 255, 0.12)',
  day: '#FFCF8A',
  night: '#8F9BFF',
  accent: '#6EE7C8',
  dayArea: 'rgba(255, 207, 138, 0.18)',
  hourlyArea: 'rgba(110, 231, 200, 0.16)',
}

const LIGHT: ChartPalette = {
  text: '#151A24',
  dim: '#7C869A',
  grid: 'rgba(21, 26, 36, 0.12)',
  day: '#D99A32',
  night: '#4C56B7',
  accent: '#0FB59A',
  dayArea: 'rgba(217, 154, 50, 0.14)',
  hourlyArea: 'rgba(15, 181, 154, 0.12)',
}

function paletteFor(theme: ThemeMode): ChartPalette {
  return theme === 'dark' ? DARK : LIGHT
}

function roundRectLabel(
  ctx: ChartContext,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align = 'center',
): void {
  ctx.save()
  ctx.font = `${size}px sans-serif`
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x, y)
  ctx.restore()
}

function drawGridLabel(
  ctx: ChartContext,
  text: string,
  x: number,
  y: number,
  color: string,
): void {
  roundRectLabel(ctx, text, x, y, 10, color, 'right')
}

export function drawForecastChart(
  ctx: ChartContext,
  width: number,
  height: number,
  days: ForecastDay[],
  theme: ThemeMode,
): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return
  }
  ctx.clearRect(0, 0, width, height)
  const palette = paletteFor(theme)
  const list = days.slice(0, 4)
  if (list.length === 0) {
    roundRectLabel(ctx, '暂无预报数据', width / 2, height / 2, 12, palette.dim)
    return
  }

  const temps: number[] = []
  list.forEach((day) => {
    if (day.daytemp !== null) {
      temps.push(day.daytemp)
    }
    if (day.nighttemp !== null) {
      temps.push(day.nighttemp)
    }
  })
  if (temps.length === 0) {
    roundRectLabel(ctx, '温度数据缺失', width / 2, height / 2, 12, palette.dim)
    return
  }

  const padLeft = 36
  const padRight = 18
  const padTop = 38
  const padBottom = 42
  const plotWidth = Math.max(1, width - padLeft - padRight)
  const plotHeight = Math.max(1, height - padTop - padBottom)
  let min = Math.min(...temps)
  let max = Math.max(...temps)
  if (max - min < 2) {
    min -= 2
    max += 2
  } else {
    const pad = Math.max(2, Math.ceil((max - min) * 0.16))
    min -= pad
    max += pad
  }
  const yOf = (temp: number): number =>
    padTop + ((max - temp) / (max - min)) * plotHeight
  const xOf = (index: number): number =>
    list.length === 1
      ? padLeft + plotWidth / 2
      : padLeft + (plotWidth / (list.length - 1)) * index

  /* 网格与温度刻度 */
  ctx.lineWidth = 1
  for (let index = 0; index < 3; index += 1) {
    const temp = max - ((max - min) / 2) * index
    const y = yOf(temp)
    ctx.beginPath()
    ctx.strokeStyle = palette.grid
    ctx.moveTo(padLeft, y)
    ctx.lineTo(width - padRight, y)
    ctx.stroke()
    drawGridLabel(ctx, `${Math.round(temp)}°`, padLeft - 8, y, palette.dim)
  }

  /* 图例 */
  ctx.beginPath()
  ctx.strokeStyle = palette.day
  ctx.lineWidth = 2
  ctx.moveTo(padLeft, 18)
  ctx.lineTo(padLeft + 18, 18)
  ctx.stroke()
  roundRectLabel(ctx, '白天', padLeft + 24, 18, 10, palette.day, 'left')
  ctx.beginPath()
  ctx.strokeStyle = palette.night
  ctx.moveTo(padLeft + 66, 18)
  ctx.lineTo(padLeft + 84, 18)
  ctx.stroke()
  roundRectLabel(ctx, '夜间', padLeft + 90, 18, 10, palette.night, 'left')

  const drawLine = (
    values: Array<number | null>,
    color: string,
    fillArea: boolean,
    areaColor: string,
    labelOffset: number,
  ): void => {
    const points = values
      .map((value, index) =>
        value === null ? null : { x: xOf(index), y: yOf(value), value },
      )
      .filter((point): point is { x: number; y: number; value: number } => Boolean(point))
    if (points.length === 0) {
      return
    }

    if (fillArea && points.length > 1) {
      const gradient = ctx.createLinearGradient(0, padTop, 0, padTop + plotHeight)
      gradient.addColorStop(0, areaColor)
      gradient.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.beginPath()
      ctx.fillStyle = gradient
      ctx.moveTo(points[0].x, padTop + plotHeight)
      points.forEach((point) => {
        ctx.lineTo(point.x, point.y)
      })
      ctx.lineTo(points[points.length - 1].x, padTop + plotHeight)
      ctx.closePath()
      ctx.fill()
    }

    ctx.beginPath()
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    points.forEach((point, index) => {
      if (index === 0) {
        ctx.moveTo(point.x, point.y)
      } else {
        ctx.lineTo(point.x, point.y)
      }
    })
    ctx.stroke()

    points.forEach((point) => {
      ctx.beginPath()
      ctx.fillStyle = color
      ctx.arc(point.x, point.y, 3, 0, Math.PI * 2)
      ctx.fill()
      roundRectLabel(
        ctx,
        `${Math.round(point.value)}°`,
        point.x,
        point.y + labelOffset,
        10,
        palette.text,
      )
    })
  }

  drawLine(
    list.map((day) => day.daytemp),
    palette.day,
    true,
    palette.dayArea,
    -13,
  )
  drawLine(
    list.map((day) => day.nighttemp),
    palette.night,
    false,
    palette.dayArea,
    14,
  )

  /* 日期 / 星期 */
  list.forEach((day, index) => {
    const x = xOf(index)
    const dateText = day.date.slice(5)
    roundRectLabel(ctx, dateText, x, height - 22, 10, palette.text)
    roundRectLabel(ctx, day.weekLabel || day.week, x, height - 9, 9, palette.dim)
  })
}

export function drawHourlyChart(
  ctx: ChartContext,
  width: number,
  height: number,
  points: HourlyPoint[],
  theme: ThemeMode,
): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return
  }
  ctx.clearRect(0, 0, width, height)
  const palette = paletteFor(theme)
  if (points.length === 0) {
    roundRectLabel(ctx, '暂无足够预报数据', width / 2, height / 2, 11, palette.dim)
    return
  }
  const padLeft = 8
  const padRight = 8
  const padTop = 18
  const padBottom = 20
  const plotWidth = Math.max(1, width - padLeft - padRight)
  const plotHeight = Math.max(1, height - padTop - padBottom)
  let min = Math.min(...points.map((point) => point.temp))
  let max = Math.max(...points.map((point) => point.temp))
  if (max - min < 2) {
    min -= 1
    max += 1
  }
  const yOf = (temp: number): number =>
    padTop + ((max - temp) / (max - min)) * plotHeight
  const xOf = (index: number): number =>
    padLeft + (plotWidth / Math.max(1, points.length - 1)) * index

  const gradient = ctx.createLinearGradient(0, padTop, 0, padTop + plotHeight)
  gradient.addColorStop(0, palette.hourlyArea)
  gradient.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.beginPath()
  ctx.fillStyle = gradient
  ctx.moveTo(padLeft, padTop + plotHeight)
  points.forEach((point, index) => {
    ctx.lineTo(xOf(index), yOf(point.temp))
  })
  ctx.lineTo(padLeft + plotWidth, padTop + plotHeight)
  ctx.closePath()
  ctx.fill()

  ctx.beginPath()
  ctx.strokeStyle = palette.accent
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  points.forEach((point, index) => {
    const x = xOf(index)
    const y = yOf(point.temp)
    if (index === 0) {
      ctx.moveTo(x, y)
    } else {
      ctx.lineTo(x, y)
    }
  })
  ctx.stroke()

  ctx.beginPath()
  ctx.fillStyle = palette.accent
  ctx.arc(xOf(0), yOf(points[0].temp), 3, 0, Math.PI * 2)
  ctx.fill()
  roundRectLabel(ctx, `${points[0].temp}°`, xOf(0) + 6, yOf(points[0].temp) - 8, 10, palette.text, 'left')

  const marks = [0, 6, 12, 18, points.length - 1]
  marks.forEach((index) => {
    const point = points[index]
    if (!point) {
      return
    }
    roundRectLabel(ctx, point.label, xOf(index), height - 8, 9, palette.dim)
  })
}

export function forecastAriaText(days: ForecastDay[]): string {
  if (days.length === 0) {
    return '暂无预报数据'
  }
  const parts = days.slice(0, 4).map((day) => {
    const dayTemp = day.daytemp === null ? '—' : `${day.daytemp}℃`
    const nightTemp = day.nighttemp === null ? '—' : `${day.nighttemp}℃`
    return `${day.date} ${day.weekLabel || day.week}，白天${day.dayweather || '—'} ${dayTemp}，夜间${day.nightweather || '—'} ${nightTemp}，白天${day.daywind || '—'}风 ${day.daypower || '—'} 级，夜间${day.nightwind || '—'}风 ${day.nightpower || '—'} 级`
  })
  return `未来 ${days.length} 天预报：${parts.join('；')}。`
}
