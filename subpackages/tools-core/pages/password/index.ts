/* ==========================================================================
   随机密码 · 密码学随机数 + 拒绝采样
   - 优先 wx.getRandomValues；不可用时回退 Math.random
   - 四类字符可组合，至少保留一类；可排除易混淆字符
   ========================================================================== */
import { copyText, toast } from '../../lib/ui'
import { passwordEntropy, strengthLevel } from '../../lib/password'
import { tapTick } from '../../../../core/utils/haptics'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const LOWER = 'abcdefghijklmnopqrstuvwxyz'
const DIGITS = '0123456789'
const SYMBOLS = '!@#$%^&*()-_=+[]{};:,.?/|~'
const AMBIGUOUS = '0O1lI'

interface PasswordState {
  /** 页面销毁令牌：阻止 wx.getRandomValues 回调在退出后 setData */
  destroyed: boolean
  /** 生成序号：快速改长度时只允许最后一次随机结果落盘 */
  genSeq: number
}

class ByteRandom {
  private bytes: Uint8Array
  private position = 0

  constructor(bytes: Uint8Array) {
    this.bytes = bytes
  }

  next(max: number): number {
    if (max <= 0) {
      return 0
    }
    const limit = 256 - (256 % max)
    while (this.position < this.bytes.length) {
      const value = this.bytes[this.position]
      this.position += 1
      if (value < limit) {
        return value % max
      }
    }
    return Math.floor(Math.random() * max)
  }

  shuffle(chars: string[]): string[] {
    for (let index = chars.length - 1; index > 0; index -= 1) {
      const swapIndex = this.next(index + 1)
      const swapValue = chars[index]
      chars[index] = chars[swapIndex]
      chars[swapIndex] = swapValue
    }
    return chars
  }
}

Page({
  /* 此处是处理工具页分享与深链参数校验的边界 */
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: '随机密码',
    kicker: '文本效率',
    desc: '本机生成高强度密码',
    length: 16,
    lengthHint: '16 位',
    uppercase: true,
    lowercase: true,
    digits: true,
    symbols: true,
    excludeAmbiguous: true,
    shellState: 'idle',
    hasResult: false,
    error: '',
    password: '',
    strengthText: '',
    strengthPercent: 0,
    entropyText: '',
    classesText: '',
    posterData: null as IPosterData | null,
  },

  onLoad() {
    const state = this as unknown as PasswordState
    state.destroyed = false
    state.genSeq = 0
    this.generate()
  },

  /* ---- 草稿：只恢复生成选项，不自动生成新密码 ---- */
  collectDraftInput(): Record<string, string> {
    return {
      length: `${this.data.length}`,
      uppercase: this.data.uppercase ? '1' : '0',
      lowercase: this.data.lowercase ? '1' : '0',
      digits: this.data.digits ? '1' : '0',
      symbols: this.data.symbols ? '1' : '0',
      excludeAmbiguous: this.data.excludeAmbiguous ? '1' : '0',
    }
  },

  applyDraftInput(input: Record<string, string>): void {
    const lengthValue = Number(input.length)
    const length =
      Number.isInteger(lengthValue) && lengthValue >= 8 && lengthValue <= 64 ? lengthValue : 16
    const uppercase = input.uppercase !== '0'
    const lowercase = input.lowercase !== '0'
    const digits = input.digits !== '0'
    const symbols = input.symbols !== '0'
    const anySelected = uppercase || lowercase || digits || symbols
    this.setData({
      length,
      lengthHint: `${length} 位`,
      uppercase: anySelected ? uppercase : true,
      lowercase: anySelected ? lowercase : true,
      digits: anySelected ? digits : true,
      symbols: anySelected ? symbols : true,
      excludeAmbiguous: input.excludeAmbiguous !== '0',
      shellState: 'idle',
      hasResult: false,
      error: '',
      password: '',
      strengthText: '',
      strengthPercent: 0,
      entropyText: '',
      classesText: '',
      posterData: null,
    })
  },

  onUnload() {
    const state = this as unknown as PasswordState
    state.destroyed = true
  },

  onLengthChanging(event: { detail: { value: number } }) {
    const length = event.detail.value
    this.setData({ length, lengthHint: `${length} 位` })
  },

  onLengthChange(event: { detail: { value: number } }) {
    const length = event.detail.value
    this.setData({ length, lengthHint: `${length} 位` }, () => {
      this.generate()
    })
  },

  onToggle(event: {
    currentTarget: { dataset: { field?: string } }
    detail: { value: boolean }
  }) {
    const field = event.currentTarget.dataset.field as
      | 'uppercase'
      | 'lowercase'
      | 'digits'
      | 'symbols'
      | 'excludeAmbiguous'
    if (!field) {
      return
    }
    const value = event.detail.value
    if (field === 'excludeAmbiguous') {
      this.setData({ excludeAmbiguous: value }, () => {
        this.generate()
      })
      return
    }
    const next = {
      uppercase: this.data.uppercase,
      lowercase: this.data.lowercase,
      digits: this.data.digits,
      symbols: this.data.symbols,
    }
    next[field] = value
    if (!next.uppercase && !next.lowercase && !next.digits && !next.symbols) {
      toast('至少保留一类字符')
      return
    }
    this.setData({ [field]: value }, () => {
      this.generate()
    })
  },

  onExample() {
    tapTick()
    this.setData(
      {
        length: 16,
        lengthHint: '16 位',
        uppercase: true,
        lowercase: true,
        digits: true,
        symbols: true,
        excludeAmbiguous: true,
      },
      () => {
        this.generate()
      },
    )
  },

  onReset() {
    const state = this as unknown as PasswordState
    /* 使在途随机数请求失效，避免 reset 后旧回调又把密码写回来 */
    state.genSeq += 1
    this.setData({
      length: 16,
      lengthHint: '16 位',
      uppercase: true,
      lowercase: true,
      digits: true,
      symbols: true,
      excludeAmbiguous: true,
      shellState: 'idle',
      hasResult: false,
      error: '',
      password: '',
      strengthText: '',
      strengthPercent: 0,
      entropyText: '',
      classesText: '',
    })
  },

  onRun() {
    this.generate()
  },

  onCopy() {
    copyText(this.data.password, '密码已复制')
  },

  buildCharset(): { charset: string; classes: string[] } {
    const classes: string[] = []
    let charset = ''
    if (this.data.uppercase) {
      classes.push('大写')
      charset += UPPER
    }
    if (this.data.lowercase) {
      classes.push('小写')
      charset += LOWER
    }
    if (this.data.digits) {
      classes.push('数字')
      charset += DIGITS
    }
    if (this.data.symbols) {
      classes.push('符号')
      charset += SYMBOLS
    }
    if (this.data.excludeAmbiguous) {
      charset = Array.from(charset)
        .filter((char) => !AMBIGUOUS.includes(char))
        .join('')
    }
    return { charset, classes }
  },

  generate() {
    const { charset, classes } = this.buildCharset()
    if (!charset) {
      this.setData({ shellState: 'invalid', hasResult: false, error: '至少选择一类字符' })
      return
    }
    this.setData({ shellState: 'running', error: '' })
    const state = this as unknown as PasswordState
    const seq = (state.genSeq += 1)
    const byteLength = Math.min(1024, (this.data.length + 4) * 8)
    if (typeof wx.getRandomValues === 'function') {
      wx.getRandomValues({
        length: byteLength,
        success: (result) => {
          if (state.destroyed || seq !== state.genSeq) {
            return
          }
          this.buildPassword(charset, classes, new Uint8Array(result.randomValues))
        },
        fail: () => {
          if (state.destroyed || seq !== state.genSeq) {
            return
          }
          this.buildPassword(charset, classes, null)
        },
      })
    } else {
      this.buildPassword(charset, classes, null)
    }
  },

  buildPassword(charset: string, classes: string[], bytes: Uint8Array | null) {
    if ((this as unknown as PasswordState).destroyed) {
      return
    }
    const random = new ByteRandom(bytes ?? new Uint8Array(0))
    const password: string[] = []
    const length = this.data.length

    /* 先保证每个已选字符类至少出现一次 */
    const groups: string[] = []
    if (this.data.uppercase) groups.push(UPPER)
    if (this.data.lowercase) groups.push(LOWER)
    if (this.data.digits) groups.push(DIGITS)
    if (this.data.symbols) groups.push(SYMBOLS)
    const cleaned = groups.map((group) =>
      this.data.excludeAmbiguous
        ? Array.from(group).filter((char) => !AMBIGUOUS.includes(char)).join('')
        : group,
    )
    cleaned.forEach((group) => {
      if (group && password.length < length) {
        password.push(group[random.next(group.length)])
      }
    })
    while (password.length < length) {
      password.push(charset[random.next(charset.length)])
    }
    random.shuffle(password)

    const entropy = passwordEntropy(length, charset.length)
    const strength = strengthLevel(entropy)
    const strengthPercent = strength.percent
    const strengthText = strength.label
    const classesText = classes.join(' · ')
    const entropyText = `约 ${entropy.toFixed(1)} 位熵`
    const poster: IPosterData = {
      toolName: '随机密码',
      category: '安全工具',
      mainResult: password.join(''),
      resultLabel: `${length} 位随机密码`,
      params: [
        { label: '密码长度', value: `${length} 位` },
        { label: '易混淆', value: this.data.excludeAmbiguous ? '已排除' : '保留' },
      ],
      extras: [
        `强度 ${strengthText}`,
        `信息熵 ${entropyText}`,
        `字符类型 ${classesText}`,
      ],
    }

    this.setData({
      shellState: 'done',
      hasResult: true,
      error: '',
      password: password.join(''),
      strengthText,
      strengthPercent,
      entropyText,
      classesText,
      posterData: poster,
    })
  },
})
