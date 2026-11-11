/* ==========================================================================
   搜索与帮助 · 契约回归
   - searchTools 拼音 / 缩写 / 全角 / 排序
   - 命令面板与首页不得再维护第二份别名表
   - HELP_ENTRIES 覆盖 registry 全部工具
   - 搜索历史去重、上限与清空
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { registerHooks } = require('node:module')

const ROOT = path.resolve(__dirname, '..')
const URL_ROOT = `${require('node:url').pathToFileURL(ROOT).href}/`

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !path.extname(specifier)) {
      return nextResolve(`${specifier}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})

const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

test('搜索：别名、全角与排序等级生效', async () => {
  const { searchTools } = await import(`${URL_ROOT}core/toolbox/registry.ts`)

  assert.equal(searchTools('json')[0].id, 'json')
  assert.equal(searchTools('mima')[0].id, 'password')
  assert.equal(searchTools('ｊｓｏｎ')[0].id, 'json')
  assert.equal(searchTools('  BMI  ')[0].id, 'bmi')
  assert.ok(searchTools('换算').some((tool) => tool.id === 'unit'))
  assert.equal(searchTools('').length, 0)
  assert.equal(searchTools('不存在的能力zzz').length, 0)
})

test('搜索：单字符只做完全/前缀，不放大子串噪声', async () => {
  const { searchTools } = await import(`${URL_ROOT}core/toolbox/registry.ts`)
  /* “量”只出现在“质量”等词中间，单字符不应命中；旧逻辑会刷出单位换算 */
  assert.equal(searchTools('量').length, 0)
  /* 首字母仍可命中（拼音前缀） */
  assert.ok(searchTools('j').some((tool) => tool.id === 'json'))
})

test('搜索：多词必须全部命中', async () => {
  const { searchTools } = await import(`${URL_ROOT}core/toolbox/registry.ts`)
  const hit = searchTools('单位 换算')
  assert.ok(hit.some((tool) => tool.id === 'unit'))
  assert.equal(searchTools('单位 不存在的词').length, 0)
})

test('搜索：首页与命令面板不复用私有别名表', async () => {
  const palette = read('components/command-palette/palette.ts')
  assert.equal(palette.includes('TOOL_ALIASES'), false, '命令面板仍保留旧别名表')
  assert.match(palette, /\.\.\.tool\.aliases/)

  const home = read('pages/index/index.ts')
  assert.match(home, /searchTools\(keyword\)/)
  assert.equal(
    /\[tool\.name, tool\.desc, \.\.\.tool\.keywords\]\.join/.test(home),
    false,
    '首页仍在自写过滤',
  )
})

test('帮助：覆盖全部工具且步骤非空', async () => {
  const { TOOLS } = await import(`${URL_ROOT}core/toolbox/registry.ts`)
  const { HELP_ENTRIES } = await import(`${URL_ROOT}subpackages/grow/lib/help.ts`)

  for (const tool of TOOLS) {
    const help = HELP_ENTRIES[tool.id]
    assert.ok(help, `缺少帮助条目：${tool.id}`)
    assert.ok(help.summary.trim().length > 0, `${tool.id} summary 为空`)
    assert.ok(help.steps.length > 0, `${tool.id} steps 为空`)
    if (tool.id === 'radix' || tool.id === 'ledger') {
      assert.ok(help.faq.length >= 2, `${tool.id} 批 1 帮助 FAQ 少于 2 条`)
    }
  }
})

test('帮助页：路由已注册且三个入口齐备', () => {
  const app = JSON.parse(read('app.json'))
  const grow = app.subpackages.find((item) => item.root === 'subpackages/grow')
  assert.ok(grow.pages.includes('pages/help/index'))

  const routes = read('core/constants/index.ts')
  assert.match(routes, /help: '\/subpackages\/grow\/pages\/help\/index'/)
  assert.match(routes, /\[ROUTES\.help\]: '使用指南'/)

  /* 入口 1：我的页 */
  const mine = read('pages/mine/index.wxml')
  assert.match(mine, /bindtap="onOpenHelp"/)
  assert.match(read('pages/mine/index.ts'), /ROUTES\.help/)

  /* 入口 2：工具壳页脚 */
  const shell = read('components/glass-tool-shell/index.wxml')
  assert.match(shell, /bindtap="onOpenHelp"/)
  assert.match(read('components/glass-tool-shell/index.ts'), /ROUTES\.help\}\?tool=/)

  /* 入口 3：首页首启横幅，可关闭 */
  const home = read('pages/index/index.wxml')
  assert.match(home, /bindtap="onOpenHelpBanner"/)
  assert.match(home, /catchtap="onDismissHelpBanner"/)
  assert.match(read('pages/index/index.ts'), /helpBannerDismissed/)

  /* 帮助页支持 tool 参数自动展开 */
  assert.match(read('subpackages/grow/pages/help/index.ts'), /query\?\.tool/)
})

test('搜索历史：去重、上限 8 条、单删与清空', async () => {
  const store = new Map()
  globalThis.wx = {
    getStorageSync: (key) => (store.has(key) ? store.get(key) : ''),
    setStorageSync: (key, value) => store.set(key, value),
  }
  const mod = await import(`${URL_ROOT}core/toolbox/searchHistory.ts`)

  mod.clearSearchHistory()
  for (let index = 1; index <= 10; index += 1) {
    mod.pushSearchHistory(`词${index}`)
  }
  const list = mod.readSearchHistory()
  assert.equal(list.length, 8)
  assert.equal(list[0], '词10')

  mod.pushSearchHistory('词10')
  assert.equal(mod.readSearchHistory().filter((item) => item === '词10').length, 1)

  mod.removeSearchHistory('词10')
  assert.equal(mod.readSearchHistory().includes('词10'), false)

  mod.clearSearchHistory()
  assert.equal(mod.readSearchHistory().length, 0)

  delete globalThis.wx
})
