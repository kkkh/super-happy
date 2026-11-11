/* ==========================================================================
   分包结构与路由完整性 · 静态回归测试
   - 校验 app.json 的主包/分包边界、全部路由与页面文件
   - 校验 TabBar 页面留在主包、26 个工具路由全部注册
   - 校验页面 usingComponents 相对路径真实存在
   - 校验主包不 import 分包、分包不 import 其他分包
   - 校验主包体积与单分包体积上限
   - 校验简历数据引用的静态图片路径存在
   - 运行：npm test
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'))

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) {
    return out
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.DS_Store' || entry.name === 'node_modules') {
      continue
    }
    if (entry.name === 'package.json' || entry.name === 'package-lock.json') {
      continue
    }
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, out)
    } else {
      out.push(full)
    }
  }
  return out
}

function bytesOf(files) {
  let total = 0
  for (const file of files) {
    try {
      total += fs.statSync(file).size
    } catch {
      /* 文件被并发移除时忽略 */
    }
  }
  return total
}

function subRoutes() {
  return app.subpackages.flatMap((subpackage) =>
    subpackage.pages.map((page) => `${subpackage.root}/${page}`),
  )
}

function allRoutes() {
  return [...app.pages, ...subRoutes()]
}

function routeDir(route) {
  /* 页面文件前缀：pages/index/index → pages/index/index.ts */
  return path.join(ROOT, route)
}

function routeFolder(route) {
  /* 页面真实目录：pages/index/index → pages/index */
  return path.join(ROOT, path.dirname(route))
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

test('app.json：主包只保留 5 个核心页面，分包至少 6 个', () => {
  assert.equal(app.pages.length, 5)
  assert.ok(app.subpackages.length >= 6)
  assert.deepEqual(app.pages, [
    'pages/index/index',
    'pages/lab/index',
    'pages/favorites/index',
    'pages/mine/index',
    'pages/legal/index',
  ])
})

test('路由：唯一且页面文件齐全', () => {
  const routes = allRoutes()
  assert.ok(routes.length >= 41)
  assert.equal(new Set(routes).size, routes.length)

  for (const route of routes) {
    for (const ext of ['.ts', '.json', '.wxml']) {
      assert.ok(fs.existsSync(`${routeDir(route)}${ext}`), `缺少 ${route}${ext}`)
    }
  }
})

test('TabBar 页面全部留在主包', () => {
  const tabs = app.tabBar.list.map((item) => item.pagePath)
  assert.equal(tabs.length, 3)
  for (const tab of tabs) {
    assert.ok(app.pages.includes(tab), `${tab} 必须在主包 pages 中`)
    assert.ok(!subRoutes().includes(tab), `${tab} 不能出现在分包中`)
  }
})

test('工具注册表：路由全部注册', () => {
  const source = fs.readFileSync(path.join(ROOT, 'core/toolbox/registry.ts'), 'utf8')
  const routes = [...source.matchAll(/route: '\/([^']+)'/g)].map((match) => match[1])
  assert.ok(routes.length >= 24)
  const registered = new Set(allRoutes())
  for (const route of routes) {
    assert.ok(registered.has(route), `工具路由未注册：${route}`)
  }
})

test('ROUTES 常量：全部指向已注册页面', () => {
  const source = fs.readFileSync(path.join(ROOT, 'core/constants/index.ts'), 'utf8')
  const block = source.match(/export const ROUTES = \{[\s\S]*?\} as const/)
  assert.ok(block)
  const routes = [...block[0].matchAll(/:\s*'\/([^']+)'/g)].map((match) => match[1])
  assert.ok(routes.length >= 13)
  const registered = new Set(allRoutes())
  for (const route of routes) {
    assert.ok(registered.has(route), `ROUTES 未注册：${route}`)
  }
})

test('分包页面不越界 root，且主包页面不落在分包目录', () => {
  for (const subpackage of app.subpackages) {
    for (const page of subpackage.pages) {
      assert.ok(!page.startsWith('/'), `${page} 不能以 / 开头`)
      assert.ok(!page.includes('..'), `${page} 不能包含 ..`)
      const full = `${subpackage.root}/${page}`
      assert.ok(full.startsWith(`${subpackage.root}/`), `${full} 越界`)
    }
    for (const page of app.pages) {
      assert.ok(
        !page.startsWith(`${subpackage.root}/`),
        `主包页面 ${page} 落在了分包 ${subpackage.root}`,
      )
    }
  }
})

test('页面 usingComponents 路径全部存在', () => {
  const routes = allRoutes()
  for (const route of routes) {
    const jsonFile = `${routeDir(route)}.json`
    const config = readJson(jsonFile)
    const components = config.usingComponents || {}
    for (const [name, spec] of Object.entries(components)) {
      const target = spec.startsWith('/')
        ? path.join(ROOT, spec)
        : path.resolve(path.dirname(jsonFile), spec)
      const jsonPath = target.endsWith('.json') ? target : `${target}.json`
      assert.ok(fs.existsSync(jsonPath), `${route} 的组件 ${name} 不存在：${spec}`)
    }
  }
})

test('主包不 import 分包模块', () => {
  const mainDirs = ['app.ts', 'core', 'store', 'pages', 'components', 'custom-tab-bar']
  const subRoots = app.subpackages.map((subpackage) =>
    path.join(ROOT, subpackage.root),
  )
  const files = mainDirs.flatMap((entry) => {
    const full = path.join(ROOT, entry)
    if (!fs.existsSync(full)) {
      return []
    }
    return fs.statSync(full).isDirectory() ? walk(full) : [full]
  })

  for (const file of files) {
    if (!file.endsWith('.ts')) {
      continue
    }
    const source = fs.readFileSync(file, 'utf8')
    const specs = [
      ...source.matchAll(/from\s+['"]([^'"]+)['"]/g),
      ...source.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g),
    ].map((match) => match[1])

    for (const spec of specs) {
      if (!spec.startsWith('.') && !spec.startsWith('/')) {
        continue
      }
      const resolved = spec.startsWith('/')
        ? path.join(ROOT, spec)
        : path.resolve(path.dirname(file), spec)
      assert.ok(
        !subRoots.some((subRoot) => resolved.startsWith(subRoot)),
        `主包文件 ${path.relative(ROOT, file)} 引用了分包：${spec}`,
      )
    }
  }
})

test('分包之间不互相 import', () => {
  for (const subpackage of app.subpackages) {
    const ownRoot = path.join(ROOT, subpackage.root)
    const otherRoots = app.subpackages
      .filter((item) => item.root !== subpackage.root)
      .map((item) => path.join(ROOT, item.root))

    for (const file of walk(ownRoot)) {
      if (!file.endsWith('.ts')) {
        continue
      }
      const source = fs.readFileSync(file, 'utf8')
      const specs = [
        ...source.matchAll(/from\s+['"]([^'"]+)['"]/g),
        ...source.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g),
      ].map((match) => match[1])

      for (const spec of specs) {
        if (!spec.startsWith('.') && !spec.startsWith('/')) {
          continue
        }
        const resolved = spec.startsWith('/')
          ? path.join(ROOT, spec)
          : path.resolve(path.dirname(file), spec)
        assert.ok(
          !otherRoots.some((otherRoot) => resolved.startsWith(otherRoot)),
          `${subpackage.root} 引用了其他分包：${spec}`,
        )
      }
    }
  }
})

test('主包体积 <= 1900 KB，单分包体积 < 2048 KB', () => {
  const mainFiles = [
    'app.ts',
    'app.json',
    'app.wxss',
    'theme.json',
    'sitemap.json',
  ]
    .map((file) => path.join(ROOT, file))
    .concat(
      ['components', 'core', 'store', 'styles', 'assets', 'workers', 'custom-tab-bar', 'miniprogram_npm']
        .flatMap((dir) => walk(path.join(ROOT, dir))),
    )
    .concat(app.pages.flatMap((page) => walk(routeFolder(page))))

  const mainKb = bytesOf(mainFiles) / 1024
  assert.ok(mainKb <= 1900, `主包 ${mainKb.toFixed(0)} KB 超过 1900 KB`)

  for (const subpackage of app.subpackages) {
    const kb = bytesOf(walk(path.join(ROOT, subpackage.root))) / 1024
    assert.ok(kb < 2048, `${subpackage.root} ${kb.toFixed(0)} KB 超过 2048 KB`)
  }
})

test('简历数据引用的静态图片路径全部存在', () => {
  const source = fs.readFileSync(path.join(ROOT, 'core/data/resume-data.ts'), 'utf8')
  const refs = [...source.matchAll(/['"](\/assets\/[^'"]+\.(?:png|jpg|jpeg|webp|svg))['"]/gi)].map(
    (match) => match[1],
  )
  assert.ok(refs.length > 0)
  for (const ref of refs) {
    const file = path.join(ROOT, ref.replace(/^\//, ''))
    assert.ok(fs.existsSync(file), `图片不存在：${ref}`)
  }
})

test('共享工具模块归属正确：跨分包在 core/engines，单分包在分包 lib', () => {
  const removedFromMain = [
    'core/toolbox/date.ts',
    'core/toolbox/money.ts',
    'core/toolbox/rmb.ts',
    'core/toolbox/ui.ts',
    'components/worker-sandbox.ts',
  ]
  for (const file of removedFromMain) {
    assert.ok(!fs.existsSync(path.join(ROOT, file)), `主包仍残留：${file}`)
  }

  const sharedEngines = [
    'core/toolbox/engines/money.ts',
    'core/toolbox/engines/date.ts',
    'core/services/worker.ts',
  ]
  for (const file of sharedEngines) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `共享引擎缺失：${file}`)
  }

  const subpackageLibs = [
    'subpackages/tools-core/lib/date.ts',
    'subpackages/tools-core/lib/money.ts',
    'subpackages/tools-core/lib/rmb.ts',
    'subpackages/tools-core/lib/ui.ts',
    'subpackages/tools-media/lib/ui.ts',
    'subpackages/tools-media/lib/worker-sandbox.ts',
  ]
  for (const file of subpackageLibs) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `分包 lib 缺失：${file}`)
  }

  for (const file of [
    'core/toolbox/registry.ts',
    'core/toolbox/storage.ts',
    'core/toolbox/store.ts',
    'core/toolbox/tabbar.ts',
    'core/toolbox/types.ts',
  ]) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `主包公共模块被误移：${file}`)
  }
})

test('组件 usingComponents 路径全部存在（含分包搬迁组件）', () => {
  /* 组件搬迁后相对路径会多出两层甚至四层，必须逐个解析真实文件 */
  const componentRoots = [
    path.join(ROOT, 'components'),
    path.join(ROOT, 'subpackages/works/components'),
    path.join(ROOT, 'subpackages/campus/components'),
    path.join(ROOT, 'subpackages/grow/components'),
  ]
  const files = componentRoots.flatMap((root) => walk(root))
  let checked = 0

  for (const file of files) {
    if (!file.endsWith('index.json')) {
      continue
    }
    let json
    try {
      json = readJson(file)
    } catch {
      continue
    }
    const components = json.usingComponents
    if (!components || typeof components !== 'object') {
      continue
    }
    for (const [name, spec] of Object.entries(components)) {
      if (typeof spec !== 'string') {
        continue
      }
      checked += 1
      const base = path.resolve(path.dirname(file), spec)
      const hit = [base + '.json', path.join(base, 'index.json'), base + '.wxml'].some(
        (candidate) => fs.existsSync(candidate),
      )
      assert.ok(
        hit,
        `${path.relative(ROOT, file)} 的组件 ${name} 路径不存在：${spec}`,
      )
    }
  }

  assert.ok(checked > 0, '未扫描到任何组件 usingComponents')
})
