/* ==========================================================================
   全息专注 · 页面静态契约回归
   - 无 setInterval / 时间戳计时 / 250ms setTimeout
   - 返回拦截 / onUnload 恢复亮度 / Canvas watchdog / devtools 降级
   - update-guard blocked / 历史记录 gate / 无障碍 / 防残影
   - 运行：npm test
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const PAGE = 'subpackages/life/pages/focus/index'

test('计时：没有 setInterval，ticker 250ms，剩余时间由 FSM 推导', () => {
  const ts = read(`${PAGE}.ts`)
  assert.equal(ts.includes('setInterval'), false)
  assert.match(ts, /const TICK_MS = 250/)
  assert.match(ts, /setTimeout\(\(\) => \{/)
  assert.match(ts, /focusRemainingMs/)
  assert.match(ts, /restoreFocusSession/)
  assert.match(ts, /completeFocusSession/)
  assert.match(ts, /phaseEndsAt/)
})

test('时钟作弊：getPerformance 双锚点 + 5s 阈值 + tainted 不更新 stats', () => {
  const ts = read(`${PAGE}.ts`)
  assert.match(ts, /getPerformance/)
  assert.match(ts, /CLOCK_DRIFT_LIMIT_MS = 5000/)
  assert.match(ts, /setClockAnchor/)
  assert.match(ts, /detectClockDrift/)
  assert.match(ts, /handleClockTaintedCompletion/)
  assert.match(ts, /appendFocusRecord/)
  assert.match(ts, /本次不计入等级/)
})

test('生命周期：onUnload 恢复亮度 / 释放音频 / 关闭返回拦截', () => {
  const ts = read(`${PAGE}.ts`)
  const unload = ts.match(/onUnload\(\) \{[\s\S]*?onNebulaImageError/) || []
  assert.ok(unload.length > 0)
  assert.match(ts, /restoreBrightness\(\)/)
  assert.match(ts, /runtime\.audio\.dispose\(\)/)
  assert.match(ts, /runtime\.bgm\.dispose\(\)/)
  assert.match(ts, /disableUnloadAlert\(\)/)
  assert.match(ts, /enableAlertBeforeUnload/)
  assert.match(ts, /心流正在建立，确定放弃？/)
  assert.match(ts, /clearFocusBrightness/)
  assert.match(ts, /saveFocusBrightness/)
})

test('App 亮度兜底：onLaunch 读取 stale key 并恢复', () => {
  const app = read('app.ts')
  assert.match(app, /focus:brightness:v1/)
  assert.match(app, /restoreStaleFocusBrightness\(\)/)
  assert.match(app, /setScreenBrightness/)
  assert.match(app, /record\.owned !== true/)
  assert.match(app, /removeStorageSync\(STALE_KEY\)/)
})

test('WXML 事件绑定：全部存在对应的页面方法', () => {
  const ts = read(`${PAGE}.ts`)
  const wxml = read(`${PAGE}.wxml`)
  const handlers = new Set()
  for (const match of wxml.matchAll(/(?:bind|catch)(?::)?[a-z-]+="([A-Za-z0-9_]+)"/g)) {
    handlers.add(match[1])
  }
  for (const name of handlers) {
    assert.match(ts, new RegExp(`\\b${name}\\s*\\(`), `缺少事件处理器：${name}`)
  }
})

test('Page 不使用 observers：主题 / 低内存改用 reaction 并在卸载释放', () => {
  const ts = read(`${PAGE}.ts`)
  assert.equal(ts.includes('observers: {'), false, 'Page 不支持 observers')
  assert.match(ts, /from 'mobx-miniprogram'/)
  assert.match(ts, /reaction\(/)
  assert.match(ts, /uiReactions/)
  assert.match(ts, /for \(const dispose of runtime\.uiReactions\)/)
})

test('战报 / 抽屉：隐藏底层重影并使用 tall 抽屉', () => {
  const wxml = read(`${PAGE}.wxml`)
  assert.match(wxml, /wx:if="\{\{!reportOpen\}\}" class="focus-nav"/)
  assert.match(wxml, /is-report-hidden/)
  assert.match(wxml, /<glass-bottom-sheet[\s\S]*?size="tall"/)
})

test('update-guard：专注 / 抽屉 / 战报 / 海报期间 blocked', () => {
  const ts = read(`${PAGE}.ts`)
  const wxml = read(`${PAGE}.wxml`)
  assert.match(wxml, /<update-guard blocked="{{guardBlocked}}" \/>/)
  assert.match(ts, /Boolean\(runtime\.session\)/)
  assert.match(ts, /Boolean\(this\.data\.setupOpen\)/)
  assert.match(ts, /runtime\.reportOpen/)
  assert.match(ts, /Boolean\(this\.data\.posterVisible\)/)
})

test('历史轨迹：受 isHistoryTrackingEnabled 管控且写入 night', () => {
  const ts = read(`${PAGE}.ts`)
  assert.match(ts, /preferenceStore\.isHistoryTrackingEnabled/)
  assert.match(ts, /historyStore\.record\(\{/)
  assert.match(ts, /toolId: 'focus'/)
  assert.match(ts, /toolName: '全息专注'/)
  assert.match(ts, /category: 'life'/)
  assert.match(ts, /night: uiStore\.resolvedTheme === 'dark'/)
})

test('Canvas：isDevtools 跳过查询，真机 watchdog 与静态环兜底', () => {
  const ts = read(`${PAGE}.ts`)
  const wxml = read(`${PAGE}.wxml`)
  const wxss = read(`${PAGE}.wxss`)
  assert.match(ts, /isDevtools\(\)/)
  assert.match(ts, /RING_QUERY_TIMEOUT/)
  assert.match(ts, /ringCanvasMounted/)
  assert.match(ts, /canvasReady/)
  assert.match(ts, /#nebula-canvas/)
  assert.match(wxml, /class="focus-ring-fallback/)
  assert.equal(wxss.includes('backdrop-filter'), false)
  assert.match(wxss, /prefers-reduced-motion/)
  assert.match(wxss, /focus-page--low/)
})

test('圆环几何：canvas 只在专注 / 休息态接管，变换每帧重置，文字与环保持物理间距', () => {
  const ts = read(`${PAGE}.ts`)
  const wxml = read(`${PAGE}.wxml`)
  const wxss = read(`${PAGE}.wxss`)

  /* 单环原则：静态环只在 canvas 接管时隐藏，且 canvas 只在需要动画的状态接管 */
  assert.match(
    wxml,
    /canvasReady && ringCanvasActive && \(fsmView === 'focusing' \|\| fsmView === 'breaking'\)/,
  )
  assert.match(ts, /ringCanvasPx/)
  assert.match(wxml, /ringCanvasPx/)
  /* 画布几何以环盒为准，不依赖 canvas 内禀尺寸 */
  assert.match(ts, /\.select\('\.focus-ring-wrap'\)/)
  assert.match(
    wxss,
    /\.focus-ring-canvas \{[\s\S]*?width: 100%;[\s\S]*?height: 100%;/,
  )

  /* 每帧重置变换矩阵，避免 canvas 重挂载后 scale(dpr) 叠加导致圆心偏移 */
  assert.match(ts, /ctx\.setTransform\(dpr, 0, 0, dpr, 0, 0\)/)
  assert.equal(ts.includes('ctx.scale('), false)

  /* 文字与 520rpx 环盒之间保留 40rpx 物理间距 */
  assert.match(wxss, /\.focus-status-title \{[\s\S]*?margin-top: 40rpx;/)

  /* 暂停只压暗环，不整块降透明度 */
  assert.match(ts, /kicker = 'PAUSED'[\s\S]*?ringDim = false/)
  assert.equal(wxss.includes('.focus-stage--paused .focus-ring-wrap'), false)
  assert.match(
    wxss,
    /\.focus-stage--paused \.focus-ring-fallback \{[\s\S]*?opacity: 0\.45;/,
  )
})

test('传感器降级：不在屏幕中央弹 Toast，改为设置抽屉内常驻说明', () => {
  const ts = read(`${PAGE}.ts`)
  const wxml = read(`${PAGE}.wxml`)
  assert.equal(ts.includes("this.toast('当前设备不支持翻转检测"), false)
  assert.equal(ts.includes('flipToastShown'), false)
  assert.match(wxml, /当前设备不支持翻转检测，已隐藏该功能/)
})

test('副本与状态：Overheat / Glitch / 网络徽章 / 跳过休息文案完整', () => {
  const ts = read(`${PAGE}.ts`)
  const wxml = read(`${PAGE}.wxml`)
  const wxss = read(`${PAGE}.wxss`)
  assert.match(ts, /连续专注 2 小时，先休息 30 分钟/)
  assert.match(wxml, /心流已断裂/)
  assert.match(wxml, /已记录 {{glitchCount}} 次中断，计时继续/)
  /* Glitch 半透明 scrim 下必须隐藏圆心计时，避免与提示文字叠加 */
  assert.match(
    wxss,
    /\.focus-ring-wrap\.is-glitch \.focus-ring-inner \{[\s\S]*?opacity: 0;/,
  )
  assert.match(ts, /跳过休息？/)
  assert.match(ts, /放弃这次心流？/)
  assert.match(ts, /已离线 · 心流继续/)
  assert.match(ts, /网络已恢复/)
  assert.match(ts, /冷却中/)
  assert.match(wxml, /保存海报/)
  assert.match(wxml, /aria-role="timer"/)
  assert.match(wxml, /aria-live="assertive"/)
  assert.match(wxml, /aria-live="polite"/)
})

test('路由与后台音频：life 分包注册、ROUTES.focus、requiredBackgroundModes', () => {
  const appJson = JSON.parse(read('app.json'))
  assert.ok(appJson.subpackages.length >= 6)
  assert.ok(
    appJson.subpackages.some(
      (subpackage) =>
        subpackage.root === 'subpackages/life' &&
        subpackage.pages.includes('pages/focus/index'),
    ),
  )
  assert.deepEqual(appJson.requiredBackgroundModes, ['audio'])

  const constants = read('core/constants/index.ts')
  assert.match(constants, /focus: '\/subpackages\/life\/pages\/focus\/index'/)
})

test('结算：record.id 幂等 / stats 更新 / 星云种子', () => {
  const ts = read(`${PAGE}.ts`)
  assert.match(ts, /buildFocusRecord\(/)
  assert.match(ts, /settleFocusRecord\(/)
  assert.match(ts, /createNebulaScene\(record\.seed/)
  assert.match(ts, /renderNebulaScene/)
  assert.match(ts, /canvasToTempFilePath/)
  assert.match(ts, /poster-generator/)
})

test('音频门禁：BGM 只在 focusing/隐藏、sound / saver 全静音', () => {
  const ts = read(`${PAGE}.ts`)
  assert.match(ts, /shouldRunBgm/)
  assert.match(ts, /runtime\.session\?\.fsm === 'focusing'/)
  assert.match(ts, /preferenceStore\.sound/)
  assert.match(ts, /useMotion\(\)\.level !== 'saver'/)
  assert.match(ts, /runtime\.audio\.setTracks\(\[\]\)/)
  assert.match(ts, /runtime\.bgm\.stop\(\)/)
  assert.match(ts, /runtime\.audio\.suspend\(\)/)
  assert.match(ts, /runtime\.bgm\.start\(\)/)
})

test('Canvas 互斥：星云与海报同一时刻只跑一个任务', () => {
  const ts = read(`${PAGE}.ts`)
  assert.match(ts, /canvasTask/)
  assert.match(ts, /canvasTask === 'nebula'/)
  assert.match(ts, /canvasTask === 'poster'/)
  assert.match(ts, /runtime\.canvasTask = 'nebula'/)
  assert.match(ts, /runtime\.canvasTask = 'poster'/)
})

test('残影防护：弹窗 / 抽屉关闭首帧移除 backdrop-filter', () => {
  const modalWxml = read('components/glass-modal/index.wxml')
  const modalWxss = read('components/glass-modal/index.wxss')
  const sheetWxml = read('components/glass-bottom-sheet/index.wxml')
  const sheetWxss = read('components/glass-bottom-sheet/index.wxss')
  const buttonWxss = read('components/glass-button/index.wxss')
  const focusWxml = read(`${PAGE}.wxml`)

  /* Skyline 会把 backdrop-filter 提升为独立背板层，退场时冻结成残影 */
  assert.match(modalWxml, /glass-modal_closing/)
  assert.match(
    modalWxss,
    /\.glass-modal_closing \.glass-modal__panel \{[\s\S]*?backdrop-filter: none;/,
  )
  assert.match(sheetWxml, /glass-sheet_closing/)
  assert.match(
    sheetWxss,
    /\.glass-sheet_closing \.glass-sheet__drag \{[\s\S]*?backdrop-filter: none;/,
  )

  /* 弹窗 / 抽屉内的次级按钮使用 frost：不叠加第二层 backdrop-filter */
  assert.match(modalWxml, /variant="frost"/)
  assert.match(focusWxml, /variant="frost"/)
  const frostBlock = buttonWxss.match(
    /\.glass-button_variant_frost \{[\s\S]*?\n\}/,
  )
  assert.ok(frostBlock, '缺少 frost 变体')
  assert.equal(frostBlock[0].includes('backdrop-filter'), false)
})

test('onHide / onUnload：亮度、常亮、ticker、传感器与网络监听全部收口', () => {
  const ts = read(`${PAGE}.ts`)
  assert.match(ts, /onHide\(\) \{[\s\S]*?this\.restoreBrightness\(\)/)
  assert.match(ts, /setKeepScreenOn\(false\)/)
  assert.match(ts, /this\.stopTicker\(\)/)
  assert.match(ts, /this\.stopMotionListening\(\)/)
  assert.match(ts, /this\.persistSession\(true\)/)
  assert.match(ts, /stopNetworkListener/)
  assert.match(ts, /offNetworkStatusChange/)
})

test('设置入口与清空入口：只读 Storage 契约，不 import life', () => {
  const settings = read('subpackages/grow/pages/settings/index.ts')
  const wxml = read('subpackages/grow/pages/settings/index.wxml')
  assert.match(settings, /ROUTES\.focus/)
  assert.match(settings, /focus:session:v1/)
  assert.match(settings, /FOCUS_STORAGE_KEYS/)
  assert.match(settings, /onFocusClearConfirm/)
  assert.equal(settings.includes("from '../../../../subpackages/life"), false)
  assert.match(wxml, /全息专注引擎/)
  assert.match(wxml, /清空专注数据/)
})

test('Storage key 契约：life / 设置 / 驾驶舱 / App 四处一致', () => {
  const storage = read('subpackages/life/lib/focus-storage.ts')
  const settings = read('subpackages/grow/pages/settings/index.ts')
  const cockpit = read('subpackages/grow/pages/cockpit/index.ts')
  const app = read('app.ts')
  const keys = [
    'focus:session:v1',
    'focus:prefs:v1',
    'focus:key:v1',
    'focus:ledger:v1',
    'focus:stats:v1',
    'focus:brightness:v1',
  ]
  for (const key of keys) {
    assert.ok(storage.includes(key), `focus-storage 缺少 ${key}`)
    assert.ok(settings.includes(key), `settings 缺少 ${key}`)
  }
  assert.match(cockpit, /focus:stats:v1/)
  assert.match(cockpit, /focus:ledger:v1/)
  assert.match(app, /focus:brightness:v1/)
})

test('等级文案：life 与驾驶舱内联副本完全一致', () => {
  const level = read('subpackages/life/lib/focus-level.ts')
  const cockpit = read('subpackages/grow/pages/cockpit/index.ts')
  const labels = [
    '初识心流',
    '渐入佳境',
    '稳定心流',
    '深度专注',
    '心流大师',
    '心流传奇',
  ]
  for (const label of labels) {
    assert.ok(level.includes(label), `focus-level 缺少 ${label}`)
    assert.ok(cockpit.includes(label), `cockpit 缺少 ${label}`)
  }
})
