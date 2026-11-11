/* ==========================================================================
   人民币大写 · 分 → 亿/万/元分节
   - 不使用链式 replace；零、万、亿交界逐段处理
   - 支持负号，最大 1 万亿元
   ========================================================================== */

const DIGITS = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖']
const UNITS = ['', '拾', '佰', '仟']
const SECTIONS = ['', '万', '亿', '万亿']

/** 四位小节转大写（内部零不重复） */
function sectionToChinese(value: number): string {
  let out = ''
  let zeroPending = false
  let unit = 0
  let rest = value
  while (rest > 0) {
    const digit = rest % 10
    if (digit === 0) {
      if (out && !zeroPending) {
        out = DIGITS[0] + out
        zeroPending = true
      }
    } else {
      out = DIGITS[digit] + UNITS[unit] + out
      zeroPending = false
    }
    rest = Math.floor(rest / 10)
    unit += 1
  }
  return out
}

/** 分 → 中文大写金额 */
export function centsToChinese(cents: number): string {
  if (!Number.isSafeInteger(cents)) {
    return '金额超出支持范围'
  }
  if (cents === 0) {
    return '零元整'
  }

  const negative = cents < 0
  const abs = Math.abs(cents)
  const yuan = Math.floor(abs / 100)
  const jiao = Math.floor(abs / 10) % 10
  const fen = abs % 10

  let yuanText = ''
  if (yuan > 0) {
    const sections: number[] = []
    let rest = yuan
    while (rest > 0) {
      sections.push(rest % 10000)
      rest = Math.floor(rest / 10000)
    }
    let out = ''
    let zeroPending = false
    for (let i = sections.length - 1; i >= 0; i -= 1) {
      const sec = sections[i]
      if (sec === 0) {
        if (out) {
          zeroPending = true
        }
        continue
      }
      if (out && (zeroPending || sec < 1000)) {
        out += '零'
      }
      out += sectionToChinese(sec) + SECTIONS[i]
      zeroPending = false
    }
    yuanText = out
  }

  let tail = ''
  if (jiao === 0 && fen === 0) {
    tail = '整'
  } else if (jiao === 0) {
    tail = `零${DIGITS[fen]}分`
  } else {
    tail = `${DIGITS[jiao]}角${fen > 0 ? `${DIGITS[fen]}分` : '整'}`
  }

  const body = yuan > 0 ? `${yuanText}元${tail}` : `零元${tail}`
  return `${negative ? '负' : ''}${body}`
}
