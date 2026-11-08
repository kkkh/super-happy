/**
 * command-palette · 全局毛玻璃命令面板
 * - 由 paletteStore 驱动，页面挂载一次后用 openCommandPalette() 全局唤醒
 * - 29 条内置命令：23 工具 + 6 导航；支持拼音全拼、首字母、分类与关键词
 * - 输入后必须经过 filterPaletteCommands，并 setData 更新 searchResults
 * - 输入框确认、点击结果、遮罩关闭、关闭按钮四种交互
 * - virtualHost + styleIsolation，样式不污染页面
 *
 * 用法：
 *   <command-palette show="{{showPalette}}" bind:close="closePalette" />
 */
import { createStoreBindings } from 'mobx-miniprogram-bindings'
import { showGlassToast } from '../glass-toast/toast'
import {
  BUILTIN_COMMANDS,
  buildPaletteUrl,
  closeCommandPalette,
  filterPaletteCommands,
  openCommandPalette,
  paletteStore,
  type PaletteCloseDetail,
  type PaletteCloseSource,
  type PaletteCommand,
  type PaletteSelectDetail,
} from './palette'

interface PaletteRuntime {
  bindings?: { destroyStoreBindings: () => void }
  openTimer: number
  closeTimer: number
  closeSource: PaletteCloseSource
}

const OPEN_DELAY = 30
const CLOSE_DURATION = 220

Component({
  options: {
    virtualHost: true,
    multipleSlots: false,
    styleIsolation: 'isolated',
    addGlobalClass: false,
  },

  externalClasses: ['custom-class'],

  properties: {
    /** 是否使用内置 20 工具 + 6 导航命令 */
    useBuiltins: {
      type: Boolean,
      value: true,
    },
    /** 追加的自定义命令 */
    commands: {
      type: Array,
      value: [],
    },
    /** 输入占位 */
    placeholder: {
      type: String,
      value: '搜索工具或命令',
    },
    /** 最大结果数 */
    maxResults: {
      type: Number,
      value: 8,
    },
    /** 选中后自动跳转 */
    autoNavigate: {
      type: Boolean,
      value: true,
    },
    /** 选中后自动关闭 */
    closeOnSelect: {
      type: Boolean,
      value: true,
    },
    /** 空结果文案 */
    emptyText: {
      type: String,
      value: '没有找到相关工具或指令',
    },
    /** 面包屑层级 */
    zIndex: {
      type: Number,
      value: 400,
    },
    /** 受控显隐：页面可通过 show 驱动，也兼容 paletteStore 全局唤醒 */
    show: {
      type: Boolean,
      value: false,
    },
    /** 读屏标签 */
    ariaLabel: {
      type: String,
      value: '命令面板',
    },
    /** 外部布局样式 */
    customStyle: {
      type: String,
      value: '',
    },
  },

  data: {
    visible: false,
    mounted: false,
    active: false,
    query: '',
    /* 关键：搜索命中结果必须集中放在 searchResults，禁止 undefined */
    searchResults: [] as PaletteCommand[],
    allCommands: [] as PaletteCommand[],
    dataSourceReady: false,
    activeIndex: 0,
    focusInput: false,
  },

  observers: {
    show(value: boolean) {
      /* 受控模式只同步 Store；真正的开合动画由 visible 观察器接管 */
      if (value) {
        openCommandPalette()
      } else {
        closeCommandPalette()
      }
    },

    visible(value: boolean) {
      if (value) {
        this.openPalette()
      } else {
        this.closePalette()
      }
    },

    'useBuiltins, commands'() {
      this.syncCommands()
    },
  },

  lifetimes: {
    attached() {
      const runtime = this as unknown as PaletteRuntime
      runtime.bindings = createStoreBindings(this, {
        store: paletteStore,
        fields: {
          visible: () => paletteStore.visible,
        },
        actions: [],
      })
      runtime.openTimer = 0
      runtime.closeTimer = 0
      runtime.closeSource = 'programmatic'

      /* 数据源校验：内置命令数组必须存在，便于真机日志快速定位阻断 */
      console.log(
        '[command-palette] 数据源校验',
        Array.isArray(BUILTIN_COMMANDS) ? `${BUILTIN_COMMANDS.length} 条` : 'undefined',
      )
      if (!Array.isArray(BUILTIN_COMMANDS) || BUILTIN_COMMANDS.length === 0) {
        console.error('[command-palette] BUILTIN_COMMANDS 为空，搜索将无法命中')
      }

      this.syncCommands()

      /* 受控 show 优先；否则兼容全局 openCommandPalette() 唤醒 */
      if (this.data.show) {
        openCommandPalette()
      } else if (paletteStore.visible) {
        this.openPalette()
      }
    },

    detached() {
      const runtime = this as unknown as PaletteRuntime
      if (runtime.openTimer) {
        clearTimeout(runtime.openTimer)
        runtime.openTimer = 0
      }
      if (runtime.closeTimer) {
        clearTimeout(runtime.closeTimer)
        runtime.closeTimer = 0
      }
      if (runtime.bindings) {
        runtime.bindings.destroyStoreBindings()
      }
    },
  },

  methods: {
    /** 构建命令池；Array.isArray 双重兜底，绝不返回 undefined */
    buildCommands(): PaletteCommand[] {
      const custom = Array.isArray(this.data.commands)
        ? (this.data.commands as PaletteCommand[])
        : []
      const builtins =
        this.data.useBuiltins && Array.isArray(BUILTIN_COMMANDS) ? BUILTIN_COMMANDS : []
      const commands = [...builtins, ...custom]

      if (commands.length === 0) {
        console.error('[command-palette] 命令池为空：BUILTIN_COMMANDS 或 commands 未初始化')
      }
      return commands
    },

    /** 全量同步命令池与当前查询结果 */
    syncCommands(): void {
      const commands = this.buildCommands()
      const searchResults = filterPaletteCommands(
        commands,
        this.data.query,
        this.data.maxResults,
      )

      console.log(
        `[command-palette] 数据源 ${commands.length} 条 · 关键词 "${this.data.query}" 命中 ${searchResults.length} 条`,
      )
      this.setData({
        allCommands: commands,
        searchResults,
        dataSourceReady: commands.length > 0,
      })
    },

    openPalette(): void {
      const runtime = this as unknown as PaletteRuntime
      if (runtime.openTimer) {
        clearTimeout(runtime.openTimer)
        runtime.openTimer = 0
      }
      if (runtime.closeTimer) {
        clearTimeout(runtime.closeTimer)
        runtime.closeTimer = 0
      }

      const commands = this.buildCommands()
      const searchResults = filterPaletteCommands(commands, '', this.data.maxResults)

      console.log(
        `[command-palette] 打开面板 · 数据源 ${commands.length} 条 · 首屏命中 ${searchResults.length} 条`,
      )

      this.setData({
        mounted: true,
        active: false,
        query: '',
        searchResults,
        allCommands: commands,
        dataSourceReady: commands.length > 0,
        activeIndex: 0,
        focusInput: false,
      })

      runtime.openTimer = setTimeout(() => {
        runtime.openTimer = 0
        this.setData({
          active: true,
          focusInput: true,
        })
      }, OPEN_DELAY) as unknown as number
    },

    closePalette(): void {
      const runtime = this as unknown as PaletteRuntime
      if (!this.data.mounted) {
        return
      }
      if (runtime.openTimer) {
        clearTimeout(runtime.openTimer)
        runtime.openTimer = 0
      }
      if (runtime.closeTimer) {
        return
      }

      this.setData({
        active: false,
        focusInput: false,
      })

      runtime.closeTimer = setTimeout(() => {
        runtime.closeTimer = 0
        this.setData({
          mounted: false,
          active: false,
          focusInput: false,
        })

        const detail: PaletteCloseDetail = { source: runtime.closeSource }
        this.triggerEvent('closed', detail)
        runtime.closeSource = 'programmatic'
      }, CLOSE_DURATION) as unknown as number
    },

    requestClose(source: PaletteCloseSource): void {
      const runtime = this as unknown as PaletteRuntime
      runtime.closeSource = source
      /* 通知宿主页面同步受控 show，避免页面状态与面板实际开合脱节 */
      this.triggerEvent('close', { source })
      closeCommandPalette()
    },

    /** 核心输入链路：过滤 -> setData(searchResults) -> 渲染 */
    onInput(event: WechatMiniprogram.Input): void {
      const query =
        event && event.detail && typeof event.detail.value === 'string'
          ? event.detail.value
          : ''
      const commands =
        Array.isArray(this.data.allCommands) && this.data.allCommands.length > 0
          ? this.data.allCommands
          : this.buildCommands()
      const searchResults = filterPaletteCommands(
        commands,
        query,
        this.data.maxResults,
      )

      console.log(
        `[command-palette] 输入 "${query}" · 数据源 ${commands.length} 条 · 搜索到 ${searchResults.length} 条`,
      )

      this.setData({
        query,
        allCommands: commands,
        searchResults,
        dataSourceReady: commands.length > 0,
        activeIndex: 0,
      })
    },

    onConfirm(): void {
      this.selectAt(0)
    },

    onClear(): void {
      const commands =
        Array.isArray(this.data.allCommands) && this.data.allCommands.length > 0
          ? this.data.allCommands
          : this.buildCommands()
      const searchResults = filterPaletteCommands(commands, '', this.data.maxResults)

      console.log(`[command-palette] 清空查询 · 恢复 ${searchResults.length} 条结果`)
      this.setData({
        query: '',
        searchResults,
        allCommands: commands,
        activeIndex: 0,
        focusInput: true,
      })
    },

    onResultTap(event: WechatMiniprogram.TouchEvent): void {
      const index = Number(event.currentTarget.dataset.index)
      if (!Number.isFinite(index)) {
        return
      }
      this.selectAt(index)
    },

    selectAt(index: number): void {
      const command = this.data.searchResults[index]
      if (!command) {
        return
      }

      const detail: PaletteSelectDetail = { command }
      this.triggerEvent('select', detail)

      if (this.data.autoNavigate) {
        const url = buildPaletteUrl(command)
        const fail = (): void => {
          showGlassToast({
            message: '页面打开失败，请稍后重试',
            type: 'error',
          })
        }

        if (command.mode === 'switchTab') {
          wx.switchTab({ url: command.route, fail })
        } else {
          wx.navigateTo({ url, fail })
        }
      }

      if (this.data.closeOnSelect) {
        this.requestClose('select')
      }
    },

    onMaskTap(): void {
      this.requestClose('mask')
    },

    onCloseTap(): void {
      this.requestClose('close')
    },

    noop(): void {
      /* 阻断滚动穿透 */
    },
  },
})
