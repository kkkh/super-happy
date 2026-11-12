/* ==========================================================================
   URL 编解码
   - encodeURIComponent / encodeURI 与对应解码
   - 解码失败给出明确百分比错误，不吞异常
   ========================================================================== */
import { copyText } from '../../lib/ui'
import { tapTick } from '../../../../core/utils/haptics'
import { LIMITS } from '../../../../core/constants/index'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'

type UrlMode = 'encode' | 'decode'
type UrlScope = 'component' | 'full'

Page({
  /* 此处是处理工具页分享与深链参数校验的边界 */
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: 'URL 编解码',
    kicker: '文本效率',
    desc: '链接转义与参数还原',
    mode: 'encode' as UrlMode,
    scope: 'component' as UrlScope,
    plusAsSpace: true,
    input: '',
    maxText: LIMITS.TEXT_INPUT,
    hasResult: false,
    error: '',
    outputText: '',
    inputLengthText: '',
    outputLengthText: '',
    posterData: null as IPosterData | null,
  },

  onInput(event: WechatMiniprogram.TextareaInput) {
    this.setData({ input: event.detail.value }, () => {
      this.recalculate()
    })
  },

  onMode(event: WechatMiniprogram.TouchEvent) {
    const mode = event.currentTarget.dataset.mode as UrlMode
    if (mode !== 'encode' && mode !== 'decode') {
      return
    }
    tapTick()
    this.setData({ mode }, () => {
      this.recalculate()
    })
  },

  onScope(event: WechatMiniprogram.TouchEvent) {
    const scope = event.currentTarget.dataset.scope as UrlScope
    if (scope !== 'component' && scope !== 'full') {
      return
    }
    tapTick()
    this.setData({ scope }, () => {
      this.recalculate()
    })
  },

  onPlus(event: { detail: { value: boolean } }) {
    this.setData({ plusAsSpace: event.detail.value }, () => {
      this.recalculate()
    })
  },

  onExample() {
    const sample = 'https://example.com/搜索?q=超欢&from=小程序'
    this.setData({ input: sample, mode: 'encode', scope: 'full' }, () => {
      this.recalculate()
    })
  },

  onReset() {
    this.setData({
      input: '',
      hasResult: false,
      error: '',
      outputText: '',
      inputLengthText: '',
      outputLengthText: '',
    })
  },

  /* ---- 草稿：模式、范围与输入；恢复后重新编码 ---- */
  draftMode(): string {
    return this.data.mode
  },

  collectDraftInput(): Record<string, string> {
    return {
      scope: this.data.scope,
      plusAsSpace: this.data.plusAsSpace ? '1' : '0',
      input: this.data.input,
    }
  },

  applyDraftInput(input: Record<string, string>, mode: string): void {
    this.setData(
      {
        mode: mode === 'decode' ? 'decode' : 'encode',
        scope: input.scope === 'full' ? 'full' : 'component',
        plusAsSpace: input.plusAsSpace !== '0',
        input: input.input ?? '',
      },
      () => {
        this.recalculate()
      },
    )
  },

  onCopy() {
    copyText(this.data.outputText, 'URL 结果已复制')
  },

  recalculate() {
    const input = this.data.input
    if (!input) {
      this.setData({ hasResult: false, error: '', outputText: '' })
      return
    }
    let output = ''
    try {
      if (this.data.mode === 'encode') {
        output =
          this.data.scope === 'full' ? encodeURI(input) : encodeURIComponent(input)
      } else {
        const source = this.data.plusAsSpace ? input.replace(/\+/g, ' ') : input
        output =
          this.data.scope === 'full' ? decodeURI(source) : decodeURIComponent(source)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.setData({
        hasResult: false,
        error: `解码失败：${message}，请检查百分号转义是否完整`,
        outputText: '',
        outputLengthText: '',
      })
      return
    }
    const outputChars = Array.from(output).length
    const modeLabel = this.data.mode === 'encode' ? '编码' : '解码'
    const poster: IPosterData = {
      toolName: 'URL 编解码',
      category: '文本效率',
      mainResult: `${outputChars}`,
      resultLabel: `${modeLabel}后字符数`,
      params: [
        { label: '处理模式', value: modeLabel },
        { label: '转义范围', value: this.data.scope === 'full' ? '完整 URL' : '组件' },
      ],
      extras: [
        `输入 ${Array.from(input).length} 字符`,
        `输出 ${outputChars} 字符`,
        `输出预览 ${output.slice(0, 24)}${outputChars > 24 ? '…' : ''}`,
      ],
    }
    this.setData({
      hasResult: true,
      error: '',
      outputText: output,
      inputLengthText: `${Array.from(input).length} 字符`,
      outputLengthText: `${outputChars} 字符`,
      posterData: poster,
    })
  },
})
