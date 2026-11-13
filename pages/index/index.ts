/* ==========================================================================
   工具首页 · Spatial Glass 26
   - 搜索使用单层玻璃药丸 + 原生 input，实时 filter 全量工具
   - 收藏 / 历史通过 storeBindingsBehavior 实时绑定 glassStore
   - 54 个工具路由完全来自 registry，跳转 url 不做任何改写
   ========================================================================== */
import { storeBindingsBehavior } from 'mobx-miniprogram-bindings'
import { glassStore } from '../../store/index'
import { uiStore } from '../../core/stores/ui'
import {
  HOME_SECTIONS,
  TOOLS,
  TOOL_IDS,
  searchTools,
  toolsForCategories,
} from '../../core/toolbox/registry'
import { toolboxStore } from '../../core/toolbox/store'
import { deepLinkStore } from '../../core/stores/deeplink'
import {
  parseToolDeepLink,
  sharePayloadForTool,
  timelinePayloadForTool,
} from '../../core/toolbox/share'
import {
  clearSearchHistory,
  pushSearchHistory,
  readSearchHistory,
  removeSearchHistory,
} from '../../core/toolbox/searchHistory'
import {
  closeCommandPalette,
  openCommandPalette,
} from '../../components/command-palette/palette'
import type { ToolMeta } from '../../core/toolbox/types'
import { ROUTES } from '../../core/constants/index'
import { ambientTheme } from '../../core/theme/ambient-theme'
import { selectTabBar } from '../../core/toolbox/tabbar'
import { showGlassToast } from '../../components/glass-toast/toast'
import { TBX_KEYS, readStorage, writeStorage } from '../../core/toolbox/storage'
import { tapTick, tapWarn } from '../../core/utils/haptics'
import { logger } from '../../core/utils/logger'
import { networkStore } from '../../core/stores/network'
import { fontScaleClass, syncFontScaleClass } from '../../core/services/font-scale'
import {
  isYuanbaoConfigured,
  searchYuanbao,
  type YuanbaoResult,
} from '../../core/services/yuanbao/index'
import { copyText } from '../../core/services/feedback'

interface HomeToolView extends ToolMeta {
  favorite: boolean
}

interface HomeWebResultView {
  index: number
  title: string
  meta: string
  passage: string
  url: string
}

function toWebResultView(result: YuanbaoResult, index: number): HomeWebResultView {
  const meta = [result.site, result.date].filter((item) => Boolean(item)).join(' · ')
  const passage = result.passage || result.content
  return {
    index,
    title: result.title || '未命名结果',
    meta,
    passage: passage.length > 120 ? `${passage.slice(0, 120).trim()}…` : passage,
    url: result.url,
  }
}

interface HomeSectionView {
  key: string
  title: string
  hint: string
  tools: HomeToolView[]
}

interface HomeUsageDigit {
  /** 按个位向右对齐的稳定键，保证进位时同一位的滚轮元素不被重建 */
  key: string
  digit: number
}

function buildUsageDigits(value: number, length = 0): HomeUsageDigit[] {
  let text = String(Math.max(0, Math.floor(value)))
  /* 首屏入场需要与终值等宽的「全 0」轮盘，才能滚出真实数字 */
  while (text.length < length) {
    text = `0${text}`
  }
  return text.split('').map((char, index) => ({
    key: String(text.length - index),
    digit: Number(char),
  }))
}

/**
 * 魔法棒图标：重新绘制的「斜向水晶棒 + 主星芒 + 星点」SVG，
 * 通过 rsvg-convert 栅格化为 96x96 透明 PNG，保证 Skyline 稳定渲染。
 * 30px 容器内显示，3 倍像素密度保持发光描边锐利。
 */
const MAGIC_WAND_SVG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAAABmJLR0QA/wD/AP+gvaeTAAAOaklEQVR4nO1de3Ad1Xn/fWfv6mVJlt8TY/ADJAsbHKCm0DBtQzNNjZNg1YCbwISZZDqdhAaoM6VN0zZD25A0mTZTbJJwE5h0mjGmFwp1S3YmU894MngghIXYDkpjy7ZkcG0kS5alq4elu3t+/WPvY+9L2qv7kK5zfzOau4+z5zv7+875vu+8VkANNdRQQw011FBDDTXUUEMNSfT2suFQLxvKKSNUzsyrHZfa0NlKaADHyiVDlSvjKwGa2KxdbCqnjJoCZoLWtxP6tnKKmBcTZJ871wQAW1evnpgP+UHhAh/WgFNOGfPSApY1rXpwWdOqT8+H7KD46RDXkNhMYMvhC1xdLjkVV4BNmqLUw6Lkz7q7WVdp+UEhWu/SgGhCaep7yiWn4gpYPo5dIK8BsaZhjXtfpeUHhQt+ShMgAZL3l0tORRVAUujy0cS5AfVFkgsuEPjpEG8HZSsBaACk3H7wPG8th6yKvnxvFJ8Q4HrfpY53o/hYJcsQBNrRj2gAmt4fASjRj8723Fwg5cg0EyRVbxQfV5pPQLAu/Sb6tJK/Xt+CV0REV6I8M+G193mjVvoICaXptYC4IlxX1Ae3fUC6SymvrC3AJs2+Eef+M6N8Q5H7ssgHAME6Re7rG+GRvhH3oZ4e1pezTLOBiv9IQmn4yAdAwAhpfr3U8srSAnp6WG+udO+hqL8UYkNhJZL3QP3U4Hj/v1a6n/DagHOfS4kkiKevBQgARQDCnR9ZHXq5VDIXnAOcLxw6x+UuZY/ndLPJl/ivoeWpg2e5rFRyy+oDbNJcPureB6jdADpnSkuiV4RPxwbUs+3tMlXOcmXLpjo8wB8R3JZwvJnkK6SUoLQcfP9q2bZLxC1Wds0JAzj8vvs1LfgrP/Gkd0985ietJRBfveMa42+LlV0yBRw8z1td6A9D8yK18fK2q+ViZprTo7xbkfvSCiBy/9pW+e9SlaNQHO53P6eB7yadbbwFACmys1pA/BfEo3esNfYUI78kCvifc+5uDfydJMuFfobUtm0r5aQ/HUnpG+Ubvr7AibWtcuu81XyP/G9rev5VByA/ee4dawE+f/ta43tzLUPRTtg6O7GGwFfEp0wBVqmY+0RmWhGhGPJk4tyF/tZ8kE9SXh1w/4bAd5hBvhfopJub5C/SyIcAShFPv9nnfpnknCpz0QqoU403INewtshNudIPLkIEIu9CcPbyWeOFYuUXisMX2PLaBUZA/IMGJCPWTyM7jXDkVYwI8cTbffr57m42F1qeohXgAn2577A319WtIjFqvZea/7J5s0wXK78QvN7PO4Ta1uS9fmdLeL85aviMvxmmaVesUR87cjJ2ZyFlKloBf7BafkVgf8blmMD4ar5nhib6/21oov+HxcoOisMXuPr1C+4zWvSrmuiYLdbP95sZCeUwUeuVqIPHTrrf+2UfPxCkbCVxwo+T6kPn3c+C+D0AF0H9zEfX1B0pRd7F4GdDvJpaP6yBhzSxKGHjg8T6gc/z3ROMK+LbBtXe9nY5m6+MFekHVBKHetnQ2oLtGnxAk5/QgJk5rBA01lf5yJ8lbepcIERMgP9SlH1UsDI7mVWvgKNRrhQXW6BxiwbvdInf1uSiXOM5c4n1k+czpM39rGTnBYwJ8apADomLt+vr8YuqXxfkAjQATcJxCUfHuc208QnzE4T8zEhoFueb41nJlweVwBUNVxkgibnFrgsZ3WTd6ID7cT0ge7gCV1HSzU5ygiWfCZnpXtDz9No/DfAl0eq5SY0fZ0Z+Vd8CsvACMD3EBwW8ShoBbhDoDQJtFBXrzx4ZIYv8MZBPGa7as26TOp+vuFdUC4hEWLdiyIkIsUMASKJ73gA41wucq70LhdToGc1N1rMCRbgK/L4Kqcc3bJD+2cp8xSgg8jjrlq5wIgrYkSA+TQkAuFQQuwmQZslL6uzmJZ9CBIo4LSKfbW+XnwQtt1FCDuYNkcdZt3S5EwGwI8m2v2olFDIJhN4F0ChAazCH6jdPM5Ev5POXJ9VdmzZJTyFlr/oWYIdpDk87EQi6ktwnCM/TEkQAXCfQHZK/M4XAsT5B+VJnh3xzLuWv6ilJO0xzcMqJaLArMaYDpI/vEOnHifs4SUti+FMB9GxhZ37nK65o+ZO5kg9UcRRkh2kOTDkRAbuSoQ0laW5IxA/gcwLJYys6Hdq5/VqZeu2M6wrw9FxifUXZ3bFRninmPaqyBdhhmv1TToRkV3oNZ1ZNz2oJGtZYLLRz+yPekMCH1hphRTwx60BbVieNf9/RIXuLfZeq8wHhMM3Vk05EhNk2P3ksWTY/7kStCTdFfgIklX2Grwh514yRUeKeyI86rpW7SzGZVFUtIBymuWrCiTCfzceMLSEn+QAgIlqH5NMCnM/ljNP9gvyfMyUPlmomr2oUEA7TXDnhROAjP6gSCFhTechP4LY1MiSaD8/sjAWi5QubN2cvOJgrqsIEhcM0l4/FzU6O0DKXufGZI8vhzOT7cey0fgXkx3LG+hoHNm5UXaV8twXfAsJhmsvGvJoP5A4t87UEgAWRDwDU8iUB3Byjm65S8uWSvhwWuALCYZpLonGbj9QESiAlCC2XdQWRDwAfvE7eESLii/UhnoD97e3yy5K9XBwLVgHhMM3F0XSHG1QJBC3MgfwEDKh/zhzXD0EVtQArHxakApLkZ8X5QZRAS8ncyQeA66+Tt4R80+eMX792o7xZ5GvlxIJTQDhMs23CiUCxC5KHZORWAkDLUMWRn4CI8Vyi9oOyb7b0c8WCUkA4THPJtBMRFY924iNlgZQgtEIlIh8AROMFASiENl28VIo8c8opV8aFIhymudx1ItRxm6/jf/FjMPfopgBQQqs+VDryEzh5XB9TgLNho7qllPn6sSAG48JhmivhRKi8UBMaqbYZP04oI3tgrTzkx4X8hLwCd8r7EQ7TXBVyIqLQJSIQ5ZmehAnyH2eZI02rySwX+YBo9boS9UaQtNG3Y7/LOexvm1cF2GGaq+udiFLoSpEdUAmk1VxfPvIBQBS6QxqBdkUayvjK+Lhb8IbueVOAHabZ35yo+T6iAyhBQKu1zOQDgNThuNOAWacYJ4/yIwS2CNQXeIgFmfX5+VpKmObgYiciLroybX0SWuLbEjPukVZL2Wx+Otavl8tB0mkmd/9fM7kUOwD8R1AZlf9YR5jm4BInQombnVw1PE9LgKLVUsJQsxQYf2v6NwD8VuJcaz5SyGaNiirADtMcXp4yO5jJzGQqQWg1FzG8UA5MHuGdVKFv+a+JYNPkMXxj/O1gn7ipWD/AtmleOutECHQlY/xEaJkR8+c4tuovFzaqWS6QVONH8fsCfhFA3v6BADGIvOwQT7beJCdmSFd+2DbNkX43Ao0uaqaTO4sS4MIKTSwM8ieO8DcJ7gUK2v2vAf5nk6N2y1bJ2vlfdgXYNs2xQTdCjWQPt2kRsGylYHSYGOpnfiUQljGyMMhPYOIobwP0I6R8NEDycZDPgeqpRbfIuVwJyqoA26Y5cSlOfpzctqWCzhuVF9MDeMd2cypBa1hqeGGR78fUUd7gAp8neA+YvsKQwEWQzzqG+n7bFhmeKZ+yKcC2aU5F3Yj21fzFbYKNNyioOPkk8O4pjb4TOt3sEBZbQzu3b1+Y5Psx/nPnjyHK/xWVsZiSW2YjPoGyREG2TXN6wo1ApULNJcsEG29MkQ94hA8NMC3qUVI95ANAU7PxQwC+VdDyg6DkA2VQgG3TdKbdtB5u21JB+yYF5WtvWgPH39GYGPeFngYst7l6yAcAaZcpkonVcdM0UdCu+ZIqwLZpuq4bgXg9XFGe2WnvjNf8uAJI4ES3xvBQovYLoGA59dVFfgKTjepZEYwIuL95s7xfyLMlU4Bt06TQq/lxs9PaJrhuY8rhAh75Pf+rcWmYqY6XwIqFqpN8AFjRKVFq/kAp9Z1Cny2JE7ZtmhKibzKFaGkWrF+fMjuJGayTv/Jqvj/UnHCNqiU/AdumuXWrxAp9rmgF2DZNo57eBHo8kmluFqy7RlIOl97muFM9Gpcu0t8Js8Zi1U9+MShqh4xt0ww101siDgACtGSSD6/mnz6lMXopPrrpzSVa0alfb/KBIhRg2zTrFzMi9FYvAIBpAhvWKm/kMg4SON2rMTriLTGIz+NaI+M18oE5OmHbptm4hN5aTd8IZmOjJGetAI/83jNEdCzlcGHAGh6rkZ9AwS3Atmk2L2cEkqr5CbgusLjFMz8kcOY9IhqNL2fwYF28WCPfj4KcsE2azWfpLRHPNXqpASVAY4NgcpKYnvbdg1htLbKz0l9EXOgI3AJIqvEBPg9gJ4A0O48Mmz8d83q6iXsUOdBUJ/d2dlb2A03VgMBzwieH8DkB7vW8hoCaqQ5W1nyu75xyoFFkV6W/jlUu7P/69M001VoaxrEHdsvpYvMLbIJODenj1OhINzveIp185ohaDoRYGvJJysWXcJUOYWTFDokWm1/B8kF57puxvSLcGb/kkvzaA3/R8N1i8g2kgJ4hthqKI5mzWDMrQawGKY3Nfy/CxhbRewDcDNAB8U9tu0IvFptvIdj/jct3U8nTGZfdEOp+Z9dj0jvXfAOFoa4GsyfLkRpIy5xUN0pHPgC0irsTwM3emYQg+PMLB9hSiryDgoaR6yuQhoa7pZh8Aymgc4VEReFEECVAyQFMyB+WMtrRkKXpVyTUBFRWAZp9ua5ruHOu/UAhHTGRJ3MvG/EpAXKAY6V3uI4b+zGEqYEu4VtNdyPvN3jKgSUN5r+D8k7aRcqL9z9WX9R/2QvshEmqM6N6H0Q+mdPhAi/GBuWBckU7Iy9ebtcw76Lm4JJx4yX5TLBVa6WEtYf1w5djfyRK1oHuzz/1WP0r8R1klQFJ1RflQ32j+njvJc3Tw5qnhvTxnkE+tBD/Gc8VjYEBNncPFP6p3hpqqKGGGmqooYYaaqihhhpqmFf8P4phl85hyaHFAAAAAElFTkSuQmCC'


interface HomeRuntime {
  navigating: boolean
  unsubscribeAmbient: (() => void) | null
  cleaned: boolean
  inited: boolean
  deepLinkTimer: number
  pendingProbeTimer: number
  usageBounceTimer: number
  usagePrimed: boolean
  lastEnterTool: string
  lastEnterAt: number
  webTimer: number
  webTask?: WechatMiniprogram.RequestTask
  webSeq: number
}

function buildSections(favorites: string[]): HomeSectionView[] {
  return HOME_SECTIONS.map((section) => ({
    key: section.key,
    title: section.title,
    hint: section.hint,
    tools: toolsForCategories(section.categories).map((tool) => ({
      ...tool,
      favorite: favorites.includes(tool.id),
    })),
  }))
}

function buildResults(keyword: string, favorites: string[]): HomeToolView[] {
  /* 搜索排序与别名统一由 registry.searchTools 负责，首页不再自写过滤 */
  return searchTools(keyword).map((tool) => ({
    ...tool,
    favorite: favorites.includes(tool.id),
  }))
}

/* 搜索历史的失焦延迟计时器：页面单例，切换 tab 不重入 */
let searchBlurTimer = 0

/* 空结果推荐：权重最高的 3 个工具，避免用户走进死路 */
const RECOMMENDED_TOOLS = [...TOOLS]
  .sort((left, right) => right.weight - left.weight)
  .slice(0, 3)
  .map((tool) => ({ id: tool.id, name: tool.name, route: tool.route }))

Component({
  options: {
    styleIsolation: 'apply-shared',
  },

  behaviors: [storeBindingsBehavior],

  /* mobx-miniprogram-bindings 运行时读取 storeBindings；
     官方 d.ts 尚未扩展 Component.Options，因此此处用 ts-expect-error 标注类型缺口 */
  // @ts-expect-error storeBindings 由 storeBindingsBehavior 注入
  storeBindings: {
    store: glassStore,
    fields: {
      themeClass: () => glassStore.themeClass,
      themeSwitching: () => glassStore.themeSwitching,
      isDark: () => glassStore.resolvedTheme === 'dark',
      favoriteCount: () => glassStore.favoriteCount,
      sections: () => buildSections(glassStore.toolFavorites),
      recents: () => toolboxStore.recentTools().slice(0, 6),
      offline: () => networkStore.offline,
    },
    actions: {},
  },

  data: {
    themeClass: glassStore.themeClass,
    themeSwitching: false,
    isDark: glassStore.resolvedTheme === 'dark',
    fsClass: fontScaleClass(),
    favoriteCount: 0,
    toolTotal: TOOLS.length,
    offline: networkStore.offline,
    usageCount: 0,
    usageDigits: buildUsageDigits(0),
    usageRolling: false,
    rollDigits: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    statTones: [
      'home-hero-stat_tone_iris',
      'home-hero-stat_tone_mint',
      'home-hero-stat_tone_amber',
    ],
    sections: buildSections([]) as HomeSectionView[],
    recents: [] as ToolMeta[],
    /* 原有搜索逻辑未变，此处为新增的魔法棒代码 */
    showPalette: false,
    magicWandSvg: MAGIC_WAND_SVG,
    ambientClass: 'sg-ambient-iris',
    ambientStyle: '',
    keyword: '',
    searchFocused: false,
    searchHistory: [] as string[],
    recommendedTools: RECOMMENDED_TOOLS,
    /* 使用指南横幅：关闭后永久隐藏，状态存本机 */
    showHelpBanner: false,
    results: [] as HomeToolView[],
    /* 全网搜索：与本地工具结果并列展示，只在配置了服务 API KEY 时启用 */
    webReady: isYuanbaoConfigured(),
    webLoading: false,
    webError: '',
    webQuery: '',
    webResults: [] as HomeWebResultView[],
    /* 深链自动跳转期间挂起全局更新弹窗，避免弹窗与跳转互相打断 */
    updateNavHold: true,
  },

  lifetimes: {
    attached() {
      this.ensurePageInit()
    },

    detached() {
      this.cleanupPage()
    },
  },

  methods: {
    onLoad(query: Record<string, string | undefined>) {
      this.ensurePageInit()
      /* 此处是处理冷启动 App.onShow 已先写入待消费深链的边界 */
      const pending = deepLinkStore.takePending()
      if (pending) {
        this.scheduleDeepLink(pending)
      }
      const toolId = typeof query?.tool === 'string' ? query.tool : ''
      if (toolId) {
        this.scheduleDeepLink(toolId)
      }
      /* 此处是处理首次加载时页面 query 缺失、仅启动参数携带深链的补漏；
         只在 onLoad 消费一次，绝不能放到 onShow（否则返回首页会二次跳转） */
      this.handleEnterOptions()
    },

    ensurePageInit() {
      const runtime = this as unknown as HomeRuntime
      if (!runtime || runtime.inited) {
        return
      }
      runtime.navigating = false
      runtime.unsubscribeAmbient = null
      runtime.cleaned = false
      runtime.inited = true
      runtime.deepLinkTimer = 0
      runtime.pendingProbeTimer = 0
      runtime.usageBounceTimer = 0
      runtime.usagePrimed = false
      runtime.lastEnterTool = ''
      runtime.lastEnterAt = 0
      runtime.webTimer = 0
      runtime.webTask = undefined
      runtime.webSeq = 0

      glassStore.init()

      /* 每次进入首页随机分配三块数据面板的极光色调，数据本身保持真实 */
      const toneClasses = [
        'home-hero-stat_tone_iris',
        'home-hero-stat_tone_mint',
        'home-hero-stat_tone_amber',
      ]
      for (let index = toneClasses.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1))
        const temp = toneClasses[index]
        toneClasses[index] = toneClasses[swapIndex]
        toneClasses[swapIndex] = temp
      }
      this.setData({
        statTones: toneClasses,
        showHelpBanner: !readStorage(TBX_KEYS.helpBannerDismissed),
      })

      ambientTheme.setCategory('home')
      runtime.unsubscribeAmbient = ambientTheme.subscribe((state) => {
        this.setData({
          ambientClass: state.className,
          ambientStyle: state.style,
        })
      })
    },

    onShow() {
      const runtime = this as unknown as HomeRuntime
      runtime.navigating = false
      this.setData({ fsClass: syncFontScaleClass() })
      /* 先进先出：任何深链跳转落定前，update-guard 都要保持排队 */
      this.setData({ updateNavHold: true })
      selectTabBar(this, 0)
      uiStore.syncNativeChrome()
      ambientTheme.refresh()
      this.refreshRecents()
      /* 此处是处理热启动分享 query 的边界：App.onShow 已暂存，优先消费 */
      const pending = deepLinkStore.takePending()
      if (pending) {
        this.scheduleDeepLink(pending)
      }
      /* 深链只在页面首次加载时消费一次：
         getEnterOptionsSync 会持续返回本次启动参数，返回首页时仍是 ?tool=xxx；
         若在每次 onShow 读取，返回约 300ms 后会再次跳回工具页。
         onLoad 的 query、App.onShow 的 pending 与下方 60ms 兜底已覆盖全部进入路径。 */
      /* 此处是处理 App.onShow 晚于页面 onShow 的边界 */
      if (runtime.pendingProbeTimer) {
        clearTimeout(runtime.pendingProbeTimer)
      }
      runtime.pendingProbeTimer = setTimeout(() => {
        runtime.pendingProbeTimer = 0
        if (runtime.cleaned) {
          return
        }
        const latePending = deepLinkStore.takePending()
        if (latePending) {
          this.scheduleDeepLink(latePending)
          return
        }
        /* 深链窗口结清后再放行 update-guard */
        this.releaseUpdateNavHold()
      }, 60) as unknown as number
    },

    onUnload() {
      this.cleanupPage()
    },

    cleanupPage() {
      const runtime = this as unknown as HomeRuntime
      if (!runtime || runtime.cleaned) {
        return
      }
      runtime.cleaned = true
      if (runtime.deepLinkTimer) {
        clearTimeout(runtime.deepLinkTimer)
        runtime.deepLinkTimer = 0
      }
      if (runtime.pendingProbeTimer) {
        clearTimeout(runtime.pendingProbeTimer)
        runtime.pendingProbeTimer = 0
      }
      if (runtime.usageBounceTimer) {
        clearTimeout(runtime.usageBounceTimer)
        runtime.usageBounceTimer = 0
      }
      if (runtime.unsubscribeAmbient) {
        runtime.unsubscribeAmbient()
        runtime.unsubscribeAmbient = null
      }
      this.cancelWebSearch()
    },

    /**
     * 深链窗口已结清且没有在途跳转时，放行 update-guard。
     * 若有跳转，保持挂起；跳转失败时会在失败回调里补放行。
     */
    releaseUpdateNavHold(): void {
      const runtime = this as unknown as HomeRuntime
      if (runtime.cleaned || runtime.navigating || runtime.deepLinkTimer) {
        return
      }
      if (this.data.updateNavHold) {
        this.setData({ updateNavHold: false })
      }
    },

    /* 此处是处理最近使用在 onShow 动态刷新的边界 */
    refreshRecents(): void {
      const allRecents = toolboxStore.recentTools()
      const list = allRecents.slice(0, 6)
      const usageCount = toolboxStore.usageCount
      const usageChanged = usageCount !== this.data.usageCount
      const runtime = this as unknown as HomeRuntime
      /* 冷启动首帧先摆全 0 轮盘，否则 setData 早于首帧渲染，数字会直接跳到终值 */
      const firstSync = usageChanged && !runtime.usagePrimed
      if (firstSync) {
        runtime.usagePrimed = true
      }
      this.setData({
        recents: list,
        /* 回到首页时才更新，让滚轮与回弹在用户眼前发生，而不是在后台播完 */
        ...(usageChanged
          ? {
              usageCount,
              usageDigits: firstSync
                ? buildUsageDigits(0, buildUsageDigits(usageCount).length)
                : buildUsageDigits(usageCount),
              usageRolling: !firstSync,
            }
          : {}),
      })
      if (usageChanged) {
        if (runtime.usageBounceTimer) {
          clearTimeout(runtime.usageBounceTimer)
          runtime.usageBounceTimer = 0
        }
        if (firstSync) {
          /* 等首帧「全 0」画出来后再滚到真实值，冷启动也能看见数位滚动 */
          runtime.usageBounceTimer = setTimeout(() => {
            runtime.usageBounceTimer = 0
            this.setData({
              usageDigits: buildUsageDigits(usageCount),
              usageRolling: true,
            })
            runtime.usageBounceTimer = setTimeout(() => {
              runtime.usageBounceTimer = 0
              this.setData({ usageRolling: false })
            }, 700) as unknown as number
          }, 220) as unknown as number
          return
        }
        runtime.usageBounceTimer = setTimeout(() => {
          runtime.usageBounceTimer = 0
          this.setData({ usageRolling: false })
        }, 700) as unknown as number
      }
    },

    /* 此处是处理首次加载启动参数解析的边界；只允许 onLoad 调用 */
    handleEnterOptions(): void {
      try {
        const options = wx.getEnterOptionsSync()
        const toolId = options && options.query ? options.query.tool : ''
        if (typeof toolId === 'string' && toolId) {
          this.scheduleDeepLink(toolId)
        }
      } catch (error) {
        logger.warn('home', '读取启动参数失败', error)
      }
    },

    /* 此处是处理深链参数防伪、300ms 安全跳转与重复消费的边界 */
    scheduleDeepLink(rawToolId: string): void {
      /* 此处是处理 query 编码、工具白名单与非法参数静默拦截的边界 */
      const tool = parseToolDeepLink(rawToolId)
      if (!tool) {
        /* 非法参数静默丢弃，不打扰用户 */
        logger.warn('home', '忽略非法工具深链', rawToolId)
        return
      }
      const toolId = tool.id
      const runtime = this as unknown as HomeRuntime
      /* 此处是处理同一工具在 1.2 秒内被重复消费的边界 */
      if (runtime.lastEnterTool === toolId && Date.now() - runtime.lastEnterAt < 1200) {
        return
      }
      runtime.lastEnterTool = toolId
      runtime.lastEnterAt = Date.now()
      if (runtime.deepLinkTimer) {
        clearTimeout(runtime.deepLinkTimer)
      }
      runtime.deepLinkTimer = setTimeout(() => {
        runtime.deepLinkTimer = 0
        if (runtime.cleaned || runtime.navigating) {
          return
        }
        runtime.navigating = true
        wx.navigateTo({
          url: tool.route,
          success: () => {
            glassStore.recordHistory(tool.id)
          },
          fail: (error) => {
            runtime.navigating = false
            logger.warn('home', `深链工具打开失败：${tool.route}`, error)
            showGlassToast({
              message: '工具加载失败，请稍后重试',
              type: 'error',
              placement: 'lower-center',
            })
            /* 自动跳转失败：解除挂起，让 update-guard 立刻接棒 */
            this.releaseUpdateNavHold()
          },
        })
      }, 300) as unknown as number
    },

    onSearchInput(event: WechatMiniprogram.Input) {
      const keyword = event.detail.value
      if (!keyword.trim()) {
        this.cancelWebSearch()
        this.setData({
          keyword: '',
          results: [],
          webResults: [],
          webLoading: false,
          webError: '',
          webQuery: '',
        })
        return
      }
      this.setData({
        keyword,
        results: buildResults(keyword, glassStore.toolFavorites),
        webError: '',
      })
      this.scheduleWebSearch(keyword)
    },

    /** 搜索框内一键清空：中断在途请求并回到初始搜索态 */
    onClearSearch() {
      tapTick()
      this.cancelWebSearch()
      this.setData({
        keyword: '',
        results: [],
        webResults: [],
        webLoading: false,
        webError: '',
        webQuery: '',
        searchHistory: readSearchHistory(),
      })
    },

    onSearchConfirm(event: WechatMiniprogram.Input) {
      const keyword = event.detail.value
      const history = pushSearchHistory(keyword)
      this.setData({
        keyword,
        searchHistory: history,
        results: buildResults(keyword, glassStore.toolFavorites),
      })
      this.scheduleWebSearch(keyword, true)
    },

    onSearchFocus() {
      if (searchBlurTimer) {
        clearTimeout(searchBlurTimer)
        searchBlurTimer = 0
      }
      this.setData({ searchFocused: true, searchHistory: readSearchHistory() })
    },

    onSearchBlur() {
      /* 延迟隐藏：让历史 chip 的点击优先于 blur 生效，避免节点先被移除 */
      if (searchBlurTimer) {
        clearTimeout(searchBlurTimer)
      }
      searchBlurTimer = setTimeout(() => {
        searchBlurTimer = 0
        this.setData({ searchFocused: false })
      }, 180)
    },

    /* 历史词点击：回填并立即搜索 */
    onSearchHistoryTap(event: WechatMiniprogram.TouchEvent) {
      const keyword = String(event.currentTarget.dataset.keyword || '')
      if (!keyword) {
        return
      }
      this.setData({
        keyword,
        results: buildResults(keyword, glassStore.toolFavorites),
      })
      this.scheduleWebSearch(keyword, true)
    },

    /* ---- 全网搜索：本地工具结果之外的元宝结果 ---- */
    scheduleWebSearch(keyword: string, immediate = false): void {
      const runtime = this as unknown as HomeRuntime
      const query = keyword.trim()
      if (!this.data.webReady || networkStore.offline || query.length < 2) {
        this.cancelWebSearch()
        if (this.data.webResults.length || this.data.webQuery) {
          this.setData({ webResults: [], webError: '', webQuery: '', webLoading: false })
        }
        return
      }
      if (runtime.webTimer) {
        clearTimeout(runtime.webTimer)
        runtime.webTimer = 0
      }
      runtime.webTimer = setTimeout(() => {
        runtime.webTimer = 0
        this.runWebSearch(query)
      }, immediate ? 0 : 520) as unknown as number
    },

    runWebSearch(query: string): void {
      const runtime = this as unknown as HomeRuntime
      if (runtime.cleaned || !query) {
        return
      }
      if (networkStore.offline) {
        this.cancelWebSearch()
        this.setData({
          webLoading: false,
          webError: '',
          webResults: [],
          webQuery: '',
        })
        return
      }
      runtime.webSeq += 1
      const seq = runtime.webSeq
      if (runtime.webTask) {
        runtime.webTask.abort()
        runtime.webTask = undefined
      }
      this.setData({ webLoading: true, webError: '', webQuery: query })
      searchYuanbao(
        { query, cnt: 10 },
        {
          onTask: (task) => {
            runtime.webTask = task
          },
        },
      )
        .then((response) => {
          if (runtime.cleaned || seq !== runtime.webSeq) {
            return
          }
          runtime.webTask = undefined
          this.setData({
            webLoading: false,
            webError: '',
            webQuery: query,
            webResults: response.results.slice(0, 4).map(toWebResultView),
          })
        })
        .catch((error: unknown) => {
          if (runtime.cleaned || seq !== runtime.webSeq) {
            return
          }
          runtime.webTask = undefined
          const message =
            error && typeof error === 'object' && 'message' in error
              ? String((error as { message?: unknown }).message || '')
              : ''
          this.setData({
            webLoading: false,
            webError: message || '全网搜索暂不可用，请稍后再试',
            webResults: [],
          })
        })
    },

    cancelWebSearch(): void {
      const runtime = this as unknown as HomeRuntime
      if (!runtime) {
        return
      }
      if (runtime.webTimer) {
        clearTimeout(runtime.webTimer)
        runtime.webTimer = 0
      }
      runtime.webSeq += 1
      if (runtime.webTask) {
        runtime.webTask.abort()
        runtime.webTask = undefined
      }
    },

    onRetryWebSearch(): void {
      const query = this.data.keyword.trim()
      if (query) {
        this.runWebSearch(query)
      }
    },

    onCopyWebResult(event: WechatMiniprogram.TouchEvent) {
      const url = String(event.currentTarget.dataset.url || '')
      if (!url) {
        return
      }
      tapTick()
      void copyText(url, '链接已复制')
    },

    onOpenWebSearch(): void {
      if (networkStore.offline) {
        tapWarn()
        showGlassToast({
          message: '当前离线，联网后可搜索',
          type: 'warning',
          placement: 'lower-center',
        })
        return
      }
      const query = this.data.keyword.trim()
      if (!query) {
        return
      }
      wx.navigateTo({
        url: `${ROUTES.webSearch}?query=${encodeURIComponent(query)}`,
        fail: () => {
          showGlassToast('元宝搜索打开失败')
        },
      })
    },

    onSearchHistoryRemove(event: WechatMiniprogram.TouchEvent) {
      const keyword = String(event.currentTarget.dataset.keyword || '')
      if (!keyword) {
        return
      }
      this.setData({ searchHistory: removeSearchHistory(keyword) })
    },

    onSearchHistoryClear() {
      clearSearchHistory()
      this.setData({ searchHistory: [] })
    },

    /* 使用指南横幅：进入帮助页 */
    onOpenHelpBanner() {
      wx.navigateTo({
        url: ROUTES.help,
        fail: () => {
          showGlassToast('使用指南打开失败')
        },
      })
    },

    /* 关闭横幅：只写本机标记，不再显示 */
    onDismissHelpBanner() {
      writeStorage(TBX_KEYS.helpBannerDismissed, true)
      this.setData({ showHelpBanner: false })
    },

    /* 此处是处理工具 id 校验与下线工具拦截的边界 */
    onOpenTool(event: WechatMiniprogram.TouchEvent) {
      const dataset = event.currentTarget.dataset as {
        route?: string
        id?: string
      }
      if (!dataset.id) {
        return
      }
      const tool = TOOLS.find((item) => item.id === dataset.id)
      if (!tool || !TOOL_IDS.has(tool.id)) {
        showGlassToast({
          message: '该工具已下线',
          type: 'warning',
          placement: 'lower-center',
        })
        return
      }
      if (tool.network === 'required' && networkStore.offline) {
        tapWarn()
        showGlassToast({
          message: '当前离线，联网后可打开',
          type: 'warning',
          placement: 'lower-center',
        })
        return
      }
      const runtime = this as unknown as HomeRuntime
      if (runtime.navigating) {
        return
      }
      runtime.navigating = true
      tapTick()
      wx.navigateTo({
        url: tool.route,
        success: () => {
          glassStore.recordHistory(tool.id)
        },
        fail: (error) => {
          runtime.navigating = false
          logger.warn('home', `工具打开失败：${tool.route}`, error)
          showGlassToast({
            message: '工具加载失败，请稍后重试',
            type: 'error',
            placement: 'lower-center',
          })
        },
      })
    },

    onToggleFavorite(event: WechatMiniprogram.TouchEvent) {
      const id = event.currentTarget.dataset.id as string
      if (!id) {
        return
      }
      tapTick()
      const added = glassStore.toggleFavorite('tool', id)
      if (added === null) {
        showGlassToast({
          message: '收藏失败，请重试',
          type: 'error',
          placement: 'lower-center',
        })
        return
      }
      showGlassToast({
        message: added ? '已收藏' : '已取消收藏',
        type: 'success',
        placement: 'lower-center',
      })
      if (this.data.keyword.trim()) {
        this.setData({
          results: buildResults(this.data.keyword, glassStore.toolFavorites),
        })
      }
    },

    onOpenFavorites() {
      tapTick()
      wx.switchTab({
        url: ROUTES.favorites,
        fail: () => {
          showGlassToast({
            message: '收藏页打开失败',
            type: 'error',
            placement: 'lower-center',
          })
        },
      })
    },

    onAuthor() {
      const runtime = this as unknown as HomeRuntime
      if (runtime.navigating) {
        return
      }
      runtime.navigating = true
      tapTick()
      wx.navigateTo({
        url: ROUTES.growHome,
        fail: () => {
          runtime.navigating = false
          showGlassToast({
            message: '简历加载失败',
            type: 'error',
            placement: 'lower-center',
          })
        },
      })
    },

    /* 原有搜索逻辑未变，此处为新增的魔法棒代码 */
    /** 打开全局指令面板：与原有搜索状态完全隔离 */
    openPalette(): void {
      if (!this.data.showPalette) {
        tapTick()
        this.setData({ showPalette: true })
      }
      openCommandPalette()
    },

    /** 关闭全局指令面板；面板自身的 close 事件也会回到这里 */
    closePalette(): void {
      this.setData({ showPalette: false })
      closeCommandPalette()
    },

    /* 首页分享固定回首页，不携带工具深链；工具深链由各工具页自行生成 */
    onShareAppMessage() {
      return sharePayloadForTool('')
    },

    /* 朋友圈同理：只分享首页，避免对方打开后落到某个工具页 */
    onShareTimeline() {
      return timelinePayloadForTool('')
    },
  },
})
