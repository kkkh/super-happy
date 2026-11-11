/* ==========================================================================
   工具注册表 · 首页 / 搜索 / 收藏 / 最近使用的唯一真相源
   - 只收录已实现且路由真实存在的工具（当前 63 个）
   - 每张卡必须声明 aliases（搜索别名）与 sensitive（提示类型）
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
    aliases: ['danwei', 'dw', 'unit', 'length', 'weight', 'temperature', 'mianji', 'tiji', 'danweihuansuan', 'dwhs', '换算', '厘米', '英寸'],
    sensitive: '',
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
    aliases: ['geshui', 'gs', 'tax', 'income', 'shuihou', 'geshuijisuan', 'gsjs', '个税', '所得税', '到手'],
    sensitive: 'finance',
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
    aliases: ['fangdai', 'fd', 'loan', 'mortgage', 'yuegong', 'dai', 'fangdaisuan', 'fds', '房贷', '贷款', '月供'],
    sensitive: 'finance',
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
    aliases: ['cunkuan', 'ck', 'deposit', 'compound', 'lixi', 'cun', 'cunkuanfuli', 'ckfl', '存款', '复利'],
    sensitive: 'finance',
    weight: 88,
  },
  {
    id: 'percent',
    name: '百分比计算',
    desc: '占比 · 增减幅 · 配比',
    category: 'calc',
    icon: '百',
    route: '/subpackages/tools-daily/pages/percent/index',
    keywords: ['百分比', '占比', '比例', '涨跌幅', '增减', '配比', 'percent', 'ratio'],
    aliases: ['baifenbi', 'bfb', 'percent', 'ratio', 'zengjianfu', 'zhanbi', 'peibi', '百分比', '占比', '涨跌幅', '配比'],
    sensitive: '',
    weight: 90,
  },
  {
    id: 'ledger',
    name: '算账助手',
    desc: '折扣 · 满减 · AA 分摊',
    category: 'calc',
    icon: '账',
    route: '/subpackages/tools-daily/pages/ledger/index',
    keywords: ['算账', '折扣', '打折', '满减', 'AA', '分摊', '小费', '账单', '优惠'],
    aliases: ['suanzhang', 'sz', 'ledger', 'discount', 'manjian', 'aa', 'fentan', 'xiaofei', 'zhangdan', '算账', '折扣', '满减', '分摊'],
    sensitive: 'finance',
    weight: 92,
  },
  {
    id: 'fuel',
    name: '油耗计算',
    desc: '百公里油耗 · 每公里油费',
    category: 'calc',
    icon: '油',
    route: '/subpackages/tools-daily/pages/fuel/index',
    keywords: ['油耗', '油费', '百公里', '加油', '油价', '每公里', 'fuel'],
    aliases: ['youhao', 'yh', 'fuel', 'oil', 'jiayou', 'youfei', '油耗', '油费', '百公里', '油价'],
    sensitive: '',
    weight: 72,
  },
  {
    id: 'power',
    name: '水电燃气费',
    desc: '电费 · 水费 · 燃气 · 平价 / 阶梯费率',
    category: 'calc',
    icon: '电',
    route: '/subpackages/tools-daily/pages/power/index',
    keywords: ['电费', '水量', '水费', '燃气费', '天然气', '阶梯', '电价', '水价', '气价', '度数', 'power'],
    aliases: ['dianfei', 'shuifei', 'ranqifei', 'df', 'sf', 'rqf', 'power', 'electric', 'water', 'gas', 'dianliang', 'jieti', '电费', '水费', '燃气费', '阶梯电价', '阶梯水价'],
    sensitive: '',
    weight: 68,
  },
  {
    id: 'resolution',
    name: '分辨率与比例',
    desc: '宽高化简 · 等比缩放 · A4 / DPI 打印',
    category: 'calc',
    icon: '辨',
    route: '/subpackages/tools-daily/pages/resolution/index',
    keywords: ['分辨率', '比例', '宽高', '缩放', '16:9', '4:3', '高清', 'A4', 'A3', 'DPI', '打印尺寸', '纸张', 'resolution', 'ratio'],
    aliases: ['fenbianlv', 'fbl', 'resolution', 'ratio', 'kuangao', 'suofang', '分辨率', '比例', '宽高', '缩放'],
    sensitive: '',
    weight: 64,
  },
  {
    id: 'carloan',
    name: '车贷计算',
    desc: '单方案 / 双方案对比 · 提前还款',
    category: 'calc',
    icon: '车',
    route: '/subpackages/tools-daily/pages/carloan/index',
    keywords: ['车贷', '车价', '首付', '月供', '贷款', '利息', '对比', '提前还款', 'carloan', 'auto'],
    aliases: ['chedai', 'cd', 'carloan', 'auto', 'qiche', 'shoufu', '车贷', '车价', '首付', '月供', '贷款对比', '提前还款'],
    sensitive: 'finance',
    weight: 86,
  },
  {
    id: 'quote',
    name: '报价单',
    desc: '明细小计 · 优惠 · 税额 · CSV',
    category: 'work',
    icon: '价',
    route: '/subpackages/tools-daily/pages/quote/index',
    keywords: ['报价', '报价单', '明细', '小计', '优惠', '税额', '大写', 'CSV', 'quote'],
    aliases: ['baojia', 'bj', 'quote', 'invoice', 'baojiadan', 'mingxi', 'youhui', '报价', '报价单', '明细', '优惠'],
    sensitive: '',
    weight: 74,
  },
  {
    id: 'severance',
    name: '离职补偿',
    desc: 'N / N+1 · 封顶 · 年假折算',
    category: 'work',
    icon: '离',
    route: '/subpackages/tools-daily/pages/severance/index',
    keywords: ['离职', '补偿', '赔偿', 'N', 'N+1', '代通知金', '年假', '社平', 'severance'],
    aliases: ['lizhi', 'lz', 'severance', 'n1', 'nianjia', 'buchang', 'peichang', '离职', '补偿', '年假'],
    sensitive: 'finance',
    weight: 70,
  },
  {
    id: 'meeting-timer',
    name: '会议倒计时',
    desc: '时长 / 结束时间点 · 剩余提醒',
    category: 'date',
    icon: '会',
    route: '/subpackages/tools-daily/pages/meeting-timer/index',
    keywords: ['倒计时', '会议', '计时', '剩余', '结束时间', '提醒', 'timer', 'meeting'],
    aliases: ['huiyi', 'hy', 'timer', 'meeting', 'daojishi', 'jishi', '会议', '倒计时', '计时'],
    sensitive: '',
    weight: 73,
  },
  {
    id: 'bodyfat',
    name: '体脂率',
    desc: '海军围度公式 · 区间参考',
    category: 'life',
    icon: '脂',
    route: '/subpackages/tools-daily/pages/bodyfat/index',
    keywords: ['体脂', '体脂率', '围度', '腰围', '颈围', '臀围', '海军公式', 'bodyfat'],
    aliases: ['tizhi', 'tz', 'bodyfat', 'tizhilv', 'weidu', 'yaowei', '体脂', '体脂率', '围度', '腰围'],
    sensitive: 'health',
    weight: 66,
  },
  {
    id: 'size-convert',
    name: '尺码换算',
    desc: '鞋码 · 服装 · 戒指',
    category: 'life',
    icon: '尺',
    route: '/subpackages/tools-daily/pages/size-convert/index',
    keywords: ['尺码', '鞋码', '服装', '戒指', '鞋', '衣服', '码数', '对照', 'size'],
    aliases: ['chima', 'cm', 'size', 'shoe', 'clothing', 'ring', 'xie', 'yifu', 'jiezhi', '尺码', '鞋码', '服装', '戒指'],
    sensitive: '',
    weight: 62,
  },
  {
    id: 'id-validate',
    name: '证件号校验',
    desc: '身份证 / 银行卡 · 本机校验',
    category: 'life',
    icon: '证',
    route: '/subpackages/tools-daily/pages/id-validate/index',
    keywords: ['身份证', '银行卡', '校验', '校验位', 'Luhn', '证件', '号码', 'idcard'],
    aliases: ['shenfenzheng', 'sfz', 'idcard', 'luhn', 'yinhangka', 'yanzheng', 'zhengjian', '身份证', '银行卡', '校验'],
    sensitive: 'personal',
    privacyNote: '号码只在本机校验，不保存、不上传',
    weight: 68,
  },
  {
    id: 'avatar',
    name: '圆角头像',
    desc: '中心裁切 · 圆形 / 圆角 · PNG',
    category: 'media',
    icon: '头',
    route: '/subpackages/tools-media/pages/avatar/index',
    keywords: ['头像', '圆角头像', '圆形头像', '圆角', '裁切', 'PNG', 'avatar'],
    aliases: ['touxiang', 'tx', 'avatar', 'round', 'yuanjiao', 'touxiangzhizuo', '头像', '圆角头像', '圆形头像'],
    sensitive: 'privacy',
    weight: 75,
  },
  {
    id: 'collage',
    name: '拼图与长图',
    desc: '2×2 / 3×3 / 竖排 · 间距与背景',
    category: 'media',
    icon: '拼',
    route: '/subpackages/tools-media/pages/collage/index',
    keywords: ['拼图', '长图', '九宫格拼图', '竖排', '间距', '背景', 'collage'],
    aliases: ['pintu', 'pt', 'collage', 'longimage', 'changtu', 'pinjie', '拼图', '长图', '竖排', '九宫格'],
    sensitive: 'privacy',
    weight: 70,
  },
  {
    id: 'id-photo',
    name: '证件照换底',
    desc: '智能背景识别 · 白 / 蓝 / 红 · 本机换底',
    category: 'media',
    icon: '照',
    route: '/subpackages/tools-media/pages/id-photo/index',
    keywords: ['证件照', '换底', '白底', '蓝底', '红底', '背景', '照片', '复杂背景', '抠图', 'idphoto'],
    aliases: ['zhengjianzhao', 'zjz', 'idphoto', 'huandi', 'koutu', 'baidi', 'landi', 'hongdi', '证件照', '换底', '抠图', '白底', '蓝底', '红底'],
    sensitive: 'privacy',
    privacyNote: '照片只在本机换底，不上传、不提取人脸特征',
    weight: 58,
  },
  {
    id: 'image-pdf',
    name: '图片转 PDF',
    desc: '1–9 图 · A4 / Letter · 本机生成',
    category: 'media',
    icon: '册',
    route: '/subpackages/tools-media/pages/image-pdf/index',
    keywords: ['图片', 'PDF', '合成', '转换', 'A4', 'Letter', '导出', 'imagepdf'],
    aliases: ['tupianpdf', 'tp2pdf', 'imagepdf', 'pdf', 'hecheng', 'daochu', '图片转PDF', '合成PDF'],
    sensitive: 'privacy',
    weight: 62,
  },
  {
    id: 'barcode',
    name: '条形码生成',
    desc: 'CODE128B · 数字字母 · 本机生成',
    category: 'media',
    icon: '条',
    route: '/subpackages/tools-media/pages/barcode/index',
    keywords: ['条形码', '条码', 'CODE128', '条码生成', '商品', '打印', 'barcode'],
    aliases: ['tiaoma', 'tm', 'barcode', 'code128', 'tiaomabiao', '条形码', '条码'],
    sensitive: 'privacy',
    weight: 60,
  },
  {
    id: 'exif',
    name: '图片信息',
    desc: '尺寸 / 体积 / 格式 / 方向 · 本机读取',
    category: 'media',
    icon: '息',
    route: '/subpackages/tools-media/pages/exif/index',
    keywords: ['图片信息', 'EXIF', '尺寸', '分辨率', '体积', '格式', '方向', '图片参数', 'imageinfo'],
    aliases: ['tupianxinxi', 'tpxx', 'exif', 'imageinfo', '图片信息', '图片参数'],
    sensitive: 'privacy',
    privacyNote: '图片只在本机读取，不解析 GPS 与设备信息',
    weight: 58,
  },
  {
    id: 'qr-decode',
    name: '二维码识别',
    desc: '相册单图 · 本机解码 · 只复制不打开',
    category: 'media',
    icon: '扫',
    route: '/subpackages/tools-media/pages/qr-decode/index',
    keywords: ['二维码', '扫码', '识别', '解码', 'QR', 'qrcode', 'scan'],
    aliases: ['saoma', 'sm', 'qrdecode', 'scan', 'erweima', 'shibie', '扫码', '识别'],
    sensitive: 'privacy',
    weight: 80,
  },
  {
    id: 'lunar',
    name: '农历与节气',
    desc: '公历转农历 · 生肖 · 节气 · 生日倒计时',
    category: 'date',
    icon: '历',
    route: '/subpackages/tools-dict/pages/lunar/index',
    keywords: ['农历', '阴历', '老历', '节气', '生肖', '春节', '闰月', '生日', '倒计时', 'lunar'],
    aliases: ['nongli', 'nl', 'lunar', 'jieqi', 'nongliri', 'nonglishengri', '农历', '节气', '农历生日'],
    sensitive: '',
    weight: 84,
  },
  {
    id: 'fx-manual',
    name: '汇率换算',
    desc: '官方中间价 · 双向换算 · 仅供参考',
    category: 'calc',
    icon: '汇',
    route: '/subpackages/tools-daily/pages/fx-manual/index',
    keywords: ['汇率', '中间价', '外币', '换算', '美元', '欧元', '日元', '港币', '英镑', '澳元', '加元', 'currency', 'exchange'],
    aliases: ['huilv', 'hl', 'fx', 'exchange', 'rate', 'shoudonghuilv', '汇率', '外币', '中间价'],
    sensitive: 'finance',
    weight: 65,
  },
  {
    id: 'salary-inverse',
    name: '薪资反算',
    desc: '目标到手 · 反推税前 · 月度简化口径',
    category: 'calc',
    icon: '薪',
    route: '/subpackages/tools-daily/pages/salary-inverse/index',
    keywords: ['薪资', '工资', '到手', '税前', '税后', '五险一金', '个税', '反算', 'salary'],
    aliases: ['xinzifansuan', 'xzfs', 'salary', 'salaryinverse', 'gongzi', 'shuihou', 'xinzifansuan', '薪资', '工资', '到手', '税前'],
    sensitive: 'finance',
    weight: 67,
  },
  {
    id: 'zh-convert',
    name: '简繁转换',
    desc: '简→繁 · 繁→简 · 词组优先',
    category: 'text',
    icon: '繁',
    route: '/subpackages/tools-dict/pages/zh-convert/index',
    keywords: ['简繁', '繁体', '简体', '转换', '汉字', '繁體', '簡體', 'traditional', 'simplified', 'zh'],
    aliases: ['jianfan', 'jf', 'zhconvert', 'traditional', 'fanti', 'jianti', 'zhuanhuan', '繁体字', '简体字', '简繁转换'],
    sensitive: '',
    weight: 69,
  },
  {
    id: 'pinyin',
    name: '拼音标注',
    desc: '带声调 · 逐字对照 · 常用多音字',
    category: 'text',
    icon: '音',
    route: '/subpackages/tools-dict/pages/pinyin/index',
    keywords: ['拼音', '声调', '注音', '多音字', '汉字', 'pinyin', 'zhuyin'],
    aliases: ['pinyin', 'py', 'zhuyin', 'hanzipinyin', 'shengdiao', 'duoyinzi', '拼音', '注音', '声调'],
    sensitive: '',
    weight: 63,
  },
  {
    id: 'radix',
    name: '进制转换',
    desc: '2 / 8 / 10 / 16 进制互转',
    category: 'calc',
    icon: '进',
    route: '/subpackages/tools-core/pages/radix/index',
    keywords: ['进制', '二进制', '八进制', '十六进制', '十进制', '转换', 'hex', 'binary'],
    aliases: ['jinzhi', 'jz', 'radix', 'hex', 'binary', 'octal', 'decimal', 'shiliujinzhi'],
    sensitive: '',
    weight: 74,
  },
  {
    id: 'date-format',
    name: '日期格式',
    desc: '日期格式 · ISO 周 · 闰年',
    category: 'date',
    icon: '期',
    route: '/subpackages/tools-core/pages/date-format/index',
    keywords: ['日期', '格式', '星期', '闰年', 'ISO', '周', '第几天', 'Unix'],
    aliases: ['rqi', 'date', 'iso', 'week', 'rqgs', 'rqgz', '日期', '格式', '星期', '闰年'],
    sensitive: '',
    weight: 88,
  },
  {
    id: 'date-add',
    name: '日期加减',
    desc: '日期 ± 天 / 周 / 月 / 年 · 月末规则',
    category: 'date',
    icon: '加',
    route: '/subpackages/tools-core/pages/date-add/index',
    keywords: ['日期', '加减', '推算', '几天后', '几周后', '几个月后', '几年后', '过期', 'date'],
    aliases: ['riqijiajian', 'rqjj', 'dateadd', 'adddays', 'date', '日期加减', '日期推算', '加日期'],
    sensitive: '',
    weight: 89,
  },
  {
    id: 'timezone',
    name: '时区换算',
    desc: '跨时区墙钟 · 世界时钟同屏 · 手动夏令时',
    category: 'date',
    icon: '时',
    route: '/subpackages/tools-core/pages/timezone/index',
    keywords: ['时区', '世界时钟', 'UTC', '时差', '夏令时', '城市', 'timezone'],
    aliases: ['shiqu', 'sz', 'timezone', 'utc', 'shicha', 'shijieshizhong', '时区', '时差', '世界时钟'],
    sensitive: '',
    weight: 81,
  },
  {
    id: 'schedule',
    name: '工期排期',
    desc: '工作日推进 · 跳周末 · 休息日',
    category: 'date',
    icon: '排',
    route: '/subpackages/tools-core/pages/schedule/index',
    keywords: ['工期', '排期', '工作日', '截止日', '交付', '休息日', 'schedule'],
    aliases: ['gongqi', 'gq', 'schedule', 'deadline', 'paiban', 'gongqipaiqi', '工期', '排期', '工作日', '截止日'],
    sensitive: '',
    weight: 84,
  },
  {
    id: 'span',
    name: '日期间隔',
    desc: '自然日 · 工作日 · 周数',
    category: 'date',
    icon: '日',
    route: '/subpackages/tools-core/pages/span/index',
    keywords: ['日期', '间隔', '天数', '工作日', '周末', '相差'],
    aliases: ['riqi', 'rq', 'span', 'days', 'workday', 'tianshu', 'riqijian', 'ge', 'rqjg', '天数', '间隔', '工作日'],
    sensitive: '',
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
    aliases: ['nianling', 'nl', 'age', 'birthday', 'zhousui', 'nianlingzhousui', 'nlzs', '年龄', '生日', '周岁'],
    sensitive: '',
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
    aliases: ['daoshu', 'ds', 'countdown', 'jinianri', 'daoshuri', 'dsr', '倒数', '纪念日'],
    sensitive: '',
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
    aliases: ['shijianchuo', 'sjc', 'timestamp', 'unix', 'shijian', '时间戳'],
    sensitive: '',
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
    aliases: ['rmb', 'daxie', 'dx', 'capital', 'renminbi', 'jine', 'jinedaxie', 'jedx', '大写', '金额', '报销'],
    sensitive: '',
    weight: 90,
  },
  {
    id: 'worktime',
    name: '工时与请假',
    desc: '工时拆分 · 加班费 · 请假天数',
    category: 'work',
    icon: '工',
    route: '/subpackages/tools-daily/pages/worktime/index',
    keywords: ['工时', '加班', '请假', '工作日', '倍率', '时薪', '跨天'],
    aliases: ['gongshi', 'gs', 'worktime', 'overtime', 'leave', 'qingjia', '加班', '请假', '工时'],
    sensitive: '',
    draftExcluded: true,
    weight: 78,
  },
  {
    id: 'vcard',
    name: '二维码名片',
    desc: '图片名片 · vCard · 二维码',
    category: 'work',
    icon: '名',
    route: '/subpackages/tools-media/pages/vcard/index',
    keywords: ['名片', '图片名片', 'vCard', '二维码', '联系人', '扫码'],
    aliases: ['mingpian', 'mp', 'vcard', 'vcf', 'contact', 'qrcode', '名片', '图片名片', '联系人', '扫码'],
    sensitive: 'personal',
    privacyNote: '名片信息只在本机生成，不读取通讯录、不上传',
    weight: 66,
  },
  {
    id: 'text-convert',
    name: '文本转换',
    desc: '大小写 · 命名 · HTML · Unicode',
    category: 'text',
    icon: '文',
    route: '/subpackages/tools-core/pages/text-convert/index',
    keywords: ['文本', '大小写', '命名', '驼峰', '下划线', '短横线', 'HTML', '实体', 'Unicode', '转义'],
    aliases: ['wenben', 'wb', 'text', 'case', 'camel', 'snake', 'kebab', 'html', 'unicode', '转换'],
    sensitive: '',
    weight: 80,
  },
  {
    id: 'template',
    name: '占位符模板',
    desc: '{{变量}} 批量替换 · 缺失提示',
    category: 'text',
    icon: '模',
    route: '/subpackages/tools-core/pages/template/index',
    keywords: ['模板', '占位符', '变量', '替换', '批量', 'template', 'placeholder'],
    aliases: ['zhanweifu', 'zwf', 'template', 'placeholder', 'muban', 'mb', '模板', '占位符', '变量'],
    sensitive: '',
    weight: 71,
  },
  {
    id: 'regex',
    name: '正则测试',
    desc: '模式 · flags · 分组高亮',
    category: 'text',
    icon: '则',
    route: '/subpackages/tools-core/pages/regex/index',
    keywords: ['正则', '匹配', '模式', '分组', 'flags', 'regexp', 'pattern'],
    aliases: ['zhengze', 'zz', 'regex', 'regexp', 'pattern', 'pipei', '正则', '匹配', '测试'],
    sensitive: '',
    weight: 72,
  },
  {
    id: 'wordcount',
    name: '字数统计',
    desc: '字符、词数、行数与阅读时长',
    category: 'text',
    icon: '字',
    route: '/subpackages/tools-core/pages/wordcount/index',
    keywords: ['字数', '统计', '字符', '段落', '阅读', '文案'],
    aliases: ['zishu', 'zs', 'wordcount', 'count', 'wenzhang', 'zishutongji', 'zstj', '字数', '统计', '文案'],
    sensitive: '',
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
    aliases: ['wenben', 'wb', 'diff', 'compare', 'duibi'],
    sensitive: '',
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
    aliases: ['hash', 'md5', 'sha', 'sha1', 'sha256', 'hmac', 'zhaiyao', 'jiami'],
    sensitive: '',
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
    aliases: ['quchong', 'qc', 'dedupe', 'unique', 'sort', 'paixu', 'quchongpaixu', 'qccx', '去重', '排序', '清理'],
    sensitive: '',
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
    aliases: ['json', 'geshihua', 'format', 'jiaoyan', 'gs', '格式化', '压缩', '校验'],
    sensitive: '',
    weight: 76,
  },
  {
    id: 'json-csv',
    name: 'JSON ↔ CSV',
    desc: '双向转换 · 表头并集 · 转义',
    category: 'text',
    icon: '表',
    route: '/subpackages/tools-core/pages/json-csv/index',
    keywords: ['CSV', '表格', '转换', '导出', '表头', 'json2csv', 'csv2json'],
    aliases: ['jsoncsv', 'csv', 'table', 'json2csv', 'csv2json', 'biaoge', 'zhuanhuan', '表格', '双向转换'],
    sensitive: '',
    weight: 82,
  },
  {
    id: 'url',
    name: 'URL 编解码',
    desc: '链接转义与参数还原',
    category: 'text',
    icon: '链',
    route: '/subpackages/tools-core/pages/url/index',
    keywords: ['URL', '编码', '解码', '链接', '转义', '百分号'],
    aliases: ['url', 'urlencode', 'urldecode', 'bianma', 'jiema', 'lianjie', 'lj', 'bm', 'jm', '链接', '转义'],
    sensitive: '',
    weight: 70,
  },
  {
    id: 'base64',
    name: 'Base64',
    desc: '文本 / 图片 · 本机编解码',
    category: 'text',
    icon: 'B',
    route: '/subpackages/tools-core/pages/base64/index',
    keywords: ['Base64', '编码', '解码', '文本', '图片', 'data URL', '转换'],
    aliases: ['base64', 'b64', 'bianma', 'jiema', 'bm', 'jm', '编码', '解码'],
    sensitive: '',
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
    aliases: ['mima', 'mm', 'password', 'random', 'shengcheng', 'suijimima', 'sjmima', 'suiji', '密码', '强密码'],
    sensitive: '',
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
    aliases: ['bmi', 'tizhong', 'shengao', 'jiankang', 'zhishu', 'tz', 'sg', '体重', '身高', '胖瘦'],
    sensitive: 'health',
    weight: 74,
  },
  {
    id: 'wellness',
    name: '每日健康',
    desc: '饮水 · 热量 · 保质期',
    category: 'life',
    icon: '健',
    route: '/subpackages/tools-daily/pages/wellness/index',
    keywords: ['饮水', '喝水', '热量', '千卡', '千焦', '保质期', '到期'],
    aliases: ['yinshui', 'kaluli', 'baozhiqi', 'wellness', 'water', 'kcal', 'kj', 'shelf', '饮水', '热量', '保质期'],
    sensitive: 'health',
    weight: 82,
  },
  {
    id: 'random-pick',
    name: '随机决定',
    desc: '抽签 · 随机数 · 骰子 · 硬币',
    category: 'life',
    icon: '随',
    route: '/subpackages/tools-daily/pages/random-pick/index',
    keywords: ['随机', '抽签', '抽奖', '选择', '随机数', '骰子', '硬币', '抛硬币', '去重', '分隔符', 'Fisher-Yates'],
    aliases: ['suiji', 'sj', 'random', 'pick', 'chouqian', 'cq', 'suijishu', 'touzi', 'yingbi', '随机', '抽签', '选择', '随机数', '骰子', '硬币'],
    sensitive: '',
    weight: 70,
  },
  {
    id: 'color',
    name: '颜色转换',
    desc: 'HEX / RGB / HSL · 对比度 · 色觉模拟',
    category: 'media',
    icon: '彩',
    route: '/subpackages/tools-core/pages/color/index',
    keywords: ['颜色', '色值', 'HEX', 'RGB', 'HSL', '对比度', 'WCAG', '色盲', '配色'],
    aliases: ['yanse', 'ys', 'color', 'hex', 'rgb', 'hsl', 'duibidu', 'sezhi', '颜色', '色值', '对比度', '色盲'],
    sensitive: '',
    weight: 82,
  },
  {
    id: 'photo-edit',
    name: '图片编辑',
    desc: '裁剪 · 旋转 · 翻转 · 格式',
    category: 'media',
    icon: '修',
    route: '/subpackages/tools-media/pages/photo-edit/index',
    keywords: ['图片', '编辑', '裁剪', '旋转', '翻转', 'JPEG', 'PNG', '格式'],
    aliases: ['tupian', 'tp', 'photo', 'crop', 'rotate', 'flip', 'jpeg', 'png', '图片', '裁剪', '旋转'],
    sensitive: 'privacy',
    weight: 85,
  },
  {
    id: 'compress',
    name: '图片压缩',
    desc: '本机压缩、前后体积对比',
    category: 'media',
    icon: '压',
    route: '/subpackages/tools-media/pages/compress/index',
    keywords: ['图片', '压缩', '体积', '相册', '清晰度', '照片'],
    aliases: ['yasuo', 'ys', 'compress', 'image', 'tupian', 'tiji', 'tupianyasuo', 'tp', 'tpys', '图片压缩', '照片压缩'],
    sensitive: 'privacy',
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
    aliases: ['quse', 'qs', 'palette', 'color', 'seban', 'zhuose', 'quese', 'tuse', 'tupianquese', 'ts', 'tpqs', '取色', '色板', '颜色'],
    sensitive: 'privacy',
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
    aliases: ['jiugongge', 'jgg', 'grid', 'nine', 'qietu', 'pengyouquan', 'jiugonggeqietu', 'qt', 'jggqt', '九宫格', '切图'],
    sensitive: 'privacy',
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
    aliases: ['erweima', 'ewm', 'qr', 'qrcode', 'saoma', 'erweimashengcheng', '二维码', '扫码'],
    sensitive: 'privacy',
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
    aliases: ['shuiyin', 'sy', 'watermark', 'mosaic', 'dama', 'shuiyingongzuotai', 'mashike', '水印', '打码', '防伪', '版权', '图层'],
    sensitive: 'privacy',
    weight: 95,
  },
  {
    id: 'weather',
    name: '全息气象',
    desc: '实况 · 4 天预报 · 日出日落',
    category: 'life',
    icon: '气',
    route: '/subpackages/tools-core/pages/weather/index',
    keywords: [
      '天气',
      '气温',
      '温度',
      '预报',
      '下雨',
      '降雨',
      '风力',
      '风向',
      '湿度',
      '日出',
      '日落',
      '雷阵雨',
      '雾霾',
      '城市',
    ],
    aliases: ['tianqi', 'tq', 'weather', 'forecast', 'qixiang', 'wendu'],
    sensitive: '',
    weight: 98,
  },
  {
    id: 'web-search',
    name: '元宝搜索',
    desc: '全网实时搜索 · 腾讯元宝',
    category: 'text',
    icon: '搜',
    route: '/subpackages/tools-core/pages/web-search/index',
    keywords: [
      '搜索',
      '全网',
      '联网',
      '元宝',
      '腾讯',
      '资讯',
      '新闻',
      '百科',
      '问答',
      '网页',
      'search',
      'web',
    ],
    aliases: ['sousuo', 'ss', 'search', 'yuanbao', 'yb', 'quanwang', 'lianwang', '元宝', '全网搜索', '联网搜索'],
    sensitive: '',
    privacyNote: '查询词会发送至腾讯云元宝搜索，仅用于本次检索；查询词不写入草稿与计算轨迹',
    draftExcluded: true,
    weight: 97,
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

/** 归一化：全角转半角、去首尾空格、转小写 */
function normalizeKeyword(raw: string): string {
  let text = ''
  for (const char of raw) {
    const code = char.charCodeAt(0)
    /* 全角 ASCII（FF01–FF5E）映射回半角；全角空格统一成半角 */
    if (code === 0x3000) {
      text += ' '
    } else if (code >= 0xff01 && code <= 0xff5e) {
      text += String.fromCharCode(code - 0xfee0)
    } else {
      text += char
    }
  }
  return text.trim().toLowerCase()
}

/** 字符子序列匹配：kw 的字符按顺序出现在 haystack 中 */
function isSubsequence(kw: string, haystack: string): boolean {
  let cursor = 0
  for (const char of haystack) {
    if (char === kw[cursor]) {
      cursor += 1
      if (cursor >= kw.length) {
        return true
      }
    }
  }
  return false
}

/** 单字段命中等级：0 完全 > 1 前缀 > 2 包含 > 3 子序列；未命中 -1 */
function rankField(kw: string, field: string): number {
  if (field === kw) {
    return 0
  }
  if (field.startsWith(kw)) {
    return 1
  }
  /* 单字符只允许完全/前缀，避免子串噪声刷满结果 */
  if (kw.length < 2) {
    return -1
  }
  if (field.includes(kw)) {
    return 2
  }
  if (isSubsequence(kw, field)) {
    return 3
  }
  return -1
}

/** 命中等级：多词按空格拆分，全部命中才算匹配，取最差等级 */
function matchRank(kw: string, tool: ToolMeta): number {
  const fields = [tool.name, tool.desc, ...tool.keywords, ...tool.aliases].map((item) =>
    normalizeKeyword(item),
  )
  const tokens = kw.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) {
    return -1
  }
  let worst = 0
  for (const token of tokens) {
    let best = -1
    for (const field of fields) {
      const rank = rankField(token, field)
      if (rank >= 0 && (best < 0 || rank < best)) {
        best = rank
      }
    }
    if (best < 0) {
      return -1
    }
    worst = Math.max(worst, best)
  }
  return worst
}

/** 搜索：名称 + 描述 + 关键词 + 别名；完全 > 前缀 > 包含 > 子序列，同层按 weight */
export function searchTools(keyword: string): ToolMeta[] {
  const kw = normalizeKeyword(keyword)
  if (!kw) {
    return []
  }
  return TOOLS.map((tool) => ({ tool, rank: matchRank(kw, tool) }))
    .filter((item) => item.rank >= 0)
    .sort((left, right) => left.rank - right.rank || right.tool.weight - left.tool.weight)
    .map((item) => item.tool)
}

/** 收藏 / 最近使用：过滤下线 id 后映射为元数据 */
export function toolsFromIds(ids: string[]): ToolMeta[] {
  return ids
    .map((id) => TOOL_MAP[id])
    .filter((tool): tool is ToolMeta => Boolean(tool))
}
