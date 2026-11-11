/* ==========================================================================
   Hash 与加密计算 · 极客安全工具
   - crypto-js 仅安装并运行在 tools-core 分包
   - MD5 / SHA-1 / SHA-256 / SHA-512，普通 Hash 与 HMAC
   - setTimeout 宏任务先渲染 Loading，再执行加密
   - 100,000 字符上限、空文本 / 空密钥拦截、计算异常兜底
   ========================================================================== */
import { createStoreBindings } from 'mobx-miniprogram-bindings'
import { uiStore } from '../../../../core/stores/ui'
import { tapSuccess, tapTick, tapWarn } from '../../../../core/utils/haptics'
import type { IWorkflowData } from '../../../../core/workflow/types'
import type { IPosterData } from '../../../../core/toolbox/poster'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import { copyText } from '../../lib/ui'
import {
  HASH_ALGORITHMS,
  MAX_HASH_CHARS,
  algorithmLabel,
  computeHash,
  formatHash,
  type HashAlgorithm,
  type HashCaseMode,
} from '../../utils/hashEngine'

const COMPUTE_DELAY = 32
const COPY_LOCK_MS = 1500

const EMPTY_RESULT_PATCH = {
  hasResult: false,
  hashHex: '',
  displayHex: '',
  algorithmLabel: 'SHA-256',
  modeLabel: '普通 Hash',
  inputChars: 0,
  elapsedMs: 0,
  copyLabel: '一键复制',
  copyLocked: false,
  flowPayload: '',
  posterData: null as IPosterData | null,
}

interface HashPageRuntime {
  seq: number
  timer: number
  comparing: boolean
  destroyed: boolean
  copyTimer: number
  themeBindings?: { destroyStoreBindings: () => void }
}

function runtimeOf(page: unknown): HashPageRuntime {
  const holder = page as { __hashRuntime?: HashPageRuntime }
  if (!holder.__hashRuntime) {
    holder.__hashRuntime = {
      seq: 0,
      timer: 0,
      comparing: false,
      destroyed: false,
      copyTimer: 0,
    }
  }
  return holder.__hashRuntime
}

function codePointLength(text: string): number {
  return Array.from(text).length
}

/** 海报主结果最多展示 32 位十六进制，完整值仍保留在页面与流转载荷 */
const POSTER_HEX_LIMIT = 32
/** 输入摘要最多展示 10 个字符，避免原文泄露过多 */
const POSTER_INPUT_LIMIT = 10

/**
 * 构造极光海报数据：
 * - 主结果只取前 32 位，SHA-512 等长摘要不会撑破海报
 * - 输入只展示前 10 个字符，兼顾识别度与隐私
 */
function buildHashPoster(input: {
  text: string
  displayHex: string
  algorithmLabel: string
  modeLabel: string
}): IPosterData {
  const compactInput = input.text.replace(/\s+/g, ' ').trim()
  const inputChars = Array.from(compactInput)
  const inputPreview =
    inputChars.length > POSTER_INPUT_LIMIT
      ? `${inputChars.slice(0, POSTER_INPUT_LIMIT).join('')}…`
      : inputChars.join('')
  const mainResult =
    input.displayHex.length > POSTER_HEX_LIMIT
      ? `${input.displayHex.slice(0, POSTER_HEX_LIMIT)}…`
      : input.displayHex

  return {
    toolName: 'Hash 与加密',
    category: '安全工具',
    mainResult,
    resultLabel: input.algorithmLabel,
    params: [
      { label: '输入摘要', value: inputPreview },
      { label: '模式', value: input.modeLabel },
    ],
    extras: ['极客级本地加密计算'],
  }
}

Page({
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: 'Hash 加密',
    kicker: '安全工具',
    desc: 'MD5 · SHA-1 · SHA-256 · SHA-512',
    themeClass: uiStore.themeClass,

    algorithms: HASH_ALGORITHMS,
    algorithm: 'sha256' as HashAlgorithm,
    selectedLabel: 'SHA-256',
    hmac: false,
    secret: '',

    text: '',
    textCount: 0,

    state: 'idle',
    canRun: false,
    hasResult: false,
    error: '',

    hashHex: '',
    displayHex: '',
    caseMode: 'lower' as HashCaseMode,
    algorithmLabel: 'SHA-256',
    modeLabel: '普通 Hash',
    inputChars: 0,
    elapsedMs: 0,
    copyLabel: '一键复制',
    copyLocked: false,
    flowPayload: '',
    posterData: null as IPosterData | null,

    tooLongShow: false,
    tooLongText: '',
  },

  onLoad() {
    const runtime = runtimeOf(this)
    runtime.destroyed = false
    runtime.themeBindings = createStoreBindings(this, {
      store: uiStore,
      fields: { themeClass: () => uiStore.themeClass },
      actions: [],
    })
  },

  onUnload() {
    const runtime = runtimeOf(this)
    runtime.destroyed = true
    runtime.seq += 1
    runtime.comparing = false
    if (runtime.themeBindings) {
      runtime.themeBindings.destroyStoreBindings()
      runtime.themeBindings = undefined
    }
    if (runtime.timer) {
      clearTimeout(runtime.timer)
      runtime.timer = 0
    }
    if (runtime.copyTimer) {
      clearTimeout(runtime.copyTimer)
      runtime.copyTimer = 0
    }
  },

  onInput(event: WechatMiniprogram.TextareaInput) {
    if (this.data.state === 'running') {
      return
    }
    const text = event.detail.value
    this.setData({
      ...EMPTY_RESULT_PATCH,
      text,
      textCount: codePointLength(text),
      canRun: Boolean(text.trim()),
      error: '',
    })
  },

  onSecretInput(event: WechatMiniprogram.Input) {
    if (this.data.state === 'running') {
      return
    }
    const secret = event.detail.value
    this.setData({
      ...EMPTY_RESULT_PATCH,
      secret,
      error: '',
      canRun: Boolean(this.data.text.trim()),
    })
  },

  onAlgorithmChange(event: WechatMiniprogram.TouchEvent) {
    if (this.data.state === 'running') {
      return
    }
    const key = event.currentTarget.dataset.key
    if (key !== 'md5' && key !== 'sha1' && key !== 'sha256' && key !== 'sha512') {
      return
    }
    const shouldRecompute = this.data.hasResult
    tapTick()
    this.setData(
      {
        ...EMPTY_RESULT_PATCH,
        algorithm: key,
        selectedLabel: algorithmLabel(key),
      },
      () => {
        if (shouldRecompute) {
          this.onCompute()
        }
      },
    )
  },

  onHmacChange(event: { detail: { value: boolean } }) {
    if (this.data.state === 'running') {
      return
    }
    const hmac = event.detail.value
    const shouldRecompute = this.data.hasResult
    const canRun = Boolean(this.data.text.trim())
    this.setData(
      {
        ...EMPTY_RESULT_PATCH,
        hmac,
        canRun,
        error: hmac && !this.data.secret.trim() ? 'HMAC 模式必须填写密钥' : '',
      },
      () => {
        if (shouldRecompute && (!hmac || this.data.secret.trim())) {
          this.onCompute()
        }
      },
    )
  },

  onCaseMode(event: WechatMiniprogram.TouchEvent) {
    if (this.data.state === 'running') {
      return
    }
    const mode = event.currentTarget.dataset.mode
    if (mode !== 'lower' && mode !== 'upper') {
      return
    }
    if (this.data.caseMode === mode) {
      return
    }
    tapTick()
    const displayHex = formatHash(this.data.hashHex, mode)
    this.setData({
      caseMode: mode,
      displayHex,
      flowPayload: displayHex,
      /* 大小写切换会改变海报主结果，必须同步刷新 posterData */
      posterData:
        this.data.hasResult && this.data.hashHex
          ? buildHashPoster({
              text: this.data.text,
              displayHex,
              algorithmLabel: this.data.algorithmLabel,
              modeLabel: this.data.modeLabel,
            })
          : null,
    })
  },

  /**
   * 计算入口：
   * 1. 空文本 / HMAC 空密钥 / 超长文本校验
   * 2. 立刻进入 running 锁住按钮
   * 3. setTimeout 宏任务先渲染 Loading
   */
  onCompute() {
    const runtime = runtimeOf(this)
    if (runtime.comparing || this.data.state === 'running') {
      return
    }
    const text = this.data.text
    if (!text.trim()) {
      this.setData({ error: '请输入需要计算 Hash 的文本' })
      tapWarn()
      return
    }
    const chars = codePointLength(text)
    if (chars > MAX_HASH_CHARS) {
      this.setData({
        state: 'idle',
        canRun: true,
        tooLongShow: true,
        tooLongText: `当前输入 ${chars.toLocaleString()} 字符，超过 ${MAX_HASH_CHARS.toLocaleString()} 字符上限。请精简后再计算。`,
      })
      tapWarn()
      return
    }
    if (this.data.hmac && !this.data.secret.trim()) {
      this.setData({ error: 'HMAC 模式必须填写密钥' })
      tapWarn()
      return
    }

    runtime.comparing = true
    runtime.seq += 1
    const seq = runtime.seq
    if (runtime.timer) {
      clearTimeout(runtime.timer)
      runtime.timer = 0
    }
    this.setData({
      ...EMPTY_RESULT_PATCH,
      state: 'running',
      canRun: false,
      error: '',
    })

    runtime.timer = setTimeout(() => {
      runtime.timer = 0
      if (runtime.destroyed || seq !== runtime.seq) {
        runtime.comparing = false
        return
      }
      this.runCompute(text, seq)
    }, COMPUTE_DELAY) as unknown as number
  },

  runCompute(text: string, seq: number) {
    const runtime = runtimeOf(this)
    try {
      const result = computeHash(text, {
        algorithm: this.data.algorithm,
        hmac: this.data.hmac,
        secret: this.data.secret,
      })
      if (runtime.destroyed || seq !== runtime.seq) {
        runtime.comparing = false
        return
      }
      const displayHex = formatHash(result.hex, this.data.caseMode)
      const poster = buildHashPoster({
        text,
        displayHex,
        algorithmLabel: result.algorithmLabel,
        modeLabel: result.modeLabel,
      })
      this.setData({
        state: 'idle',
        canRun: true,
        hasResult: true,
        error: '',
        hashHex: result.hex,
        displayHex,
        algorithmLabel: result.algorithmLabel,
        modeLabel: result.modeLabel,
        inputChars: result.inputChars,
        elapsedMs: result.elapsedMs,
        copyLabel: '一键复制',
        copyLocked: false,
        flowPayload: displayHex,
        posterData: poster,
      })
      runtime.comparing = false
      tapSuccess()
    } catch (error) {
      if (runtime.destroyed || seq !== runtime.seq) {
        runtime.comparing = false
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      this.setData({
        state: 'idle',
        canRun: true,
        hasResult: false,
        error: message || 'Hash 计算失败，请重试',
      })
      runtime.comparing = false
      tapWarn()
    }
  },

  onCopy() {
    if (this.data.copyLocked || !this.data.displayHex) {
      return
    }
    const runtime = runtimeOf(this)
    this.setData({ copyLabel: '已复制', copyLocked: true })
    if (runtime.copyTimer) {
      clearTimeout(runtime.copyTimer)
    }
    runtime.copyTimer = setTimeout(() => {
      runtime.copyTimer = 0
      if (!runtime.destroyed) {
        this.setData({ copyLabel: '一键复制', copyLocked: false })
      }
    }, COPY_LOCK_MS) as unknown as number
    copyText(this.data.displayHex, 'Hash 结果已复制')
  },

  onExample() {
    const runtime = runtimeOf(this)
    if (runtime.comparing) {
      return
    }
    const sample =
      '超欢工具箱 · Hash 与加密计算\n' +
      '所有计算只在本机完成，不上传服务器。\n' +
      'The quick brown fox jumps over the lazy dog.'
    this.setData(
      {
        ...EMPTY_RESULT_PATCH,
        text: sample,
        textCount: codePointLength(sample),
        canRun: true,
        error: '',
      },
      () => {
        this.onCompute()
      },
    )
  },

  onReset() {
    const runtime = runtimeOf(this)
    runtime.seq += 1
    runtime.comparing = false
    if (runtime.timer) {
      clearTimeout(runtime.timer)
      runtime.timer = 0
    }
    if (runtime.copyTimer) {
      clearTimeout(runtime.copyTimer)
      runtime.copyTimer = 0
    }
    this.setData({
      ...EMPTY_RESULT_PATCH,
      text: '',
      textCount: 0,
      secret: '',
      hmac: false,
      algorithm: 'sha256',
      selectedLabel: 'SHA-256',
      state: 'idle',
      canRun: false,
      error: '',
      tooLongShow: false,
      tooLongText: '',
    })
  },

  /* ---- 草稿：文本、算法与选项；HMAC 密钥不写草稿 ---- */
  draftMode(): string {
    return this.data.algorithm
  },

  collectDraftInput(): Record<string, string> {
    return {
      text: this.data.text,
      hmac: this.data.hmac ? '1' : '0',
      caseMode: this.data.caseMode,
    }
  },

  applyDraftInput(input: Record<string, string>, mode: string): void {
    const algorithm: HashAlgorithm =
      mode === 'md5' || mode === 'sha1' || mode === 'sha256' || mode === 'sha512'
        ? mode
        : 'sha256'
    const text = input.text ?? ''
    const hmac = input.hmac === '1'
    this.setData(
      {
        ...EMPTY_RESULT_PATCH,
        text,
        textCount: codePointLength(text),
        algorithm,
        selectedLabel: algorithmLabel(algorithm),
        hmac,
        caseMode: input.caseMode === 'upper' ? 'upper' : 'lower',
        state: 'idle',
        canRun: Boolean(text.trim()),
        error: hmac ? 'HMAC 模式需重新填写密钥' : '',
        tooLongShow: false,
        tooLongText: '',
      },
      () => {
        if (text.trim() && !hmac) {
          this.onCompute()
        }
      },
    )
  },

  /** Workflow 接收端：文本自动填入；HMAC 密钥已存在时自动计算 */
  onReceiveWorkflow(data: IWorkflowData): boolean {
    if (!data || data.type === 'image' || typeof data.payload !== 'string') {
      return false
    }
    const text = data.payload
    if (!text.trim()) {
      return false
    }
    const runtime = runtimeOf(this)
    runtime.seq += 1
    runtime.comparing = false
    if (runtime.timer) {
      clearTimeout(runtime.timer)
      runtime.timer = 0
    }
    const canCompute = !this.data.hmac || Boolean(this.data.secret.trim())
    this.setData(
      {
        ...EMPTY_RESULT_PATCH,
        text,
        textCount: codePointLength(text),
        state: 'idle',
        canRun: Boolean(text.trim()),
        error: canCompute ? '' : '已接收文本，请填写 HMAC 密钥后计算',
      },
      () => {
        if (canCompute) {
          this.onCompute()
        }
      },
    )
    return true
  },

  onTooLongConfirm() {
    this.setData({ tooLongShow: false })
  },
})
