/* ==========================================================================
   收藏管理 · 排序与批量操作契约
   - 三种排序：最近收藏 / 名称 / 分类
   - 批量移除、清空与偏好回退
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { registerHooks } = require('node:module')
const { pathToFileURL } = require('node:url')

const ROOT = path.resolve(__dirname, '..')

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

function tool(id, name, category, weight) {
  return {
    id,
    name,
    desc: `${name}描述`,
    category,
    icon: name.slice(0, 1),
    route: `/pages/${id}`,
    keywords: [],
    aliases: [],
    sensitive: '',
    weight,
  }
}

async function loadSort() {
  return import(moduleUrl('core/toolbox/favorites-sort.ts'))
}

function installStorageMock() {
  const values = {}
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
  }
  return values
}

test('排序：最近收藏保持 store 顺序', async () => {
  const { sortFavoriteTools } = await loadSort()
  const tools = [
    tool('c', '测量', 'text', 70),
    tool('a', '阿波罗', 'calc', 90),
    tool('b', '波形', 'date', 60),
  ]
  assert.deepEqual(
    sortFavoriteTools(tools, 'recent').map((item) => item.id),
    ['c', 'a', 'b'],
  )
})

test('排序：名称按中文升序，且不修改原数组', async () => {
  const { sortFavoriteTools } = await loadSort()
  const tools = [
    tool('c', '测量', 'text', 70),
    tool('a', '阿波罗', 'calc', 90),
    tool('b', '波形', 'date', 60),
  ]
  const sorted = sortFavoriteTools(tools, 'name')
  assert.deepEqual(
    sorted.map((item) => item.name),
    ['阿波罗', '波形', '测量'],
  )
  assert.deepEqual(
    tools.map((item) => item.id),
    ['c', 'a', 'b'],
  )
})

test('排序：分类固定顺序，同分类按 weight 降序', async () => {
  const { sortFavoriteTools } = await loadSort()
  const tools = [
    tool('work', '工时', 'work', 50),
    tool('life', '生活', 'life', 50),
    tool('media', '图片', 'media', 50),
    tool('text-low', '低权重文本', 'text', 60),
    tool('text-high', '高权重文本', 'text', 80),
    tool('calc', '计算', 'calc', 40),
    tool('date', '日期', 'date', 50),
  ]
  assert.deepEqual(
    sortFavoriteTools(tools, 'category').map((item) => item.id),
    ['calc', 'date', 'text-high', 'text-low', 'media', 'life', 'work'],
  )
})

test('偏好：非法收藏排序回退最近收藏', async () => {
  const { normalizePreference, DEFAULT_PREFERENCE } = await import(
    moduleUrl('core/stores/preference.ts')
  )
  const snapshot = normalizePreference({ favoriteSort: 'unknown' })
  assert.equal(snapshot.favoriteSort, DEFAULT_PREFERENCE.favoriteSort)
  assert.equal(normalizePreference({ favoriteSort: 'name' }).favoriteSort, 'name')
})

test('Store：批量移除与清空只影响收藏，不触碰最近使用', async () => {
  installStorageMock()
  const { toolboxStore } = await import(moduleUrl('core/toolbox/store.ts'))
  const { TOOL_IDS } = await import(moduleUrl('core/toolbox/registry.ts'))
  const ids = Array.from(TOOL_IDS).slice(0, 3)
  toolboxStore.init()
  toolboxStore.favorites = []
  toolboxStore.recents = []
  ids.forEach((id) => toolboxStore.toggleFavorite(id))
  toolboxStore.recordRecent(ids[0])
  assert.equal(toolboxStore.favorites.length, 3)

  assert.equal(toolboxStore.removeFavorites([ids[0], ids[1]]), true)
  assert.deepEqual(toolboxStore.favorites, [ids[2]])
  assert.equal(toolboxStore.recents[0], ids[0])

  assert.equal(toolboxStore.clearFavorites(), true)
  assert.deepEqual(toolboxStore.favorites, [])
  delete globalThis.wx
})

test('收藏页：三排序、多选、清空确认入口齐全', () => {
  const wxml = fs.readFileSync(path.join(ROOT, 'pages/favorites/index.wxml'), 'utf8')
  const ts = fs.readFileSync(path.join(ROOT, 'pages/favorites/index.ts'), 'utf8')
  const json = fs.readFileSync(path.join(ROOT, 'pages/favorites/index.json'), 'utf8')

  assert.match(wxml, /bindtap="onSort"/)
  assert.match(wxml, /bindtap="onToggleManage"/)
  assert.match(wxml, /bindtap="onSelectAll"/)
  assert.match(wxml, /bindtap="onRemoveSelected"/)
  assert.match(wxml, /bindtap="onAskClear"/)
  assert.match(wxml, /glass-modal/)
  assert.match(wxml, /bind:confirm="onConfirmClear"/)
  assert.match(ts, /setFavoriteSort/)
  assert.match(json, /glass-modal/)
})

test('Store：第 101 个收藏返回 full，不挤出旧项', async () => {
  installStorageMock()
  const { toolboxStore } = await import(moduleUrl('core/toolbox/store.ts'))
  const { TOOL_IDS } = await import(moduleUrl('core/toolbox/registry.ts'))
  const fakes = Array.from({ length: 101 }, (_, index) => `fake-favorite-${index}`)
  fakes.forEach((id) => TOOL_IDS.add(id))
  toolboxStore.inited = true
  toolboxStore.favorites = fakes.slice(0, 100)
  try {
    assert.equal(toolboxStore.toggleFavorite(fakes[100]), 'full')
    assert.equal(toolboxStore.favorites.length, 100)
    assert.equal(toolboxStore.favorites[0], fakes[0])
  } finally {
    fakes.forEach((id) => TOOL_IDS.delete(id))
    toolboxStore.favorites = []
    delete globalThis.wx
  }
})
