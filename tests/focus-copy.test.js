/* ==========================================================================
   Focus Copy · 附录 D 文案 / 按钮 / 无障碍 / 降级
   - 状态、弹窗、错误、设置页、驾驶舱、海报文案
   - 不出现歧义“确定”；按钮必须是动作
   - 运行：npm test
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const PAGE_TS = read('subpackages/life/pages/focus/index.ts')
const PAGE_WXML = read('subpackages/life/pages/focus/index.wxml')
const SETTINGS_TS = read('subpackages/grow/pages/settings/index.ts')
const SETTINGS_WXML = read('subpackages/grow/pages/settings/index.wxml')
const COCKPIT_WXML = read('subpackages/grow/pages/cockpit/index.wxml')

test('状态文案：READY / FOCUSING / PAUSED / BREAK / COOLDOWN / REPORT', () => {
  for (const copy of [
    '准备进入心流',
    '25 分钟 · 翻转黑屏 · 星云战报',
    '25 分钟 · 环境音 · 星云战报',
    '专注设置',
    '心流中',
    '已暂停',
    '计时已冻结',
    '站起来，看看远处',
    '冷却中',
    '连续专注 2 小时，先休息 30 分钟',
    '心流战报',
    '本机生成 · 不上传',
  ]) {
    assert.ok(PAGE_TS.includes(copy), `缺少状态文案：${copy}`)
  }
  assert.ok(PAGE_WXML.includes('心流已断裂'))
  assert.ok(PAGE_WXML.includes('已记录 {{glitchCount}} 次中断，计时继续'))
  assert.ok(PAGE_WXML.includes('你完成了 {{reportMinutes}} 分钟专注'))
  assert.ok(PAGE_WXML.includes('未填写标签时使用「深度工作」'))
})

test('按钮：全部是动作，不出现歧义“确定”', () => {
  const combined = PAGE_TS + PAGE_WXML
  for (const label of [
    '开始专注',
    '开始心流',
    '暂停',
    '继续',
    '放弃',
    '跳过休息',
    '保存海报',
    '完成',
    '设置',
    '取消',
  ]) {
    assert.ok(combined.includes(label), `缺少按钮文案：${label}`)
  }
  const withoutSystemAlert = combined.replace(
    /心流正在建立，确定放弃？/g,
    '',
  )
  assert.equal(withoutSystemAlert.includes('确定'), false, '专注页不得出现歧义“确定”')
})

test('弹窗与降级：放弃 / 跳过 / 环境音 / BGM / 传感器 / Canvas / 存证', () => {
  for (const copy of [
    '放弃这次心流？',
    '当前专注将不会计入战报与等级。',
    '继续专注',
    '跳过休息？',
    '直接回到待机，下一轮可以稍后开始。',
    '继续休息',
    '环境音不可用，已切换为静音专注',
    '后台保活不可用，倒计时仍会精准继续',
    '保活音频已暂停，倒计时仍精准',
    '当前设备不支持翻转检测，已隐藏该功能',
    '已切换为简化动效',
    '本机记录暂时无法验证，历史等级已冻结',
    '本机记录校验失败，历史等级已冻结',
    '专注数据异常，已回到待机',
    '海报生成失败，请稍后重试',
    '已离线 · 心流继续',
    '网络已恢复',
    '休息结束，可以开始下一轮',
    '冷却结束，可以继续',
    '检测到本机时钟异常，本次专注不计入等级',
    '检测到本机时钟异常，本次不计入等级，星云已枯萎',
    '本机记录校验失败，本次不计入等级，星云已枯萎',
    '本机记录校验失败，本次专注不计入等级',
    '本机校验记录丢失，本次专注不计入等级',
    '本机校验记录丢失，请先清空专注数据',
    '本机校验记录丢失，本次不计入等级，星云已枯萎',
  ]) {
    assert.ok(PAGE_TS.includes(copy), `缺少降级文案：${copy}`)
  }
})

test('设置页文案：入口 / 六种副标题 / 清空二次确认', () => {
  const combined = SETTINGS_TS + SETTINGS_WXML
  for (const copy of [
    '全息专注引擎',
    '25 分钟专注 · 翻转黑屏 · 星云战报',
    '心流进行中 · 返回专注',
    '休息中 · 返回专注',
    '休息已结束 · 可开始下一轮',
    '冷却中 · 剩余',
    '已冷却 · 可继续',
    '已完成 · 查看战报',
    '清空专注数据',
    '确定清空？',
    '正在专注或冷却中，清空将终止当前会话',
  ]) {
    assert.ok(combined.includes(copy), `缺少设置页文案：${copy}`)
  }
})

test('驾驶舱 / 海报文案：指标、空态、等级与页脚', () => {
  for (const copy of ['专注小卡', '今日专注 · 分钟', '累计完成', '连续天数', '当前等级', '还没有专注记录']) {
    assert.ok(COCKPIT_WXML.includes(copy), `缺少驾驶舱文案：${copy}`)
  }
  for (const copy of [
    'toolName: \'全息专注\'',
    'resultLabel: \'专注时长\'',
    '中断 ${record.breaches} 次',
    'Lv.${level}',
    '连续 ${stats?.streakDays ?? 0} 天',
    '本次不计入等级',
    '本机生成 · 不上传',
  ]) {
    assert.ok(PAGE_TS.includes(copy), `缺少海报文案：${copy}`)
  }
})

test('无障碍：timer / live / dialog / canvas aria-hidden / 按钮 label', () => {
  assert.match(PAGE_WXML, /aria-role="timer"/)
  assert.match(PAGE_WXML, /aria-label="{{clockAria}}"/)
  assert.match(PAGE_WXML, /aria-live="polite"/)
  assert.match(PAGE_WXML, /aria-live="assertive"/)
  assert.match(PAGE_WXML, /aria-role="dialog"/)
  assert.match(PAGE_WXML, /aria-hidden="true"/)
  assert.match(PAGE_WXML, /aria-label="{{primaryLabel}}"/)
  assert.match(PAGE_WXML, /aria-label="{{secondaryLabel}}"/)
  assert.match(PAGE_WXML, /aria-label="返回"/)
  assert.match(PAGE_WXML, /aria-label="保存海报"/)
  assert.match(PAGE_WXML, /aria-label="完成"/)
  assert.match(PAGE_WXML, /aria-label="专注设置"/)
  assert.match(PAGE_WXML, /aria-label="{{modalTitle}}"/)
})
