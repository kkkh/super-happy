/* ==========================================================================
   导出服务 · 纯函数契约
   - 文件名清洗、CSV 转义与 BOM、UTF-8 字节计算不依赖 wx
   - 写盘与分享由调用方在页面内驱动，测试只覆盖可离线部分
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
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
  return import(`${require('node:url').pathToFileURL(ROOT).href}/core/services/export.ts`)
}

test('导出：文件名清洗、空名回退与长度截断', async () => {
  const mod = await loadExport()
  assert.equal(mod.sanitizeExportName('a/b:c*d?e"f<g>h|i'), 'abcdefghi')
  assert.equal(mod.sanitizeExportName('   报告  '), '报告')
  assert.equal(mod.sanitizeExportName(''), '超欢导出')
  assert.equal(mod.sanitizeExportName('x'.repeat(80)).length, 32)
  assert.equal(mod.sanitizeExportName('trailing...'), 'trailing')
})

test('导出：CSV 转义与 UTF-8 BOM', async () => {
  const mod = await loadExport()
  assert.equal(mod.escapeCsvCell('plain'), 'plain')
  assert.equal(mod.escapeCsvCell('a,b'), '"a,b"')
  assert.equal(mod.escapeCsvCell('say "hi"'), '"say ""hi"""')
  assert.equal(mod.escapeCsvCell('line\nbreak'), '"line\nbreak"')
  /* 公式注入：以 = + - @ 开头的单元格前置单引号 */
  assert.equal(mod.escapeCsvCell('=SUM(A1)'), "'=SUM(A1)")
  assert.equal(mod.escapeCsvCell('+1'), "'+1")
  /* 纯数值负数保持原样，避免把数值列变成文本 */
  assert.equal(mod.escapeCsvCell('-1'), '-1')
  assert.equal(mod.escapeCsvCell('-1.5'), '-1.5')
  assert.equal(mod.escapeCsvCell('-1e3'), '-1e3')
  assert.equal(mod.escapeCsvCell('-1+2'), "'-1+2")
  assert.equal(mod.escapeCsvCell('@cmd'), "'@cmd")
  /* 前导空白不能绕过公式注入防护 */
  assert.equal(mod.escapeCsvCell('\t=1+1'), "'\t=1+1")
  assert.equal(mod.escapeCsvCell(' =1+1'), "' =1+1")
  assert.equal(mod.buildExportContent('a,b', 'csv'), '\uFEFFa,b')
  assert.equal(mod.buildExportContent('# 标题', 'md'), '# 标题')
  assert.equal(mod.buildExportContent('{"a":1}', 'json'), '{"a":1}')
})

test('导出：UTF-8 字节数与 2MB 上限常量', async () => {
  const mod = await loadExport()
  assert.equal(mod.utf8ByteLength('abc'), 3)
  assert.equal(mod.utf8ByteLength('中文'), 6)
  assert.equal(mod.utf8ByteLength('😀'), 4)
  assert.equal(mod.MAX_EXPORT_BYTES, 2 * 1024 * 1024)
})

test('导出：源码不含联网调用，分享必须走 shareFileMessage', () => {
  const source = fs.readFileSync(path.join(ROOT, 'core/services/export.ts'), 'utf8')
  assert.equal(/wx\.request|uploadFile|downloadFile/.test(source), false)
  assert.match(source, /shareFileMessage/)
  assert.match(source, /USER_DATA_PATH/)
})
