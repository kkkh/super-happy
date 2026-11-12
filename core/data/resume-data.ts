/* ==========================================================================
   领域数据层 v2 · 曜石画廊
   - 本地 typed 数据兑现（云存储图片 + 本地结构化数据）
   - 数据即契约：结构与 core/types 一一对应，Service 层唯一消费入口
   ========================================================================== */
import type {
  AboutBlock,
  CategoryMeta,
  ContactLink,
  GalleryGroup,
  GreetingCard,
  Profile,
  Project,
  SkillGroup,
  StatItem,
  TimelineEra,
} from '../types/index'

/* ---- 连续编号截图生成器 ---- */
function shots(base: string, count: number, ext: 'png' | 'jpg' = 'png'): GalleryGroup['shots'] {
  const list: GalleryGroup['shots'] = []
  for (let i = 1; i <= count; i += 1) {
    list.push({ img: `${base}/${i}.${ext}` })
  }
  return list
}

/** 指定区间截图：园枢 22 张真机界面按栏目分组展示 */
function shotRange(base: string, from: number, to: number, ext: 'png' | 'jpg' = 'jpg'): GalleryGroup['shots'] {
  const list: GalleryGroup['shots'] = []
  for (let i = from; i <= to; i += 1) {
    list.push({ img: `${base}/${i}.${ext}` })
  }
  return list
}

/** 本地界面示意图图集：旧云图集不可访问，改为随包分发的本地影像 */
function localGallery(
  id: string,
  layout: 'landscape' | 'portrait' = 'landscape',
  count = 2,
): GalleryGroup[] {
  return [
    {
      title: '整体界面设计',
      layout,
      shots: shots(`/subpackages/works/assets/projects/${id}`, count, 'jpg'),
    },
  ]
}

/* ---- 个人档案 ---- */
export const profile: Profile = {
  name: '秦超',
  alias: '净忻',
  motto: '有志者事竟成。',
  location: ['山西', '太原', '迎泽'],
  email: '56967916@qq.com',
  phone: '',
  avatar: '/subpackages/grow/assets/img/avatar.jpg',
  intro: '前途广阔，大有可为。',
  heroLine: '秦超 · 作品集 2026',
}

/* ---- 社交坐标 ---- */
export const contactLinks: ContactLink[] = [
  { id: 'gitee', label: 'Gitee', handle: 'q04', qr: '/subpackages/grow/assets/img/qr-gitee.png', tone: 'iris' },
  { id: 'github', label: 'GitHub', handle: 'kkkh', qr: '/subpackages/grow/assets/img/qr-github.png', tone: 'aurora' },
  { id: 'blog', label: '我的网站', handle: '43322.cn', qr: '/subpackages/grow/assets/img/qr-blog.png', tone: 'iris' },
  { id: 'juejin', label: '掘金', handle: '人工智能专栏', qr: '/subpackages/grow/assets/img/qr-juejin.png', tone: 'amber' },
]

/* ---- 问候卡（序厅展品） ---- */
export const greetingCards: GreetingCard[] = [
  {
    id: 'hello',
    title: '您好，我是秦超',
    body: '一名把「作品即简历」当作信条的开发者。',
    icon: 'spark',
    tone: 'iris',
  },
  {
    id: 'curious',
    title: '对新技术保持好奇',
    body: '热情是唯一的燃料，尝试是唯一的路径。',
    icon: 'orbit',
    tone: 'aurora',
  },
  {
    id: 'action',
    title: '拒绝拖延',
    body: '想法落地为代码的速度，就是我的竞争力。',
    icon: 'arrow',
    tone: 'amber',
  },
]

/* ---- 关于我 · 叙事块 ---- */
export const aboutBlocks: AboutBlock[] = [
  {
    id: 'growth',
    title: '成长',
    kicker: '一路生长',
    body: ['前途广阔，大有可为。', '从校园微帮到公司级全栈交付，每一步都把「能跑」做到「能扛」。'],
    tone: 'iris',
  },
  {
    id: 'hobby',
    title: '热爱',
    kicker: '保持好奇',
    body: ['编程', '对于新技术充满着好奇及热情', '乐于尝试新鲜事物，拒绝拖延'],
    tone: 'aurora',
  },
]

/* ---- 成长时间线（三纪元 · 由真实项目历程提炼） ---- */
export const timelineEras: TimelineEra[] = [
  {
    id: 'origin',
    era: '第一纪元',
    kicker: '校园 · 起点',
    title: '萌芽 · 校园纪元',
    note: '在真实的外卖场景里看见需求，萌生「用代码解决问题」的念头。',
    tone: 'iris',
    items: [
      { title: '校园微帮', note: '从身边真实需求出发的起点' },
      { title: '外卖总台系统', note: 'Vue 全家桶 · 七大模块 · 200+ 接口编排' },
    ],
  },
  {
    id: 'engineering',
    era: '第二纪元',
    kicker: '职场 · 工程',
    title: '进阶 · 工程纪元',
    note: '进入公司级交付：从表设计到接口文档的完整闭环。',
    tone: 'aurora',
    items: [
      { title: '团队网站全栈', note: 'Vue3 + TS + Egg.js + MySQL 三端一体' },
      { title: '知产与软著后台', note: '深入垂直业务域的权限与流程建模' },
    ],
  },
  {
    id: 'craft',
    era: '第三纪元',
    kicker: '创作 · 沉淀',
    title: '沉淀 · 创作纪元',
    note: '自驱创作：把学到的东西做成作品，把作品写进博客。',
    tone: 'amber',
    items: [
      { title: '个人博客', note: 'Astro 博客 · 持续写作' },
      { title: '小程序简历', note: '本作前身 · 从 0 到 1 发布' },
      { title: '人工智能与全栈试验', note: '图像识别 · 资金管理 · 接口文档工具' },
    ],
  },
]

/* ---- 技能矩阵 ---- */
export const skillGroups: SkillGroup[] = [
  {
    id: 'front',
    title: '前端',
    kicker: '界面与交互',
    tone: 'iris',
    items: [
      { name: 'JavaScript', level: 4, note: '现代语法 / 异步 / 工程化' },
      { name: 'HTML5 / CSS3', level: 4, note: '语义化 / 动效' },
      { name: 'Vue 全家桶', level: 4, note: 'Vue3 + Element UI' },
      { name: 'TypeScript', level: 3, note: '严格模式 · 全链路' },
    ],
  },
  {
    id: 'back',
    title: '后端',
    kicker: '服务与数据',
    tone: 'aurora',
    items: [
      { name: 'MySQL', level: 4, note: '表设计 / 增删改查' },
      { name: 'Egg.js / Koa2', level: 3, note: '接口设计 / 拦截器' },
      { name: 'MongoDB', level: 2, note: '文档模型' },
      { name: 'Java', level: 2, note: '略懂' },
    ],
  },
  {
    id: 'tools',
    title: '工具链',
    kicker: '效率与协作',
    tone: 'amber',
    items: [
      { name: 'Git / npm', level: 4, note: '' },
      { name: 'Postman / 开发者工具', level: 4, note: '' },
      { name: 'Swagger / ECharts', level: 3, note: '' },
      { name: 'WebStorm / CLion', level: 3, note: '' },
    ],
  },
]

/* ---- 数字速览（主页前厅） ---- */
export const statItems: StatItem[] = [
  { id: 'works', label: '作品', kicker: '累计', value: 11, suffix: '+' },
  { id: 'skills', label: '技能', kicker: '掌握', value: 12, suffix: '' },
  { id: 'delivery', label: '公司级交付', kicker: '参与', value: 4, suffix: '' },
]

/* ---- 作品分类 ---- */
export const categoryMetas: CategoryMeta[] = [
  {
    category: 'actual',
    title: '实际工程',
    kicker: '公司级交付',
    description: '全栈网站、外卖总台、知识产权与软著后台。',
    shareKey: 'fly-cat-actual',
    tone: 'iris',
  },
  {
    category: 'personal',
    title: '个人作品',
    kicker: '自驱 · 创作',
    description: '博客、小程序简历、全栈系统与人工智能应用。',
    shareKey: 'fly-cat-personal',
    tone: 'aurora',
  },
]

/* ---- 作品全集 ---- */
export const projects: Project[] = [
  {
    id: 'team-work',
    category: 'actual',
    title: '团队网站全栈',
    subtitle: '前台展示 · 后台管理 · 数据库',
    /*
     * 原实现：
     * 公司团队网站项目用于公司的成功展示，让客户更了解公司实力和我们更熟悉客户需求。
     * 包括团队网站的前台展示系统、后台管理系统及数据库，用于展示团队成果和成就，便于吸引客户合作工程项目。
     */
    summary:
      '面向公司形象与客户沟通的全栈站点，覆盖前台展示、后台管理与数据库，形成从内容发布到成果呈现的完整闭环。',
    cover: '/subpackages/works/assets/covers/team-work.jpg',
    accent: 'iris',
    role: '全栈开发',
    duration: '1 个半月',
    stack: [
      { label: '前端', items: ['Vue', 'Element', 'TypeScript'] },
      { label: '后端', items: ['Egg.js'] },
      { label: '数据库', items: ['MySQL'] },
    ],
    metrics: [
      { label: '交付范围', value: '三端一体' },
      { label: '国际化', value: '多语言' },
      { label: '接口文档', value: '自动生成' },
    ],
    highlights: [
      '落地 Vue 3 与 TypeScript 的类型化开发',
      '完成流量统计与富文本常见问题模块',
      '支持多语言国际化',
      '实现加载更多与滚动体验优化',
      '搭建后台内容管理，常见问题支持发布与草稿',
    ],
    experiences: [
      '搭建 egg 基础服务框架',
      '完成轻量数据库表设计',
      '连接 MySQL 并完成增删改查',
      '以 Swagger 可视化接口文档，替代 Postman 维护',
      '按前台与后台拆分接口供给',
    ],
    gallery: localGallery('team-work'),
    shareKey: 'fly-work-team-work',
  },
  {
    id: 'take-out-food',
    category: 'actual',
    title: '校园微帮外卖总台系统',
    subtitle: '商家 · 用户 · 订单 · 财务 · 配送 · 排班',
    /*
     * 原实现：
     * 校园微帮外卖项目致力于完善校园外卖服务，提高学生用餐服务和商家交互体验。
     * 使用 Vue 全家桶 + element-ui 构建的外卖总台系统，一键总控制商家、用户、订单、财务、广告、配送、排班等全方位总台系统。
     */
    summary: '面向校园外卖场景的全方位总台系统，统一管理商家、用户、订单、财务、广告、配送与排班。',
    cover: '/subpackages/works/assets/covers/take-out-food.jpg',
    accent: 'aurora',
    role: '前端开发',
    duration: '3 个半月',
    stack: [
      { label: '前端', items: ['Vue 全家桶', 'Element UI'] },
      { label: '插件', items: ['axios', 'echarts', 'qrcode', 'mockjs'] },
    ],
    metrics: [
      { label: '接口编排', value: '200+' },
      { label: '功能域', value: '7 大模块' },
    ],
    highlights: [
      '基于整体框架完成界面设计与优化',
      '按需定制 Element UI 源码',
      '以 axios 拦截器自动筛查异常与无效参数',
      '完成 FTP 部署与线上发布',
      '接入并联调近 200 个接口',
    ],
    experiences: ['参与 egg.js 后台联调', '大规模接口编排与联调'],
    gallery: localGallery('take-out-food'),
    shareKey: 'fly-work-take-out-food',
  },
  {
    id: 'property-right',
    category: 'actual',
    title: '知识产权后台管理系统',
    subtitle: '单 / 多团队版本',
    /*
     * 原实现：
     * 用于操作知识产权申报、核查、记录、备案等功能的后台管理系统。
     * 主要模块有货币管理、案件管理、费用管理、团队管理、国家管理、事项管理、系统管理等功能模块。
     */
    summary:
      '覆盖知识产权申报、核查、记录与备案的后台系统，以权限与流程建模支撑单团队与多团队两种形态。',
    cover: '/subpackages/works/assets/covers/property-right.jpg',
    accent: 'iris',
    role: '前端开发',
    duration: '1 个半月',
    stack: [{ label: '前端', items: ['Vue', 'Element UI'] }],
    metrics: [
      { label: '功能模块', value: '7 类' },
      { label: '版本形态', value: '单 / 多团队' },
    ],
    highlights: [
      '基于 Vue 与 Element UI 完成界面',
      '深入理解知识产权后台业务',
      '完成接口调试与性能优化',
      '负责打包上传与线上部署',
      '处理图片与文件相关问题',
    ],
    experiences: ['理解多团队权限与业务建模'],
    gallery: localGallery('property-right'),
    shareKey: 'fly-work-property-right',
  },
  {
    id: 'software-work',
    category: 'actual',
    title: '软件著作权后台管理系统',
    subtitle: '订单 · 费用规则 · 常见问题',
    /*
     * 原实现：
     * 软件著作后台管理系统用于操作软件著作业务的后台管理，具有订单管理、费用规则、常见问题等功能模块。
     */
    summary: '面向软件著作权业务的后台系统，聚焦订单管理、费用规则与常见问题维护。',
    cover: '/subpackages/works/assets/covers/software-work.jpg',
    accent: 'amber',
    role: '前端开发',
    duration: '—',
    stack: [{ label: '前端', items: ['Vue', 'Element UI'] }],
    metrics: [
      { label: '核心域', value: '订单 · 费用 · 问答' },
    ],
    highlights: ['订单管理', '费用规则配置', '常见问题维护'],
    experiences: ['有志者事竟成。'],
    gallery: localGallery('software-work'),
    shareKey: 'fly-work-software-work',
  },
  {
    id: 'blog',
    category: 'personal',
    title: '个人博客',
    subtitle: 'Astro · Blog · 博客',
    /*
     * 原实现：
     * 个人博客基于 Hexo + Gitee（GitHub 也有部署，访问速度太慢）+ ocean 主题搭建的个人博客，
     * 用于记录和积累个人学习和文字。
     */
    summary: '基于 Astro 搭建的个人写作空间，记录学习心得与日常文字，持续输出与沉淀。',
    /* 原实现：`${CLOUD}/projects/personal/project_1.png`（旧云环境在当前 AppID 下不可用）
       现使用用户提供的博客封面，放在作品分包内以控制主包体积 */
    cover: '/subpackages/works/assets/blog/cover.jpg',
    accent: 'aurora',
    role: '独立作者',
    duration: '搭建约 3 周',
    stack: [{ label: '栈', items: ['Astro', '超超', '博客'] }],
    metrics: [
      { label: '部署', value: 'GitHub 单平台' },
      { label: '站点功能', value: '评论 · 统计 · 二维' },
    ],
    highlights: [
      '完成 Astro 博客搭建',
      '定制 Astro 博客视觉与交互',
      '以 Markdown 持续写作，沉淀内容',
      '实现置顶、访问统计、评论、分享与二维模型',
      '完成 Astro 站点部署与持续更新',
    ],
    experiences: ['持续写作与知识沉淀'],
    gallery: [
      {
        title: '整体界面设计',
        layout: 'portrait',
        /* 用户提供的 9 张手机端界面截图 */
        shots: shots('/subpackages/works/assets/blog', 9, 'jpg'),
      },
    ],
    shareKey: 'fly-work-blog',
  },
  {
    id: 'yuan-shu',
    category: 'personal',
    title: '园枢 · 校园应用',
    subtitle: 'iOS 原生 · 山西晋中理工学院',
    /*
     * 项目来源：山西晋中理工学院校园信息聚合应用「园枢」，
     * 官网 https://jl.43322.cn；从 54 张真机截图中按官网 22 张策展顺序整理。
     */
    summary:
      '面向山西晋中理工学院师生、考生与家长的校园信息聚合应用。把官网栏目与 35 个机构子站收进一个入口，覆盖要闻、公告、院系专业、招生资讯与校园风光，支持收藏、搜索、本地通知与离线阅读；无需注册，不收集个人信息。',
    cover: '/subpackages/works/assets/covers/yuan-shu.jpg',
    accent: 'iris',
    role: '独立开发',
    duration: '持续迭代',
    stack: [
      { label: '平台', items: ['iOS 26.0+', 'iPhone / iPad'] },
      { label: '能力', items: ['本地通知', 'Face ID', '离线缓存'] },
      { label: '数据', items: ['官网公开信息', 'JSON 聚合'] },
    ],
    metrics: [
      { label: '本科专业', value: '44 个' },
      { label: '机构与子站', value: '35 个' },
      { label: '真机界面', value: '22 帧' },
      { label: '信息收集', value: '0 项' },
    ],
    highlights: [
      '聚合学校官网栏目与 35 个机构子站，统一入口',
      '覆盖 44 个本科专业与招生资讯查询',
      '四通道通知轮询与点击深链',
      '三级图片缓存与弱网 / 离线降级',
      'Face ID 应用锁与全本地隐私设计',
    ],
    experiences: [
      '以官方公开数据为源，设计分层聚合架构',
      '独立完成设计、开发、官网与上架准备',
      '从冷启动、安全门到首页预热的完整体验',
    ],
    /* 图集位于 campus 独立分包，避免主包与作品分包超出 2MB */
    gallery: [
      { title: '首页与资讯', layout: 'portrait', shots: shotRange('/subpackages/campus/assets/yuan-shu', 1, 6) },
      { title: '院系与概况', layout: 'portrait', shots: shotRange('/subpackages/campus/assets/yuan-shu', 7, 12) },
      { title: '校园与个人', layout: 'portrait', shots: shotRange('/subpackages/campus/assets/yuan-shu', 13, 18) },
      { title: '阅读与设置', layout: 'portrait', shots: shotRange('/subpackages/campus/assets/yuan-shu', 19, 22) },
    ],
    shareKey: 'fly-work-yuan-shu',
  },
  {
    id: 'wechat-resume',
    category: 'personal',
    title: '小程序简历',
    subtitle: '本作前身 · 微信小程序 + Vant',
    /*
     * 原实现：
     * 基于微信小程序和 Vant 框架搭建的具有主页、个人简介、关于我的、我的技能、我的项目等页面展示。
     * 应聘时更容易让面试官了解你，从千篇一律的简历模板中脱颖而出。
     */
    summary: '以微信小程序与 Vant 搭建的轻量简历，让面试官在几屏之内读懂经历、技能与作品。',
    cover: '/subpackages/works/assets/covers/wechat-resume.jpg',
    accent: 'iris',
    role: '独立开发',
    duration: '约 1 个半月',
    stack: [{ label: '栈', items: ['微信小程序', 'Vant Weapp', '云存储'] }],
    metrics: [
      { label: '形态', value: '已发布上线' },
      { label: '进化', value: '本作前身' },
    ],
    highlights: [
      '完成小程序开发与上线',
      '以 Vant 构建界面体系',
      '打通用户授权与图片保存',
      '接入云存储完成图片读写',
      '以组件化拆分功能模块',
    ],
    experiences: ['完成从 0 到 1 的发布闭环'],
    gallery: localGallery('wechat-resume', 'portrait'),
    shareKey: 'fly-work-wechat-resume',
  },
  {
    id: 'fund-manager',
    category: 'personal',
    title: '资金管理系统',
    subtitle: 'Vue · Koa2 · MongoDB',
    /*
     * 原实现：
     * 利用 Vue 框架 + Koa2 + MongoDB 制作简易的后台管理系统。
     * 具有登录注册页面（有权限）、简单的资金管理功能和分页功能，锻炼自己的全栈开发项目经验。
     */
    summary: '以 Vue、Koa2 与 MongoDB 构建的全栈资金管理实践，覆盖登录鉴权、资金管理与分页。',
    cover: '/subpackages/works/assets/covers/fund-manager.jpg',
    accent: 'aurora',
    role: '全栈开发',
    duration: '约 1 周',
    stack: [
      { label: '前端', items: ['Vue'] },
      { label: '后端', items: ['Koa2'] },
      { label: '数据库', items: ['MongoDB'] },
    ],
    metrics: [
      { label: '架构', value: '全栈三层' },
      { label: '鉴权', value: '令牌超时' },
    ],
    highlights: [
      '完成前后端一体的全栈实践',
      '以 Koa2 与 MongoDB 搭建数据层',
      '实现令牌获取与超时处理',
      '统一 axios 请求与响应拦截',
      '引入 ESLint 并完成组件封装',
    ],
    experiences: ['权限模型与分页设计'],
    gallery: localGallery('fund-manager'),
    shareKey: 'fly-work-fund-manager',
  },
  {
    id: 'egg-interface',
    category: 'personal',
    title: 'Egg.js 后台接口工具',
    subtitle: 'egg.js · Swagger UI 自动文档',
    /*
     * 原实现：
     * 基于 egg.js 和 Swagger UI 自动生成 egg 接口文档，不需要频繁更新接口文档，
     * 保证接口文档与代码的一致，已用于实际项目开发中。
     */
    summary: '基于 egg.js 与 Swagger UI 的接口文档工具，让文档随代码自动同步，减少重复维护。',
    cover: '/subpackages/works/assets/covers/egg-interface.jpg',
    accent: 'iris',
    role: '独立开发',
    duration: '约 1 周',
    stack: [{ label: '栈', items: ['egg.js', 'Swagger UI', 'MySQL'] }],
    metrics: [
      { label: '文档一致性', value: '自动同步' },
    ],
    highlights: [
      '基于 egg 框架搭建接口服务',
      '完成 MySQL 连接与数据访问',
      '完成轻量数据库设计',
      '接入 Swagger UI 自动生成文档',
      '替代 Postman 的文档维护方式',
    ],
    experiences: ['文档与代码一致性工程实践'],
    gallery: localGallery('egg-interface'),
    shareKey: 'fly-work-egg-interface',
  },
  {
    id: 'ai-ocr',
    category: 'personal',
    title: '图片智能识别文字应用',
    subtitle: '百度人工智能接口',
    summary: '接入百度人工智能接口，上传图片即可实时识别文字，完成从图像到文本的最短闭环。',
    cover: '/subpackages/works/assets/covers/ai-ocr.jpg',
    accent: 'amber',
    role: '独立开发',
    duration: '约 1 天',
    stack: [{ label: '栈', items: ['百度人工智能接口', 'axios'] }],
    metrics: [
      { label: '闭环周期', value: '1 天' },
    ],
    highlights: [
      '完成本地图片上传',
      '接入百度开发者能力',
      '完成签名鉴权与接口调用',
      '以 axios 获取并转换识别结果',
      '打通前端与人工智能接口',
    ],
    experiences: ['人工智能能力接入的最小闭环'],
    gallery: localGallery('ai-ocr'),
    shareKey: 'fly-work-ai-ocr',
  },
  {
    id: 'xm-mall',
    category: 'personal',
    title: '仿小米闪购商城',
    subtitle: '原生 HTML · CSS · JavaScript',
    summary: '以原生 HTML、CSS 与 JavaScript 复刻小米闪购商城页面，专注布局还原与交互细节。',
    cover: '/subpackages/works/assets/covers/xm-mall.jpg',
    accent: 'aurora',
    role: '独立开发',
    duration: '约 3 天',
    stack: [{ label: '栈', items: ['HTML', 'CSS', 'JavaScript'] }],
    metrics: [
      { label: '还原度', value: '像素级' },
    ],
    highlights: [
      '还原商城布局与界面细节',
      '以原生 HTML、CSS 与 JavaScript 实现',
      '实现原生导航栏与标签栏',
      '实现原生粘性顶部栏',
    ],
    experiences: ['像素级还原官方视觉'],
    gallery: localGallery('xm-mall'),
    shareKey: 'fly-work-xm-mall',
  },
]
