/* ==========================================================================
   应用入口 · 超欢 / 曜石画廊
   启动编排：主题引擎恢复 → 工具箱状态装载 → 领域数据装载 → 版本更新守护
   ========================================================================== */
import { uiStore } from './core/stores/ui'
import { resumeStore } from './core/stores/resume'
import { logger } from './core/utils/logger'
import { toolboxStore } from './core/toolbox/store'
import { historyStore } from './core/stores/history'
import { ROUTES } from './core/constants/index'
import { recordDiagnostic } from './core/utils/blackbox'
import { runStorageMigrations } from './core/utils/storage-migration'
import { TOOLS } from './core/toolbox/registry'
import { setAmbientToolCategoryResolver } from './core/theme/ambient-theme'
import { installPrivacyGuard } from './core/stores/privacy'
import { deepLinkStore } from './core/stores/deeplink'
import { preferenceStore } from './core/stores/preference'
import { warmUpSound } from './core/services/sound'
import {
  suspendMeetingTimer,
  syncMeetingTimer,
} from './core/services/meetingTimer'
import { applyAutoClean } from './core/services/storage-governor'
import { cleanupStaleExports } from './core/services/export'
import {
  clearUpdatePending,
  notifyUpdateGuards,
  type AppUpdateGlobalData,
} from './core/services/update'

/** 焦点页被系统杀死 / 崩溃后的唯一亮度兜底：onLaunch 读取 stale owned 标记 */
export function restoreStaleFocusBrightness(): void {
  const STALE_KEY = 'focus:brightness:v1'
  try {
    const raw = wx.getStorageSync(STALE_KEY)
    let record: Record<string, unknown> | null = null
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      record = raw as Record<string, unknown>
    } else if (typeof raw === 'string' && raw.trim()) {
      try {
        const parsed = JSON.parse(raw) as unknown
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          record = parsed as Record<string, unknown>
        }
      } catch {
        return
      }
    }
    if (!record || record.version !== 1 || record.owned !== true) {
      return
    }
    const original = record.original
    if (
      typeof original !== 'number' ||
      !Number.isFinite(original) ||
      original < 0 ||
      original > 1
    ) {
      wx.removeStorageSync(STALE_KEY)
      return
    }
    if (typeof wx.setScreenBrightness !== 'function') {
      wx.removeStorageSync(STALE_KEY)
      return
    }
    wx.setScreenBrightness({
      value: original,
      /* 只有真正恢复成功才删标记；失败留到下一次 onLaunch 继续兜底 */
      success: () => {
        try {
          wx.removeStorageSync(STALE_KEY)
        } catch {
          /* 已删除 */
        }
      },
    })
  } catch {
    /* 解析 / 存储异常不得影响启动 */
  }
}

/** globalData 单例：更新管理器与跨页面监听器只在 App 内维护 */
const UPDATE_GLOBAL_DATA: AppUpdateGlobalData = {
  updateManager: null,
  hasUpdate: false,
  updateReadyListeners: [],
  promptState: 'idle',
  promptOwner: '',
  blockers: 0,
}

App({
  globalData: UPDATE_GLOBAL_DATA,

  onLaunch() {
    // 0) 全息专注亮度兜底：必须先于任何页面恢复，避免启动瞬间黑屏
    restoreStaleFocusBrightness()

    // 0) 全局偏好：必须先于主题 / 动效 / 音效读取，异常时自动回退默认值
    preferenceStore.init()
    warmUpSound()

    // 0.1) 隐私授权监听：必须早于任何敏感 API 调用
    installPrivacyGuard()

    // 0.2) 本地数据版本迁移：先于任何 Store 读取，旧结构不会被新代码误判
    runStorageMigrations()

    // 0.3) 环境光分类解析器：工具 id → calc / media / text 等
    setAmbientToolCategoryResolver((toolId) => {
      const tool = TOOLS.find((item) => item.id === toolId)
      return tool ? tool.category : 'home'
    })

    // 1) 主题引擎：恢复偏好 + 订阅系统外观（首帧前完成，杜绝闪烁）
    uiStore.initTheme()

    // 2) 工具箱：收藏 / 最近使用只读工具 id
    toolboxStore.init()
    /* 本机计算轨迹：与工具箱同域，先装载再允许任何工具写入 */
    historyStore.init()
    /* 启动即按偏好裁剪过期最近使用；threshold=0 时内部直接返回 */
    applyAutoClean()
    /* 导出目录：删除超过 24 小时或总量超过 10MB 的旧文件 */
    cleanupStaleExports()

    // 3) 领域数据：本地域瞬回；云图片由各页面按需加载
    resumeStore
      .bootstrap()
      .then(() => {
        logger.info('app', '领域数据装载完成')
      })
      .catch((error) => {
        logger.error('app', '领域数据装载失败', error)
      })

    // 4) 版本守护：只静默下载并暂存，弹窗由首页优先接管
    this.installUpdateGuard()
  },

  /**
   * 版本更新第一阶段：底层拦截与暂存。
   * 不在这里弹任何窗，避免启动瞬间压住首屏；首页 onShow 或监听器再接棒。
   */
  installUpdateGuard(): void {
    const hub = this.globalData as unknown as AppUpdateGlobalData
    if (!wx.canIUse('getUpdateManager')) {
      logger.warn('app', '当前基础库不支持更新管理器')
      return
    }
    try {
      const manager = wx.getUpdateManager()
      hub.updateManager = manager

      manager.onCheckForUpdate((result) => {
        /* 已是最新版：清掉上一次“稍后”留下的红点，防止跨版本残留 */
        if (!result.hasUpdate) {
          clearUpdatePending()
        }
      })

      manager.onUpdateReady(() => {
        hub.hasUpdate = true
        /* 上一版已“稍后”时，新包就绪要重新获得一次全局展示机会 */
        if (hub.promptState === 'dismissed') {
          hub.promptState = 'idle'
          hub.promptOwner = ''
        }
        logger.info('app', '新版本已就绪，等待任意页面 update-guard 承接')
        notifyUpdateGuards(hub)
      })

      manager.onUpdateFailed(() => {
        hub.hasUpdate = false
        logger.warn('app', '新版本下载失败，等待下次启动由微信自动重试')
        /* 失败不能静默：原生 Toast 不受页面组件挂载影响，任何页面都能看到 */
        try {
          wx.showToast({
            title: '网络波动，极光新版本下载失败',
            icon: 'none',
            duration: 2600,
          })
        } catch (error) {
          logger.warn('app', '更新失败提示无法展示', error)
        }
      })
    } catch (error) {
      logger.error('app', '更新管理器初始化失败', error)
    }
  },

  /** 此处是处理热启动分享 query 先于页面 onShow 到达的边界 */
  onShow(options: WechatMiniprogram.App.LaunchShowOption) {
    try {
      const toolId = options && options.query ? options.query.tool : ''
      if (typeof toolId === 'string' && toolId) {
        deepLinkStore.setPending(toolId)
      }
    } catch {
      /* 启动参数异常时不影响正常前台恢复 */
    }

    /* 热启动补一次自动清理：跨天 / 跨周后回来也能守住阈值 */
    applyAutoClean()
    /* 会议倒计时跨后台补算：回前台立即对齐截止时间 */
    syncMeetingTimer()
  },

  /** 切后台：把防抖中的轨迹立即落盘，避免小程序被系统回收时丢记录 */
  onHide() {
    historyStore.flush()
    /* 后台不跑计时器，但保留截止时间；回前台再补算 */
    suspendMeetingTimer()
  },

  /** 致命错误黑匣子：记录现场后由微信决定是否继续 */
  onError(error: string) {
    recordDiagnostic('app-error', error)
  },

  /** 未处理的 Promise 拒绝：记录原因与当前路由，不向用户抛堆栈 */
  onUnhandledRejection(res: WechatMiniprogram.OnUnhandledRejectionListenerResult) {
    recordDiagnostic('unhandled-rejection', res.reason)
  },

  /** 旧书签 / 旧分享路径兜底：不白屏，统一回到工具箱首页 */
  onPageNotFound(res: WechatMiniprogram.App.PageNotFoundOption) {
    recordDiagnostic('page-not-found', res.path, 'warn')
    wx.switchTab({
      url: ROUTES.home,
      fail: () => {
        wx.reLaunch({ url: ROUTES.home })
      },
    })
  },

  /** 低端机内存告警：记录现场并关闭 Canvas 动画循环，不弹窗打断当前工具 */
  onMemoryWarning(res: WechatMiniprogram.OnMemoryWarningListenerResult) {
    uiStore.enterLowMemoryMode()
    recordDiagnostic('memory-warning', `level=${res.level}`, 'warn')
  },
})

