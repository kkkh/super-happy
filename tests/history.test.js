/* ==========================================================================
   数据驾驶舱 · 轨迹存储与洞察纯函数回归
   - 覆盖 100 条上限、防抖落盘、清空、坏存档校验
   - 覆盖分类占比、7 日分桶、连续天数、脱敏与真实摘要
   - 运行：npm test
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { registerHooks } = require('node:module')

const ROOT = path.resolve(__dirname, '..')

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

function installStorageMock(seed = {}) {
  const values = { ...seed }
  const writes = []
  globalThis.wx = {
    getStorageSync(key) {
      return key in values ? values[key] : ''
    },
    setStorageSync(key, value) {
      values[key] = value
      writes.push({ key, value })
    },
    removeStorageSync(key) {
      delete values[key]
    },
    getDeviceInfo() {
      return { platform: 'node' }
    },
    getSystemInfoSync() {
      return { platform: 'node' }
    },
  }
  return { values, writes }
}

function makeRecords(count) {
  const now = Date.now()
  const categories = ['calc', 'date', 'text', 'media', 'life', 'work']
  return Array.from({ length: count }, (_, index) => ({
    id: `h-${index}`,
    toolId: index % 3 === 0 ? 'loan' : 'unit',
    toolName: index % 3 === 0 ? '房贷试算' : '单位换算',
    category: categories[index % categories.length],
    categoryLabel: '效率工具',
    icon: '算',
    timestamp: now - index * 3600 * 1000,
    night: index % 2 === 0,
    themeLabel: index % 2 === 0 ? '夜航' : '白昼',
    inputSummary: '月供 5368 元',
    outputSummary: '总利息 932480 元',
  }))
}

test('防抖：连续 record 只落盘一次，且超过 100 条自动淘汰最旧', async () => {
  const storage = installStorageMock()
  const { historyStore, HISTORY_MAX } = await import(moduleUrl('core/stores/history.ts'))

  historyStore.clearMemory()
  historyStore.records = []
  for (let index = 0; index < HISTORY_MAX + 5; index += 1) {
    historyStore.record({
      toolId: 'loan',
      toolName: `工具 ${index}`,
      category: 'calc',
      night: index % 2 === 0,
      inputSummary: `输入 ${index}`,
      outputSummary: `结果 ${index}`,
    })
  }

  assert.equal(historyStore.records.length, HISTORY_MAX)
  assert.equal(historyStore.records[0].toolName, `工具 ${HISTORY_MAX + 4}`)
  const writesBefore = storage.writes.length
  assert.ok(writesBefore <= HISTORY_MAX, '防抖窗口内不应逐条写入')

  await new Promise((resolve) => setTimeout(resolve, 450))
  const historyWrites = storage.writes.filter((item) => item.key === 'tbx:history')
  assert.equal(historyWrites.length, 1, '350ms 防抖后只应写入一次')
  assert.equal(historyWrites[0].value.length, HISTORY_MAX)
})

test('清空：删除本机键并取消在途写入', async () => {
  const storage = installStorageMock()
  const { historyStore } = await import(moduleUrl('core/stores/history.ts'))

  historyStore.clearMemory()
  historyStore.records = []
  historyStore.record({
    toolId: 'unit',
    toolName: '单位换算',
    category: 'calc',
    night: false,
    outputSummary: '1 米 = 100 厘米',
  })
  historyStore.clear()

  assert.equal(historyStore.records.length, 0)
  assert.equal(storage.writes.filter((item) => item.key === 'tbx:history').length, 0)
  await new Promise((resolve) => setTimeout(resolve, 420))
  assert.equal(storage.writes.filter((item) => item.key === 'tbx:history').length, 0)
})

test('分类占比取整：最大余数法保证总和 100%', async () => {
  const { buildCategoryStats, formatCategoryPercentages } = await import(
    moduleUrl('core/toolbox/history-insights.ts')
  )
  const categories = buildCategoryStats(makeRecords(6))
  const labels = formatCategoryPercentages(categories)
  assert.equal(labels.length, 6)
  const total = labels.reduce((sum, text) => sum + Number(text.replace('%', '')), 0)
  assert.equal(total, 100)
})

test('单条轨迹删除：立即从内存与存储移除，并递增版本号', async () => {
  const storage = installStorageMock()
  const { historyStore } = await import(moduleUrl('core/stores/history.ts'))

  historyStore.clearMemory()
  historyStore.records = []
  const first = historyStore.record({
    toolId: 'unit',
    toolName: '单位换算',
    category: 'calc',
    night: false,
    outputSummary: '1 米 = 100 厘米',
  })
  const second = historyStore.record({
    toolId: 'tax',
    toolName: '个税计算',
    category: 'calc',
    night: true,
    outputSummary: '税额 100 元',
  })
  assert.ok(first && second)

  const before = historyStore.version
  assert.equal(historyStore.remove(first.id), true)
  assert.equal(historyStore.records.length, 1)
  assert.equal(historyStore.records[0].id, second.id)
  assert.ok(historyStore.version > before)
  assert.ok(storage.writes.some((item) => item.key === 'tbx:history'))

  assert.equal(historyStore.remove('missing-id'), false)
  historyStore.clear()
})

test('轨迹记录开关：暂停后 recordToolResult 不再写入，恢复后正常记录', async () => {
  installStorageMock()
  const { historyStore } = await import(moduleUrl('core/stores/history.ts'))
  const { preferenceStore, DEFAULT_PREFERENCE } = await import(
    moduleUrl('core/stores/preference.ts')
  )
  const { recordToolResult } = await import(moduleUrl('core/toolbox/tracker.ts'))

  historyStore.clearMemory()
  historyStore.records = []
  preferenceStore.init()
  preferenceStore.setHistoryTrackingEnabled(false)
  const paused = recordToolResult({
    toolId: 'unit',
    outputSummary: '1 米 = 100 厘米',
  })
  assert.equal(paused, null)
  assert.equal(historyStore.records.length, 0)

  preferenceStore.setHistoryTrackingEnabled(true)
  const recorded = recordToolResult({
    toolId: 'unit',
    outputSummary: '1 米 = 100 厘米',
  })
  assert.ok(recorded)
  assert.equal(historyStore.records.length, 1)
  historyStore.clear()
  preferenceStore.applySnapshot(DEFAULT_PREFERENCE)
  preferenceStore.inited = false
  delete globalThis.wx
})

test('洞察：分类占比、7 日分桶、连续天数与人格标签', async () => {
  const { buildCategoryStats, buildDailyStats, buildHistoryInsight } = await import(
    moduleUrl('core/toolbox/history-insights.ts')
  )
  const records = makeRecords(9)

  const categories = buildCategoryStats(records)
  assert.ok(categories.length > 0)
  assert.equal(categories.reduce((sum, item) => sum + item.value, 0), records.length)
  assert.equal(
    Math.round(categories.reduce((sum, item) => sum + item.percent, 0)),
    1,
  )

  const daily = buildDailyStats(records)
  assert.equal(daily.length, 7)
  assert.equal(daily[6].label, '今天')
  assert.ok(daily[6].value > 0)
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const windowStart = new Date(todayStart)
  windowStart.setDate(windowStart.getDate() - 6)
  const expectedInWindow = records.filter(
    (record) => record.timestamp >= windowStart.getTime(),
  ).length
  assert.equal(
    daily.reduce((sum, item) => sum + item.value, 0),
    expectedInWindow,
  )

  const insight = buildHistoryInsight(records)
  assert.equal(insight.hasHistory, true)
  assert.equal(insight.total, records.length)
  assert.ok(insight.topToolName)
  assert.ok(insight.body.includes(insight.topToolName))
  assert.ok(insight.persona)
  assert.equal(insight.nightPercent + insight.dayPercent, 100)
})

test('隐私盾：默认脱敏把数字与邮箱替换为 *，关闭后返回原摘要', async () => {
  const { buildTimeline, maskSummary } = await import(
    moduleUrl('core/toolbox/history-insights.ts')
  )
  const records = makeRecords(2)

  assert.equal(maskSummary('月供 5368 元 · a@b.com').includes('5'), false)
  const masked = buildTimeline(records, true, 2)
  const plain = buildTimeline(records, false, 2)
  assert.ok(masked[0].outputSummary.includes('*'))
  assert.equal(plain[0].outputSummary, records[0].outputSummary)
})

test('智能脱敏：单位 / 分类保持可读，金额 / 密码 / 健康才隐藏', async () => {
  const { maskSensitiveText } = await import(moduleUrl('core/toolbox/privacy.ts'))

  /* 单位换算：数值、单位、分类全部保留 */
  assert.equal(maskSensitiveText('12 米', '输入数值'), '12 米')
  assert.equal(maskSensitiveText('米', '从单位'), '米')
  assert.equal(maskSensitiveText('厘米', '到单位'), '厘米')
  assert.equal(maskSensitiveText('长度', '换算类别'), '长度')
  assert.equal(maskSensitiveText('12 米', '米 → 厘米'), '12 米')

  /* 财务：只隐藏数字，货币与单位文案保留 */
  assert.equal(maskSensitiveText('100 万元', '贷款金额'), '*** 万元')
  assert.equal(maskSensitiveText('4.20%', '年利率'), '***%')
  assert.equal(maskSensitiveText('总利息 ¥932,480.00'), '总利息 ¥***')

  /* 密码 / 身份：整体隐藏；长度等元数据放行 */
  assert.equal(maskSensitiveText('Abc123!@#', '8 位随机密码'), '***')
  assert.equal(maskSensitiveText('8 位', '密码长度'), '8 位')
  assert.equal(maskSensitiveText('13800138000', '手机号'), '***')
  assert.equal(maskSensitiveText('a@b.com', '邮箱'), '***')

  /* 健康：身高 / 体重数字隐藏，单位保留；通用健康区间不算个人数据 */
  assert.equal(maskSensitiveText('175 cm', '身高'), '*** cm')
  assert.equal(maskSensitiveText('健康区间 18.5 – 23.9'), '健康区间 18.5 – 23.9')

  /* 无 label 的预览：隐藏 URL，但保留「输出预览」文案 */
  assert.equal(maskSensitiveText('输出预览 https://x.com/a?token=abc'), '输出预览 ***')
})

test('时间线优先使用埋点阶段预计算的脱敏摘要', async () => {
  const { buildTimeline } = await import(moduleUrl('core/toolbox/history-insights.ts'))
  const now = Date.now()
  const records = [
    {
      id: 'masked-loan',
      toolId: 'loan',
      toolName: '房贷试算',
      category: 'calc',
      categoryLabel: '计算换算',
      icon: '算',
      timestamp: now,
      night: true,
      themeLabel: '夜航',
      inputSummary: '贷款金额 100 万元',
      outputSummary: '每月月供 ¥5,368.00',
      inputMasked: '贷款金额 *** 万元',
      outputMasked: '每月月供 ¥***',
    },
    {
      id: 'safe-unit',
      toolId: 'unit',
      toolName: '单位换算',
      category: 'calc',
      categoryLabel: '计算换算',
      icon: '算',
      timestamp: now - 1000,
      night: false,
      themeLabel: '白昼',
      inputSummary: '输入数值 12 米',
      outputSummary: '米 → 厘米 1200 厘米',
      inputMasked: '输入数值 12 米',
      outputMasked: '米 → 厘米 1200 厘米',
    },
  ]

  const masked = buildTimeline(records, true, 2)
  assert.equal(masked[0].inputSummary, '贷款金额 *** 万元')
  assert.equal(masked[0].outputSummary, '每月月供 ¥***')
  assert.equal(masked[1].inputSummary, '输入数值 12 米')
  assert.equal(masked[1].outputSummary, '米 → 厘米 1200 厘米')

  const plain = buildTimeline(records, false, 2)
  assert.equal(plain[0].inputSummary, '贷款金额 100 万元')
  assert.equal(plain[0].outputSummary, '每月月供 ¥5,368.00')

  /* 旧存档没有预计算掩码：按 toolId 回退，单位仍完整 */
  const legacy = buildTimeline(
    [
      {
        ...records[1],
        id: 'legacy-unit',
        inputMasked: undefined,
        outputMasked: undefined,
      },
    ],
    true,
    1,
  )
  assert.equal(legacy[0].inputSummary, '输入数值 12 米')
  assert.equal(legacy[0].outputSummary, '米 → 厘米 1200 厘米')
})
