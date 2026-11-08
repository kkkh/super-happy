/**
 * g-aurora · Canvas 2D 粒子极光背景 v2「馆内灯光」
 * 三层视效：大光晕缓慢漂移（美术馆射灯）+ 星尘粒子脉冲上浮 + 主题感知色
 * - 页面隐藏时自动暂停渲染循环（防后台耗电），再入视野恢复
 * - Canvas 初始化失败时静默降级（页面底色依旧成立）
 * 用法示例：
 *   <g-aurora density="{{40}}" />
 */
import { createStoreBindings } from 'mobx-miniprogram-bindings'
import { paletteFor } from '../../../../core/constants/index'
import { uiStore } from '../../../../core/stores/ui'
import type { ResolvedTheme } from '../../../../core/types/index'
import { logger } from '../../../../core/utils/logger'

/** 星尘粒子 */
interface Dust {
  x: number
  y: number
  r: number
  vx: number
  vy: number
  hue: string
  alpha: number
  pulse: number
}

/** 大光晕（射灯） */
interface Glow {
  x: number
  y: number
  r: number
  vx: number
  vy: number
  color: string
  phase: number
}

interface AuroraState {
  rafId?: number
  canvasNode?: WechatMiniprogram.Canvas
  dust: Dust[]
  glows: Glow[]
  width: number
  height: number
  running: boolean
  storeBindings?: { destroyStoreBindings: () => void }
}

/** Canvas 2D 上下文最小结构契约 */
interface Ctx2D {
  scale: (x: number, y: number) => void
  clearRect: (x: number, y: number, w: number, h: number) => void
  beginPath: () => void
  arc: (x: number, y: number, r: number, start: number, end: number) => void
  fill: () => void
  globalAlpha: number
  fillStyle: string | object
}

/** 主题 → 射灯色板 */
function glowsFor(theme: ResolvedTheme, width: number, height: number): Glow[] {
  const palette = paletteFor(theme)
  return [
    { x: width * 0.2, y: height * 0.22, r: Math.max(width, height) * 0.55, vx: 0.06, vy: 0.03, color: palette.heroGlow, phase: 0 },
    { x: width * 0.82, y: height * 0.36, r: Math.max(width, height) * 0.42, vx: -0.05, vy: 0.04, color: 'rgba(82, 205, 176, 0.16)', phase: 2 },
    { x: width * 0.55, y: height * 0.78, r: Math.max(width, height) * 0.38, vx: 0.04, vy: -0.03, color: 'rgba(232, 197, 138, 0.1)', phase: 4 },
  ]
}

/** 主题 → 星尘色序 */
function huesFor(theme: ResolvedTheme): string[] {
  const palette = paletteFor(theme)
  return [palette.iris, palette.aurora, palette.amber, palette.iris]
}

Component({
  properties: {
    density: { type: Number, value: 36 },
  },

  data: {
    themeDark: true,
  },

  observers: {
    /** 主题翻转：光晕与星尘原地换色，渲染循环不重启 */
    themeDark(value: boolean) {
      const state = this as unknown as AuroraState
      const theme: ResolvedTheme = value ? 'dark' : 'light'
      const hues = huesFor(theme)
      for (let i = 0; i < state.dust.length; i += 1) {
        state.dust[i].hue = hues[i % hues.length]
      }
      state.glows = glowsFor(theme, state.width, state.height)
    },
  },

  lifetimes: {
    attached() {
      const state = this as unknown as AuroraState
      state.dust = []
      state.glows = []
      state.width = 0
      state.height = 0
      state.running = true
      state.storeBindings = createStoreBindings(this, {
        store: uiStore,
        fields: {
          themeDark: () => uiStore.resolvedTheme === 'dark',
        },
        actions: [],
      })
      this.initCanvas()
    },
    detached() {
      const state = this as unknown as AuroraState
      state.running = false
      if (state.rafId && state.canvasNode) {
        state.canvasNode.cancelAnimationFrame(state.rafId)
        state.rafId = 0
      }
      if (state.storeBindings) {
        state.storeBindings.destroyStoreBindings()
      }
    },
  },

  pageLifetimes: {
    /** 页面隐藏：暂停渲染循环（防后台耗电） */
    hide() {
      const state = this as unknown as AuroraState
      state.running = false
    },
    /** 页面再入：恢复渲染 */
    show() {
      const state = this as unknown as AuroraState
      /* 低内存告警后不再恢复 Canvas 动画，优先保住页面可用性 */
      if (uiStore.lowMemory) {
        return
      }
      if (!state.running && state.canvasNode) {
        state.running = true
        this.resume()
      }
    },
  },

  methods: {
    initCanvas() {
      this.createSelectorQuery()
        .select('#aurora')
        .fields({ node: true, size: true })
        .exec((res) => {
          const first = res[0] as { node?: WechatMiniprogram.Canvas; width: number; height: number } | null
          if (!first || !first.node) {
            logger.warn('aurora', 'Canvas 节点不可用，极光层静默降级')
            return
          }
          const canvas = first.node
          const ctx = canvas.getContext('2d') as unknown as Ctx2D | null
          if (!ctx) {
            logger.warn('aurora', 'Canvas 2D 上下文不可用，极光层静默降级')
            return
          }
          const dpr = wx.getWindowInfo().pixelRatio
          canvas.width = first.width * dpr
          canvas.height = first.height * dpr
          ctx.scale(dpr, dpr)

          const state = this as unknown as AuroraState
          state.canvasNode = canvas
          state.width = first.width
          state.height = first.height

          /* 星尘初始化 */
          const count = Math.max(12, this.data.density)
          const hues = huesFor(uiStore.resolvedTheme)
          for (let i = 0; i < count; i += 1) {
            state.dust.push({
              x: Math.random() * first.width,
              y: Math.random() * first.height,
              r: 1 + Math.random() * 2.6,
              vx: (Math.random() - 0.5) * 0.22,
              vy: -0.05 - Math.random() * 0.14,
              hue: hues[i % hues.length],
              alpha: 0.3 + Math.random() * 0.5,
              pulse: Math.random() * Math.PI * 2,
            })
          }
          /* 光晕初始化 */
          state.glows = glowsFor(uiStore.resolvedTheme, first.width, first.height)

          this.run(ctx, canvas)
        })
    },

    /** 页面恢复时的重启入口（渲染循环已在跑则忽略） */
    resume() {
      const state = this as unknown as AuroraState
      if (state.rafId || !state.canvasNode) {
        return
      }
      const ctx = state.canvasNode.getContext('2d') as unknown as Ctx2D | null
      if (!ctx) {
        return
      }
      this.run(ctx, state.canvasNode)
    },

    run(ctx: Ctx2D, canvas: WechatMiniprogram.Canvas) {
      const state = this as unknown as AuroraState
      const { width, height } = state

      const frame = () => {
        if (!state.running || uiStore.lowMemory) {
          state.running = false
          state.rafId = 0
          return
        }

        ctx.clearRect(0, 0, width, height)

        /* 层 1 · 大光晕（射灯，径向渐隐） */
        for (const g of state.glows) {
          g.x += g.vx
          g.y += g.vy
          g.phase += 0.004
          if (g.x < -g.r * 0.4 || g.x > width + g.r * 0.4) g.vx = -g.vx
          if (g.y < -g.r * 0.4 || g.y > height + g.r * 0.4) g.vy = -g.vy
          ctx.globalAlpha = 0.7 + 0.3 * Math.sin(g.phase)
          ctx.fillStyle = g.color
          ctx.beginPath()
          ctx.arc(g.x, g.y, g.r, 0, Math.PI * 2)
          ctx.fill()
        }

        /* 层 2 · 星尘（脉冲 + 缓慢上浮） */
        for (const p of state.dust) {
          p.x += p.vx
          p.y += p.vy
          p.pulse += 0.02
          if (p.x < -8) p.x = width + 8
          if (p.x > width + 8) p.x = -8
          if (p.y < -8) p.y = height + 8
          if (p.y > height + 8) p.y = -8
          const glow = p.alpha * (0.7 + 0.3 * Math.sin(p.pulse))
          ctx.globalAlpha = glow
          ctx.fillStyle = p.hue
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
          ctx.fill()
          ctx.globalAlpha = glow * 0.25
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.r * 3.2, 0, Math.PI * 2)
          ctx.fill()
        }

        ctx.globalAlpha = 1
        state.rafId = canvas.requestAnimationFrame(frame)
      }
      frame()
    },
  },
})
