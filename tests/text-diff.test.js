/* ==========================================================================
   文本对比引擎 · 单元测试
   - 字符级切分、原文 100% 覆盖、统计一致性
   - 忽略大小写 / 空格 / 全角空格 / Tab / 回车
   - 换行保留、Emoji、多行 JSON、纯新增 / 纯删除
   - rich-text 节点颜色、节点上限降级、报告与高亮文本
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { registerHooks } = require('node:module')

const ROOT = path.resolve(__dirname, '..')

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

async function loadEngine() {
  return import(moduleUrl('subpackages/tools-core/utils/diffEngine.ts'))
}

async function loadRichText() {
  return import(moduleUrl('subpackages/tools-core/utils/diffToRichText.ts'))
}

function joined(segments) {
  return segments.map((segment) => segment.text).join('')
}

function assertCoverage(result, original, modified) {
  assert.equal(joined(result.originalSegments), original, '原文本必须 100% 覆盖')
  assert.equal(joined(result.modifiedSegments), modified, '新文本必须 100% 覆盖')
  assert.equal(
    result.stats.changeCount,
    result.stats.insertCount + result.stats.deleteCount,
    '差异处数必须等于新增块 + 删除块',
  )
}

test('基础替换：字符级切分、标注与原文覆盖', async () => {
  const { computeTextDiff } = await loadEngine()
  const original = 'Hello 世界'
  const modified = 'Hello 地球'
  const result = computeTextDiff(original, modified, {
    ignoreCase: false,
    ignoreSpace: false,
  })

  assert.ok(result.stats.insertCount >= 1)
  assert.ok(result.stats.deleteCount >= 1)
  assertCoverage(result, original, modified)
  assert.ok(result.annotatedText.includes('[-世界-]'))
  assert.ok(result.annotatedText.includes('{+地球+}'))
})

test('完全相同：零差异但仍完整覆盖', async () => {
  const { computeTextDiff } = await loadEngine()
  const text = '第一行\n第二行：内容完全一致'
  const result = computeTextDiff(text, text, {
    ignoreCase: false,
    ignoreSpace: false,
  })

  assert.equal(result.stats.changeCount, 0)
  assert.equal(result.stats.insertCount, 0)
  assert.equal(result.stats.deleteCount, 0)
  assertCoverage(result, text, text)
})

test('纯新增 / 纯删除：统计与空文本边界', async () => {
  const { computeTextDiff } = await loadEngine()
  const insertOnly = computeTextDiff('', '新增内容', {
    ignoreCase: false,
    ignoreSpace: false,
  })
  assert.equal(insertOnly.stats.insertCount, 1)
  assert.equal(insertOnly.stats.deleteCount, 0)
  assertCoverage(insertOnly, '', '新增内容')

  const deleteOnly = computeTextDiff('删除内容', '', {
    ignoreCase: false,
    ignoreSpace: false,
  })
  assert.equal(deleteOnly.stats.insertCount, 0)
  assert.equal(deleteOnly.stats.deleteCount, 1)
  assertCoverage(deleteOnly, '删除内容', '')
})

test('忽略大小写：结果为零差异，渲染仍保留原始大小写', async () => {
  const { computeTextDiff } = await loadEngine()
  const original = 'Hello World\nABC'
  const modified = 'hello world\nabc'
  const result = computeTextDiff(original, modified, {
    ignoreCase: true,
    ignoreSpace: false,
  })

  assert.equal(result.stats.changeCount, 0)
  assertCoverage(result, original, modified)
  assert.ok(joined(result.originalSegments).includes('Hello'))
  assert.ok(joined(result.modifiedSegments).includes('hello'))
})

test('忽略空格：半角 / 全角 / Tab / CR 都视为相同', async () => {
  const { computeTextDiff } = await loadEngine()
  const original = ' a b\tc　d\r'
  const modified = 'abcd'
  const result = computeTextDiff(original, modified, {
    ignoreCase: false,
    ignoreSpace: true,
  })

  assert.equal(result.stats.changeCount, 0)
  assertCoverage(result, original, modified)
})

test('忽略空格时换行仍然显著：换行结构变化必须被识别', async () => {
  const { computeTextDiff } = await loadEngine()
  const original = 'a b\nc'
  const modified = 'ab c'
  const result = computeTextDiff(original, modified, {
    ignoreCase: false,
    ignoreSpace: true,
  })

  assert.ok(result.stats.changeCount > 0, '换行被忽略会导致漏报')
  assertCoverage(result, original, modified)
})

test('忽略大小写 + 空格组合：多行文本零差异', async () => {
  const { computeTextDiff } = await loadEngine()
  const original = 'Hello  World\n  第二行  ABC'
  const modified = 'hello world\n第二行 abc'
  const result = computeTextDiff(original, modified, {
    ignoreCase: true,
    ignoreSpace: true,
  })

  assert.equal(result.stats.changeCount, 0)
  assertCoverage(result, original, modified)
})

test('Emoji 与多码元字符：不破坏原文覆盖', async () => {
  const { computeTextDiff } = await loadEngine()
  const original = '😀a👍\n结尾'
  const modified = '😀b👍\n结尾'
  const result = computeTextDiff(original, modified, {
    ignoreCase: false,
    ignoreSpace: false,
  })

  assertCoverage(result, original, modified)
  assert.ok(result.stats.insertCount >= 1)
  assert.ok(result.stats.deleteCount >= 1)
})

test('多行 JSON：换行、缩进与引号保持完整', async () => {
  const { computeTextDiff } = await loadEngine()
  const original = '{\n  "a": 1,\n  "b": "旧"\n}'
  const modified = '{\n  "a": 1,\n  "b": "新"\n}'
  const result = computeTextDiff(original, modified, {
    ignoreCase: false,
    ignoreSpace: false,
  })

  assertCoverage(result, original, modified)
  assert.ok(result.originalSegments.some((segment) => segment.type === 'delete'))
  assert.ok(result.modifiedSegments.some((segment) => segment.type === 'insert'))
})

test('rich-text：一个 Diff 块一个节点，颜色与删除线正确', async () => {
  const { computeTextDiff } = await loadEngine()
  const { diffSegmentsToRichText } = await loadRichText()
  const result = computeTextDiff('abc', 'axc', {
    ignoreCase: false,
    ignoreSpace: false,
  })

  const originalRich = diffSegmentsToRichText(result.originalSegments)
  const modifiedRich = diffSegmentsToRichText(result.modifiedSegments)
  assert.equal(originalRich.compacted, false)
  assert.equal(modifiedRich.compacted, false)
  assert.ok(originalRich.nodeCount <= result.originalSegments.length + 1)
  assert.ok(modifiedRich.nodeCount <= result.modifiedSegments.length + 1)

  const deleteNode = originalRich.nodes.find((node) =>
    node.attrs?.style?.includes('rgba(248,113,113,0.2)'),
  )
  assert.ok(deleteNode, '未生成删除红底节点')
  assert.ok(deleteNode.attrs.style.includes('line-through'))

  const insertNode = modifiedRich.nodes.find((node) =>
    node.attrs?.style?.includes('rgba(52,211,153,0.2)'),
  )
  assert.ok(insertNode, '未生成新增绿底节点')
})

test('rich-text：超过 5000 个差异块自动降级为单节点', async () => {
  const { diffSegmentsToRichText } = await loadRichText()
  const segments = Array.from({ length: 5001 }, () => ({
    type: 'equal',
    text: 'x',
  }))
  const result = diffSegmentsToRichText(segments)

  assert.equal(result.compacted, true)
  assert.equal(result.nodeCount, 1)
  assert.equal(result.nodes.length, 1)
  assert.equal(result.nodes[0].children[0].text.length, 5001)
})

test('rich-text：空差异集合返回占位节点', async () => {
  const { diffSegmentsToRichText } = await loadRichText()
  const result = diffSegmentsToRichText([])

  assert.equal(result.compacted, false)
  assert.equal(result.nodeCount, 1)
  assert.equal(result.nodes[0].children[0].text, '（暂无内容）')
})

test('报告与高亮文本：包含统计、标注与双栏结构', async () => {
  const { computeTextDiff, buildDiffReport, buildHighlightedText } =
    await loadEngine()
  const original = '苹果'
  const modified = '香蕉'
  const result = computeTextDiff(original, modified, {
    ignoreCase: false,
    ignoreSpace: false,
  })
  const report = buildDiffReport(original, modified, result)
  const highlighted = buildHighlightedText(result)

  assert.match(report, /文本对比报告/)
  assert.match(
    report,
    new RegExp(`共发现 ${result.stats.changeCount} 处差异（\\+新增 ${result.stats.insertCount} 处，-删除 ${result.stats.deleteCount} 处）`),
  )
  assert.ok(report.includes('[-苹果-]'))
  assert.ok(report.includes('{+香蕉+}'))

  assert.ok(highlighted.includes('--- 原文本'))
  assert.ok(highlighted.includes('+++ 新文本'))
  assert.ok(highlighted.includes('[-苹果-]'))
  assert.ok(highlighted.includes('{+香蕉+}'))
})
