/* ==========================================================================
   canvasGalaxy · 纯手写 Canvas 2D 数据星系物理引擎
   - 中心引力 + 切向涡旋 + 星球间弹性碰撞
   - 单指 pan / 双指 zoom 由页面映射为 engine 调用
   - 低端机降级：关闭 shadowBlur、减少粒子、跳过文字
   - 零 wx 依赖，全部状态在实例内，便于单测与卸载清理
   ========================================================================== */

export type GalaxyKind = 'favorite' | 'history' | 'preference' | 'snapshot'

export interface GalaxyNode {
  id: string
  label: string
  kind: GalaxyKind
  value?: string
  weight?: number
}

export interface GalaxyParticle {
  id: string
  label: string
  kind: GalaxyKind
  value: string
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  mass: number
  color: string
  phase: number
  /** 初始轨道半径：用极轻的径向弹簧把星球维持在散开状态 */
  orbit: number
}

export interface GalaxyGradient {
  addColorStop(offset: number, color: string): void
}

export interface GalaxyCtx {
  save(): void
  restore(): void
  clearRect(x: number, y: number, width: number, height: number): void
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void
  translate(x: number, y: number): void
  scale(x: number, y: number): void
  beginPath(): void
  arc(x: number, y: number, radius: number, start: number, end: number): void
  fill(): void
  stroke(): void
  fillText(text: string, x: number, y: number): void
  measureText(text: string): { width: number }
  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ): GalaxyGradient
  fillStyle: string | GalaxyGradient
  strokeStyle: string | GalaxyGradient
  lineWidth: number
  font: string
  textAlign: string
  textBaseline: string
  shadowColor: string
  shadowBlur: number
  globalAlpha: number
}

export interface GalaxyCanvas {
  width: number
  height: number
  getContext(type: '2d'): GalaxyCtx | null
}

interface GalaxyOptions {
  width?: number
  height?: number
  maxNodes?: number
  degraded?: boolean
  theme?: 'light' | 'dark'
}

const KIND_COLORS: Record<GalaxyKind, string> = {
  favorite: '#FFD166',
  history: '#7FE0C8',
  preference: '#A97BFF',
  snapshot: '#5FD0FF',
}

const DEFAULT_MAX_NODES = 24
const MIN_ZOOM = 0.55
const MAX_ZOOM = 2.6
/** 星球中心距小于该值时强制排斥，避免全部挤在引力中心 */
const MIN_REPULSION_DISTANCE = 40
/** 速度硬上限，防止低端机首帧积分过冲 */
const MAX_PARTICLE_SPEED = 1.1

export interface GalaxyTextRect {
  left: number
  top: number
  right: number
  bottom: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function safeNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export class GalaxyEngine {
  private particles: GalaxyParticle[] = []
  private width: number
  private height: number
  private maxNodes: number
  private degraded: boolean
  private theme: 'light' | 'dark'
  private cameraX = 0
  private cameraY = 0
  private zoom = 1
  private selectedId = ''
  private frame = 0

  constructor(options: GalaxyOptions = {}) {
    this.width = Math.max(1, safeNumber(options.width, 320))
    this.height = Math.max(1, safeNumber(options.height, 240))
    this.maxNodes = Math.max(4, safeNumber(options.maxNodes, DEFAULT_MAX_NODES))
    this.degraded = Boolean(options.degraded)
    this.theme = options.theme === 'light' ? 'light' : 'dark'
  }

  setTheme(theme: 'light' | 'dark'): void {
    this.theme = theme === 'light' ? 'light' : 'dark'
  }

  getTheme(): 'light' | 'dark' {
    return this.theme
  }

  setNodes(nodes: GalaxyNode[]): void {
    const safe = Array.isArray(nodes) ? nodes.slice(0, this.maxNodes) : []
    const previous = new Map(this.particles.map((particle) => [particle.id, particle]))
    this.particles = safe.map((node, index) => {
      const old = previous.get(node.id)
      const angle = (Math.PI * 2 * index) / Math.max(1, safe.length) + 0.4
      const ring =
        Math.min(this.width, this.height) * (0.3 + (index % 3) * 0.1)
      const radius = 9 + Math.min(10, Math.max(0, safeNumber(node.weight, 0)) * 2)
      return {
        id: node.id,
        label: node.label,
        kind: node.kind,
        value: node.value || '',
        x: old ? old.x : Math.cos(angle) * ring,
        y: old ? old.y : Math.sin(angle) * ring,
        vx: old ? old.vx : Math.cos(angle + Math.PI / 2) * 0.35,
        vy: old ? old.vy : Math.sin(angle + Math.PI / 2) * 0.35,
        radius,
        mass: Math.max(0.6, radius / 12),
        color: KIND_COLORS[node.kind] || KIND_COLORS.snapshot,
        phase: index * 0.9,
        orbit: old ? old.orbit : ring,
      }
    })
    if (this.selectedId && !this.particles.some((item) => item.id === this.selectedId)) {
      this.selectedId = ''
    }
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, safeNumber(width, this.width))
    this.height = Math.max(1, safeNumber(height, this.height))
  }

  setDegraded(degraded: boolean): void {
    this.degraded = Boolean(degraded)
    if (this.degraded) {
      this.maxNodes = Math.min(this.maxNodes, 16)
      if (this.particles.length > this.maxNodes) {
        this.particles = this.particles.slice(0, this.maxNodes)
      }
    }
  }

  isDegraded(): boolean {
    return this.degraded
  }

  pan(dx: number, dy: number): void {
    const limitX = this.width * 0.9
    const limitY = this.height * 0.9
    this.cameraX = clamp(this.cameraX + safeNumber(dx), -limitX, limitX)
    this.cameraY = clamp(this.cameraY + safeNumber(dy), -limitY, limitY)
  }

  zoomAt(factor: number, screenX: number, screenY: number): void {
    const safeFactor = clamp(safeNumber(factor, 1), 0.75, 1.35)
    const next = clamp(this.zoom * safeFactor, MIN_ZOOM, MAX_ZOOM)
    if (next === this.zoom) {
      return
    }
    const worldX = (screenX - this.width / 2 - this.cameraX) / this.zoom
    const worldY = (screenY - this.height / 2 - this.cameraY) / this.zoom
    this.zoom = next
    this.cameraX = screenX - this.width / 2 - worldX * this.zoom
    this.cameraY = screenY - this.height / 2 - worldY * this.zoom
  }

  zoomBy(factor: number): void {
    this.zoomAt(factor, this.width / 2, this.height / 2)
  }

  resetView(): void {
    this.cameraX = 0
    this.cameraY = 0
    this.zoom = 1
  }

  step(dtMs = 16): void {
    if (this.particles.length === 0) {
      return
    }
    const dt = clamp(safeNumber(dtMs, 16), 1, 32)
    const k = dt / 16
    const boundX = Math.max(40, this.width * 0.48 - 16)
    const boundY = Math.max(30, this.height * 0.48 - 16)
    this.frame += 1

    for (const particle of this.particles) {
      /* 极低引力 + 轻微涡旋：让星球悬浮散开，而不是全部吸到中心 */
      const gravity = 0.00008
      const swirl = 0.00004
      particle.vx += (-particle.x * gravity - particle.y * swirl) * k
      particle.vy += (-particle.y * gravity + particle.x * swirl) * k

      /* 极轻的径向弹簧：若被引力拉进内圈，缓慢推回自己的轨道半径 */
      const radial = Math.sqrt(particle.x * particle.x + particle.y * particle.y)
      if (radial > 0.001 && radial < particle.orbit * 0.92) {
        const push = (particle.orbit - radial) * 0.00045 * k
        particle.vx += (particle.x / radial) * push
        particle.vy += (particle.y / radial) * push
      }

      particle.vx *= 0.986
      particle.vy *= 0.986

      const speed = Math.sqrt(particle.vx * particle.vx + particle.vy * particle.vy)
      if (speed > MAX_PARTICLE_SPEED) {
        const ratio = MAX_PARTICLE_SPEED / speed
        particle.vx *= ratio
        particle.vy *= ratio
      }

      particle.x += particle.vx * k
      particle.y += particle.vy * k

      if (particle.x > boundX) {
        particle.x = boundX
        particle.vx = -Math.abs(particle.vx) * 0.72
      } else if (particle.x < -boundX) {
        particle.x = -boundX
        particle.vx = Math.abs(particle.vx) * 0.72
      }
      if (particle.y > boundY) {
        particle.y = boundY
        particle.vy = -Math.abs(particle.vy) * 0.72
      } else if (particle.y < -boundY) {
        particle.y = -boundY
        particle.vy = Math.abs(particle.vy) * 0.72
      }
    }

    /* 弹性碰撞：位置分离 + 法向速度交换，防止星球叠在一起 */
    for (let left = 0; left < this.particles.length; left += 1) {
      for (let right = left + 1; right < this.particles.length; right += 1) {
        const a = this.particles[left]
        const b = this.particles[right]
        let dx = b.x - a.x
        let dy = b.y - a.y
        let distance = Math.sqrt(dx * dx + dy * dy)
        const minDistance = a.radius + b.radius + 4
        if (distance <= 0.0001) {
          continue
        }
        const nx = dx / distance
        const ny = dy / distance

        /* 最小排斥距离：即使还没碰到，也把靠得过近的星球推开 */
        if (distance < MIN_REPULSION_DISTANCE) {
          const strength = (1 - distance / MIN_REPULSION_DISTANCE) * 0.045 * k
          a.vx -= nx * strength
          a.vy -= ny * strength
          b.vx += nx * strength
          b.vy += ny * strength
        }

        if (distance >= minDistance) {
          continue
        }
        const overlap = (minDistance - distance) * 0.52
        a.x -= nx * overlap
        a.y -= ny * overlap
        b.x += nx * overlap
        b.y += ny * overlap

        const relative = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
        if (relative < 0) {
          const impulse = -(1.7 * relative) / (a.mass + b.mass)
          a.vx -= impulse * b.mass * nx
          a.vy -= impulse * b.mass * ny
          b.vx += impulse * a.mass * nx
          b.vy += impulse * a.mass * ny
        }
      }
    }
  }

  draw(ctx: GalaxyCtx | null): void {
    if (!ctx) {
      return
    }
    const drawnTextRects: GalaxyTextRect[] = []
    ctx.clearRect(0, 0, this.width, this.height)
    ctx.save()
    ctx.translate(this.width / 2 + this.cameraX, this.height / 2 + this.cameraY)
    ctx.scale(this.zoom, this.zoom)

    /* 星系轨道：只画两条极淡的椭圆弧，制造空间纵深 */
    ctx.strokeStyle = 'rgba(160, 180, 255, 0.08)'
    ctx.lineWidth = 1
    for (let ring = 1; ring <= 2; ring += 1) {
      ctx.beginPath()
      ctx.arc(0, 0, Math.min(this.width, this.height) * (0.15 + ring * 0.12), 0, Math.PI * 2)
      ctx.stroke()
    }

    for (const particle of this.particles) {
      const selected = particle.id === this.selectedId
      const pulse = 0.88 + Math.sin((this.frame + particle.phase) * 0.04) * 0.12
      const radius = particle.radius * (selected ? 1.14 : 1)
      ctx.save()
      ctx.globalAlpha = this.degraded ? 0.92 : pulse
      if (!this.degraded) {
        ctx.shadowColor = particle.color
        ctx.shadowBlur = selected ? 26 : 16
      }
      ctx.beginPath()
      ctx.arc(particle.x, particle.y, radius, 0, Math.PI * 2)
      ctx.fillStyle = particle.color
      ctx.fill()
      ctx.restore()

      /* 内层高光：径向渐变让星球有体积感 */
      if (!this.degraded) {
        const gradient = ctx.createRadialGradient(
          particle.x - radius * 0.3,
          particle.y - radius * 0.35,
          0,
          particle.x,
          particle.y,
          radius * 1.35,
        )
        gradient.addColorStop(0, 'rgba(255,255,255,0.85)')
        gradient.addColorStop(0.35, particle.color)
        gradient.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.beginPath()
        ctx.arc(particle.x, particle.y, radius * 1.2, 0, Math.PI * 2)
        ctx.fillStyle = gradient
        ctx.fill()
      }

      if (selected) {
        ctx.beginPath()
        ctx.arc(particle.x, particle.y, radius + 6, 0, Math.PI * 2)
        ctx.strokeStyle = 'rgba(255,255,255,0.72)'
        ctx.lineWidth = 1.2
        ctx.stroke()
      }

      if (!this.degraded) {
        ctx.font = '600 10px sans-serif'
        const label =
          particle.label.length > 8
            ? `${particle.label.slice(0, 7)}…`
            : particle.label
        const textWidth = ctx.measureText(label).width * this.zoom
        const textHeight = 12 * this.zoom
        const screenCenterX =
          this.width / 2 + this.cameraX + particle.x * this.zoom
        const screenTop =
          this.height / 2 +
          this.cameraY +
          (particle.y + radius + 6) * this.zoom
        const rect: GalaxyTextRect = {
          left: screenCenterX - textWidth / 2,
          top: screenTop,
          right: screenCenterX + textWidth / 2,
          bottom: screenTop + textHeight,
        }

        const outOfCanvas =
          rect.left < 6 ||
          rect.right > this.width - 6 ||
          rect.top < 4 ||
          rect.bottom > this.height - 4
        const overlaps = drawnTextRects.some((other) => {
          const gap = 3
          return !(
            rect.right + gap < other.left ||
            rect.left - gap > other.right ||
            rect.bottom + gap < other.top ||
            rect.top - gap > other.bottom
          )
        })

        if (!outOfCanvas && !overlaps) {
          drawnTextRects.push(rect)
          ctx.save()
          ctx.textAlign = 'center'
          ctx.textBaseline = 'top'
          ctx.shadowColor =
            this.theme === 'light'
              ? 'rgba(255,255,255,0.8)'
              : 'rgba(0,0,0,0.65)'
          ctx.shadowBlur = 2
          ctx.fillStyle =
            this.theme === 'light'
              ? 'rgba(0,0,0,0.75)'
              : 'rgba(255,255,255,0.9)'
          ctx.fillText(label, particle.x, particle.y + radius + 6)
          ctx.restore()
        }
      }
    }

    ctx.restore()
  }

  hitTest(screenX: number, screenY: number): GalaxyParticle | null {
    const worldX = (screenX - this.width / 2 - this.cameraX) / this.zoom
    const worldY = (screenY - this.height / 2 - this.cameraY) / this.zoom
    let nearest: GalaxyParticle | null = null
    let best = Infinity
    for (const particle of this.particles) {
      const dx = particle.x - worldX
      const dy = particle.y - worldY
      const distance = Math.sqrt(dx * dx + dy * dy)
      if (distance <= particle.radius + 10 && distance < best) {
        best = distance
        nearest = particle
      }
    }
    if (nearest) {
      this.selectedId = nearest.id
    }
    return nearest
  }

  select(id: string): GalaxyParticle | null {
    const target = this.particles.find((particle) => particle.id === id)
    this.selectedId = target ? target.id : ''
    return target || null
  }

  selected(): GalaxyParticle | null {
    return this.particles.find((particle) => particle.id === this.selectedId) || null
  }

  getParticles(): GalaxyParticle[] {
    return this.particles
  }

  getView(): { x: number; y: number; zoom: number } {
    return { x: this.cameraX, y: this.cameraY, zoom: this.zoom }
  }

  getSize(): { width: number; height: number } {
    return { width: this.width, height: this.height }
  }

  clear(): void {
    this.particles = []
    this.selectedId = ''
    this.resetView()
  }
}

/** 由页面数据构建星系节点：收藏 / 历史 / 偏好 / 快照 */
export function buildGalaxyNodes(input: {
  favorites: string[]
  history: Array<{ toolName: string; categoryLabel?: string }>
  preferenceCount: number
  snapshotCount: number
}): GalaxyNode[] {
  const nodes: GalaxyNode[] = []
  const favorites: string[] = Array.isArray(input.favorites) ? input.favorites : []
  favorites.slice(0, 8).forEach((id: string, index: number) => {
    nodes.push({
      id: `fav-${id}`,
      label: id,
      kind: 'favorite',
      value: `收藏 · 第 ${index + 1} 位`,
      weight: 1,
    })
  })
  const history: Array<{ toolName: string; categoryLabel?: string }> = Array.isArray(
    input.history,
  )
    ? input.history
    : []
  const toolCount = new Map<string, number>()
  history.forEach((record) => {
    const name = record.toolName || '工具'
    toolCount.set(name, (toolCount.get(name) || 0) + 1)
  })
  Array.from(toolCount.entries())
    .slice(0, 10)
    .forEach(([name, count]) => {
      nodes.push({
        id: `his-${name}`,
        label: name,
        kind: 'history',
        value: `${count} 次使用`,
        weight: Math.min(4, count / 3),
      })
    })
  if (input.preferenceCount > 0) {
    nodes.push({
      id: 'pref',
      label: '偏好中枢',
      kind: 'preference',
      value: `${input.preferenceCount} 项配置`,
      weight: 2,
    })
  }
  if (input.snapshotCount > 0) {
    nodes.push({
      id: 'snap',
      label: '快照仓',
      kind: 'snapshot',
      value: `${input.snapshotCount} 份备份`,
      weight: 2,
    })
  }
  return nodes.slice(0, DEFAULT_MAX_NODES)
}
