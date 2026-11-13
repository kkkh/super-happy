/* ==========================================================================
   全息视差 · 页面接线契约
   - 全息气象页确实注册 / 挂载 spatial-hologram，且 hero 在组件插槽内
   - 监听开关绑定真实数据（lowMemory / hasResult），低内存与无数据不启动
   - 组件具备启动 / 停止 / 页面隐藏收口 / 禁用回正
   - 天气页与专注页都挂载 privacy-guard：方向传感器是隐私接口
   - lab 组件样板间已移除，视差不再依赖不可达页面
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8')
}

function readJson(relative) {
  return JSON.parse(read(relative))
}

test('全息气象：注册并挂载 spatial-hologram', () => {
  const pageDir = 'subpackages/tools-core/pages/weather'
  const config = readJson(`${pageDir}/index.json`)
  const target = config.usingComponents['spatial-hologram']
  assert.equal(target, '../../components/spatial-hologram/index')

  const componentDir = path.resolve(ROOT, pageDir, target)
  for (const ext of ['.json', '.ts', '.wxml', '.wxss']) {
    assert.ok(fs.existsSync(componentDir + ext), `缺少组件文件 ${ext}`)
  }

  const wxml = read(`${pageDir}/index.wxml`)
  const open = wxml.indexOf('<spatial-hologram')
  const hero = wxml.indexOf('class="weather-hero')
  const close = wxml.indexOf('</spatial-hologram>')
  assert.ok(open >= 0 && hero > open && close > hero, 'hero 必须包在 spatial-hologram 插槽内')

  const source = read(`${pageDir}/index.ts`)
  assert.match(source, /lowMemory:\s*false/)
  assert.match(source, /hasResult:\s*false/)
  assert.match(wxml, /enabled="\{\{!lowMemory && hasResult\}\}"/)
  assert.match(wxml, /auto-start="\{\{!lowMemory\}\}"/)
})

test('全息气象：工具注册表可达', () => {
  const registry = read('core/toolbox/registry.ts')
  assert.ok(registry.includes("route: '/subpackages/tools-core/pages/weather/index'"))
})

test('全息组件：启动、停止与生命周期收口齐全', () => {
  const source = read('subpackages/tools-core/components/spatial-hologram/index.ts')
  assert.ok(source.includes('wx.startDeviceMotionListening'))
  assert.ok(source.includes('wx.stopDeviceMotionListening'))
  assert.match(source, /enabled\(value: boolean\)[\s\S]{0,120}startMotion\(\)[\s\S]{0,120}stopMotion\(\)[\s\S]{0,120}resetTilt\(\)/)
  assert.match(source, /pageLifetimes:\s*\{[\s\S]*hide\(\)/)
  assert.match(source, /detached\(\)[\s\S]{0,80}stopMotion/)
})

test('隐私授权：天气页与专注页都能弹出方向传感器授权', () => {
  for (const page of ['subpackages/tools-core/pages/weather', 'subpackages/life/pages/focus']) {
    const config = readJson(`${page}/index.json`)
    assert.ok(config.usingComponents['privacy-guard'], `${page} 未注册 privacy-guard`)
    assert.ok(read(`${page}/index.wxml`).includes('<privacy-guard />'), `${page} 未挂载 privacy-guard`)
  }
  const focus = read('subpackages/life/pages/focus/index.ts')
  assert.match(focus, /onFlipToggle[\s\S]{0,500}startMotionListening/)
})

test('组件样板间已移除且无残留引用', () => {
  const app = readJson('app.json')
  const all = [
    ...app.pages,
    ...app.subpackages.flatMap((item) => item.pages.map((page) => `${item.root}/${page}`)),
  ]
  assert.ok(!all.includes('subpackages/tools-core/pages/lab/index'))
  for (const ext of ['.json', '.ts', '.wxml', '.wxss']) {
    assert.ok(
      !fs.existsSync(path.join(ROOT, `subpackages/tools-core/pages/lab/index${ext}`)),
      `lab 页面残留 index${ext}`,
    )
  }

  const leftovers = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || ['node_modules', 'tests'].includes(entry.name)) {
        continue
      }
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (/\.(ts|js|json|wxml)$/.test(entry.name)) {
        if (fs.readFileSync(full, 'utf8').includes('pages/lab')) {
          leftovers.push(path.relative(ROOT, full))
        }
      }
    }
  }
  walk(ROOT)
  assert.deepEqual(leftovers, [])
})
