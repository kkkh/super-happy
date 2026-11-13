# 超欢（CHAOHUAN）Code Wiki

> 工程名：`chaohuan-toolbox`（`package.json` 的 `name` 为 `qinchao-toolbox`）
> AppID：`wx0f5c60d97c1ce6e2`
> 应用版本：`1.2.0`（`core/constants/index.ts` 的 `APP_VERSION`）
> 渲染引擎：Skyline + glass-easel
> 基础库：`3.17.6`
> 文档基线：2026-11-12（已按当前源码全量核验）
> 校验状态：`tsc --noEmit` 通过；`npm test` 836/836 通过（复核于 2026-11-12，111 个测试文件）

本文是面向开发者的完整 Code Wiki，覆盖项目定位、技术栈、整体架构、启动编排、核心 Store、Workflow 流转引擎、65 个工具算法、全息气象站、和风天气、全息专注引擎、组件库、83 个页面、设计令牌、存储迁移、隐私与更新机制、依赖关系、运行方式、部署发布流程和扩展指南。文中路径均为仓库相对路径，关键公式与常量标注来源文件。

---

## 目录

1. [项目速览](#1-项目速览)
2. [技术栈与工程配置](#2-技术栈与工程配置)
3. [整体架构](#3-整体架构)
4. [目录结构与模块职责](#4-目录结构与模块职责)
5. [状态管理层](#5-状态管理层)
6. [工具箱领域层](#6-工具箱领域层)
7. [Workflow 流转引擎](#7-workflow-流转引擎)
8. [工具算法与 65 个工具](#8-工具算法与-65-个工具)
9. [组件库](#9-组件库)
10. [页面与路由](#10-页面与路由)
11. [设计系统与主题引擎](#11-设计系统与主题引擎)
12. [存储、迁移、隐私与更新](#12-存储迁移隐私与更新)
13. [依赖关系](#13-依赖关系)
14. [运行方式](#14-运行方式)
15. [测试与质量保障](#15-测试与质量保障)
16. [扩展指南](#16-扩展指南)
17. [已知限制与技术债](#17-已知限制与技术债)
18. [附录](#18-附录)

---

## 1. 项目速览

超欢是一个**以本机计算为核心**的微信小程序工具箱：65 个工具（「全息气象」直连高德 Web 服务、「和风天气」直连和风天气 API、「汇率换算」直连中国外汇交易中心、「元宝搜索」在用户主动搜索时直连腾讯云 WSA），附带一套个人简历 / 作品集模块（“曜石画廊”）与独立的全息专注引擎。其余 61 个工具的计算、图片处理、二维码生成、海报绘制均在本机完成；不登录、不上传业务数据，外部网络请求只有四类：高德天气只发送城市 adcode 或城市级坐标，和风天气只发送城市关键词 / 经纬度 / 城市 ID 与查询日期，汇率只请求公开 JSON、不发送金额或币种选择，元宝搜索只发送查询词与筛选条件、不发送身份或本机存储内容。

### 1.1 关键数字

| 指标 | 数值 | 说明 |
|---|---|---|
| 页面总数 | 83 | 主包 3 页 + 9 个分包共 80 页 |
| 主包页面 | 3 | `pages/index`、`pages/favorites`、`pages/mine` |
| 分包 | 9 | `tools-core`（31 页）、`tools-daily`（17 页）、`tools-media`（14 页）、`tools-dict`（3 页）、`grow`（9 页）、`works`（3 页）、`campus`（1 页）、`life`（1 页）、`weather`（1 页） |
| 工具 | 65 | 6 个分类，唯一注册表 `core/toolbox/registry.ts` |
| 工具分类 | 6 | `calc` 13 / `date` 10 / `text` 15 / `media` 14 / `life` 8 / `work` 5 |
| 主包组件 | 27 | `components/` 下 27 个组件目录 + `sound-hook.ts` |
| 分包组件 | 29 | grow 9 个、works 2 个、campus 2 个、tools-core 3 个（`weather-glyph`、`web-search-results`、`spatial-hologram`）、weather 13 个（`qw-*`） |
| 核心 TS 模块 | 77 | `core/` 下全部 `.ts`（含 2 个元宝配置示例 / 本地文件） |
| 分包 TS 模块 | 212 | `subpackages/` 下业务 `.ts`（含页面 / 组件 / lib / weather，不含 `node_modules` 与 `.d.ts`） |
| 运行时 npm 依赖 | 2 | `mobx-miniprogram`、`mobx-miniprogram-bindings` |
| 工具分包依赖 | 2 | `crypto-js`、`diff-match-patch`（仅 tools-core；grow 内有 crypto-js 副本） |
| AI SKILL 原子接口 | 12 | `core/skill/registry.ts` |
| 作品数据 | 11 | `core/data/resume-data.ts` 的 `projects` |
| 单元 / 集成测试 | 835 | 111 个 `.test.js` 文件，全部通过 |
| 存储结构版本 | 1 | `app:storage.version` |
| Spatial Glass 元数据版本 | 2 | `gallery.glass.meta` |

### 1.2 一句话架构

```text
配置层   app.json / app.ts / theme.json / project.config.json / tsconfig.json
页面层   pages/*（首页、收藏、我的）
         subpackages/tools-core/*（31 个计算/文本/日期/颜色/数据/气象工具与组件样板间）
         subpackages/tools-daily/*（算账 / 工时 / 健康 / 随机决定 / 油耗 / 水电燃气 / 分辨率 / 车贷 / 报价 / 倒计时 / 体脂 / 汇率换算 / 薪资反算 / 百分比计算 / 尺码换算 / 离职补偿 / 证件号校验）
         subpackages/tools-media/*（二维码 / 名片与 12 个图片工具，共 14 页）
         subpackages/tools-dict/*（农历与节气、简繁转换、拼音标注）
         subpackages/grow/*（简历、设置、数据驾驶舱、使用指南）
         subpackages/life/*（全息专注引擎）
         subpackages/works|campus/*（作品集与园枢图集）
         subpackages/weather/*（和风天气 8 组 API / 7 Tab）
组件层   components/*（Glass 3.0 + g-* 通用 + Workflow + 海报 + 更新守卫）
状态层   core/stores（ui / preference / history / privacy / deeplink / resume）
         core/toolbox/store（收藏 / 最近使用 / 累计打开）
         core/workflow/workflowStore（流转会话 / 流水线 / 撤销）
         store/index.ts（glassStore 门面）
服务层   core/services（request / resume / sound / motion / update / storage-governor / backup / diagnostics / export / feedback / meetingTimer / privacy-center / font-scale / yuanbao）
算法层   core/toolbox + core/workflow + 各分包 lib/utils
基础层   core/utils（logger / blackbox / haptics / album / privacy / guards / migration）
样式层   app.wxss + styles/v3.wxss + styles/generated/tailwind.wxss
```

下图把上述分层映射为依赖方向：

```mermaid
flowchart TB
  subgraph L1[配置层]
    A1["app.json / app.ts"]
    A2["theme.json / project.config.json"]
    A3["tsconfig.json / package.json"]
  end
  subgraph L2[页面层]
    P1["主包 pages/*"]
    P2["tools-core 31 页"]
    P3["tools-daily / tools-media"]
    P4["grow / works / campus"]
    P5["life 专注引擎"]
    P6["weather 和风天气"]
  end
  subgraph L3[组件层]
    C1["Glass 3.0 / g-* 通用组件"]
    C2["glass-tool-shell / workflow"]
    C3["poster / update-guard / privacy-guard"]
  end
  subgraph L4[状态层]
    S1["uiStore / preferenceStore"]
    S2["toolboxStore / historyStore"]
    S3["workflowStore / glassStore"]
  end
  subgraph L5[服务与算法层]
    V1["core/services"]
    V2["core/toolbox + core/workflow"]
    V3["分包 lib / weather / focus-fsm"]
  end
  subgraph L6[基础与样式层]
    B1["core/utils"]
    B2["app.wxss / styles"]
  end
  L1 --> L2
  L2 --> L3
  L3 --> L4
  L4 --> L5
  L5 --> L6
  L2 --> L4
  L3 --> L4
  L5 --> B1
```

> 说明：箭头表示「上层消费下层」。页面与组件都可以直接绑定状态层；服务与算法层只依赖 `core/utils`，不反向依赖页面。

### 1.3 命名说明

- **超欢 / CHAOHUAN**：工具箱产品名。
- **曜石画廊 / 净忻**：简历作品集模块的视觉叙事名。
- **Spatial Glass 26 / Glass 3.0**：液态玻璃设计体系代号。
- **白昼 / 夜航**：项目对 `light` / `dark` 两套主题的正式中文叫法，代码中仍使用 `'light' | 'dark'`。
- **全息专注引擎 / Focus**：`subpackages/life` 内的独立番茄钟 + 星云战报系统，不注册为工具，独立路由 `ROUTES.focus`。
- **全息气象站 / Weather**：联网工具之一，直连高德 Web 服务获取天气。
- **和风天气 / QWeather**：联网工具之一，独立分包 `subpackages/weather`，覆盖和风天气 8 组 API / 27 个端点。
- **汇率换算 / FX**：联网工具之一，直连中国外汇交易中心获取官方人民币汇率中间价；其余 61 个工具全部离线。

### 1.4 图表索引

| 图 | 类型 | 位置 |
|---|---|---|
| 分层架构图 | `flowchart TB` | §1.2 |
| 模块依赖图（整体） | `graph TD` | §3.1 |
| 启动编排时序 | `sequenceDiagram` | §3.2 |
| 主题链路时序 | `sequenceDiagram` | §3.3 |
| 工具计算 → 轨迹 → 驾驶舱时序 | `sequenceDiagram` | §3.4 |
| Workflow 静默流转时序 | `sequenceDiagram` | §3.4 |
| Workflow 跳转流转时序 | `sequenceDiagram` | §3.4 |
| `glass-tool-shell` 组件协作 | `flowchart LR` | §9.2 |
| 全息气象刷新时序 | `sequenceDiagram` | §8.24 |
| 全息专注状态机 | `stateDiagram-v2` | §8.25 |
| 全息专注结算时序 | `sequenceDiagram` | §8.25 |
| 隐私授权时序 | `sequenceDiagram` | §12.3 |
| 更新弹窗时序 | `sequenceDiagram` | §12.4 |
| 本地运行最短路径 | `flowchart LR` | §14.0 |
| 模块依赖图（模块级） | `graph LR` | §13.1 |

---

## 2. 技术栈与工程配置

### 2.1 运行时依赖

| 依赖 | 版本 | 使用位置 | 用途 |
|---|---|---|---|
| `mobx-miniprogram` | `^6.12.3` | 全局 | 可观察状态（`observable`、`reaction`） |
| `mobx-miniprogram-bindings` | `^7.0.1` | 页面 / 组件 | `createStoreBindings`、`storeBindingsBehavior` |

工具分包 `subpackages/tools-core/package.json` 另有：

| 依赖 | 版本 | 用途 |
|---|---|---|
| `crypto-js` | `^4.2.0` | Hash / HMAC 计算 |
| `diff-match-patch` | `^1.0.5` | 文本 Diff |

`subpackages/grow/lib/crypto-js.js` 是从 tools-core 已审计产物复制的独立副本，用于 AES 冷备保险箱，避免 grow 分包跨分包引用。

### 2.2 开发与构建依赖

| 依赖 | 用途 |
|---|---|
| `typescript` | `tsc --noEmit` 严格类型检查 |
| `tailwindcss` / `@tailwindcss/postcss` | Design Tokens v2 / 原子类 |
| `lightningcss` | Tailwind / weapp 构建期 CSS 引擎；显式锁定 1.33.0 以满足 peer 依赖 |
| `weapp-tailwindcss` / `@weapp-tailwindcss/cli` | 小程序选择器转义、rem → rpx |
| `fantasticon` | 从 `.icon-src/*.svg` 生成图标字体 |
| `remixicon` | 图标源 |
| `miniprogram-api-typings` | 微信 API 类型 |
| `miniprogram-automator` | 开发者工具自动化 / 视觉验收 |
| `miniprogram-ci` | CI 自动构建 npm 并上传开发版本 |

### 2.3 关键配置

| 文件 | 关键配置 |
|---|---|
| `app.json` | `renderer: "skyline"`、`componentFramework: "glass-easel"`、`custom` TabBar、`lazyCodeLoading: "requiredComponents"`、`preloadRule`（首页 Wi-Fi 预下载 `subpackages/tools-core`）、`workers: "workers"`、`darkmode: true`、`__usePrivacyCheck__: true`、`requiredBackgroundModes: ["audio"]`（专注 BGM）、`requiredPrivateInfos: ["getFuzzyLocation"]`（天气模糊定位） |
| `app.json` 分包 | 9 个：`tools-core`、`tools-daily`、`tools-media`、`tools-dict`、`grow`、`works`、`campus`、`life`、`weather`；共 83 页 |
| `app.json` 主题 | `navigationStyle: "custom"`、`pageOrientation: "portrait"`、`themeLocation: "theme.json"`、`backgroundColor: "@canvas"` |
| `app.json` 全局组件 | `update-guard` 与 `meeting-timer-hud` 注册在 `usingComponents`，所有页面可用 |
| `theme.json` | `light.canvas = #eef1f7`、`dark.canvas = #070a12`，导航文字黑 / 白 |
| `project.config.json` | `useCompilerPlugins: ["typescript"]`、`packNpmManually: true`、根包与 tools-core 两条 npm 构建关系、`packOptions.ignore` 排除 `node_modules` / 测试 / Markdown / 设计源文件 / `.github` / `scripts` / `private` / `.key` |
| `project.private.config.json` | `skylineRenderEnable: true`、`bigPackageSizeSupport: false` |
| `tsconfig.json` | `strict: true`、`noImplicitAny`、`noImplicitThis`、`noUnusedLocals`、`noFallthroughCasesInSwitch`、`noEmit` |
| `postcss.config.js` | 当前为空；Tailwind 管线由 npm script `build:style` 调用 |
| `sitemap.json` | `allow *`，所有页面可被搜索索引 |

### 2.4 npm scripts

| 脚本 | 命令 | 作用 |
|---|---|---|
| `build:style` | `weapp-tw -i styles/tokens.css -o styles/generated/tailwind.wxss --target weapp` | 编译 Tailwind 原子类 |
| `build:icon` | `npx fantasticon .icon-src -o .icon-dist -n gicon --font-types ttf --asset-types json` | 生成图标字体到 `.icon-dist/` |
| `pretypecheck` / `pretest` | `node scripts/ensure-weather-config.js && node scripts/ensure-yuanbao-config.js && node scripts/ensure-qweather-config.js` | 自动生成 `weather/config.local.ts`、`yuanbao/config-local.ts` 与和风 `config-local.ts`（若缺失），避免 Key 缺失导致编译失败 |
| `typecheck` | `tsc --noEmit` | 严格类型检查 |
| `test` | `node --experimental-strip-types --test tests/*.test.js` | 111 个测试文件、836 项全部单元 / 集成测试 |
| `test:hologram` | 仅 `tests/spatial-hologram.test.js` | 空间全息单测 |
| `test:integration` | `tests/*.integration.test.js` | 集成测试 |
| `test:integration:hologram` | 仅空间全息集成测试 | 集成测试 |
| `test:visual:hologram` | `node tests/visual/spatial-hologram.visual.js` | 开发者工具视觉验收（`--connect` 连接、`--dry-run` 干跑） |
| `test:e2e:palette` | `node tests/e2e/magic-wand-palette.e2e.js` | 魔法棒指令面板端到端（`--connect` 连接） |
| `test:e2e` | `node scripts/e2e-tools.js` | 42 卡路由与功能分支端到端（默认连接 9420；`test:e2e:launch` 启动工具） |
| `budget` | `node scripts/check-budget.js` | 包体积预算门禁（主包 1900KB、tools-core 1600KB、单页 24KB） |
| `plan` | `node scripts/check-plan.js` | 工具清单 / 方案完成度门禁（`EXPECT` 常量） |
| `check:version` | `node scripts/check-version.js` | 版本四源一致性：package.json / package-lock / APP_VERSION / 设置页 CHANGELOG |
| `ci:upload` | `node scripts/ci-upload.js` | 自动构建 miniprogram_npm 并上传开发版本 |

---

## 3. 整体架构

### 3.1 分层与依赖方向

```mermaid
graph TD
  APP[app.ts] --> STORES[core/stores]
  APP --> SERVICES[core/services]
  APP --> TOOLBOX[core/toolbox]
  APP --> THEME[core/theme]
  APP --> UPDATE[core/services/update]

  PAGES[pages/*] --> GLASS[store/index.ts]
  PAGES --> COMPONENTS[components/*]
  PAGES --> CORE[core/*]

  SUB[subpackages/*] --> CORE
  SUB --> LOCALLIB[分包 lib / utils]
  SUB --> COMPONENTS

  COMPONENTS --> CORE
  COMPONENTS --> COMPONENTS

  GLASS --> STORES
  GLASS --> TOOLBOX
  TOOLBOX --> STORAGE[core/toolbox/storage.ts]
  WORKFLOW[core/workflow] --> TOOLBOX
  WORKFLOW --> STORAGE
```

依赖规则：

1. **主包不得引用任何 `subpackages/*` 模块**；实际扫描 `core/`、`components/`、`pages/` 均无分包 import。
2. **分包之间不得互相引用**；`grow` / `works` / `campus` / `life` / `tools-daily` 的跨域能力全部通过主包 `core/*` 暴露。设置页读取专注数据时只消费 `focus:*` Storage 契约，不 import `life` 分包。
3. **页面不直连数据层**：简历数据通过 `core/services/resume.ts`，工具数据通过 `core/toolbox/*`。
4. **Workflow 不使用 URL 传参**：载荷只经 `workflowStore` 内存传递，URL 只承担工具路由。
5. **纯函数优先**：`workflowSilent`、`history-insights`、`money`、`date`、`rmb`、`radix`、`focus-fsm`、`focus-level`、`ledger`、`crc32` 等均为可独立测试的纯函数。
6. **组件只消费令牌**：页面 / 组件 WXSS 禁止写裸色值，统一消费 `--g-*` / `--glass-*` / `--sg-*`。
7. **网络出口收敛**：允许 `wx.request` 的只有四处：`subpackages/tools-core/weather/weatherService.ts`（高德）、`subpackages/weather/lib/qweather/client.ts`（和风天气）、`core/services/yuanbao/index.ts`（腾讯云 WSA）与 `subpackages/tools-daily/lib/fx-official.ts`（CFETS 中间价）；其他模块一律本机计算。

### 3.2 启动编排（`app.ts`）

`App.onLaunch` 的顺序是固定编排，排查启动问题按此顺序定位：

| 顺序 | 调用 | 目的 |
|---|---|---|
| 0 | `restoreStaleFocusBrightness()` | 全息专注亮度兜底：读取 `focus:brightness:v1`，`owned=true` 时恢复原亮度并删键，必须早于任何页面 |
| 0.1 | `preferenceStore.init()` | 先恢复全局偏好，供主题 / 动效 / 音效读取 |
| 0.2 | `warmUpSound()` | 按偏好延迟 700ms 预热音效 |
| 0.3 | `installPrivacyGuard()` | 注册 `wx.onNeedPrivacyAuthorization`，必须早于敏感 API |
| 0.4 | `runStorageMigrations()` | v0 → v1 本地数据迁移，先于任何 Store 读取 |
| 0.5 | `setAmbientToolCategoryResolver()` | 注册工具 id → 分类解析器 |
| 1 | `uiStore.initTheme()` | 恢复外观偏好、读取系统主题、订阅 `wx.onThemeChange`、同步原生导航 / 画布 |
| 2 | `toolboxStore.init()` | 恢复收藏、最近使用、累计打开次数 |
| 2.1 | `historyStore.init()` | 恢复本机计算轨迹 |
| 2.2 | `applyAutoClean()` | 按偏好阈值裁剪过期最近使用 |
| 2.3 | `cleanupStaleExports()` | 清理超过 24h 或总量超过 10MB 的旧导出文件 |
| 2.4 | `pruneDrafts()` | 清理超过 30 天或超出 20 个上限的工具草稿，失败不阻塞启动 |
| 3 | `resumeStore.bootstrap()` | 并发装载 profile / entries / projects |
| 4 | `installUpdateGuard()` | 初始化 `wx.getUpdateManager()`，只静默下载与暂存，不弹窗 |

其他 App 生命周期：

| 生命周期 | 行为 |
|---|---|
| `onShow(options)` | 读取 `options.query.tool` 写入 `deepLinkStore`；补一次 `applyAutoClean()` 与 `syncMeetingTimer()` |
| `onHide()` | `historyStore.flush()` 把防抖中的轨迹立即落盘；`suspendMeetingTimer()` 暂停后台计时 |
| `onError(error)` | `recordDiagnostic('app-error', error)` |
| `onUnhandledRejection(res)` | 记录 `unhandled-rejection` |
| `onPageNotFound(res)` | 记录 `page-not-found`，`switchTab` 回首页，失败再 `reLaunch` |
| `onMemoryWarning(res)` | `uiStore.enterLowMemoryMode()` 并记录 `memory-warning` |

启动时序如下：

```mermaid
sequenceDiagram
  autonumber
  participant App as App.onLaunch
  participant Bright as 亮度兜底
  participant Pref as preferenceStore
  participant Privacy as 隐私守卫
  participant Mig as 存储迁移
  participant UI as uiStore
  participant TB as toolboxStore
  participant HIS as historyStore
  participant RES as resumeStore
  participant UPD as updateManager

  App->>Bright: restoreStaleFocusBrightness()
  Bright-->>App: 恢复 original 并删除 stale key
  App->>Pref: init()
  Pref-->>App: 偏好快照（异常回退默认值）
  App->>App: warmUpSound()
  App->>Privacy: installPrivacyGuard()
  App->>Mig: runStorageMigrations()
  App->>UI: initTheme()
  UI-->>App: themeClass / 原生栏同步
  App->>TB: init()
  App->>HIS: init()
  App->>App: applyAutoClean()
  App->>App: cleanupStaleExports()
  App->>RES: bootstrap()（异步，不阻塞首屏）
  App->>UPD: getUpdateManager() / onUpdateReady
  Note over RES,UPD: 简历装载失败只记录；更新只静默下载，不主动弹窗
```

`globalData` 只维护更新运行时：

```ts
interface AppUpdateGlobalData {
  updateManager: WechatMiniprogram.UpdateManager | null
  hasUpdate: boolean
  updateReadyListeners: Array<() => void>
  promptState: 'idle' | 'custom' | 'native' | 'dismissed'
  promptOwner: string
  blockers: number
}
```

### 3.3 主题链路

```mermaid
sequenceDiagram
  autonumber
  participant Pref as preferenceStore
  participant UI as uiStore
  participant Sys as 系统外观
  participant Native as 原生导航 / 画布
  participant Page as 页面根节点
  participant Shell as glass-tool-shell

  Pref->>UI: initTheme()
  UI->>UI: 读取 gallery.theme.mode
  UI->>Sys: wx.getAppBaseInfo().theme
  Sys-->>UI: systemTheme
  UI->>UI: resolvedTheme = themeMode === 'auto' ? systemTheme : themeMode
  UI->>Native: setNavigationBarColor() + setBackgroundColor()
  UI->>Sys: wx.onThemeChange()（auto 模式实时跟随）
  UI-->>Page: themeClass = theme-* + motion-* + 可选 light-off
  Page->>Page: 根节点绑定 themeClass
  Shell->>Native: pageLifetimes.show → syncNativeChrome()
  Note over UI,Page: 仅昼↔夜真实翻转时 markThemeSwitching()，420ms 呼吸窗口
```

`uiStore.themeClass` 不是单一主题类，而是四段组合：主题 + 动效等级 + 光效开关。页面根节点必须完整绑定，否则省电 / 关光效可能失效。

### 3.4 数据流

#### 工具计算 → 轨迹 → 驾驶舱

```mermaid
sequenceDiagram
  autonumber
  participant Page as 工具页
  participant Lib as 分包 lib / 纯函数
  participant Shell as glass-tool-shell
  participant Tracker as tracker
  participant History as historyStore
  participant Storage as tbx 历史存储
  participant Cockpit as 数据驾驶舱

  Page->>Lib: compute() / 解析输入
  Lib-->>Page: 结果 + posterData
  Page->>Shell: setData({ hasResult, posterData })
  Shell->>Shell: observer hasResult / posterData
  Shell->>Shell: scheduleResultTrack() 160ms 防抖 + 签名去重
  Shell->>Tracker: recordToolResult()
  Tracker->>Tracker: normalizePosterData() + maskSensitiveText()
  Tracker->>History: record(脱敏摘要)
  History->>History: 内存 records（上限 100）
  History->>Storage: 350ms 防抖写入
  Cockpit->>History: 读取 records
  Cockpit->>Cockpit: buildCategoryStats / buildDailyStats / buildTimeline
  Cockpit->>Cockpit: Canvas 环形图 + 折线图
```

#### Workflow 静默流转

```mermaid
sequenceDiagram
  autonumber
  participant Src as 来源工具页
  participant Shell as glass-tool-shell
  participant Panel as workflow-panel
  participant Store as workflowStore
  participant Silent as executeSilentTool
  participant Target as 目标工具（面板内）

  Src->>Shell: 点击「流转」
  Shell->>Panel: 打开面板
  Panel->>Panel: readWorkflowSource(toolId, page.data)
  Panel->>Store: beginFlow(payload) / beginImageFlow(path)
  Store-->>Panel: session（超 50KB 先弹确认）
  Panel->>Panel: 选择 silent 目标
  Panel->>Store: runPipeline([target])
  Store->>Silent: 逐步执行纯函数（最多 4 步）
  Silent-->>Store: pipelineResult
  Store-->>Panel: 结果 / 撤销帧 / 快捷管道记忆
  Panel-->>Target: 展示结果、复制、采纳、撤销
```

#### Workflow 跳转流转

```mermaid
sequenceDiagram
  autonumber
  participant Panel as workflow-panel
  participant Store as workflowStore
  participant Nav as wx.navigateTo
  participant Target as 目标工具页
  participant Receiver as workflow-receiver
  participant Adapter as workflowAdapters
  participant Modal as glass-modal

  Panel->>Store: beginJump(toolId)
  Store-->>Panel: pendingJump（校验路由 + 类型）
  Panel->>Nav: navigateTo(tool.route)
  Nav->>Target: 打开目标页
  Target->>Receiver: attached / pageLifetimes.show
  Receiver->>Store: peekPendingJump(toolId)
  alt 输入区已有内容
    Receiver->>Modal: 二次确认是否覆盖
    Modal-->>Receiver: 用户确认 / 取消
  else 输入区为空
    Receiver->>Receiver: 直接注入
  end
  Receiver->>Store: claimPendingJump(toolId)
  Store->>Adapter: apply(page, data)
  Adapter->>Target: onReceiveWorkflow(data) 或 setData + recalculate()
  Receiver->>Store: setInjectionUndo()
  Receiver-->>Target: Toast「撤销」
  Note over Target,Store: 卸载 / 撤销 / 取消时释放图片，防止临时文件泄漏
```

### 3.5 生命周期与清理约定

- `createStoreBindings` 必须在 `onUnload` / `detached` 中 `destroyStoreBindings()`。
- 所有定时器在页面 / 组件卸载时清理；异步回调使用序列号或 `destroyed` 标志防止回写。
- `workflowStore.clear()` 在工具壳卸载时调用；图片进入孤儿队列批量删除。
- `historyStore.flush()` 在 `App.onHide`、工具壳 `pageLifetimes.hide`、`detached` 调用。
- Canvas 动画 / `requestAnimationFrame` 在 `onHide` / `onUnload` 取消。
- `ambientTheme.subscribe()` 返回取消订阅函数，首页 `cleanupPage()` 调用。
- `wx.onThemeChange` 为 App 级单例常驻，不做注销。
- 专注页：`onHide` 存断点 / 停计时 / 恢复亮度 / 暂停 BGM；`onUnload` 释放定时器、RAF、音频、网络 / 加速度监听、Store 绑定，并幂等恢复亮度。
- 天气页：`onHide` abort 在途请求、停粒子动画、挂起音频；`onUnload` 关闭 AudioContext 并释放 Canvas。
- 所有异步任务使用 `destroyed` / 序列号守卫，卸载后禁止 `setData` 与写 Storage。

---

## 4. 目录结构与模块职责

```text
.
├── app.ts                     # 应用入口与启动编排
├── app.json                   # 页面 / 分包 / TabBar / Skyline / Worker 配置
├── app.wxss                   # 全局令牌 + Tailwind + V3 引入
├── theme.json                 # 原生窗口 / 状态栏主题色
├── project.config.json        # 开发者工具与打包配置
├── tsconfig.json              # strict TypeScript
├── package.json               # npm scripts 与运行时依赖
├── custom-tab-bar/            # 自定义底部导航（3 Tab）
├── pages/
│   ├── index/                 # 工具箱首页
│   ├── favorites/             # 工具收藏
│   └── mine/                  # 我的
├── components/                # 27 个主包组件 + sound-hook.ts
├── core/
│   ├── constants/             # 路由、常量、Canvas 调色板
│   ├── data/                  # 简历 / 作品静态数据
│   ├── services/              # request / resume / sound / motion / update / storage-governor / backup / diagnostics / export / feedback / meetingTimer / privacy-center / font-scale / yuanbao
│   ├── skill/                 # AI SKILL 原子接口
│   ├── stores/                # ui / preference / history / privacy / deeplink / resume
│   ├── theme/                 # ambient-theme / contrast-guardian
│   ├── toolbox/               # registry / storage / store / share / tracker / poster / insights / favorites-sort / quotes / searchHistory / tool-session
│   ├── types/                 # 全局类型宪法
│   ├── utils/                 # logger / blackbox / haptics / album / privacy / guards / migration
│   └── workflow/              # 流转类型、配置、执行器、来源、Store、适配器
├── subpackages/
│   ├── tools-core/            # 31 个计算 / 文本 / 日期 / 颜色 / 数据 / 气象工具与组件样板间 + lib + weather/*
│   ├── tools-daily/           # 算账 / 工时 / 健康 / 随机决定 / 油耗 / 水电燃气 / 分辨率 / 车贷 / 报价 / 倒计时 / 体脂 / 汇率换算 / 薪资反算 / 百分比计算 / 尺码换算 / 离职补偿 / 证件号校验 + lib(ledger/random/fuel/power/resolution/carloan/quote/timer/bodyfat/fx/fx-official/salary/percent/size/severance/id/ui)
│   ├── tools-media/           # 二维码名片与 13 个图片工具 + image/qrcode/png/avatar/collage/idphoto/image-pdf/pdf/barcode/exif/qrdecode/worker-sandbox
│   ├── tools-dict/            # 农历与节气 / 简繁转换 / 拼音标注：lunar + zh + pinyin 词库与页面
│   ├── grow/                  # 简历域 8 页 + 设置 + 驾驶舱 + 使用指南 + 隐私说明 + Cyber Space OS
│   ├── life/                  # 全息专注引擎：页面 + fsm/storage/audio/level/nebula/crypto
│   ├── works/                 # 作品 hub / list / detail
│   ├── campus/                # 园枢校园应用详情
│   └── weather/               # 和风天气：页面外壳 + qw-screen 主屏 + qweather 数据层 + 13 个 qw-* 组件
├── store/index.ts             # glassStore 全局门面
├── styles/                    # Design Tokens / V3 / 旧工具箱样式
├── workers/compute.js         # Worker 计算入口
├── tests/                     # 836 项测试 + 视觉 / E2E
├── assets/                    # 全局小程序码 / 海报兜底图
└── CODE_WIKI.md               # 本文档
```

### 4.1 目录职责表

| 路径 | 职责 | 关键入口 |
|---|---|---|
| `app.ts` | 启动编排、全局错误、深链、更新管理器 | `App({...})` |
| `core/constants` | 路由表、版本、时序、限制、Canvas 调色板 | `ROUTES`、`TIMING`、`LIMITS` |
| `core/stores` | 全局 MobX 状态 | `uiStore`、`preferenceStore`、`historyStore` |
| `core/toolbox` | 工具注册表、收藏、最近使用、分享、轨迹、海报 | `TOOLS`、`toolboxStore` |
| `core/workflow` | 全域智能流转 | `workflowStore`、`executeSilentTool` |
| `core/services` | 传输层、简历装载、音效、动效、更新、存储治理 | `send()`、`useSound()`、`useMotion()` |
| `core/theme` | 环境光主题、对比度守护 | `ambientTheme`、`contrastGuardian` |
| `core/utils` | 日志、黑匣子、触觉、相册、隐私、迁移 | `logger`、`recordDiagnostic`、`tapTick` |
| `components` | 视觉与交互组件 | `glass-tool-shell`、`glass-toast` |
| `store/index.ts` | 统一门面：主题、收藏、作品收藏、最近使用 | `glassStore` |
| `pages` | 主包页面 | `index`、`favorites`、`mine` |
| `subpackages/tools-core` | 计算 / 文本 / 气象 / 样板间 | 31 个 `pages/*`、`lib/*`、`weather/*` |
| `subpackages/weather` | 和风天气 8 组 API | `pages/home`、`lib/qweather/*`、`components/qw-*`、`assets/icons` |
| `subpackages/tools-daily` | 生活高频工具 | `pages/ledger`、`worktime`、`wellness`、`random-pick`、`fuel`、`power`、`resolution`、`carloan`、`quote`、`meeting-timer` |
| `subpackages/tools-media` | 图片与名片工具 | 14 个 `pages/*`、`lib/*` |
| `subpackages/grow` | 简历域 + 设置 + 驾驶舱 + 使用指南 | `home`、`settings`、`cockpit`、`help` |
| `subpackages/life` | 全息专注引擎 | `pages/focus`、`lib/focus-*` |
| `subpackages/works` | 作品集 | `hub`、`list`、`detail` |
| `subpackages/campus` | 园枢详情 | `detail` |
| `workers/compute.js` | 长文本 / 去重 / Base64 / 校验和运算 | Worker 协议 |
| `tests` | Node 原生测试 + automator 视觉 / E2E | `npm test` |

### 4.2 非运行时目录

| 目录 | 用途 | 是否随包上传 |
|---|---|---|
| `.icon-src/` | 图标 SVG 源文件 | 否，`packOptions.ignore` 排除 |
| `.icon-dist/` | `build:icon` 生成的字体产物 | 否 |
| `.legacy/` | 旧组件 / 旧样式备份 | 否 |
| `.screenshots/` | 视觉验收截图 | 否 |
| `ai-skills/` | AI SKILL 说明与 `mcp.json` | 否 |
| `node_modules/` | npm 依赖源码 | 否 |
| `miniprogram_npm/` | 开发者工具构建的 npm 产物 | 是 |
| `tests/` | 单元 / 集成 / 视觉 / E2E 测试 | 否 |
| `补充文档/` | 设计与验收文档 | 否 |
| `chaohuan-ci-guide/` | CI 上传实战手册（HTML + 资产） | 否 |
| `scripts/` | 构建 / 预算 / 计划 / CI 上传脚本 | 否，`packOptions.ignore` 排除 |
| `private/` | 上传密钥等敏感文件 | 否，`.gitignore` + `packOptions.ignore` 双重排除 |
| `.trae/` / `.trae-html-share-packages/` | 编辑器与分享产物 | 否 |
| `docs/` | 预留文档目录 | 否 |

运行时真正参与小程序打包的是：`app.*`、`pages/`、`components/`、`custom-tab-bar/`、`core/`、`store/`、`subpackages/`、`styles/`、`assets/`、`workers/`、`miniprogram_npm/` 与项目配置。

---

## 5. 状态管理层

所有 Store 都使用 `observable` 创建，页面通过 `createStoreBindings` 或 `storeBindingsBehavior` 绑定。Store 只负责状态与持久化，副作用（音效 / 震动 / 动画）由服务层接管。

### 5.1 UI Store（`core/stores/ui.ts`）

```ts
export const uiStore = observable({
  toastShow: boolean
  toastMessage: string
  toastTimer: number
  themeMode: 'auto' | 'light' | 'dark'
  systemTheme: 'light' | 'dark'
  themeInited: boolean
  themeSwitching: boolean
  themeSwitchTimer: number
  lowMemory: boolean

  get resolvedTheme(): 'light' | 'dark'
  get themeClass(): string
  get themeModeLabel(): string
  get resolvedThemeLabel(): string
  markThemeSwitching(): void
  initTheme(): void
  setThemeMode(mode: ThemeMode): void
  syncNativeChrome(): void
  cycleTheme(): void
  showToast(message: string): void
  hideToast(): void
  enterLowMemoryMode(): void
})
```

关键行为：

- `initTheme()` 幂等；读取 `gallery.theme.mode`，无值保持 `auto`。
- 系统外观读取失败回退 `dark`（品牌默认基调）。
- `markThemeSwitching()` 只在昼↔夜真实翻转时置 `true`，420ms 后收口。
- `themeClass` = `theme-dark|theme-light` + `motion-full|lite|saver` + 可选 `light-off`；`motion-*` 取「用户档位」与「设备档位上限（高=full / 中=lite / 低=saver）」的较低者。
- 设备档位由 `core/utils/device-tier.ts` 判定：`getDeviceBenchmarkInfo.modelLevel` > `benchmarkLevel` > `memorySize`；开发者工具与未知设备一律高档；结果缓存 `device:tier.v1`。
- `syncNativeChrome()` 负责 `setNavigationBarColor` 与 `setBackgroundColor`；需要原生状态栏同步的页面在 `onShow` 调用，工具页由 `glass-tool-shell` 的 `pageLifetimes.show` 统一调用。
- 低内存模式由 `App.onMemoryWarning` 触发，页面 / 组件据此关闭 Canvas 动画。

### 5.2 Preference Store（`core/stores/preference.ts`）

全局偏好的唯一真相源，Storage 损坏时逐字段回退默认值。

```ts
type HapticLevel = 'off' | 'light' | 'heavy'
type MotionLevel = 'auto' | 'full' | 'lite' | 'saver'
type AutoCleanDays = 0 | 7 | 30
type FontScale = 'standard' | 'large' | 'xlarge'

interface PreferenceSnapshot {
  version: 1
  haptics: HapticLevel
  sound: boolean
  lightEffects: boolean
  motion: MotionLevel
  autoCleanDays: AutoCleanDays
  isPrivacyMasked: boolean
  isHistoryTrackingEnabled: boolean
  fontScale: FontScale
  flags: { enable_ai_assist: boolean }
}
```

默认值：

```ts
{
  version: 1,
  haptics: 'light',
  sound: true,
  lightEffects: true,
  motion: 'auto',
  autoCleanDays: 30,
  isPrivacyMasked: true,
  isHistoryTrackingEnabled: true,
  fontScale: 'standard',
  flags: { enable_ai_assist: false }
}
```

主要方法：

| 方法 | 说明 |
|---|---|
| `init()` | 启动调用一次；v1 → v0 → `tbx:prefs` 逐级回退 |
| `applySnapshot(snapshot)` | 规范化后写入会话 |
| `snapshot()` | 返回深拷贝快照 |
| `persist()` | 写 `app:prefs.v1`，失败只记录 |
| `setHaptics()` / `setSound()` / `setLightEffects()` / `setMotion()` | 单项设置并持久化 |
| `setAutoCleanDays()` | 设置最近使用清理阈值 |
| `setPrivacyMasked()` / `togglePrivacyMasked()` | 驾驶舱隐私盾 |
| `setHistoryTrackingEnabled()` | 计算轨迹总开关 |
| `setFontScale(scale)` | 字号档 standard / large / xlarge，写 `app:prefs.v1.fontScale` |
| `fontScaleLabel` | “标准 / 大 / 特大” |
| `setFlag(key, value)` | 仅允许白名单 Feature Flag |
| `statusText` | “全效模式 · 光效开启 · 音效开启” |

归一化兼容：

- 布尔 / 数字 / 旧字符串三套 `haptics` 写法。
- `motion` 兼容 `reduceMotion`、`animation`、`motionLevel`；`auto` 表示按设备档位自动匹配。
- `autoCleanDays` 兼容 `autoClearDays`、`cleanDays`、`retentionDays`。
- `fontScale` 兼容 `normal / default / 标准`、`big / 大`、`huge / 特大` 与 `1 / 1.15 / 1.3` 数值。
- 未知 Feature Flag 不会注入运行时。

### 5.3 Toolbox Store（`core/toolbox/store.ts`）

收藏 / 最近使用 / 累计打开次数。

```ts
export const toolboxStore = observable({
  favorites: string[]
  recents: string[]
  recentAt: Record<string, number>
  usageCount: number
  inited: boolean

  init(): void
  isFavorite(id: string): boolean
  toggleFavorite(id: string): FavoriteToggleResult // added/removed/full/invalid/failed
  recordRecent(id: string): void
  recordOpen(id: string): void
  clearRecents(): boolean
  pruneRecents(days: number, now?: number): number
  favoriteTools(): ToolMeta[]
  recentTools(): ToolMeta[]
  removeFavorites(ids: string[]): boolean
  clearFavorites(): boolean
  get favoriteCount(): number
  clearAll(): number
})
```

规则：

- 只存工具 id，读取时用 `TOOL_IDS` 过滤下线工具。
- 收藏上限 `MAX_FAVORITES = 100`，最近使用上限 `MAX_RECENTS = 12`。
- `toggleFavorite` 乐观更新；返回 `added / removed / full / invalid / failed`，满额不挤出旧项，落盘失败回滚并返回 `failed`。
- `recordOpen` 先 `usageCount += 1`，再刷新最近列表。
- `clearAll` 先 `historyStore.clearMemory()`，再 `purgeHistoryFromSnapshots()`，最后删除全部 `tbx:*`。
- `recentAt` 只保留当前最近列表内的 id，避免历史键无限膨胀。

### 5.4 History Store（`core/stores/history.ts`）

本机计算轨迹，最多 100 条，只存摘要，不存原始图片。

```ts
interface HistoryRecord {
  id: string
  toolId: string
  toolName: string
  category: ToolCategory
  categoryLabel: string
  icon: string
  timestamp: number
  night: boolean
  themeLabel: string
  inputSummary: string
  outputSummary: string
  inputMasked?: string
  outputMasked?: string
}
```

常量与行为：

| 项 | 值 / 行为 |
|---|---|
| `HISTORY_MAX` | `100` |
| 写入防抖 | `350ms` |
| 摘要上限 | 输入 140 字、输出 160 字、工具名 24 字 |
| 写入失败 | 砍半重试一次，并置 `writeFailed = true` |
| `flush()` | `App.onHide`、工具壳 `pageLifetimes.hide`、`detached` 调用 |
| `clear()` | 取消在途写入、清内存、删除 `tbx:history` |
| `clearMemory()` | 清内存但不删 Storage，供 `clearAll` 统一删除 `tbx:*` |
| `version` | 轻量版本号，供驾驶舱避免全量 setData |

### 5.5 Privacy Store（`core/stores/privacy.ts`）

```ts
export const privacyStore = observable({
  visible: boolean
  referrer: string
  pending: PrivacyResolve[]

  enqueue(resolve, referrer?): void
  resolveAgree(buttonId): void
  resolveDisagree(): void
  reset(): void
})
```

- `installPrivacyGuard()` 在 `app.ts` 启动时注册 `wx.onNeedPrivacyAuthorization`。
- 多个隐私接口同时 pending 时全部入栈，同意 / 拒绝后统一 resolve。
- 不持久化任何状态，授权由微信基础库记忆。
- 同意按钮必须是原生 `<button open-type="agreePrivacyAuthorization">`。

### 5.5.1 隐私中心（`subpackages/grow/lib/privacy-center.ts`）

```ts
permissionSnapshot(): Promise<PrivacySnapshot>
openPrivacySetting(): Promise<boolean>
openPrivacyContract(): Promise<boolean>
readPrivacyVersion(): number
ackPrivacyVersion(version?): boolean
privacyVersionChanged(version?): boolean
resetAllLocalData(): { removedKeys: number; backups: number }
```

- 权限快照：`wx.getSetting` 读取 `scope.userFuzzyLocation`（旧版回退 `scope.userLocation`）/ `scope.writePhotosAlbum`，`wx.getPrivacySetting` 读取 `needAuthorization` 与 `privacyContractName`；API 不可用时统一降级为 `unavailable`。
- 版本：`PRIVACY_VERSION`（当前 3）与 `app:privacy.version` 比对；设置页隐私中心首次进入提示，用户确认后写回，清空工具数据不重置，只有重置全部才清除。
- 重置全部：删除 `tbx:` / `weather:` / `focus:` / `diag:` / `cyber:`、`app:prefs.v1`、`app:prefs.v0`、`app:backup.at`、`app:privacy.version` 与 `USER_DATA_PATH/backups`、`exports`；保留 `gallery.*` 与 `app:storage.version`。
- 设置页入口：权限状态与跳转、查看隐私指引、导出本机数据（复用备份）、清除工具数据、重置全部；`tests/privacy-center.test.js` 7 条契约测试。
- 隐私版本与重置范围在 legal 页同步披露。

### 5.6 DeepLink Store（`core/stores/deeplink.ts`）

```ts
export const deepLinkStore = observable({
  pendingToolId: '',
  setPending(toolId: string): void,
  takePending(): string, // 只允许消费一次
})
```

冷 / 热启动统一入口：

- `App.onShow` 把 `options.query.tool` 写入 `deepLinkStore`。
- 首页 `onLoad` / `onShow` 消费 `takePending()`。
- 首页仅在 `onLoad` 调用一次 `wx.getEnterOptionsSync()` 作为补漏（严禁放到 `onShow`：启动参数会持续保留 `?tool=xxx`，返回首页时会二次跳链），并设置 60ms 兜底探测。

### 5.7 Resume Store（`core/stores/resume.ts`）

简历域状态唯一真相源。

```ts
export const resumeStore = observable({
  profile: Profile | null
  entries: HomeEntry[]
  projects: Project[]
  favorites: string[]
  favoritesInited: boolean

  bootstrap(): Promise<void>
  projectsByCategory(category: ProjectCategory): Project[]
  projectById(id: string): Project | null
  restoreFavorites(): void
  isFavorite(id: string): boolean
  get favoriteCount(): number
  toggleFavorite(id: string): boolean | null
})
```

- `bootstrap()` 并发调用共享同一 Promise，成功后缓存，失败清空以便重试。
- 作品收藏上限 200；Storage 视为不可信输入，只接受短字符串 id、去重、限长。
- `toggleFavorite` 乐观更新，写入失败回滚并返回 `null`。
- 数据经 `core/services/resume.ts` 的原子接口装载，页面不直连 `resume-data.ts`。

### 5.8 Glass Store（`store/index.ts`）

`glassStore` 是旧 `gallery.*` 数据、工具收藏、作品收藏、主题、最近使用的统一门面。

```ts
export const glassStore = observable({
  inited: boolean
  migration: GlassMigrationResult
  storeMeta: GlassStoreMeta | null

  init(): GlassMigrationResult
  bootstrap(): Promise<void>

  get themeMode(): GlassThemeMode
  get resolvedTheme(): GlassResolvedTheme
  get themeClass(): string
  get themeSwitching(): boolean
  setThemeMode(mode): void
  cycleTheme(): void

  get ambientPreset(): GlassAmbientPreset
  setAmbientPreset(preset): boolean
  updateStoreMeta(patch): boolean

  get toolFavorites(): string[]
  get workFavorites(): string[]
  get favorites(): GlassFavoriteRef[]
  get favoriteItems(): GlassFavoriteItem[]
  get favoriteCount(): number
  isFavorite(kind, id): boolean
  toggleFavorite(kind, id): boolean | null

  get history(): GlassHistoryItem[]
  get historyCount(): number
  recordHistory(id): boolean
  clearHistory(): boolean
  clearAll(): number
})
```

`init()` 顺序：

1. `migrateLegacyStorage()`：调用 `runStorageMigrations()`，二次清洗收藏 / 最近使用，清理非法外观偏好与废弃键。
2. `migrateGlassStore()`：写入 `gallery.glass.meta`（`version: 2`、`schema: 'spatial-glass-26'`）。
3. `toolboxStore.init()`。
4. `historyStore.init()`。
5. `resumeStore.restoreFavorites()`。
6. `uiStore.initTheme()`。

### 5.9 页面绑定方式

| 方式 | 适用 | 示例 |
|---|---|---|
| `storeBindingsBehavior` | 首页等需要 `fields` 自动映射的页面 | `pages/index/index.ts` 绑定 `glassStore` |
| `createStoreBindings` | 收藏、我的、设置、工具壳等需要显式销毁的页面 / 组件 | `toolboxStore` / `uiStore` |
| `this.data` 手动同步 | 一次性读取或非响应式场景 | 页面 `onShow` 刷新 |

所有 `createStoreBindings` 都必须配对 `destroyStoreBindings()`。

### 5.10 服务层与 AI SKILL

#### 传输层（`core/services/request.ts`）

```ts
interface TransportRequest<T> {
  domain: string
  fetcher: () => Promise<T> | T
  retries?: number
}

interface Transport {
  name: string
  execute<T>(request: TransportRequest<T>): Promise<Result<T>>
}

send<T>(request: TransportRequest<T>): Promise<Result<T>>
```

- 当前生产实现固定为 `localTransport`，本地数据零延迟返回。
- 错误统一归一化为 `AppError`（`NETWORK` / `TIMEOUT` / `PARSE` / `NOT_FOUND` / `PERMISSION` / `CANVAS` / `SAVE_ALBUM` / `UNKNOWN`）。
- 瞬态错误按 `NETWORK_POLICY` 退避重试：基数 300ms、上限 2400ms、抖动 120ms。
- 不发起任何网络请求，纯离线。

#### 简历领域接口（`core/services/resume.ts`）

| 函数 | 返回 |
|---|---|
| `fetchProfile()` | `Result<Profile>` |
| `fetchContactLinks()` | `Result<ContactLink[]>` |
| `fetchGreetingCards()` | `Result<GreetingCard[]>` |
| `fetchAboutBlocks()` | `Result<AboutBlock[]>` |
| `fetchTimeline()` | `Result<TimelineEra[]>` |
| `fetchSkills()` | `Result<SkillGroup[]>` |
| `fetchStats()` | `Result<StatItem[]>` |
| `fetchCategories()` | `Result<CategoryMeta[]>` |
| `fetchProjects(category?)` | `Result<Project[]>` |
| `fetchProjectById(id)` | `Result<Project>` |
| `searchProjects(keyword)` | `Result<Project[]>`（标题 / 副题 / 角色 / 技术栈全文匹配） |
| `fetchHomeEntries()` | `Result<HomeEntry[]>`（5 个入口星表） |
| `galleryCount(gallery)` | 图集图片总数 |

#### 静态数据（`core/data/resume-data.ts`）

- `profile`：姓名、别名、座右铭、坐标、邮箱、头像、简介、英雄副题。
- `contactLinks`：Gitee / GitHub / 网站 / 掘金。
- `greetingCards`：问候卡。
- `aboutBlocks`：关于我叙事块。
- `timelineEras`：成长纪元时间线。
- `skillGroups`：前端 / 后端 / 工具链技能组。
- `statItems`：数字速览。
- `categoryMetas`：作品分类元信息。
- `projects`：11 个作品（实际工程 + 个人作品）。

#### AI SKILL 注册表（`core/skill/registry.ts`）

12 个原子接口，与 `ai-skills/resume/mcp.json` 对应：

| 名称 | 能力 |
|---|---|
| `get_profile` | 个人档案 |
| `get_contact_links` | 社交坐标 |
| `get_skills` | 技能矩阵 |
| `get_timeline` | 成长时间线 |
| `get_about` | 关于我叙事块 |
| `get_stats` | 数字速览 |
| `get_categories` | 作品分类 |
| `get_projects` | 作品列表（可按分类过滤） |
| `get_project_detail` | 作品详情 |
| `search_projects` | 作品搜索 |
| `list_favorites` | 作品收藏列表 |
| `toggle_favorite` | 切换作品收藏 |

所有接口复用 `core/services/resume.ts`，与页面数据链路完全同源；外部入参只接受协议内枚举与短字符串。

### 5.11 基础工具与分包辅助模块

以下模块被多个页面 / Store 复用，属于基础设施层，单独列出避免遗漏。

| 模块 | 关键导出 | 职责 |
|---|---|---|
| `core/utils/logger.ts` | `logger.info/warn/error` | 统一 `[gallery][domain]` 前缀；`info` 仅开发者工具输出 |
| `core/utils/blackbox.ts` | `recordDiagnostic(kind, error, level)` | 本地错误黑匣子，环形 20 条 |
| `core/utils/perf.ts` | `startPerfSampling`、`readPerfSamples`、`mergePerfEntries` | 冷启动采样：`appLaunch` / `firstRender` / FP / FCP / LCP / `downloadPackage`；抽样 20%，环形 40 条，3s 防抖异步落盘 `perf:samples.v1` |
| `core/services/realtime-log.ts` | `logRealtime`、`shouldEmitRealtime` | 线上实时日志：黑匣子错误 / 告警转发到微信后台「实时日志」；同文案 30s 去重、单会话 100 条上限、单条 500 字符；API 缺失静默降级 |
| `core/utils/device-tier.ts` | `bootstrapDeviceTier`、`startDeviceTierDetection`、`effectiveMotion`、`isMotionCapped`、`dismissMotionHint` | 设备档位（高/中/低）与动效上限：机型档位 > 性能分 > 内存；未知回退高档；上限表 high=full / mid=lite / low=saver；限档提示可关闭（`device:tier.hintDismissed.v1`） |
| `core/utils/haptics.ts` | `vibrate`、`tapTick`、`tapSuccess`、`tapWarn`、`useHaptics` | 震动 + 语义音效统一出口，受偏好档位控制 |
| `core/utils/album.ts` | `saveImageToAlbum`、`albumFailureMessage` | 相册保存、授权补救、失败归一化 |
| `core/utils/privacy.ts` | `ensurePrivacyAuthorized()` | 敏感 API 前置隐私授权 |
| `core/utils/guards.ts` | `asArray<T>(value)` | 外部数据进入领域层前收敛为数组 |
| `core/utils/platform.ts` | `isDevtools()` | 平台探测；开发者工具 Canvas 降级依据 |
| `core/utils/storage-migration.ts` | `runStorageMigrations()` | v0 → v1 本地数据迁移 |
| `core/services/motion.ts` | `useMotion()`、`MotionProfile` | 动效等级 / 光效 / 模糊倍率读取 |
| `core/services/storage-governor.ts` | `readCacheSummary()`、`applyAutoClean()` | 本机缓存摘要、最近使用自动清理 |
| `core/services/export.ts` | `prepareExport`、`sharePrepared`、`cleanupExport`、`cleanupAllExports`、`cleanupStaleExports`、`canShareFile`、`utf8ByteLength`、`sanitizeExportName`、`escapeCsvCell` | 本机 `USER_DATA_PATH/exports` 预写 txt / md / csv / json（CSV 加 UTF-8 BOM），单文件上限 `MAX_EXPORT_BYTES = 2MB`；分享必须由用户 tap 同步触发；启动清理超过 24h 或总量超过 10MB 的旧导出 |
| `core/services/feedback.ts` | `copyText(text, message?): Promise<boolean>`、`toast(message)` | 全项目剪贴板写入唯一入口：内部前置 `ensurePrivacyAuthorized()`，拒绝时不写并提示；三份分包 `lib/ui.ts` 只做 re-export |
| `core/services/meetingTimer.ts` | `startMeetingTimer`、`startMeetingTimerAt`、`pauseMeetingTimer`、`resumeMeetingTimer`、`resetMeetingTimer`、`syncMeetingTimer`、`suspendMeetingTimer`、`subscribeMeetingTimer`、`meetingTimerStore` | 会议倒计时全局单例：跨页面按 deadline 计时、暂停冻结剩余、结束前 5 秒与结束时震动 + 声音；页面与 HUD 共用 |
| `subpackages/grow/lib/backup.ts` | `exportBackup`、`validateBackup`、`parseBackupText`、`pickBackupFile`、`applyBackup`、`applyBackupToStorage`、`deleteBackupFiles`、`readBackupAt`、`hasBackupFile` | 本机 JSON 备份：写 `USER_DATA_PATH/backups`、固定文件名、只保留 1 份、≤256KB；导入先全量校验再原子写入，失败逆序回滚；覆盖收藏 / 最近 / 搜索 / 天气城市 / 专注记录（含校验密钥）/ `app:prefs.v1` |
| `subpackages/grow/lib/diagnostics.ts` | `redactDiagnosticText`、`shouldDropDiagnosticMessage`、`sanitizeDiagnosticEntries`、`buildDiagnosticPreview`、`collectDiagnosticEnvironment`、`prepareDiagnosticFile` | 本地诊断包：版本 / 基础库 / 机型 / 路由 / 黑匣 20 条；路径、Key、Bearer、邮箱、手机号、证件号脱敏；残留用户输入整条丢弃；≤50KB；复用 `prepareExport` 写 `.txt` |
| `subpackages/grow/lib/privacy-center.ts` | `permissionSnapshot`、`openPrivacySetting`、`openPrivacyContract`、`readPrivacyVersion`、`ackPrivacyVersion`、`privacyVersionChanged`、`resetAllLocalData` | 隐私中心：定位 / 相册 / 隐私指引状态；`PRIVACY_VERSION` ↔ `app:privacy.version`；重置全部删除 tbx / weather / focus / diag / cyber / 备份 / 偏好，保留 `gallery.*` 与 `app:storage.version` |
| `core/services/font-scale.ts` | `FONT_SCALE_OPTIONS`、`scaleFor`、`currentFontScale`、`fontScaleClass`、`syncFontScaleClass`、`applyFontScale` | 字号档：standard / large / xlarge 映射 `fs-standard / fs-large / fs-xlarge`；页面 `onShow`、组件 `pageLifetimes.show` 一行同步；只改字号与行高，不缩放间距 / 图标 / Canvas |
| `core/services/yuanbao/index.ts` | `searchYuanbao`、`parseYuanbaoResponse`、`summarizeYuanbaoResults`、`isYuanbaoConfigured`、`YuanbaoError` | 元宝搜索：服务 API KEY（Bearer）或 TC3 SecretId/SecretKey；`sign.ts` 提供纯 TS SHA-256 / HMAC / TC3 签名；Pages JSON 字符串解析、HTML 清洗、官方错误码映射、RequestTask 取消；查询词不写草稿与计算轨迹 |
| `core/toolbox/engines/money.ts` | `parseCents`、`roundHalfUp`、`formatCents`、`parseBasisPoints` | 金额 / 利率唯一实现，tools-core 与 tools-daily 共享 |
| `core/toolbox/engines/date.ts` | `serialOf`、`serialOfISO`、`isoOf`、`dayDiff`、`countWeekdays`、`addWorkdays`、`countWorkdays`、`addDays`、`addMonths`、`addDate`、`dateAddSummary`、`parseDateAddWorkflow`、`isoWeekOf`、`dayOfYear`、`formatAll`、`dateSummaryText` 等 46 个导出 | 日期唯一实现：UTC 零点日序号、ISO 周、闰年 / 闰日 / 生日推进、工作日推进、月末钳制、日期加减；`tools-core/lib/date.ts` 只做薄 re-export，跨分包共享 |
| `core/toolbox/engines/color.ts` | `parseColor`、`formatColor`、`rgbToHsl`、`hslToRgb`、`relativeLuminance`、`contrastRatio`、`contrastReport`、`simulateCvd`、`cvdResults`、`colorSummary` | 颜色唯一实现：HEX / RGB / HSL 互转、WCAG 对比度与 AA/AAA、Machado 色觉模拟；页面与 silent 共用 |
| `core/toolbox/engines/csv.ts` | `escapeCsv`、`buildCsv`、`jsonToCsv`、`csvToJson`、`CSV_MAX_BYTES` | CSV 唯一实现：转义 / 公式注入防护 / 表头并集 / CRLF / 可选 BOM / CSV 解析；quote 与 json-csv 共用 |
| `core/toolbox/engines/text.ts` | `toCase`、`toNaming`、`encodeHtml`、`decodeHtml`、`escapeUnicode`、`cleanText`、`convertText` | 文本转换唯一实现：页面与 silent 执行器共用；`cleanText` 默认保留段落，支持全角转半角 / 去空格 / 中文标点 / 去空行 / 去不可见 / 并成一行；`tools-core/lib/textCase.ts` 只做薄 re-export |
| `core/toolbox/engines/random.ts` | `splitOptions`、`shuffle`、`pickOptions`、`pickUnique`、`randomInt`、`rollDice`、`flipCoins` | 随机唯一实现：页面与 silent 执行器共用；抽签 / 随机数 / 骰子 / 硬币共用 RNG；`tools-daily/lib/random.ts` 只做薄 re-export |
| `subpackages/tools-core/lib/body-engine.ts` | `bmiOf`、`bmiCategory`、`idealWeightRange`、`bmiMarkerPercent` | BMI 唯一实现：中国成人区间、理想体重范围、量表刻度；BMI 页与 silent 共用 |
| `core/toolbox/engines/loan.ts` | `planLoan`、`LoanPlan`、`LoanScheduleRow`、`LOAN_MAX_RATE_BP`、`LOAN_MAX_PERIODS` | 等额本息 / 等额本金摊还表唯一实现；房贷与车贷共用 |
| `core/toolbox/engines/resolution.ts` | `simplifyRatio`、`analyzeResolution`、`fitWidth`、`planResolution`、`printPixelSize`、`PAPER_PRESETS`、`DPI_OPTIONS` | 分辨率 / 比例 / 像素 / 高清判定 / 纸张 DPI 唯一实现；`tools-daily/lib/resolution.ts` 只做薄 re-export |
| `core/toolbox/engines/rmb.ts` | `centsToChinese(cents)` | 人民币大写唯一实现；`tools-core/lib/rmb.ts` 只做薄 re-export |
| `core/toolbox/engines/template.ts` | `extractPlaceholders`、`parseVariables`、`renderTemplate`、`templateSummaryText`、`TEMPLATE_LIMIT` | `{{变量}}` 模板唯一实现；`tools-core/lib/template.ts` 只做薄 re-export |
| `core/toolbox/engines/timer.ts` | `planDuration`、`planDeadline`、`remainingMs`、`formatRemaining`、`timerProgress`、`TIMER_TICK_MS` | 倒计时时间规划唯一实现：时长 / 结束时刻 / 跨日；`tools-daily/lib/timer.ts` 只做薄 re-export |
| `core/toolbox/privacy.ts` | `maskSensitiveText`、`maskSecretTokens`、`maskNumericText`、`maskLegacySummary` | 轨迹脱敏唯一实现：密码 / 金额 / 证件号等敏感 token 掩码 |
| `core/toolbox/searchHistory.ts` | `readSearchHistory`、`pushSearchHistory`、`removeSearchHistory`、`clearSearchHistory` | 首页搜索历史：去重、最新在前、最多 `MAX_SEARCH_HISTORY = 8` 条、单条截断 24 字 |
| `core/toolbox/quotes.ts` | `FOOTER_QUOTES`、`pickFooterQuote(random?, exclude?)` | 工具页页脚：70 条 ≤10 字短语，随机且可排除上一条 |
| `core/toolbox/types.ts` | `ToolMeta`、`ToolCategory`、`ToolSensitivity`、`FavoriteToggleResult`、`HomeSection` | 工具箱领域类型契约，注册表与 Store 共用 |
| `core/types/index.ts` | `ThemeMode`、`ResolvedTheme`、`Profile`、`ContactLink`、`Project`、`GalleryGroup` 等 | 全局类型宪法：主题、简历、作品、图集、统计 |
| `subpackages/tools-daily/lib/power.ts` | `powerBill`、`utilityBill`、`powerSummaryText`、`utilitySummaryText` | 水电燃气唯一实现：电费功率 × 时长；水气用量 × 费率表 + 基础费；阶梯与超最高档 |
| `core/toolbox/tool-session.ts` | `resolveToolSession`、`privacyTextFor`、`recordRecentOnce`、`toggleFavoriteTool`、`removeFavorites`、`clearFavorites`、`favoriteToolsSorted` | 工具会话层：元数据 / 敏感文案 / 收藏 / 最近使用唯一入口 |
| `core/toolbox/favorites-sort.ts` | `FAVORITE_SORTS`、`FAVORITE_SORT_LABELS`、`isFavoriteSort`、`sortFavoriteTools` | 收藏页排序纯函数：最近收藏 / 中文名称升序 / 固定分类顺序 + 同分类按权重降序 |
| `core/toolbox/crc32.ts` | `crc32`、`crc32Hex` | 分片传输、Cyber 快照校验共用 |
| `components/glass-toast/behavior.ts` | `glassToastBehavior` | 为自定义组件注入 `this.$toast()` |
| `subpackages/tools-media/lib/image.ts` | `chooseSingleImage`、`getFileSize`、`getImageInfo`、`formatBytes`、`saveImageToAlbum` | 图片工具公共能力 |
| `subpackages/grow/lib/card.ts` | `CARD_W`、`CARD_H`、`computeCardDisplaySize`、`maxCardHeightFor`、`drawCardBase`、`drawAvatar`、`drawAvatarFallback`、`drawCardBody` | 名片 Canvas 绘制内核 |
| `subpackages/grow/lib/crypto-js.d.ts` | `CryptoJS` 类型声明 | 为 grow 内复制的 `crypto-js.js` 提供 TypeScript 类型 |

---

## 6. 工具箱领域层

### 6.1 工具注册表（`core/toolbox/registry.ts`）

`TOOLS` 是首页、搜索、收藏、最近使用、分享、指令面板、Workflow 的唯一元数据源。

```ts
type ToolCategory = 'calc' | 'date' | 'text' | 'media' | 'life' | 'work'
type ToolSensitivity = '' | 'privacy' | 'personal' | 'finance' | 'health'

interface ToolMeta {
  id: string
  name: string
  desc: string
  category: ToolCategory
  icon: string            // 1–2 个汉字/字母字标，零图片资源
  route: string
  keywords: string[]
  aliases: string[]       // 搜索别名：拼音全拼、首字母、英文与俗称
  sensitive: ToolSensitivity
  privacyNote?: string    // 覆盖 sensitive 默认提示
  draftExcluded?: boolean // 即使 sensitive 为空也不写草稿
  weight: number          // 0–100，越大越靠前
}
```

首页分区 `HOME_SECTIONS`：

| key | 标题 | 分类 |
|---|---|---|
| `calc` | 计算换算 | `calc` |
| `date` | 日期时间 | `date` |
| `text` | 文本效率 | `text` |
| `media` | 图片处理 | `media` |
| `life-work` | 生活与职场 | `life`、`work` |

导出函数：

| 函数 | 说明 |
|---|---|
| `toolsForCategories(categories)` | 按分类过滤并按 `weight` 降序 |
| `searchTools(keyword)` | 名称 + 描述 + 关键词 + 别名四字段匹配；全角归一化、空格分词、完全 > 前缀 > 包含 > 子序列，同层按 `weight` |
| `toolsFromIds(ids)` | 收藏 / 最近使用 id → 元数据，自动过滤下线 id |
| `TOOL_IDS` | `Set<string>`，用于合法性 / 深链白名单校验 |

搜索算法细节（`registry.ts`）：

- `normalizeKeyword()`：全角 ASCII（U+FF01–FF5E）转半角、全角空格转半角、`trim` + 小写。
- `rankField()`：完全相等 0、前缀 1、包含 2、字符子序列 3、未命中 -1；单字符只允许完全/前缀，避免噪声。
- `matchRank()`：按空格拆词，所有词都必须命中，取最差等级；多字段取最好等级。
- 最终排序：命中等级升序 → `weight` 降序。

### 6.2 工具箱存储（`core/toolbox/storage.ts`）

命名空间 `tbx:`，与简历的 `gallery.*` 完全隔离。

| 键 | 内容 | 上限 / 说明 |
|---|---|---|
| `tbx:recent` | 最近使用 id 列表 | 12 |
| `tbx:recent.at` | id → 毫秒时间戳 | 只保留当前列表 |
| `tbx:favorites` | 工具收藏 id 列表 | 100 |
| `tbx:usage` | 累计打开次数 | 只增不减 |
| `tbx:history` | 计算轨迹摘要 | 100 |
| `tbx:workflow.pipes` | 快捷管道记忆 | 6 |
| `tbx:workflow.garbage` | 孤儿图片回收队列 | 跨启动恢复 |
| `tbx:searchHistory` | 首页搜索历史纯文本关键词 | 8 |
| `tbx:helpBannerDismissed` | 首页使用指南横幅关闭状态 | 布尔 |
| `tbx:prefs` | 旧偏好（只读迁移） | v0 遗留 |
| `tbx:ack.finance.v1` | 旧财务提示确认 | v0 遗留 |
| `tbx:ack.health.v1` | 旧健康提示确认 | v0 遗留 |
| `tbx:legacy-tip` | 旧收藏提示 | v0 遗留 |
| `tbx:legacy-tip-home` | 首页旧收藏提示 | 当前 |

通用读写函数：

```ts
readStorage(key): unknown
writeStorage(key, value): boolean
removeStorage(key): boolean
readIdList(key): string[]
writeIdList(key, ids, limit): boolean
readTimestampMap(key): Record<string, number>
writeTimestampMap(key, map): boolean
readCount(key): number
writeCount(key, value): boolean
clearToolboxData(): number
```

所有坏数据都被逐项丢弃，不阻塞启动。

### 6.2.1 工具草稿（`core/toolbox/draft.ts`）

```ts
interface ToolDraft {
  v: 1
  mode: string
  input: Record<string, string>
  at: number
}

readDraft(toolId, now?): ToolDraft | null
saveDraft(toolId, { mode, input }, now?): 'saved' | 'skipped' | 'empty' | 'failed'
clearDraft(toolId): boolean
pruneDrafts(now?): { removed: number; kept: number }
clearAllDrafts(): number
draftAllowed(toolId): boolean
```

- 存储键 `tbx:draft.<id>`；单工具 JSON ≤4KB（UTF-8），最多 20 个工具，30 天过期，超限按 `at` 淘汰最旧。
- 只保存用户主动输入与模式，不保存结果；`sensitive !== ''` 或 `draftExcluded === true` 的工具一律 `skipped`。
- 空输入返回 `empty` 并清除旧草稿；坏数据 / 版本不符静默丢弃；写入失败返回 `failed`。
- `app.ts` 启动调用 `pruneDrafts()`；`clearToolboxData()` 按 `tbx:` 前缀扫描，天然覆盖动态草稿键。
- 页面契约：`collectDraftInput(): Record<string, string>`、`applyDraftInput(input, mode): void`、可选 `draftMode(): string`。
- 外壳 `glass-tool-shell` 首次 `pageLifetimes.show` 记录基线，600ms 后仅在草稿存在且表单未改动时显示「恢复上次输入」；`onRun`、`pageLifetimes.hide`、`detached` 保存，`onReset` 清除；恢复前再次校验，已有输入时拒绝覆盖。
- 35 个非敏感工具页接入；`weather` 因城市由 `weather:` 独立持久化登记例外；`tests/draft.test.js` 11 条契约测试。

### 6.3 最近使用保留策略（`core/toolbox/retention.ts`）

```ts
pruneRecentIds(ids, recentAt, days, now): {
  ids: string[]
  recentAt: Record<string, number>
  removed: string[]
}
```

- `days <= 0` 时原样返回。
- 缺失时间戳的旧记录按“刚刚打开”处理，升级不误删。
- 只裁剪最近使用，不触碰收藏。

### 6.4 分享与深链（`core/toolbox/share.ts`）

```ts
parseToolDeepLink(raw): ToolMeta | null
sharePayloadForTool(toolId): { title, path }
timelinePayloadForTool(toolId): { title, query }
currentPageTool(): ToolMeta | null
sharePayloadForCurrentPage(): SharePayload
timelinePayloadForCurrentPage(): TimelinePayload
```

规则：

- 分享路径统一回 `/pages/index/index`，携带 `?tool=xxx`。
- 参数经 `decodeURIComponent` + `TOOL_IDS` 白名单校验。
- 非法 / 缺失参数回退工具箱首页，绝不生成坏路径。
- 首页深链跳转延迟 300ms，1.2 秒内同工具去重。

### 6.5 埋点与脱敏（`core/toolbox/tracker.ts` / `privacy.ts`）

`recordToolResult(payload)`：

1. `preferenceStore.init()` 并检查 `isHistoryTrackingEnabled`。
2. 从 `poster` 生成输入 / 输出摘要。
3. 用 `maskSensitiveText(value, label)` 预计算 `inputMasked` / `outputMasked`。
4. 无输出摘要不写入。
5. 写入 `historyStore.record()`，同时快照当时主题（白昼 / 夜航）。

脱敏策略：

| 字段类型 | 策略 |
|---|---|
| 密码 / 账号 / 身份证 / 原文摘录 | 整体 `***` |
| 金额 / 收入 / 税额 / 健康 / 日期 | 只隐去数字，保留单位与分类 |
| 长度 / 位数 / 次数等元数据 | 放行 |
| 邮箱 / URL / 手机号 / 长令牌 | 一律 `***` |

单一真相源：`maskSensitiveText`、`maskLegacySummary`、`maskSecretTokens`。

### 6.6 海报数据契约（`core/toolbox/poster.ts`）

```ts
interface IPosterData {
  toolName: string
  category: string
  mainResult: string
  resultLabel: string
  params: Array<{ label: string; value: string }>
  extras: string[]
}
```

`normalizePosterData(raw)` 负责长度收敛：

| 字段 | 上限 |
|---|---|
| 工具名 | 24 |
| 分类 | 12 |
| 主结果 | 80 |
| 结果标签 | 24 |
| 参数 | 4 组；label 12 / value 24 |
| 衍生结论 | 4 条；每条 34 |

`mainResult` 为空视为无效，调用方回退旧字段。

### 6.7 轨迹分析（`subpackages/grow/lib/history-insights.ts`）

纯函数，驾驶舱与周报共用：

| 函数 | 输出 |
|---|---|
| `buildCategoryStats(records)` | 分类占比 |
| `buildDailyStats(records, now)` | 最近 7 日活动 |
| `formatCategoryPercentages(stats)` | 百分比文案 |
| `buildHistoryInsight(records, now)` | 周报：总数 / 本周 / 最常用 / 昼夜占比 / 连续天数 / 人格 / 标签 |
| `buildTimeline(records, ...)` | 轨迹时间线 |
| `maskSummary(text, toolId)` | 旧存档脱敏 |

人格映射：

| 分类 | 人格 |
|---|---|
| `calc` | 理性规划者 |
| `date` | 时间管理者 |
| `text` | 文字整理派 |
| `media` | 视觉创作者 |
| `life` | 生活掌控者 |
| `work` | 效率行动派 |

### 6.8 快照轨迹清理（`core/toolbox/history-snapshots.ts`）

```ts
countHistoryInSnapshots(): number
purgeHistoryFromSnapshots(): { slots: number; records: number }
purgeHistoryRecordFromSnapshots(id: string): number
```

- 扫描 `cyber:auto:v1`、`cyber:hot:v1` 中的快照 payload 与 `cyber:frames:v1` 时间轴帧。
- 只修改 `snapshot.history` / `frame.history`，保留主题 / 收藏 / 偏好。
- 修改后重算 CRC32，保证 Time Travel 仍可解码。

### 6.9 自定义 TabBar（`core/toolbox/tabbar.ts` + `custom-tab-bar/`）

```ts
selectTabBar(page, index): void
```

- 页面 `onShow` 调用 `getTabBar().setData({ selected })`。
- `custom-tab-bar` 直接订阅 `uiStore` 的 `isDark`，白昼 / 夜航两套材质。
- 切换锁 `switching` 在 `wx.switchTab` 的 `complete` 中释放，避免首次切换后锁死。

---

## 7. Workflow 流转引擎

Workflow 是项目最复杂的跨页面能力：把任意工具结果安全流转到另一个工具，分为 **静默计算（silent）** 与 **带参跳转（jump）** 两类。

### 7.1 类型契约（`core/workflow/types.ts`）

```ts
type WorkflowDataType = 'text' | 'image' | 'json'
type WorkflowRouteMode = 'silent' | 'jump'
type WorkflowContextValue = string | number | boolean

interface IWorkflowData {
  type: WorkflowDataType
  payload: string
  context?: Record<string, WorkflowContextValue>
}

interface WorkflowSession {
  sessionId: string
  data: IWorkflowData
  sourceToolId: WorkflowToolId | ''
  createdAt: number
  expiresAt: number
  consumed: boolean
  bytes: number
}
```

约束：

- `context` 只允许基础类型，禁止对象 / 数组。
- 载荷只经 `workflowStore` 内存传递，禁止 URL 传参。
- 图片载荷是 `wx.saveFile` 后的本地路径。
- `WorkflowToolId` 是 65 个工具 id 的联合类型；新增工具必须同步扩展。

### 7.2 路由配置（`core/workflow/workflowConfig.ts`）

| 工具 | 模式 | accepts |
|---|---|---|
| `base64` | silent | text / json |
| `radix` | silent | text（只接受十进制整数） |
| `date-format` | silent | text |
| `date-add` | silent | text |
| `color` | silent | text |
| `json-csv` | silent | text / json（silent 仅做 JSON → CSV） |
| `size-convert` | jump | []（纯产出） |
| `severance` | jump | []（纯产出） |
| `id-validate` | jump | text |
| `image-pdf` | jump | image |
| `barcode` | jump | text |
| `exif` | jump | image |
| `timezone` | jump | text |
| `schedule` | jump | text |
| `text-convert` | silent | text |
| `template` | silent | text |
| `resolution` | silent | text |
| `percent` | silent | text |
| `dedupe` | silent | text / json |
| `json` | silent | json / text |
| `url` | silent | text / json |
| `wordcount` | silent | text / json |
| `random-pick` | silent | text |
| `unit` | jump | text |
| `ledger` | jump | text |
| `fuel` | jump | text |
| `power` | jump | text |
| `carloan` | jump | text |
| `quote` | jump | text |
| `meeting-timer` | jump | — |
| `bodyfat` | jump | — |
| `avatar` | jump | image |
| `collage` | jump | image |
| `id-photo` | jump | image |
| `qr-decode` | jump | image |
| `lunar` | jump | text |
| `zh-convert` | jump | text |
| `pinyin` | jump | text |
| `fx-manual` | jump | text |
| `salary-inverse` | jump | text |
| `tax` | jump | text |
| `loan` | jump | text |
| `deposit` | jump | text |
| `span` | jump | text |
| `age` | jump | text |
| `countdown` | jump | text |
| `timestamp` | jump | text |
| `rmb` | jump | text |
| `regex` | jump | text |
| `photo-edit` | jump | image |
| `worktime` | jump | 空（纯产出，不可作为目标） |
| `wellness` | jump | 空（纯产出，不可作为目标） |
| `vcard` | jump | 空（纯产出，不可作为目标） |
| `text-diff` | jump | text / json |
| `hash` | jump | text / json |
| `password` | jump | 空（纯产出，不可作为目标） |
| `bmi` | jump | 空（纯产出，不可作为目标） |
| `compress` | jump | image |
| `palette` | jump | image |
| `nine-grid` | jump | image |
| `qr` | jump | text |
| `watermark` | jump | image |
| `weather` | jump | 空（纯产出，不可作为目标） |
| `qweather` | jump | 空（纯产出，不可作为目标） |
| `web-search` | jump | text |

导出函数：

```ts
isWorkflowToolId(value): value is WorkflowToolId
isSilentWorkflowTool(id): boolean
isToolCompatible(id, type): boolean
workflowToolsForType(type): ToolView[]
workflowToolName(id): string
```

`workflowToolsForType` 会把不兼容工具置灰并排在后面。

### 7.3 来源提取（`core/workflow/workflowSource.ts`）

`readWorkflowSource(toolId, page.data)` 按工具逐一声明结果字段，绝不猜测 `posterData`。65 张运行时卡字段统一登记在导出的 `WORKFLOW_SOURCE_KEYS` 中，运行时读取与 `tests/workflow-coverage.test.js` 的动态 fixture 共用同一份清单。

| 工具 | 文本字段优先级 |
|---|---|
| `unit` | `result` → `formula` |
| `radix` | `radixSummary` → `decimalText` |
| `date-format` | `dateSummary` |
| `date-add` | `dateAddSummary` |
| `color` | `colorSummary` |
| `json-csv` | `csvSummary` |
| `size-convert` | `sizeSummary` |
| `severance` | `severanceSummary` |
| `id-validate` | `idSummary` |
| `image-pdf` | 图片字段：`outputPath` |
| `barcode` | 图片字段：`outputPath` |
| `exif` | `exifSummary` |
| `timezone` | `timezoneSummary` |
| `schedule` | `scheduleSummary` |
| `text-convert` | `convertSummary` |
| `template` | `templateSummary` |
| `resolution` | `resolutionSummary` |
| `percent` | `percentSummary` |
| `regex` | `regexSummary` |
| `photo-edit` | 图片字段：`outputPath` |
| `ledger` | `ledgerSummary` |
| `fuel` | `fuelSummary` |
| `power` | `powerSummary` |
| `carloan` | `carloanSummary` |
| `quote` | `quoteSummary` |
| `meeting-timer` | `timerText` |
| `bodyfat` | `bodyfatSummary` |
| `avatar` | 图片字段：`outputPath` |
| `collage` | 图片字段：`outputPath` |
| `id-photo` | 图片字段：`outputPath` |
| `qr-decode` | `qrSummary` → `resultText` |
| `lunar` | `lunarSummary` |
| `zh-convert` | `zhSummary` |
| `pinyin` | `pinyinSummary` |
| `fx-manual` | `fxSummary` |
| `salary-inverse` | `salarySummary` |
| `worktime` | `worktimeSummary` |
| `wellness` | `wellnessSummary` |
| `random-pick` | `pickSummary` |
| `vcard` | `vcardSummary` |
| `tax` | `taxText` |
| `loan` | `monthlyText` |
| `deposit` | `totalText` |
| `span` | `calendarText` |
| `age` | `ageText` |
| `countdown` | `daysText` |
| `timestamp` | `localText` → `stampText` |
| `rmb` | `upperText` → `amountText` |
| `text-diff` | `flowPayload` → `reportText` → `copyPayload` |
| `hash` | `flowPayload` → `displayHex` → `hashHex` |
| `wordcount` | `copyPayload` → `totalText` |
| `dedupe` / `json` / `url` / `base64` | `outputText` |
| `password` | `password` |
| `bmi` | `copyPayload` |
| `weather` | `weatherSummary` → `weatherText` |
| `qweather` | `weatherSummary` |
| `web-search` | `searchSummary` |
| `palette` | `dominantHex` → `averageHex` |

图片字段：

| 工具 | 字段 |
|---|---|
| `compress` | `compressedPath` → `imagePath` |
| `qr` | `qrImagePath` |
| `watermark` | `previewSrc` → `imagePath` |
| `nine-grid` | `tiles[]` 数组（逐张流转，不做单图猜测） |

上下文提取：

| 工具 | context 键 |
|---|---|
| `unit` | `unitCategory`、`unitFrom`、`unitTo` |
| `tax` | `taxMode` |
| `loan` | `loanMode` |
| `deposit` | `depositFrequency` |
| `span` | `spanIncludeStart`、`spanExcludeWeekend` |
| `age` | `ageRef` |
| `countdown` | `countdownTarget` |
| `timestamp` | `timestampDirection`、`timestampUnit` |
| `timezone` | `timezoneSourceZone`、`timezoneSourceDst` |
| `qr` | `qrLevel`、`qrSize` |
| `compress` | `compressQuality`、`compressEdge` |

### 7.4 静默执行器（`core/workflow/workflowSilent.ts`）

```ts
executeSilentTool(toolId, input): IWorkflowData
```

支持：

| 工具 | 实现 |
|---|---|
| `base64` | UTF-8 → Base64 |
| `radix` | 十进制整数 → 2 / 8 / 16 进制（仅接受纯十进制，避免虚假承诺） |
| `date-format` | ISO 日期 → 完整格式摘要（ISO 周 / 天序 / 闰年） |
| `date-add` | `YYYY-MM-DD ±30d/w/m/y` → 结果日期 / 星期 / 相差天数（月末钳制提示） |
| `color` | HEX / RGB / HSL 任一 → 三种表示 + 对白底对比度（AA/AAA 结论） |
| `json-csv` | JSON 对象数组 → 首行表头的 CSV（字段并集 / 转义 / 可选 BOM） |
| `text-convert` | 大小写 / 命名 / HTML 实体 / Unicode / 清洗 |
| `template` | `{{key}}` 变量提取清单 |
| `resolution` | `宽x高` → 化简比例 / 像素总量 / 高清判定；纸张 + DPI → 打印像素 |
| `random-pick` | 按行或分隔符拆分后抽取 |
| `dedupe` | 去首尾空格、去空行、保序去重 |
| `json` | `JSON.parse` + 2 空格 `JSON.stringify` |
| `url` | `encodeURIComponent` |
| `wordcount` | 字符 / 不含空格 / 中文 / 英文单词 / 数字串 / 行 / 段落 |

执行器对空输入、图片输入、非法 JSON 直接抛错，由 Store 统一熔断。

### 7.5 Workflow Store（`core/workflow/workflowStore.ts`）

常量：

| 常量 | 值 | 含义 |
|---|---|---|
| `WORKFLOW_MAX_BYTES` | `50 * 1024` | 单次流转安全上限 |
| `WORKFLOW_PREVIEW_LIMIT` | `500` | 面板预览上限 |
| `WORKFLOW_MAX_PIPELINE_STEPS` | `4` | 流水线最大步数 |
| `WORKFLOW_MAX_HISTORY` | `8` | 流转历史条数 |
| `WORKFLOW_MAX_QUICK_PIPES` | `6` | 快捷管道条数 |
| `WORKFLOW_SESSION_TTL_MS` | `5 * 60 * 1000` | 会话 TTL |
| `WORKFLOW_MAX_UNDO_FRAMES` | `5` | 流水线撤销帧 |
| `WORKFLOW_MAX_INJECTION_UNDO` | `5` | 注入撤销帧 |

主要状态：

```ts
workflowStore = observable({
  panelOpen: boolean
  current: WorkflowSession | null
  oversizeDraft: WorkflowOversizeDraft | null
  pendingJump: WorkflowPendingJump | null
  ready: boolean
  pipelineResult: WorkflowPipelineResult | null
  history: WorkflowHistoryEntry[]
  quickPipes: WorkflowQuickPipe[]
  imageFiles: string[]
  injectionUndoStack: WorkflowInjectionUndo[]
  pipelineUndoStack: WorkflowUndoFrame[]
})
```

主要方法：

| 方法 | 说明 |
|---|---|
| `init()` | 恢复快捷管道与孤儿图片队列 |
| `beginFlow(type, payload, sourceToolId, context)` | 创建文本 / JSON 会话；超 50KB 只生成 draft |
| `beginImageFlow(tempFilePath, sourceToolId, context)` | 先 `saveFile` 固化路径，再按真实文件大小判断 |
| `confirmOversize()` | 用户确认超限后创建正式会话 |
| `cancelOversize()` | 取消并释放图片 draft |
| `isSessionValid(sessionId)` | sessionId + 未消费 + 未过期 + payload 非空 |
| `consumeSession(sessionId)` | 目标页消费，返回数据并立即清空上下文 |
| `beginJump(toolId)` | 校验 jump 路由与类型兼容，写入 `pendingJump` |
| `peekPendingJump(toolId)` | 只读探查，过期自动清理 |
| `claimPendingJump(toolId)` | 双重校验后原子认领 |
| `discardPendingJump(toolId?)` | 取消跳转并释放图片 |
| `closePanel(cleanup)` | 关闭面板；未消费图片进入回收队列 |
| `clear(cleanupImages)` | 全局清空：会话 / pending / 流水线 / 撤销栈 |
| `registerImageFile()` / `releaseImageFile()` / `enqueueImageGarbage()` | 图片生命周期 |
| `recordTransition(source, target)` | 快捷管道记忆 |
| `quickPipesFor(type)` | 只展示使用次数 ≥ 2 的管道 |
| `runPipeline(toolIds)` | 执行 silent 流水线，逐步熔断 |
| `undoPipeline()` | 整条回滚到起点，并反向递减快捷管道 |
| `adoptPipelineResult(sourceToolId)` | 采纳结果作为新会话 |
| `pushHistory()` / `restoreHistory()` | 历史流转记录 |
| `setInjectionUndo()` / `consumeInjectionUndo()` | 字段级注入撤销 |

安全机制：

- 超过 50KB 不直接创建正式会话，先弹二确认。
- `sessionId` 防串台，5 分钟后自动失效。
- 图片使用 `wx.saveFile` 固化，注册表记录，孤儿队列跨启动恢复。
- 流水线最多 4 步，每一步输出也检查 50KB。
- 流水线某步报错立即熔断，保留上一步正确结果。
- 撤销流水线时回滚整条链路，并清理本次产生的快捷管道记忆。

### 7.6 页面适配器（`core/workflow/workflowAdapters.ts`）

```ts
interface WorkflowAdapter {
  id: WorkflowToolId
  hasInput(page): boolean
  isReady(page): boolean
  apply(page, data): Promise<boolean>
}
```

适配器类型：

| 适配器 | 工具 | 行为 |
|---|---|---|
| `unitAdapter` | `unit` | 优先 `page.onReceiveWorkflow(data)`，否则 `setData({ value }) + recalculate()` |
| `ledger` | `ledger` | 多模式表单：三个金额字段任一有值即 `hasInput`；必须由页面 `onReceiveWorkflow` 决定写入哪个模式 |
| `spanAdapter` | `span` | 优先页面接口；默认日期不算用户输入，`formTouched` 才触发覆盖确认 |
| `timestampAdapter` | `timestamp` | 根据 context / payload 推断 `to-date` / `to-stamp`，写 `stampValue` 或 `dateValue + timeValue` |
| `qrAdapter` | `qr` | 写 `content` / `level` / `sizeKey`，调用 `generate()` |
| `compressAdapter` | `compress` | 图片元信息 + 质量 / 边长，调用 `compress()` |
| `nineGridAdapter` | `nine-grid` | 图片元信息，调用 `generate()` |
| `paletteAdapter` | `palette` | 优先 `onReceiveWorkflow` |
| `watermarkAdapter` | `watermark` | 优先 `onReceiveWorkflow` |
| `text-diff` / `hash` | 复杂双栏 / 算法页 | 必须走 `onReceiveWorkflow` |
| `password` / `bmi` / `weather` | 纯产出 | `createUnsupportedAdapter`，不可接收 |

字段级撤销：

```ts
captureInjectionDiff(page, patch): Record<string, unknown>
buildInjectionUndoPatch(...)
capturePageData(page)
isSameValue(left, right): boolean
```

`isSameValue` 对数组 / 对象递归比较；深度达到 12 层后改用 `JSON.stringify` 比对，序列化失败时才保守判为“已修改”，避免无限递归。

### 7.7 流转面板（`components/workflow-panel/`）

严格 FSM：

```text
idle → computing → showing_result
                 ↘ error
```

- 静默计算推入宏任务，先渲染极光 Loading，再跑纯函数。
- 结果超过 500 字截断为 100 字预览，完整内容进 `glass-fullscreen-reader`。
- 关闭 / 卸载 / 物理返回使用 `runSeq + isActive` 双闸，后台结果绝不回写。
- 复制 1.5s 防抖。
- 图片会话关闭即释放。

### 7.8 目标页接收器（`components/workflow-receiver/`）

- 只从 `workflowStore.pendingJump` 内存读取，禁止 URL 传参。
- `sessionId + toolId` 双重校验；`claim` 同步原子，重复生命周期只消费一次。
- 页面 `onShow` 是主动入口；`attached` 只做 400ms 有界兜底重试。
- 输入区已有内容时弹 `glass-modal` 二次确认。
- 注入后记录字段级 diff + `applied` 快照，支持精准撤销。
- 图片用完后在失败 / 取消 / 撤销 / 卸载四条路径释放。
- 页面卸载时移除未消费的撤销帧，防止内存堆积。

---

## 8. 工具算法与 65 个工具

### 8.1 金额与数值（`core/toolbox/engines/money.ts`）

统一规则：**金额以“分”为整数单位，利率以“基点”为单位**，避免浮点误差。实现已下沉到 `core/toolbox/engines/money.ts`，`subpackages/tools-core/lib/money.ts` 与 `subpackages/tools-daily/lib/...` 只做薄 re-export，跨分包共享同一套分/基点运算。

```ts
const MAX_CENTS = 1e14 // 1 万亿元

parseCents(raw, allowNegative = false): number | null
roundHalfUp(value: number): number
formatCents(cents: number): string
formatNumber(value: number, fraction = 2): string
parseBasisPoints(raw: string): number | null // 3.6% → 360bp
parseInteger(raw, min, max): number | null
parseDecimal(raw, min, max, decimals = 2): number | null
clamp(value, min, max): number
```

实现要点：

- `parseCents` 接受千分位逗号，最多两位小数，最大 12 位整数。
- `roundHalfUp` 对负数先取绝对值再四舍五入，避免 `Math.round(-0.5)` 偏差。
- `formatNumber` 使用三位分组正则。
- `parseBasisPoints` 先去 `%`，乘 100 后取整。

### 8.2 日期引擎（`core/toolbox/engines/date.ts`）

统一规则：**日期字符串按 UTC 零点计算“日序号”，展示按本地时区**，避免时区漂移。实现已下沉到 `core/toolbox/engines/date.ts`，`subpackages/tools-core/lib/date.ts` 只做薄 re-export，跨分包共享同一份日期核心。

```ts
parseISODate(raw): DateParts | null       // 严格 YYYY-MM-DD，1900–2100
serialOf(parts): number                   // UTC 零点起算天数
partsFromSerial(serial): DateParts
isoOf(parts): string
serialOfISO(raw): number | null
todayISO(): string                        // 本地今天，避免 toISOString 偏移
dayDiff(startISO, endISO): number | null
weekdayLabel(serial): string
isWeekend(serial): boolean
countWeekdays(startSerial, endSerial): number // 闭区间，仅排除周末
addDays(iso, days): string | null
formatCN(iso): string                     // “2026 年 11 月 7 日”
ageParts(birthISO, refISO): AgeParts | null
nextBirthday(birthISO, refISO): NextBirthday | null
formatDateTime(date, withSeconds = true): string
parseDateTime(dateISO, time): Date | null
formatUTC(date): string
formatClock(date): string
```

边界：

- 年份严格 1900–2100，非法日期返回 `null`。
- 闰年 / 闰日显式处理；2 月 29 日生日在平年按 2 月 28 日。
- `countWeekdays` 对跨度超过 100 年（36600 天）返回 0，防卡死。
- `ageParts` 借位规则：日不足借上月天数，月不足借 12 个月。

### 8.3 人民币大写（`subpackages/tools-core/lib/rmb.ts`）

```ts
centsToChinese(cents: number): string
```

- 分 → 元 / 角 / 分。
- 元部分按 4 位一节，单位 `'' / 万 / 亿 / 万亿`。
- 内部零合并、跨节零补齐。
- 支持负数；`0` 返回“零元整”。
- 最大 1 万亿元，超出返回“金额超出支持范围”。

### 8.4 65 个工具总表

| id | 名称 | 分类 | 路由 | 权重 | Workflow | 关键行为 |
|---|---|---|---|---|---|---|
| `unit` | 单位换算 | calc | `/subpackages/tools-core/pages/unit/index` | 100 | jump/text | 13 类：长度 / 质量 / 面积 / 体积 / 温度 / 速度 / 数据 / 时间 / 压力 / 能量 / 功率 / 角度 / 频率；温度独立公式，数据按 1024 进制 |
| `tax` | 个税计算 | calc | `/subpackages/tools-core/pages/tax/index` | 96 | jump/text | 月度 / 年度综合所得；7 级税率 + 速算扣除 |
| `loan` | 房贷试算 | calc | `/subpackages/tools-core/pages/loan/index` | 94 | jump/text | 等额本息 / 等额本金；前 12 期明细 |
| `deposit` | 存款复利 | calc | `/subpackages/tools-core/pages/deposit/index` | 88 | jump/text | `A = P × (1 + r/n)^(n×t)` |
| `percent` | 百分比计算 | calc | `/subpackages/tools-daily/pages/percent/index` | 90 | silent/text | 占比 / 增减幅 / 配比；两位小数整数化；GCD 化简；1000% 边界 |
| `ledger` | 算账助手 | calc | `/subpackages/tools-daily/pages/ledger/index` | 92 | jump/text | 折扣 / 满减 / AA；分整数、余数守恒 |
| `fuel` | 油耗计算 | calc | `/subpackages/tools-daily/pages/fuel/index` | 72 | jump/text | 百公里油耗 / 每公里油费 / 本次油费；油价空隐藏费用 |
| `power` | 水电燃气费 | calc | `/subpackages/tools-daily/pages/power/index` | 68 | jump/text | 电费（功率 × 时长）/ 水费 / 燃气（用量 × 费率表 + 基础费）；平价 / 最多 3 档阶梯；超最高档提示 |
| `resolution` | 分辨率与比例 | calc | `/subpackages/tools-daily/pages/resolution/index` | 64 | silent/text | GCD 化简 / 目标宽等比 / 目标比例 / 像素 / 高清判定 / 纸张 DPI 打印像素 |
| `carloan` | 车贷计算 | calc | `/subpackages/tools-daily/pages/carloan/index` | 86 | jump/text | 首付比例 / 金额；等额本息 / 等额本金；双方案对比；提前还款试算；复用 loan 引擎 |
| `quote` | 报价单 | work | `/subpackages/tools-daily/pages/quote/index` | 74 | jump/text | 最多 50 行明细；行小计先舍入、合计守恒；优惠先于计税；大写 + CSV |
| `meeting-timer` | 会议倒计时 | date | `/subpackages/tools-daily/pages/meeting-timer/index` | 73 | jump/— | 时长 / 结束时间点；暂停 / 继续 / 重置；全局 HUD；5 秒警示；跨后台补算 |
| `bodyfat` | 体脂率 | life | `/subpackages/tools-daily/pages/bodyfat/index` | 66 | jump/— | 海军围度公式；男女围度差异；0–100% 夹取；极端值复核；医疗免责 |
| `radix` | 进制转换 | calc | `/subpackages/tools-core/pages/radix/index` | 74 | silent/text | 2/8/10/16 互转；纯字符串大数，≤128 位 |
| `date-format` | 日期格式 | date | `/subpackages/tools-core/pages/date-format/index` | 88 | silent/text | 多输出单输入；ISO 周含周年、当年天序、闰年、本机时区 Unix |
| `date-add` | 日期加减 | date | `/subpackages/tools-core/pages/date-add/index` | 89 | silent/text | 天 / 周 / 月 / 年四单位；按月钳制月末、闰日 2/29 → 2/28；结果限 1900–2100 |
| `color` | 颜色转换 | media | `/subpackages/tools-core/pages/color/index` | 82 | silent/text | HEX / RGB / HSL 互转；WCAG 对比度与 AA/AAA；Machado 色觉模拟；透明度忽略 |
| `json-csv` | JSON ↔ CSV | text | `/subpackages/tools-core/pages/json-csv/index` | 82 | silent/text+json | 表头并集 / 缺失留空 / CRLF / 可选 BOM / 公式注入防护；CSV→JSON 全字符串 |
| `size-convert` | 尺码换算 | life | `/subpackages/tools-daily/pages/size-convert/index` | 62 | jump/— | 鞋码 EU/US/UK/脚长（半码）、服装 XS–XXL 身高胸围、戒指周长 48–64mm |
| `severance` | 离职补偿 | work | `/subpackages/tools-daily/pages/severance/index` | 70 | jump/— | N/N+1、不足 6 个月半个月、社平 3 倍封顶与 12 年上限、年假 ×200% |
| `id-validate` | 证件号校验 | life | `/subpackages/tools-daily/pages/id-validate/index` | 68 | jump/text | 18 位身份证加权校验 + 生日 / 性别、12–19 位银行卡 Luhn、15 位旧证提示、摘要脱敏 |
| `image-pdf` | 图片转 PDF | media | `/subpackages/tools-media/pages/image-pdf/index` | 62 | jump/image | 1–9 图；手写 PDF 1.4；JPEG DCTDecode；A4 / Letter / 原图；9 页 / 2MB；点击「生成 PDF」后生成 |
| `barcode` | 条形码生成 | media | `/subpackages/tools-media/pages/barcode/index` | 60 | jump/text | CODE128B；校验位；10 模块静区；80 字符；1-bit PNG；条宽 2/3/4px |
| `exif` | 图片信息 | media | `/subpackages/tools-media/pages/exif/index` | 58 | jump/image | 尺寸 / 体积 / 格式 / 方向 / 宽高比 / 万像素；不解析 GPS 与设备信息 |
| `timezone` | 时区换算 | date | `/subpackages/tools-core/pages/timezone/index` | 81 | jump/text | 24 个常用城市固定偏移；跨日 / 跨年；源 / 目标手动夏令时 +1h；世界时钟 8 城同屏、逐城夏令时 |
| `schedule` | 工期排期 | date | `/subpackages/tools-core/pages/schedule/index` | 84 | jump/text | 工作日推进；含/不含开始日、跳周末、自定义休息日；逐日清单；点击「排期」后计算 |
| `text-convert` | 文本转换 | text | `/subpackages/tools-core/pages/text-convert/index` | 80 | silent/text | 大小写 / 命名 / HTML 实体 / Unicode / 清洗；清洗默认保留段落，6 个清洗项可独立开关（含中英文去空格），并成一行时英文补空格、中文直连；20k 截断 |
| `template` | 占位符模板 | text | `/subpackages/tools-core/pages/template/index` | 71 | silent/text | `{{变量}}` 占位符提取 / 变量表填充 / 缺失变量提示；20k 截断 |
| `regex` | 正则测试 | text | `/subpackages/tools-core/pages/regex/index` | 72 | jump/text | Worker 300ms 执行超时（冷启动握手不计入）；分组 / 位置 / 高亮；500 条截断 |
| `photo-edit` | 图片编辑 | media | `/subpackages/tools-media/pages/photo-edit/index` | 85 | jump/image | 裁剪 / 旋转 / 翻转 / JPEG-PNG；12MP 与 4096 钳制 |
| `avatar` | 圆角头像 | media | `/subpackages/tools-media/pages/avatar/index` | 75 | jump/image | 中心裁正方形；圆形 / 圆角 12% / 25%；256/512/1024 PNG 透明 |
| `collage` | 拼图与长图 | media | `/subpackages/tools-media/pages/collage/index` | 70 | jump/image | 2×2 / 3×3 / 竖排；2–9 图；间距 0/8/16；长边 ≤4096；解码失败跳过；点击「生成拼图」后生成 |
| `id-photo` | 证件照换底 | media | `/subpackages/tools-media/pages/id-photo/index` | 58 | jump/image | 智能背景识别（纯色 / 渐变 / 纹理 / 复杂）；顶部与左右上半区背景模型；YCbCr 漫水；容差 / 边缘保护 / 羽化；白 / 蓝 / 红 |
| `qr-decode` | 二维码识别 | media | `/subpackages/tools-media/pages/qr-decode/index` | 80 | jump/image | 相册单图；jsQR 本机解码；长边 1024；超 2000 字截断展示；外链只复制 |
| `lunar` | 农历与节气 | date | `/subpackages/tools-dict/pages/lunar/index` | 84 | jump/text | 公历转农历；1900–2100；闰月 / 生肖 / 节气 / 传统节日；农历生日与下次生日倒计时 |
| `zh-convert` | 简繁转换 | text | `/subpackages/tools-dict/pages/zh-convert/index` | 69 | jump/text | 简→繁 / 繁→简；词组优先最长匹配；一词多繁按常用词；20k 截断 |
| `pinyin` | 拼音标注 | text | `/subpackages/tools-dict/pages/pinyin/index` | 63 | jump/text | 带声调 / 不带声调；逐字对照；常用多音词消歧；2k 截断 |
| `fx-manual` | 汇率换算 | calc | `/subpackages/tools-daily/pages/fx-manual/index` | 65 | jump/text | 官方 CFETS 中间价 + 手动回退；8 固定币种；双向换算；结果按分；仅供参考 |
| `salary-inverse` | 薪资反算 | calc | `/subpackages/tools-daily/pages/salary-inverse/index` | 67 | jump/text | 目标到手反推税前；比例 / 固定五险一金；专项附加；月度简化；误差 ≤1 分 |
| `span` | 日期间隔 | date | `/subpackages/tools-core/pages/span/index` | 92 | jump/text | 自然日 / 工作日 / 周末；可选包含开始日 |
| `age` | 年龄周岁 | date | `/subpackages/tools-core/pages/age/index` | 86 | jump/text | 周岁 / 月龄 / 总天数 / 下次生日 |
| `countdown` | 倒数日 | date | `/subpackages/tools-core/pages/countdown/index` | 80 | jump/text | 目标日差；不做后台推送 |
| `timestamp` | 时间戳 | date | `/subpackages/tools-core/pages/timestamp/index` | 82 | jump/text | 秒 / 毫秒双向；本地 + UTC 对照 |
| `rmb` | 金额大写 | work | `/subpackages/tools-core/pages/rmb/index` | 90 | jump/text | 分 → 中文大写；亿 / 万 / 元分节 |
| `worktime` | 工时与请假 | work | `/subpackages/tools-daily/pages/worktime/index` | 78 | jump（仅来源） | 跨天工时 / 加班费 / 周末排除 / 半天 |
| `wordcount` | 字数统计 | text | `/subpackages/tools-core/pages/wordcount/index` | 84 | silent | 码点计数；Emoji 按 1 字符 |
| `text-diff` | 文本对比 | text | `/subpackages/tools-core/pages/text-diff/index` | 82 | jump/text+json | 字符级 / 行级 Diff；双栏同步滚动 |
| `hash` | Hash 加密 | text | `/subpackages/tools-core/pages/hash/index` | 86 | jump/text+json | MD5 / SHA-1 / SHA-256 / SHA-512 / HMAC |
| `dedupe` | 去重排序 | text | `/subpackages/tools-core/pages/dedupe/index` | 78 | silent | 去空行 / 去首尾空格 / 忽略大小写 / 多排序 |
| `json` | JSON 格式化 | text | `/subpackages/tools-core/pages/json/index` | 76 | silent | 格式化 / 压缩 / 错误定位 |
| `url` | URL 编解码 | text | `/subpackages/tools-core/pages/url/index` | 70 | silent | `encodeURIComponent` / `encodeURI` |
| `base64` | Base64 | text | `/subpackages/tools-core/pages/base64/index` | 68 | silent | UTF-8 / Emoji / URL-safe |
| `password` | 随机密码 | text | `/subpackages/tools-core/pages/password/index` | 72 | jump（仅来源） | 密码学随机数 + 拒绝采样；4–64 位；熵 = 长度 × log2(字符集)，<40 弱 / 40–79 中 / ≥80 强 |
| `bmi` | BMI 指数 | life | `/subpackages/tools-core/pages/bmi/index` | 74 | jump（仅来源） | `体重 / 身高²`；中国成人区间 |
| `wellness` | 每日健康 | life | `/subpackages/tools-daily/pages/wellness/index` | 82 | jump（仅来源） | 饮水 / 千卡千焦 / 保质期；三模式隔离 |
| `random-pick` | 随机决定 | life | `/subpackages/tools-daily/pages/random-pick/index` | 70 | silent/text | 抽签 / 随机数 / 骰子 / 硬币四模式；抽签去重 / 可重复 / Fisher-Yates；随机数闭区间；骰子 D4–D20；硬币正反 |
| `vcard` | 二维码名片 | work | `/subpackages/tools-media/pages/vcard/index` | 66 | jump（仅来源） | 图片名片 1080×672 / vCard 3.0 / 二维码 M |
| `compress` | 图片压缩 | media | `/subpackages/tools-media/pages/compress/index` | 87 | jump/image | 质量 + 最大边缩放；前后体积对比 |
| `palette` | 图片取色 | media | `/subpackages/tools-media/pages/palette/index` | 66 | jump/image | 64×64 缩略图；主色 / 平均色 / 五色板 |
| `nine-grid` | 九宫格切图 | media | `/subpackages/tools-media/pages/nine-grid/index` | 64 | jump/image | 居中正方形 3×3 |
| `qr` | 二维码生成 | media | `/subpackages/tools-media/pages/qr/index` | 85 | jump/text | 纯 JS 编码 + 1-bit PNG；不用 Canvas |
| `watermark` | 水印工作台 | media | `/subpackages/tools-media/pages/watermark/index` | 95 | jump/image | 文字 / Logo / 打码；WXS 手势 |
| `weather` | 全息气象 | life | `/subpackages/tools-core/pages/weather/index` | 98 | jump（仅来源） | 高德实况 + 4 天预报；模糊定位降级 |
| `qweather` | 和风天气 | life | `/subpackages/weather/pages/home/index` | 99 | jump（仅来源） | 8 组 API / 20 接口 / 27 范围变体；7 Tab、官方图标 507 个；API KEY 优先，JWT 兜底 |
| `web-search` | 元宝搜索 | text | `/subpackages/tools-core/pages/web-search/index` | 97 | jump（接受文本） | 腾讯云 WSA SearchPro；全网结果、筛选、详情、复制链接 |

### 8.5 个税（`tax`）

来源：`core/toolbox/engines/tax.ts` + `subpackages/tools-core/pages/tax/index.ts`；个税页与薪资反算共用 `calcTax`。

- 月度起征点 `500000` 分（5,000 元），年度起征点 `6000000` 分（60,000 元）。
- 月度 7 级税率：3% / 10% / 20% / 25% / 30% / 35% / 45%，速算扣除数分别 `0 / 21000 / 141000 / 266000 / 441000 / 716000 / 1516000` 分。
- 年度 7 级税率：3% / 10% / 20% / 25% / 30% / 35% / 45%，速算扣除数分别 `0 / 252000 / 1692000 / 3192000 / 5292000 / 8592000 / 18192000` 分。
- 应纳税所得额 = 收入 − 五险一金 − 专项附加 − 其他扣除 − 起征点。
- 税额 = 应纳税所得额 × 税率 − 速算扣除数；结果四舍五入到分。
- 五险一金不得高于收入；非法输入进入 `shellState: 'invalid'`。

### 8.6 房贷（`loan`）

来源：`subpackages/tools-core/pages/loan/index.ts`。

- 本金以“万元”输入，转分：`principalWan × 10000 × 100`。
- 年利率转基点，月利率 = `bp / 10000 / 12`。
- 贷款年限 1–50 年，期数 = `years × 12`。
- 等额本息：

```text
月供 = P × i × (1+i)^n / ((1+i)^n − 1)
总还款 = 月供 × n
总利息 = 总还款 − P
```

- 等额本金：

```text
每期本金 = P / n
第 k 期利息 = 剩余本金 × i
第 k 期月供 = 每期本金 + 第 k 期利息
```

- 展示月供、总利息、总还款、首期 / 末期与最多前 12 期明细。

### 8.7 存款复利（`deposit`）

来源：`subpackages/tools-core/pages/deposit/index.ts`。

```text
P = 本金（分）
r = 年利率（基点 / 10000）
n = 每年复利次数（年 1 / 季 4 / 月 12）
t = 年限
A = P × (1 + r/n)^(n×t)
利息 = A − P
折合年化 = (A/P)^(1/t) − 1
```

### 8.8 BMI（`bmi`）

来源：`subpackages/tools-core/pages/bmi/index.ts`。

```text
BMI = 体重(kg) / 身高(m)²
```

中国成人区间：

| 区间 | 分类 |
|---|---|
| `< 18.5` | 偏瘦 |
| `18.5 – 23.9` | 正常 |
| `24 – 27.9` | 超重 |
| `≥ 28` | 肥胖 |

参考体重区间 = `18.5 × m²` 至 `23.9 × m²`。身高 100–250 cm，体重 20–300 kg。

### 8.9 日期间隔（`span`）

来源：`subpackages/tools-core/pages/span/index.ts`。

- 日期零点对齐，`dayDiff(end, start)` 得自然日差。
- 可选“包含开始日”：结果 +1。
- 可选“排除周末”：使用 `countWeekdays`，仅排除周六 / 周日，不含法定节假日与调休。
- 输出自然日、工作日、周末数、周数等。

### 8.10 年龄（`age`）

来源：`subpackages/tools-core/pages/age/index.ts`。

- `ageParts` 返回周岁、月龄、日龄、总天数、总月数。
- `nextBirthday` 返回距下次生日天数；当天返回 0；2 月 29 日在平年按 2 月 28 日。
- 闰日生日显示提示。

### 8.11 时间戳（`timestamp`）

来源：`subpackages/tools-core/pages/timestamp/index.ts` / `core/toolbox/engines/date.ts`。

- 秒 / 毫秒双向转换。
- 时间戳 → 本地时间 + UTC 对照。
- 日期时间 → 时间戳。
- 有效范围 1900–2100。
- 非法日期 / 时间返回 `null`，页面给出错误文案。

### 8.12 文本工具

| 工具 | 核心实现 | 关键边界 |
|---|---|---|
| 字数统计 | 码点遍历，中文区间 `0x3400–0x4DBF`、`0x4E00–0x9FFF`、`0xF900–0xFAFF`；英文单词、数字串、行、段落 | 输入上限 20,000 字符；Emoji 按 1 字符 |
| 去重排序 | 按行拆分，去空行 / trim / 忽略大小写；`none / asc / desc / length` | 保持原序为默认 |
| JSON | `JSON.parse` + `JSON.stringify`；错误显示原始信息 | 空输入 / 非法 JSON 明确报错 |
| URL | `encodeURIComponent` / `encodeURI` 及对应解码 | 解码失败给出百分比错误 |
| Base64 | 纯 JS UTF-8 → Base64；支持中文、Emoji、URL-safe；图片模式经 `wx.chooseMedia` + 隐私授权读取，≤2MB，可选 data URL 前缀 | 文本不处理二进制输入；图片只读不写、不上传 |
| 随机密码 | `wx.getRandomValues` 优先，`Math.random` 回退；拒绝采样；四类字符 + 排除易混淆；熵与弱 / 中 / 强评估 | 至少保留一类；长度 4–64；空密码与非法输入 |
| 文本对比 | `diff-match-patch`；`computeTextDiff` / `buildDiffReport` / `buildHighlightedText` | 1.8s 超时；差异块超限降级 |
| Hash | `crypto-js`；MD5 / SHA-1 / SHA-256 / SHA-512；HMAC | 100,000 字符上限；`setTimeout` 宏任务先渲染 Loading |

### 8.13 Hash 引擎（`subpackages/tools-core/utils/hashEngine.ts`）

```ts
type HashAlgorithm = 'md5' | 'sha1' | 'sha256' | 'sha512'
type HashCaseMode = 'lower' | 'upper'

MAX_HASH_CHARS = 100000

computeHash(input, options): HashResult
formatHash(hex, mode): string
algorithmLabel(algorithm): string
```

- 普通 Hash 与 HMAC 两种模式。
- 空文本 / 空密钥拦截。
- 计算异常兜底为错误文案。
- 输入长度按码点计算，避免代理对误判。

### 8.14 文本 Diff 引擎（`subpackages/tools-core/utils/diffEngine.ts`）

```ts
computeTextDiff(original, modified, options): TextDiffResult
buildDiffReport(original, modified, result): string
buildHighlightedText(result): string
```

常量：

| 常量 | 值 | 含义 |
|---|---|---|
| `SEMANTIC_CLEANUP_LIMIT` | `30000` | 超过后关闭语义清理 |
| `DIFF_TIMEOUT_MS` | `1800` | 总超时 |
| `DIFF_LIB_TIMEOUT_S` | `1.5` | diff-match-patch 超时 |

输出：

- 左右两侧 `DiffSegment[]`（equal / insert / delete）。
- 统计插入 / 删除 / 替换数量。
- 富文本节点由 `diffToRichText.ts` 转换，供 `rich-text` 渲染。

### 8.15 图片压缩（`compress`）

来源：`subpackages/tools-media/pages/compress/index.ts`。

质量档：

| key | 标签 | quality |
|---|---|---|
| `high` | 高清 | 90 |
| `balanced` | 均衡 | 75 |
| `small` | 轻巧 | 55 |

最大边档：

| key | 值 |
|---|---|
| `origin` | 0（原尺寸） |
| `1920` | 1920 |
| `1280` | 1280 |
| `750` | 750 |

- 使用 `wx.compressImage`，支持按宽高压缩；低版本不支持尺寸时回退纯质量压缩。
- 展示原图 / 压缩图 / 体积对比 / 节省比例。
- 页面卸载或替换结果时静默删除临时文件。

### 8.16 图片取色（`palette`）

来源：`subpackages/tools-media/pages/palette/index.ts`。

1. 创建 64×64 离屏 Canvas。
2. 居中裁剪正方形绘制。
3. `getImageData` 读取像素，跳过 alpha < 128。
4. 按 RGB 高 4 位分桶（`red >> 4`、`green >> 4`、`blue >> 4`）。
5. 统计桶内平均色与占比，输出主色、平均色、五色色板。
6. 点击色值复制 HEX / RGB。

### 8.17 九宫格切图（`nine-grid`）

来源：`subpackages/tools-media/pages/nine-grid/index.ts`。

- 单张隐藏 Canvas 逐格绘制并导出，避免 9 个画布同时占用内存。
- 居中正方形裁剪，3×3 等分。
- 只生成一张画布，循环 9 次 `drawImage` + `canvasToTempFilePath`。
- 保存全部时逐张写入相册，仅在保存时申请权限。
- 开发者工具不支持 Skyline Canvas 时提示真机预览。

### 8.18 二维码（`qr`）

来源：`subpackages/tools-media/pages/qr/index.ts` + `lib/qrcode.ts` + `lib/png.ts`。

- 使用 `qrcode-generator 2.0.4`（MIT）纯 JS 编码。
- 不用 Canvas：把模块矩阵写成 1-bit PNG，再以 `image` 展示。
- 纠错等级 L / M / Q / H；尺寸 240 / 280 / 320。
- 内容上限 500 字符。
- `qrPngBase64(matrix, count, scale, margin)` 手写 PNG chunk、CRC32、zlib store。
- `writePngFile(base64, fileName)` 写入 `USER_DATA_PATH`。
- 输入变化递增 `qrRenderSeq`，丢弃旧异步结果；卸载时清理临时图。

#### 二维码识别（`qr-decode`）

来源：`subpackages/tools-media/pages/qr-decode/index.ts` + `lib/qrdecode.ts` + `lib/qrdecode-vendor.ts`。

- 使用 `jsQR 1.4.0`（Apache-2.0）纯 JS 解码，vendor 单文件 130,747B，无网络与 DOM 依赖。
- 相册单图先按长边 1024px 绘制到隐藏 Canvas，透明图先补白底，再取 RGBA 交给 `decodeImageData`。
- `inversionAttempts: 'attemptBoth'` 同时尝试正色与反色；识别失败返回 null，由页面提示换图。
- 超 2000 字只截断展示，`resultText` / `qrSummary` 保留全文供复制与 Workflow。
- 外链不自动打开：复制后仅提示「请在浏览器中打开」；图片退出页面即清理。

### 8.19 水印工作台（`watermark`）

来源：`subpackages/tools-media/pages/watermark/index.ts` + `gesture.wxs`。

常量：

| 常量 | 值 | 含义 |
|---|---|---|
| `MAX_SOURCE_EDGE` | 2000 | 选图最大边 |
| `MAX_LOGO_EDGE` | 1200 | Logo 最大边 |
| `PREVIEW_MAX_EDGE` | 1200 | 预览最大边 |
| `EXPORT_MAX_EDGE` | 3200 | 导出最大边 |
| `HISTORY_LIMIT` | 40 | 撤销 / 重做历史 |
| `RENDER_DEBOUNCE` | 200ms | 控件变更重绘防抖 |

图层顺序：

```text
原图 → 打码（马赛克 / 高斯模糊） → 文字水印 → Logo 水印
```

能力：

- 多行文字：描边、底框、字间距、行间距、平铺、图章。
- 图片 Logo：透明度、缩放、旋转、位置。
- 打码：矩形框选，马赛克 / 高斯模糊。
- 手势：单指拖拽、双指捏合 / 旋转 / 焦点补偿，全部在 `gesture.wxs` 内完成。
- 预览双通道：DOM 图层负责 60fps 手势，隐藏 Canvas 负责真实合成与导出。
- 选图 / 保存走 `ensurePrivacyAuthorized()` 前置拦截。
- 每次手势结束 / 控件落定入历史栈，支持撤销 / 重做。

### 8.20 Worker 沙箱（`core/services/worker.ts`）

微信平台限制：同一时刻最多 1 个 Worker。

```ts
type WorkerSandboxErrorCode =
  | 'UNAVAILABLE' | 'TIMEOUT' | 'CANCELLED' | 'QUEUE_FULL'
  | 'WORKER_ERROR' | 'INVALID_RESPONSE' | 'DISPOSED'

class WorkerSandbox {
  warmup(): boolean
  getStatus(): WorkerSandboxStatus
  cancel(taskId): boolean
  cancelAll(): void
  dispose(): void
}
```

协议：

```text
主线程 → Worker: { kind: 'ping', id } | { kind: 'task', id, task, payload }
Worker → 主线程: { kind: 'pong', id }
                { kind: 'progress', id, progress }
                { kind: 'done', id, ok, data }
                { kind: 'done', id, ok: false, error: { code, message } }
```

冷启动握手：`ensureWorker()` 创建 Worker 后先发 `ping`，收到 `pong` 才派发任务；默认握手上限 5s。正则的 300ms 超时只在 Worker 就绪后开始计时，因此冷启动不会被误判为「模式过慢」。

支持任务：

| task | 输入 | 输出 |
|---|---|---|
| `text-stats` | `{ text }` | 码点 / 不含空格 / 中文 / 英文单词 / 数字串 / 行 / 非空行 / 段落 / 最长行 / 阅读分钟 |
| `dedupe` | `{ text, dropEmpty, trimLines, ignoreCase, sort }` | 去重文本 + 统计 |
| `base64-encode` | `{ text }` | Base64 + 字节数 |
| `checksum` | `{ text }` | FNV-1a 双种子校验和 |
| `chunk-text` | `{ text, chunkSize, overlap }` | 分片数组 |
| `nine-grid-plan` | `{ width, height, columns, rows }` | 边长 / 单元 / 偏移 |

- 单 Worker + 优先级队列 + 超时 + 取消 + 主线程降级。
- Worker 不可用时自动降级主线程纯函数。

### 8.21 Cyber Space OS（grow 分包）

设置页 `subpackages/grow/pages/settings/` 内嵌的极客实验室。

| 模块 | 文件 | 作用 |
|---|---|---|
| 星系图 | `utils/canvasGalaxy.ts` | Canvas 粒子星系，支持平移 / 缩放 / 选中 / 降级 |
| Auto-Pilot | `utils/cronParser.ts` | 5 段 Cron 解析与分钟级调度 |
| Time Travel | `utils/timeTravelEngine.ts` | 状态快照 / 时间旅行 / 热备 / 自动快照；时间轴帧经 `cyber:frames:v1` 跨页面恢复 |
| 分片传输 | `utils/slicedTransfer.ts` | `[Part i/n] CSOS1|sid|index|total|crc|jsonChunk` 文本协议 |
| AES 保险箱 | `utils/aesVault.ts` | AES-256-CBC + PKCS7，`CYBER-AES1|ivHex|cipherHex` |
| 事件流 | `timeTravelEngine.ts` 的 `EventLog` | 内存环形 50 条，不落盘 |
| 灾难恢复 | `timeTravelEngine.ts` | 热备 3 槽、自动快照 5 槽 |

- 星系图分两条渲染通道：真机走 Canvas 2D 节点；Skyline 开发者工具不返回 canvas 节点（`node()` / `fields({ node: true })` 永不回调），自动切到同一 `GalaxyEngine` 物理驱动的 DOM 粒子层（`galaxyDomMode`），并使用 size-only 查询 + 500ms 看门狗兜底，禁止停在 BOOTING。

`CronScheduler`：

```ts
parseCron(expression): ParsedCron | null
cronMatches(cron, date): boolean
nextCronRun(cron, from): number | null
describeCron(cron): string

class CronScheduler {
  start(expression): boolean
  update(expression): boolean
  stop(): void
  destroy(): void
  tick(now?): void
  state(): CronSchedulerState
}
```

`TimeTravelEngine`：

```ts
capture(label): CyberSnapshot | null
getFrames(): CyberSnapshot[]
views(activeIndex): TimeTravelFrameView[]
preview(index): CyberSnapshot | null
travel(index): { ok, message, frame? }
restorePersisted(): number
persist(): boolean
clear(): void
```

- 时间轴用显式横向 flex 轨道承载卡片，避免 `white-space: normal` 下在 Skyline 纵向堆叠压住滑轨。
- 拖动滑轨时同步卡片高亮、`scroll-into-view` 与「第 N / M 帧 · 时间 · 标签」位置文案，松手不自动穿越。

`GalaxyEngine`：

```ts
setTheme('light' | 'dark'): void
setNodes(nodes): void
resize(width, height): void
setDegraded(boolean): void
pan(dx, dy): void
zoomAt(factor, screenX, screenY): void
zoomBy(factor): void
resetView(): void
step(dtMs): void
draw(ctx): void
hitTest(x, y): GalaxyParticle | null
select(id): GalaxyParticle | null
```

### 8.22 进制转换（`radix`）

来源：`subpackages/tools-core/lib/radix.ts` + `subpackages/tools-core/pages/radix/index.ts`。

- 支持 2 / 8 / 10 / 16 四种进制，`RADIX_LABELS` 分别映射「二进制 / 八进制 / 十进制 / 十六进制」。
- 纯字符串大数运算，不依赖 `BigInt`：逐位乘加 `mulAdd()` + 除法取余完成任意进制互转。
- 归一化：全角 ASCII 转半角、去除空格与下划线、兼容 `0x` / `0b` / `0o` 前缀；负数符号保留。
- 有效数字上限 `MAX_RADIX_DIGITS = 128`，超过直接报 `too-long`，避免 O(n²) 拖慢主线程。
- 错误码：`empty` / `invalid-base` / `invalid-char` / `too-long`；非法字符错误会带原始索引与字符，页面可精确定位。
- Workflow 为 silent，且 `accepts` 只接受 `text`：执行器只认十进制整数，不对 JSON / 前缀做虚假承诺。

### 8.23 算账助手（`ledger`）

来源：`subpackages/tools-daily/lib/ledger.ts` + `subpackages/tools-daily/pages/ledger/index.ts`（`tools-daily` 分包，独立于 tools-core）。

三种模式：`discount`（折扣）/ `threshold`（满减）/ `aa`（AA 分摊）。所有金额以「分」整数计算，展示层才转元。

| 模式 | 公式 / 规则 |
|---|---|
| 折扣 | `payable = roundHalfUp(originalCents × discountPercent / 100)`；`discountPercent` 是实付百分比，`80` 表示 8 折 |
| 满减 | 最多 3 档；只取「门槛 ≤ 原价」中门槛最高的一档；要求 `0 ≤ 减额 ≤ 门槛`；未达门槛按原价返回 |
| AA | `tipCents = roundHalfUp(total × tipPercent / 100)`；`payable = total + tip`；`base = floor(payable / people)`；余数从第 1 人起每人 +1 分，保证总和守恒 |

核心函数：

| 函数 | 签名 | 说明 |
|---|---|---|
| `calcDiscount` | `(originalCents, discountPercent) => DiscountResult \| LedgerFailure` | 折扣 |
| `calcThreshold` | `(originalCents, tiers) => ThresholdResult \| LedgerFailure` | 满减，最多 3 档 |
| `splitBill` | `(totalCents, people, tipPercent) => SplitResult \| LedgerFailure` | AA + 小费，余数守恒 |
| `formatSplitSpread` | `(perPerson) => string` | 生成「前 N 人 ¥x，其余 ¥y」文案 |
| `ledgerErrorText` | `(code) => string` | 错误码 → 字段级文案 |

边界：

- 单笔金额上限 `MAX_LEDGER_CENTS = 100_000_000` 分（100 万元）。
- 人数 1–100 的整数；折扣 / 小费比例 0–100%。
- 错误码 `amount` / `discount` / `people` / `tip` / `tiers`，一一对应字段级文案（`ledgerErrorText`）。
- 页面三种模式各自缓存结果（`modeResults`），切换模式不丢上次计算；`posterData` 与分享同样接入。

### 8.24 全息气象（`weather`）

来源：`subpackages/tools-core/pages/weather/` + `weather/*`。这是全项目四个**发起外部网络请求**的工具之一（另三个是「和风天气」「汇率换算」与「元宝搜索」），也是不套 `glass-tool-shell` 的三个工具页之一（另两个是水印工作台与和风天气）。

#### 网络层（`weather/weatherService.ts`）

- 唯一域名：`https://restapi.amap.com`，只使用高德**Web 服务 Key**，不传 `jscode`。
- 超时 `WEATHER_TIMEOUT_MS = 8000`；请求可 `abort()`。
- 端点：实况 / 预报 `/v3/weather/weatherInfo`、逆地理 `/v3/geocode/regeo`、IP 定位 `/v3/ip`、行政区搜索 `/v3/config/district`。
- 错误统一收敛为 `WeatherError`，`kind` 为 `config` / `network` / `timeout` / `api` / `parse` / `aborted`；`10015` / `10016` / `20003` 视为可重试。
- `maskedKey()` 只暴露末 4 位，日志与诊断绝不输出完整 Key。
- 传输层可注入（`HttpTransport`），Node 测试不依赖 `wx.request`。

| 方法 | 返回 |
|---|---|
| `hasKey()` | 是否配置 Key |
| `fetchLive(adcode)` | `WeatherRequest<LiveWeather>` |
| `fetchForecast(adcode)` | `WeatherRequest<ForecastWeather>` |
| `fetchRegeo(lng, lat)` | `WeatherRequest<RegeoResult>` |
| `fetchIpLocation()` | `WeatherRequest<IpLocationResult>` |
| `searchDistricts(keyword)` | `WeatherRequest<CityCandidate[]>` |

#### 定位链路（`weather/weatherLocation.ts`）

```text
wx.getFuzzyLocation（gcj02，城市级）
  → 逆地理 regeo → 城市
  → 失败降级 IP 定位
  → 再失败进入手动城市搜索（最多 5 个城市）
```

- 定位前必须 `ensurePrivacyAuthorized()`；拒绝 / 低版本 / 局域网 / IPv6-only 全部优雅降级，不伪造数据。
- `app.json` 只声明 `requiredPrivateInfos: ["getFuzzyLocation"]`，不申请精确位置；必须同时配置 `permission["scope.userFuzzyLocation"].desc`，否则微信不会弹出定位授权窗。
- 未申请时先展示应用内说明（只获取城市级模糊位置），确认后再由微信弹出系统授权；已拒绝时提供「去设置 / 手动选城」，设置页权限行读取 `scope.userFuzzyLocation` 实时同步。

一次完整刷新（定位 → 数据 → 缓存）的时序如下：

```mermaid
sequenceDiagram
  autonumber
  participant Page as 天气页
  participant Loc as weatherLocation
  participant Svc as WeatherService
  participant Cache as weatherCache
  participant AMap as 高德 REST

  Page->>Cache: readCities() / readCurrentAdcode()
  alt 无当前城市或用户重新定位
    Page->>Loc: getFuzzyLocation()
    Loc->>Loc: ensurePrivacyAuthorized() + getFuzzyLocation(gcj02)
    Loc-->>Page: 城市级坐标
    Page->>Svc: fetchRegeo(lng, lat)
    Svc->>AMap: GET /v3/geocode/regeo
    AMap-->>Svc: province / city / adcode
    Svc-->>Page: SavedCity(source=fuzzy)
  else 定位失败
    Page->>Svc: fetchIpLocation()
    Svc->>AMap: GET /v3/ip
    AMap-->>Svc: 城市 / adcode
    Svc-->>Page: SavedCity(source=ip)
  end
  alt 用户手动搜索
    Page->>Svc: searchDistricts(keyword)
    Svc->>AMap: GET /v3/config/district
    AMap-->>Svc: CityCandidate[]
    Svc-->>Page: 候选城市 → 用户选择
  end
  Page->>Cache: readLiveCache(adcode) / readForecastCache(adcode)
  alt 缓存命中且未过期
    Cache-->>Page: 实况 / 4 天预报
  else 缓存缺失或过期
    Page->>Svc: fetchLive(adcode) / fetchForecast(adcode)
    Svc->>AMap: GET /v3/weather/weatherInfo
    AMap-->>Svc: 原始实况 / casts
    Svc-->>Page: 解析后的 LiveWeather / ForecastWeather
    Page->>Cache: writeLiveCache() / writeForecastCache()
  end
  Page->>Page: 渲染实况、粒子、图表与环境音
```

#### 模块构成（`weather/*`）

| 模块 | 职责 |
|---|---|
| `weatherService.ts` | 高德 REST 唯一网络入口：实况 / 预报 / 逆地理 / IP / 行政区搜索，超时、重试与 `WeatherError` |
| `weatherLocation.ts` | 模糊定位 → 逆地理 → IP 兜底 → 手动城市搜索的定位链 |
| `weatherCache.ts` | 城市表、当前城市、实况 / 预报 / 负缓存与 TTL |
| `weatherParse.ts` | 原始响应 → 领域模型，字段缺失 / `null` 归一化 |
| `weatherCode.ts` | 天气现象码 → 现象家族 / 中文标签 / 环境光场景 |
| `weatherAstro.ts` | 日出日落本机计算，支持极昼 / 极夜 |
| `weatherChart.ts` | 预报与逐小时静态图表绘制 |
| `weatherFx.ts` | 全屏天气粒子（雨 / 雪 / 晴等） |
| `weatherAudio.ts` | `WeatherAmbientAudio`：WebAudio 环境音合成（雨 / 风），默认关闭、按需创建 |
| `weatherDiagnostics.ts` | `WeatherRequestLog`、`describeInfoCode`、`buildDiagnosticText`：诊断码解释与请求日志 |
| `weatherHourly.ts` | 逐小时数据组装与展示口径 |
| `types.ts` / `config.ts` | 天气领域类型与 Key / 端点 / 超时配置；`config.local.ts` 由脚本生成 |

#### 缓存与城市（`weather/weatherCache.ts`）

| 键 | 内容 | TTL / 上限 |
|---|---|---|
| `weather:cities:v1` | 城市表（adcode / 名称 / 省份 / 来源 / 中心点 / 更新时间） | 最多 `MAX_CITIES = 5` |
| `weather:current:v1` | 当前城市 adcode | — |
| `weather:live:v1:{adcode}` | 实况缓存 | `LIVE_TTL_MS = 15min` |
| `weather:forecast:v1:{adcode}` | 4 天预报缓存 | `FORECAST_TTL_MS = 30min` |
| `weather:fail:v1:{adcode}:{kind}` | 失败负缓存 | `NEGATIVE_TTL_MS = 60s` |
| `weather:ambient:v1` / `weather:lab:v1` / `weather:manual-refresh:v1` | 环境音 / 实验开关 / 手动刷新时间 | 手动刷新冷却 60s |

#### 页面能力

- 实况 8 项 + 最多 4 天预报（官方 `casts` 实际长度）；温度 / 湿度 `null` 时统一显示「—」，不用 0 伪造。
- 双 Canvas：全屏天气粒子（`weatherFx.ts`）+ 静态预报图表 / 逐小时图表（`weatherChart.ts`）；日出日落由 `weatherAstro.ts` 本机计算，支持极昼 / 极夜。
- 环境音由 WebAudio 合成（雨 / 风），默认关闭，用户点击后才创建 `AudioContext`；`onHide` 暂停、`onUnload` 关闭。
- AQI / 生活指数 / 分钟级降水 / 灾害预警：标准 API 不含该数据，页面做**诚实降级占位**，不伪造。
- 请求序列号（`liveSeq` / `forecastSeq` / `searchSeq`）防止旧响应覆盖新城市；`onHide` abort 请求、停动画、挂音频，`onUnload` 彻底释放。
- 支持分享 / 海报；Workflow `accepts: []`，只作为来源，不接收任意注入。

### 8.25 全息专注引擎（`focus`）

来源：`subpackages/life/`。它不是注册表工具，拥有独立路由 `ROUTES.focus`，由「设置 → 全息专注引擎」进入。

#### 状态机（`lib/focus-fsm.ts`）

状态转移如下：

```mermaid
stateDiagram-v2
  [*] --> idle
  idle --> focusing: 开始专注（25min）
  focusing --> paused: 暂停
  paused --> focusing: 继续
  focusing --> breaking: 完成一轮且未过热
  focusing --> overheat: 连续专注 ≥ 2h
  focusing --> idle: 放弃（二次确认）
  paused --> idle: 放弃
  breaking --> idle: 休息到期 / 跳过（短休 5min 或长休 15min）
  overheat --> idle: 冷却 30min 到期 / 强制返回
  idle --> [*]

  note right of breaking
    每完成 4 轮进入长休 15min
    短休结束不清零连续专注值
  end note
  note right of overheat
    优先级高于第 4 轮长休
    锁定期结束清零连续专注值
  end note
  note left of focusing
    破功 Glitch 只累加 breaches
    不暂停计时、不切换 fsm
  end note
```

| 常量 | 值 | 含义 |
|---|---|---|
| `FOCUS_DURATION_MS` | 25min | 单轮专注 |
| `SHORT_BREAK_MS` | 5min | 短休 |
| `LONG_BREAK_MS` | 15min | 每完成 4 轮长休 |
| `OVERHEAT_THRESHOLD_MS` | 2h | 连续专注阈值 |
| `OVERHEAT_LOCK_MS` | 30min | 过热锁定 |
| `MAX_PHASE_MS` | 6h | 单 phase 合法性上限 |
| `HEARTBEAT_STALE_MS` | 180s | 心跳缺失判 low confidence |

核心函数（全部纯函数，不依赖 `wx`）：

| 函数 | 作用 |
|---|---|
| `createFocusSession(input)` | 新建 25min 会话，`cycle = completedFocus % 4 + 1` |
| `focusRemainingMs(session, now)` | 按 fsm 推导剩余（paused 用冻结值 / overheat 用 lockUntil） |
| `pauseFocusSession` / `resumeFocusSession` | 冻结 / 恢复，回推 `phaseStartedAt` |
| `markFocusBreach` / `markFocusHeartbeat` | 记破功 / 60s 心跳 |
| `completeFocusSession` | 完成一轮，决定短休 / 长休 / Overheat，并产出 record 输入 |
| `finishBreakSession` / `finishOverheatSession` | 休息 / 冷却结束，返回是否清零连续值 |
| `restoreFocusSession` | 冷启动 / onShow 恢复，到期自动完成或回 idle |

存储层入口：`ensureFocusKeyAsync()`、`loadFocusSession()` / `saveFocusSession()`、`loadFocusStats()` / `saveFocusStats()`、`settleFocusRecord()`、`loadFocusLedger()`、`appendFocusRecord()`、`clearFocusData()`。

关键规则：

- **时间戳唯一真相**：剩余时间永远由 `phaseEndsAt` 推导，禁止 `setInterval` 递减；页面每 250ms 重算并渲染。
- 新会话 `completedFocus` 从 `stats.completedCount` 初始化，`cycle = (completedFocus % 4) + 1`，`continuousFocusMs` 从 stats 继承。
- 完成一轮：`completedFocus + 1`、`continuousFocusMs += focusedMs`；**Overheat 优先级高于第 4 轮长休**。
- 暂停冻结 `remainingMs`，继续时回推 `phaseStartedAt`，使 `focusedMs` 仍按完整 `phaseTotalMs` 结算，暂停不吞专注时长。
- 短休结束不清空连续专注值；长休 / Overheat 结束清零连续值。
- 冷启动 / `onShow` 用 `restoreFocusSession()` 恢复：focusing 已到期自动完成并产出 `completion`；breaking / overheat 到期回 idle。

#### 存储与存证（`lib/focus-storage.ts` / `focus-crypto.ts` / `focus-level.ts`）

补充模块：

| 模块 | 职责 |
|---|---|
| `focus-types.ts` | `FocusFsm` / `FocusTrack` / `FocusSession` / `FocusRecord` / `FocusStats` 等类型契约，无副作用 |
| `focus-fsm.ts` | 纯函数状态机：开始 / 暂停 / 继续 / 完成 / 休息 / 过热 / 恢复 |
| `focus-storage.ts` | 6 个 `focus:*` 键的白名单读写、验签、幂等结算 |
| `focus-crypto.ts` | SHA-256 / HMAC-SHA256、canonical 序列化、会话 / 战报 / 统计签名与验签 |
| `focus-level.ts` | 等级阈值、等级标签、连续天数推进 |
| `focus-nebula.ts` | 按 `record.seed` 生成的确定性星云战报绘制 |
| `focus-audio.ts` | `FocusAudioEngine`：16kHz 单声道噪声采样、雨 / 火 / 键盘 3 轨、淡入淡出；AudioContext 依赖注入，Node 可单测 |

存储键：

| 键 | 内容 |
|---|---|
| `focus:session:v1` | 当前会话断点（FocusSession，含签名） |
| `focus:prefs:v1` | 3 轨开关 / 每轨音量 / 主音量 / BGM / 翻转检测 |
| `focus:key:v1` | 32 字节 HMAC key（64 位小写 hex） |
| `focus:ledger:v1` | 最近 50 条签名战报（FocusRecord[]） |
| `focus:stats:v1` | 终身累计、等级、连续天数、今日专注、`lastAppliedRecordId` |
| `focus:brightness:v1` | `{ version, original, owned }` 亮度恢复标记 |

- key 只能由 `wx.getRandomValues({ length: 32 })` 生成；接口不可用 / 失败 → `keyLost`，**绝不回退 `Math.random`**。
- 所有读取走白名单字段复制 + 上限校验；坏数据不抛到页面。会话校验时间戳一致性（`phaseEndsAt − phaseStartedAt ≈ phaseTotalMs`，容差 1s）。
- 结算按 `record.id = rec-<sessionId>` 幂等；先验签、再写 ledger、最后更新 stats；写失败保留 session，下次 `onShow` 用同一 id 重试。
- 只有验签通过（`verified && reason === 'ok'`）的记录才增加等级 / 连续天数 / 今日专注；`signature` / `clock` / `keyLost` 只展示战报，不更新 stats。
- 等级阈值（`LEVEL_THRESHOLDS_MS`）：L1 0h、L2 2h、L3 8h、L4 20h、L5 50h、L6 100h；标签依次为「初识心流 / 渐入佳境 / 稳定心流 / 深度专注 / 心流大师 / 心流传奇」。
- 连续天数：昨天完成 → +1；今天已完成 → 不变；其他 → 1。
- 清空专注数据会删除全部 6 个 `focus:*` key。

一轮专注结束后的结算时序：

```mermaid
sequenceDiagram
  autonumber
  participant Page as 专注页
  participant FSM as focus-fsm
  participant Storage as focus-storage
  participant Crypto as focus-crypto
  participant Ledger as focus 账本
  participant Stats as focus 统计

  Page->>FSM: completeFocusSession(session, now)
  FSM-->>Page: completion + record 输入
  Page->>Storage: buildFocusRecord(input, key)
  Storage->>Crypto: signRecord()
  Storage-->>Page: FocusRecord
  Page->>Storage: settleFocusRecord(record, stats)
  Storage->>Crypto: verifyRecord()
  alt 验签通过
    Storage->>Ledger: 按 record.id 幂等追加（≤50 条）
    Storage->>Stats: applyFocusRecordToStats()
    Storage->>Crypto: signStats()
    Storage-->>Page: applied = true
  else 验签失败 / keyLost / clock
    Storage->>Ledger: 仍写入账本供展示
    Storage-->>Page: applied = false（不增加等级 / 连续天数）
  end
  Page->>Page: openReport(record, stats)
```

#### 页面运行时（`subpackages/life/pages/focus/index.ts`）

- 计时：`TICK_MS = 250`、每 30s 落盘一次会话、每 60s 写心跳；`Date.now()` 与单调时钟双锚点，漂移超过 `CLOCK_DRIFT_LIMIT_MS = 5000` 判时钟异常，本次不计入等级。
- 翻转检测：加速度计姿态 `FACE_DOWN_RAD = 2.35` 持续 600ms 进入黑屏；拿起 `PICKUP_RAD = 1.2` 持续 300ms 退出；黑屏时亮度降至 `0.05`，普通专注降至 `0.2`，`onHide` / `onUnload` 幂等恢复原始亮度。
- Glitch：破功只累加 `breaches`，不暂停计时、不切换 fsm；冷却 `GLITCH_COOLDOWN_MS = 5000`，视觉抖动 `GLITCH_DURATION_MS = 1000`。
- BGM 仅在 `focusing` 且页面隐藏时播放；暂停 / 休息 / Overheat 立即停止，`onShow` 按当前 fsm 恢复。
- Canvas 专注环以 `.focus-ring-wrap` 环盒为尺寸基准，逐帧 `setTransform(dpr,0,0,dpr,0,0)`；查询超时 700ms、重试 2 次，失败降级静态环。
- 战报 / 海报 / 星云：战报展示期间隐藏导航与顶部 chip、底层舞台 `opacity: 0`；海报异步返回时检查 `destroyed`；`saver` 模式关闭触感。
- 页面在专注 / 抽屉 / 战报 / 海报期间将 `update-guard` 置为 blocked，避免更新弹窗打断。
- `onHide` 停计时 / 存断点 / 恢复亮度 / 暂停音频；`onUnload` 释放定时器、动画帧、音频、Store 绑定、网络与加速度监听。

### 8.26 农历与节气（`lunar`）

来源：`subpackages/tools-dict/lib/lunar.ts` + `lunar-data.ts` + `pages/lunar/*`。

- `lunar-data.ts` 是 solarlunar 3.1.0（ISC，28,994B）单文件 vendor，含 1900–2100 农历压缩表、24 节气表与公历 / 农历互转。
- `toLunar(year, month, day)` 先校验日期与 1900-01-31 ~ 2100-12-31 范围，再返回农历年 / 月 / 日、闰月、生肖、星期与传统节日。
- `solarTermOf` 遍历当年与次年 24 个节气，返回当日节气，或下一个节气与距今天数；采用 `Date.UTC` 日序号，与日期引擎口径一致。
- `lunarFestival` 只认非闰月的春节（1/1）、元宵（1/15）、端午（5/5）、中秋（8/15）、重阳（9/9）。
- `parseLunarDate` 支持 `YYYY-MM-DD`、`YYYY/MM/DD`、`YYYY年M月D日`、`YYYYMMDD`，供文本 Workflow 注入。
- 页面默认今天但不自动计算；选择日期后点击「换算农历」再计算；结果可复制 `lunarSummary`。
- 农历生日：`lunarBirthday(year, month, day, today)` 从公历生日得到农历生日、生肖、下次农历生日公历日期、星期、倒计时天数与第几个农历生日；闰月出生按同月非闰月计算，目标农历月只有 29 天时按廿九计算；超出 2100 年范围时 `daysUntil = -1` 并标注。
- 页面支持「公历转农历 / 农历生日」双模式；两种模式都需选择日期后点击对应按钮才计算，避免选择日期即出结果；结果可复制 `lunarSummary` / `lunarBirthdaySummary`。

### 8.27 汇率换算（`fx-manual`）

来源：`subpackages/tools-daily/lib/fx.ts` + `lib/fx-official.ts` + `pages/fx-manual/*`。

- 8 个固定币种：CNY / USD / EUR / JPY / HKD / GBP / AUD / CAD；不支持自定义。
- 两种牌价来源：默认「官方中间价」，可切换「手动牌价」；官方请求失败且无缓存时，页面提示错误并引导改用手动。
- 官方数据来自中国外汇交易中心（CFETS）`https://www.chinamoney.com.cn/r/cms/www/chinamoney/data/fx/ccpr.json`；`parseCfetsRates` 解析 `data.lastDate` 与 `records[].vrtEName/price`，要求 USD / EUR / JPY / HKD / GBP / AUD / CAD 全部存在，`100JPY/CNY` 除以 100。
- `officialCrossRate` 以人民币为桥（`fromCny / toCny`）计算任意两币种交叉牌价；同币种或缺价返回 null。
- 官方中间价按交易日 9:15 发布，不是逐秒行情；页面展示来源与更新时间，文案不得出现「实时汇率 / 实时行情」宣称。
- `fx-official.ts` 是唯一发起 CFETS 请求的服务层：8s 超时、6 小时缓存（`tbx:fx.official.v1`）、请求失败回退旧缓存并标记 stale；页面不直接 `wx.request`。部署前需在小程序后台把 `https://www.chinamoney.com.cn` 加入 request 合法域名。
- 金额以分整数计算，单笔上限 `100,000,000` 分（1,000,000.00 元）；牌价范围 `0.000001–1,000,000`，最多 6 位小数。
- `convertManual` 校验币种不同、金额与牌价范围后返回 `convertedCents = Math.round(amountCents × rate)` 与 `inverseRate = 1 / rate`。
- `parseFxRate` 拒绝 0、7 位小数与超范围；`formatFxRate` 输出去尾零的牌价。
- `fxDateWarning` 仅用于手动牌价：早于 2000-01-01 或晚于今天只提示，不阻止换算。
- `fxSummary` 官方模式输出「来源 中国外汇交易中心（CFETS）官方中间价 · 官方中间价，仅供参考」，手动模式输出「汇率由用户手动填写，仅供参考」。

### 8.28 简繁转换（`zh-convert`）

来源：`subpackages/tools-dict/lib/zh.ts` + `zh-data.ts` + `pages/zh-convert/*`。

- 词库来自 OpenCC 1.4.2（Apache-2.0），经 opencc-js 1.4.2 提取：简→繁 3,881 字 / 5,000 词，繁→简 3,512 字 / 5,000 词；数据文件 309,803B。
- `convertZh(input, { direction, mode })`：方向 `s2t / t2s`，模式 `phrase / char`；默认简→繁 + 词组优先。
- 词组优先按 4→2 字最长匹配，未命中再走字符表；未收录字符原样保留；`replaced` 按输出差异计数，不做公共前后缀差分。
- 一词多繁（如“发→發 / 髮”）按常用词处理，`ambiguous` 统计命中次数；页面显示“一词多繁 / 多简字”提示。
- 上限 20,000 字，超出截断并提示；空串由页面展示空态。
- `zhSummary` 输出方向 / 模式 / 替换字数 + 前 200 字结果，供复制与文本 Workflow。
- 页面支持方向与模式切换保留输入、示例、重置、复制与 `onReceiveWorkflow`。

### 8.29 拼音标注（`pinyin`）

来源：`subpackages/tools-dict/lib/pinyin.ts` + `pinyin-data.ts` + `pages/pinyin/*`。

- 词库由 pinyin-pro 3.29.5（MIT）生成：8,000 字 + 1,050 个常用多音词；数据文件 111,205B。
- `toPinyin(input, { tone })`：默认带声调；先按 4→2 字词组匹配消歧，再走单字表；多音字取第一个常用读音并计数。
- 非汉字原样保留；未收录汉字保留原字并计入 `uncovered`；输出用空格分隔拼音，标点与空白保持原样。
- `stripTone` 去声调（保留 ü）；`pinyinComparison` 输出汉字逐字对照，页面默认展示前 200 字。
- 上限 2,000 字，超出截断并提示；`pinyinSummary` 供复制与文本 Workflow。
- 页面支持声调切换保留输入、示例、重置、复制与 `onReceiveWorkflow`。

### 8.30 薪资反算（`salary-inverse`）

来源：`subpackages/tools-daily/lib/salary.ts` + `pages/salary-inverse/*`；个税计算复用 `core/toolbox/engines/tax.ts`。

- 输入：目标到手月薪、五险一金按比例（0–100%）或固定金额、专项附加扣除；全部以分整数计算。
- `inverseSalary` 先校验目标与参数，再在 1 分–1,000,000 元之间二分查找“到手 ≥ 目标”的最小税前值，并与前一分比较，优先返回精确值；误差 >1 分或未收敛返回 null。
- `forwardSalaryNet` 已知税前月薪时复用 `calcTax` 计算五险一金、应纳税所得额、个税与到手，供反算后校验。
- 税前上限 `100,000,000` 分（1,000,000 元/月）；五险一金比例 >100、目标 ≤0、目标超过可达到上限均拒绝。
- `maxIter` 默认 60、上限 200，可注入较小值测试不收敛。
- `salarySummary` 输出目标到手、税前、五险一金、专项附加、应纳税所得额、个税、校验到手与“月度简化口径，不按累计预扣，仅供参考”。
- 页面支持比例 / 固定金额切换保留输入、示例、重置、复制与 `onReceiveWorkflow`。

### 8.31 证件照换底（`id-photo`）

来源：`subpackages/tools-media/lib/idphoto.ts` + `pages/id-photo/*`。

- 不引入云端 AI：从顶部外圈与左右上半区建立背景色簇（最多 6 个），避开顶部头发与肩部衣物；底部仅作为匹配种子。
- 颜色使用 YCbCr 加权距离（亮度 0.64、色度 1.21），对阴影更宽容；纯色 / 渐变 / 纹理 / 复杂背景都会输出结果，不再直接拒绝。
- 漫水填充从图像四边向内扩散，只删除与边缘连通的背景；椭圆主体先验 + 边缘梯度屏障 + 底部保护，避免吃掉衣物与肩线。
- 边缘保护 0–100、背景容差 10–60、羽化 0–6px 可调；Alpha 盒式模糊后按 `原色 × a + 目标色 × (1-a)` 混合，羽化 0 为硬边。
- 默认羽化 = 输出长边 ×2/1000，至少 1px；输出长边 ≤1200、保持原比例、不放大。
- 目标底色：白 `#FFFFFF`、蓝 `#438EDB`、红 `#D9001B`。
- 源图 >1200 万像素或 >50MB 拒绝；输出 PNG，支持预览与保存相册。
- 不做人脸识别、不提取人脸特征、不上传；图片适配器注入后调用 `render`，页面退出清理临时文件。

### 8.32 百分比计算（`percent`）

来源：`core/toolbox/engines/percent.ts` + `subpackages/tools-daily/lib/percent.ts` 薄 re-export + `pages/percent/*`。

- 三模式：占比（部分 / 总数）、增减幅（原值 / 新值）、配比（A : B）。
- 数值最多两位小数，统一放大 100 倍为整数；占比与增减幅结果四舍五入到 0.01%。
- 增减幅 =（新值 − 原值）/ 原值；旧值为 0 返回 null；涨跌幅绝对值超过 1000% 返回 null。
- 配比按最大公约数化简为最简整数比，并输出合计份数与双方占比；两者同时为 0 返回 null。
- `parsePercentWorkflow` 支持 `占比 25 200` / `增减 100 120` / `配比 16 24`，无前缀默认占比；silent 执行器输出 `percentSummary`。
- 页面三模式独立缓存输入，切换模式保留各自内容；结果支持复制与 Workflow 来源。

### 8.33 日期加减（`date-add`）

来源：`core/toolbox/engines/date.ts`（`addDate` / `dateAddSummary` / `parseDateAddWorkflow`）+ `pages/date-add/*`。

- 输入为起始日 + 有符号整数 + 单位（天 / 周 / 月 / 年），页面把“方向 + 非负数量”合成为有符号数量。
- 天 / 周按 UTC 零点日序号推进；月 / 年复用 `addMonths` 按日历推进，目标月天数不足时钳制到月末。
- 2 月 29 日加一年到平年落到 2 月 28 日；`clamped` 标记本次是否发生钳制。
- 数量上限 100000；结果必须落在 1900-01-01 至 2100-12-31，否则返回 null。
- `parseDateAddWorkflow` 解析 `YYYY-MM-DD ±30d/w/m/y`，兼容中文单位（天 / 日 / 周 / 星期 / 月 / 年）与 `/` 分隔；缺单位、非法日期、超上限均拒绝。
- silent 摘要：`2026-01-31 +1 月 → 2026-02-28 · 周六 · 相差 28 天 · 月末已调整`；页面与执行器同源。

### 8.34 颜色转换（`color`）

来源：`core/toolbox/engines/color.ts` + `pages/color/*`。

- 解析 3 / 4 / 6 / 8 位 HEX、`rgb()` / `rgba()`、`hsl()` / `hsla()`；透明度统一忽略，非法值返回 null。
- 输出 `#RRGGBB`、`rgb(r, g, b)`、`hsl(h, s%, l%)`；HSL 展示取整，h 归一化到 0–359。
- WCAG 2.x 相对亮度：通道先线性化（≤0.03928 用 `/12.92`，否则 `((c+0.055)/1.055)^2.4`），`L = 0.2126R + 0.7152G + 0.0722B`；对比度 `(Lmax+0.05)/(Lmin+0.05)`。
- 阈值：AA 正文 ≥4.5、AA 大字 ≥3、AAA 正文 ≥7、AAA 大字 ≥4.5；阈值用原始比值判断，展示保留两位小数。
- 色觉模拟：Machado 2009 红 / 绿 / 蓝三种矩阵在线性 RGB 空间计算，再用同一背景给出模拟后的对比度。
- silent 默认白底，摘要 `#FF0000 · rgb(255, 0, 0) · hsl(0, 100%, 50%) · 对白 4.0:1（仅大字 AA 通过）`；页面与执行器同源。

### 8.35 JSON ↔ CSV（`json-csv`）

来源：`core/toolbox/engines/csv.ts`（`jsonToCsv` / `csvToJson` / `escapeCsv`）+ `pages/json-csv/*`。

- JSON → CSV：仅接受对象数组；表头取所有对象键的并集（首次出现顺序），缺失字段留空；CRLF 行尾。
- 单元格：字符串原样；数字 / 布尔转文本；`null` 与缺失为空；嵌套对象 / 数组 `JSON.stringify`，并提示有损。
- 公式注入防护：以 `= + - @` 开头的非纯数值文本前置单引号；含逗号 / 引号 / 换行时整体加引号、内部引号翻倍。
- 可选 UTF-8 BOM：页面输出默认带 BOM，便于 Excel 识别中文；silent 输出不带 BOM。
- CSV → JSON：首行表头，支持引号内逗号 / 换行与 `""` 转义；重复表头、列数超过表头直接拒绝；所有单元格按字符串输出，不推断数字 / 布尔；移除 Excel 文本保护前缀。
- 上限 2MB；空数组 / 空 CSV / 非对象数组 / JSON 解析失败均返回可读错误。

### 8.36 尺码换算（`size-convert`）

来源：`subpackages/tools-daily/lib/size.ts` + `pages/size-convert/*`。

- 鞋码：EU 与中国码同码；男鞋 EU 38–50（US = EU − 33，UK = US − 1），女鞋 EU 33–44（US = EU − 30.5，UK = US − 2.5）；脚长 = (EU + 10) / 2 cm；仅接受整码 / 半码。
- 服装：中国码 XS–XXL 静态表；女装 155–180 / 胸围 80–100，男装 165–190 / 88–108；同时给出美国字母码、欧洲码与英国码。
- 戒指：以周长 mm 为唯一基准，支持 48–64mm；中国码 = 周长 − 40，欧洲码 = 周长，美国码按 `36.5 + 2.55 × US` 反算后取 0.5 档；直径 = 周长 / π。
- 纯产出卡：`WORKFLOW_ACCEPTS` 为空，适配器为 unsupported，不实现 `onReceiveWorkflow`；`sizeSummary` 仅供发起端流转。
- 超范围与非法步长返回 null；结果只在本机计算，标注仅供参考。

### 8.37 离职补偿（`severance`）

来源：`subpackages/tools-daily/lib/severance.ts` + `pages/severance/*`。

- 年限折算：总月数 <6 → 0.5 个月；6–11 → 1 个月；12 起按满年计算，余数 ≥6 个月进一年。
- 经济补偿 = 计发基数 × 折算年限；N+1 额外增加一个月计发基数（代通知金）。
- 封顶：启用后计发基数 = min(月薪, 3 × 当地社平月薪)，补偿年限最多 12 年；社平 ≤0 拒绝。
- 未休年假：日薪 = 月薪 / 21.75；额外补偿 = 日薪 × 天数 × 200%（正常工资另计），支持 0–30 天半天。
- `finance` 敏感类型；结果区同时展示金融免责与“补偿与年假试算仅供参考，不构成法律意见”。
- 纯产出卡：`accepts: []` + unsupported 适配器，不实现 `onReceiveWorkflow`；`severanceSummary` 供发起端流转。

### 8.38 证件号校验（`id-validate`）

来源：`subpackages/tools-daily/lib/id.ts` + `pages/id-validate/*`。

- 身份证：18 位，前 17 位加权（7/9/10/5/8/4/2/1/6/3/7/9/10/5/8/4/2），校验码表 `10X98765432`；末位 X 大小写归一。
- 出生日期取第 7–14 位并用日期引擎校验真实日期，未来日期拒绝；性别取第 17 位奇男偶女；地区码取前 6 位。
- 银行卡：12–19 位数字，Luhn 校验；空格 / 连字符先归一。
- 自动识别：15 位纯数字提示旧证；18 位先身份证，失败再 Luhn；其余 12–19 位按银行卡。
- `personal` + privacyNote「号码只在本机校验，不保存、不上传」；摘要与海报统一脱敏，不输出完整号码。
- jump + text：适配器调用 `onReceiveWorkflow` 注入 `value`；不写入 silent 执行器。

### 8.39 图片转 PDF（`image-pdf`）

来源：`subpackages/tools-media/lib/pdf.ts` + `pages/image-pdf/*`。

- 1–9 张图片；页面尺寸 A4 595×842pt、Letter 612×792pt、原图按 72DPI；等比缩放并居中。
- 只嵌入 JPEG（`/Filter /DCTDecode`）；PNG 先经 Canvas 白底重绘转 JPEG，透明通道丢弃。
- 三级降级：长边 1600 / 1280 / 1024，质量 90 / 75 / 60；仍超过 2MB 或超过 9 页则拒绝。
- 手写 PDF 1.4：Catalog / Pages / Page / Contents / XObject；`xref` 偏移与 `startxref` 必须指向正确位置。
- 写入 `USER_DATA_PATH/exports`，`wx.openDocument({ fileType: 'pdf', showMenu: true })` 预览；不上传、不写相册；退出页面与重置时清理。
- `privacy`；jump + image：适配器调用 `onReceiveWorkflow` 追加一页，`outputPath` 作为 Workflow 来源。
- 页面选择图片或切换页面尺寸后不自动生成；点击「生成 PDF」才执行，输入变化会作废进行中的渲染并清空旧结果。

### 8.40 条形码生成（`barcode`）

来源：`subpackages/tools-media/lib/barcode.ts` + `pages/barcode/*`。

- CODE128 码表 0–106（107 项）；起始符 104、终止符 106；普通符号 11 模块，终止符 13 模块。
- 数据符 = ASCII − 32（仅 32–126）；校验位 = `(104 + Σ 数据值 × 位序) mod 103`。
- 左右各 10 模块静区；总宽 = 20 + 符号数 × 11 + 13。
- 复用 `png.ts` 的 1-bit 灰度 PNG：所有扫描线相同，打包一次后按高度重复；条宽 2 / 3 / 4px，条高 40 模块 + 上下各 5 模块。
- 80 字符上限；空 / 非 ASCII / 超长分别返回 `empty` / `non-ascii` / `too-long`，页面给出对应文案。
- 写入 `USER_DATA_PATH`（`tbx-barcode-<ts>.png`），保存走 `core/utils/album.ts`；重新生成 / 重置 / 退出清理旧图；不联网、不读相册。
- `privacy`；jump + text：适配器调用 `onReceiveWorkflow`，编码失败返回 false 不污染页面；`outputPath` 作为 Workflow 图片来源。

### 8.41 图片信息（`exif`）

来源：`subpackages/tools-media/lib/exif.ts` + `pages/exif/*`。

- 相册单图；`chooseSingleImage` 先做隐私授权前置，仅读取用户主动选择的一张图片。
- `wx.getImageInfo` 读取宽高、格式与方向；`wx.getFileSystemManager().getFileInfo` 读取本地体积；体积失败按 `—` 降级。
- 归一化：宽高缺失 / 0 / 负数 / `NaN` / `Infinity` 一律视为损坏文件返回 null；像素向下取整。
- 衍生信息：宽高比（能约成小整数时 `4 : 3`，否则 `1.25 : 1`）、万像素、文件体积、文件名。
- 明确不解析 EXIF 中的 GPS、设备型号、拍摄时间等隐私字段；不写相册、不联网。
- 方向映射：up / down / left / right 及 4 种 mirrored 组合；未知方向显示“未知”。
- `privacy`；jump + image：适配器调用 `onReceiveWorkflow`，`exifSummary`（尺寸 · 格式 · 体积[ · 方向]）作为 Workflow 文本来源。

### 8.42 元宝搜索（`web-search`）

- 服务：腾讯云元宝搜索 WSA `SearchPro`（`Version=2025-05-08`）；支持服务 API KEY 方式（`POST https://api.wsa.cloud.tencent.com/SearchPro` + `Authorization: Bearer <API KEY>`）或标准 TC3 方式（`POST https://wsa.tencentcloudapi.com/` + `SecretId/SecretKey` 签名）。
- 签名：`core/services/yuanbao/sign.ts` 纯 TS SHA-256 / HMAC-SHA256 / TC3-HMAC-SHA256；固定时间戳向量已与 Node crypto 对照。
- 入参：`Query` 必填；`Cnt` 10 / 20 / 30 / 40 / 50；`Freshness` 支持 `d7 / m1 / y1`、自定义 `dN / mN / yN`（天 1–30 / 月 1–12 / 年 1–5）、单日 `yyyy-mm-dd` 与区间 `yyyy-mm-dd,yyyy-mm-dd`；`Industry` 支持 `news / acad / finance / gov`；`Site` 支持单域名或 `exclude:域名|域名`；`Deeplinks` 仅旗舰版。
- 出参：`Response.Pages` 为 JSON 字符串数组；逐条解析 title / url / site / date / passage / content / score / authority_level / favicon / pics / deeplinks，HTML 标签与实体清洗为纯文本，非法条目丢弃；页面同时展示 `Version`（极速版 / 标准版 / 旗舰版）、`Msg` 与 `RequestId`。
- 错误：`UnauthorizedOperation` / `ResourceNotFound` / `RequestLimitExceeded` / `ResourceUnavailable` / `InvalidParameter` 映射为可读文案；HTTP 401/403 按未授权处理，超时与网络失败可重试；`url not in domain list` 明确提示添加 `wsa.tencentcloudapi.com`。
- 配置：`core/services/yuanbao/config-local.ts` 保存服务 API KEY 或 SecretId / SecretKey（git 忽略）；`scripts/ensure-yuanbao-config.js` 在缺失时生成占位文件；MP 后台按凭证方式加入 request 合法域名：Bearer 用 `api.wsa.cloud.tencent.com`，TC3 用 `wsa.tencentcloudapi.com`。
- 入口：独立工具卡 + 独立页 + 首页搜索「用元宝搜索」+ 首页内联前 4 条结果；首页 520ms 防抖并在新输入 / 卸载时 abort 在途请求；首页搜索框与元宝搜索词输入框均支持一键清空，首页清空会中断在途请求并复位结果。
- 结果区：`subpackages/tools-core/components/web-search-results/` 承载结果卡、权威度 / 相关性徽标、复制、详情抽屉（配图描述、图标地址、附件子链、RequestId）与空态；页面因此保持 24KB 预算内。
- 导出：`summarizeYuanbaoResults` 只取前 3 条并标注剩余数量用于复制摘要；`exportYuanbaoResults` 输出全部结果的标题 / 来源 / 日期 / 链接 / 摘要，供 `.txt` 导出与分享；详情抽屉通过 `toArticleExport` 预写单篇文章（标题 / 来源 / 链接 / 摘要 / 正文 / 配图地址 / 子链），tap 时同步调用 `sharePrepared`。
- 页面拆分：`subpackages/tools-core/lib/web-search-view.ts` 承载筛选选项、结果卡片映射与空态，`subpackages/tools-core/lib/freshness.ts` 统一自定义时效归一化与校验，页面只保留交互，保持 24KB 预算内。
- 隐私：查询词会上传至腾讯云；查询词不写草稿与计算轨迹；海报 / 轨迹只保存结果数量与筛选条件。
- 边界：外链不能直接被小程序打开，统一复制后在浏览器打开；`pics` / `favicon` 展示描述与地址复制，受小程序图片下载域名限制；`deeplinks` 需旗舰版权限，标准版 / 极速版忽略并提示；极速版不支持部分筛选参数。

### 8.43 和风天气（`qweather`）

来源：`subpackages/weather/`；独立分包，是注册表 65 个工具之一，也是第 4 个联网工具。

- **数据层**：`lib/qweather/endpoints.ts`（20 个端点构造器 / 27 个范围变体与 TTL）、`client.ts`（JWT / API KEY 双认证、12s 超时、可 abort、错误映射）、`service.ts`（组合、缓存、v1 与 v7 合并、同端点重复自检取消）、`parse.ts`（全部响应归一化为 ViewModel）、`cache.ts`（单键 40 条、650KB 上限、跨本地自然日失效）、`city.ts`（GeoAPI + 最多 5 城市）、`location.ts`（只申请 `wx.getFuzzyLocation`）、`icons.ts`（官方图标映射与夜间码转换）。
- **认证**：JWT Header `{alg:"EdDSA",kid}`、Payload `{iss,sub,iat,exp}`，有效期 24 小时；`scripts/qweather-token.js` 读取 Ed25519 私钥生成并写入 gitignored `config-local.ts`；API KEY 走 `X-QW-Api-Key`，优先于 JWT。
- **日期口径**：每日 / 空气质量 / 生活指数按城市的 `utcOffset` 计算本地日期（`dateKeyForOffset` / `todayKeyFor`），API 自检中的天文端点日期也按城市 `utcOffset` 生成，避免跨时区把「今天」标错；天文只允许今天及未来 60 天，时光机只允许最近 10 天并由页面维护日期窗口；空气质量三接口均带 `localTime=true`。
- **缺失值**：统一显示「—」，不拼接半截单位；v7 只有全天降水时降水列显示「—」，不伪装成夜间值；图标码 `9999` 视为无效并回退到 v1 或线框图标。
- **页面**：`pages/home` 只保留分享与 Workflow 外壳，全部 UI / 数据编排在 `components/qw-screen`；7 Tab（总览 / 逐小时 / 每日 / 空气 / 指数 / 天文 / 时光机）+ 自定义导航（胶囊安全区实测）+ 下拉刷新；城市抽屉支持模糊定位、GeoAPI 搜索与景点解析。
- **组件**：`qw-screen`、`qw-hero`、`qw-minutely`、`qw-alerts`、`qw-hourly`、`qw-daily`、`qw-air`、`qw-indices`、`qw-astronomy`、`qw-history`、`qw-city-sheet`、`qw-api-sheet`、`qw-icon`，共 13 个，全部同分包。
- **图标**：QWeather Icons 1.8.0 全量 507 个 SVG（505 个天气 / 预警 / 月相 + 2 个品牌），保留 `LICENSE.md`；`qw-icon` 在 `-fill` 缺失时自动退回线框版，再失败回退 `9999`。
- **自检**：`qw-api-sheet` 逐个真实请求 27 个端点，显示通过 / 失败 / 延迟 / 条数；同端点重复自检会先取消旧请求，避免旧响应写回；全部通过时 toast 提示。
- **测试**：`tests/qweather.test.js` 11 条覆盖端点 / 图标 / 映射 / 解析 / 缓存 / 凭据 / 页面契约 / 本地日期；`npm run qweather:token` 可在 Token 过期前重新生成。

---

## 9. 组件库

### 9.1 主包组件（27 个）

| 组件 | 作用 | 关键属性 / 事件 |
|---|---|---|
| `animated-number` | 数字滚动 | `value`、`duration`、`decimals`、`separator` |
| `command-palette` | 全局指令面板 | `useBuiltins`、`commands`、`placeholder`、`maxResults`（默认 12） |
| `g-card` | 旧版卡片 | `padding`、`solid`、`sheen`、`hover`、`tap` |
| `g-gallery` | 旧版图集（当前页面主要用分包副本） | `groups`、`tone`、`dark` |
| `g-icon` | 图标字体 | `name`、`size`、`tone`、`color`、`flip` |
| `g-navbar` | 旧版导航栏 | `title`、`back`、`transparent`、`bare`、`theme` |
| `g-section` | 分区标题 | `kicker`、`title` |
| `g-skeleton` | 骨架屏 | `rows`、`card`、`avatar` |
| `g-tag` | 标签 | `tone`、`solid` |
| `g-toast` | 旧版提示 | 订阅 `uiStore` |
| `glass-bottom-sheet` | 底部抽屉 | `show`、`title`、`description`、`size`、`open` / `opened` / `close` / `closed` |
| `glass-button` | 极光玻璃按钮 | `variant`、`size`、`shape`、`block`、`loading`、`aura`、`success`、`disabled`、`haptic` |
| `glass-card` | 液态玻璃卡片 | `tone`、`radius`、`padding`、`depth`、`bordered`、`noise`、`sheen`、`sss`、`dispersion`、`lightTracking` |
| `glass-fullscreen-reader` | 全屏沉浸阅读 | `show`、`title`、`content`、`zIndex`、`close` / `closed` |
| `glass-input` | 玻璃输入框 | `value`、`type`、`password`、`multiline`、`maxlength`、`showCount`、`clearable`、`input` / `focus` / `blur` / `confirm` / `clear` |
| `glass-modal` | 玻璃确认弹窗 | `show`、`title`、`description`、`confirmText`、`cancelText`、`showCancel`、`maskClosable`、`danger`、`extraText`、`confirm` / `cancel` / `extra` / `close` / `opened` |
| `glass-slider` | 玻璃滑轨 | `value`、`min`、`max`、`step`、`disabled`、`input` / `change` |
| `glass-toast` | 全局 Toast 渲染器 | `zIndex`、`customStyle` |
| `glass-tool-card` | 工具页玻璃卡片 | `variant`、`label`、`code`、`hasResult`、`emptyTitle`、`emptySub`、`showActions` |
| `glass-tool-shell` | 工具页统一骨架 | 见 9.2 |
| `poster-generator` | 纯本地海报绘制内核 | 方法 `generate(payload)` |
| `poster-preview` | 海报全屏预览 | `show`、`imagePath`、`loading`、`error`、`saver`、`close` / `closed` |
| `privacy-guard` | 隐私授权弹窗 | 订阅 `privacyStore` |
| `update-guard` | 全局更新守门 | `blocked`；全局互斥 |
| `meeting-timer-hud` | 全局会议倒计时胶囊 | 跨页面显示剩余 / 暂停 / 结束；点击回到计时页 |
| `workflow-panel` | 流转工作台 | `show`、`sourceToolId`、`close` |
| `workflow-receiver` | 目标页注入接收器 | `toolId` |

### 9.2 `glass-tool-shell` 深拆

文件：`components/glass-tool-shell/index.ts` / `.wxml` / `.wxss`。

用途：65 个工具中 62 个工具页的统一外壳（`watermark` 自定义工作台、`weather` 全屏气象舞台与 `qweather` 全屏主屏除外）。

组件协作关系：

```mermaid
flowchart LR
  Page["工具页"] --> Shell["glass-tool-shell"]
  Shell --> Card["glass-tool-card"]
  Shell --> Btn["glass-button"]
  Shell --> Toast["glass-toast"]
  Shell --> WF["workflow-panel"]
  Shell --> Receiver["workflow-receiver"]
  Shell --> Poster["poster-generator"]
  Shell --> Preview["poster-preview"]
  Shell --> Privacy["privacy-guard"]
  Shell --> Update["update-guard"]
  WF --> Store["workflowStore"]
  Receiver --> Store
  Store --> Adapter["workflowAdapters"]
  Adapter --> Target["目标工具页"]
  Poster --> Data["posterData / IPosterData"]
```

属性：

| 属性 | 类型 | 说明 |
|---|---|---|
| `toolId` | String | 工具 id，用于收藏、埋点、Workflow |
| `title` | String | 页面标题 |
| `kicker` | String | 英文 / 分类眉题 |
| `desc` | String | 描述 |
| `sensitive` | String | `privacy` / `personal` / `finance` / `health`，决定隐私提示 |
| `state` | String | `idle` / `running` / `done` / `invalid` / `error` |
| `runLabel` | String | 主按钮文案 |
| `canRun` | Boolean | 是否可运行 |
| `showRun` | Boolean | 是否显示运行按钮 |
| `showExample` | Boolean | 是否显示示例按钮 |
| `hasResult` | Boolean | 结果是否就绪 |
| `error` | String | 错误文案 |
| `emptyTitle` / `emptySub` | String | 空态文案 |
| `posterEnabled` | Boolean | 是否显示海报入口 |
| `posterValue` / `posterSub` | String | 海报主值 / 说明（旧字段兜底） |
| `posterData` | Object | `IPosterData`，优先于旧字段 |
| `updateBlocked` | Boolean | 页面自有弹窗 / 输入态时挂起更新弹窗 |
| `exportEnabled` | Boolean | 是否显示结果导出入口，默认关闭 |
| `exportName` | String | 导出文件名（外壳统一清洗与截断） |
| `exportContent` | String | 导出正文；为空时用 `posterData` 拼兜底文本 |
| `exportType` | String | `txt` / `md` / `csv` / `json`，非法值回退 `txt` |

插槽：

| 插槽 | 位置 |
|---|---|
| `input` | INPUT / 输入卡片 |
| `result` | RESULT / 结果卡片 |
| `note` | 结果区下方说明 |

事件：

| 事件 | 触发 |
|---|---|
| `run` | 主按钮 |
| `reset` | 重置按钮 |
| `example` | 示例按钮 |

内置能力：

- 返回 / 收藏 / 示例 / 运行 / 重置。
- 输入卡片、结果卡片、空态、错误提示。
- 结果下方「流转到其他工具」与「生成专属海报」。
- 结果导出：`exportContent` 变化后 300ms 防抖预写；tap「导出结果文件」同步分享；低版本 / 准备失败 / 分享失败降级为复制；结果变化与卸载清理本页文件；`quote` CSV 与 `image-pdf` PDF 保留专用导出。
- 页脚：每次进入工具页从 `core/toolbox/quotes.ts` 随机取一条 ≤10 字人生哲理，避免连续重复；只展示「短语」，不再显示长文案。
- 自动埋点：`hasResult` / `posterData` 变化后 160ms 防抖写入轨迹。
- 自动挂载 `workflow-receiver`、`workflow-panel`、`poster-generator`、`poster-preview`、`privacy-guard`、`meeting-timer-hud`、`update-guard`。
- `update-guard` 的 `blocked` 绑定 `state === 'running' || workflowPanelVisible || posterVisible || isGenerating || updateBlocked`。
- 卸载时 `workflowStore.clear()`，清理图片孤儿队列。

### 9.3 `glass-toast` API

```ts
showGlassToast(input: string | GlassToastOptions): string
hideGlassToast(id?: string): void
clearGlassToasts(): void
mountGlassToast(target: GlassToastHost): GlassToastHost
glassToastBehavior // 为组件注入 this.$toast()
```

`GlassToastOptions`：

```ts
{
  message: string
  type?: 'info' | 'success' | 'warning' | 'error' | 'loading'
  duration?: number // 0 不自动关闭；loading 默认 0
  placement?: 'top' | 'center' | 'lower-center' | 'bottom'
  mask?: boolean
  tapToDismiss?: boolean
  icon?: string
  id?: string
  onClose?: () => void
  actionLabel?: string // 最多 6 字
  onAction?: () => void
}
```

- 单例 `toastStore`：当前消息 + 队列 + 自动消隐。
- 队列上限 5，最长 8000ms。
- `lower-center` 用于底部导航上方的提示（邮箱复制等）。
- 动作按钮与 `onAction` 必须同时提供；点击后立即置灰防连点。

### 9.4 指令面板（`command-palette`）

- 65 个工具自动生成命令 + 6 个全局导航命令。
- 模糊匹配：完全匹配 / 前缀 / 包含 / 字符子序列 / 关键词。
- 内置拼音全拼、拼音首字母、中英文别名、分类别名。
- 支持 `navigateTo` 与 `switchTab` 两种跳转模式。
- 首页魔法棒打开面板，面板状态与首页搜索变量完全隔离。
- 空状态：搜索线框图标 + “没有找到相关工具或指令”。
- 输入框隐藏原生清除按钮，只保留自定义清除图标。

### 9.5 极光海报链路

```text
glass-tool-shell.onGeneratePoster()
  → 打开 poster-preview 骨架（立即反馈）
  → 延迟 560ms（省电 240ms）后开始 Canvas 绘制
  → poster-generator.generate(payload)
    → 480×720 逻辑画布，DPR 缩放
    → 极光背景 / 工具名 / 分类胶囊 / 主结果 / 参数 / 衍生结论 / 品牌 / 二维码
    → 优先 /assets/miniprogram-qr.png，缺失回退 /assets/poster-qr.png
    → 二维码 1600ms 超时保护，失败只画占位
  → 海报淡入，骨架淡出
  → poster-preview 保存到相册（隐私授权 + 相册权限补救）
```

- 开发者工具 Skyline 不支持 `<canvas>` 时切换离屏 Canvas。
- Canvas 节点尺寸为 0 时最多重试 3 次，每次 100ms。
- DPR 默认兜底 2。
- 保存成功先展示弹性勾选反馈，停留 1.3s 后平滑退场。
- 所有过渡只使用 `opacity` / `transform`，避免逐帧 `filter: blur`。

### 9.6 空间全息（`spatial-hologram`）

- CSS `perspective + preserve-3d`，三层插槽：`back` / 默认 / `front`。
- 陀螺仪读取 `beta / gamma`，首帧校准基线，避免不同握持姿势跳变。
- WXS 阻尼循环：`change:prop` + `requestAnimationFrame` + `setStyle`，不逐帧 `setData`。
- `useMotion().hologramEnabled` 为 false（省电）时直接禁用。
- 页面隐藏 / 关闭 / 禁用时停止监听并回正。
- `virtualHost + styleIsolation: isolated`。

### 9.7 更新守卫（`update-guard`）

- 每个页面（含工具壳）挂载一次。
- 首选 `glass-modal`，1.5s 内未确认渲染则降级 `wx.showModal`。
- 跨页面 / 跨实例互斥：`globalData.promptState + promptOwner`。
- `blocked=true` 时只排队不打断。
- 原生弹窗与自定义弹窗互斥，降级前先关闭自定义层并留 260ms 退场。
- 关闭 / 遮罩 / 系统关闭均视为“稍后”，写 `hasPendingUpdate` 红点。
- “查看更新日志”跳设置页并自动展开更新日志。
- 页面销毁时若持有锁，主动交棒给下一个页面。

### 9.8 自定义 TabBar

- 3 个 Tab：工具 / 收藏 / 我的。
- 图标复用 `g-icon` 字体。
- 白昼纸面 / 夜航深玻璃两套材质，直接订阅 `uiStore.isDark`。
- 页面 `onShow` 通过 `selectTabBar(page, index)` 同步选中态。
- `switching` 锁在 `wx.switchTab` 的 `complete` 中释放。

### 9.9 音效引擎（`components/sound-hook.ts` + `core/services/sound.ts`）

- 基于 `wx.createInnerAudioContext`。
- 4 个内置极短 WAV 以 Base64 内嵌：`tap` / `success` / `warning` / `error`。
- 首次 `preload` 写入 `USER_DATA_PATH`。
- 通道池并发播放，`onEnded` / `onError` 自动回收。
- 全局静音、音量、iOS 静音开关策略、销毁清理。
- `useSound()` 是唯一业务入口，受 `preferenceStore.sound` 闸门控制。

### 9.10 分包组件（29 个）

| 分包 | 组件 | 关键属性 / 事件 | 作用 |
|---|---|---|---|
| grow | `g-button` | `variant`、`block`、`disabled`、`loading`、`tap` | 简历页旧版按钮 |
| grow | `g-aurora` | `density` | 简历页极光背景 |
| grow | `g-meter` | `level`、`tone`、`replay` | 技能掌握度量表 |
| grow | `g-modal` | `show`、`title`、`close` | 简历域弹窗 |
| grow | `g-orbit` | `size` | 入口轨道 / 徽章 |
| grow | `g-stat` | `value`、`suffix`、`label`、`kicker` | 数字速览 |
| grow | `g-timeline` | `eras` | 成长时间线 |
| grow | `glass-picker` | `show`、`title`、`description`、`options` | 设置页选项选择器 |
| grow | `glass-switch` | `checked`、`disabled`、`ariaLabel` | 设置页开关 |
| works | `g-gallery` | `groups`、`tone`、`dark` | 作品图集 / 大图查看 |
| works | `g-placeholder` | `title`、`tone`、`glyph` | 图片占位 |
| campus | `g-gallery` | `groups`、`tone`、`dark` | 园枢图集 / 大图查看 |
| campus | `g-placeholder` | `title`、`tone`、`glyph` | 图片占位 |
| tools-core | `weather-glyph` | `family`、`size`、`tone`、`night` | 气象图标族（白昼 / 夜航两套 SVG，按 `WeatherFamily` 映射；夜间晴天/多云切月亮版） |
| tools-core | `spatial-hologram` | `enabled`、`autoStart`、`maxTilt`、`sensitivity`、`damping`、`resetOnHide`、`aurora` | 空间视差容器（实验室页） |
| tools-core | `web-search-results` | `results`、`query`、`summary`、`version-label`、`version-hint`、`message`、`request-id` | 元宝搜索结果区：结果卡、权威度 / 相关性徽标、复制、空态、详情抽屉（配图 / 子链 / 图标地址） |
| weather | `qw-screen` | — | 和风天气主屏：7 Tab、城市 / API 抽屉、下拉刷新、全部数据编排 |
| weather | `qw-hero` | `city`、`current`、`today`、`air`、`alerts`、`loading`、`fromCache`、`error` | 总览实况英雄区 |
| weather | `qw-minutely` | `minutely`、`loading`、`error` | 分钟级降水 |
| weather | `qw-alerts` | `alerts`、`showEmpty`、`loading`、`error` | 灾害预警 |
| weather | `qw-hourly` | `hours`、`range`、`loading`、`error` | 逐小时预报与范围切换 |
| weather | `qw-daily` | `days`、`range`、`loading`、`error` | 每日预报与范围切换 |
| weather | `qw-air` | `air`、`loading`、`error` | 空气质量 AQI / 污染物 / 24h 与 3 天 |
| weather | `qw-indices` | `days`、`range`、`showRange`、`loading`、`error` | 生活指数 |
| weather | `qw-astronomy` | `sun`、`moon`、`solar`、`dates`、`activeDate`、`time`、`altitude`、`utcOffset`、`loading`、`error` | 日出日落 / 月相 / 太阳高度 |
| weather | `qw-history` | `history`、`date`、`minDate`、`maxDate`、`quick`、`today`、`loading`、`error` | 时光机历史天气 |
| weather | `qw-city-sheet` | `show`、`cities`、`current`、`locating` | 城市抽屉：定位、搜索、热门、附近景点与删除 |
| weather | `qw-api-sheet` | `show`、`endpoints`、`running`、`progress`、`host`、`auth` | API 覆盖自检抽屉，逐个真实请求 27 个端点 |
| weather | `qw-icon` | `code`、`size`、`fill`、`night`、`warning`、`moon`、`alt` | 和风官方图标映射，`-fill` / `9999` 多级回退 |

---

## 10. 页面与路由

### 10.1 主包页面

| 路由 | 文件 | 职责 |
|---|---|---|
| `/pages/index/index` | `pages/index/` | 工具箱首页：Hero 数据、搜索、最近使用、收藏、魔法棒指令面板、深链、分享 |
| `/pages/favorites/index` | `pages/favorites/` | 工具收藏列表、三排序、多选管理、批量移除、清空确认、空态 CTA、TabBar 选中 |
| `/pages/mine/index` | `pages/mine/` | 外观切换、关于作者、隐私说明、设置中心、数据驾驶舱、邮箱复制、清空工具数据、版本号；隐私中心与重置全部已迁入设置页 |

### 10.2 `subpackages/tools-core`（31 页）

单位换算、个税计算、房贷试算、存款复利、进制转换、日期格式、日期加减、颜色转换、JSON ↔ CSV、时区换算、工期排期、文本转换、模板填充、正则测试、日期间隔、年龄周岁、倒数日、时间戳、金额大写、字数统计、文本对比、Hash 加密、去重排序、JSON 格式化、URL 编解码、Base64、随机密码、BMI 指数、全息气象、元宝搜索；另有组件样板间 `lab`。

所有页面：

- 所有工具页（除 `weather`、`watermark` 外）全部使用 `glass-tool-shell`（全项目 62/65 工具套壳）。
- 所有工具页均已实现 `onShareAppMessage` / `onShareTimeline`，分享路径统一由 `core/toolbox/share.ts` 反查当前工具。
- 状态机 `idle / running / done / invalid / error`。
- 输出 `posterData` 供海报与埋点。
- 需要接收流转的工具实现 `onReceiveWorkflow(data)` 或暴露 `recalculate()` / `compute()` / `generate()`。

### 10.3 `subpackages/tools-daily`（17 页）、`subpackages/tools-media`（14 页）与 `subpackages/tools-dict`（3 页）

`tools-daily` 承载高频生活工具（算账 / 工时 / 健康 / 随机决定 / 油耗 / 水电燃气 / 分辨率 / 车贷 / 报价 / 倒计时 / 体脂 / 汇率换算 / 薪资反算 / 百分比计算 / 尺码换算 / 离职补偿 / 证件号校验），单独分包是为了让生活工具与 tools-core 的计算类工具解耦，并复用 `core/toolbox/engines/money.ts` 等共享引擎。

| 路由 | 职责 |
|---|---|
| `/subpackages/tools-daily/pages/ledger/index` | 算账助手：折扣 / 满减 / AA 分摊，三种模式独立缓存结果 |
| `/subpackages/tools-daily/pages/worktime/index` | 工时与请假：跨天工时 / 加班费 / 周末排除 / 半天 |
| `/subpackages/tools-daily/pages/wellness/index` | 每日健康：饮水 / 千卡千焦 / 保质期 |
| `/subpackages/tools-daily/pages/random-pick/index` | 随机决定：抽签 / 随机数 / 骰子 / 硬币 / 多分隔符 / 去重 |
| `/subpackages/tools-daily/pages/fuel/index` | 油耗计算：百公里油耗 / 每公里油费 / 本次油费 |
| `/subpackages/tools-daily/pages/power/index` | 水电燃气费：电费 / 水费 / 燃气 / 平价或阶梯费率 / 基础费 / 分段明细 |
| `/subpackages/tools-daily/pages/resolution/index` | 分辨率与比例：GCD 化简 / 目标宽等比 / 目标比例 / 高清判定 / A4 等纸张与 DPI 打印像素 |
| `/subpackages/tools-daily/pages/carloan/index` | 车贷计算：首付比例 / 金额 / 等额本息 / 等额本金 / 双方案对比 / 提前还款 / 前 12 期 |
| `/subpackages/tools-daily/pages/quote/index` | 报价单：动态明细 / 优惠 / 税额 / 大写 / CSV 导出 |
| `/subpackages/tools-daily/pages/meeting-timer/index` | 会议倒计时：时长 / 结束时间点 / 暂停继续 / 全局 HUD / Canvas 进度环 |
| `/subpackages/tools-daily/pages/bodyfat/index` | 体脂率：海军围度公式 / 男女围度 / 区间标签 / 极端值复核 |
| `/subpackages/tools-media/pages/photo-edit/index` | 图片编辑：裁剪 / 旋转 / 翻转 / 格式转换 |
| `/subpackages/tools-media/pages/avatar/index` | 圆角头像：中心裁切 / 圆形与圆角 / 256–1024 PNG |
| `/subpackages/tools-media/pages/collage/index` | 拼图与长图：2×2 / 3×3 / 竖排 / 间距 / 背景 / 点击生成 |
| `/subpackages/tools-media/pages/id-photo/index` | 证件照换底：智能背景识别 / 白蓝红 / 容差 / 边缘保护 / 羽化 / 保存相册 |
| `/subpackages/tools-media/pages/image-pdf/index` | 图片转 PDF：1–9 图 / A4 / Letter / 原图 / 手写 PDF / 系统预览 / 点击生成 |
| `/subpackages/tools-media/pages/barcode/index` | 条形码生成：CODE128B / 校验位 / 静区 / 条宽 / 保存相册 |
| `/subpackages/tools-media/pages/exif/index` | 图片信息：尺寸 / 体积 / 格式 / 方向 / 本机读取 |
| `/subpackages/tools-media/pages/qr-decode/index` | 二维码识别：相册单图 / 本机解码 / 复制全文 / 长文截断 |
| `/subpackages/tools-dict/pages/lunar/index` | 农历与节气：公历转农历 / 闰月 / 生肖 / 节气 / 传统节日 / 农历生日倒计时 |
| `/subpackages/tools-dict/pages/zh-convert/index` | 简繁转换：方向 / 词组优先 / 字符级 / 20k 截断 |
| `/subpackages/tools-dict/pages/pinyin/index` | 拼音标注：声调 / 多音词消歧 / 逐字对照 / 2k 截断 |
| `/subpackages/tools-daily/pages/fx-manual/index` | 汇率换算：官方 CFETS 中间价 + 手动回退 / 8 币种 / 双向换算 / 仅供参考 |
| `/subpackages/tools-daily/pages/salary-inverse/index` | 薪资反算：目标到手 / 五险一金 / 专项附加 / 二分反推税前 |
| `/subpackages/tools-daily/pages/percent/index` | 百分比计算：占比 / 增减幅 / 配比 / 最简比 |
| `/subpackages/tools-daily/pages/size-convert/index` | 尺码换算：鞋码 / 服装 / 戒指 / 各区对照 |
| `/subpackages/tools-daily/pages/severance/index` | 离职补偿：N / N+1 / 封顶 / 年假折算 / 双免责 |
| `/subpackages/tools-daily/pages/id-validate/index` | 证件号校验：身份证 / 银行卡 / 自动识别 / 脱敏 |
| `/subpackages/tools-media/pages/compress/index` | 图片压缩、体积对比、保存 |
| `/subpackages/tools-media/pages/palette/index` | 图片取色、色板复制 |
| `/subpackages/tools-media/pages/nine-grid/index` | 九宫格切图、批量保存 |
| `/subpackages/tools-media/pages/qr/index` | 二维码生成、保存 |
| `/subpackages/tools-media/pages/vcard/index` | 二维码名片：vCard / 图片名片 / 二维码 |
| `/subpackages/tools-media/pages/watermark/index` | 水印 / 打码 / Logo / 手势工作台 |

### 10.4 `subpackages/grow`（9 页）

| 路由 | 职责 |
|---|---|
| `/subpackages/grow/pages/home/index` | 简历首页 / 展馆前厅，入口星表 + 数字速览 + share-element 飞跃 |
| `/subpackages/grow/pages/greeting/index` | 问候序厅，承接 `fly-entry-greeting` |
| `/subpackages/grow/pages/profile/index` | 个人简介、社交坐标、Canvas 名片生成器 |
| `/subpackages/grow/pages/about/index` | 关于我、成长时间线 |
| `/subpackages/grow/pages/skills/index` | 技能矩阵、分段控件、量表重播 |
| `/subpackages/grow/pages/settings/index` | 全局设置 + 隐私中心（权限 / 版本 / 重置）+ Cyber Space OS 极客实验室 + 专注引擎入口 / 清空 |
| `/subpackages/grow/pages/cockpit/index` | 数据驾驶舱：轨迹 / 周报 / 环形图 / 折线图 / 隐私盾 |
| `/subpackages/grow/pages/help/index` | 使用指南：覆盖 65 个工具的步骤 / 提示 / FAQ，搜索复用 `searchTools`；底部「问题未解决？」可复制反馈邮箱、预览并导出脱敏诊断包 |
| `/subpackages/grow/pages/legal/index` | 隐私说明 / 本机数据 / 免责声明 / 开源许可；隐私授权弹窗 |

#### 10.4.1 设置页功能分区

| 分区 | 内容 |
|---|---|
| 控制中枢 `CTRL / 01` | 当前运行模式、最近使用数量、本机缓存、`preferenceStore.statusText` |
| 极客实验室 `EXPERIMENTAL` | 快速上手、数据星系、Auto-Pilot、Time Travel、Sliced Transport、AES Vault、Event Stream |
| 感官体验 `SENSORY / 01` | 系统音效、物理震动（关闭 / 轻震 / 重震） |
| 视觉与性能 `VISION / 02` | 动态光效、动画强度（自动 / 全效 / 精简 / 省电） |
| 存储与数据 `STORAGE / 03` | 数据驾驶舱入口、全息专注入口 / 清空专注数据、本机缓存、备份与恢复（导出 / 导入 / 删除 JSON 备份）、自动清理最近使用（7 / 30 / 永不）、仅清空最近使用 |
| 隐私中心 `PRIVACY / 04` | 定位 / 相册 / 隐私指引状态、跳转系统设置与微信指引、版本变更提示、导出本机数据、清除工具数据、重置全部 |
| 实验室 `LAB / 05` | 保留分区 |
| 创新实验席位 `MYSTERY / 06` | `enable_ai_assist` Feature Flag，仅登记意向 |
| 版本与说明 `CHANGELOG` | 版本号、更新日志、更新就绪提示 |

设置页原则：

- 所有开关只写 `preferenceStore`，页面不持有业务真相。
- 高频滑块只在 `touchend` 落盘，`onInput` 只做文案预览。
- 清理 / 阈值 / Feature Flag 全部有边界兜底与玻璃 Toast 反馈。
- 极客实验室默认收起；展开后才挂载 Canvas 与对应模块。
- 高危操作（AES、Time Travel、分片传输、Auto-Pilot、抽屉、重置全部）会阻塞全局更新弹窗。
- 隐私中心只读取权限状态，不主动申请权限；拒绝后由各工具自行降级。

#### 10.4.2 数据驾驶舱能力

| 能力 | 说明 |
|---|---|
| 效率洞察 | 总数 / 近 7 日 / 连续天数 / 最常用工具 / 分类 / 昼夜占比 / 人格标签 |
| 分类占比 | Canvas 环形图，按分类统计本机轨迹 |
| 近 7 日活动 | Canvas 折线图，每天完成的计算次数；省电 / 关闭动画直接画终态，rAF 不回帧由 watchdog（时长 + 220ms）兜底 |
| 计算轨迹 | 分页展示本机轨迹，展开后按 24 条一批追加，可单条删除 |
| 隐私盾 | 默认脱敏；只隐藏金额 / 密码 / 健康等敏感值 |
| 记录开关 | `isHistoryTrackingEnabled`，关闭后不再写入新轨迹 |
| 数据清除 | 清空当前轨迹 / 清除快照轨迹 |
| 专注小卡 | 只读 `focus:stats:v1` / `focus:ledger:v1`：今日分钟、累计完成、连续天数、最近标签、等级；不 import life 分包 |
| 图表容错 | 原生 Canvas 失败时切离屏 Canvas 导出静态图；提供「重新绘制图表」 |
| 主题适配 | 白昼 / 夜航调色板，主题切换立即重绘 |
| 生命周期 | `onHide` 取消动画与定时器；`onUnload` 销毁 Canvas / 绑定 / 临时图 |

### 10.5 `subpackages/works` / `campus`

| 路由 | 职责 |
|---|---|
| `/subpackages/works/pages/hub/index` | 作品宇宙，分类入口 |
| `/subpackages/works/pages/list/index` | 作品列表，搜索 / 收藏 / 封面飞跃 |
| `/subpackages/works/pages/detail/index` | 作品详情，英雄封面 / 指标 / 技术栈 / 图集 |
| `/subpackages/campus/pages/detail/index` | 园枢校园应用详情，独立分包承载 22 张真机界面 |

### 10.6 `subpackages/life`（1 页）

| 路由 | 职责 |
|---|---|
| `/subpackages/life/pages/focus/index` | 全息专注引擎：25 分钟心流、翻转黑屏、BGM、星云战报、等级 / 连续天数、海报 |

`life` 是独立分包：主包只新增 `ROUTES.focus`、`requiredBackgroundModes: ["audio"]` 与设置页入口，不增加主包组件 / 算法体积。设置页通过只读 Storage 契约读取 `focus:session/v1` 与 `focus:stats/v1`，不 import life 分包。

### 10.7 `subpackages/weather`（1 页）

和风天气独立页 `pages/home`：自定义导航 + 胶囊安全区实测、7 个 Tab、下拉刷新、城市抽屉、API 自检抽屉；页面壳只保留分享与 Workflow，主屏与数据编排在 `qw-screen`，共 13 个 `qw-*` 组件同分包，官方 507 个 SVG 图标位于 `assets/icons`，不进入主包。

### 10.8 页面通用约定

1. **分享**：全部页面实现 `onShareAppMessage` / `onShareTimeline`，工具页自动反查当前工具；分享路径与标题统一由 `core/toolbox/share.ts` 生成。
2. **主题**：页面根节点绑定 `uiStore.themeClass`；需要原生状态栏同步的页面在 `onShow` 调用 `uiStore.syncNativeChrome()`，工具页由 `glass-tool-shell` 的 `pageLifetimes.show` 统一调用。
3. **TabBar**：`pages/index` / `favorites` / `mine` 在 `onShow` 调用 `selectTabBar`。
4. **更新守卫**：非工具页在 WXML 末尾挂 `<update-guard />`；工具页由 `glass-tool-shell` 挂载。
5. **隐私**：需要相册 / 选图的页面挂 `<privacy-guard />`。
6. **导航锁**：列表 / 入口页使用 `navigating` 标志防连点。
7. **异步销毁**：页面使用 `destroyed` 标志 / 序列号，防止卸载后 `setData`。

---

## 11. 设计系统与主题引擎

### 11.1 令牌分层

| 命名空间 | 来源 | 用途 |
|---|---|---|
| `--g-*` | `app.wxss` | 语义色 / 表面 / 描边 / 墨色 / 阴影，双主题 |
| `--glass-*` | `app.wxss` | 液态玻璃材质、模糊、边框、高光、投影、动效曲线 |
| `--sg-*` | `app.wxss` | Spatial Glass 极光、环境光、玻璃、光追、对比度 |
| `--v3-*` | `styles/v3.wxss` | V3 纸面优先 / 光谱索引页面 |
| `--tbx-*` | `styles/toolbox.wxss` | 旧工具箱页面（当前未被 `app.wxss` 引入） |

### 11.2 主题模式

```ts
type ThemeMode = 'auto' | 'light' | 'dark'
type ResolvedTheme = 'light' | 'dark'
```

- 白昼：`theme-light`，画布 `#eef1f7`。
- 夜航：`theme-dark`，画布 `#070a12`。
- 自动：跟随 `wx.getAppBaseInfo().theme`，实时订阅 `wx.onThemeChange`。
- 手动切换后写入 `gallery.theme.mode`。
- `themeSwitching` 仅在昼↔夜翻转时开启 420ms 呼吸窗口，页面根节点播放 `.theme-breathing`。

### 11.3 动效等级

`useMotion()` 返回：

| 等级 | `hologramEnabled` | `lightEnabled` | `blurScale` | `durationScale` |
|---|---|---|---|---|
| `full` | true | true | 1 | 1 |
| `lite` | true | true | 0.78 | 0.72 |
| `saver` | false | false | 0.42 | 0.001 |

- 省电模式强制关闭极光与陀螺仪。
- `preferenceStore.lightEffects = false` 时任何档位都不跑动态光效。
- `themeClass` 同时输出 `motion-*` 与 `light-off`。

### 11.4 环境光引擎（`core/theme/ambient-theme.ts`）

场景：

| 分类 | 场景 |
|---|---|
| `home` | `iris` |
| `calc` | `cold` |
| `date` | `iris` |
| `text` | `mint` |
| `media` | `warm` |
| `life` | `warm` |
| `work` | `cold` |

时间段：

| 时间 | 相位 | 亮度 / 朦胧度 |
|---|---|---|
| 05:00–11:00 | `morning` | 1 / 0.14 |
| 11:00–18:00 | `day` | 1 / 0.12 |
| 18:00–22:00 | `evening` | 0.86 / 0.26 |
| 22:00–05:00 | `night` | 0.64 / 0.46 |

输出：

```ts
interface AmbientThemeState {
  preset: AmbientPreset
  category: AmbientCategory
  scene: AmbientScene
  phase: AmbientPhase
  palette: AmbientPalette
  intensity: number
  haze: number
  className: string // sg-ambient-{scene}
  style: string     // --sg-ambient-a/b/c/... 内联变量
  updatedAt: number
}
```

使用：

```ts
ambientTheme.setCategory('home')
const unsubscribe = ambientTheme.subscribe((state) => {
  this.setData({ ambientClass: state.className, ambientStyle: state.style })
})
// 页面卸载时 unsubscribe()
```

### 11.5 对比度守护（`core/theme/contrast-guardian.ts`）

```ts
parseColor(input): RgbaColor | null
flattenColor(color, base): RgbaColor
relativeLuminance(color): number
contrastRatio(fg, bg): number
isLargeText(fontSizePx, bold): boolean
requiredRatio(fontSizePx, bold): number
ensureContrast(options): ContrastGuardResult
auditContrast(pairs): ContrastAuditEntry[]
buildContrastVars(result): string
```

策略：

1. 优先保留原文字色。
2. 不达标时自动反色。
3. 仍不达标时启用高不透明度背板。
4. 可选 `mix-blend-mode: difference`。
5. 普通文本要求 4.5:1，大字号 3:1（WCAG 2.1 AA）。

### 11.6 玻璃材质

核心令牌：

| 令牌 | 夜航 | 白昼 |
|---|---|---|
| `--glass-bg` | `rgba(13, 17, 26, 0.52)` | `rgba(255, 255, 255, 0.54)` |
| `--glass-bg-soft` | `0.34` | `0.34` |
| `--glass-bg-strong` | `rgba(20, 25, 38, 0.76)` | `rgba(255, 255, 255, 0.78)` |
| `--glass-blur` | `32px` | `26px` |
| `--glass-border` | `rgba(255,255,255,0.14)` | `rgba(255,255,255,0.72)` |
| `--glass-text` | `#f5f7fc` | `#151a24` |
| `--glass-accent` | `#8f9bff` | `#5367ff` |
| `--glass-accent-glow` | `rgba(143,155,255,0.3)` | `rgba(83,103,255,0.26)` |
| `--glass-accent-text` | `#8f9bff` | `#4453e0` |
| `--glass-danger-text` | `#ff7a63` | `#b83a26` |
| `--glass-accent-2-text` | `#6ee7c8` | `#067a68` |
| `--glass-accent-warm-text` | `#ffcf8a` | `#8a5a0a` |

按压态：

- 保持 `backdrop-filter` 不变。
- 叠加 135° 镜面渐变、背景提亮、内高光 / 内描边、微缩放。
- 过渡 180ms，避免触摸时重算模糊导致卡顿。

### 11.7 字体与布局

- 字体栈：`-apple-system, "SF Pro Display", "PingFang SC", "Source Han Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif`。
- 等宽：`"SF Mono", "Menlo", "Roboto Mono", monospace`。
- 页面宽度 750rpx 基准；圆角 `12 / 20 / 28 / 40 / 56 / 64rpx`。
- 安全区统一 `env(safe-area-inset-*)`。
- 首页底部容器预留 `padding-bottom: calc(120px + env(safe-area-inset-bottom))`，避免被 Dock 遮挡。

---

## 12. 存储、迁移、隐私与更新

### 12.1 存储键总表

| 键 | 命名空间 | 内容 | 写入方 |
|---|---|---|---|
| `app:storage.version` | app | 存储结构版本 | `core/utils/storage-migration.ts` |
| `gallery.theme.mode` | gallery | 外观模式 | `uiStore` |
| `gallery.works.favorites` | gallery | 作品收藏 id | `resumeStore` |
| `gallery.glass.meta` | gallery | Spatial Glass 元数据 | `store/index.ts` |
| `app:prefs.v1` | app | 全局偏好 v1 | `preferenceStore` |
| `app:prefs.v0` | app | 旧偏好（只读） | 迁移 |
| `app:backup.at` | app | 最近一次备份导出时间 | `subpackages/grow/lib/backup.ts` |
| `app:privacy.version` | app | 已确认的隐私保护指引版本 | `subpackages/grow/lib/privacy-center.ts` |
| `tbx:draft.<id>` | tbx | 单工具草稿（输入 + 模式，≤4KB） | `core/toolbox/draft.ts` |
| `tbx:recent` | tbx | 最近使用 | `toolboxStore` |
| `tbx:recent.at` | tbx | 最近使用时间戳 | `toolboxStore` |
| `tbx:favorites` | tbx | 工具收藏 | `toolboxStore` |
| `tbx:usage` | tbx | 累计打开 | `toolboxStore` |
| `tbx:history` | tbx | 计算轨迹 | `historyStore` |
| `tbx:workflow.pipes` | tbx | 快捷管道 | `workflowStore` |
| `tbx:workflow.garbage` | tbx | 孤儿图片队列 | `workflowStore` |
| `tbx:searchHistory` | tbx | 搜索历史（最多 8 条） | 首页 |
| `tbx:helpBannerDismissed` | tbx | 使用指南横幅关闭 | 首页 |
| `tbx:fx.official.v1` | tbx | 官方汇率中间价缓存（6 小时 TTL，失败时作 stale 回退） | `fx-official.ts` |
| `toolbox:meeting-timer.hud.v1` | toolbox | 会议倒计时悬浮胶囊位置 left / top | `meeting-timer-hud` |
| `tbx:prefs` | tbx | 旧工具偏好（只读迁移） | 迁移 |
| `tbx:ack.finance.v1` | tbx | 旧财务提示 | 迁移 |
| `tbx:ack.health.v1` | tbx | 旧健康提示 | 迁移 |
| `tbx:legacy-tip` | tbx | 旧收藏提示 | 迁移 |
| `tbx:legacy-tip-home` | tbx | 首页旧收藏提示 | `storage.ts` |
| `cyber:hot:v1` | cyber | 热备 3 槽 | `timeTravelEngine` |
| `cyber:auto:v1` | cyber | 自动快照 5 槽 | `timeTravelEngine` |
| `cyber:frames:v1` | cyber | 时间轴帧（持久化最近 8 帧） | `timeTravelEngine` |
| `cyber:pilot:v1` | cyber | Auto-Pilot 配置 | 设置页 |
| `weather:cities:v1` | weather | 城市表（≤5） | `weatherCache.ts` |
| `weather:current:v1` | weather | 当前城市 adcode | `weatherCache.ts` |
| `weather:live:v1:{adcode}` | weather | 实况缓存（15min） | `weatherCache.ts` |
| `weather:forecast:v1:{adcode}` | weather | 预报缓存（30min） | `weatherCache.ts` |
| `weather:fail:v1:{adcode}:{kind}` | weather | 失败负缓存（60s） | `weatherCache.ts` |
| `weather:ambient:v1` / `weather:lab:v1` / `weather:manual-refresh:v1` | weather | 环境音 / 实验开关 / 手动刷新时间 | 天气页 |
| `qweather:cities:v1` | qweather | 和风城市表（≤5） | `qweather/city.ts` |
| `qweather:current:v1` | qweather | 当前和风城市 token | `qweather/city.ts` |
| `qweather:cache:v2` | qweather | 单键缓存仓：最多 40 条 / 650KB，跨本地自然日失效 | `qweather/cache.ts` |
| `focus:session:v1` | focus | 当前专注会话（带签名） | `focus-storage.ts` |
| `focus:prefs:v1` | focus | 专注音频 / 翻转偏好 | `focus-storage.ts` |
| `focus:key:v1` | focus | 32 字节 HMAC key（64 hex） | `focus-storage.ts` |
| `focus:ledger:v1` | focus | 最近 50 条签名战报 | `focus-storage.ts` |
| `focus:stats:v1` | focus | 累计 / 等级 / 连续天数 / 今日 | `focus-storage.ts` |
| `focus:brightness:v1` | focus | 原始亮度 + owned 标记 | `focus-storage.ts` |
| `diag:errors.v1` | diag | 黑匣子环形 20 条 | `blackbox.ts` |
| `hasPendingUpdate` | 无命名空间 | 更新红点标记 | `core/services/update.ts` |

### 12.2 迁移顺序

`runStorageMigrations()`：

1. 读取 `app:storage.version`；`>= 1` 直接返回。
2. v0 → v1：
   - 清洗 `gallery.works.favorites`（200）、`tbx:favorites`（100）、`tbx:recent`（12）。
   - 兼容旧 JSON 字符串；超长脏串直接清空。
   - 删除 `tbx:prefs`、`tbx:ack.finance.v1`、`tbx:ack.health.v1`、`tbx:legacy-tip`。
   - `diag:errors.v1` 裁剪到 20 条。
3. 写入 `app:storage.version = 1`。

`glassStore.init()` 还会：

- 二次清洗三份旧 id 列表。
- 非法 `gallery.theme.mode` 移除并回退 `auto`。
- 幂等删除废弃键。
- 写入 `gallery.glass.meta`（`version: 2`、`schema: 'spatial-glass-26'`）。

### 12.3 隐私链路

隐私授权时序如下：

```mermaid
sequenceDiagram
  autonumber
  participant Biz as 业务页面 / 工具
  participant Guard as ensurePrivacyAuthorized
  participant Store as privacyStore
  participant Modal as privacy-guard
  participant WX as 微信基础库

  Biz->>Guard: 调用敏感 API 前
  Guard->>WX: wx.requirePrivacyAuthorize()
  alt 已同意
    WX-->>Guard: success
    Guard-->>Biz: 放行
  else 未同意 / 首次调用
    WX->>Store: onNeedPrivacyAuthorization
    Store->>Modal: enqueue(resolve, referrer)
    Modal->>Modal: 展示隐私授权弹窗
    alt 用户同意
      Modal->>Store: resolveAgree(buttonId)
      Note over Modal,WX: button open-type=agreePrivacyAuthorization
      Store-->>WX: 所有 pending resolve
      Guard-->>Biz: 放行
    else 用户拒绝
      Modal->>Store: resolveDisagree()
      Store-->>WX: reject
      Guard-->>Biz: 中断，不读不写
    end
  end
```

需要隐私前置的业务：

- 选图：`chooseSingleImage()`。
- 保存相册：`saveImageToAlbum()` / `core/utils/album.ts`。
- 水印选图 / 保存。
- 海报保存。
- 九宫格 / 二维码 / 压缩图保存。
- 剪贴板：用户结果写入统一走 `copyText()`（内部前置 `ensurePrivacyAuthorized()`），拒绝授权时不写；系统诊断 / 反馈邮箱 / 关于 / 法律说明可直接写剪贴板；读取按需在设置页内联授权。
- 定位：天气 `getFuzzyLocation()` 前必须授权；只申请城市级模糊定位。

相册授权失败标准流程：

```text
保存失败 → 提示弹窗 → 打开系统设置 → 自动重试
```

`core/utils/album.ts` 的 `saveImageToAlbum(src)` 返回：

```ts
{ ok: true }
| { ok: false, failure: 'denied' | 'failed' | 'privacy' | 'unavailable' }
```

### 12.4 更新机制

两阶段架构，更新弹窗时序如下：

```mermaid
sequenceDiagram
  autonumber
  participant App as App.onLaunch
  participant UIM as wx.updateManager
  participant Hub as globalData
  participant Guard as update-guard
  participant Modal as glass-modal
  participant Native as wx.showModal

  App->>UIM: getUpdateManager()
  UIM->>UIM: onCheckForUpdate()
  alt 无新版本
    UIM->>Hub: clearUpdatePending()
  else 有新版本
    UIM->>Hub: onUpdateReady → hasUpdate = true
    Hub->>Guard: notifyUpdateGuards()
    Guard->>Hub: 抢锁 promptState = custom / promptOwner = token
    Guard->>Modal: 展示极光更新弹窗
    alt 1.5s 内未确认渲染
      Guard->>Modal: 关闭自定义弹窗
      Guard->>Native: fallbackToNative()
    else 用户已确认
      alt 立即重启
        Guard->>UIM: applyUpdate()
      else 稍后
        Guard->>Hub: markUpdatePending() → hasPendingUpdate
      end
      opt 查看更新日志
        Guard->>Guard: 跳设置页并展开更新日志
      end
    end
  end
  opt 下载失败
    UIM->>Hub: onUpdateFailed → hasUpdate = false
    Hub-->>App: Toast「网络波动，极光新版本下载失败」
  end
```

互斥状态：

| 状态 | 含义 |
|---|---|
| `idle` | 可展示 |
| `custom` | 某个 guard 正在展示极光弹窗 |
| `native` | 自定义层退场 / 原生弹窗展示中 |
| `dismissed` | 本次会话已处理 |

高危阻塞：

- 设置页 AES 加密、时间旅行、分片传输、Auto-Pilot、页面抽屉。
- 工具页运行状态、海报生成 / 预览、流转面板、超长确认。
- 驾驶舱清空 / 删除确认。
- 个人简介名片 / 二维码弹窗。
- 实验室底部抽屉。
- 首页深链跳转、指令面板。
- 隐私授权弹窗。

阻塞解除后延迟 420ms 再尝试弹窗。

### 12.5 黑匣子

`recordDiagnostic(kind, error, level)`：

| 字段 | 说明 |
|---|---|
| `at` | 时间戳 |
| `kind` | `app-error` / `unhandled-rejection` / `page-not-found` / `memory-warning` |
| `message` | 最长 500 字 |
| `stack` | 最长 1000 字 |
| `route` | 当前页面路由 |

只写 `diag:errors.v1`，环形保留 20 条，不联网、不上传。

---

## 13. 依赖关系

### 13.1 模块依赖图

```mermaid
graph LR
  APP[app.ts] --> PREF[preferenceStore]
  APP --> UI[uiStore]
  APP --> TB[toolboxStore]
  APP --> HIS[historyStore]
  APP --> RES[resumeStore]
  APP --> DEEP[deepLinkStore]
  APP --> PRIV[privacyStore]
  APP --> UPD[services/update]
  APP --> AMB[ambient-theme]
  APP --> MIG[storage-migration]

  UI --> PREF
  GLASS[glassStore] --> UI
  GLASS --> TB
  GLASS --> HIS
  GLASS --> RES

  TB --> STORAGE[toolbox/storage]
  TB --> RET[retention]
  TB --> HISTSNAP[history-snapshots]
  HIS --> STORAGE
  HIS --> HISTSNAP

  TRACK[tracker] --> HIS
  TRACK --> POSTER[poster]
  TRACK --> MASK[privacy mask]
  TRACK --> UI

  WF[workflowStore] --> WFCFG[workflowConfig]
  WF --> WFSILENT[workflowSilent]
  WF --> STORAGE
  WF --> LOG[logger]
  WFADAPTER[workflowAdapters] --> WFCFG
  WFSRC[workflowSource] --> WFCFG

  PAGES[pages/*] --> GLASS
  PAGES --> COMP[components/*]
  PAGES --> CORE[core/*]
  SUB[subpackages/*] --> CORE
  SUB --> LOCAL[分包 lib/utils]
  COMP --> CORE
  COMP --> COMP

  WEATHER[tools-core/weather] --> CORE
  WEATHER --> AMAP[高德 Web 服务 REST]
  QWX[weather/lib/qweather] --> CORE
  QWX --> QWAPI[和风天气 API]
  YB[core/services/yuanbao] --> WSA[腾讯云 WSA]
  FX[fx-official] --> CFETS[CFETS 中间价]
  FOCUS[life/lib/focus-*] --> STORAGE
  FOCUS --> UI
  SETTINGS[grow/settings] -.只读 Storage 契约.-> FOCUS
```

### 13.2 外部依赖使用矩阵

| 依赖 | 使用位置 | 说明 |
|---|---|---|
| `mobx-miniprogram` | `core/stores/*`、`core/toolbox/store.ts`、`core/workflow/workflowStore.ts`、`store/index.ts` | 全局状态 |
| `mobx-miniprogram-bindings` | 页面 / 组件 | `createStoreBindings`、`storeBindingsBehavior` |
| `crypto-js` | `subpackages/tools-core/pages/hash` / `utils/hashEngine` | Hash / HMAC |
| `diff-match-patch` | `subpackages/tools-core/utils/diffEngine` | 文本 Diff |
| `typescript` | 构建 / 类型检查 | 无运行时 |
| `tailwindcss` / `weapp-tailwindcss` | `styles/tokens.css` → `styles/generated/tailwind.wxss` | 原子类 |
| `lightningcss` | `@tailwindcss/node` / `@weapp-tailwindcss/postcss` | CSS 引擎；显式 1.33.0 解决 peer 冲突 |
| `fantasticon` | `.icon-src` → `.icon-dist` | 图标字体 |
| `miniprogram-automator` | `tests/visual`、`tests/e2e` | 开发者工具自动化 |
| `miniprogram-ci` | `scripts/ci-upload.js` | 自动构建 npm 并上传开发版本 |
| 高德 Web 服务 API | `subpackages/tools-core/weather/weatherService.ts` | 全息气象实况 / 预报 / 逆地理 / IP / 行政区；Key 存 `weather/config.local.ts`（gitignored） |
| 和风天气 API | `subpackages/weather/lib/qweather/client.ts` | 8 组 API / 27 个端点；JWT（EdDSA）或 API KEY 双认证；Host 存 `subpackages/weather/config-local.ts`（gitignored） |
| 腾讯云 WSA SearchPro | `core/services/yuanbao/index.ts` + `sign.ts` | 元宝搜索；服务 API KEY（Bearer）或 TC3 SecretId / SecretKey |
| CFETS 中国外汇交易中心 | `subpackages/tools-daily/pages/fx-manual/index.ts` | 官方人民币汇率中间价公开 JSON，失败回退手动牌价 |

### 13.3 组件使用矩阵（高层）

| 使用方 | 主要组件 |
|---|---|
| 主包页面 | `glass-card`、`glass-button`、`glass-toast`、`g-icon`、`g-navbar`、`privacy-guard`、`update-guard` |
| 工具页（62 个，watermark / weather / qweather 除外） | `glass-tool-shell` + `glass-card` / `glass-input` / `glass-button` / `g-icon` |
| 水印页 | 自定义工作台 + `privacy-guard` + `update-guard` + `glass-toast` |
| 气象页 | 自定义全屏舞台 + `weather-glyph` + `privacy-guard` + `update-guard` + `glass-toast` |
| 和风天气页 | `qw-screen`（内含 12 个 `qw-*` 子组件）+ `privacy-guard` + `update-guard` + `glass-toast` + `workflow-panel` |
| 专注页 | `glass-modal` / `glass-bottom-sheet` / `glass-slider` / `glass-switch` / `poster-preview` / `update-guard` |
| 设置页 | `glass-card`、`glass-bottom-sheet`、`glass-switch`、`glass-slider`、`glass-picker` |
| 驾驶舱 | `glass-card`、`glass-switch`、`glass-modal`、`glass-bottom-sheet` |
| 作品详情 | `g-gallery`、`g-toast`、`privacy-guard`、`update-guard` |
| 简历首页 | `g-aurora`、`g-meter`、`g-orbit`、`g-stat`、`g-timeline`、`g-toast` |

### 13.4 分包规则

- 主包只保留 TabBar 页面、全局公共组件、全局 Store、`core/*`（含 `core/utils/*`）。
- `tools-core` 承载 31 个计算 / 文本 / 日期 / 颜色 / 数据 / 气象工具与组件样板间 + `crypto-js` / `diff-match-patch` + `weather/*`。
- `tools-daily` 承载算账 / 工时 / 健康 / 随机决定 / 尺码换算 / 离职补偿 / 证件号校验，避免生活高频工具挤占 tools-core。
- `tools-media` 承载图片 / 名片 / PDF 工具 + QR / PNG / Worker 沙箱。
- `weather` 独立承载和风天气页面、数据层、13 个 `qw-*` 组件与 507 个官方图标，不进入主包。
- `grow` 承载简历域、设置、驾驶舱、使用指南、Cyber Space OS。
- `life` 承载全息专注引擎；主包不 import life，设置页只读 `focus:*` Storage 契约。
- `works` 承载作品集；`campus` 独立承载园枢 22 张真机图。
- 分包路由保持原文件系统路径，禁止修改业务跳转 URL；禁止跨分包 import。

---

## 14. 运行方式

> 目标：用最短路径把项目跑起来。首次启动按 §14.2 的完整步骤执行；只想做静态校验看 §14.1.1 的路线 A；需要逐项解释时再看 §14.3–§14.10。

本章导航：

| 小节 | 内容 |
|---|---|
| §14.0 | 最短路径与一键命令 |
| §14.1 / §14.1.1 | 环境清单、四条启动路线 |
| §14.2 | 从零启动 8 步（含分包依赖） |
| §14.3 | 构建体系：产物总览、Tailwind、npm、TS、Worker、发布 |
| §14.3.8 / §14.3.9 | 构建后自检、构建脚本索引 |
| §14.4 | 导入开发者工具与首次编译 |
| §14.5 | 首次启动运行序列 |
| §14.6 / §14.7 | 自动化、真机预览 |
| §14.8 | 调试与诊断 |
| §14.9 | 部署与发布 |
| §14.10 | 常见启动问题 |

### 14.0 快速开始（最短路径）

```mermaid
flowchart LR
  A["克隆 / 打开仓库"] --> B["npm ci"]
  B --> C["npm run build:style"]
  C --> D["npm run typecheck + npm test"]
  D --> E["微信开发者工具导入仓库根目录"]
  E --> F["构建 npm：根包 + tools-core"]
  F --> G["编译 pages/index/index"]
  G --> H{"首屏验收"}
  H -->|通过| I["真机预览 / 上传"]
  H -->|失败| J["§14.10 常见启动问题"]
  J --> K["修复后重新编译"]
  K --> H
```

| 步骤 | 命令 / 操作 | 验收标准 |
|---|---|---|
| 1 | 安装 Node.js `>= 22.6`，在仓库根目录执行 `npm ci` 与 `npm ci --prefix subpackages/tools-core` | 无报错，根包与 tools-core 的 `node_modules/` 均生成 |
| 2 | `npm run build:style` | 生成 `styles/generated/tailwind.wxss`，文件非空 |
| 3 | `npm run typecheck && npm test` | 类型检查无输出；测试 `802 pass / 0 fail` |
| 4 | 微信开发者工具「导入项目」选择仓库根目录，AppID 填 `wx0f5c60d97c1ce6e2`（无权限可用测试号） | 能识别为小程序项目，基础库 `3.17.6` |
| 5 | 工具 → 构建 npm，分别构建根包与 `subpackages/tools-core` | 根包与 tools-core 两处 `miniprogram_npm/` 均生成 |
| 6 | 编译 `pages/index/index` | 首页显示 65 个工具、Hero 数据、搜索与 Dock 正常 |

可选步骤：

- **全息气象**：复制 `subpackages/tools-core/weather/config.example.ts` 为 `config.local.ts`，填入高德 **Web 服务 Key**，并在 MP 后台把 `https://restapi.amap.com` 加入 request 合法域名。未配置时只有天气工具显示配置错误，其余 64 个工具不受影响。
- **和风天气**：`subpackages/weather/config-local.ts` 由 `npm run qweather:token` 自动生成（Ed25519 私钥本机读取，JWT 24 小时有效），API Host 为 `mq46h5tchy.re.qweatherapi.com`；MP 后台需把该 Host 加入 request 合法域名。Token 过期后重新运行脚本并重新编译。
- **汇率换算**：在小程序后台把 `https://www.chinamoney.com.cn` 加入 request 合法域名；未配置时官方中间价请求失败，页面提示错误并允许切换手动牌价，其余工具不受影响。
- **真机验证**：Canvas、Worker、陀螺仪、相册、定位、专注 BGM 建议在真机完成；开发者工具只能覆盖大部分 UI 与纯计算逻辑。
- **CI 上传**：配置 `private/private.key` 后执行 `npm run ci:upload`，详见 §14.9.11。

### 14.1 环境清单

| 项 | 要求 | 说明 |
|---|---|---|
| 微信开发者工具 | 支持 Skyline 的稳定版 | 项目验证基础库 `3.17.6` |
| AppID | `wx0f5c60d97c1ce6e2` | 无权限可用测试号 |
| Node.js | `>= 22.6`，当前验证 `v24.19.0` | `npm test` 使用 `--experimental-strip-types` |
| npm | 当前验证 `12.2.0` | `package-lock.json` 已锁定 |
| TypeScript | 仓库内 `typescript` | `tsc --noEmit` |
| 高德 Key（可选） | Web 服务类型 Key | 只有「全息气象」需要；未配置时工具显示配置错误，其余 64 个工具不受影响 |
| 汇率域名（官方中间价） | `https://www.chinamoney.com.cn` | 「汇率换算」默认来源；未配置时回退手动牌价 |
| 真机（可选） | iOS / Android 微信 | Canvas / Worker / 陀螺仪 / 相册 / 定位需真机验证 |

### 14.1.1 选择启动路线

不同目标只需要走到不同阶段，不必每次都从零全量构建：

| 路线 | 适用场景 | 必做步骤 | 不需要 |
|---|---|---|---|
| A. 静态校验 | 只改纯 TS / 算法、CI 预检、没有开发者工具 | `npm ci` → 分包 `npm ci` → `build:style` → `typecheck` → `test` | 开发者工具、npm 构建、真机 |
| B. 模拟器开发（推荐） | 日常 UI / 页面 / 主题开发 | 路线 A → 导入开发者工具 → 构建 npm → 编译 | 真机、上传 |
| C. 真机验收 | Canvas / Worker / 相册 / 定位 / 陀螺仪 / BGM | 路线 B → 预览或真机调试 2.0 | 上传 |
| D. 发布构建 | 提审、灰度、正式发布 | 路线 A → 构建 npm → 编译 → 真机走查 → 上传或 `ci:upload` | 无 |

判断口诀：

- **改纯逻辑**：A 足够，`npm test` 会直接跑 Node 单测。
- **改样式 / WXML / 组件**：至少 B，并且改了 `styles/tokens.css` 或新增原子类时必须重跑 `build:style`。
- **改依赖**：A + 重新构建 npm。
- **改图标**：额外执行 `build:icon` 并同步 `font.wxss`。
- **发版**：D，且必须过 §14.3.8 的构建后自检。

### 14.2 从零启动：完整步骤

适用于全新克隆、换机或清空依赖后的首次启动。以下命令都在仓库根目录执行，建议严格按顺序完成。

```text
npm ci
  → npm run build:style
  → npm run typecheck
  → npm test
  → 微信开发者工具导入项目
  → 构建 npm（根包 + tools-core）
  → 编译 pages/index/index
  → 首屏验收
  → 真机预览
```

**一键执行（路线 A，可直接复制）**：

```bash
set -e

# 1. 根包依赖
npm ci

# 2. tools-core 分包依赖（根包 npm ci 不会安装它）
npm ci --prefix subpackages/tools-core

# 3. 生成 Tailwind 产物
npm run build:style

# 4. 类型检查 + 全量测试
npm run typecheck
npm test
```

执行完成后，Node 侧应全部通过；接下来只需在开发者工具完成「导入 → 构建 npm → 编译」三步（见步骤 5–7）。

#### 步骤 1：确认目录与基础环境

```bash
# 将 <repo-root> 替换为实际仓库路径
cd "<repo-root>"
pwd
node -v
npm -v
ls app.json app.ts project.config.json package.json
```

预期：

- 当前目录包含 `app.json` / `app.ts` / `project.config.json` / `package.json`。
- Node.js `>= 22.6`；当前验证版本 `v24.19.0`。
- npm 可用；当前验证版本 `12.2.0`。
- 如需运行测试，Node 必须支持 `--experimental-strip-types`。

#### 步骤 2：安装依赖

```bash
# 根包：mobx-miniprogram / mobx-miniprogram-bindings + 构建工具
npm ci

# tools-core 分包：crypto-js / diff-match-patch
npm ci --prefix subpackages/tools-core
```

说明：

- 优先使用 `npm ci`，严格按 `package-lock.json` 安装，避免依赖漂移。
- 只有需要升级依赖时才使用 `npm install`；升级后必须提交新的 `package-lock.json`。
- **根包与 tools-core 是两套独立依赖**：根 `package.json` 没有 workspaces，根目录 `npm ci` 不会安装 `crypto-js` / `diff-match-patch`，必须再执行一次 `npm ci --prefix subpackages/tools-core`。
- `node_modules/` 与 `subpackages/tools-core/node_modules/` 均已被 `project.config.json` 的 `packOptions.ignore` 排除，不会上传。
- 天气配置：`pretypecheck` / `pretest` 会执行 `scripts/ensure-weather-config.js`，若 `subpackages/tools-core/weather/config.local.ts` 缺失则自动从 `config.example.ts` 生成占位文件。需要真实天气时，填入**高德 Web 服务 Key**，并在 MP 后台把 `https://restapi.amap.com` 加入 request 合法域名；`config.local.ts` 已被 `.gitignore` 忽略。

安装后自检：

```bash
# 根包两个运行时依赖
test -d node_modules/mobx-miniprogram && echo "root mobx OK"
test -d node_modules/mobx-miniprogram-bindings && echo "root bindings OK"

# tools-core 两个运行时依赖
test -d subpackages/tools-core/node_modules/crypto-js && echo "tools-core crypto-js OK"
test -d subpackages/tools-core/node_modules/diff-match-patch && echo "tools-core dmp OK"

# 天气占位配置（typecheck / test 的前置脚本会自动生成）
test -f subpackages/tools-core/weather/config.local.ts && echo "weather config OK"
```

如果某一行没有输出 `OK`，不要继续后面步骤，先回到对应目录重新安装。

#### 步骤 3：编译 Tailwind 样式

```bash
npm run build:style
```

该命令执行：

```bash
weapp-tw -i styles/tokens.css -o styles/generated/tailwind.wxss --target weapp
```

输入与输出：

| 项 | 路径 | 说明 |
|---|---|---|
| 输入 | `styles/tokens.css` | Tailwind v4 CSS-first 令牌，`@source` 扫描 WXML |
| 输出 | `styles/generated/tailwind.wxss` | `app.wxss` 通过 `@import` 引入 |
| 消费方 | `app.wxss` | 全局原子类与语义工具类 |

验证：

```bash
test -f styles/generated/tailwind.wxss && echo "tailwind OK"
```

注意：

- 修改 `styles/tokens.css`、新增 WXML 原子类或新增页面后，重新执行一次。
- 不要手工修改 `styles/generated/tailwind.wxss`，它是编译产物。
- 如果样式全部丢失，优先检查该文件是否存在。

#### 步骤 4：类型检查与测试

```bash
npm run typecheck
npm test
```

预期：

- `tsc --noEmit` 无输出即为通过。
- `npm test` 输出 `tests 802`、`pass 802`、`fail 0`。

说明：

- `tsconfig.json` 开启 `strict`、`noImplicitAny`、`noImplicitThis`、`noUnusedLocals`、`noFallthroughCasesInSwitch`。
- `@ts-nocheck` 仅用于第三方 vendor 文件（`qrcode.ts` / `qrdecode-vendor.ts` / `lunar-data.ts`）。
- 测试不依赖微信开发者工具，可在纯 Node 环境运行。
- 视觉 / E2E 测试依赖开发者工具，见 14.6。

#### 步骤 5：导入微信开发者工具

1. 打开微信开发者工具，选择「导入项目」。
2. 目录选择仓库根目录，例如 `/Users/qinchao/Desktop/超欢-小程序`。
3. AppID 填 `wx0f5c60d97c1ce6e2`；无权限时可用自己的测试号。
4. 项目名保留 `chaohuan-toolbox` 或自定义。
5. 确认 `project.config.json` 的关键配置未被 IDE 覆盖：
   - `compileType: "miniprogram"`；
   - `useCompilerPlugins: ["typescript"]`；
   - `es6: true`、`enhance: true`；
   - `packNpmManually: true`；
   - `packNpmRelationList` 包含根包与 `subpackages/tools-core`；
   - `packOptions.ignore` 未被清空。
6. 确认 `project.private.config.json` 的 `skylineRenderEnable: true`、`bigPackageSizeSupport: false`。
7. 编译模式选择「普通编译」，启动页选择 `pages/index/index`。
8. 导入完成后先不要直接编译；先执行步骤 6 的「构建 npm」（参见 14.3.4）。
9. 构建完成后回到编译器，按步骤 7 编译并验收首页。

#### 步骤 6：构建 npm 依赖

在开发者工具菜单执行：

```text
工具 → 构建 npm
```

由于 `packNpmManually: true` 且 `packNpmRelationList` 配置了两条关系，构建完成后应同时存在：

```text
miniprogram_npm/mobx-miniprogram/
miniprogram_npm/mobx-miniprogram-bindings/
subpackages/tools-core/miniprogram_npm/crypto-js/
subpackages/tools-core/miniprogram_npm/diff-match-patch/
```

快速检查：

```bash
ls miniprogram_npm/mobx-miniprogram
ls subpackages/tools-core/miniprogram_npm/crypto-js
ls subpackages/tools-core/miniprogram_npm/diff-match-patch
```

如果缺失：

- 页面会报 `module is not defined` / 模块找不到 / 白屏；
- Hash 与文本对比工具会因分包依赖缺失而无法运行；
- 重新点击「构建 npm」，必要时重启开发者工具后再试。

#### 步骤 7：编译与首屏验收

点击「编译」，按以下清单验收：

| 检查项 | 预期 |
|---|---|
| 首页背景 | 白昼纸面 / 夜航深空两套材质正常 |
| 工具总数 | 首页显示 65 个工具（61 个本机工具 + 4 个联网工具：全息气象、和风天气、汇率换算、元宝搜索） |
| 搜索 | 输入“房贷”“图片”等能命中工具 |
| 收藏 | 点击星标后收藏页出现该工具 |
| 最近使用 | 打开工具后返回首页，最近使用出现记录 |
| 累计打开 | 数字轮盘从 0 滚动到真实值 |
| 主题 | 我的页切换白昼 / 夜航，状态栏与画布同步 |
| 指令面板 | 魔法棒打开面板，拼音 / 首字母 / 中文可搜 |
| 工具页 | 至少打开 3 个工具，结果区与海报入口正常 |

#### 步骤 8：真机预览

1. 开发者工具点击「预览」，用有权限的微信扫码。
2. 打开「真机调试 2.0」，查看 Console / Storage / Network。
3. 图片工具首次选图会触发隐私授权与相册授权。
4. 九宫格、取色、名片、海报请在真机验证 Canvas 链路。
5. 陀螺仪视差需在真机转动设备验证。
6. 详细验收项见 14.7。

#### 日常启动

| 变更类型 | 需要执行 |
|---|---|
| 只改页面 TS / WXML / WXSS | 开发者工具重新编译 |
| 改 `styles/tokens.css` 或新增原子类 | `npm run build:style` 后重新编译 |
| 改根目录依赖 | `npm ci` + 工具 → 构建 npm |
| 改 `subpackages/tools-core/package.json` | 安装分包依赖 + 构建 npm |
| 改组件 `json` / `wxss` 热更新不生效 | 关闭项目重新打开，或 `cli auto` 重启 |
| 只做类型检查 / 单测 | `npm run typecheck` / `npm test` |

### 14.3 构建体系详解

项目不使用 webpack / vite 等前端打包器；小程序整体编译由微信开发者工具完成，npm scripts 只负责样式、图标、类型检查、测试与验收。

#### 14.3.0 构建产物总览与刷新时机

先建立“什么产物由谁生成”的心智模型，排查问题时就不会把编译产物当成源码：

| 产物 | 生成方式 | 是否入库 | 缺失后的现象 | 何时必须重建 |
|---|---|---|---|---|
| `node_modules/` | `npm ci` | 否 | 脚本无法运行、npm 构建 0 个包 | 首次、依赖变更 |
| `subpackages/tools-core/node_modules/` | `npm ci --prefix subpackages/tools-core` | 否 | Hash / 文本对比报分包依赖缺失 | 首次、分包依赖变更 |
| `styles/generated/tailwind.wxss` | `npm run build:style` | 否 | 原子类全部失效、页面排版塌陷 | 改 `tokens.css`、新增原子类 / 页面 |
| 根包 `miniprogram_npm/` | 开发者工具「构建 npm」或 CI | 否 | `module is not defined`、白屏 | 首次、根包依赖变更 |
| `subpackages/tools-core/miniprogram_npm/` | 同上（第二条 `packNpmRelationList`） | 否 | 分包内模块找不到 | 首次、分包依赖变更 |
| `.icon-dist/gicon.ttf` / `gicon.json` | `npm run build:icon` | 否 | 图标空白 / 码位不符 | 新增或修改图标 |
| `components/g-icon/font.wxss` | 手工把 ttf 转 base64 内嵌 | 是 | 图标全部空白 | 字体重新生成后 |
| `subpackages/tools-core/weather/config.local.ts` | `ensure-weather-config.js` 或手工复制 | 否 | 类型检查 / 编译报缺少模块 | 首次、换 Key |
| 运行时 JS | 开发者工具 TS 插件编译 | 否 | — | 每次编译，无需单独命令 |
| 预览包 / 上传包 | 开发者工具「预览 / 上传」或 `ci:upload` | 否 | — | 验收 / 发布 |

构建与刷新的决策路径：

```mermaid
flowchart TB
  A["修改源码"] --> B{"改了什么"}
  B -->|TS / WXML / WXSS| C["DevTools 重新编译"]
  B -->|tokens.css / 新增原子类| D["npm run build:style"]
  B -->|package.json 依赖| E["npm ci + 构建 npm"]
  B -->|tools-core 依赖| F["npm ci --prefix + 构建 npm"]
  B -->|图标 SVG| G["npm run build:icon"]
  D --> C
  E --> C
  F --> C
  G --> H["同步 font.wxss + GLYPH_CODEPOINTS"]
  H --> C
  C --> I["模拟器验收"]
  I --> J["真机验收"]
  J --> K["上传 / CI"]
```

一条经验规则：**源码改动只需要 DevTools 编译；跨文件产物（样式、npm、字体、配置）改动必须先跑对应生成命令，再编译。**

#### 14.3.1 构建矩阵

| 构建类型 | 命令 / 操作 | 输入 | 输出 | 触发时机 |
|---|---|---|---|---|
| 依赖安装 | `npm ci` | `package-lock.json` | `node_modules/` | 首次启动、依赖变更 |
| Tailwind 样式 | `npm run build:style` | `styles/tokens.css` + WXML | `styles/generated/tailwind.wxss` | 令牌 / 原子类 / 页面变更 |
| 图标字体 | `npm run build:icon` | `.icon-src/*.svg` | `.icon-dist/gicon.ttf`、`gicon.json` | 新增 / 修改图标 |
| 小程序 npm | 开发者工具「构建 npm」 | 根包与 tools-core 依赖 | `miniprogram_npm/*` | 首次导入、依赖变更 |
| TypeScript | 开发者工具 TS 插件 | `*.ts` | 运行时 JS | 每次编译 |
| 类型检查 | `npm run typecheck` | `*.ts` + `tsconfig.json` | 无文件输出 | 提交前、发布前 |
| Worker | 无需单独构建 | `workers/compute.js` | 随包编译 | 每次编译 |
| 小程序整体编译 | 开发者工具「编译」 | 全仓库源码 | 预览包 | 每次运行 |
| 发布上传 | 开发者工具「上传」 | 编译产物 | 微信后台版本 | 发布时 |
| CI 自动上传 | `npm run ci:upload` | 源码 + 上传密钥 | 微信后台开发版本 | 发布时 / 流水线 |

#### 14.3.2 图标字体构建（可选）

仅在新增或修改 `g-icon` 图标时执行。

1. 在 `.icon-src/` 新增 `<name>.svg`（Remix Icon 风格、单色路径）。
2. 执行：

```bash
npm run build:icon
```

3. 命令会生成 `.icon-dist/gicon.ttf` 与 `.icon-dist/gicon.json`。
4. 在 `gicon.json` 中查到新图标码位；当前共 29 个图标，码位范围为 `61697–61725`。
5. 更新 `components/g-icon/index.ts` 的 `GLYPH_CODEPOINTS`。
6. 将 `.icon-dist/gicon.ttf` 以 base64 内嵌到 `components/g-icon/font.wxss` 的 `@font-face`。
7. 更新 `font.wxss` 与 `g-icon` 顶部注释中的图标数量。
8. `.icon-src/` 与 `.icon-dist/` 已被 `packOptions.ignore` 排除，不会上传。

#### 14.3.3 Tailwind 样式构建

`styles/tokens.css` 的结构：

```css
@import "tailwindcss";

@source "../components/**/*.wxml";
@source "../pages/**/*.wxml";
@source "../subpackages/**/*.wxml";

@theme inline {
  --color-canvas: var(--g-canvas);
  --color-ink: var(--g-ink);
  /* ... */
}
```

执行：

```bash
npm run build:style
```

构建链：

```text
styles/tokens.css
  → Tailwind v4 扫描 WXML 类名
  → @theme inline 映射到 --g-* 语义令牌
  → weapp-tailwindcss 转换选择器 / rem → rpx
  → styles/generated/tailwind.wxss
  → app.wxss @import
```

注意事项：

- 新增页面或组件后，确认 `@source` 覆盖到对应目录；当前已覆盖 `components/`、`pages/`、`subpackages/`。
- 不要在页面 WXSS 中写裸色值；优先使用 `--g-*` / `--glass-*` / `--sg-*`。
- `styles/generated/tailwind.wxss` 是生成物，不参与手写维护。
- 如果新增的类名没有生效，先重新构建样式，再清开发者工具缓存。

#### 14.3.4 小程序 npm 构建

根包运行时依赖：

```json
{
  "mobx-miniprogram": "^6.12.3",
  "mobx-miniprogram-bindings": "^7.0.1"
}
```

tools-core 运行时依赖：

```json
{
  "crypto-js": "^4.2.0",
  "diff-match-patch": "^1.0.5"
}
```

`project.config.json`：

```json
{
  "packNpmManually": true,
  "packNpmRelationList": [
    {
      "packageJsonPath": "./package.json",
      "miniprogramNpmDistDir": "./"
    },
    {
      "packageJsonPath": "./subpackages/tools-core/package.json",
      "miniprogramNpmDistDir": "./subpackages/tools-core/"
    }
  ]
}
```

操作（本地开发者工具）：

1. 确认根包与 tools-core 的依赖都已安装：`npm ci` + `npm ci --prefix subpackages/tools-core`。
2. 开发者工具「详情 → 本地设置」确认已启用 npm 模块与增强编译。
3. 开发者工具菜单「工具 → 构建 npm」。
4. 检查根包与 tools-core 两处 `miniprogram_npm/`。
5. 如有依赖变更，先重新安装，再构建 npm。

操作（CI / 无开发者工具）：

```bash
npm run ci:upload
```

`scripts/ci-upload.js` 默认就会构建 npm（只有显式传 `--skip-npm` 才跳过），并读取与 `project.config.json` 相同的两条 `packNpmRelationList`，调用 `miniprogram-ci` 的 `packNpmManually` 自动构建两处 npm 产物；如果 `node_modules` 缺失会直接报错，不会静默跳过。

构建结果自检：

```bash
test -d miniprogram_npm/mobx-miniprogram && echo "root OK"
test -d subpackages/tools-core/miniprogram_npm/crypto-js && echo "tools-core OK"
```

为什么不能只靠 `npm install`：

- 微信小程序不会直接执行 `node_modules` 中的 ESM / CJS 包，必须由开发者工具或 `miniprogram-ci` 转换为 `miniprogram_npm`。
- tools-core 的 npm 产物必须落在 `subpackages/tools-core/miniprogram_npm/`，否则分包内引用失败。
- 根包与分包是两条独立构建关系，只构建其中一条仍会白屏或缺少 Hash / 文本对比能力。

#### 14.3.5 TypeScript 编译与类型检查

- 开发者工具通过 `useCompilerPlugins: ["typescript"]` 直接编译 `.ts`。
- `tsconfig.json` 的 `noEmit: true` 表示 `tsc` 只做类型检查，不产出文件。
- 提交前必须执行：

```bash
npm run typecheck
```

- `noUnusedLocals` 会把未使用变量 / 导入视为错误；临时调试变量需要清理。
- `@ts-expect-error` 仅用于第三方类型缺口（例如 `storeBindings`），不要掩盖真实错误。
- `subpackages/tools-media/lib/qrcode.ts` 为第三方库，保留 `@ts-nocheck`。

#### 14.3.6 Worker、分包与静态资源

**Worker**

- `app.json` 配置 `"workers": "workers"`。
- 入口文件 `workers/compute.js`，无需单独构建。
- 微信平台同一时刻最多 1 个 Worker；`WorkerSandbox` 内部串行调度。
- Worker 不可用时自动降级主线程纯函数。

**分包**

- `app.json` 的 `subpackages` 定义 8 个分包。
- `lazyCodeLoading: "requiredComponents"` 开启按需注入。
- 分包页面路径必须与文件系统一致，禁止修改业务跳转 URL。
- 主包不得引用分包模块；分包之间不得互相引用。

**静态资源**

- 主包 `assets/` 只放全局小程序码与海报兜底图；头像 / 社交二维码下沉 `subpackages/grow/assets/img/`，作品封面下沉 `subpackages/works/assets/covers/`。
- 大图、园枢 22 张真机图与园枢封面放在 `subpackages/campus/assets/`。
- 新增图片前先压缩；主包接近项目预算 1900KB（平台上限 2MB）时优先迁入分包。
- `project.config.json` 的 `packOptions.ignore` 已排除设计源文件、测试、Markdown 等非运行资源。

#### 14.3.7 发布构建

完整的上传、提审、灰度、回滚运行手册见 14.9；本节只列构建与门禁。

发布前完整流程：

```bash
npm ci
npm run build:style
npm run typecheck
npm test
```

然后在开发者工具：

1. 工具 → 构建 npm（如依赖有变更）。
2. 清缓存 → 清除数据缓存（可选，用于排除本地 Storage 干扰）。
3. 重新编译，确认首页、工具页、设置、驾驶舱正常。
4. 真机预览走查图片 / Canvas / 相册 / Worker。
5. 点击「上传」，填写版本号与项目备注。
6. 确认 `uploadWithSourceMap: true`、`minified: true`、`minifyWXSS: true`、`minifyWXML: true`。
7. 确认 `bigPackageSizeSupport: false`，主包不超过平台 2MB，并尽量守住项目 1900KB 预算。

发布检查表：

| 项 | 要求 |
|---|---|
| 类型检查 | `npm run typecheck` 通过 |
| 单元 / 集成测试 | `npm test` 836/836 通过 |
| 样式产物 | `styles/generated/tailwind.wxss` 存在且为最新 |
| npm 产物 | 根包与 tools-core 的 `miniprogram_npm` 均存在 |
| 版本号 | `APP_VERSION` 与后台版本说明一致 |
| 主题 | 白昼 / 夜航 / 自动三种状态均走查 |
| 数据 | 清空工具数据后简历与作品收藏保留 |
| 分享 | 首页与工具页分享路径、`?tool=` 深链正常 |
| 更新 | 更新弹窗、稍后红点、查看更新日志正常 |

#### 14.3.8 构建后自检（Node + 产物 + 门禁）

在开发者工具编译之前，先用一条命令确认所有 Node 侧产物齐全：

```bash
set -e

# 1. Tailwind 产物非空
test -s styles/generated/tailwind.wxss && echo "tailwind OK"

# 2. 根包 npm 产物
test -d miniprogram_npm/mobx-miniprogram && echo "root npm OK"
test -d miniprogram_npm/mobx-miniprogram-bindings && echo "root bindings OK"

# 3. tools-core npm 产物
test -d subpackages/tools-core/miniprogram_npm/crypto-js && echo "tools-core crypto OK"
test -d subpackages/tools-core/miniprogram_npm/diff-match-patch && echo "tools-core dmp OK"

# 4. 天气占位配置
test -f subpackages/tools-core/weather/config.local.ts && echo "weather config OK"
```

再跑三项项目自带门禁：

```bash
npm run check:version   # package.json / package-lock / APP_VERSION / 设置页 CHANGELOG 四源一致
npm run budget          # 主包 1900KB 警戒线 + 各分包体积
npm run plan            # 计划文档 81 项能力 / 63 张计划卡（运行时注册表 65 个工具）
```

当前基线（可对照）：

| 门禁 | 通过输出 | 当前值 |
|---|---|---|
| `check:version` | `✔ 版本四源一致：1.2.0` | `1.2.0` |
| `budget` | `✔ 包体预算通过` | 主包 1475.6 KB / 1900 KB；tools-core 1454.6 KB；grow 841.9 KB；weather 912.5 KB / 1400 KB |
| `plan` | `✔ 方案自检通过` | 计划文档能力 81 项 / 计划卡 63 张（注册表 65 个工具） |
| `typecheck` | 无输出 | 通过 |
| `test` | `tests 836`、`pass 836`、`fail 0` | 836/836 |
| `audit:prod` | `found 0 vulnerabilities` | 根包 + tools-core，官方 npm registry |

任一项失败时的处理顺序：

1. **产物缺失** → 回到 §14.3.0 找到对应生成命令，先补产物，不要改代码。
2. **版本不一致** → 按 §14.9.2 同步四个版本源，再跑 `check:version`。
3. **预算超限** → 检查是否有大图误放主包，压缩或迁入分包；不要直接修改 `check-budget.js` 阈值。
4. **plan 失败** → 通常是新增工具后没有同步 `scripts/check-plan.js` 的 `EXPECT` 清单或帮助文案。
5. **typecheck / test 失败** → 先修代码，禁止带病上传。

彻底重建（仅在依赖或产物疑似损坏时）：

```bash
# 1. 删除可再生成的依赖与产物
rm -rf node_modules
rm -rf subpackages/tools-core/node_modules
rm -rf miniprogram_npm
rm -rf subpackages/tools-core/miniprogram_npm
rm -rf styles/generated

# 2. 重新安装
npm ci
npm ci --prefix subpackages/tools-core

# 3. 重新生成样式
npm run build:style

# 4. 回到开发者工具：工具 → 构建 npm → 编译
```

注意：`rm -rf` 只删除上述可再生成目录，不要删除 `styles/tokens.css`、`styles/v3.wxss`、`components/g-icon/font.wxss` 等手写 / 需入库文件。

#### 14.3.9 构建与门禁脚本索引

所有脚本位于 `scripts/`，由 `package.json` 的 npm scripts 调用：

| 脚本 | 调用方式 | 作用 | 失败含义 |
|---|---|---|---|
| `ensure-weather-config.js` | `pretypecheck` / `pretest` 自动执行 | 缺失时从 `config.example.ts` 复制 `config.local.ts` | 模板文件缺失 / 目录不可写 |
| `ensure-yuanbao-config.js` | `pretypecheck` / `pretest` 自动执行 | 缺失时生成 `core/services/yuanbao/config-local.ts`（服务 API KEY 占位） | 模板文件缺失 / 目录不可写 |
| `ensure-qweather-config.js` | `pretypecheck` / `pretest` 自动执行 | 缺失时生成 `subpackages/weather/config-local.ts`（Host / Token / API KEY 占位） | 模板文件缺失 / 目录不可写 |
| `check-version.js` | `npm run check:version` | 校验 `package.json`、`package-lock.json`、`APP_VERSION`、设置页 `CHANGELOG[0]` 四源一致 | 四处版本漂移 |
| `check-budget.js` | `npm run budget` | 主包 1900KB 警戒线与各分包体积 | 资源误放主包或分包膨胀 |
| `check-plan.js` | `npm run plan` | 校验计划文档 81 项能力 / 63 张计划卡与 §4 路由、§3.11 分包分配一致（运行时注册表 65 个工具） | 新增工具后计划清单未同步 |
| `check-contrast.js` | `npm run check:contrast` | 校验 `app.wxss` 深 / 浅主题文字令牌：正文 ≥4.5:1、accent / danger ≥3:1；按钮填充白字只输出 warning | 正文或文字令牌对比度不足 |
| `ci-upload.js` | `npm run ci:upload` | 构建两处 `miniprogram_npm` 并上传开发版本 | 缺密钥 / 依赖 / Tailwind 产物 |
| `e2e-tools.js` | `npm run test:e2e` | 通过 automator 跑 42 卡路由与功能分支端到端 | 开发者工具未开服务端口 |

`ci-upload.js` 的上传前检查顺序：

```text
读取 APP_VERSION
  → 校验版本号格式
  → 查找上传密钥（--key / MP_CI_PRIVATE_KEY_PATH / private/private.key）
  → 读取 project.config.json 的 appid
  → 检查 styles/generated/tailwind.wxss
  → 构建根包与 tools-core 的 miniprogram_npm
  → miniprogram-ci 上传
```

因此 CI 环境最少需要：Node 22.6+、根包与 tools-core 依赖、`build:style` 产物、上传密钥。

### 14.4 导入开发者工具

#### 14.4.0 准备开发者工具

| 项 | 操作 / 要求 |
|---|---|
| 版本 | 安装支持 Skyline 的稳定版；基础库使用 `3.17.6` |
| 登录 | 使用具备该 AppID 开发者权限的微信扫码登录；无权限时改用测试号 |
| 服务端口 | 「设置 → 安全设置 → 服务端口」开启；视觉 / E2E 自动化依赖它 |
| 代理 / 网络 | 关闭会拦截 `restapi.amap.com` / `chinamoney.com.cn` / 和风 API Host / `wsa.tencentcloudapi.com` 的代理，否则天气、汇率与元宝搜索会失败 |
| 本地配置 | 保留仓库内的 `project.private.config.json`，其中 `skylineRenderEnable: true`、`bigPackageSizeSupport: false` |
| 缓存 | 首次导入前无需清缓存；出现样式 / 组件异常时再执行「清缓存 → 全部清除」 |

macOS 的 CLI 常见路径（自动化脚本会按顺序探测）：

```text
/Applications/wechatwebdevtools.app/Contents/MacOS/cli
/Applications/微信开发者工具.app/Contents/MacOS/cli
/Applications/微信web开发者工具.app/Contents/MacOS/cli
```

#### 14.4.1 导入步骤

1. 打开微信开发者工具，选择「导入项目」。
2. 目录选择仓库根目录，例如 `/Users/qinchao/Desktop/超欢-小程序`。
3. AppID 填 `wx0f5c60d97c1ce6e2`；没有权限时使用自己的测试号。
4. 项目名可保留 `chaohuan-toolbox`。
5. 选择「不使用云服务」（项目为无自建后端、本机优先方案；天气、汇率与搜索按需联网）。
6. 确认项目配置未被本地覆盖。
7. 导入后先不要点「编译」；按 §14.2 步骤 6 完成 npm 构建后再编译，否则首次编译会因 `miniprogram_npm` 缺失而白屏。

#### 14.4.2 必须保持的配置

| 配置 | 值 | 作用 |
|---|---|---|
| `compileType` | `miniprogram` | 小程序项目 |
| `useCompilerPlugins` | `["typescript"]` | 直接编译 TS |
| `es6` | `true` | ES6 转换 |
| `enhance` | `true` | 增强编译 |
| `minified` | `true` | 上传压缩 JS |
| `minifyWXSS` | `true` | 压缩样式 |
| `minifyWXML` | `true` | 压缩模板 |
| `uploadWithSourceMap` | `true` | 保留 source map |
| `ignoreUploadUnusedFiles` | `true` | 上传时过滤无依赖文件；共享模块均被分包静态引用，不会被过滤 |
| `ignoreDevUnusedFiles` | `true` | 预览 / 真机调试同样过滤无依赖文件，并使「未使用 JS」检查通过 |
| `ignoreCodeQuality` | `true` | 关闭预览 / 上传前的代码质量自动扫描（手动面板不受此项控制） |
| `packNpmManually` | `true` | 手动构建 npm |
| `skylineRenderEnable` | `true` | 开启 Skyline |

#### 14.4.3 首次编译检查

点击「编译」后，开发者工具大致按以下顺序工作：

| 阶段 | 读取 / 执行 | 失败时的典型现象 |
|---|---|---|
| 1. 读取工程配置 | `project.config.json`、`project.private.config.json` | 不识别为小程序、Skyline 未开启 |
| 2. 解析 `app.json` | 5 个主包页、8 个分包、TabBar、全局组件、`workers` | 页面不存在、分包路由报错 |
| 3. TS 编译 | `app.ts`、页面 / 组件 `.ts`、`useCompilerPlugins` | 语法 / 类型错误、`undefined is not a function` |
| 4. 样式编译 | `app.wxss` → `styles/generated/tailwind.wxss` + `styles/v3.wxss` | 无样式、排版塌陷 |
| 5. npm 解析 | 根包与 tools-core 的 `miniprogram_npm` | `module is not defined`、白屏 |
| 6. 运行时启动 | `App.onLaunch` → 首页 `onLoad` / `onShow` | 首屏空、主题闪烁、Storage 异常 |
| 7. 首次渲染 | Hero、搜索、最近使用、收藏、Dock | 工具数不对、图标空白 |

编译成功后：

- 首页出现「工具箱」标题与液态玻璃 Hero；
- 底部 TabBar 显示工具 / 收藏 / 我的；
- 控制台没有 `module is not defined`；
- 页面没有裸 HTML / 裸文本样式；
- 状态栏前景色与当前主题一致。

如果白屏，按上面的阶段顺序定位：

1. 阶段 2：确认 `app.json` 的页面路径与文件系统一致。
2. 阶段 3：看控制台第一条 TS / JS 报错，先修第一条。
3. 阶段 4：检查 `styles/generated/tailwind.wxss` 是否存在且非空。
4. 阶段 5：检查两处 `miniprogram_npm` 是否生成。
5. 阶段 6：检查 `diag:errors.v1` 与控制台 `[gallery]` 日志。
6. 阶段 7：检查 `pages/index/index.json` 的 `usingComponents` 路径。
7. 以上都正常仍白屏时，执行「清缓存 → 全部清除」并重启开发者工具。

### 14.5 首次启动会发生什么

按 `app.ts` 顺序：

0. `restoreStaleFocusBrightness()`：如果上次专注异常退出留下 `focus:brightness:v1`（`owned: true`），先恢复原始亮度并删键。
1. `preferenceStore.init()` 恢复偏好。
2. `warmUpSound()` 延迟 700ms 预热音效。
3. `installPrivacyGuard()` 注册隐私监听。
4. `runStorageMigrations()` 迁移本地数据。
5. `setAmbientToolCategoryResolver()` 注册分类解析器。
6. `uiStore.initTheme()` 恢复主题并同步原生栏。
7. `toolboxStore.init()`、`historyStore.init()`、`applyAutoClean()`。
8. `resumeStore.bootstrap()` 并发装载简历数据。
9. `installUpdateGuard()` 静默下载新版本。

可核对 Storage：

| 键 | 预期 |
|---|---|
| `app:storage.version` | `1` |
| `gallery.glass.meta` | 首次进入首页后写入，`version: 2` |
| `gallery.theme.mode` | 仅手动切换后存在 |
| `tbx:favorites` / `tbx:recent` | 有收藏 / 打开记录后存在 |

### 14.6 开发者工具自动化

前置：开发者工具已登录，并在「设置 → 安全设置」开启服务端口。

```bash
# macOS 默认路径示例；--project 指向仓库根目录
"/Applications/wechatwebdevtools.app/Contents/MacOS/cli" auto \
  --project "<repo-root>" \
  --auto-port 9420
```

视觉验收：

```bash
npm run test:visual:hologram:dry       # 预检
npm run test:visual:hologram           # 自动启动并截图
npm run test:visual:hologram:connect   # 复用 ws://127.0.0.1:9420
```

环境变量：

| 变量 | 作用 | 默认 |
|---|---|---|
| `WECHAT_DEVTOOLS_CLI` | 指定 CLI 路径 | 按候选路径探测 |
| `WECHAT_AUTOMATOR_WS` | 指定 automator WebSocket | `--connect` 时 `ws://127.0.0.1:9420` |
| `WECHAT_AUTOMATOR_PORT` | 指定 automator 端口 | 由 automator 决定 |

注意：

- 修改组件 `json` / `wxss` 后热更新可能不可靠，需关闭再重新 `cli auto`。
- Skyline 下 `launch` / `reLaunch` 可能丢失页面元信息，优先 `--connect`。
- automator 截图可能冻结上一帧：先激活模拟器窗口，必要时二次截图。
- 读取页面状态优先 `mp.evaluate`。

### 14.7 真机预览与调试

| 能力 | 开发者工具 | 真机 |
|---|---|---|
| Skyline Canvas（九宫格 / 取色 / 名片） | 可能不支持，页面提示真机预览 | 支持 |
| `wx.getRandomValues` | 支持 | 支持；不可用回退 `Math.random` |
| Worker | 支持但受限 | 同一时刻仅 1 个 |
| 陀螺仪 | 可能不可用 | 支持；失败降级静态 |
| 相册保存 | 支持 | 需要 `scope.writePhotosAlbum` |
| 震动 | 模拟 | 真机 |
| `backdrop-filter` | 支持 | 低端机可能掉帧，需降级 |
| 自定义 TabBar | 支持 | 支持，注意安全区 |

真机验证建议：

1. 首页 → 工具 → 返回，观察累计打开数位滚动。
2. 收藏 / 取消收藏 / 清空最近使用。
3. 图片工具选图 → 处理 → 保存相册。
4. 水印工作台双指缩放 / 旋转 / 打码。
5. 二维码生成 → 保存。
6. 极光海报生成 → 预览 → 保存。
7. Workflow 静默流转 + 跳转流转 + 撤销。
8. 昼夜主题切换 + 自动跟随系统。
9. 驾驶舱图表 / 隐私盾 / 清空轨迹。
10. 更新弹窗阻塞与稍后红点。

### 14.8 调试与诊断

**日志**

- `logger.info` 只在开发者工具输出；`warn` / `error` 真机也输出。
- 前缀 `[gallery][domain]`。
- 关键 domain：`app`、`store`、`transport`、`home`、`toolbox`、`album`、`profile`、`blackbox`、`workflow`、`privacy`、`update`。

**黑匣子**

```js
wx.getStorageSync('diag:errors.v1')
```

**Storage 调试**

| 目标 | 操作 |
|---|---|
| 重置全部状态 | 开发者工具「清缓存 → 清除数据缓存」 |
| 只重跑迁移 | 删除 `app:storage.version` 后重新编译 |
| 只重置主题 | 删除 `gallery.theme.mode` |
| 只重置工具数据 | 「我的 → 清空工具数据」或删除 `tbx:*` |
| 只重置作品收藏 | 删除 `gallery.works.favorites` |

**常见问题**

| 现象 | 可能原因 | 处理 |
|---|---|---|
| 白屏 / module not defined | `miniprogram_npm` 未构建 | 工具 → 构建 npm（根包 + tools-core） |
| 样式全部丢失 | `styles/generated/tailwind.wxss` 缺失 | `npm run build:style` |
| 图标空白 | `font.wxss` 未内嵌 / 码位不匹配 | 重新生成并同步 `GLYPH_CODEPOINTS` |
| 组件不存在 | 页面 `json` 未注册或路径错误 | 检查 `usingComponents` |
| 夜航组件发白 | `styleIsolation: isolated` 无法消费主题令牌 | 改为 `apply-shared` |
| 修改 json/wxss 不生效 | 热更新未命中 | 重启编译或 `cli auto` |
| 状态栏颜色旧 | 未调用 `syncNativeChrome()` | 需要同步的页面在 `onShow` 调用；工具页由 `glass-tool-shell` 统一调用 |
| 九宫格 / 取色报 Canvas 错误 | 开发者工具不支持 Skyline Canvas | 真机预览 |
| 保存相册失败 | 未授权 `scope.writePhotosAlbum` | 应用内「去设置」 |
| 主包上传超限 | 图片 / 页面在主包 | 压缩图片或迁入分包 |
| 低端机掉帧 | 大面积 `backdrop-filter` / 极光 | 开启省电模式 / 减少 blur |

### 14.9 部署与发布流程

本项目没有服务端、云函数、数据库或静态站点，"部署"等同于微信小程序的**上传 → 提审 → 发布**。完整链路：

```text
发布准备（账号 / 隐私 / 类目）
  → 构建与质量门禁（npm ci / build:style / typecheck / test）
  → 构建 npm + 编译（DevTools 或 npm run ci:upload）
  → 上传开发版本
  → 提交审核
  → 发布（全量 / 分阶段）
  → 线上验证
  → 回滚或热修
```

#### 14.9.1 发布前置条件

| 项 | 要求 | 说明 |
|---|---|---|
| 小程序 AppID | `wx0f5c60d97c1ce6e2` | 必须与 `project.config.json` 一致；上传账号需具备开发者权限 |
| 成员权限 | 开发者 / 体验成员 | 体验成员用于发布前的体验版真机验收 |
| 服务类目 | 工具 / 效率类 | 在 MP 后台配置，必须与实际功能一致 |
| 用户隐私保护指引 | 已配置并发布 | `app.json` 设置 `__usePrivacyCheck__: true`；需声明相册（仅写入）、选中的图片或视频信息；否则 `wx.chooseMedia` / `wx.saveImageToPhotosAlbum` 会被隐私拦截 |
| 基础库最低版本 | `≥ 3.17.6` | 与 `project.config.json` 的 `libVersion` 对齐；项目依赖 Skyline + glass-easel |
| 服务器域名 | request 合法域名：`https://restapi.amap.com`（全息气象）、和风 API Host（`subpackages/weather/config-local.ts` 的 `QWEATHER_HOST`）、`https://www.chinamoney.com.cn`（汇率换算官方中间价）、`https://api.wsa.cloud.tencent.com` 或 `https://wsa.tencentcloudapi.com`（元宝搜索） | 除这四类公开数据请求外，`localTransport` 只读本地数据 |
| 云开发 / 云函数 | 不使用 | 不需要创建云环境、云数据库或云存储 |
| 微信支付 / 订阅消息 | 未接入 | 不需要商户号、支付目录或订阅模板 |
| 应用内隐私入口 | `subpackages/grow/pages/legal/index` | 隐私说明、本机数据、免责声明、开源许可 |

涉及授权 / 系统能力的 API 与声明口径：

| API | 用途 | 声明口径 |
|---|---|---|
| `wx.chooseMedia` | 图片工具选图 | `sourceType: ['album']`，只从相册选择，不申请相机 |
| `wx.saveImageToPhotosAlbum` | 保存图片 / 海报 / 九宫格 | 仅写入相册，不读取相册 |
| `wx.startDeviceMotionListening` / `wx.onDeviceMotionChange` | 空间全息视差 | 仅用于动效；不可用时自动降级为静态 |
| `wx.setClipboardData` | 复制结果 / 邮箱 / 备份码 | 隐私接口；用户结果统一经 `copyText` 前置授权，拒绝时不写；设置页分片 / AES 备份码等例外已登记 |
| `wx.getRandomValues` | 随机密码 / AES IV | 仅本机计算，不上传 |

#### 14.9.2 版本号管理

| 位置 | 当前值 | 作用 |
|---|---|---|
| `core/constants/index.ts` 的 `APP_VERSION` | `1.2.0` | 运行时唯一版本真相源；我的页、隐私页、设置页、驾驶舱读取并展示 |
| `package.json` / `package-lock.json` 根版本 | `1.2.0` | npm 元数据；必须与 APP_VERSION 保持一致 |
| 设置页 `CHANGELOG[0]` | `v1.2.0` | 用户可见的版本说明；四源由 `npm run check:version` 校验 |
| 微信后台「上传版本号」 | 手动填写 | 审核与发布的标识，必须与 `APP_VERSION` 完全一致 |

规则：

1. 发布前先确定版本号；`APP_VERSION` 与后台上传版本号必须一致；`npm run check:version` 必须保证 package / lock / APP_VERSION / CHANGELOG[0] 四源一致。
2. 每次上传使用递增版本号；不要长期复用同一版本号，否则审核记录与线上版本难以对应。
3. 版本描述、设置页更新日志、`APP_VERSION` 三者语义保持一致。
4. `subpackages/tools-core/package.json` 没有 `version` 字段，只需维护依赖版本。

#### 14.9.3 发布前构建与质量门禁

```bash
npm ci
# 首次发布或 tools-core 依赖变更时，安装分包依赖
npm ci --prefix subpackages/tools-core

npm run build:style
npm run typecheck
npm test
```

随后在开发者工具执行「工具 → 构建 npm」，再执行「编译」；使用 14.9.11 的 CI 上传时，根包与 tools-core 的 npm 构建由脚本自动完成。仅在新增或修改图标时执行 `npm run build:icon`。

| 门禁 | 命令 / 操作 | 通过标准 |
|---|---|---|
| 依赖安装 | `npm ci`（根包 + tools-core） | 无报错，`node_modules` 与分包依赖齐全 |
| Tailwind 产物 | `npm run build:style` | `styles/generated/tailwind.wxss` 存在且为最新 |
| 类型检查 | `npm run typecheck` | `tsc --noEmit` 无输出 |
| 单元 / 集成测试 | `npm test` | `tests 802`、`pass 802`、`fail 0` |
| Workflow 覆盖 | `tests/workflow-coverage.test.js` | 65 个工具全部注册，适配器 / 来源 / 收发端完整 |
| 分包路由 | `tests/subpackage-routing.test.js` | 通过 |
| npm 产物 | 开发者工具「构建 npm」 | 根包 2 个依赖 + tools-core 2 个依赖均生成 |
| 编译 | 开发者工具「编译」 | 无 `module is not defined`，首页不白屏 |

说明：

- `styles/generated/tailwind.wxss` 是编译产物，不要手工修改；新增 WXML 类名或页面后必须重新构建。
- `miniprogram_npm` 为开发者工具产物；根包与 `subpackages/tools-core/miniprogram_npm` 缺一不可。
- 视觉 / E2E 验收依赖开发者工具，见 14.6。

#### 14.9.4 上传前配置核对

| 配置 | 值 | 作用 |
|---|---|---|
| `appid`（`project.config.json`） | `wx0f5c60d97c1ce6e2` | 与 MP 后台一致 |
| `compileType` | `miniprogram` | 普通小程序 |
| `libVersion` | `3.17.6` | 与后台最低基础库对齐 |
| `useCompilerPlugins` | `["typescript"]` | 直接编译 TS |
| `es6` / `enhance` | `true` | ES6 转换与增强编译 |
| `packNpmManually` | `true` | 手动构建 npm |
| `packNpmRelationList` | 根包 + `subpackages/tools-core` | 两处 npm 产物 |
| `minified` / `minifyWXSS` / `minifyWXML` | `true` | 上传压缩 |
| `uploadWithSourceMap` | `true` | 后台错误堆栈还原 |
| `ignoreUploadUnusedFiles` | `true` | 上传时过滤无依赖文件；共享模块均被分包静态引用，不会被过滤 |
| `ignoreDevUnusedFiles` | `true` | 预览 / 真机调试同样过滤无依赖文件，并使「未使用 JS」检查通过 |
| `ignoreCodeQuality` | `true` | 关闭预览 / 上传前的代码质量自动扫描（手动面板不受此项控制） |
| `bigPackageSizeSupport`（私有配置） | `false` | 主包按 2MB 限制 |
| `skylineRenderEnable`（私有配置） | `true` | 开启 Skyline |
| `renderer`（`app.json`） | `skyline` | 渲染引擎 |
| `componentFramework` | `glass-easel` | 组件框架 |
| `lazyCodeLoading` | `requiredComponents` | 按需注入 |
| `workers` | `workers` | Worker 目录 |
| `darkmode` / `themeLocation` | `true` / `theme.json` | 白昼 / 夜航原生配色 |
| `__usePrivacyCheck__` | `true` | 启用隐私授权检查 |
| `tabBar.custom` | `true` | 自定义底部导航 |
| `sitemap.json` | `allow *` | 允许索引全部页面 |

`packOptions.ignore` 已排除：`node_modules`、`subpackages/tools-core/node_modules`、`.git`、`.gitignore`、`.github`、`scripts`、`private`、`.trae`、`.vscode`、`.DS_Store`、`.key`、所有 `.md`、`.legacy`、`.icon-src`、`.icon-dist`、`.screenshots`、`补充文档`、`视觉提案*`、`山西晋中理工学院-园枢`、`ai-skills`、`tests`、`docs`、`preview-qr.png`、`未命名.png`，以及 `package.json`、`tsconfig.json`、`postcss.config.js`、`package-lock.json`、`project.private.config.json` 等构建配置。

注意：

- `project.private.config.json` 只在本机生效，不随包上传；不要为了"干净"删除它，否则 `skylineRenderEnable` 可能丢失。
- 若主包体积接近 1900KB 预算线，先检查是否有大图误放主包，再考虑迁入分包；平台主包 / 单个分包硬上限为 2MB。
- `CODE_WIKI.md` 与所有 Markdown 已被忽略，不会占用包体。

#### 14.9.5 上传开发版本

1. 开发者工具点击「上传」。
2. 版本号填写 `APP_VERSION`（当前 `1.2.0`；发版前按 14.9.2 递增）。
3. 项目备注写清：本次变更、重点验收项、已知限制、隐私相关改动。
4. 确认上传设置与 14.9.4 一致（压缩、source map、未引用文件忽略）。
5. 执行上传；若主包超过 2MB，上传会失败，先按 14.9.4 处理体积。
6. 上传成功后进入 MP 后台「版本管理 → 开发版本」，核对版本号、上传时间与包大小。
7. 如需团队验收，把该版本设为「体验版」并添加体验成员；开发版二维码仅开发者可预览。

版本阶段：

| 阶段 | 产生方式 | 可见范围 |
|---|---|---|
| 预览 | 开发者工具「预览」 | 生成临时二维码，不创建后台版本 |
| 开发版 | 开发者工具「上传」 | 开发者可预览，可提交审核 |
| 体验版 | 后台把开发版设为体验版 | 体验成员可扫码使用 |
| 线上版 | 审核通过后「发布」 | 全体用户；老用户由更新管理器提示重启 |

也可使用 `npm run ci:upload` 通过 miniprogram-ci 自动构建 npm 并上传，详见 14.9.11；开发者工具 CLI 的 `upload` 子命令仍可用，具体参数以本机 `cli --help` 为准。

#### 14.9.6 提交审核

1. MP 后台「版本管理 → 开发版本 → 提交审核」。
2. 填写功能页面、服务类目、标签、页面截图与版本描述。
3. 确认「用户隐私保护指引」已发布，且声明范围与 14.9.1 的 API 声明口径一致。
4. 审核备注建议直接给出可复现路径，避免审核员找不到功能：

```text
本小程序为无自建后端、本机优先的效率工具箱，无登录、无自建服务器、无业务数据上传；天气、和风天气、汇率与元宝搜索按需直连公开数据服务。
相册权限仅用于选择图片与保存处理结果，拒绝后不影响其他工具。
Canvas 用于图片压缩 / 九宫格切图 / 取色 / 海报绘制；
Worker 用于长文本统计与去重；设备方向用于空间全息动效，不可用时自动降级。
建议路径：首页 → 房贷试算 → 生成海报；
首页 → 图片压缩 → 选择相册图片 → 保存到相册；
我的 → 设置中心 → 数据驾驶舱。
无需测试账号。
```

5. 审核期间不要继续修改同一版本；如需改动，重新上传并递增版本号。
6. 审核结果以 MP 后台状态为准；被拒后按原因修复，重新上传再提交，不能原地修改已提交版本。
7. 审核通过前不要执行发布。

#### 14.9.7 发布与灰度

- 审核通过后，在 MP 后台「版本管理」点击「发布」。
- 默认全量发布；若后台支持「分阶段发布」，先小比例放量（例如 1%–10%），观察异常后再逐步扩大；分阶段期间可暂停。
- 发布即对线上生效；老用户下次启动时由 `wx.getUpdateManager()` 检测新版本，经 `update-guard` 提示后重启生效。
- 项目没有远程配置中心：`preferenceStore.flags` 只存在于本机，不能远程开关功能；线上应急只能依赖版本回退、分阶段暂停或紧急发版。
- 线上观察依赖 MP 后台「运维中心」的性能 / 异常数据与用户反馈；本项目的 `diag:errors.v1` 黑匣子只写本机 Storage，不会自动上传，不能当作线上监控。
- 建议先在体验版完成 14.9.8 的全部验收，再全量发布。

#### 14.9.8 发布后验证

| 检查项 | 预期 |
|---|---|
| 版本号 | 我的页 / 隐私页 / 设置页显示 `1.2.0`，与后台一致 |
| 首屏 | 65 个工具、Hero 数据、搜索、Dock 正常 |
| 主题 | 白昼 / 夜航 / 自动跟随系统，状态栏与背景同步 |
| 搜索与指令面板 | 中文、拼音全拼、首字母均可命中 |
| 收藏 / 最近 / 累计打开 | 收藏、最近使用、数字滚轮正常 |
| 分享与深链 | 分享卡片、`?tool=` 冷热启动跳转正常 |
| 工具页 | 至少 3 个工具完成输入 → 计算 → 结果 → 海报 |
| 图片工具 | 选图触发隐私授权，保存相册成功 |
| Workflow | silent 静默计算、jump 跳转注入、撤销均正常 |
| 设置 | 偏好开关、自动清理、Cyber Space OS 正常 |
| 驾驶舱 | 图表、隐私盾、清空轨迹正常 |
| 更新 | 旧版 → 新版弹窗、稍后红点、查看更新日志、立即重启 |
| 数据升级 | 旧版收藏 / 最近 / 轨迹 / 偏好在新版中保留 |
| 体积 | 主包 < 2MB，并尽量守住 1900KB 项目预算 |

升级路径验证：

```text
安装旧版（体验版或线上）
  → 产生收藏 / 最近使用 / 计算轨迹 / 偏好
  → 发布新版
  → 冷启动：onUpdateReady → update-guard 弹窗
  → 立即重启：版本号更新，本地数据完整
  → 选择稍后：设置页出现红点
  → 再次启动：红点保留，直到新版本生效或确认无更新
```

注意：首次安装的用户不会收到更新弹窗；只有本机存在更旧版本且后台已有新版本时才会触发。

#### 14.9.9 回滚与热修

- 分阶段发布出现异常：先在后台暂停放量，再定位问题。
- 需要整体回退：使用 MP 后台的「版本回退」回到上一个线上版本（可用范围以后台当前能力为准）。
- 数据兼容：本地迁移是单向的 `v0 → v1`；回退后旧版本看到 `app:storage.version = 1` 会直接跳过迁移。新版写入的新键 / 新字段可能不被旧版理解，回退前必须评估 Storage 影响。
- 热修：修复代码 → 递增 `APP_VERSION` → 重新 `npm ci` / `build:style` / `typecheck` / `test` → 构建 npm → 上传 → 提审 → 发布；小程序不支持代码热更新。
- 更新下载失败：`App.onLaunch` 的 `onUpdateFailed` 只提示「网络波动，极光新版本下载失败」，微信会在下次启动自动重试，无需人工干预。
- 回滚完成后，下一次 `onCheckForUpdate` 判定无更新时会自动清除 `hasPendingUpdate` 红点。
- 线上严重问题优先暂停 / 回滚，再排查；本项目无法远程读取用户本机黑匣子，需依赖后台异常数据与用户反馈。

#### 14.9.10 常见发布问题

| 现象 | 可能原因 | 处理 |
|---|---|---|
| 上传失败：主包超过 2MB | 主包误放大图 / 未忽略文件 | 检查 `packOptions.ignore`，压缩或迁入分包 |
| 白屏 / `module is not defined` | `miniprogram_npm` 未构建 | 开发者工具「构建 npm」（根包 + tools-core） |
| 样式全部丢失 | `tailwind.wxss` 缺失或过期 | `npm run build:style` 后重新编译 |
| 体验版仍是旧代码 | 未重新上传 / 本地缓存 | 核对版本号，重新上传，清缓存 |
| 隐私接口被拦截 / 审核被拒 | 隐私指引未配置或声明不符 | 在 MP 后台补齐并发布隐私指引 |
| 更新弹窗不出现 | 后台无更新版本 / 已是最新 / 页面 `blocked` / 状态为 `dismissed` | 用旧版 + 新版验证，检查 `promptState` 与阻塞计数 |
| 保存相册失败 | 未授权 `scope.writePhotosAlbum` | 走应用内「去设置 → 重试」 |
| 审核员认为功能不完整 | 入口深 / 未提供路径 | 审核备注给出明确复现路径 |
| tools-core 页面报依赖缺失 | 分包 npm 未构建 | 检查 `subpackages/tools-core/miniprogram_npm` |
| 真机与模拟器表现不同 | Canvas / Worker / 设备方向差异 | 以真机为准，保留离屏 / 降级兜底 |

#### 14.9.11 miniprogram-ci 自动上传

仓库已接入 `miniprogram-ci`（开发依赖，当前 `^2.1.31`），上传入口：

```bash
npm run ci:upload
```

脚本 `scripts/ci-upload.js` 负责：

1. 读取 `core/constants/index.ts` 的 `APP_VERSION` 作为默认版本号；显式 `--version` 与 `APP_VERSION` 不一致时给出警告。
2. 读取 `project.config.json` 的 `appid` 与编译配置。
3. 自动执行根包与 `subpackages/tools-core` 的 `miniprogram_npm` 构建（`ci.packNpmManually`，与 `packNpmRelationList` 一致）。
4. 用 `ci.Project` + `ci.upload` 上传开发版本，编译设置使用 `useProjectConfig: true`。
5. 输出整包 / 主包 / 分包体积，便于核对 2MB 限制与 1900KB 预算。
6. 结束时强制收口，避免 miniprogram-ci 残留句柄导致 CI 步骤挂起到超时。

> 已验证：密钥、编译与真实上传成功（v1.1.0，主包 1.07 MB，整包 4.33 MB）；GitHub Actions 标签触发端到端上传成功。若未来重新开启 IP 白名单，需放行 Runner 出口 IP。

**首次配置**

1. MP 后台 → 开发管理 → 开发设置 → 小程序代码上传 → 生成上传密钥，下载 `.key` 文件。
2. 若后台开启了 IP 白名单，把当前机器或 CI 出口 IP 加入白名单，否则上传会报 IP 不在白名单。
3. 将密钥放到 `private/private.key`（已被 `.gitignore` 与 `packOptions.ignore` 排除），或用 `--key` / `MP_CI_PRIVATE_KEY_PATH` 指定其它位置。
4. 如需固定 CI 机器人，先在后台配置机器人编号，再使用 `--robot 1`～`--robot 30`。

**常用命令**

```bash
# 默认：读取 APP_VERSION + 自动构建 npm + 上传
npm run ci:upload

# 指定版本号与备注
npm run ci:upload -- --version 1.1.1 --desc "修复水印导出"

# 指定密钥与 CI 机器人
npm run ci:upload -- --key /secure/private.key --robot 2

# 跳过 npm 构建（仅在确认 miniprogram_npm 已是最新时）
npm run ci:upload -- --skip-npm
```

参数：

| 参数 | 默认 | 说明 |
|---|---|---|
| `--version` | `APP_VERSION` | 上传版本号 |
| `--desc` | `CI 自动上传 v<version> · 时间` | 项目备注 |
| `--key` | `private/private.key` | 上传密钥路径 |
| `--robot` | 空 | 1–30，需后台配置机器人 |
| `--threads` | 空 | 编译线程数 |
| `--skip-npm` | 否 | 跳过 miniprogram_npm 构建 |
| `--help` | — | 显示帮助 |

环境变量：`MP_CI_PRIVATE_KEY_PATH`、`MP_CI_VERSION`、`MP_CI_DESC`、`MP_CI_ROBOT`、`MP_CI_THREADS`、`MP_CI_SKIP_NPM=1`。

**GitHub Actions（已配置）**

工作流文件：`.github/workflows/miniprogram-ci.yml`

触发方式：

| 事件 | 行为 |
|---|---|
| 推送 `v*` 标签 | 校验标签与 `APP_VERSION` 一致后自动上传 |
| 手动 `workflow_dispatch` | 可填版本号 / 备注；版本号留空时使用 `APP_VERSION` |

首次配置：

1. 在 GitHub 仓库 → Settings → Secrets and variables → Actions → New repository secret，创建 `MP_CI_PRIVATE_KEY_BASE64`。
2. 生成 secret 值（macOS）：

```bash
base64 -i private/private.key | pbcopy
```

Linux：

```bash
base64 -w0 private/private.key
```

3. 粘贴到 secret；工作流会在 runner 内解码到临时目录、设置 `600` 权限，任务结束自动删除。
4. GitHub-hosted runner 出口 IP 不固定：微信后台若开启 IP 白名单，需关闭白名单，或改用固定出口 IP 的自托管 runner 并加入白名单。
5. 当前工作区不是 Git 仓库；需先初始化并推送到 GitHub，Actions 才会被标签或手动触发。

工作流核心步骤：

```text
checkout → setup-node(22) → npm ci（根包 + tools-core）
→ build:style → typecheck → npm test
→ 标签与 APP_VERSION 校验
→ 解码密钥到 $RUNNER_TEMP/mp-ci/private.key
→ npm run ci:upload
→ 无条件清理密钥
```

工作流等价于执行：

```bash
npm run ci:upload -- --version 1.1.0 --desc "GitHub Actions v1.1.0 abc1234"
```

**通用流水线示例**

```bash
npm ci
npm ci --prefix subpackages/tools-core
npm run build:style
npm run typecheck
npm test
MP_CI_PRIVATE_KEY_PATH="$MP_CI_KEY_FILE" npm run ci:upload
```

说明：

- 密钥从 CI Secret 写入临时文件，不要写入仓库，也不要打印到日志。
- 脚本会自动构建 npm，无需在 CI 中启动微信开发者工具。
- 上传只产生「开发版本」，提审与发布仍需在 MP 后台完成。
- `styles/generated/tailwind.wxss` 必须先由 `build:style` 生成，CI 不会自动编译 Tailwind。
- 上传前建议先跑 `typecheck` 与 `npm test`；脚本本身不重复执行这两步。
- 上传密钥一旦泄露，立即在小程序后台重置，并同步更新 GitHub Secret。

**故障排查**

| 现象 | 原因 | 处理 |
|---|---|---|
| `invalid ip` / `40164` | 后台开启 IP 白名单；GitHub-hosted runner 出口 IP 不固定 | 关闭 IP 白名单，或改用固定出口 IP 的自托管 runner |
| 密钥无效 / 解析失败 | 密钥损坏或不是后台下载的 `.key` | 重新生成并替换 |
| `NO_NODE_MODULES` | 依赖未安装 | 执行 `npm ci` 与 `npm ci --prefix subpackages/tools-core` |
| npm 构建 0 个包 | 依赖未声明 / `node_modules` 缺失 | 检查 `package.json` 与锁文件 |
| 编译报 TS 错误 | 代码未通过类型检查 | 先执行 `npm run typecheck` |
| 主包超过 2MB | 资源误放主包 | 检查 `packOptions.ignore`，压缩或迁入分包 |
| 上传成功但版本号不对 | 未递增 `APP_VERSION` / 显式覆盖 | 核对脚本警告与后台版本 |
| Skyline 编译结果与 DevTools 不同 | CI 编译器版本与 DevTools 版本差异 | 用 DevTools 复核，必要时回退 DevTools 上传 |

### 14.10 常见启动问题

#### 14.10.1 三种运行形态

| 形态 | 入口 | 适用场景 | 限制 |
|---|---|---|---|
| 开发者工具模拟器 | 微信开发者工具「编译」 | 页面布局、主题、搜索、纯计算工具 | Skyline 下部分 Canvas / Worker / 传感器能力不可用 |
| 真机预览 / 真机调试 | 工具「预览」或「真机调试 2.0」 | Canvas、Worker、陀螺仪、相册、定位、专注 BGM | 需要扫码与真机授权 |
| CI 上传 | `npm run ci:upload` | 提审前的开发版本 | 只上传开发版，提审 / 发布仍需在 MP 后台完成 |

#### 14.10.2 日常开发命令

| 场景 | 命令 | 说明 |
|---|---|---|
| 首次克隆 / 换机 | `npm ci && npm ci --prefix subpackages/tools-core` | 根包与 tools-core 两套依赖都要装 |
| 改完 TS / 页面逻辑 | `npm run typecheck && npm test` | 提交前最低门禁 |
| 改了 `styles/tokens.css` 或 Tailwind 类 | `npm run build:style` | 重新生成 `styles/generated/tailwind.wxss` |
| 依赖变更后 | `npm ci`（或 `npm ci --prefix ...`）+ 开发者工具「构建 npm」 | 两处 `miniprogram_npm` 都要重建 |
| 构建后自检 | 执行 §14.3.8 的 `test -s/-d` 清单 | 产物缺失先补产物 |
| 版本一致性 | `npm run check:version` | 四源必须为同一版本 |
| 只跑专注引擎测试 | `npm run test:hologram` | 快速回归 FSM / 存储 |
| 只跑集成测试 | `npm run test:integration` | 含 `*.integration.test.js` |
| 视觉验收预检 | `npm run test:visual:hologram:dry` | 不启动开发者工具 |
| 视觉验收（已开 automator） | `npm run test:visual:hologram:connect` | 复用 `ws://127.0.0.1:9420` |
| 包体积预算 | `npm run budget` | 主包 1900KB 警戒线 |
| 工具清单 / 方案覆盖 | `npm run plan` | 校验 `EXPECT` 清单 |
| 上传开发版本 | `npm run ci:upload` | 自动构建 npm 并上传 |

#### 14.10.3 常见故障对照表

| 现象 | 可能原因 | 处理 |
|---|---|---|
| `--experimental-strip-types` 不识别的报错 | Node.js < 22.6 | 升级到 Node 22.6+（当前验证 `v24.19.0`） |
| 编译提示找不到 `weather/config.local` | 本地天气配置缺失 | 执行 `node scripts/ensure-weather-config.js`，或复制 `weather/config.example.ts` |
| 启动白屏 / `module is not defined` | `miniprogram_npm` 未构建 | 开发者工具「工具 → 构建 npm」，根包与 `subpackages/tools-core` 各构建一次，再重启工具 |
| Hash / 文本对比提示分包依赖缺失 | tools-core 依赖未安装或未构建 npm | `npm ci --prefix subpackages/tools-core`，再构建 tools-core 的 npm |
| Tailwind 类不生效 / 样式错乱 | `styles/generated/tailwind.wxss` 缺失或过期 | 执行 `npm run build:style` 后重新编译 |
| 首页工具数量或搜索异常 | 注册表与 `app.json` 路由不同步 | 以 `core/toolbox/registry.ts` 为准，检查 `scripts/check-plan.js` |
| Canvas 灰屏 / 海报空白 | Skyline 模拟器 Canvas 能力限制 | 先看控制台是否走离屏降级；最终以真机为准 |
| 选图 / 保存相册无反应 | 隐私授权或相册权限被拒绝 | 清除小程序缓存，重新触发隐私弹窗；检查 `privacy-guard` 与系统设置 |
| 天气显示「配置错误」 | 未填 Key / 用了小程序 Key / 域名未加白名单 | 使用高德 **Web 服务 Key**，并把 `https://restapi.amap.com` 加入 request 合法域名 |
| 真机定位失败 | 模糊定位权限被拒绝 / 低版本 | 允许定位；仍失败会降级 IP 与手动选城 |
| 专注 BGM 真机不响 | 后台音频未声明 / iOS 静音键 | 确认 `requiredBackgroundModes: ["audio"]`；关闭静音键；以真机验证 |
| 主包体积超限 | 大图或非业务文件误入主包 | 执行 `npm run budget`；检查 `project.config.json` 的 `packOptions.ignore`，资源迁入分包 |
| automator 连接失败 | 端口 9420 被占用 / 未开服务端口 | `lsof -i :9420` 结束占用进程，或在设置中开启服务端口 |
| `npm ci` 在 lightningcss 处失败 | 平台二进制缺失 / Node 版本不匹配 | 删除 `node_modules` 后重装；确认 macOS 架构与 Node 版本 |
| 开发者工具提示「主包未使用 JS 文件」 | DevTools 已知误报 | 按项目约定把共享模块下沉到对应分包，不使用忽略配置掩盖 |
| 更新弹窗不出现 | 页面处于阻塞态 / 其他页面持有弹窗锁 | 检查 `globalData.promptState`、`promptOwner`、`blockers` |
| `ci:upload` 报 `invalid ip` | 后台开启 IP 白名单 | 关闭白名单或使用固定出口 IP 的 runner |

> 排查顺序建议：先看开发者工具 Console 的第一条错误 → 再看 `diag:errors.v1` → 最后查 Storage 中的 `app:storage.version` 与业务键是否存在。绝大多数启动问题来自「未构建 npm」「Tailwind 未生成」「天气 Key 未配置」三类。

---

## 15. 测试与质量保障

### 15.1 测试构成

`npm test` 当前 **836 项全部通过**。

| 测试组 | 文件 | 覆盖主题 |
|---|---|---|
| 应用 / 更新 | `app-brightness`、`app-update`、`update-guard`、`update-guard-flow`、`privacy-update-blocker` | 启动亮度兜底、更新运行时、待更新标记、全局阻塞互斥 |
| 状态 / 存储 | `preference`、`font-scale`、`theme-engines`、`storage-governor`、`history`、`history-snapshots`、`export`、`budget`、`plan` | 偏好归一化、字号档三档与降级契约、主题引擎、自动清理、轨迹防抖、导出清理、体积与计划门禁 |
| 联网搜索 | `yuanbao-search`、`web-search-page` | 元宝搜索 Pages 解析 / 错误码 / Bearer 请求 / 网络失败 / 摘要、页面成功态 / 错误态 / Workflow 注入 |
| 注册 / 路由 / 搜索 | `tool-registry`、`subpackage-routing`、`magic-wand-palette`、`help-search`、`help-page` | 65 工具元数据、分包路由、指令面板、帮助搜索、帮助页单一 groups 渲染 |
| 工具算法 | `hash-engine`、`text-diff`、`money-engine`、`date-engine`、`text-engine`、`random-engine`、`tools-batch1`、`tools-ledger`、`tools-date-format`、`tools-timezone`、`tools-schedule`、`tools-fuel`、`tools-power`、`tools-resolution`、`tools-carloan`、`tools-quote`、`tools-meeting-timer`、`meeting-timer-service`、`tools-bodyfat`、`tools-avatar`、`tools-collage`、`tools-idphoto`、`tools-qrdecode`、`tools-lunar`、`tools-zh-convert`、`tools-pinyin`、`tools-fx-manual`、`tools-salary-inverse`、`tools-percent`、`tools-size-convert`、`tools-severance`、`tools-id-validate`、`tools-image-pdf`、`tools-barcode`、`tools-exif`、`tools-unit-extended`、`tools-password`、`tools-date-add`、`tools-color`、`tools-json-csv`、`tools-text-convert`、`tools-regex`、`tools-photo-edit`、`tools-worktime`、`tools-wellness`、`tools-random-pick`、`tools-vcard`、`span-watermark-workflow`、`watermark-gesture` | Hash/HMAC、Diff、金额分/基点、日期日序号与闰日、时区墙钟与手动夏令时、工作日推进、油耗与油费、阶梯电费、分辨率化简 / 打印像素、车贷月供 / 方案对比 / 提前还款、报价守恒与 CSV 转义、倒计时跨日与后台补算、体脂围度公式、拼图布局与跳过摘要、证件照纯色检测 / 换底 / 羽化 / 复杂背景拒绝、二维码 8 掩码 / 中文 / 模糊 / 截断、农历春节 / 闰月 / 节气 / 边界、简繁词组优先 / 一词多繁 / 方向切换 / 20k 截断、拼音多音词消歧 / 去声调 / 逐字对照 / 2k 截断、官方中间价解析 / 交叉汇率 / 缓存回退 / 手动牌价双向一致、个税月度 / 年度黄金值、薪资反算误差 / 边界 / 不收敛、百分比三模式 / 除零 / 1000% / silent 解析、日期加减月末 / 闰日 / 跨年 / 超范围 / silent 解析、颜色解析 / 黑白 21:1 / 红绿 / 3 位 HEX / 透明度忽略 / AA-AAA 阈值 / 色觉模拟、JSON 与 CSV 往返 / 字段并集 / 嵌套有损 / 引号换行 / 2MB、尺码男鞋 / 女装 / 戒指 / 半码 / 超范围、离职补偿 N / N+1 / 封顶 / 年假 / 年限 0、证件号身份证 / 银行卡 / 末位 X / 15 位旧证 / 超长 / 脱敏、PDF JPEG 解析 / 结构 / xref / 页面尺寸 / 9 页与 2MB、条形码 CODE128B 黄金值 / 校验位 / 静区 / 80 字符 / PNG 尺寸、图片信息尺寸 / 体积 / 格式 / 方向 / 损坏拒绝、单位扩展 13 类黄金值 / 解析格式化、文本转换与清洗四组合 / 空行 / 不可见 / 中文标点 / 中英文去空格 / 保留段落、密码强度阈值 / 空密码 / 熵公式、随机抽签、工具批测、算账、日期格式、文本转换卡、正则 Worker、图片几何、工时请假、每日健康、随机决定、vCard 折行、跨工具 Workflow、水印手势 |
| 全息专注 | `focus-fsm`、`focus-storage`、`focus-crypto`、`focus-level`、`focus-audio`、`focus-nebula`、`focus-page`、`focus-page-flow`、`focus-copy`、`cockpit-focus` | 状态机、6 键存储 / 验签、等级、音频、星云、页面流程、文案、驾驶舱专注卡 |
| 全息气象 | `weather-parse`、`weather-cache`、`weather-chart-audio`、`weather-astro-hourly`、`weather-page` | 字段解析、缓存 TTL、图表/音频、日出日落/逐小时、页面状态 |
| 和风天气 | `qweather` | 端点目录 / 图标映射 / 响应解析 / 缓存上限 / 凭据缺失 / 页面契约 / 城市本地日期 |
| 驾驶舱 / 设置 / 海报 / Cyber | `cockpit-chart`、`cockpit-page`、`settings-center`、`poster`、`cyber-space-os`、`canvas-galaxy-render` | 图表、页面、设置、海报、Cron/时间旅行/分片/AES/事件流、星系渲染 |
| 空间全息 | `spatial-hologram`、`spatial-hologram.integration` | 单测 + 集成 |
| 其他 | `glass-slider`、`privacy`、`feedback`、`share-deeplink`、`worker-regex`、`workflow-coverage` | 滑轨、脱敏、copyText 隐私链路、分享深链、Worker 正则、Workflow 全量覆盖 |

### 15.2 视觉与 E2E

| 脚本 | 产物 |
|---|---|
| `npm run test:visual:hologram` | `tests/visual/reports/spatial-<timestamp>/`：`summary.json`、Markdown 报告、PNG |
| `npm run test:e2e:palette` | 魔法棒指令面板端到端（9 项） |
| `npm run test:e2e` | 冒烟 42 卡路由与功能分支端到端（42/42；photo-edit / avatar / collage / id-photo / image-pdf / qr-decode 真机专属 SKIP） |

`tests/helpers/spatial-hologram-harness.js` 提供 Node 侧 `Component` / `wx` mock 与 TS 扩展名解析，供单测 / 集成复用。

### 15.3 质量门禁

| 门禁 | 命令 | 当前状态 |
|---|---|---|
| 类型检查 | `npm run typecheck` | 通过 |
| 单元 / 集成 | `npm test` | 836/836 通过 |
| 文字对比度 | `npm run check:contrast` | 通过（正文全绿，按钮 6 条 warning 设计债） |
| Workflow 覆盖率 | `tests/workflow-coverage.test.js` | 65 工具全部注册 / 适配器 / 来源 / 收发端；15 silent + 50 jump |
| 分包路由 | `tests/subpackage-routing.test.js` | 通过 |
| 视觉验收 | `npm run test:visual:hologram` | 需开发者工具 |
| 42 卡冒烟 E2E | `npm run test:e2e` | 42/42 通过（photo-edit / avatar / collage / id-photo / image-pdf / qr-decode 真机专属 SKIP） |
| CI 上传 | `npm run ci:upload` | 脚本、npm 构建、真实密钥上传已验证；v1.1.0 已上传成功 |
| GitHub Actions | `.github/workflows/miniprogram-ci.yml` | 标签 `v*` + 手动触发；端到端上传成功（v1.1.0） |

---

## 16. 扩展指南

### 16.1 新增一个工具

1. **注册元数据**：在 `core/toolbox/registry.ts` 的 `TOOLS` 中新增 `ToolMeta`。
2. **创建页面**：在 `subpackages/tools-core/pages/<id>/` 或 `tools-media` 下创建 `.ts / .json / .wxml / .wxss`。
3. **注册路由**：在 `app.json` 对应分包的 `pages` 中加入页面路径。
4. **使用工具壳**：页面 JSON 引入 `glass-tool-shell`，WXML 使用 `input` / `result` / `note` 插槽。
5. **页面状态**：维护 `shellState`（`idle / running / done / invalid / error`）、`hasResult`、`error`、`posterData`、`copyPayload`。
6. **实现计算**：纯函数优先；金额用分、利率用基点、日期用 `core/toolbox/engines/date.ts`。
7. **实现分享**：`onShareAppMessage` / `onShareTimeline` 调 `sharePayloadForCurrentPage()`。
8. **接入 Workflow**：
   - 扩展 `WorkflowToolId`；
   - 在 `WORKFLOW_ROUTING` / `WORKFLOW_ACCEPTS` 注册；
   - 在 `workflowSource.ts` 添加结果字段；
   - 如为 jump 目标，在 `workflowAdapters.ts` 添加适配器；
   - 页面实现 `onReceiveWorkflow(data)` 或 `recalculate()`。
9. **补帮助文案**：在 `subpackages/grow/lib/help.ts` 的 `HELP_ENTRIES` 增加 `summary / steps / tips / faq`（有契约测试保证全覆盖）。
10. **补测试与脚本**：更新 `tests/workflow-coverage.test.js`、工具自身测试，以及 `scripts/check-plan.js` 的 `EXPECT` 清单。
11. **同步文档**：首页 `toolTotal` 自动读取 `TOOLS.length`；但 Code Wiki / README 的工具清单必须同步，禁止写死数量。

### 16.2 新增一个页面

1. 在 `pages/` 或对应 `subpackages/` 下创建页面四件套。
2. 在 `app.json` 注册；分包页面加入对应 `subpackages[].pages`。
3. 在 `core/constants/index.ts` 的 `ROUTES` / `ROUTE_TITLES` 增加路由与标题（如需要）。
4. 实现 `onShareAppMessage` / `onShareTimeline`。
5. 根节点绑定 `uiStore.themeClass`；需要原生状态栏同步的页面在 `onShow` 调用 `uiStore.syncNativeChrome()`。
6. 挂载 `<update-guard />`（或使用 `glass-tool-shell`）。
7. 使用 `createStoreBindings` 时在 `onUnload` 销毁。
8. 异步数据加载使用 `destroyed` 标志 / 序列号。

### 16.3 新增一个组件

1. 在 `components/` 创建 `.ts / .json / .wxml / .wxss`。
2. `index.json` 设置 `component: true`；需要隔离时加 `virtualHost: true` 与 `styleIsolation`。
3. 需要消费全局主题令牌时使用 `styleIsolation: 'apply-shared'`。
4. 只使用 `--g-*` / `--glass-*` / `--sg-*` 令牌，禁止裸色值。
5. 定时器 / 监听器 / Canvas 在 `detached` 清理。
6. 在页面 JSON 的 `usingComponents` 注册，路径按页面层级计算。

### 16.4 新增一个 Store 或偏好

- 新 Store：放在 `core/stores/`，使用 `observable`，提供幂等 `init()` 与显式清理方法。
- 新偏好：在 `PreferenceSnapshot` 与 `DEFAULT_PREFERENCE` 加字段，并在 `normalizePreference` 做白名单归一化。
- 新 Feature Flag：在 `DEFAULT_PREFERENCE.flags` 增加键；`KNOWN_FLAGS` 自动派生。
- 新 Storage 键：优先使用现有命名空间；新增 `tbx:*` 时同步 `clearToolboxData()` 的清理语义。

### 16.5 新增一个 Workflow 目标

1. 更新 `WorkflowToolId`。
2. 更新 `WORKFLOW_ROUTING` 与 `WORKFLOW_ACCEPTS`。
3. 在 `workflowSource.ts` 增加来源字段（如果该工具也可作为来源）。
4. 在 `workflowAdapters.ts` 增加适配器；复杂表单优先暴露 `onReceiveWorkflow(data)`。
5. 在 `workflow-panel` 中确认 `workflowToolsForType` 能正确置灰 / 排序。
6. 更新 `tests/workflow-coverage.test.js`。

### 16.6 主题扩展

- 新语义色：在 `app.wxss` 的 `.theme-dark` / `.theme-light` 同时添加 `--g-*` 变量。
- 新玻璃材质：在 `--glass-*` 层添加，不直接写页面样式。
- 新环境光场景：在 `core/theme/ambient-theme.ts` 的 `PALETTES` 与 `CATEGORY_SCENE` 添加。
- 动画强度：通过 `useMotion()` 读取，不要在页面硬编码 `duration`。
- 对比度：使用 `ensureContrast()` 或 `contrastGuardian`，不要手写反色逻辑。

---

## 17. 已知限制与技术债

| 项 | 说明 | 影响 |
|---|---|---|
| 旧注释数量不一致 | 部分历史注释写“20 个工具”，当前注册表为 65 个 | 以 `core/toolbox/registry.ts` 为准 |
| `password` / `bmi` / `weather` 仅来源 | `WORKFLOW_ROUTING` 为 `jump`，但 `accepts` 为空 | 不能作为流转目标，面板中置灰 |
| 主包 `g-gallery` 保留 | 当前作品详情页使用 works / campus 分包副本 | 主包副本可能是历史资产 |
| 主包 `g-toast` 与 `glass-toast` 并存 | 旧简历页面仍使用 `g-toast` | 新页面统一使用 `glass-toast` |
| `styles/toolbox.wxss` 未引入 | `app.wxss` 只引入 Tailwind 与 `styles/v3.wxss` | 旧 `tbx_*` 样式可能仅在 `.legacy` 或历史页面中生效 |
| 开发者工具 Canvas 限制 | Skyline 模拟器不支持 `<canvas>` 的场景 | 九宫格 / 取色 / 名片 / 海报需真机或离屏兜底 |
| Worker 单实例 | 微信平台同一时刻仅 1 个 Worker | 高并发任务排队 / 降级主线程 |
| `@ts-nocheck` | `subpackages/tools-media/lib/qrcode.ts` 为第三方库 | 不参与严格类型检查 |
| 联网工具 | `weather` 依赖高德 Web 服务 Key 与白名单域名；`qweather` 依赖和风天气 API Host 与 JWT / API KEY；`fx-manual` 依赖 CFETS 域名；`web-search` 依赖腾讯云 WSA 域名与凭据 | 未配置时只显示配置错误 / 回退手动牌价 / 明确错误文案，不伪造数据 |
| 字体产物手工同步 | `build:icon` 只生成 `.icon-dist/`，`font.wxss` 需手动内嵌 | 新增图标需同步码位与 base64 |

---

## 18. 附录

### 18.1 路由表

| 路由 | 页面 | 包 |
|---|---|---|
| `/pages/index/index` | 工具箱首页 | 主包 |
| `/subpackages/tools-core/pages/lab/index` | 组件样板间 | tools-core |
| `/pages/favorites/index` | 收藏 | 主包 |
| `/pages/mine/index` | 我的 | 主包 |
| `/subpackages/grow/pages/legal/index` | 隐私与说明 | grow |
| `/subpackages/tools-core/pages/unit/index` | 单位换算 | tools-core |
| `/subpackages/tools-core/pages/tax/index` | 个税计算 | tools-core |
| `/subpackages/tools-core/pages/loan/index` | 房贷试算 | tools-core |
| `/subpackages/tools-core/pages/deposit/index` | 存款复利 | tools-core |
| `/subpackages/tools-core/pages/radix/index` | 进制转换 | tools-core |
| `/subpackages/tools-core/pages/date-format/index` | 日期格式 | tools-core |
| `/subpackages/tools-core/pages/date-add/index` | 日期加减 | tools-core |
| `/subpackages/tools-core/pages/color/index` | 颜色转换 | tools-core |
| `/subpackages/tools-core/pages/json-csv/index` | JSON ↔ CSV | tools-core |
| `/subpackages/tools-daily/pages/size-convert/index` | 尺码换算 | tools-daily |
| `/subpackages/tools-daily/pages/severance/index` | 离职补偿 | tools-daily |
| `/subpackages/tools-daily/pages/id-validate/index` | 证件号校验 | tools-daily |
| `/subpackages/tools-media/pages/image-pdf/index` | 图片转 PDF | tools-media |
| `/subpackages/tools-media/pages/barcode/index` | 条形码生成 | tools-media |
| `/subpackages/tools-media/pages/exif/index` | 图片信息 | tools-media |
| `/subpackages/tools-core/pages/timezone/index` | 时区换算 | tools-core |
| `/subpackages/tools-core/pages/schedule/index` | 工期排期 | tools-core |
| `/subpackages/tools-core/pages/text-convert/index` | 文本转换 | tools-core |
| `/subpackages/tools-core/pages/template/index` | 模板填充 | tools-core |
| `/subpackages/tools-core/pages/regex/index` | 正则测试 | tools-core |
| `/subpackages/tools-core/pages/span/index` | 日期间隔 | tools-core |
| `/subpackages/tools-core/pages/age/index` | 年龄周岁 | tools-core |
| `/subpackages/tools-core/pages/countdown/index` | 倒数日 | tools-core |
| `/subpackages/tools-core/pages/timestamp/index` | 时间戳 | tools-core |
| `/subpackages/tools-core/pages/rmb/index` | 金额大写 | tools-core |
| `/subpackages/tools-core/pages/wordcount/index` | 字数统计 | tools-core |
| `/subpackages/tools-core/pages/text-diff/index` | 文本对比 | tools-core |
| `/subpackages/tools-core/pages/hash/index` | Hash 加密 | tools-core |
| `/subpackages/tools-core/pages/dedupe/index` | 去重排序 | tools-core |
| `/subpackages/tools-core/pages/json/index` | JSON 格式化 | tools-core |
| `/subpackages/tools-core/pages/url/index` | URL 编解码 | tools-core |
| `/subpackages/tools-core/pages/base64/index` | Base64 | tools-core |
| `/subpackages/tools-core/pages/password/index` | 随机密码 | tools-core |
| `/subpackages/tools-core/pages/bmi/index` | BMI 指数 | tools-core |
| `/subpackages/tools-core/pages/weather/index` | 全息气象 | tools-core |
| `/subpackages/tools-core/pages/web-search/index` | 元宝搜索 | tools-core |
| `/subpackages/tools-daily/pages/ledger/index` | 算账助手 | tools-daily |
| `/subpackages/tools-daily/pages/fuel/index` | 油耗计算 | tools-daily |
| `/subpackages/tools-daily/pages/power/index` | 水电燃气费 | tools-daily |
| `/subpackages/tools-daily/pages/resolution/index` | 分辨率与比例 | tools-daily |
| `/subpackages/tools-daily/pages/carloan/index` | 车贷计算 | tools-daily |
| `/subpackages/tools-daily/pages/quote/index` | 报价单 | tools-daily |
| `/subpackages/tools-daily/pages/meeting-timer/index` | 会议倒计时 | tools-daily |
| `/subpackages/tools-daily/pages/bodyfat/index` | 体脂率 | tools-daily |
| `/subpackages/tools-daily/pages/worktime/index` | 工时与请假 | tools-daily |
| `/subpackages/tools-daily/pages/wellness/index` | 每日健康 | tools-daily |
| `/subpackages/tools-daily/pages/random-pick/index` | 随机决定 | tools-daily |
| `/subpackages/tools-media/pages/photo-edit/index` | 图片编辑 | tools-media |
| `/subpackages/tools-media/pages/avatar/index` | 圆角头像 | tools-media |
| `/subpackages/tools-media/pages/collage/index` | 拼图与长图 | tools-media |
| `/subpackages/tools-media/pages/id-photo/index` | 证件照换底 | tools-media |
| `/subpackages/tools-media/pages/qr-decode/index` | 二维码识别 | tools-media |
| `/subpackages/tools-dict/pages/lunar/index` | 农历与节气 | tools-dict |
| `/subpackages/tools-dict/pages/zh-convert/index` | 简繁转换 | tools-dict |
| `/subpackages/tools-dict/pages/pinyin/index` | 拼音标注 | tools-dict |
| `/subpackages/tools-daily/pages/fx-manual/index` | 汇率换算 | tools-daily |
| `/subpackages/tools-daily/pages/salary-inverse/index` | 薪资反算 | tools-daily |
| `/subpackages/tools-daily/pages/percent/index` | 百分比计算 | tools-daily |
| `/subpackages/tools-media/pages/compress/index` | 图片压缩 | tools-media |
| `/subpackages/tools-media/pages/palette/index` | 图片取色 | tools-media |
| `/subpackages/tools-media/pages/nine-grid/index` | 九宫格切图 | tools-media |
| `/subpackages/tools-media/pages/qr/index` | 二维码生成 | tools-media |
| `/subpackages/tools-media/pages/vcard/index` | 二维码名片 | tools-media |
| `/subpackages/tools-media/pages/watermark/index` | 水印工作台 | tools-media |
| `/subpackages/grow/pages/home/index` | 简历首页 | grow |
| `/subpackages/grow/pages/greeting/index` | 问候序厅 | grow |
| `/subpackages/grow/pages/profile/index` | 个人简介 | grow |
| `/subpackages/grow/pages/about/index` | 关于我 | grow |
| `/subpackages/grow/pages/skills/index` | 技能矩阵 | grow |
| `/subpackages/grow/pages/settings/index` | 全局设置 | grow |
| `/subpackages/grow/pages/cockpit/index` | 数据驾驶舱 | grow |
| `/subpackages/grow/pages/help/index` | 使用指南 | grow |
| `/subpackages/life/pages/focus/index` | 全息专注引擎 | life |
| `/subpackages/works/pages/hub/index` | 作品宇宙 | works |
| `/subpackages/works/pages/list/index` | 作品列表 | works |
| `/subpackages/works/pages/detail/index` | 作品详情 | works |
| `/subpackages/campus/pages/detail/index` | 园枢详情 | campus |
| `/subpackages/weather/pages/home/index` | 和风天气 | weather |

### 18.2 核心常量速查

| 常量 | 值 | 来源 |
|---|---|---|
| `APP_VERSION` | `1.2.0` | `core/constants/index.ts` |
| `TIMING.HOME_SEARCH_DEBOUNCE` | 160ms | `core/constants/index.ts` |
| `TIMING.WORKS_SEARCH_DEBOUNCE` | 200ms | `core/constants/index.ts` |
| `TIMING.TOAST_DURATION` | 2200ms | `core/constants/index.ts` |
| `TIMING.TOOL_SCROLL_RESET` | 500ms | `core/constants/index.ts` |
| `TIMING.THEME_TRANSITION` | 420ms | `core/constants/index.ts` |
| `LIMITS.TEXT_INPUT` | 20000 字符 | `core/constants/index.ts` |
| `LIMITS.MEDIA_SOURCE_BYTES` | 50MB | `core/constants/index.ts` |
| `MAX_FAVORITES` | 100 | `core/toolbox/storage.ts` |
| `MAX_RECENTS` | 12 | `core/toolbox/storage.ts` |
| `HISTORY_MAX` | 100 | `core/stores/history.ts` |
| `WORKFLOW_MAX_BYTES` | 50KB | `core/workflow/workflowStore.ts` |
| `WORKFLOW_SESSION_TTL_MS` | 5 分钟 | `core/workflow/workflowStore.ts` |
| `WORKFLOW_MAX_PIPELINE_STEPS` | 4 | `core/workflow/workflowStore.ts` |
| `WORKFLOW_MAX_HISTORY` | 8 | `core/workflow/workflowStore.ts` |
| `WORKFLOW_MAX_QUICK_PIPES` | 6 | `core/workflow/workflowStore.ts` |
| `MAX_HASH_CHARS` | 100000 | `subpackages/tools-core/utils/hashEngine.ts` |
| `MAX_SOURCE_EDGE` | 2000 | `subpackages/tools-media/pages/watermark/index.ts` |
| `EXPORT_MAX_EDGE` | 3200 | `subpackages/tools-media/pages/watermark/index.ts` |
| `HISTORY_LIMIT` | 40 | `subpackages/tools-media/pages/watermark/index.ts` |
| `MAX_RADIX_DIGITS` | 128 | `subpackages/tools-core/lib/radix.ts` |
| `MAX_LEDGER_CENTS` | 100,000,000 分 | `subpackages/tools-daily/lib/ledger.ts` |
| `LIVE_TTL_MS` / `FORECAST_TTL_MS` | 15min / 30min | `subpackages/tools-core/weather/weatherCache.ts` |
| `NEGATIVE_TTL_MS` / `MAX_CITIES` | 60s / 5 | `subpackages/tools-core/weather/weatherCache.ts` |
| `WEATHER_TIMEOUT_MS` | 8000ms | `subpackages/tools-core/weather/weatherService.ts` |
| `FOCUS_DURATION_MS` | 25min | `subpackages/life/lib/focus-fsm.ts` |
| `SHORT_BREAK_MS` / `LONG_BREAK_MS` | 5min / 15min | `subpackages/life/lib/focus-fsm.ts` |
| `OVERHEAT_THRESHOLD_MS` / `OVERHEAT_LOCK_MS` | 2h / 30min | `subpackages/life/lib/focus-fsm.ts` |
| `FOCUS_LEDGER_MAX` | 50 | `subpackages/life/lib/focus-storage.ts` |
| `LEVEL_THRESHOLDS_MS` | 0 / 2h / 8h / 20h / 50h / 100h | `subpackages/life/lib/focus-level.ts` |

### 18.3 关键文件索引

| 文件 | 说明 |
|---|---|
| `app.ts` | 启动编排 |
| `app.json` | 页面 / 分包 / TabBar / Skyline / Worker |
| `core/toolbox/registry.ts` | 65 工具注册表 |
| `core/toolbox/quotes.ts` | 工具页页脚短语与去重随机 |
| `core/toolbox/searchHistory.ts` | 首页搜索历史（最多 8 条） |
| `core/toolbox/privacy.ts` | 轨迹脱敏 |
| `core/toolbox/tool-session.ts` | 工具会话层 |
| `core/toolbox/favorites-sort.ts` | 收藏页排序纯函数 |
| `core/toolbox/store.ts` | 收藏 / 最近使用 |
| `core/stores/ui.ts` | 主题状态机 |
| `core/stores/preference.ts` | 全局偏好 |
| `core/stores/history.ts` | 计算轨迹 |
| `core/stores/resume.ts` | 简历域状态 |
| `core/stores/privacy.ts` | 隐私授权 |
| `core/stores/deeplink.ts` | 分享深链 |
| `core/workflow/workflowStore.ts` | 流转会话 / 流水线 / 撤销 |
| `core/workflow/workflowConfig.ts` | 流转路由与类型兼容 |
| `core/workflow/workflowSilent.ts` | 静默执行器 |
| `core/workflow/workflowSource.ts` | 结果字段提取 |
| `core/workflow/workflowAdapters.ts` | 目标页适配器 |
| `core/theme/ambient-theme.ts` | 环境光引擎 |
| `core/theme/contrast-guardian.ts` | 对比度守护 |
| `components/glass-tool-shell/index.ts` | 工具页骨架 |
| `subpackages/grow/pages/settings/index.ts` | 全局设置：偏好、存储、备份与恢复、驾驶舱、专注入口、Cyber Space OS |
| `subpackages/grow/lib/backup.ts` | 本机 JSON 备份：导出 / 校验 / 原子导入 / 删除 |
| `subpackages/grow/lib/diagnostics.ts` | 本地诊断包：脱敏 / 预览 / 生成 `.txt` |
| `components/glass-toast/toast.ts` | 全局 Toast |
| `components/command-palette/palette.ts` | 指令面板 |
| `components/update-guard/index.ts` | 更新守卫 |
| `components/workflow-panel/index.ts` | 流转面板 |
| `components/workflow-receiver/index.ts` | 目标页接收器 |
| `components/poster-generator/index.ts` | 海报绘制 |
| `core/toolbox/engines/money.ts` | 金额 / 利率唯一实现（tools-core / tools-daily 薄 re-export） |
| `core/toolbox/engines/tax.ts` | 个税唯一实现：月度 / 年度 7 级税率、速算扣除、`calcTax`；tax 页与 salary-inverse 共用 |
| `subpackages/tools-core/lib/money.ts` | 金额 / 利率兼容出口 |
| `core/toolbox/engines/date.ts` | 日期唯一实现（tools-core / 后续跨分包共享） |
| `subpackages/tools-core/lib/timezone-engine.ts` | 时区唯一实现：固定偏移换算、跨日 / 跨年、手动夏令时；`worldClock` 多城市同屏，`WORLD_CLOCK_CITY_IDS` 内置 8 城 |
| `core/toolbox/engines/color.ts` | 颜色唯一实现：HEX / RGB / HSL 互转、WCAG 对比度、AA/AAA、Machado 色觉模拟 |
| `core/toolbox/engines/csv.ts` | CSV 唯一实现：转义 / 公式注入防护 / `jsonToCsv` / `csvToJson` / 可选 BOM；quote 与 json-csv 共用 |
| `subpackages/tools-daily/lib/size.ts` | 尺码唯一实现：鞋码 / 服装 / 戒指 / 半码与范围校验 |
| `subpackages/tools-daily/lib/severance.ts` | 离职补偿唯一实现：N/N+1、年限折算、社平封顶、年假 200% |
| `subpackages/tools-daily/lib/id.ts` | 证件号唯一实现：身份证加权校验 + 生日 / 性别、银行卡 Luhn、脱敏摘要 |
| `subpackages/tools-media/lib/pdf.ts` | PDF 唯一实现：JPEG SOF 解析、PDF 1.4 组装、xref、A4 / Letter / 原图、9 页 / 2MB |
| `subpackages/tools-media/lib/barcode.ts` | CODE128B 唯一实现：107 项码表、校验位、静区、80 字符上限；1-bit PNG 复用 `subpackages/tools-media/lib/png.ts` |
| `subpackages/tools-media/lib/exif.ts` | 图片信息唯一实现：尺寸 / 体积 / 格式 / 方向 / 宽高比 / 万像素；不解析隐私字段 |
| `subpackages/tools-core/lib/units.ts` | 单位换算唯一实现：13 类单位、浮点因子、分类目录 |
| `subpackages/tools-core/lib/base64.ts` | Base64 唯一实现：文本 UTF-8 / URL-safe 编解码、`imageToBase64`、2MB 上限、MIME 与 data URL |
| `core/toolbox/engines/text.ts` | 文本转换唯一实现（页面 + silent 执行器共用；含 `cleanText` 清洗） |
| `subpackages/tools-core/lib/password.ts` | 密码强度唯一实现：`passwordEntropy`、`strengthLevel`（弱 / 中 / 强 / 空密码） |
| `core/toolbox/engines/random.ts` | 随机唯一实现：抽签 / 随机数 / 骰子 / 硬币（页面 + silent 执行器共用） |
| `subpackages/tools-core/lib/date.ts` | 日期引擎兼容出口（薄 re-export） |
| `subpackages/tools-core/lib/rmb.ts` | 人民币大写 |
| `subpackages/tools-core/lib/radix.ts` | 进制大数引擎 |
| `subpackages/tools-core/weather/weatherService.ts` | 高德 REST 唯一网络入口 |
| `subpackages/tools-core/weather/weatherCache.ts` | 天气缓存 / 城市表 |
| `subpackages/tools-core/weather/weatherCode.ts` | 现象码 → 家族 / 文案 / 环境光场景 |
| `subpackages/tools-core/weather/weatherAudio.ts` | `WeatherAmbientAudio`：WebAudio 环境音合成 |
| `subpackages/tools-core/weather/weatherDiagnostics.ts` | `WeatherRequestLog` 与诊断文本构建 |
| `subpackages/weather/pages/home/index.ts` | 和风天气页面壳：只保留分享、Workflow 与 summary / blocked 状态 |
| `subpackages/weather/components/qw-screen/index.ts` | 和风天气主屏：7 Tab、城市 / API 抽屉、缓存、请求序列号与全部数据编排 |
| `subpackages/weather/lib/qweather/endpoints.ts` | 20 个端点构造器 / 27 个范围变体与 TTL |
| `subpackages/weather/lib/qweather/client.ts` | JWT / API KEY 双认证、12s 超时、可 abort、错误映射 |
| `subpackages/weather/lib/qweather/service.ts` | 组合加载、缓存、v1 / v7 合并、同端点重复自检取消 |
| `subpackages/weather/lib/qweather/parse.ts` | 响应归一化、城市本地日期、缺失值与 `9999` 图标回退 |
| `subpackages/weather/lib/qweather/cache.ts` | 单键 40 条 / 650KB 上限 / 跨本地自然日失效 |
| `subpackages/tools-daily/lib/ledger.ts` | 算账助手算法 |
| `subpackages/tools-daily/lib/fuel.ts` | 油耗：百公里油耗 / 每公里油费 / 里程复核阈值 |
| `subpackages/tools-daily/lib/carloan.ts` | 车贷：复用 `planLoan` 的双方案、首付比例 / 金额、提前还款 |
| `subpackages/tools-daily/lib/bodyfat.ts` | 体脂率：海军围度公式、区间分类与极端值复核 |
| `subpackages/tools-daily/lib/quote.ts` | 报价单：行小计守恒、优惠先于计税、上限 50 行、CSV |
| `subpackages/life/lib/focus-fsm.ts` | 专注状态机 |
| `subpackages/life/lib/focus-audio.ts` | 专注 BGM：16kHz 噪声采样 / 3 轨 / 淡入淡出 |
| `subpackages/life/lib/focus-types.ts` | 专注领域类型契约 |
| `subpackages/life/lib/focus-crypto.ts` | 专注存证：SHA-256 / HMAC / canonical 签名 |
| `subpackages/life/lib/focus-storage.ts` | 专注 6 键存储 / 验签 / 幂等结算 |
| `subpackages/life/lib/focus-level.ts` | 专注等级 / 连续天数 |
| `subpackages/life/lib/focus-nebula.ts` | 星云战报渲染 |
| `subpackages/grow/lib/help.ts` | 65 工具帮助文案 |
| `subpackages/tools-daily/lib/worktime.ts` | 工时 / 加班费 / 请假天数 |
| `subpackages/tools-daily/lib/wellness.ts` | 饮水 / 热量 / 保质期 |
| `subpackages/tools-daily/lib/random.ts` | 随机抽签兼容出口 |
| `subpackages/tools-daily/lib/fx.ts` | 汇率换算：8 币种 / CFETS 中间价解析 / 交叉汇率 / 牌价解析 / 双向换算 / 日期提醒 / 摘要 |
| `subpackages/tools-daily/lib/fx-official.ts` | 官方中间价服务：CFETS 请求 / 6 小时缓存 / stale 回退 |
| `subpackages/tools-daily/lib/salary.ts` | 薪资反算：目标到手 / 五险一金 / 专项附加 / 二分逼近 / 正算校验 / 摘要 |
| `core/toolbox/engines/percent.ts` | 百分比唯一实现：占比 / 增减幅 / 配比 / GCD / silent 文本解析 |
| `subpackages/tools-daily/lib/percent.ts` | 百分比兼容出口（薄 re-export） |
| `core/services/worker.ts` | Worker 沙箱（单例 / 握手 / 超时） |
| `subpackages/tools-media/lib/geometry.ts` | 图片编辑几何（裁剪 / 旋转 / 钳制 / 补白） |
| `subpackages/tools-media/lib/canvas.ts` | Canvas 重绘 / 导出 / 清理 / 选节点 |
| `subpackages/tools-media/lib/avatar.ts` | 头像中心裁切 / 圆角半径 / 输出尺寸 / 透明判定 |
| `subpackages/tools-media/lib/collage.ts` | 拼图模板布局 / 容量 / 间距 / 4096 长边 / 跳过摘要 |
| `subpackages/tools-media/lib/idphoto.ts` | 证件照换底：背景色簇 / YCbCr 漫水 / 肩部保护 / 边缘保护 / Alpha 羽化 / 1200 长边 |
| `subpackages/tools-media/lib/qrdecode.ts` | 二维码解码封装：尺寸钳制 / jsQR 调用 / 长文截断 / 类型标签 |
| `subpackages/tools-media/lib/qrdecode-vendor.ts` | jsQR 1.4.0 vendor（Apache-2.0，130,747B） |
| `subpackages/tools-dict/lib/lunar-data.ts` | solarlunar 3.1.0 vendor（ISC，28,994B）：农历表 / 节气 / 换算 |
| `subpackages/tools-dict/lib/lunar.ts` | 农历封装：范围 / 生肖 / 节气 / 节日 / 日期解析 / `lunarBirthday` 生日倒计时 |
| `subpackages/tools-dict/lib/zh-data.ts` | OpenCC 1.4.2 提取词库：简→繁 3,881 字 / 5,000 词，繁→简 3,512 字 / 5,000 词 |
| `subpackages/tools-dict/lib/zh.ts` | 简繁转换：最长匹配 / 字符兜底 / 一词多繁 / 20k 截断 |
| `subpackages/tools-dict/lib/pinyin-data.ts` | pinyin-pro 3.29.5 生成词库：8,000 字 / 1,050 多音词 |
| `subpackages/tools-dict/lib/pinyin.ts` | 拼音标注：词组消歧 / 去声调 / 逐字对照 / 2k 截断 |
| `subpackages/tools-dict/lib/ui.ts` | tools-dict 反馈兼容出口（copyText / toast） |
| `subpackages/tools-media/lib/vcard.ts` | vCard 3.0 转义 / 折行 / 字节预算 |
| `subpackages/tools-media/lib/card.ts` | 图片名片 Canvas 渲染（1080×672、二维码内嵌） |
| `subpackages/tools-media/lib/qrcode.ts` | 二维码编码 |
| `subpackages/grow/utils/timeTravelEngine.ts` | 时间旅行 / 快照 |
| `subpackages/grow/utils/cronParser.ts` | Cron 调度 |
| `subpackages/grow/utils/slicedTransfer.ts` | 分片传输 |
| `subpackages/grow/utils/aesVault.ts` | AES 保险箱 |
| `subpackages/grow/utils/canvasGalaxy.ts` | `GalaxyEngine`：节点 / 粒子 / 文字矩形 / `buildGalaxyNodes` 数据构建 |
| `subpackages/grow/lib/cockpit-chart.ts` | 驾驶舱图表 |
| `subpackages/tools-core/utils/diffToRichText.ts` | Diff 分段 → `rich-text` 节点与高亮 |
| `subpackages/tools-core/lib/timezone.ts` | 时区薄 re-export（唯一实现 `subpackages/tools-core/lib/timezone-engine.ts`） |
| `workers/compute.js` | Worker 入口 |
| `scripts/ci-upload.js` | miniprogram-ci 自动上传脚本 |
| `.github/workflows/miniprogram-ci.yml` | GitHub Actions 自动上传流水线 |

### 18.4 术语表

| 术语 | 含义 |
|---|---|
| 白昼 | 浅色主题 `light` |
| 夜航 | 深色主题 `dark` |
| 极光 | 动态渐变光效 / 海报视觉 |
| 液态玻璃 | `--glass-*` 材质体系 |
| Spatial Glass | `--sg-*` 空间玻璃体系 |
| Workflow | 工具间结果流转引擎 |
| silent | 面板内纯函数计算，不跳页 |
| jump | `navigateTo` 带参跳转，目标页注入 |
| 注入撤销 | 字段级回滚注入与自动计算结果 |
| 快捷管道 | 成功流转两次以上后记忆的 A → B 组合 |
| 轨迹 | `tbx:history` 中的本机计算摘要 |
| 隐私盾 | 驾驶舱默认脱敏显示 |
| Auto-Pilot | 设置页 Cron 自动任务 |
| Time Travel | 状态快照与回滚 |
| 分片传输 | 通过剪贴板分段传输长文本 |
| 冷备保险箱 | AES-256-CBC 加密备份 |
| 黑匣子 | `diag:errors.v1` 本地错误记录 |
| 全息专注引擎 | `subpackages/life` 的 25 分钟心流 + 星云战报系统 |
| Overheat | 连续专注 2h 触发的 30min 强制冷却 |
| Glitch | 专注期间破功的视觉抖动，只记 breach 不暂停 |
| 星云战报 | 专注结束后按 record.seed 生成的确定性星云海报 |
| 存证签名 | `focus:*` 数据的 HMAC-SHA256 签名，用于防篡改 / 幂等结算 |
| 全息气象站 | 联网工具之一，高德 Web 服务实况 + 4 天预报 |
| 和风天气 | 联网工具之一，独立分包 `subpackages/weather`，8 组 API / 27 个端点 / 7 Tab |
| 汇率换算 | 联网工具之一，CFETS 官方人民币汇率中间价 + 手动回退 |
| 模糊定位 | `wx.getFuzzyLocation` 城市级定位，不申请精确坐标 |
| adcode | 高德 6 位行政区编码，天气缓存的唯一城市键 |

### 18.5 文档覆盖核对

以下为本次文档自查的静态扫描结果：

| 核对项 | 结果 |
|---|---|
| 页面路由 | 83 / 83，全部在 10.1–10.7 与 18.1 中列出 |
| 主包组件 | 29 / 29，全部在 9.1 中列出 |
| 分包组件 | 27 / 27，全部在 9.10 中列出 |
| 工具 | 65 / 65，全部在 6.1 与 8.4 中列出 |
| `core/` TypeScript 模块 | 77 / 77，均在 5.x、6.x、7.x、8.x、11.x、12.x 或 5.11 中出现 |
| `subpackages/` TypeScript 模块 | 212 / 212，页面 / 组件在 10.x、9.10 中按路由列出，lib / utils / weather 在 8.x、5.11、18.3 中说明 |
| 测试文件 | 111 个 `.test.js`；`npm test` 836 项通过 |
| 运行时依赖 | 根包 2 个 + tools-core 2 个，均在 2.1 / 13.2 中列出 |
| 配置文件 | `app.json`、`app.ts`、`theme.json`、`project.config.json`、`project.private.config.json`、`tsconfig.json`、`package.json`、`postcss.config.js`、`sitemap.json` |
| 存储键 | 46 个运行期键条目（含 `weather:*` / `qweather:*` 动态后缀），见 12.1 |
| Workflow 工具 | 65 个工具均有路由 / accepts 配置；15 个 silent、50 个 jump；`password` / `bmi` / `weather` / `worktime` / `wellness` / `vcard` 仅作为来源 |

自查口径：

- 以 `app.json` 的页面 / 分包列表为准统计路由。
- 以 `components/*/index.json` 与 `subpackages/*/components/*/index.json` 统计组件。
- 以 `core/toolbox/registry.ts` 的 `TOOLS` 统计工具。
- 以 `find core -name '*.ts'` 统计核心模块。
- 以 `tests/*.test.js` 与 `npm test` 输出统计测试。
- 运行时行为、构建结果与真机表现仍以源码和实际执行为准。

---

> 本文档按当前工作区源码重写；如代码与文档冲突，以源码为准。建议在每次架构级变更后同步更新本文件与 `APP_VERSION`。
