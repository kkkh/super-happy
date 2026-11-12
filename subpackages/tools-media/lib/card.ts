/* ==========================================================================
   图片名片渲染 · Canvas 2D
   - 纯绘制，不读取通讯录、不上传
   - 输出 1080 × 672，二维码直接绘制在卡片右下角
   ========================================================================== */

export const CARD_WIDTH = 1080
export const CARD_HEIGHT = 672
export const CARD_CSS_WIDTH = 320
export const CARD_CSS_HEIGHT = 199

export interface CardData {
  name: string
  company: string
  title: string
  phone: string
  email: string
  address: string
  website: string
  note: string
}

export interface CardRow {
  label: string
  value: string
}

interface CardGradient {
  addColorStop(offset: number, color: string): void
}

interface CardContext {
  fillStyle: string | CardGradient
  strokeStyle: string
  font: string
  textAlign: 'left' | 'center' | 'right'
  textBaseline: 'top' | 'middle' | 'alphabetic'
  globalAlpha: number
  save(): void
  restore(): void
  fillRect(x: number, y: number, width: number, height: number): void
  clearRect(x: number, y: number, width: number, height: number): void
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void
  arc(x: number, y: number, radius: number, start: number, end: number): void
  closePath(): void
  fill(): void
  stroke(): void
  fillText(text: string, x: number, y: number): void
  measureText(text: string): { width: number }
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CardGradient
  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ): CardGradient
}

export function buildCardRows(data: CardData): CardRow[] {
  const rows: CardRow[] = []
  if (data.phone.trim()) {
    rows.push({ label: 'TEL', value: data.phone.trim() })
  }
  if (data.email.trim()) {
    rows.push({ label: 'MAIL', value: data.email.trim() })
  }
  if (data.website.trim()) {
    rows.push({ label: 'WEB', value: data.website.trim() })
  }
  if (data.address.trim()) {
    rows.push({ label: 'ADDR', value: data.address.trim() })
  }
  return rows.slice(0, 4)
}

function roundRect(
  ctx: CardContext,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
}

function fitText(ctx: CardContext, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) {
    return text
  }
  let output = text
  while (output.length > 1 && ctx.measureText(`${output}…`).width > maxWidth) {
    output = output.slice(0, -1)
  }
  return `${output}…`
}

function drawQr(
  ctx: CardContext,
  matrix: boolean[][],
  count: number,
  x: number,
  y: number,
  size: number,
): void {
  if (count <= 0) {
    return
  }
  const margin = 4
  const cell = size / (count + margin * 2)
  const offset = cell * margin
  ctx.fillStyle = '#0b0f1a'
  for (let row = 0; row < count; row += 1) {
    const line = matrix[row]
    if (!line) {
      continue
    }
    for (let col = 0; col < count; col += 1) {
      if (!line[col]) {
        continue
      }
      ctx.fillRect(
        Math.round(x + offset + col * cell),
        Math.round(y + offset + row * cell),
        Math.ceil(cell),
        Math.ceil(cell),
      )
    }
  }
}

export function drawVCardCard(
  canvas: WechatMiniprogram.Canvas,
  data: CardData,
  matrix: boolean[][],
  count: number,
): void {
  canvas.width = CARD_WIDTH
  canvas.height = CARD_HEIGHT
  const ctx = canvas.getContext('2d') as unknown as CardContext | null
  if (!ctx) {
    throw new Error('画布上下文不可用')
  }

  const background = ctx.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT)
  background.addColorStop(0, '#0a0f1c')
  background.addColorStop(0.55, '#111827')
  background.addColorStop(1, '#0b1324')
  ctx.fillStyle = background
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT)

  const glowA = ctx.createRadialGradient(900, 70, 20, 900, 70, 360)
  glowA.addColorStop(0, 'rgba(84, 207, 178, 0.26)')
  glowA.addColorStop(1, 'rgba(84, 207, 178, 0)')
  ctx.fillStyle = glowA
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT)

  const glowB = ctx.createRadialGradient(140, 620, 10, 140, 620, 380)
  glowB.addColorStop(0, 'rgba(107, 118, 220, 0.24)')
  glowB.addColorStop(1, 'rgba(107, 118, 220, 0)')
  ctx.fillStyle = glowB
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT)

  ctx.globalAlpha = 0.5
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)'
  ctx.beginPath()
  ctx.moveTo(72, 596)
  ctx.lineTo(1008, 596)
  ctx.stroke()
  ctx.globalAlpha = 1

  /* 品牌 */
  ctx.fillStyle = '#f5f7fb'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.font = '700 34px "PingFang SC", sans-serif'
  ctx.fillText('超欢', 72, 56)
  ctx.fillStyle = 'rgba(154, 163, 178, 0.9)'
  ctx.font = '500 15px Menlo, monospace'
  ctx.fillText('CHAOHUAN · TOOLBOX', 72, 104)

  /* 姓名与身份 */
  const name = data.name.trim() || '未命名'
  ctx.fillStyle = '#ffffff'
  ctx.font = `${name.length > 12 ? 52 : 64}px "PingFang SC", sans-serif`
  ctx.fillText(fitText(ctx, name, 640), 72, 178)

  ctx.fillStyle = '#54cfb2'
  ctx.fillRect(72, 262, 64, 6)

  const identity = [data.company.trim(), data.title.trim()].filter(Boolean).join(' · ')
  ctx.fillStyle = 'rgba(230, 233, 239, 0.92)'
  ctx.font = '400 28px "PingFang SC", sans-serif'
  ctx.fillText(
    fitText(ctx, identity || '个人名片 · 扫码保存联系人', 620),
    72,
    292,
  )

  /* 联系方式 */
  const rows = buildCardRows(data)
  const startY = 368
  rows.forEach((row, index) => {
    const y = startY + index * 52
    ctx.fillStyle = 'rgba(84, 207, 178, 0.9)'
    ctx.font = '600 16px Menlo, monospace'
    ctx.fillText(row.label, 72, y)
    ctx.fillStyle = 'rgba(245, 247, 251, 0.94)'
    ctx.font = '400 24px "PingFang SC", sans-serif'
    ctx.fillText(fitText(ctx, row.value, 600), 160, y - 4)
  })

  if (rows.length === 0) {
    ctx.fillStyle = 'rgba(154, 163, 178, 0.9)'
    ctx.font = '400 24px "PingFang SC", sans-serif'
    ctx.fillText('扫码保存联系人', 72, startY)
  }

  /* 二维码卡片 */
  const qrX = 808
  const qrY = 224
  const qrPanel = 208
  ctx.fillStyle = '#ffffff'
  roundRect(ctx, qrX, qrY, qrPanel, qrPanel, 24)
  ctx.fill()
  drawQr(ctx, matrix, count, qrX + 16, qrY + 16, qrPanel - 32)

  ctx.fillStyle = 'rgba(154, 163, 178, 0.92)'
  ctx.font = '400 15px "PingFang SC", sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('扫码保存联系人', qrX + qrPanel / 2, qrY + qrPanel + 26)
  ctx.textAlign = 'left'

  /* 页脚 */
  ctx.fillStyle = 'rgba(111, 118, 132, 0.95)'
  ctx.font = '400 15px "PingFang SC", sans-serif'
  ctx.fillText('本机生成 · 不上传 · vCard 3.0', 72, 626)

  if (data.note.trim()) {
    ctx.textAlign = 'right'
    ctx.fillStyle = 'rgba(154, 163, 178, 0.9)'
    ctx.fillText(fitText(ctx, data.note.trim(), 360), 1008, 626)
    ctx.textAlign = 'left'
  }
}
