/* ==========================================================================
   全局 UI Store · 主题状态机 + 全局提示
   - 主题三态：auto（跟随系统）/ light（晨瓷）/ dark（黑曜石）
   - resolvedTheme → themeClass 是页面根节点唯一挂载点
   - 动画态一律走组件局部，不入 Store
   ========================================================================== */
import { observable } from 'mobx-miniprogram'
import type { ResolvedTheme, ThemeMode } from '../types/index'
import { STORAGE_KEYS, TIMING } from '../constants/index'
import { preferenceStore } from './preference'

const THEME_MODES: ThemeMode[] = ['auto', 'light', 'dark']

const THEME_MODE_LABELS: Record<ThemeMode, string> = {
  auto: '外观 · 跟随系统',
  light: '外观 · 晨瓷浅色',
  dark: '外观 · 黑曜深色',
}

/** 系统外观读取：异常时回退深色（品牌默认基调） */
function readSystemTheme(): ResolvedTheme {
  try {
    const info = wx.getAppBaseInfo()
    return info.theme === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

/** 与 theme.json / 页面实际画布保持同一组值，避免状态栏与首屏底色错位 */
const CANVAS_COLORS: Record<ResolvedTheme, string> = {
  dark: '#070a12',
  light: '#eef1f7',
}

/** 原生状态栏前景色对齐应用内主题：避免手动切换后深底深字 / 浅底浅字 */
function syncStatusBar(theme: ResolvedTheme): void {
  const frontColor: '#ffffff' | '#000000' = theme === 'dark' ? '#ffffff' : '#000000'
  const canvas = CANVAS_COLORS[theme]
  try {
    wx.setNavigationBarColor({
      frontColor,
      backgroundColor: canvas,
      fail: () => {},
    })
  } catch {
    // 极旧版本或自定义导航不支持时静默跳过
  }
  try {
    /* 手动主题与系统主题不一致时，页面栈底 / 下拉回弹仍会露出原生画布 */
    wx.setBackgroundColor({
      backgroundColor: canvas,
      backgroundColorTop: canvas,
      backgroundColorBottom: canvas,
      fail: () => {},
    })
  } catch {
    /* 低版本不支持时保持 theme.json 的系统画布 */
  }
}

export const uiStore = observable({
  /* ---- 全局提示 ---- */
  toastShow: false,
  toastMessage: '',
  toastTimer: 0,

  /* ---- 主题状态机 ---- */
  themeMode: 'auto' as ThemeMode,
  systemTheme: 'dark' as ResolvedTheme,
  themeInited: false,
  /** 真实发生了昼↔夜翻转：页面据此播放一次呼吸，掩盖硬切 */
  themeSwitching: false,
  themeSwitchTimer: 0,

  /* ---- 低内存降级：收到 onMemoryWarning 后关闭 Canvas 动画循环 ---- */
  lowMemory: false,
  enterLowMemoryMode(): void {
    this.lowMemory = true
  },

  /** 生效主题：手动直取，auto 跟随系统 */
  get resolvedTheme(): ResolvedTheme {
    return this.themeMode === 'auto' ? this.systemTheme : this.themeMode
  },

  /** 页面根节点主题类（唯一挂载点）；同时挂载动效 / 光效全局降级类 */
  get themeClass(): string {
    const theme = this.resolvedTheme === 'dark' ? 'theme-dark' : 'theme-light'
    const motion =
      preferenceStore.motion === 'saver'
        ? 'motion-saver'
        : preferenceStore.motion === 'lite'
          ? 'motion-lite'
          : 'motion-full'
    /* 省电模式强制关闭极光，与「动态光效」开关是 OR 关系 */
    const lightOff = !preferenceStore.lightEffects || preferenceStore.motion === 'saver'
    return `${theme} ${motion}${lightOff ? ' light-off' : ''}`
  },

  /** 当前模式标签（toast 呈现） */
  get themeModeLabel(): string {
    return THEME_MODE_LABELS[this.themeMode]
  },

  /** 当前实际生效的外观（用于「自动」状态的解释文案） */
  get resolvedThemeLabel(): string {
    return this.resolvedTheme === 'dark' ? '夜航' : '白昼'
  },

  /** 只在昼↔夜真正翻转时开启呼吸窗口，同侧切换不闪 */
  markThemeSwitching(): void {
    if (this.themeSwitchTimer) {
      clearTimeout(this.themeSwitchTimer)
    }
    this.themeSwitching = true
    this.themeSwitchTimer = setTimeout(() => {
      this.themeSwitching = false
      this.themeSwitchTimer = 0
    }, TIMING.THEME_TRANSITION) as unknown as number
  },

  /** 启动调用一次：恢复偏好 + 订阅系统外观 */
  initTheme(): void {
    if (this.themeInited) {
      return
    }
    this.themeInited = true
    this.systemTheme = readSystemTheme()
    try {
      const saved = wx.getStorageSync(STORAGE_KEYS.themeMode) as ThemeMode | ''
      if (saved === 'auto' || saved === 'light' || saved === 'dark') {
        this.themeMode = saved
      }
    } catch {
      // 存储不可用时保持 auto
    }
    syncStatusBar(this.resolvedTheme)
    if (typeof wx.onThemeChange === 'function') {
      wx.onThemeChange((result) => {
        const before = this.resolvedTheme
        this.systemTheme = result.theme === 'light' ? 'light' : 'dark'
        if (this.resolvedTheme !== before) {
          this.markThemeSwitching()
        }
        syncStatusBar(this.resolvedTheme)
      })
    }
  },

  /** 直接指定外观模式（我的 → 主题三段选择） */
  setThemeMode(mode: ThemeMode): void {
    if (mode !== 'auto' && mode !== 'light' && mode !== 'dark') {
      return
    }
    const before = this.resolvedTheme
    this.themeMode = mode
    try {
      wx.setStorageSync(STORAGE_KEYS.themeMode, mode)
    } catch {
      // 存储不可用时仅会话内生效
    }
    if (this.resolvedTheme !== before) {
      this.markThemeSwitching()
    }
    syncStatusBar(this.resolvedTheme)
    this.showToast(THEME_MODE_LABELS[mode])
  },

  /** 页面显示时补同步：setNavigationBarColor 只作用于当前页 */
  syncNativeChrome(): void {
    syncStatusBar(this.resolvedTheme)
  },

  /** 循环切换：跟随系统 → 晨瓷 → 黑曜石（持久化） */
  cycleTheme(): void {
    const current = THEME_MODES.indexOf(this.themeMode)
    const next = THEME_MODES[(current + 1) % THEME_MODES.length]
    this.setThemeMode(next)
  },

  showToast(message: string): void {
    if (this.toastTimer) {
      clearTimeout(this.toastTimer)
    }
    this.toastMessage = message
    this.toastShow = true
    this.toastTimer = setTimeout(() => {
      this.toastShow = false
      this.toastTimer = 0
    }, TIMING.TOAST_DURATION) as unknown as number
  },

  hideToast(): void {
    if (this.toastTimer) {
      clearTimeout(this.toastTimer)
      this.toastTimer = 0
    }
    this.toastShow = false
  },
})
