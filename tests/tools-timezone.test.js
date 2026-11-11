/* ==========================================================================
   批 2 · 时区换算（timezone）
   - 引擎：+8→0、+5:30、跨日 / 跨年、手动夏令时、非法输入
   - 契约：页面 / 注册 / 帮助 / jump 工作流 / 适配器 / 包体清单
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { registerHooks } = require('node:module')

const ROOT = path.resolve(__dirname, '..')
const URL_ROOT = `${require('node:url').pathToFileURL(ROOT).href}/`
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !path.extname(specifier)) {
      return nextResolve(`${specifier}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})

async function loadEngine() {
  return import(`${URL_ROOT}core/toolbox/engines/timezone.ts`)
}

function zone(engine, id) {
  const found = engine.findZone(id)
  assert.ok(found, `缺少时区 ${id}`)
  return found
}

test('时区：北京 +8 → 伦敦 0，同一墙钟日', async () => {
  const engine = await loadEngine()
  const result = engine.convertZone({
    date: '2026-01-01',
    time: '10:00',
    source: zone(engine, 'beijing'),
    target: zone(engine, 'london'),
  })
  assert.ok(result)
  assert.equal(result.targetDateTime, '2026-01-01 02:00')
  assert.equal(result.targetWeekday, '周四')
  assert.equal(result.diffMinutes, -480)
  assert.equal(result.diffLabel, '-8 小时')
  assert.equal(result.crossDay, false)
})

test('时区：新德里 +5:30 → 北京 +8，半小时偏移', async () => {
  const engine = await loadEngine()
  const result = engine.convertZone({
    date: '2026-01-01',
    time: '10:00',
    source: zone(engine, 'delhi'),
    target: zone(engine, 'beijing'),
  })
  assert.ok(result)
  assert.equal(result.sourceOffsetLabel, 'UTC+5:30')
  assert.equal(result.targetTime, '12:30')
  assert.equal(result.diffLabel, '+2 小时 30 分')
})

test('时区：跨日与跨年正确标记', async () => {
  const engine = await loadEngine()
  const result = engine.convertZone({
    date: '2026-01-01',
    time: '01:00',
    source: zone(engine, 'beijing'),
    target: zone(engine, 'london'),
  })
  assert.ok(result)
  assert.equal(result.targetDateTime, '2025-12-31 17:00')
  assert.equal(result.crossDay, true)
  assert.equal(result.crossYear, true)
  assert.match(engine.timezoneSummaryText(result), /跨日/)
})

test('时区：源 / 目标手动夏令时各 +60 分钟', async () => {
  const engine = await loadEngine()
  const london = zone(engine, 'london')
  const beijing = zone(engine, 'beijing')
  const base = engine.convertZone({
    date: '2026-07-01',
    time: '10:00',
    source: london,
    target: beijing,
  })
  const sourceDst = engine.convertZone({
    date: '2026-07-01',
    time: '10:00',
    source: london,
    target: beijing,
    sourceDst: true,
  })
  const targetDst = engine.convertZone({
    date: '2026-07-01',
    time: '10:00',
    source: london,
    target: beijing,
    targetDst: true,
  })
  assert.ok(base && sourceDst && targetDst)
  assert.equal(base.targetTime, '18:00')
  assert.equal(sourceDst.targetTime, '17:00')
  assert.equal(sourceDst.diffLabel, '+7 小时')
  assert.equal(targetDst.targetTime, '19:00')
  assert.equal(targetDst.diffLabel, '+9 小时')
  assert.equal(engine.offsetLabel(330), 'UTC+5:30')
  assert.equal(engine.offsetLabel(-210), 'UTC-3:30')
})

test('时区：非法日期 / 时间返回 null', async () => {
  const engine = await loadEngine()
  const beijing = zone(engine, 'beijing')
  assert.equal(
    engine.convertZone({ date: '2026-02-30', time: '10:00', source: beijing, target: beijing }),
    null,
  )
  assert.equal(
    engine.convertZone({ date: '2026-01-01', time: '24:00', source: beijing, target: beijing }),
    null,
  )
})

test('世界时钟：北京基准同屏多城，日期与星期同步', async () => {
  const engine = await loadEngine()
  const rows = engine.worldClock({
    date: '2026-01-01',
    time: '10:00',
    source: zone(engine, 'beijing'),
    zones: [zone(engine, 'tokyo'), zone(engine, 'london'), zone(engine, 'new-york')],
  })
  assert.ok(rows)
  assert.equal(rows.length, 4)
  assert.equal(rows[0].isSource, true)
  assert.equal(rows[0].label, '北京')
  assert.equal(rows[0].time, '10:00')
  assert.equal(rows[0].diffLabel, '0 小时')

  const tokyo = rows.find((row) => row.id === 'tokyo')
  const london = rows.find((row) => row.id === 'london')
  const newYork = rows.find((row) => row.id === 'new-york')
  assert.equal(tokyo.time, '11:00')
  assert.equal(tokyo.weekday, '周四')
  assert.equal(london.time, '02:00')
  assert.equal(london.offsetLabel, 'UTC+0')
  assert.equal(london.diffLabel, '-8 小时')
  assert.equal(london.dayOffset, 0)
  assert.equal(london.crossDay, false)
  assert.equal(newYork.date, '2025-12-31')
  assert.equal(newYork.time, '21:00')
  assert.equal(newYork.weekday, '周三')
  assert.equal(newYork.dayOffset, -1)
  assert.equal(newYork.dayOffsetLabel, '早 1 天')
  assert.equal(newYork.crossDay, true)
  assert.equal(newYork.diffLabel, '-13 小时')
})

test('世界时钟：半小时偏移与逐城夏令时', async () => {
  const engine = await loadEngine()
  const beijing = zone(engine, 'beijing')
  const delhi = zone(engine, 'delhi')
  const london = zone(engine, 'london')

  const halfHour = engine.worldClock({
    date: '2026-01-01',
    time: '10:00',
    source: beijing,
    zones: [delhi],
  })
  assert.ok(halfHour)
  assert.equal(halfHour[1].time, '07:30')
  assert.equal(halfHour[1].diffLabel, '-2 小时 30 分')

  const dst = engine.worldClock({
    date: '2026-07-01',
    time: '10:00',
    source: london,
    zones: [beijing],
    dstIds: ['beijing'],
  })
  assert.ok(dst)
  assert.equal(dst[0].dst, false)
  assert.equal(dst[1].dst, true)
  assert.equal(dst[1].time, '19:00')
  assert.equal(dst[1].diffLabel, '+9 小时')

  const sourceDst = engine.worldClock({
    date: '2026-07-01',
    time: '10:00',
    source: london,
    sourceDst: true,
    zones: [beijing],
  })
  assert.ok(sourceDst)
  assert.equal(sourceDst[0].dst, true)
  assert.equal(sourceDst[1].time, '17:00')
  assert.equal(sourceDst[1].diffLabel, '+7 小时')

  const summary = engine.worldClockSummaryText(dst)
  assert.match(summary, /伦敦/)
  assert.match(summary, /（基准）/)
  assert.match(summary, /北京/)
  assert.match(summary, /夏令时/)
})

test('世界时钟：重复城市去重，非法输入返回 null', async () => {
  const engine = await loadEngine()
  const beijing = zone(engine, 'beijing')
  const rows = engine.worldClock({
    date: '2026-01-01',
    time: '10:00',
    source: beijing,
    zones: [beijing, beijing],
  })
  assert.ok(rows)
  assert.equal(rows.length, 1)

  assert.equal(
    engine.worldClock({ date: '2026-02-30', time: '10:00', source: beijing, zones: [] }),
    null,
  )
  assert.equal(
    engine.worldClock({ date: '2026-01-01', time: '24:00', source: beijing, zones: [] }),
    null,
  )
})

test('时区契约：页面 / 注册 / 帮助 / jump 工作流 / 适配器 / 包体清单', async () => {
  const app = JSON.parse(read('app.json'))
  const core = app.subpackages.find((item) => item.root === 'subpackages/tools-core')
  assert.ok(core.pages.includes('pages/timezone/index'), 'app.json 未注册页面')

  for (const ext of ['.ts', '.json', '.wxml', '.wxss']) {
    assert.ok(
      fs.existsSync(path.join(ROOT, `subpackages/tools-core/pages/timezone/index${ext}`)),
      `缺少页面文件 ${ext}`,
    )
  }
  assert.ok(
    fs.existsSync(path.join(ROOT, 'subpackages/tools-core/lib/timezone.ts')),
    '缺少 tools-core 薄 re-export',
  )

  const wxml = read('subpackages/tools-core/pages/timezone/index.wxml')
  assert.match(wxml, /tool-id="timezone"/)
  assert.match(wxml, /bindchange="onSourceChange"/)
  assert.match(wxml, /bindchange="onTargetChange"/)
  assert.match(wxml, /bindchange="onToggle"/)
  assert.match(wxml, /poster-data="\{\{posterData\}\}"/)
  assert.match(wxml, /bindtap="onCopy"/)

  const ts = read('subpackages/tools-core/pages/timezone/index.ts')
  assert.match(ts, /onShareAppMessage\s*\(/)
  assert.match(ts, /onShareTimeline\s*\(/)
  assert.match(ts, /convertZone/)
  assert.match(ts, /onReceiveWorkflow\s*\(/)
  assert.equal(/new Date\(Date\.UTC/.test(ts), false, '页面不得自行做时区换算')
  assert.equal(/wx\.request|uploadFile|downloadFile/.test(ts), false)

  const registry = read('core/toolbox/registry.ts')
  assert.match(registry, /id: 'timezone'/)
  assert.match(registry, /weight: 81/)
  assert.match(read('subpackages/grow/lib/help.ts'), /timezone: \{/)
  assert.match(read('scripts/check-budget.js'), /pages\/timezone/)
  assert.match(read('scripts/e2e-tools.js'), /id: 'timezone'/)

  const config = await import(`${URL_ROOT}core/workflow/workflowConfig.ts`)
  assert.equal(config.WORKFLOW_ROUTING.timezone, 'jump')
  assert.deepEqual(config.WORKFLOW_ACCEPTS.timezone, ['text'])

  const source = await import(`${URL_ROOT}core/workflow/workflowSource.ts`)
  assert.deepEqual(source.WORKFLOW_SOURCE_KEYS.timezone.text, ['timezoneSummary'])

  const adapters = await import(`${URL_ROOT}core/workflow/workflowAdapters.ts`)
  assert.ok(adapters.getWorkflowAdapter('timezone'), '缺少 timezone 跳转适配器')

  const lib = read('subpackages/tools-core/lib/timezone.ts')
  assert.match(lib, /worldClock/)
  assert.match(lib, /WORLD_CLOCK_CITY_IDS/)

  const engine = await loadEngine()
  assert.equal(engine.WORLD_CLOCK_MAX_CITIES, 8)
  assert.equal(engine.WORLD_CLOCK_CITY_IDS.length, 8)
  assert.ok(engine.WORLD_CLOCK_CITY_IDS.includes('beijing'))

  const worldWxml = read('subpackages/tools-core/pages/timezone/index.wxml')
  assert.match(worldWxml, /data-mode="world"/)
  assert.match(worldWxml, /onWorldDst/)
  assert.match(worldWxml, /worldRows/)

  const worldTs = read('subpackages/tools-core/pages/timezone/index.ts')
  assert.match(worldTs, /runWorldClock/)
  assert.match(worldTs, /worldClock\(\{/)
  assert.match(worldTs, /WORLD_CLOCK_CITY_IDS/)
  assert.match(worldTs, /mode: 'convert'/)
  assert.match(read('subpackages/grow/lib/help.ts'), /世界时钟/)
  assert.match(registry, /世界时钟同屏/)
})
