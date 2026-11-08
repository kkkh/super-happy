/* ==========================================================================
   数据驾驶舱 · 页面级静态回归
   - 隐私 / 清空 / 单条删除 / 分批时间线 / 可重试图表 / 无障碍契约
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')

test('驾驶舱：隐私、分批、删除、双清除入口与无障碍契约完整', () => {
  const ts = read('subpackages/grow/pages/cockpit/index.ts')
  const wxml = read('subpackages/grow/pages/cockpit/index.wxml')
  const wxss = read('subpackages/grow/pages/cockpit/index.wxss')
  const json = read('subpackages/grow/pages/cockpit/index.json')

  assert.ok(ts.includes('const TIMELINE_BATCH = 24'))
  assert.ok(ts.includes('timelineVisible'))
  assert.ok(ts.includes('runtime.dirty = true'))
  assert.ok(ts.includes('onToggleTracking'))
  assert.ok(ts.includes('setHistoryTrackingEnabled'))
  assert.ok(ts.includes('historyStore.remove'))
  assert.ok(ts.includes('purgeHistoryRecordFromSnapshots'))
  assert.ok(ts.includes('purgeHistoryFromSnapshots'))
  assert.ok(ts.includes('onOpenSnapshotClear'))
  assert.ok(ts.includes('onRetryCharts'))
  assert.ok(ts.includes('donutAria'))
  assert.ok(ts.includes('dailyAria'))
  assert.ok(ts.includes('storageWarning'))
  assert.ok(ts.includes('this.setData({ masked: true }, () => this.rebuildTimeline())'))

  assert.ok(wxml.includes('cockpit-tracking'))
  assert.ok(wxml.includes('bind:change="onToggleTracking"'))
  assert.ok(wxml.includes('onOpenSnapshotClear'))
  assert.ok(wxml.includes('清除快照轨迹'))
  assert.ok(wxml.includes('catchtap="onAskDelete"'))
  assert.ok(wxml.includes('cockpit-timeline__delete'))
  assert.ok(wxml.includes('加载更多'))
  assert.ok(wxml.includes('重新绘制图表'))
  assert.ok(wxml.includes('aria-label="{{donutAria}}"'))
  assert.ok(wxml.includes('aria-label="{{dailyAria}}"'))
  assert.ok(wxml.includes('V{{appVersion}}'))
  assert.equal(wxml.includes('V{{insight.total}}'), false)
  assert.equal(wxml.includes('清空本机轨迹'), false)

  assert.ok(json.includes('glass-modal'))
  assert.ok(json.includes('glass-switch'))

  assert.ok(wxss.includes('.cockpit-tracking'))
  assert.ok(wxss.includes('.cockpit-clear'))
  assert.ok(wxss.includes('.cockpit-timeline__delete'))
  assert.ok(wxss.includes('.cockpit-chart-retry'))
  assert.ok(wxss.includes('color: var(--text-secondary)'))
})

test('胶囊与 tag：文本必须单行内联，flex 行不得拉伸气泡', () => {
  const wxml = read('subpackages/grow/pages/cockpit/index.wxml')
  const wxss = read('subpackages/grow/pages/cockpit/index.wxss')

  assert.ok(wxml.includes('>{{tag}}</text>'), '洞察 tag 必须去掉换行/缩进空白')
  assert.ok(wxml.includes('>{{item.themeLabel}}</text>'), '昼夜胶囊必须去掉换行/缩进空白')

  const tagRow = wxss.match(/\.cockpit-insight__tags\s*\{[^}]*\}/)
  const tag = wxss.match(/\.cockpit-insight__tag\s*\{[^}]*\}/)
  const chipRow = wxss.match(/\.cockpit-timeline__chips\s*\{[^}]*\}/)
  const chip = wxss.match(/\.cockpit-timeline__chip\s*\{[^}]*\}/)

  assert.ok(tagRow && tagRow[0].includes('align-items: center'))
  assert.ok(chipRow && chipRow[0].includes('align-items: center'))
  for (const block of [tag, chip]) {
    assert.ok(block, '缺少胶囊/tag 样式')
    assert.ok(block[0].includes('display: inline-flex'))
    assert.ok(block[0].includes('align-items: center'))
    assert.ok(block[0].includes('justify-content: center'))
    assert.ok(block[0].includes('line-height: 1'))
    assert.ok(block[0].includes('white-space: nowrap'))
  }
})

test('设置中心：新增数据驾驶舱入口', () => {
  const ts = read('subpackages/grow/pages/settings/index.ts')
  const wxml = read('subpackages/grow/pages/settings/index.wxml')
  assert.ok(ts.includes('onOpenCockpit'))
  assert.ok(ts.includes('ROUTES.cockpit'))
  assert.ok(wxml.includes('bindtap="onOpenCockpit"'))
  assert.ok(wxml.includes('数据驾驶舱'))
})

test('白昼图表调色板与字体：对比度不低于主文字方案', () => {
  const chart = read('subpackages/grow/lib/cockpit-chart.ts')
  const wxss = read('subpackages/grow/pages/cockpit/index.wxss')
  assert.ok(chart.includes('rgba(0, 0, 0, 0.72)'))
  assert.ok(chart.includes('"SF Pro Display"'))
  assert.ok(chart.includes('"PingFang SC"'))
  assert.ok(chart.includes('glow = true'))
  assert.ok(wxss.includes('--cockpit-danger: #b42335'))
})
