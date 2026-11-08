/* ==========================================================================
   曜石名片 · Canvas 绘制内核
   - 只负责几何与像素绘制，不持有页面状态；页面通过 hooks 回填 UI 状态
   - 所有外部字段先收敛再绘制，字段缺失不抛异常
   ========================================================================== */
import type { Profile } from '../../../core/types/index'
import type { paletteFor } from '../../../core/constants/index'
import { asArray } from '../../../core/utils/guards'

export const CARD_W = 340
export const CARD_H = 540

export type CardPalette = ReturnType<typeof paletteFor>

/** Canvas 2D 绘制上下文最小契约（本模块消费的 API 集） */
export interface DrawCtx {
  scale(x: number, y: number): void
  fillRect(x: number, y: number, w: number, h: number): void
  fillStyle: string | object
  strokeStyle: string | object
  lineWidth: number
  font: string
  textAlign: string
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
  clip(): void
  drawImage(img: unknown, x: number, y: number, w: number, h: number): void
  fillText(text: string, x: number, y: number): void
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): object
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): object
}

/** 渐变对象最小契约 */
export interface GradientLike {
  addColorStop(offset: number, color: string): void
}

export interface CardDrawHooks {
  /** 页面是否已卸载或弹层已关闭 */
  isDestroyed(): boolean
  /** 名片绘制可保存 */
  onReady(): void
  /** 绘制失败统一收口 */
  onError(error: unknown): void
}

/** 名片显示高度上限：52% 视觉上限，再预留 300px 给标题、按钮与安全区 */
export function maxCardHeightFor(windowHeight: number): number {
  return Math.max(220, Math.min(windowHeight * 0.52, windowHeight - 300))
}

/** 名片显示尺寸：按 340:540 适配可用宽度，并限制在弹层可用高度内 */
export function computeCardDisplaySize(): { width: number; height: number } {
  const info = wx.getWindowInfo()
  const sidePadding = (40 / 750) * info.windowWidth * 2
  const availW = Math.max(220, info.windowWidth - sidePadding)
  const maxH = maxCardHeightFor(info.windowHeight)
  let height = (availW * CARD_H) / CARD_W
  let width = availW
  if (height > maxH) {
    height = maxH
    width = (height * CARD_W) / CARD_H
  }
  return { width: Math.round(width), height: Math.round(height) }
}

/** 手写圆角矩形（规避 roundRect 兼容性） */
export function roundRect(
  ctx: DrawCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** 底色 / 光斑 / 展墙网格 / 顶部胶囊 */
export function drawCardBase(ctx: DrawCtx, palette: CardPalette): void {
  ctx.fillStyle = palette.canvas
  ctx.fillRect(0, 0, CARD_W, CARD_H)

  const glowIris = ctx.createRadialGradient(
    CARD_W * 0.24,
    90,
    10,
    CARD_W * 0.24,
    90,
    240,
  ) as unknown as GradientLike
  glowIris.addColorStop(0, 'rgba(107, 118, 220, 0.34)')
  glowIris.addColorStop(1, 'rgba(107, 118, 220, 0)')
  ctx.fillStyle = glowIris
  ctx.fillRect(0, 0, CARD_W, 320)

  const glowAurora = ctx.createRadialGradient(
    CARD_W * 0.85,
    170,
    10,
    CARD_W * 0.85,
    170,
    200,
  ) as unknown as GradientLike
  glowAurora.addColorStop(0, 'rgba(82, 205, 176, 0.22)')
  glowAurora.addColorStop(1, 'rgba(82, 205, 176, 0)')
  ctx.fillStyle = glowAurora
  ctx.fillRect(0, 0, CARD_W, 320)

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.045)'
  ctx.lineWidth = 0.5
  for (let gx = 24; gx < CARD_W; gx += 24) {
    ctx.beginPath()
    ctx.moveTo(gx, 0)
    ctx.lineTo(gx, CARD_H)
    ctx.stroke()
  }
  for (let gy = 24; gy < CARD_H; gy += 24) {
    ctx.beginPath()
    ctx.moveTo(0, gy)
    ctx.lineTo(CARD_W, gy)
    ctx.stroke()
  }

  ctx.fillStyle = 'rgba(82, 205, 176, 0.12)'
  roundRect(ctx, CARD_W / 2 - 96, 46, 192, 30, 15)
  ctx.fill()
  ctx.strokeStyle = 'rgba(82, 205, 176, 0.5)'
  ctx.lineWidth = 1
  roundRect(ctx, CARD_W / 2 - 96, 46, 192, 30, 15)
  ctx.stroke()
  ctx.fillStyle = palette.aurora
  ctx.font = '600 10px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('期待新的可能', CARD_W / 2, 65)
}

/** 头像圆形裁剪 + 光环，落位后绘制下半段 */
export function drawAvatar(
  ctx: DrawCtx,
  palette: CardPalette,
  img: unknown,
  profile: Profile,
  canvasNode: WechatMiniprogram.Canvas,
  hooks: CardDrawHooks,
): void {
  const ax = CARD_W / 2
  const ay = 158
  const ar = 52
  ctx.save()
  ctx.beginPath()
  ctx.arc(ax, ay, ar, 0, Math.PI * 2)
  ctx.clip()
  ctx.drawImage(img, ax - ar, ay - ar, ar * 2, ar * 2)
  ctx.restore()
  ctx.strokeStyle = 'rgba(138, 147, 236, 0.55)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(ax, ay, ar + 5, 0, Math.PI * 2)
  ctx.stroke()
  drawCardBody(ctx, palette, profile, canvasNode, hooks)
}

/** 头像缺失：品牌渐变圆替代，不中断名片生成 */
export function drawAvatarFallback(
  ctx: DrawCtx,
  palette: CardPalette,
  profile: Profile,
  canvasNode: WechatMiniprogram.Canvas,
  hooks: CardDrawHooks,
): void {
  const ax = CARD_W / 2
  const ay = 158
  const ar = 52
  const grad = ctx.createLinearGradient(ax - ar, ay - ar, ax + ar, ay + ar) as unknown as GradientLike
  grad.addColorStop(0, 'rgba(138, 147, 236, 0.9)')
  grad.addColorStop(0.5, 'rgba(82, 205, 176, 0.8)')
  grad.addColorStop(1, 'rgba(232, 197, 138, 0.7)')
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(ax, ay, ar, 0, Math.PI * 2)
  ctx.fill()
  drawCardBody(ctx, palette, profile, canvasNode, hooks)
}

/** 姓名 / 身份 / 别名 / 座右铭 / 坐标 / 邮箱 / 二维码 */
export function drawCardBody(
  ctx: DrawCtx,
  palette: CardPalette,
  profile: Profile,
  canvasNode: WechatMiniprogram.Canvas,
  hooks: CardDrawHooks,
): void {
  const name = profile.name ?? ''
  const heroLine = profile.heroLine ?? ''
  const alias = profile.alias ?? ''
  const motto = profile.motto ?? ''
  const email = profile.email ?? ''
  const location = asArray<string>(profile.location).join(' · ')

  ctx.textAlign = 'center'
  ctx.fillStyle = palette.ink
  ctx.font = 'bold 34px sans-serif'
  ctx.fillText(name, CARD_W / 2, 258)

  ctx.fillStyle = palette.ink3
  ctx.font = '600 11px sans-serif'
  ctx.fillText(heroLine, CARD_W / 2, 284)

  ctx.fillStyle = 'rgba(107, 118, 220, 0.16)'
  roundRect(ctx, CARD_W / 2 - 44, 302, 88, 28, 14)
  ctx.fill()
  ctx.strokeStyle = 'rgba(138, 147, 236, 0.4)'
  ctx.lineWidth = 1
  roundRect(ctx, CARD_W / 2 - 44, 302, 88, 28, 14)
  ctx.stroke()
  ctx.fillStyle = palette.iris
  ctx.font = '600 12px sans-serif'
  ctx.fillText(alias, CARD_W / 2, 321)

  ctx.fillStyle = palette.ink2
  ctx.font = '500 15px sans-serif'
  ctx.fillText(`「${motto}」`, CARD_W / 2, 372)

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(48, 396)
  ctx.lineTo(CARD_W - 48, 396)
  ctx.stroke()

  ctx.textAlign = 'left'
  ctx.fillStyle = palette.ink3
  ctx.font = '500 11px sans-serif'
  ctx.fillText(location, 48, 424)
  ctx.fillText(email, 48, 448)

  const qx = CARD_W - 118
  const qy = CARD_H - 130

  ctx.textAlign = 'center'
  ctx.fillStyle = palette.ink3
  ctx.font = '600 10px sans-serif'
  ctx.fillText('扫码进入', qx + 36, qy + 100)

  try {
    const qr = canvasNode.createImage()
    qr.onload = () => {
      if (hooks.isDestroyed()) {
        return
      }
      try {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.96)'
        roundRect(ctx, qx - 10, qy - 10, 92, 92, 10)
        ctx.fill()
        ctx.drawImage(qr, qx, qy, 72, 72)
        hooks.onReady()
      } catch (error) {
        hooks.onError(error)
      }
    }
    qr.onerror = () => {
      if (hooks.isDestroyed()) {
        return
      }
      try {
        /* 二维码缺失：以 iris 方块占位，文字照常 */
        ctx.fillStyle = 'rgba(107, 118, 220, 0.3)'
        roundRect(ctx, qx, qy, 72, 72, 10)
        ctx.fill()
        hooks.onReady()
      } catch (error) {
        hooks.onError(error)
      }
    }
    qr.src = '/assets/img/qr-blog.png'
  } catch (error) {
    hooks.onError(error)
  }
}
