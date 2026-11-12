/* ==========================================================================
   字数统计 · 码点计数（Emoji 按 1 个字符）
   - 字符 / 中文 / 英文单词 / 行 / 段落 / 阅读时长
   - 输入上限 20,000 字符，实时统计
   ========================================================================== */
import { copyText } from '../../lib/ui'
import { LIMITS } from '../../../../core/constants/index'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'

interface StatRow {
  key: string
  label: string
  value: string
}

const SAMPLE =
  '真正的效率，不是把每一分钟都排满，而是把注意力留给真正重要的事。' +
  '用一个称手的工具，把重复的计算交给本机，把时间还给生活。'

Page({
  /* 此处是处理工具页分享与深链参数校验的边界 */
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: '字数统计',
    kicker: '文本效率',
    desc: '字符、词数、行数与阅读时长',
    text: '',
    hasResult: false,
    totalValue: 0,
    totalText: '0',
    stats: [] as StatRow[],
    counterText: `0 / ${LIMITS.TEXT_INPUT}`,
    maxText: LIMITS.TEXT_INPUT,
    copyPayload: '',
    posterData: null as IPosterData | null,
  },

  onInput(event: WechatMiniprogram.TextareaInput) {
    const text = event.detail.value
    this.setData({ text, counterText: `${Array.from(text).length} / ${LIMITS.TEXT_INPUT}` })
    this.analyze(text)
  },

  onExample() {
    this.setData({ text: SAMPLE, counterText: `${Array.from(SAMPLE).length} / ${LIMITS.TEXT_INPUT}` })
    this.analyze(SAMPLE)
  },

  onReset() {
    this.setData({
      text: '',
      hasResult: false,
      totalValue: 0,
      totalText: '0',
      stats: [],
      counterText: `0 / ${LIMITS.TEXT_INPUT}`,
    })
  },

  /* ---- 草稿：只存文本，恢复后重新统计 ---- */
  collectDraftInput(): Record<string, string> {
    return { text: this.data.text }
  },

  applyDraftInput(input: Record<string, string>): void {
    const text = input.text ?? ''
    this.setData(
      { text, counterText: `${Array.from(text).length} / ${LIMITS.TEXT_INPUT}` },
      () => {
        this.analyze(text)
      },
    )
  },

  onCopy() {
    copyText(this.data.copyPayload, '字数统计结果已复制')
  },

  /**
   * 单次 Unicode 码点遍历完成全部统计。
   * 原实现用 7 次全文扫描（Array.from、replace、3 次 match、2 次 split），
   * 20k 文本在开发者工具已接近 16ms；合并为一次遍历后主线程余量明显增加。
   * 规则：中文按码点区间统计；英文按字母连续段统计，允许 ' / ’ / - 连接；
   * 数字按连续段统计；行/非空行/段落按换行与空白行状态机统计。
   */
  analyzeText(text: string) {
    let total = 0
    let noSpace = 0
    let chinese = 0
    let english = 0
    let digits = 0
    let lines = 1
    let nonEmptyLines = 0
    let paragraphs = 0
    let inWord = false
    let inDigits = false
    let lineHasContent = false
    let inParagraph = false

    const finishLine = () => {
      if (lineHasContent) {
        nonEmptyLines += 1
        if (!inParagraph) {
          paragraphs += 1
          inParagraph = true
        }
      } else {
        inParagraph = false
      }
      lineHasContent = false
    }

    for (const ch of text) {
      total += 1
      const cp = ch.codePointAt(0) ?? 0
      const isSpace =
        cp === 32 ||
        (cp >= 9 && cp <= 13) ||
        cp === 160 ||
        cp === 5760 ||
        (cp >= 8192 && cp <= 8202) ||
        cp === 8232 ||
        cp === 8233 ||
        cp === 8239 ||
        cp === 8287 ||
        cp === 12288 ||
        cp === 65279
      if (!isSpace) {
        noSpace += 1
      }
      if (cp >= 0x3400 && cp <= 0x4dbf) {
        chinese += 1
      } else if (cp >= 0x4e00 && cp <= 0x9fff) {
        chinese += 1
      } else if (cp >= 0xf900 && cp <= 0xfaff) {
        chinese += 1
      }

      const isAsciiLetter = (cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122)
      const isConnector = cp === 39 || cp === 8217 || cp === 45
      if (isAsciiLetter) {
        if (!inWord) {
          english += 1
          inWord = true
        }
      } else if (!(isConnector && inWord)) {
        inWord = false
      }

      const isDigit = cp >= 48 && cp <= 57
      if (isDigit) {
        if (!inDigits) {
          digits += 1
          inDigits = true
        }
      } else {
        inDigits = false
      }

      if (ch === '\n') {
        lines += 1
        finishLine()
      } else if (!isSpace) {
        lineHasContent = true
      }
    }
    finishLine()

    return {
      total,
      noSpace,
      chinese,
      english,
      digits,
      lines,
      nonEmptyLines,
      paragraphs,
    }
  },

  analyze(text: string) {
    if (!text) {
      this.setData({ hasResult: false, stats: [], totalValue: 0, totalText: '0' })
      return
    }
    const counts = this.analyzeText(text)
    const { total, noSpace, chinese, english, digits, lines, nonEmptyLines, paragraphs } = counts
    const readMinutes = Math.max(1, Math.ceil((chinese + english * 2) / 300))

    const stats: StatRow[] = [
      { key: 'noSpace', label: '不含空格', value: `${noSpace}` },
      { key: 'chinese', label: '中文字符', value: `${chinese}` },
      { key: 'english', label: '英文单词', value: `${english}` },
      { key: 'digits', label: '数字串', value: `${digits}` },
      { key: 'lines', label: '行数', value: `${lines}` },
      { key: 'nonEmpty', label: '非空行', value: `${nonEmptyLines}` },
      { key: 'paragraphs', label: '段落', value: `${paragraphs}` },
      { key: 'read', label: '阅读时长', value: `约 ${readMinutes} 分钟` },
    ]
    const copy = [
      '字数统计',
      `字符（含空格）：${total}`,
      ...stats.map((row) => `${row.label}：${row.value}`),
    ].join('\n')
    const readValue = stats.find((row) => row.key === 'read')?.value ?? ''
    const snippet = text.slice(0, 16) + (Array.from(text).length > 16 ? '…' : '')
    const poster: IPosterData = {
      toolName: '字数统计',
      category: '文本效率',
      mainResult: `${total}`,
      resultLabel: '字符总数',
      params: [{ label: '原文摘录', value: snippet }],
      extras: [
        `不含空格 ${noSpace}`,
        `中文字符 ${chinese} · 英文单词 ${english}`,
        `行数 ${lines} · 段落 ${paragraphs}`,
        `阅读约 ${readValue}`,
      ],
    }

    this.setData({
      hasResult: true,
      totalValue: total,
      totalText: `${total}`,
      stats,
      copyPayload: copy,
      posterData: poster,
    })
  },
})
