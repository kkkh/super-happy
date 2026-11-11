/* ==========================================================================
   注册表契约 · ToolMeta v2
   - id/route 唯一；aliases 非空；sensitive 合法；weight 0–100
   - 每条 route 必须存在于 app.json 的主包或某一分包
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { registerHooks } = require('node:module')

const ROOT = path.resolve(__dirname, '..')
const URL_ROOT = `${pathToFileURL(ROOT).href}/`

function pathToFileURL(file) {
  return require('node:url').pathToFileURL(file)
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !path.extname(specifier)) {
      return nextResolve(`${specifier}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})

const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'))
const SENSITIVE_VALUES = new Set(['', 'privacy', 'personal', 'finance', 'health'])

function registeredRoutes() {
  const routes = new Set(app.pages.map((page) => `/${page}`))
  for (const subpackage of app.subpackages) {
    for (const page of subpackage.pages) {
      routes.add(`/${subpackage.root}/${page}`)
    }
  }
  return routes
}

test('ToolMeta v2：字段完整、唯一、路由真实存在', async () => {
  const { TOOLS } = await import(`${URL_ROOT}core/toolbox/registry.ts`)
  const registered = registeredRoutes()
  const ids = new Set()
  const routes = new Set()
  const icons = new Set()

  assert.ok(TOOLS.length >= 24, '工具数量少于基线 24')

  for (const tool of TOOLS) {
    assert.ok(tool.id && !ids.has(tool.id), `id 重复：${tool.id}`)
    ids.add(tool.id)
    assert.ok(tool.name && tool.desc && tool.icon, `${tool.id} 基础字段缺失`)
    assert.ok(!icons.has(tool.icon), `icon 重复：${tool.icon}`)
    icons.add(tool.icon)
    if (tool.privacyNote !== undefined) {
      assert.ok(
        typeof tool.privacyNote === 'string' &&
          tool.privacyNote.trim().length > 0 &&
          tool.privacyNote.length <= 40,
        `${tool.id} privacyNote 非法`,
      )
    }
    if (tool.draftExcluded !== undefined) {
      assert.equal(typeof tool.draftExcluded, 'boolean', `${tool.id} draftExcluded 非法`)
    }
    assert.ok(!routes.has(tool.route), `route 重复：${tool.route}`)
    routes.add(tool.route)
    assert.ok(Array.isArray(tool.aliases) && tool.aliases.length > 0, `${tool.id} aliases 为空`)
    for (const alias of tool.aliases) {
      assert.ok(typeof alias === 'string' && alias.trim().length > 0, `${tool.id} 别名非法`)
    }
    assert.ok(SENSITIVE_VALUES.has(tool.sensitive), `${tool.id} sensitive 非法`)
    assert.ok(
      Number.isInteger(tool.weight) && tool.weight >= 0 && tool.weight <= 100,
      `${tool.id} weight 越界`,
    )
    assert.ok(registered.has(tool.route), `${tool.id} 路由未注册：${tool.route}`)

    const pageDir = path.dirname(path.join(ROOT, tool.route.replace(/^\//, '')))
    const pageJson = JSON.parse(fs.readFileSync(path.join(pageDir, 'index.json'), 'utf8'))
    assert.ok(pageJson.navigationBarTitleText, `${tool.id} 缺少页面标题`)
    const pageTs = fs.readFileSync(path.join(pageDir, 'index.ts'), 'utf8')
    assert.match(pageTs, /onShareAppMessage\s*\(/, `${tool.id} 缺少 onShareAppMessage`)
    assert.match(pageTs, /onShareTimeline\s*\(/, `${tool.id} 缺少 onShareTimeline`)
  }
})
