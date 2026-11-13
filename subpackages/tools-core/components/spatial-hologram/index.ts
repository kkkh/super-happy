/**
 * spatial-hologram · 极光空间视差容器
 * - CSS perspective + preserve-3d，三层深度插槽：back / 默认 / front
 * - 陀螺仪读取 beta / gamma，首帧校准基线，避免不同握持姿势跳变
 * - WXS 阻尼循环：change:prop + requestAnimationFrame + setStyle，不逐帧 setData
 * - 页面隐藏 / 关闭 / 禁用时停止监听并回正
 * - virtualHost + styleIsolation，样式不污染页面
 *
 * 用法：
 *   <spatial-hologram>
 *     <glass-card>首页主内容</glass-card>
 *     <view slot="back">背景装饰</view>
 *     <view slot="front">前景装饰</view>
 *   </spatial-hologram>
 */
import { useMotion } from '../../../../core/services/motion'

export interface HologramTiltConfig {
  targetX: number
  targetY: number
  damping: number
  epoch: number
}

interface HologramRuntime {
  motionHandler: ((result: WechatMiniprogram.OnDeviceMotionChangeListenerResult) => void) | null
  started: boolean
  tiltTimer: number
  pendingX: number
  pendingY: number
  hasBaseline: boolean
  baselineBeta: number
  baselineGamma: number
}

const RAD_TO_DEG = 180 / Math.PI
const TILT_COMMIT_INTERVAL = 30
const DEFAULT_MAX_TILT = 8
const DEFAULT_DAMPING = 0.12
const DEFAULT_SENSITIVITY = 0.35

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

Component({
  options: {
    virtualHost: true,
    multipleSlots: true,
    styleIsolation: 'isolated',
    addGlobalClass: false,
  },

  externalClasses: ['custom-class'],

  properties: {
    /** 是否启用陀螺仪 */
    enabled: {
      type: Boolean,
      value: true,
    },
    /** attached / show 时自动开始监听 */
    autoStart: {
      type: Boolean,
      value: true,
    },
    /** 最大倾斜角度（度） */
    maxTilt: {
      type: Number,
      value: DEFAULT_MAX_TILT,
    },
    /** 陀螺仪灵敏度 */
    sensitivity: {
      type: Number,
      value: DEFAULT_SENSITIVITY,
    },
    /** WXS 阻尼系数 0.05–0.5 */
    damping: {
      type: Number,
      value: DEFAULT_DAMPING,
    },
    /** 页面隐藏时是否回正 */
    resetOnHide: {
      type: Boolean,
      value: true,
    },
    /** 是否渲染内置极光球 */
    aurora: {
      type: Boolean,
      value: true,
    },
    /** 读屏标签 */
    ariaLabel: {
      type: String,
      value: '空间视差容器',
    },
    /** 外部布局样式 */
    customStyle: {
      type: String,
      value: '',
    },
  },

  data: {
    motionActive: false,
    /* Skyline 下 WXS 可能无法直接操作场景节点，保留数据驱动的兜底变换 */
    tiltStyle: 'transform: perspective(1200rpx) rotateX(0deg) rotateY(0deg);',
    tiltConfig: {
      targetX: 0,
      targetY: 0,
      damping: DEFAULT_DAMPING,
      epoch: 0,
    } as HologramTiltConfig,
  },

  observers: {
    enabled(value: boolean) {
      if (value) {
        this.startMotion()
      } else {
        this.stopMotion()
        this.resetTilt()
      }
    },

    damping() {
      this.pushTiltConfig(
        this.data.tiltConfig.targetX,
        this.data.tiltConfig.targetY,
        true,
      )
    },
  },

  lifetimes: {
    attached() {
      const runtime = this as unknown as HologramRuntime
      runtime.started = false
      runtime.tiltTimer = 0
      runtime.pendingX = 0
      runtime.pendingY = 0
      runtime.hasBaseline = false
      runtime.baselineBeta = 0
      runtime.baselineGamma = 0
      runtime.motionHandler = (result: WechatMiniprogram.OnDeviceMotionChangeListenerResult) => {
        this.handleMotion(result)
      }

      if (this.data.autoStart) {
        this.startMotion()
      }
    },

    detached() {
      const runtime = this as unknown as HologramRuntime
      this.stopMotion(false)
      if (runtime.tiltTimer) {
        clearTimeout(runtime.tiltTimer)
        runtime.tiltTimer = 0
      }
    },
  },

  pageLifetimes: {
    show() {
      if (this.data.autoStart && this.data.enabled) {
        this.startMotion()
      }
    },

    hide() {
      this.stopMotion()
      if (this.data.resetOnHide) {
        this.resetTilt()
      }
    },
  },

  methods: {
    startMotion(): void {
      const runtime = this as unknown as HologramRuntime
      if (!this.data.enabled || !this.data.autoStart || runtime.started) {
        return
      }
      /* useMotion 统一读取偏好：省电模式直接禁用陀螺仪阻尼 */
      if (!useMotion().hologramEnabled) {
        if (this.data.motionActive) {
          this.setData({ motionActive: false })
        }
        return
      }

      if (typeof wx.startDeviceMotionListening !== 'function') {
        this.setData({ motionActive: false })
        return
      }

      try {
        wx.startDeviceMotionListening({
          interval: 'game',
          success: () => {
            if (!runtime.motionHandler || runtime.started) {
              return
            }
            wx.onDeviceMotionChange(runtime.motionHandler)
            runtime.started = true
            this.setData({ motionActive: true })
          },
          fail: () => {
            runtime.started = false
            this.setData({ motionActive: false })
          },
        })
      } catch {
        runtime.started = false
        this.setData({ motionActive: false })
      }
    },

    stopMotion(updateState = true): void {
      const runtime = this as unknown as HologramRuntime
      if (runtime.motionHandler) {
        try {
          wx.offDeviceMotionChange(
            runtime.motionHandler as unknown as WechatMiniprogram.OffDeviceMotionChangeCallback,
          )
        } catch {
          /* 旧版本无 off 接口时忽略 */
        }
      }
      if (runtime.started && typeof wx.stopDeviceMotionListening === 'function') {
        try {
          wx.stopDeviceMotionListening({ fail: () => undefined })
        } catch {
          /* 停止失败静默 */
        }
      }
      runtime.started = false
      runtime.hasBaseline = false
      if (updateState) {
        this.setData({ motionActive: false })
      }
    },

    handleMotion(result: WechatMiniprogram.OnDeviceMotionChangeListenerResult): void {
      const runtime = this as unknown as HologramRuntime
      const betaDeg = result.beta * RAD_TO_DEG
      const gammaDeg = result.gamma * RAD_TO_DEG

      if (!runtime.hasBaseline) {
        runtime.baselineBeta = betaDeg
        runtime.baselineGamma = gammaDeg
        runtime.hasBaseline = true
        return
      }

      const deltaBeta = betaDeg - runtime.baselineBeta
      const deltaGamma = gammaDeg - runtime.baselineGamma
      const sensitivity = clamp(this.data.sensitivity, 0.05, 2)
      const maxTilt = clamp(this.data.maxTilt, 0, 24)

      runtime.pendingX = clamp(-deltaBeta * sensitivity, -maxTilt, maxTilt)
      runtime.pendingY = clamp(deltaGamma * sensitivity, -maxTilt, maxTilt)

      if (runtime.tiltTimer) {
        return
      }

      runtime.tiltTimer = setTimeout(() => {
        runtime.tiltTimer = 0
        this.pushTiltConfig(runtime.pendingX, runtime.pendingY, false)
      }, TILT_COMMIT_INTERVAL) as unknown as number
    },

    pushTiltConfig(targetX: number, targetY: number, force: boolean): void {
      if (
        !force &&
        this.data.tiltConfig.targetX === targetX &&
        this.data.tiltConfig.targetY === targetY
      ) {
        return
      }

      const config: HologramTiltConfig = {
        targetX,
        targetY,
        damping: clamp(this.data.damping, 0.05, 0.5),
        epoch: this.data.tiltConfig.epoch + 1,
      }
      this.setData({
        tiltConfig: config,
        tiltStyle: `transform: perspective(1200rpx) rotateX(${targetX.toFixed(
          3,
        )}deg) rotateY(${targetY.toFixed(3)}deg);`,
      })
    },

    resetTilt(): void {
      const runtime = this as unknown as HologramRuntime
      if (runtime.tiltTimer) {
        clearTimeout(runtime.tiltTimer)
        runtime.tiltTimer = 0
      }
      runtime.pendingX = 0
      runtime.pendingY = 0
      runtime.hasBaseline = false
      this.pushTiltConfig(0, 0, true)
    },
  },
})
