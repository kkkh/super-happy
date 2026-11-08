# SKILL · 曜石画廊（个人简历小程序）

将「净忻 · 秦超」个人作品集小程序的核心业务能力，封装为 AI 可直接调用的原子接口。
数据链路与页面完全同源（Service → Transport → Result），无任何旁路。

## 能力清单

| 技能 | 用途 | 关键参数 |
|---|---|---|
| `get_profile` | 个人档案（姓名/别名/座右铭/坐标/邮箱） | — |
| `get_contact_links` | 社交坐标（Gitee/GitHub/网站/掘金） | — |
| `get_skills` | 技能矩阵（前端/后端/工具链 + 掌握度 1-5） | — |
| `get_timeline` | 成长时间线（三纪元里程碑） | — |
| `get_about` | 关于我叙事（成长与爱好） | — |
| `get_stats` | 数字速览（作品 10+ / 技能 12 / 交付 4） | — |
| `get_categories` | 作品分类元信息 | — |
| `get_projects` | 作品列表（可按分类过滤） | `category?: actual \| personal` |
| `get_project_detail` | 作品详情（摘要/技术栈/量化指标/亮点/图集） | `id`（必填） |
| `search_projects` | 全文搜索（标题/副题/角色/技术栈） | `keyword`（必填） |
| `list_favorites` | 已收藏作品列表 | — |
| `toggle_favorite` | 切换收藏（幂等可逆） | `id`（必填） |

## 调用约定

- 统一入口：`invokeSkill(name, payload)`（`core/skill/registry.ts`）
- 返回形态：`{ ok: true, data }` 或 `{ ok: false, error }`（传输层已归一化）
- 写操作仅 `toggle_favorite`，幂等可逆，无破坏性

## 典型对话流

1. 「他的技术栈是什么？」→ `get_skills`
2. 「介绍他的公司项目」→ `get_projects { category: "actual" }` → 逐个 `get_project_detail`
3. 「有没有用 Vue 做的作品？」→ `search_projects { keyword: "Vue" }`
4. 「帮我收藏外卖总台」→ `search_projects { keyword: "外卖" }` → `toggle_favorite { id: "take-out-food" }`

## 作品 id 速查

`team-work`（团队网站全栈）· `take-out-food`（外卖总台）· `property-right`（知产后台）·
`software-work`（软著后台）· `blog`（个人博客）· `wechat-resume`（小程序简历）·
`fund-manager`（资金管理）· `egg-interface`（egg 接口工具）· `ai-ocr`（AI 识图）· `xm-mall`（仿小米商城）
