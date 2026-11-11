/* ==========================================================================
   工具页页脚 · 人生哲理
   - 每条不超过 10 个汉字，随机选取并避免连续重复
   - 外壳只展示短语，不再显示“本机计算 / 轨迹摘要”长文案
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = path.resolve(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

async function loadQuotes() {
  return import(pathToFileURL(path.join(ROOT, 'core/toolbox/quotes.ts')).href)
}

test('页脚哲理：全部为 10 字以内、无空值、无重复', async () => {
  const { FOOTER_QUOTES } = await loadQuotes()
  assert.ok(FOOTER_QUOTES.length >= 50, `哲理数量不足：${FOOTER_QUOTES.length}`)
  const seen = new Set()
  for (const quote of FOOTER_QUOTES) {
    assert.ok(quote.trim().length > 0, '存在空哲理')
    assert.ok([...quote].length <= 10, `超过 10 字：${quote}`)
    assert.equal(seen.has(quote), false, `重复哲理：${quote}`)
    seen.add(quote)
  }
})

test('页脚哲理：随机取词可复现，且避免连续重复', async () => {
  const { FOOTER_QUOTES, pickFooterQuote } = await loadQuotes()
  assert.equal(pickFooterQuote(() => 0), FOOTER_QUOTES[0])
  assert.equal(pickFooterQuote(() => 0.999999), FOOTER_QUOTES[FOOTER_QUOTES.length - 1])
  const excluded = pickFooterQuote(() => 0, FOOTER_QUOTES[0])
  assert.notEqual(excluded, FOOTER_QUOTES[0])
  assert.ok(FOOTER_QUOTES.includes(excluded))
  /* 非法随机值回退到第一条，不产生 undefined */
  assert.equal(pickFooterQuote(() => Number.NaN), FOOTER_QUOTES[0])
})

test('页脚哲理：外壳按页面随机展示，旧长文案已移除', () => {
  const ts = read('components/glass-tool-shell/index.ts')
  const wxml = read('components/glass-tool-shell/index.wxml')
  const wxss = read('components/glass-tool-shell/index.wxss')

  assert.match(ts, /pickFooterQuote/)
  assert.match(ts, /lastFooterQuote/)
  assert.match(ts, /footerQuote: nextFooterQuote\(\)/)
  assert.match(wxml, /class="tool-shell__footer"/)
  assert.match(wxml, /「\{\{footerQuote\}\}」/)
  assert.match(wxml, /aria-label="人生哲理：\{\{footerQuote\}\}"/)
  assert.equal(/LOCAL ONLY \/ 本机计算/.test(wxml), false)
  assert.equal(/轨迹摘要仅存本机/.test(wxml), false)
  assert.match(wxss, /\.tool-shell__footer\s*\{[^}]*font-size:\s*19rpx/s)
  assert.match(wxss, /\.tool-shell__footer\s*\{[^}]*letter-spacing:\s*0\.18em/s)
})
