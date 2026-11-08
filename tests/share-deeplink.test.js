/* ==========================================================================
   分享与深链 · 单元测试
   - 分享载荷：23 个已注册工具、非法 id 回退首页、朋友圈 query
   - 深链解析：trim / 单次解码 / 白名单校验 / 非法编码与路径穿越拦截
   - 当前页反查：路由匹配、空栈、异常与脏数据兜底
   - 深链暂存：takePending 只消费一次
   - 运行：npm test
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { registerHooks } = require('node:module')

const ROOT = path.resolve(__dirname, '..')
const HOME_PATH = '/pages/index/index'
const GENERIC_TITLE = '超欢 · 23 个本机工具，离线也能用'

/* 源码使用 bundler 风格的无扩展名相对导入；Node 侧补 .ts 后再解析 */
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !path.extname(specifier)) {
      try {
        return nextResolve(`${specifier}.ts`, context)
      } catch {
        /* 不是 TS 模块时回退原始路径 */
      }
    }
    return nextResolve(specifier, context)
  },
})

function moduleUrl(relative) {
  return pathToFileURL(path.join(ROOT, relative)).href
}

async function loadShare() {
  return import(moduleUrl('core/toolbox/share.ts'))
}

async function loadRegistry() {
  return import(moduleUrl('core/toolbox/registry.ts'))
}

async function loadDeepLinkStore() {
  const module = await import(moduleUrl('core/stores/deeplink.ts'))
  return module.deepLinkStore
}

/** 临时替换小程序全局 getCurrentPages，执行后恢复 */
function withCurrentPages(getter, run) {
  const hadOwn = Object.prototype.hasOwnProperty.call(globalThis, 'getCurrentPages')
  const previous = globalThis.getCurrentPages
  globalThis.getCurrentPages = getter
  try {
    return run()
  } finally {
    if (hadOwn) {
      globalThis.getCurrentPages = previous
    } else {
      delete globalThis.getCurrentPages
    }
  }
}

test('分享：23 个已注册工具全部生成首页深链', async () => {
  const { TOOLS } = await loadRegistry()
  const share = await loadShare()
  assert.equal(TOOLS.length, 23)

  for (const tool of TOOLS) {
    const payload = share.sharePayloadForTool(tool.id)
    assert.equal(payload.title, `${tool.name} · 超欢工具箱`)
    assert.equal(payload.path, `${HOME_PATH}?tool=${tool.id}`)

    const url = new URL(payload.path, 'https://share.local')
    assert.equal(url.pathname, HOME_PATH)
    assert.equal(url.searchParams.get('tool'), tool.id)

    /* 分享路径必须能被深链解析原样还原 */
    assert.equal(share.parseToolDeepLink(url.searchParams.get('tool')).id, tool.id)
  }
})

test('分享：非法 id 一律回退首页且不携带参数', async () => {
  const share = await loadShare()
  const invalidIds = [
    '',
    '   ',
    'unknown',
    'UNIT',
    'unit ',
    ' unit',
    'unit&x=1',
    'unit?x=1',
    '../pages/mine/index',
    'unit%20',
  ]

  for (const id of invalidIds) {
    assert.deepEqual(share.sharePayloadForTool(id), {
      title: GENERIC_TITLE,
      path: HOME_PATH,
    })
  }
})

test('朋友圈：合法工具生成 tool= query', async () => {
  const { TOOLS } = await loadRegistry()
  const share = await loadShare()

  for (const tool of TOOLS) {
    assert.deepEqual(share.timelinePayloadForTool(tool.id), {
      title: `${tool.name} · 超欢工具箱`,
      query: `tool=${tool.id}`,
    })
  }
})

test('朋友圈：非法工具清空 query 并回退通用标题', async () => {
  const share = await loadShare()

  for (const id of ['', 'unknown', 'UNIT', 'unit?x=1']) {
    assert.deepEqual(share.timelinePayloadForTool(id), {
      title: GENERIC_TITLE,
      query: '',
    })
  }
})

test('当前页反查：按栈顶路由匹配工具，兼容前导斜杠', async () => {
  const share = await loadShare()

  const stack = [
    { route: 'pages/index/index' },
    { route: 'subpackages/tools-core/pages/unit/index' },
  ]
  const tool = withCurrentPages(() => stack, () => share.currentPageTool())
  assert.equal(tool.id, 'unit')

  const withSlash = [{ route: '/subpackages/tools-media/pages/qr/index' }]
  const slashTool = withCurrentPages(() => withSlash, () => share.currentPageTool())
  assert.equal(slashTool.id, 'qr')
})

test('当前页反查：空栈、非工具页、异常与脏数据安全返回 null', async () => {
  const share = await loadShare()

  assert.equal(withCurrentPages(() => [], () => share.currentPageTool()), null)
  assert.equal(
    withCurrentPages(() => [{ route: 'pages/index/index' }], () => share.currentPageTool()),
    null,
  )
  assert.equal(withCurrentPages(() => [null], () => share.currentPageTool()), null)
  assert.equal(withCurrentPages(() => [{ route: 42 }], () => share.currentPageTool()), null)
  assert.equal(
    withCurrentPages(() => [{ route: '' }], () => share.currentPageTool()),
    null,
  )
  assert.equal(
    withCurrentPages(
      () => {
        throw new Error('getCurrentPages unavailable')
      },
      () => share.currentPageTool(),
    ),
    null,
  )
})

test('当前页分享：工具页生成对应深链，非工具页回退首页', async () => {
  const { TOOLS } = await loadRegistry()
  const share = await loadShare()
  const tax = TOOLS.find((tool) => tool.id === 'tax')

  const payload = withCurrentPages(
    () => [{ route: 'subpackages/tools-core/pages/tax/index' }],
    () => share.sharePayloadForCurrentPage(),
  )
  assert.deepEqual(payload, {
    title: `${tax.name} · 超欢工具箱`,
    path: `${HOME_PATH}?tool=tax`,
  })

  const fallback = withCurrentPages(
    () => [{ route: 'pages/index/index' }],
    () => share.sharePayloadForCurrentPage(),
  )
  assert.deepEqual(fallback, { title: GENERIC_TITLE, path: HOME_PATH })

  const fallbackTimeline = withCurrentPages(
    () => [{ route: 'pages/mine/index' }],
    () => share.timelinePayloadForCurrentPage(),
  )
  assert.deepEqual(fallbackTimeline, { title: GENERIC_TITLE, query: '' })
})

test('深链解析：合法 id、空白包裹与百分号编码全部通过', async () => {
  const { TOOLS } = await loadRegistry()
  const { parseToolDeepLink } = await loadShare()

  for (const tool of TOOLS) {
    const parsed = parseToolDeepLink(tool.id)
    assert.equal(parsed && parsed.id, tool.id)
    assert.equal(parsed && parsed.route, tool.route)
    assert.equal(parseToolDeepLink(`  ${tool.id}  `).id, tool.id)
    assert.equal(parseToolDeepLink(encodeURIComponent(tool.id)).id, tool.id)
  }

  /* 只解码一次：%75nit -> unit */
  assert.equal(parseToolDeepLink('%75nit').id, 'unit')
})

test('深链解析：非法百分号编码不抛异常并返回 null', async () => {
  const { parseToolDeepLink } = await loadShare()

  for (const raw of ['%', '%%', '%ZZ', '%E0%A4%A', '%E0%', '%C3%28']) {
    assert.equal(parseToolDeepLink(raw), null, `${raw} 应被拦截`)
  }
})

test('深链解析：未知 id、大小写、路径穿越与二次编码一律拦截', async () => {
  const { parseToolDeepLink } = await loadShare()
  const invalidIds = [
    'unknown',
    'UNIT',
    'Unit',
    '../unit',
    'unit/../tax',
    'unit%2F..%2Ftax',
    'unit%2520',
    'unit&x=1',
    'unit?x=1',
    'unit#x',
    'unit%00',
  ]

  for (const raw of invalidIds) {
    assert.equal(parseToolDeepLink(raw), null, `${raw} 应被拦截`)
  }
})

test('深链解析：空白、空值与非法类型全部返回 null', async () => {
  const { parseToolDeepLink } = await loadShare()

  for (const raw of ['', '   ', '\n\t', null, undefined, 0, 123, true, {}, [], ['unit']]) {
    assert.equal(parseToolDeepLink(raw), null)
  }
})

test('深链暂存：takePending 只消费一次并拒绝非字符串', async () => {
  const deepLinkStore = await loadDeepLinkStore()

  deepLinkStore.setPending('')
  assert.equal(deepLinkStore.takePending(), '')

  deepLinkStore.setPending('unit')
  assert.equal(deepLinkStore.takePending(), 'unit')
  assert.equal(deepLinkStore.takePending(), '')

  deepLinkStore.setPending(undefined)
  assert.equal(deepLinkStore.pendingToolId, '')

  deepLinkStore.setPending(null)
  assert.equal(deepLinkStore.pendingToolId, '')

  /* 后写入的参数覆盖前值，避免旧深链残留 */
  deepLinkStore.setPending('tax')
  deepLinkStore.setPending('qr')
  assert.equal(deepLinkStore.takePending(), 'qr')
})
