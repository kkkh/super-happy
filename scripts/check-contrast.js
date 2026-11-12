/* ==========================================================================
   check-contrast · 文字与按钮对比度门禁
   - 读取 app.wxss 的基础 page / 深色 / 浅色主题令牌
   - 正文与辅助文字 ≥4.5:1；accent / danger 作为强调色 ≥3:1
   - 按钮填充白字为既有设计债：只输出 warning，不参与 exit
   - 纯静态计算，不依赖第三方；供 npm run check:contrast 与单测复用
   ========================================================================== */
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const APP_WXSS = path.join(ROOT, 'app.wxss')

const TEXT_TOKENS = [
  '--glass-text',
  '--glass-text-2',
  '--glass-text-3',
  '--glass-accent-text',
  '--glass-danger-text',
  '--glass-accent-2-text',
  '--glass-accent-warm-text',
]
const ACCENT_TOKENS = ['--glass-accent', '--glass-danger']
const BUTTON_PAIRS = [
  ['--glass-on-accent', '--glass-accent'],
  ['--glass-on-accent', '--glass-accent-2'],
  ['--glass-on-accent', '--glass-danger'],
  ['--glass-on-warm', '--glass-accent-warm'],
]

function extractBlock(css, startIndex) {
  const brace = css.indexOf('{', startIndex)
  if (brace < 0) {
    return ''
  }
  let depth = 0
  for (let index = brace; index < css.length; index += 1) {
    const char = css[index]
    if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return css.slice(brace + 1, index)
      }
    }
  }
  return ''
}

function findBlock(css, selectorPattern, requiredToken) {
  const pattern = new RegExp(selectorPattern.source, 'g')
  let match = pattern.exec(css)
  while (match) {
    const block = extractBlock(css, match.index)
    if (block.includes(requiredToken)) {
      return block
    }
    match = pattern.exec(css)
  }
  return ''
}

function findMediaBlock(css, scheme, requiredToken) {
  const marker = `@media (prefers-color-scheme: ${scheme})`
  let mediaIndex = css.indexOf(marker)
  while (mediaIndex >= 0) {
    const pageIndex = css.indexOf('page', mediaIndex)
    if (pageIndex < 0) {
      return ''
    }
    const block = extractBlock(css, pageIndex)
    if (block.includes(requiredToken)) {
      return block
    }
    mediaIndex = css.indexOf(marker, mediaIndex + marker.length)
  }
  return ''
}

function readToken(block, name) {
  const escaped = name.replace(/-/g, '\\-')
  const match = block.match(new RegExp(`${escaped}\\s*:\\s*([^;]+);`))
  return match ? match[1].trim() : ''
}

function parseColor(raw) {
  const value = String(raw || '').trim().toLowerCase()
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/)
  if (hex) {
    const text = hex[1].length === 3
      ? hex[1].split('').map((char) => char + char).join('')
      : hex[1]
    return {
      r: Number.parseInt(text.slice(0, 2), 16),
      g: Number.parseInt(text.slice(2, 4), 16),
      b: Number.parseInt(text.slice(4, 6), 16),
      a: 1,
    }
  }
  const rgb = value.match(/^rgba?\(([^)]+)\)$/)
  if (rgb) {
    const parts = rgb[1].split(',').map((part) => Number.parseFloat(part.trim()))
    if (parts.length >= 3 && parts.every((part) => Number.isFinite(part))) {
      return {
        r: parts[0],
        g: parts[1],
        b: parts[2],
        a: parts.length >= 4 ? Math.max(0, Math.min(1, parts[3])) : 1,
      }
    }
  }
  return null
}

function composite(foreground, background) {
  const alpha = foreground.a
  return {
    r: foreground.r * alpha + background.r * (1 - alpha),
    g: foreground.g * alpha + background.g * (1 - alpha),
    b: foreground.b * alpha + background.b * (1 - alpha),
    a: 1,
  }
}

function channelLuminance(channel) {
  const value = channel / 255
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function relativeLuminance(color) {
  return (
    0.2126 * channelLuminance(color.r) +
    0.7152 * channelLuminance(color.g) +
    0.0722 * channelLuminance(color.b)
  )
}

function contrastRatio(foreground, background) {
  const light = Math.max(relativeLuminance(foreground), relativeLuminance(background))
  const dark = Math.min(relativeLuminance(foreground), relativeLuminance(background))
  return (light + 0.05) / (dark + 0.05)
}

function ratioOf(tokenValue, background) {
  const color = parseColor(tokenValue)
  if (!color) {
    return 0
  }
  return contrastRatio(composite(color, background), background)
}

function analyzeContrast(cssSource) {
  const css = String(cssSource || '')
  const base = findBlock(css, /\npage\s*\{/, '--glass-on-accent')
  const dark = findBlock(css, /\npage,\s*\n?\.theme-dark\s*\{/, '--glass-canvas')
  const darkMedia = findMediaBlock(css, 'dark', '--glass-canvas')
  const light = findBlock(css, /\n\.theme-light\s*\{/, '--glass-canvas')
  const lightMedia = findMediaBlock(css, 'light', '--glass-canvas')

  const failures = []
  const warnings = []
  const checks = []

  function fail(message) {
    failures.push(message)
  }

  if (!base || !dark || !darkMedia || !light || !lightMedia) {
    return {
      ok: false,
      checks,
      warnings,
      failures: ['无法解析 app.wxss 的基础 / 深色 / 浅色主题块'],
    }
  }

  /* 媒体查询与手动主题必须同值，避免系统主题与手动切换出现两套对比度 */
  for (const token of [...TEXT_TOKENS, ...ACCENT_TOKENS]) {
    if (readToken(dark, token) !== readToken(darkMedia, token)) {
      fail(`深色主题令牌不一致：${token}`)
    }
    if (readToken(light, token) !== readToken(lightMedia, token)) {
      fail(`浅色主题令牌不一致：${token}`)
    }
  }

  const onAccent = readToken(base, '--glass-on-accent')
  const onWarm = readToken(base, '--glass-on-warm')

  for (const [themeName, block] of [
    ['dark', dark],
    ['light', light],
  ]) {
    const canvas = parseColor(readToken(block, '--glass-canvas'))
    const bgRaw = parseColor(readToken(block, '--glass-bg'))
    const bgStrongRaw = parseColor(readToken(block, '--glass-bg-strong'))
    if (!canvas || !bgRaw || !bgStrongRaw) {
      fail(`${themeName} 主题缺少 canvas / bg / bg-strong`)
      continue
    }
    const backgrounds = [
      ['canvas', canvas],
      ['glass-bg', composite(bgRaw, canvas)],
      ['glass-bg-strong', composite(bgStrongRaw, canvas)],
    ]

    for (const token of TEXT_TOKENS) {
      const raw = readToken(block, token)
      for (const [bgName, background] of backgrounds) {
        const ratio = ratioOf(raw, background)
        checks.push({ theme: themeName, token, background: bgName, ratio, threshold: 4.5 })
        if (!(ratio >= 4.5)) {
          fail(`${themeName} ${token} on ${bgName} = ${ratio.toFixed(2)}:1 < 4.5`)
        }
      }
    }

    for (const token of ACCENT_TOKENS) {
      const raw = readToken(block, token)
      for (const [bgName, background] of backgrounds) {
        const ratio = ratioOf(raw, background)
        checks.push({ theme: themeName, token, background: bgName, ratio, threshold: 3 })
        if (!(ratio >= 3)) {
          fail(`${themeName} ${token} on ${bgName} = ${ratio.toFixed(2)}:1 < 3`)
        }
      }
    }
  }

  /* 按钮填充色：既有设计债，只提示不阻断 */
  for (const [textToken, fillToken] of BUTTON_PAIRS) {
    for (const [themeName, block] of [
      ['dark', dark],
      ['light', light],
    ]) {
      const textColor = parseColor(readToken(base, textToken))
      const fillColor = parseColor(readToken(block, fillToken))
      if (!textColor || !fillColor) {
        continue
      }
      const ratio = contrastRatio(composite(textColor, fillColor), fillColor)
      if (!(ratio >= 4.5)) {
        warnings.push(
          `${themeName} 按钮 ${textToken} on ${fillToken} = ${ratio.toFixed(2)}:1（设计债，未纳入门禁）`,
        )
      }
    }
  }

  return {
    ok: failures.length === 0,
    checks,
    warnings,
    failures,
  }
}

function main() {
  const result = analyzeContrast(fs.readFileSync(APP_WXSS, 'utf8'))
  if (!result.ok) {
    console.error('✖ 文字对比度未达标：')
    for (const failure of result.failures) {
      console.error(`  ${failure}`)
    }
    process.exit(1)
  }
  console.log('✔ 文字对比度达标')
  if (result.warnings.length > 0) {
    console.warn('⚠ 按钮填充对比度设计债：')
    for (const warning of result.warnings) {
      console.warn(`  ${warning}`)
    }
  }
}

module.exports = {
  analyzeContrast,
  contrastRatio,
  relativeLuminance,
  parseColor,
}

if (require.main === module) {
  main()
}
