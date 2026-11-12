/* ==========================================================================
   工具草稿 · 存储契约与页面接入
   - 覆盖读写往返、敏感排除、空输入、4KB 截断、30 天过期、20 个上限
   - 覆盖清空工具数据与静态页面契约
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { registerHooks } = require('node:module')
const { pathToFileURL } = require('node:url')

const ROOT = path.resolve(__dirname, '..')
const DAY = 24 * 60 * 60 * 1000

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !path.extname(specifier)) {
      return nextResolve(`${specifier}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})

function moduleUrl(relative) {
  return pathToFileURL(path.join(ROOT, relative)).href
}

async function loadDraft() {
  return import(moduleUrl('core/toolbox/draft.ts'))
}

async function loadStorage() {
  return import(moduleUrl('core/toolbox/storage.ts'))
}

function installStorageMock(seed = {}) {
  const values = { ...seed }
  globalThis.wx = {
    getStorageSync(key) {
      return key in values ? values[key] : ''
    },
    setStorageSync(key, value) {
      values[key] = value
    },
    removeStorageSync(key) {
      delete values[key]
    },
    getStorageInfoSync() {
      return { keys: Object.keys(values) }
    },
  }
  return values
}

function utf8Bytes(text) {
  let bytes = 0
  for (const char of Array.from(text)) {
    const code = char.codePointAt(0) ?? 0
    if (code <= 0x7f) {
      bytes += 1
    } else if (code <= 0x7ff) {
      bytes += 2
    } else if (code <= 0xffff) {
      bytes += 3
    } else {
      bytes += 4
    }
  }
  return bytes
}

const ALLOWED_IDS = [
  'unit',
  'percent',
  'fuel',
  'power',
  'resolution',
  'quote',
  'meeting-timer',
  'size-convert',
  'lunar',
  'zh-convert',
  'pinyin',
  'radix',
  'date-format',
  'date-add',
  'timezone',
  'schedule',
  'span',
  'age',
  'countdown',
  'timestamp',
  'rmb',
  'text-convert',
  'template',
  'regex',
  'wordcount',
]

test('草稿读写往返保留模式、输入与时间', async () => {
  installStorageMock()
  const draft = await loadDraft()
  const at = 1760000000000
  assert.equal(draft.saveDraft('unit', { mode: '2', input: { value: '12' } }, at), 'saved')
  const read = draft.readDraft('unit', at + 1000)
  assert.deepEqual(read, { v: 1, mode: '2', input: { value: '12' }, at })
})

test('敏感工具与 draftExcluded 工具不写草稿', async () => {
  const values = installStorageMock()
  const draft = await loadDraft()
  assert.equal(draft.saveDraft('tax', { mode: '', input: { income: '10000' } }), 'skipped')
  assert.equal(draft.saveDraft('worktime', { mode: '', input: { startTime: '09:00' } }), 'skipped')
  assert.equal(values['tbx:draft.tax'], undefined)
  assert.equal(values['tbx:draft.worktime'], undefined)
  assert.equal(draft.readDraft('tax'), null)
})

test('空输入清除旧草稿并返回 empty', async () => {
  const values = installStorageMock()
  const draft = await loadDraft()
  draft.saveDraft('unit', { mode: '0', input: { value: '12' } })
  assert.ok(values['tbx:draft.unit'])
  assert.equal(draft.saveDraft('unit', { mode: '0', input: { value: '' } }), 'empty')
  assert.equal(values['tbx:draft.unit'], undefined)
})

test('超过 4KB 时确定性截断且仍可读', async () => {
  const values = installStorageMock()
  const draft = await loadDraft()
  const input = { text: 'a'.repeat(20000), note: '尾部字段' }
  assert.equal(draft.saveDraft('wordcount', { mode: '', input }), 'saved')
  const raw = values['tbx:draft.wordcount']
  assert.ok(raw)
  assert.ok(utf8Bytes(JSON.stringify(raw)) <= 4096)
  const read = draft.readDraft('wordcount')
  assert.ok(read)
  assert.ok(read.input.text.length > 0)
  assert.ok(read.input.text.length < 20000)
})

test('超过 30 天的草稿读取时删除', async () => {
  const values = installStorageMock()
  const draft = await loadDraft()
  const at = 1760000000000
  draft.saveDraft('unit', { mode: '0', input: { value: '1' } }, at)
  assert.equal(draft.readDraft('unit', at + 31 * DAY), null)
  assert.equal(values['tbx:draft.unit'], undefined)
})

test('最多保留 20 个工具草稿，超限淘汰最旧', async () => {
  const values = installStorageMock()
  const draft = await loadDraft()
  const base = 1760000000000
  ALLOWED_IDS.slice(0, 21).forEach((id, index) => {
    assert.equal(
      draft.saveDraft(id, { mode: '', input: { value: `${index}` } }, base + index),
      'saved',
    )
  })
  const keys = Object.keys(values).filter((key) => key.startsWith('tbx:draft.'))
  assert.equal(keys.length, 20)
  assert.equal(values['tbx:draft.unit'], undefined)
  assert.ok(values[`tbx:draft.${ALLOWED_IDS[1]}`])
  assert.ok(values['tbx:draft.timestamp'])
  const pruned = draft.pruneDrafts(base + 21 * DAY)
  assert.equal(pruned.removed, 0)
  assert.equal(pruned.kept, 20)
  const expired = draft.pruneDrafts(base + 31 * DAY)
  assert.equal(expired.removed, 20)
  assert.equal(expired.kept, 0)
})

test('clearDraft 与 clearAllDrafts 清理草稿键', async () => {
  const values = installStorageMock()
  const draft = await loadDraft()
  draft.saveDraft('unit', { mode: '', input: { value: '1' } })
  draft.saveDraft('rmb', { mode: '', input: { amount: '2' } })
  assert.equal(draft.clearDraft('unit'), true)
  assert.equal(values['tbx:draft.unit'], undefined)
  assert.equal(draft.clearAllDrafts(), 1)
  assert.equal(values['tbx:draft.rmb'], undefined)
})

test('坏数据与版本不符静默丢弃', async () => {
  const values = installStorageMock({
    'tbx:draft.unit': '{bad json',
    'tbx:draft.rmb': { v: 2, mode: '', input: { amount: '1' }, at: Date.now() },
  })
  const draft = await loadDraft()
  assert.equal(draft.readDraft('unit'), null)
  assert.equal(values['tbx:draft.unit'], undefined)
  assert.equal(draft.readDraft('rmb'), null)
  assert.equal(values['tbx:draft.rmb'], undefined)
})

test('清空工具数据会删除动态草稿键，但不碰 gallery', async () => {
  const values = installStorageMock({
    'tbx:draft.unit': { v: 1, mode: '', input: { value: '1' }, at: Date.now() },
    'tbx:recent': ['unit'],
    'gallery.favorites': ['keep'],
  })
  const storage = await loadStorage()
  const removed = storage.clearToolboxData()
  assert.equal(removed, 2)
  assert.equal(values['tbx:draft.unit'], undefined)
  assert.equal(values['tbx:recent'], undefined)
  assert.deepEqual(values['gallery.favorites'], ['keep'])
})

test('35 个接入页均有 collectDraftInput / applyDraftInput，敏感与例外页不接入', async () => {
  const draft = await loadDraft()
  const { TOOLS } = await import(moduleUrl('core/toolbox/registry.ts'))
  const eligible = TOOLS.filter(
    (tool) => tool.sensitive === '' && tool.draftExcluded !== true && tool.id !== 'weather',
  )
  assert.equal(eligible.length, 35)
  for (const tool of eligible) {
    const source = fs.readFileSync(path.join(ROOT, `${tool.route.replace(/^\//, '')}.ts`), 'utf8')
    assert.match(source, /collectDraftInput\s*\(/, `${tool.id} 缺少 collectDraftInput`)
    assert.match(source, /applyDraftInput\s*\(/, `${tool.id} 缺少 applyDraftInput`)
    assert.equal(draft.draftAllowed(tool.id), true)
  }
  const worktime = fs.readFileSync(
    path.join(ROOT, 'subpackages/tools-daily/pages/worktime/index.ts'),
    'utf8',
  )
  assert.doesNotMatch(worktime, /collectDraftInput\s*\(/)
  assert.equal(draft.draftAllowed('worktime'), false)
})

test('外壳：恢复条、延迟检查、保存与拒绝覆盖链路齐全', () => {
  const ts = fs.readFileSync(
    path.join(ROOT, 'components/glass-tool-shell/index.ts'),
    'utf8',
  )
  const wxml = fs.readFileSync(
    path.join(ROOT, 'components/glass-tool-shell/index.wxml'),
    'utf8',
  )
  assert.match(ts, /DRAFT_PROMPT_DELAY\s*=\s*600/)
  assert.match(ts, /scheduleDraftPrompt/)
  assert.match(ts, /checkDraftPrompt/)
  assert.match(ts, /saveDraftFromPage\(/)
  assert.match(ts, /onRun\(\)[\s\S]*saveDraftFromPage\(true\)/)
  assert.match(ts, /pageLifetimes:[\s\S]*hide\(\)[\s\S]*saveDraftFromPage\(false\)/)
  assert.match(ts, /onDraftRestore\(/)
  assert.match(ts, /表单已有内容，已取消恢复/)
  assert.match(ts, /clearDraft\(/)
  assert.match(wxml, /恢复上次输入/)
  assert.match(wxml, /onDraftRestore/)
  assert.match(wxml, /onDraftDismiss/)
})
