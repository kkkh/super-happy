/* ==========================================================================
   结果管理 · 导出接入契约
   - 壳层属性 / 预写防抖 / 分享时序 / 失败降级复制
   - 全部结果卡页面接入 export-enabled，排除页不得误开
   - 页面 export-content 引用的字段必须存在于对应 TS
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { registerHooks } = require('node:module')

const ROOT = path.resolve(__dirname, '..')

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !path.extname(specifier)) {
      return nextResolve(`${specifier}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})

async function loadExport() {
  return import(pathToFileURL(path.join(ROOT, 'core/services/export.ts')).href)
}
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

const SHELL_TS = 'components/glass-tool-shell/index.ts'
const SHELL_WXML = 'components/glass-tool-shell/index.wxml'
const SHELL_WXSS = 'components/glass-tool-shell/index.wxss'

const EXCLUDED = [
  'tools-core/pages/base64',
  'tools-core/pages/password',
  'tools-daily/pages/id-validate',
  'tools-daily/pages/meeting-timer',
  'tools-daily/pages/quote',
  'tools-media/pages/avatar',
  'tools-media/pages/collage',
  'tools-media/pages/compress',
  'tools-media/pages/id-photo',
  'tools-media/pages/image-pdf',
  'tools-media/pages/nine-grid',
  'tools-media/pages/palette',
  'tools-media/pages/photo-edit',
  'tools-media/pages/qr',
  'tools-media/pages/watermark',
]

function listPages() {
  const pages = []
  for (const group of fs.readdirSync(path.join(ROOT, 'subpackages'))) {
    if (!group.startsWith('tools-')) {
      continue
    }
    const dir = path.join(ROOT, 'subpackages', group, 'pages')
    if (!fs.existsSync(dir)) {
      continue
    }
    for (const name of fs.readdirSync(dir)) {
      const wxml = path.join(dir, name, 'index.wxml')
      if (fs.existsSync(wxml)) {
        pages.push(`${group}/pages/${name}`)
      }
    }
  }
  return pages
}

test('结果导出：壳层属性、预写防抖、分享与降级链路齐全', () => {
  const ts = read(SHELL_TS)
  assert.match(ts, /exportEnabled:\s*\{\s*type:\s*Boolean,\s*value:\s*false\s*\}/)
  assert.match(ts, /exportName:\s*\{\s*type:\s*String/)
  assert.match(ts, /exportContent:\s*\{\s*type:\s*String/)
  assert.match(ts, /exportType:\s*\{\s*type:\s*String,\s*value:\s*'txt'\s*\}/)
  assert.match(ts, new RegExp('EXPORT_DEBOUNCE_MS\\s*=\\s*300'))
  assert.match(ts, /prepareExport\(/)
  assert.match(ts, /sharePrepared\(/)
  assert.match(ts, /cleanupExport\(/)
  assert.match(ts, /copyText\(/)
  assert.match(ts, /resolveExportContent\(/)
  assert.match(ts, /normalizePosterData\(this\.data\.posterData\)/)
  assert.match(ts, /scheduleExportPrepare\(/)
  assert.match(ts, /onExportTap\(/)
  assert.match(ts, /'exportEnabled, exportContent, exportName, exportType'/)
  /* 卸载必须取消定时器并清理本页预写文件 */
  assert.match(ts, /if\s*\(holder\.exportTimer\)\s*\{[\s\S]*?clearTimeout/)
  assert.match(ts, /cleanupExport\(holder\.exportPath\)/)
  /* 迟到的预写结果必须回收，避免页面卸载后遗留孤儿文件 */
  assert.match(ts, /seq !== holder\.exportSeq[\s\S]*?cleanupExport\(result\.path\)/)
  /* 低版本无 shareFileMessage 时按钮走复制 */
  assert.match(ts, /exportShareSupported:\s*canShareFile\(\)/)
  assert.match(ts, /!this\.data\.exportShareSupported[\s\S]*?copyExportContent\(\)/)
})

test('结果导出：结果区渲染导出入口与失败提示', () => {
  const wxml = read(SHELL_WXML)
  assert.match(wxml, /hasResult && exportEnabled/)
  assert.match(wxml, /bind:tap="onExportTap"/)
  assert.match(wxml, /导出结果文件/)
  assert.match(wxml, /复制结果内容/)
  assert.match(wxml, /exportHint/)
  const wxss = read(SHELL_WXSS)
  assert.match(wxss, /\.tool-shell__export\b/)
  assert.match(wxss, /\.tool-shell__export-hint\b/)
})

test('结果导出：48 个结果卡已接入，排除页保持关闭', () => {
  const pages = listPages()
  const enabled = []
  const missingName = []
  for (const page of pages) {
    const wxml = read(`subpackages/${page}/index.wxml`)
    if (!wxml.includes('export-enabled')) {
      continue
    }
    enabled.push(page)
    if (!/export-name="\{\{toolName\}\}"/.test(wxml)) {
      missingName.push(page)
    }
  }
  assert.equal(enabled.length, 48, `接入页数量异常：${enabled.length}`)
  assert.deepEqual(missingName, [])
  for (const page of EXCLUDED) {
    const wxml = read(`subpackages/${page}/index.wxml`)
    assert.equal(
      wxml.includes('export-enabled'),
      false,
      `${page} 不应开启结果导出`,
    )
  }
})

test('导出目录：启动清理按 24 小时与 10MB 淘汰最旧文件', async () => {
  const mod = await loadExport()
  const now = 1700000000000
  const makeStats = (size, ageMs) => ({
    size,
    lastModifiedTime: (now - ageMs) / 1000,
    isFile: () => true,
  })
  const stats = {
    '/user/exports/old.txt': makeStats(6 * 1024 * 1024, 25 * 60 * 60 * 1000),
    '/user/exports/keep-a.txt': makeStats(4 * 1024 * 1024, 2 * 60 * 60 * 1000),
    '/user/exports/keep-b.txt': makeStats(5 * 1024 * 1024, 60 * 60 * 1000),
  }
  const removed = []
  globalThis.wx = {
    env: { USER_DATA_PATH: '/user' },
    getFileSystemManager: () => ({
      readdirSync: () => ['old.txt', 'keep-a.txt', 'keep-b.txt'],
      statSync: (filePath) => ({ stats: stats[filePath] }),
      unlinkSync: (filePath) => removed.push(filePath),
    }),
  }
  mod.cleanupStaleExports(now)
  assert.deepEqual(removed, ['/user/exports/old.txt'])

  const fresh = {
    '/user/exports/a.txt': makeStats(4 * 1024 * 1024, 5 * 60 * 60 * 1000),
    '/user/exports/b.txt': makeStats(4 * 1024 * 1024, 3 * 60 * 60 * 1000),
    '/user/exports/c.txt': makeStats(4 * 1024 * 1024, 60 * 60 * 1000),
  }
  const removed2 = []
  globalThis.wx.getFileSystemManager = () => ({
    readdirSync: () => ['a.txt', 'b.txt', 'c.txt'],
    statSync: (filePath) => ({ stats: fresh[filePath] }),
    unlinkSync: (filePath) => removed2.push(filePath),
  })
  mod.cleanupStaleExports(now)
  assert.deepEqual(removed2, ['/user/exports/a.txt'])
  assert.ok(fresh['/user/exports/b.txt'].size + fresh['/user/exports/c.txt'].size <= 10 * 1024 * 1024)
  delete globalThis.wx
})

test('导出目录：清理失败静默，不阻断启动', async () => {
  const mod = await loadExport()
  globalThis.wx = {
    env: { USER_DATA_PATH: '/user' },
    getFileSystemManager: () => ({
      readdirSync: () => {
        throw new Error('no dir')
      },
    }),
  }
  assert.doesNotThrow(() => mod.cleanupStaleExports())
  delete globalThis.wx
  const app = read('app.ts')
  assert.match(app, /cleanupStaleExports\(\)/)
})

test('结果导出：页面 export-content 字段存在，壳层兜底不依赖页面摘要', () => {
  const pages = listPages()
  for (const page of pages) {
    const wxml = read(`subpackages/${page}/index.wxml`)
    const match = wxml.match(/export-content="\{\{([^}]+)\}\}"/)
    if (!match) {
      continue
    }
    const ts = read(`subpackages/${page}/index.ts`)
    const identifiers = match[1].match(/[A-Za-z][A-Za-z0-9]*/g) || []
    for (const identifier of identifiers) {
      if (identifier === 'true' || identifier === 'false' || identifier === 'null') {
        continue
      }
      assert.ok(
        new RegExp(`\\b${identifier}\\b`).test(ts),
        `${page} 的 export-content 字段 ${identifier} 不在 TS 中`,
      )
    }
  }
  const shell = read(SHELL_TS)
  /* 页面未传 exportContent 时，用海报数据拼最小文本兜底 */
  assert.match(shell, /poster\.resultLabel.*poster\.mainResult/)
  assert.match(shell, /poster\.params\.map/)
})
