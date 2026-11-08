/* ==========================================================================
   隐私脱敏 · 敏感字段识别与掩码
   - 只隐藏金额、密码、健康、身份等敏感值，保留单位 / 分类 / 普通换算文案
   - 字段级识别优先：埋点写入时按参数 label 与结果 label 分类
   - 兜底识别：无 label 的历史摘要按关键词与令牌特征处理
   - 单一真相源：tracker / 历史回放 / 驾驶舱渲染全部消费这里
   ========================================================================== */

/** 元数据字段：长度、次数、行数等不是隐私，不参与数字掩码 */
const META_LABEL = /(长度|位数|字符数|字节数|行数|期数|条数|次数|数量|年龄单位)/i

/** 必须整体隐藏的字段：密码、账号、身份、原文摘录等 */
const FULL_LABEL =
  /(密码|口令|验证码|密钥|私钥|token|secret|账号|帐号|卡号|身份证|手机号|联系电话|邮箱|电子邮箱|原文摘录|原文|摘录|预览|内容摘要)/i

/** 数字敏感字段：金额、收入、税额、健康数据、个人日期等 */
const NUMBER_LABEL =
  /(金额|收入|工资|薪资|税额|税费|税金|税率|税后|纳税|利息|本金|首付|月供|总价|价格|费用|余额|存款|贷款金额|还款额|还款总额|总还款|利率|保险|五险|一金|专项|扣除|身高|体重|体脂|bmi|生日|年龄|月龄|周岁|虚岁|天数|目标日)/i

/** 无 label 的行内摘要：出现这些词才隐去数字 */
const NUMBER_TEXT =
  /(金额|收入|工资|薪资|税额|税费|税金|税率|税后|纳税|利息|本金|首付|月供|总价|价格|费用|余额|存款|贷款|还款|利率|保险|五险|一金|专项|扣除|身高|体重|体脂|bmi|生日|年龄|月龄|周岁|虚岁|天数|目标日)/i

/** 邮箱 / URL / 长令牌：无论字段类型都视为隐私 */
const EMAIL_PATTERN = /[\w.+-]+@[\w.-]+/g
const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s，。；、）)]+/gi
const LONG_TOKEN_PATTERN = /[A-Za-z0-9_+/=-]{12,}/g
const NUMBER_PATTERN = /\d+(?:[.,]\d+)*/g
const PHONE_PATTERN = /\b1[3-9]\d{9}\b/g
const ID_CARD_PATTERN = /\b\d{17}[\dXx]\b/g
const LONG_NUMBER_PATTERN = /\b\d{15,19}\b/g

export function maskSecretTokens(text: string): string {
  return text
    .replace(EMAIL_PATTERN, '***')
    .replace(URL_PATTERN, '***')
    .replace(PHONE_PATTERN, '***')
    .replace(ID_CARD_PATTERN, '***')
    .replace(LONG_NUMBER_PATTERN, '***')
    .replace(LONG_TOKEN_PATTERN, (token) => (/^[0-9]+$/.test(token) ? token : '***'))
}

export function maskNumericText(text: string): string {
  return maskSecretTokens(text).replace(NUMBER_PATTERN, '***')
}

/**
 * 按字段 label 决定掩码强度：
 * - full：密码 / 账号 / 身份证 / 原文摘录 → 整体 ***
 * - numbers：金额 / 收入 / 健康 / 个人日期 → 只隐去数字
 * - none：单位、分类、换算类别、次数等 → 保留原值，仅兜底长令牌
 */
export function maskSensitiveText(value: string, label = ''): string {
  const text = String(value ?? '').trim()
  if (!text) {
    return ''
  }
  const field = label.trim()

  /* 长度 / 位数 / 次数等元数据优先放行，例如「密码长度 8 位」 */
  if (field && META_LABEL.test(field)) {
    return maskSecretTokens(text)
  }
  if (field && FULL_LABEL.test(field)) {
    return '***'
  }

  const tokenMasked = maskSecretTokens(text)
  const numericSensitive = field ? NUMBER_LABEL.test(field) : NUMBER_TEXT.test(text)
  return numericSensitive ? maskNumericText(tokenMasked) : tokenMasked
}

/**
 * 旧存档兜底：没有 inputMasked / outputMasked 时按工具类型回退。
 * - 密码 / 文本摘录类：整体隐藏，避免旧记录泄露原文
 * - 财务 / 健康 / 个人类：隐去数字，保留单位与分类
 * - 单位换算等安全工具：保留原值，只处理邮箱 / URL / 长令牌
 */
const LEGACY_FULL_TOOLS = new Set(['password', 'wordcount', 'url', 'base64'])
const LEGACY_NUMBER_TOOLS = new Set(['loan', 'tax', 'deposit', 'rmb', 'bmi', 'age'])

export function maskLegacySummary(text: string, toolId = ''): string {
  if (!text) {
    return ''
  }
  if (LEGACY_FULL_TOOLS.has(toolId)) {
    return '***'
  }
  if (LEGACY_NUMBER_TOOLS.has(toolId)) {
    return maskNumericText(text)
  }
  /* 未知工具按行内关键词判断：含金额 / 收入等词才隐去数字，单位文案放行 */
  return maskSensitiveText(text)
}
