/* ==========================================================================
   隐私脱敏 · 单元测试
   - 字段级识别：单位 / 分类放行，金额 / 密码 / 健康 / 身份隐藏
   - 令牌级识别：邮箱、URL、长串 token、千分位金额
   - 旧存档兜底：按 toolId 回退，单位换算不被误伤
   - 埋点集成：tracker 同时产出真实摘要与预计算掩码
   - 偏好契约：眼睛图标状态与 WXML 交互入口存在
   - 运行：npm test
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
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

test('字段脱敏：单位 / 分类 / 普通换算完整保留', async () => {
  const { maskSensitiveText } = await import(moduleUrl('core/toolbox/privacy.ts'))

  assert.equal(maskSensitiveText('12 米', '输入数值'), '12 米')
  assert.equal(maskSensitiveText('米', '从单位'), '米')
  assert.equal(maskSensitiveText('厘米', '到单位'), '厘米')
  assert.equal(maskSensitiveText('长度', '换算类别'), '长度')
  assert.equal(maskSensitiveText('米 → 厘米 1,200 厘米', '米 → 厘米'), '米 → 厘米 1,200 厘米')
  assert.equal(maskSensitiveText('约 40 张 A4 纸长边'), '约 40 张 A4 纸长边')

  /* 纯数字长串在单位字段也不应被误判为 token */
  assert.equal(maskSensitiveText('123456789012', '输入数值'), '123456789012')
})

test('字段脱敏：财务 / 健康只隐藏数字，单位与文案保留', async () => {
  const { maskSensitiveText } = await import(moduleUrl('core/toolbox/privacy.ts'))

  assert.equal(maskSensitiveText('100.00 万元', '贷款金额'), '*** 万元')
  assert.equal(maskSensitiveText('3.50%', '年利率'), '***%')
  assert.equal(maskSensitiveText('30 年 · 360 期', '贷款年限'), '30 年 · 360 期')
  assert.equal(maskSensitiveText('等额本息', '还款方式'), '等额本息')
  assert.equal(maskSensitiveText('¥4,490.45', '每月月供'), '¥***')
  assert.equal(maskSensitiveText('总利息 ¥616,562.00'), '总利息 ¥***')
  assert.equal(maskSensitiveText('利息占比 38.1%'), '利息占比 ***%')

  assert.equal(maskSensitiveText('175 cm', '身高'), '*** cm')
  assert.equal(maskSensitiveText('70 kg', '体重'), '*** kg')
  assert.equal(maskSensitiveText('健康区间 18.5 – 23.9'), '健康区间 18.5 – 23.9')
})

test('字段脱敏：密码 / 身份整体隐藏，长度等元数据放行', async () => {
  const { maskSensitiveText } = await import(moduleUrl('core/toolbox/privacy.ts'))

  assert.equal(maskSensitiveText('Abc123!@#', '8 位随机密码'), '***')
  assert.equal(maskSensitiveText('8 位', '密码长度'), '8 位')
  assert.equal(maskSensitiveText('13800138000', '手机号'), '***')
  assert.equal(maskSensitiveText('a@b.com', '邮箱'), '***')
  assert.equal(maskSensitiveText('110101199001011234', '身份证'), '***')
  assert.equal(maskSensitiveText('这是原文摘要', '原文摘录'), '***')
})

test('令牌脱敏：邮箱 / URL / 长 token 隐藏，短数字与单位保留', async () => {
  const { maskSecretTokens, maskNumericText, maskSensitiveText } = await import(
    moduleUrl('core/toolbox/privacy.ts')
  )

  assert.equal(maskSecretTokens('联系 a@b.com 或 https://x.com/a?token=abc'), '联系 *** 或 ***')
  assert.equal(maskSecretTokens('token Abcdefghijklmnop'), 'token ***')
  assert.equal(maskSecretTokens('123456789012'), '123456789012')
  assert.equal(maskSecretTokens('手机号 13800138000'), '手机号 ***')
  assert.equal(maskSecretTokens('身份证 110101199001011234'), '身份证 ***')
  assert.equal(maskSecretTokens('卡号 6222021234567890123'), '卡号 ***')
  assert.equal(maskNumericText('¥1,616,562.00'), '¥***')
  assert.equal(maskNumericText('2026年11月06日'), '***年***月***日')
  assert.equal(maskSensitiveText('输出预览 https://x.com/a?token=abc'), '输出预览 ***')
})

test('旧存档兜底：密码类整体隐藏，财务类隐数字，单位类保持原值', async () => {
  const { maskLegacySummary } = await import(moduleUrl('core/toolbox/privacy.ts'))

  assert.equal(maskLegacySummary('8 位随机密码 Abc123!', 'password'), '***')
  assert.equal(maskLegacySummary('原文摘录 今天开会', 'wordcount'), '***')
  assert.equal(maskLegacySummary('输出预览 aGVsbG8=', 'base64'), '***')
  assert.equal(maskLegacySummary('联系方式 13800138000', 'unknown-tool'), '联系方式 ***')

  assert.equal(
    maskLegacySummary('贷款金额 100 万元 · 年利率 3.5% · 贷款年限 30 年', 'loan'),
    '贷款金额 *** 万元 · 年利率 ***% · 贷款年限 *** 年',
  )
  assert.equal(maskLegacySummary('身高 175 cm · 体重 70 kg', 'bmi'), '身高 *** cm · 体重 *** kg')

  /* 单位换算旧存档：数字与单位都不能被误伤 */
  assert.equal(
    maskLegacySummary('输入数值 12 米 · 从单位 米 · 到单位 厘米', 'unit'),
    '输入数值 12 米 · 从单位 米 · 到单位 厘米',
  )
  assert.equal(maskLegacySummary('本地时间 2026-11-06 16:00', 'timestamp'), '本地时间 2026-11-06 16:00')

  /* 未知工具按行内关键词兜底 */
  assert.equal(maskLegacySummary('月供 5368 元 · a@b.com'), '月供 *** 元 · ***')
})

test('埋点集成：tracker 同时产出真实摘要与预计算掩码', async () => {
  const storage = installStorageMock()
  const { historyStore } = await import(moduleUrl('core/stores/history.ts'))
  const { recordToolResult } = await import(moduleUrl('core/toolbox/tracker.ts'))

  historyStore.clearMemory()
  historyStore.records = []

  try {
    const unit = recordToolResult({
      toolId: 'unit',
      poster: {
        toolName: '单位换算',
        category: '单位换算',
        mainResult: '1,200 厘米',
        resultLabel: '米 → 厘米',
        params: [
          { label: '输入数值', value: '12 米' },
          { label: '从单位', value: '米' },
          { label: '到单位', value: '厘米' },
          { label: '换算类别', value: '长度' },
        ],
        extras: ['毫米 12,000', '千米 0.012'],
      },
    })

    assert.ok(unit, '单位换算应成功入轨迹')
    assert.equal(
      unit.inputSummary,
      '输入数值 12 米 · 从单位 米 · 到单位 厘米 · 换算类别 长度',
    )
    assert.equal(unit.inputMasked, unit.inputSummary, '单位输入不应被脱敏')
    assert.equal(
      unit.outputSummary,
      '米 → 厘米 1,200 厘米 · 毫米 12,000 · 千米 0.012',
    )
    assert.equal(unit.outputMasked, unit.outputSummary, '单位结果不应被脱敏')

    const loan = recordToolResult({
      toolId: 'loan',
      poster: {
        toolName: '房贷试算',
        category: '财务计算',
        mainResult: '¥4,490.45',
        resultLabel: '每月月供',
        params: [
          { label: '贷款金额', value: '100.00 万元' },
          { label: '年利率', value: '3.50%' },
          { label: '贷款年限', value: '30 年 · 360 期' },
          { label: '还款方式', value: '等额本息' },
        ],
        extras: ['总利息 ¥616,562.00', '利息占比 38.1%', '总还款 ¥1,616,562.00'],
      },
    })

    assert.ok(loan, '房贷试算应成功入轨迹')
    assert.ok(loan.inputMasked.includes('*** 万元'), '贷款金额未打码')
    assert.ok(loan.inputMasked.includes('***%'), '年利率未打码')
    assert.ok(loan.inputMasked.includes('30 年'), '贷款年限被误伤')
    assert.ok(loan.inputMasked.includes('等额本息'), '还款方式被误伤')
    assert.ok(loan.outputMasked.includes('每月月供 ¥***'), '月供未打码')
    assert.ok(loan.outputMasked.includes('总利息 ¥***'), '总利息未打码')
    assert.ok(loan.outputMasked.includes('利息占比 ***%'), '利息占比未打码')
    assert.ok(!/\d/.test(loan.outputMasked), '结果仍残留数字')

    const password = recordToolResult({
      toolId: 'password',
      poster: {
        toolName: '随机密码',
        category: '安全工具',
        mainResult: 'Abc123!@#',
        resultLabel: '8 位随机密码',
        params: [
          { label: '密码长度', value: '8 位' },
          { label: '易混淆', value: '已排除' },
        ],
        extras: ['强度 很强', '信息熵 约 52.3 位熵'],
      },
    })

    assert.ok(password, '密码生成应成功入轨迹')
    assert.equal(password.outputSummary.includes('Abc123!@#'), true, '原始摘要应保留真实密码')
    assert.equal(password.outputMasked, '8 位随机密码 *** · 强度 很强 · 信息熵 约 52.3 位熵', '密码未整体隐藏')
    assert.equal(password.inputMasked, '密码长度 8 位 · 易混淆 已排除', '密码长度被误伤')

    historyStore.flush()
    const write = storage.writes.find((item) => item.key === 'tbx:history')
    assert.ok(write, '轨迹应写入 Storage')
    assert.equal(write.value.length, 3)
    assert.ok(write.value[0].outputMasked, '落盘记录必须同时保留掩码摘要')
  } finally {
    historyStore.clearMemory()
    delete globalThis.wx
  }
})

test('时间线渲染：优先使用预计算掩码，旧存档按工具类型回退', async () => {
  const { buildTimeline } = await import(moduleUrl('core/toolbox/history-insights.ts'))
  const now = Date.now()
  const base = {
    category: 'calc',
    categoryLabel: '计算换算',
    icon: '算',
    timestamp: now,
    night: true,
    themeLabel: '夜航',
  }

  const records = [
    {
      ...base,
      id: 'new-loan',
      toolId: 'loan',
      toolName: '房贷试算',
      inputSummary: '贷款金额 100 万元',
      outputSummary: '每月月供 ¥5,368.00',
      inputMasked: '贷款金额 *** 万元',
      outputMasked: '每月月供 ¥***',
    },
    {
      ...base,
      id: 'legacy-unit',
      toolId: 'unit',
      toolName: '单位换算',
      timestamp: now - 1000,
      inputSummary: '输入数值 12 米',
      outputSummary: '米 → 厘米 1,200 厘米',
    },
    {
      ...base,
      id: 'legacy-password',
      toolId: 'password',
      toolName: '随机密码',
      timestamp: now - 2000,
      inputSummary: '密码长度 8 位',
      outputSummary: '8 位随机密码 Abc123!',
    },
  ]

  const masked = buildTimeline(records, true, 3)
  assert.equal(masked[0].inputSummary, '贷款金额 *** 万元')
  assert.equal(masked[0].outputSummary, '每月月供 ¥***')
  assert.equal(masked[1].inputSummary, '输入数值 12 米')
  assert.equal(masked[1].outputSummary, '米 → 厘米 1,200 厘米')
  assert.equal(masked[2].outputSummary, '***', '旧密码存档必须整体隐藏')

  const plain = buildTimeline(records, false, 3)
  assert.equal(plain[0].outputSummary, '每月月供 ¥5,368.00')
  assert.equal(plain[1].outputSummary, '米 → 厘米 1,200 厘米')
  assert.equal(plain[2].outputSummary, '8 位随机密码 Abc123!')
})

test('UI 契约：眼睛开闭状态、斜杠与 useHaptics 点击反馈必须存在', () => {
  const wxml = fs.readFileSync(
    path.join(ROOT, 'subpackages/grow/pages/cockpit/index.wxml'),
    'utf8',
  )
  const ts = fs.readFileSync(
    path.join(ROOT, 'subpackages/grow/pages/cockpit/index.ts'),
    'utf8',
  )
  const wxss = fs.readFileSync(
    path.join(ROOT, 'subpackages/grow/pages/cockpit/index.wxss'),
    'utf8',
  )

  assert.ok(wxml.includes('cockpit-eye--masked'), '缺少闭眼状态样式绑定')
  assert.ok(wxml.includes('cockpit-eye--open'), '缺少开眼状态样式绑定')
  assert.ok(wxml.includes('cockpit-eye__slash'), '缺少闭眼斜杠')
  assert.ok(wxml.includes('aria-checked'), '缺少开关可访问状态')
  assert.ok(ts.includes('preferenceStore.togglePrivacyMasked()'), '未接入持久化偏好')
  assert.ok(ts.includes('useHaptics().tick()'), '眼睛点击未调用 useHaptics')
  assert.ok(wxss.includes('.cockpit-eye--open'), '缺少开眼高亮样式')
  assert.ok(wxss.includes('.cockpit-eye--masked'), '缺少闭眼压暗样式')
})
