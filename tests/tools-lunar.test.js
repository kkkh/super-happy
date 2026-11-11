/* ==========================================================================
   批 2 · 农历与节气（lunar）
   - 引擎：2026 春节、2023 闰二月、2020 立春、1900/2100 边界、传统节日
   - 契约：tools-dict 分包 / 页面 / 注册 / 帮助 / 文本工作流 / 适配器 / 许可
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

async function loadLunar() {
  return import(`${URL_ROOT}subpackages/tools-dict/lib/lunar.ts`)
}

test('农历：2026 春节与生肖', async () => {
  const lunar = await loadLunar()
  const info = lunar.toLunar(2026, 2, 17)
  assert.ok(info)
  assert.equal(info.year, 2026)
  assert.equal(info.month, 1)
  assert.equal(info.day, 1)
  assert.equal(info.isLeap, false)
  assert.equal(info.animal, '马')
  assert.deepEqual(info.festivals, ['春节'])
  assert.match(info.lunarText, /正月初一$/)
  assert.match(info.summary, /春节/)
})

test('农历：2023 闰二月', async () => {
  const lunar = await loadLunar()
  const info = lunar.toLunar(2023, 3, 22)
  assert.ok(info)
  assert.equal(info.month, 2)
  assert.equal(info.day, 1)
  assert.equal(info.isLeap, true)
  assert.equal(info.monthCn, '闰二月')
  assert.deepEqual(info.festivals, [])
})

test('农历：2020 立春与下一节气', async () => {
  const lunar = await loadLunar()
  const termDay = lunar.toLunar(2020, 2, 4)
  assert.ok(termDay)
  assert.equal(termDay.solarTerm, '立春')
  assert.equal(termDay.solarTermToday, true)
  assert.equal(termDay.daysToSolarTerm, 0)

  const next = lunar.toLunar(2020, 2, 5)
  assert.ok(next)
  assert.equal(next.solarTerm, '雨水')
  assert.equal(next.solarTermToday, false)
  assert.equal(next.daysToSolarTerm, 14)
})

test('农历：1900 / 2100 边界与非法日期', async () => {
  const lunar = await loadLunar()
  assert.equal(lunar.toLunar(1900, 1, 30), null)
  const min = lunar.toLunar(1900, 1, 31)
  assert.ok(min)
  assert.equal(min.month, 1)
  assert.equal(min.day, 1)

  const max = lunar.toLunar(2100, 12, 31)
  assert.ok(max)
  assert.equal(max.year, 2100)
  assert.equal(max.month, 12)
  assert.equal(max.day, 1)
  assert.equal(lunar.toLunar(2101, 1, 1), null)
  assert.equal(lunar.toLunar(2026, 2, 30), null)
})

test('农历：传统节日只认非闰月', async () => {
  const lunar = await loadLunar()
  assert.deepEqual(lunar.lunarFestival(1, 15), ['元宵'])
  assert.deepEqual(lunar.lunarFestival(5, 5), ['端午'])
  assert.deepEqual(lunar.lunarFestival(8, 15), ['中秋'])
  assert.deepEqual(lunar.lunarFestival(9, 9), ['重阳'])
  assert.deepEqual(lunar.lunarFestival(1, 1, true), [])
  assert.deepEqual(lunar.lunarFestival(3, 3), [])
})

test('农历：工作流日期解析', async () => {
  const lunar = await loadLunar()
  assert.deepEqual(lunar.parseLunarDate('2026-02-17'), { year: 2026, month: 2, day: 17 })
  assert.deepEqual(lunar.parseLunarDate('2026/2/17'), { year: 2026, month: 2, day: 17 })
  assert.deepEqual(lunar.parseLunarDate('2026年2月17日'), { year: 2026, month: 2, day: 17 })
  assert.deepEqual(lunar.parseLunarDate('20260217'), { year: 2026, month: 2, day: 17 })
  assert.equal(lunar.parseLunarDate('不是日期'), null)
  assert.equal(lunar.parseLunarDate('1899-12-31'), null)
})

test('农历生日：公历生日 → 农历生日与下次倒计时', async () => {
  const lunar = await loadLunar()
  const info = lunar.lunarBirthday(1995, 6, 15, { year: 2026, month: 2, day: 17 })
  assert.ok(info)
  assert.equal(info.birthDateText, '1995-06-15')
  assert.equal(info.monthCn, '五月')
  assert.equal(info.dayCn, '十八')
  assert.equal(info.animal, '猪')
  assert.equal(info.nextSolarDate, '2026-07-02')
  assert.equal(info.nextWeekday, '周四')
  assert.equal(info.daysUntil, 135)
  assert.equal(info.isToday, false)
  assert.equal(info.birthdayCount, 32)
  assert.deepEqual(info.notes, [])
  assert.match(info.summary, /下次农历生日 2026-07-02/)
})

test('农历生日：今天生日与跨年倒计时', async () => {
  const lunar = await loadLunar()
  const today = lunar.lunarBirthday(2020, 1, 25, { year: 2026, month: 2, day: 17 })
  assert.ok(today)
  assert.equal(today.daysUntil, 0)
  assert.equal(today.isToday, true)
  assert.equal(today.nextSolarDate, '2026-02-17')
  assert.equal(today.birthdayCount, 7)
  assert.match(today.summary, /今天就是农历生日/)

  const next = lunar.lunarBirthday(2020, 1, 25, { year: 2026, month: 2, day: 18 })
  assert.ok(next)
  assert.equal(next.nextSolarDate, '2027-02-06')
  assert.equal(next.nextWeekday, '周六')
  assert.equal(next.daysUntil, 353)
  assert.equal(next.isToday, false)
  assert.equal(next.birthdayCount, 8)
})

test('农历生日：闰月出生按同月非闰月计算', async () => {
  const lunar = await loadLunar()
  const info = lunar.lunarBirthday(2023, 3, 22, { year: 2024, month: 1, day: 1 })
  assert.ok(info)
  assert.equal(info.isLeapBirth, true)
  assert.equal(info.monthCn, '闰二月')
  assert.equal(info.nextSolarDate, '2024-03-10')
  assert.equal(info.daysUntil, 69)
  assert.equal(info.birthdayCount, 2)
  assert.ok(info.notes.includes('闰月生日按同月非闰月计算'))
})

test('农历生日：超出词库范围返回 null', async () => {
  const lunar = await loadLunar()
  assert.equal(lunar.lunarBirthday(2101, 1, 1, { year: 2026, month: 2, day: 17 }), null)
  assert.equal(lunar.lunarBirthday(1995, 6, 15, { year: 2101, month: 1, day: 1 }), null)
})

test('农历契约：tools-dict 分包 / 页面 / 注册 / 帮助 / 文本工作流 / 适配器 / 许可', async () => {
  const app = JSON.parse(read('app.json'))
  const dict = app.subpackages.find((item) => item.root === 'subpackages/tools-dict')
  assert.ok(dict, 'app.json 缺少 tools-dict 分包')
  assert.ok(dict.pages.includes('pages/lunar/index'), 'tools-dict 未注册 lunar 页面')

  for (const ext of ['.ts', '.json', '.wxml', '.wxss']) {
    assert.ok(
      fs.existsSync(path.join(ROOT, `subpackages/tools-dict/pages/lunar/index${ext}`)),
      `缺少页面文件 ${ext}`,
    )
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'subpackages/tools-dict/lib/lunar.ts')))
  assert.ok(fs.existsSync(path.join(ROOT, 'subpackages/tools-dict/lib/lunar-data.ts')))

  const data = read('subpackages/tools-dict/lib/lunar-data.ts')
  assert.match(data, /solarlunar 3\.1\.0/)
  assert.match(data, /ISC License/)
  assert.match(data, /export \{ solarLunar as default \}/)

  const wxml = read('subpackages/tools-dict/pages/lunar/index.wxml')
  assert.match(wxml, /tool-id="lunar"/)
  assert.match(wxml, /mode="date"/)
  assert.match(wxml, /bindchange="onDateChange"/)
  assert.match(wxml, /bind:tap="onCopy"/)

  const ts = read('subpackages/tools-dict/pages/lunar/index.ts')
  assert.match(ts, /onShareAppMessage\s*\(/)
  assert.match(ts, /onShareTimeline\s*\(/)
  assert.match(ts, /toLunar/)
  assert.match(ts, /onReceiveWorkflow/)
  assert.equal(/wx\.request|uploadFile|downloadFile/.test(ts), false, '不得联网')

  const registry = read('core/toolbox/registry.ts')
  assert.match(registry, /id: 'lunar'/)
  assert.match(registry, /weight: 84/)
  assert.match(registry, /subpackages\/tools-dict\/pages\/lunar\/index/)
  assert.match(read('subpackages/grow/lib/help.ts'), /lunar: \{/)
  assert.match(read('scripts/check-budget.js'), /pages\/lunar/)
  assert.match(read('scripts/e2e-tools.js'), /id: 'lunar'/)
  assert.match(read('pages/legal/index.wxml'), /solarlunar 3\.1\.0/)

  const config = await import(`${URL_ROOT}core/workflow/workflowConfig.ts`)
  assert.equal(config.WORKFLOW_ROUTING.lunar, 'jump')
  assert.deepEqual(config.WORKFLOW_ACCEPTS.lunar, ['text'])

  const source = await import(`${URL_ROOT}core/workflow/workflowSource.ts`)
  assert.deepEqual(source.WORKFLOW_SOURCE_KEYS.lunar.text, ['lunarSummary'])

  const adapters = await import(`${URL_ROOT}core/workflow/workflowAdapters.ts`)
  assert.ok(adapters.getWorkflowAdapter('lunar'), '缺少 lunar 文本适配器')

  assert.match(wxml, /data-mode="birthday"/)
  assert.match(wxml, /bindchange="onBirthDateChange"/)
  assert.match(wxml, /bind:run="onRun"/)
  assert.match(wxml, /can-run=/)
  assert.match(wxml, /birthdayRows/)

  assert.match(ts, /lunarBirthday/)
  assert.match(ts, /computeBirthday/)
  assert.match(ts, /birthdaySummary/)
  assert.match(read('subpackages/grow/lib/help.ts'), /农历生日/)
})
