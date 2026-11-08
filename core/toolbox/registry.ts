/* ==========================================================================
   工具注册表 · 首页 / 搜索 / 收藏 / 最近使用的唯一真相源
   - 只收录已实现且路由真实存在的工具（23 个 MVP）
   - 候选池 60 个属于产品规划，不进入运行时
   ========================================================================== */
import type { HomeSection, ToolCategory, ToolMeta } from './types'

export const HOME_SECTIONS: HomeSection[] = [
  { key: 'calc', title: '计算换算', hint: '金额、单位、比例', categories: ['calc'] },
  { key: 'date', title: '日期时间', hint: '天数、年龄、倒数', categories: ['date'] },
  { key: 'text', title: '文本效率', hint: '统计、整理、编码', categories: ['text'] },
  { key: 'media', title: '图片处理', hint: '压缩、取色、切图', categories: ['media'] },
  {
    key: 'life-work',
    title: '生活与职场',
    hint: '健康、金额大写',
    categories: ['life', 'work'],
  },
]

export const TOOLS: ToolMeta[] = [
  {
    id: 'unit',
    name: '单位换算',
    desc: '长度 · 质量 · 温度 · 面积',
    category: 'calc',
    icon: '换',
    route: '/subpackages/tools-core/pages/unit/index',
    keywords: ['单位', '换算', '厘米', '英寸', '斤', '公斤', '长度', '重量', '温度', '面积', '体积'],
    weight: 100,
  },
  {
    id: 'tax',
    name: '个税计算',
    desc: '月度 / 年度综合所得试算',
    category: 'calc',
    icon: '税',
    route: '/subpackages/tools-core/pages/tax/index',
    keywords: ['个税', '所得税', '专项附加', '五险一金', '到手', '税后', '工资'],
    weight: 96,
  },
  {
    id: 'loan',
    name: '房贷试算',
    desc: '等额本息 / 等额本金',
    category: 'calc',
    icon: '贷',
    route: '/subpackages/tools-core/pages/loan/index',
    keywords: ['房贷', '月供', '贷款', '利息', '等额本息', '等额本金', '还款'],
    weight: 94,
  },
  {
    id: 'deposit',
    name: '存款复利',
    desc: '本金、利率与复利终值',
    category: 'calc',
    icon: '存',
    route: '/subpackages/tools-core/pages/deposit/index',
    keywords: ['存款', '复利', '利息', '理财', '年利率', '定存'],
    weight: 88,
  },
  {
    id: 'span',
    name: '日期间隔',
    desc: '自然日 · 工作日 · 周数',
    category: 'date',
    icon: '日',
    route: '/subpackages/tools-core/pages/span/index',
    keywords: ['日期', '间隔', '天数', '工作日', '周末', '相差'],
    weight: 92,
  },
  {
    id: 'age',
    name: '年龄周岁',
    desc: '周岁、月龄与下次生日',
    category: 'date',
    icon: '龄',
    route: '/subpackages/tools-core/pages/age/index',
    keywords: ['年龄', '周岁', '生日', '月龄', '虚岁', '出生'],
    weight: 86,
  },
  {
    id: 'countdown',
    name: '倒数日',
    desc: '距离目标日还有几天',
    category: 'date',
    icon: '倒',
    route: '/subpackages/tools-core/pages/countdown/index',
    keywords: ['倒数', '纪念日', '倒数日', '目标日', '考试', '还有几天'],
    weight: 80,
  },
  {
    id: 'timestamp',
    name: '时间戳',
    desc: '秒 / 毫秒双向转换',
    category: 'date',
    icon: '戳',
    route: '/subpackages/tools-core/pages/timestamp/index',
    keywords: ['时间戳', 'Unix', '毫秒', '秒', '日期转换', '时间'],
    weight: 82,
  },
  {
    id: 'rmb',
    name: '金额大写',
    desc: '人民币金额转中文大写',
    category: 'work',
    icon: '壹',
    route: '/subpackages/tools-core/pages/rmb/index',
    keywords: ['大写', '金额', '人民币', '报销', '发票', '财务'],
    weight: 90,
  },
  {
    id: 'wordcount',
    name: '字数统计',
    desc: '字符、词数、行数与阅读时长',
    category: 'text',
    icon: '字',
    route: '/subpackages/tools-core/pages/wordcount/index',
    keywords: ['字数', '统计', '字符', '段落', '阅读', '文案'],
    weight: 84,
  },
  {
    id: 'text-diff',
    name: '文本对比',
    desc: '字符级 / 行级差异高亮',
    category: 'text',
    icon: '比',
    route: '/subpackages/tools-core/pages/text-diff/index',
    keywords: ['对比', '差异', 'Diff', '文本比较', '修改', '校对'],
    weight: 82,
  },
  {
    id: 'hash',
    name: 'Hash 加密',
    desc: 'MD5 / SHA / HMAC 摘要',
    category: 'text',
    icon: 'H',
    route: '/subpackages/tools-core/pages/hash/index',
    keywords: ['Hash', '加密', 'MD5', 'SHA1', 'SHA256', 'SHA512', 'HMAC', '摘要', '校验'],
    weight: 86,
  },
  {
    id: 'dedupe',
    name: '去重排序',
    desc: '按行去重、排序与清理',
    category: 'text',
    icon: '清',
    route: '/subpackages/tools-core/pages/dedupe/index',
    keywords: ['去重', '排序', '文本', '清理', '重复', '升序'],
    weight: 78,
  },
  {
    id: 'json',
    name: 'JSON 格式化',
    desc: '格式化 / 压缩 / 错误定位',
    category: 'text',
    icon: 'J',
    route: '/subpackages/tools-core/pages/json/index',
    keywords: ['JSON', '格式化', '压缩', '校验', '解析', '开发'],
    weight: 76,
  },
  {
    id: 'url',
    name: 'URL 编解码',
    desc: '链接转义与参数还原',
    category: 'text',
    icon: '链',
    route: '/subpackages/tools-core/pages/url/index',
    keywords: ['URL', '编码', '解码', '链接', '转义', '百分号'],
    weight: 70,
  },
  {
    id: 'base64',
    name: 'Base64',
    desc: 'UTF-8 文本编解码',
    category: 'text',
    icon: 'B',
    route: '/subpackages/tools-core/pages/base64/index',
    keywords: ['Base64', '编码', '解码', '文本', '转换'],
    weight: 68,
  },
  {
    id: 'password',
    name: '随机密码',
    desc: '本机生成高强度密码',
    category: 'text',
    icon: '密',
    route: '/subpackages/tools-core/pages/password/index',
    keywords: ['密码', '随机', '强密码', '生成', '字符', '安全'],
    weight: 72,
  },
  {
    id: 'bmi',
    name: 'BMI 指数',
    desc: '身体质量指数与区间提示',
    category: 'life',
    icon: '康',
    route: '/subpackages/tools-core/pages/bmi/index',
    keywords: ['BMI', '体重', '身高', '健康', '胖瘦', '指数'],
    weight: 74,
  },
  {
    id: 'compress',
    name: '图片压缩',
    desc: '本机压缩、前后体积对比',
    category: 'media',
    icon: '压',
    route: '/subpackages/tools-media/pages/compress/index',
    keywords: ['图片', '压缩', '体积', '相册', '清晰度', '照片'],
    weight: 87,
  },
  {
    id: 'palette',
    name: '图片取色',
    desc: '提取主色与五色色板',
    category: 'media',
    icon: '色',
    route: '/subpackages/tools-media/pages/palette/index',
    keywords: ['取色', '颜色', '主色', '色板', 'HEX', 'RGB', '图片'],
    weight: 66,
  },
  {
    id: 'nine-grid',
    name: '九宫格切图',
    desc: '正方形九宫格，一键保存',
    category: 'media',
    icon: '九',
    route: '/subpackages/tools-media/pages/nine-grid/index',
    keywords: ['九宫格', '切图', '朋友圈', '图片', '裁剪', '九张'],
    weight: 64,
  },
  {
    id: 'qr',
    name: '二维码生成',
    desc: '文本 / 链接转二维码',
    category: 'media',
    icon: '码',
    route: '/subpackages/tools-media/pages/qr/index',
    keywords: ['二维码', 'QR', '生成', '分享', '链接', '图片'],
    weight: 85,
  },
  {
    id: 'watermark',
    name: '水印工作台',
    desc: '图层、打码与防盗水印',
    category: 'media',
    icon: '印',
    route: '/subpackages/tools-media/pages/watermark/index',
    keywords: [
      '水印',
      '打码',
      '马赛克',
      '高斯模糊',
      'Logo',
      '防伪',
      '版权',
      '防盗',
      '图片',
      '图层',
    ],
    weight: 95,
  },
]

const TOOL_MAP: Record<string, ToolMeta> = TOOLS.reduce<Record<string, ToolMeta>>((map, tool) => {
  map[tool.id] = tool
  return map
}, {})

export const TOOL_IDS = new Set(TOOLS.map((tool) => tool.id))

export function toolsForCategories(categories: ToolCategory[]): ToolMeta[] {
  return TOOLS.filter((tool) => categories.includes(tool.category)).sort(
    (left, right) => right.weight - left.weight,
  )
}

/** 搜索：名称 + 描述 + 关键词，英文忽略大小写 */
export function searchTools(keyword: string): ToolMeta[] {
  const kw = keyword.trim().toLowerCase()
  if (!kw) {
    return []
  }
  return TOOLS.filter((tool) => {
    const haystack = [tool.name, tool.desc, ...tool.keywords].join(' ').toLowerCase()
    return haystack.includes(kw)
  }).sort((left, right) => right.weight - left.weight)
}

/** 收藏 / 最近使用：过滤下线 id 后映射为元数据 */
export function toolsFromIds(ids: string[]): ToolMeta[] {
  return ids
    .map((id) => TOOL_MAP[id])
    .filter((tool): tool is ToolMeta => Boolean(tool))
}
