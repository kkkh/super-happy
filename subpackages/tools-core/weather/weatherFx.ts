/* ==========================================================================
   weather/weatherFx · 全屏天气粒子引擎（Canvas 2D）
   - 30fps 上限；lowMemory / reduced-motion 直接退化为静态
   - 只用渐变与几何，不用 filter / backdrop-filter（Skyline 残影教训）
   - 覆盖层由页面设置 pointer-events:none 与 aria-hidden
   ========================================================================== */
import type { WeatherFamily } from './types'

export interface FxGradient {
  addColorStop: (offset: number, color: string) => void
}

export interface FxContext {
  setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => void
  clearRect: (x: number, y: number, width: number, height: number) => void
  beginPath: () => void
  closePath: () => void
  moveTo: (x: number, y: number) => void
  lineTo: (x: number, y: number) => void
  stroke: () => void
  fill: () => void
  arc: (x: number, y: number, radius: number, start: number, end: number) => void
  fillRect: (x: number, y: number, width: number, height: number) => void
  createRadialGradient: (
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ) => FxGradient
  createLinearGradient: (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ) => FxGradient
  strokeStyle: string | FxGradient
  fillStyle: string | FxGradient
  lineWidth: number
  lineCap: string
  globalAlpha: number
}

export interface FxCanvasNode {
  width: number
  height: number
  getContext: (type: '2d') => FxContext | null
  requestAnimationFrame?: (callback: (time: number) => void) => number
  cancelAnimationFrame?: (handle: number) => void
}

export interface FxConfig {
  family: WeatherFamily
  isNight: boolean
  theme: 'dark' | 'light'
  lowMemory: boolean
  reduceMotion: boolean
}

type ParticleKind = 'rain' | 'snow' | 'mote' | 'star' | 'streak'

interface Particle {
  kind: ParticleKind
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  alpha: number
  phase: number
}

const FRAME_MS = 33

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function densityFor(family: WeatherFamily): number {
  if (family === 'heavyRain' || family === 'thunder') {
    return 96
  }
  if (family === 'rain') {
    return 64
  }
  if (family === 'snow') {
    return 64
  }
  if (family === 'sleet') {
    return 58
  }
  if (family === 'dust' || family === 'haze') {
    return 44
  }
  if (family === 'clear') {
    return 34
  }
  if (family === 'wind') {
    return 26
  }
  return 0
}

export class WeatherFxEngine {
  private node: FxCanvasNode | null = null
  private ctx: FxContext | null = null
  private width = 0
  private height = 0
  private dpr = 1
  private family: WeatherFamily = 'unknown'
  private isNight = false
  private theme: 'dark' | 'light' = 'dark'
  private reduceMotion = false
  private lowMemory = false
  private running = false
  private rafHandle = 0
  private timerHandle = 0
  private lastFrameAt = 0
  private startedAt = 0
  private particles: Particle[] = []
  private random: () => number = mulberry32(1)
  private nextFlashAt = 0
  private flashUntil = 0

  mount(
    node: FxCanvasNode,
    width: number,
    height: number,
    dpr: number,
  ): void {
    this.node = node
    this.ctx = node.getContext('2d')
    this.resize(width, height, dpr)
  }

  configure(config: FxConfig): void {
    this.family = config.family
    this.isNight = config.isNight
    this.theme = config.theme
    this.lowMemory = config.lowMemory
    this.reduceMotion = config.reduceMotion
    this.rebuildParticles()
    if (this.reduceMotion || this.lowMemory) {
      this.stop()
      this.drawStatic()
    }
  }

  resize(width: number, height: number, dpr: number): void {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return
    }
    this.width = width
    this.height = height
    this.dpr = Math.min(Math.max(1, dpr || 1), 2)
    if (this.node) {
      const pixelWidth = Math.max(1, Math.round(width * this.dpr))
      const pixelHeight = Math.max(1, Math.round(height * this.dpr))
      if (this.node.width !== pixelWidth) {
        this.node.width = pixelWidth
      }
      if (this.node.height !== pixelHeight) {
        this.node.height = pixelHeight
      }
    }
    this.rebuildParticles()
    this.drawStatic()
  }

  start(): void {
    if (this.running || !this.node || !this.ctx) {
      return
    }
    if (this.reduceMotion || this.lowMemory) {
      this.drawStatic()
      return
    }
    this.running = true
    this.startedAt = Date.now()
    this.lastFrameAt = 0
    this.nextFlashAt = Date.now() + 6000 + this.random() * 4000
    this.schedule()
  }

  stop(): void {
    this.running = false
    if (this.node && this.rafHandle && typeof this.node.cancelAnimationFrame === 'function') {
      this.node.cancelAnimationFrame(this.rafHandle)
    }
    this.rafHandle = 0
    if (this.timerHandle) {
      clearTimeout(this.timerHandle)
      this.timerHandle = 0
    }
  }

  dispose(): void {
    this.stop()
    this.node = null
    this.ctx = null
    this.particles = []
  }

  private schedule(): void {
    if (!this.running || !this.node) {
      return
    }
    if (typeof this.node.requestAnimationFrame === 'function') {
      this.rafHandle = this.node.requestAnimationFrame((time) => {
        this.frame(time)
      })
      return
    }
    this.timerHandle = setTimeout(() => {
      this.frame(Date.now())
    }, FRAME_MS) as unknown as number
  }

  private frame(time: number): void {
    if (!this.running) {
      return
    }
    if (this.lastFrameAt && time - this.lastFrameAt < FRAME_MS) {
      this.schedule()
      return
    }
    this.lastFrameAt = time
    this.draw(time)
    this.schedule()
  }

  private rebuildParticles(): void {
    const seed =
      (this.width * 31 + this.height * 17 + (this.isNight ? 97 : 13)) ^
      (this.family.length * 131)
    this.random = mulberry32(seed)
    const density = this.reduceMotion || this.lowMemory ? 0 : densityFor(this.family)
    const particles: Particle[] = []
    for (let index = 0; index < density; index += 1) {
      particles.push(this.createParticle())
    }
    this.particles = particles
  }

  private createParticle(): Particle {
    const random = this.random
    const family = this.family
    if (family === 'rain' || family === 'heavyRain' || family === 'thunder') {
      return {
        kind: 'rain',
        x: random() * this.width,
        y: random() * this.height,
        vx: 0.6 + random() * 0.8,
        vy: (family === 'heavyRain' || family === 'thunder' ? 11 : 7) + random() * 6,
        radius: 0,
        alpha: 0.18 + random() * 0.28,
        phase: 0,
      }
    }
    if (family === 'snow' || family === 'sleet') {
      return {
        kind: family === 'sleet' && random() > 0.5 ? 'rain' : 'snow',
        x: random() * this.width,
        y: random() * this.height,
        vx: (random() - 0.5) * 0.8,
        vy: 0.5 + random() * 1.4,
        radius: 1 + random() * 2.2,
        alpha: 0.25 + random() * 0.4,
        phase: random() * Math.PI * 2,
      }
    }
    if (family === 'clear' && this.isNight) {
      return {
        kind: 'star',
        x: random() * this.width,
        y: random() * this.height * 0.7,
        vx: 0,
        vy: 0,
        radius: 0.8 + random() * 1.2,
        alpha: 0.3 + random() * 0.5,
        phase: random() * Math.PI * 2,
      }
    }
    if (family === 'wind') {
      return {
        kind: 'streak',
        x: random() * this.width,
        y: random() * this.height,
        vx: 12 + random() * 10,
        vy: 0,
        radius: 0,
        alpha: 0.08 + random() * 0.16,
        phase: random() * 20,
      }
    }
    return {
      kind: 'mote',
      x: random() * this.width,
      y: random() * this.height,
      vx: (random() - 0.5) * 0.25,
      vy: -0.15 - random() * 0.35,
      radius: 0.8 + random() * 1.6,
      alpha: 0.12 + random() * 0.24,
      phase: random() * Math.PI * 2,
    }
  }

  private draw(time: number): void {
    const ctx = this.ctx
    if (!ctx || this.width <= 0 || this.height <= 0) {
      return
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, this.width, this.height)
    ctx.globalAlpha = 1
    const elapsed = time - this.startedAt
    this.drawAtmosphere(ctx, time)
    this.particles.forEach((particle) => {
      this.stepParticle(particle, time)
      this.drawParticle(ctx, particle, time)
    })
    if (this.family === 'thunder' && !this.reduceMotion) {
      if (time > this.nextFlashAt) {
        this.flashUntil = time + 120
        this.nextFlashAt = time + 6000 + this.random() * 7000
      }
      if (time < this.flashUntil) {
        ctx.globalAlpha = 0.12
        ctx.fillStyle = this.theme === 'dark' ? '#DCE6FF' : '#7E8CFF'
        ctx.fillRect(0, 0, this.width, this.height)
        ctx.globalAlpha = 1
      }
    }
    if (elapsed < 0) {
      this.startedAt = time
    }
  }

  private drawStatic(): void {
    const ctx = this.ctx
    if (!ctx) {
      return
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, this.width, this.height)
    ctx.globalAlpha = 1
    this.drawAtmosphere(ctx, Date.now())
  }

  private drawAtmosphere(ctx: FxContext, time: number): void {
    if (this.family === 'clear') {
      const glow = ctx.createRadialGradient(
        this.width * 0.78,
        this.height * 0.18,
        0,
        this.width * 0.78,
        this.height * 0.18,
        Math.max(this.width, this.height) * 0.62,
      )
      glow.addColorStop(0, this.isNight ? 'rgba(170,190,255,0.18)' : 'rgba(255,207,138,0.22)')
      glow.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, this.width, this.height)
    }
    if (this.family === 'partly' || this.family === 'cloudy' || this.family === 'overcast') {
      const drift = Math.sin(time / 9000) * 18
      const clouds = [
        { x: 0.25, y: 0.24, r: 0.34, a: 0.1 },
        { x: 0.7, y: 0.34, r: 0.4, a: 0.08 },
        { x: 0.52, y: 0.58, r: 0.46, a: 0.06 },
      ]
      clouds.forEach((cloud) => {
        const radius = Math.max(this.width, this.height) * cloud.r
        const gradient = ctx.createRadialGradient(
          this.width * cloud.x + drift,
          this.height * cloud.y,
          0,
          this.width * cloud.x + drift,
          this.height * cloud.y,
          radius,
        )
        gradient.addColorStop(0, `rgba(210,220,255,${cloud.a})`)
        gradient.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, this.width, this.height)
      })
    }
    if (this.family === 'haze' || this.family === 'dust') {
      ctx.globalAlpha = 0.08
      ctx.fillStyle = this.family === 'dust' ? '#D2A064' : '#C9B27A'
      ctx.fillRect(0, 0, this.width, this.height)
      ctx.globalAlpha = 1
    }
    if (this.family === 'fog') {
      const offset = Math.sin(time / 11000) * 20
      for (let index = 0; index < 4; index += 1) {
        const y = this.height * (0.28 + index * 0.16)
        const gradient = ctx.createLinearGradient(0, y, this.width, y + 40)
        gradient.addColorStop(0, 'rgba(220,228,245,0)')
        gradient.addColorStop(0.5, `rgba(220,228,245,${0.06 + index * 0.01})`)
        gradient.addColorStop(1, 'rgba(220,228,245,0)')
        ctx.fillStyle = gradient
        ctx.fillRect(offset - 40, y, this.width + 80, 42)
      }
    }
    if (this.family === 'tornado') {
      ctx.strokeStyle = 'rgba(210,220,255,0.12)'
      ctx.lineWidth = 2
      for (let index = 0; index < 3; index += 1) {
        const phase = time / 1400 + index * 2
        ctx.beginPath()
        ctx.arc(
          this.width * 0.6,
          this.height * 0.55,
          this.width * (0.16 + index * 0.06),
          phase,
          phase + Math.PI * 1.2,
        )
        ctx.stroke()
      }
    }
    if (this.family === 'hot') {
      const gradient = ctx.createLinearGradient(0, 0, 0, this.height)
      gradient.addColorStop(0, 'rgba(255,140,90,0.08)')
      gradient.addColorStop(1, 'rgba(255,140,90,0)')
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, this.width, this.height)
    }
  }

  private stepParticle(particle: Particle, time: number): void {
    if (!this.running) {
      return
    }
    if (particle.kind === 'star') {
      return
    }
    particle.x += particle.vx
    particle.y += particle.vy
    if (particle.kind === 'snow') {
      particle.x += Math.sin(time / 1200 + particle.phase) * 0.4
    }
    if (particle.y > this.height + 20) {
      particle.y = -20
      particle.x = this.random() * this.width
    }
    if (particle.x > this.width + 20) {
      particle.x = -20
    }
    if (particle.x < -20) {
      particle.x = this.width + 20
    }
    if (particle.kind === 'mote' && particle.y < -20) {
      particle.y = this.height + 10
      particle.x = this.random() * this.width
    }
  }

  private drawParticle(ctx: FxContext, particle: Particle, time: number): void {
    ctx.globalAlpha = particle.alpha
    if (particle.kind === 'rain') {
      ctx.beginPath()
      ctx.strokeStyle = 'rgba(170,205,255,0.72)'
      ctx.lineWidth = 1
      ctx.moveTo(particle.x, particle.y)
      ctx.lineTo(particle.x - 2, particle.y + 14)
      ctx.stroke()
    } else if (particle.kind === 'snow') {
      ctx.beginPath()
      ctx.fillStyle = 'rgba(235,242,255,0.9)'
      ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2)
      ctx.fill()
    } else if (particle.kind === 'star') {
      const twinkle = 0.55 + Math.sin(time / 1800 + particle.phase) * 0.25
      ctx.globalAlpha = particle.alpha * twinkle
      ctx.beginPath()
      ctx.fillStyle = 'rgba(220,232,255,0.95)'
      ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2)
      ctx.fill()
    } else if (particle.kind === 'streak') {
      ctx.beginPath()
      ctx.strokeStyle = 'rgba(200,220,255,0.5)'
      ctx.lineWidth = 1
      ctx.moveTo(particle.x, particle.y)
      ctx.lineTo(particle.x - 18, particle.y)
      ctx.stroke()
    } else {
      ctx.beginPath()
      ctx.fillStyle = 'rgba(235,242,255,0.8)'
      ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }
}
