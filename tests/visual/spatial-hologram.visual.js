/* ==========================================================================
   spatial-hologram 视觉验收脚本
   - 自动临时注入测试页 pages/__visual_spatial__，不修改正式页面
   - 通过 miniprogram-automator 启动微信开发者工具，切换 5 个视觉状态并截图
   - 生成 Markdown 报告 + summary.json + PNG 截图
   - 缺少开发者工具 / 未开启服务端口时生成 BLOCKED 报告，不静默失败
   - 支持 --dry-run：只注入、校验、生成准备报告，然后恢复项目
   - 运行：npm run test:visual:hologram
   - 预检：npm run test:visual:hologram:dry
   ========================================================================== */
const fs = require('node:fs')
const path = require('node:path')

const PROJECT_ROOT = path.resolve(__dirname, '../..')
const FIXTURE_DIR = path.join(__dirname, 'fixtures/spatial')
const PAGE_DIR = path.join(PROJECT_ROOT, 'pages/__visual_spatial__')
const PAGE_PATH = 'pages/__visual_spatial__/index'
const PAGE_URL = '/pages/__visual_spatial__/index'
const APP_JSON = path.join(PROJECT_ROOT, 'app.json')
const REPORT_ROOT = path.join(__dirname, 'reports')
const DRY_RUN = process.argv.includes('--dry-run')
/* 连接模式：复用已开启自动化端口的开发者工具（Skyline 下 launch/reLaunch 会丢页面元信息） */
const CONNECT_WS =
  process.env.WECHAT_AUTOMATOR_WS ||
  (process.argv.includes('--connect') ? 'ws://127.0.0.1:9420' : '')

const CASES = [
  {
    id: '01-light-aurora-decor',
    theme: 'light',
    aurora: true,
    decor: true,
    note: '浅色 / 内置极光 / 自定义背光与徽章',
  },
  {
    id: '02-dark-aurora-decor',
    theme: 'dark',
    aurora: true,
    decor: true,
    note: '深色 / 内置极光 / 自定义背光与徽章',
  },
  {
    id: '03-light-aurora-plain',
    theme: 'light',
    aurora: true,
    decor: false,
    note: '浅色 / 内置极光 / 无自定义装饰',
  },
  {
    id: '04-light-no-aurora',
    theme: 'light',
    aurora: false,
    decor: true,
    note: '浅色 / 关闭内置极光 / 仅自定义装饰',
  },
  {
    id: '05-dark-minimal',
    theme: 'dark',
    aurora: false,
    decor: false,
    note: '深色 / 关闭内置极光 / 无自定义装饰',
  },
]

function countTags(source, tag) {
  const open = (source.match(new RegExp(`<${tag}(?=[\\s/>])`, 'g')) || []).length
  const close = (source.match(new RegExp(`</${tag}>`, 'g')) || []).length
  return { open, close }
}

function validateFixture() {
  const pageJsonPath = path.join(FIXTURE_DIR, 'index.json')
  const pageWxmlPath = path.join(FIXTURE_DIR, 'index.wxml')
  const pageWxssPath = path.join(FIXTURE_DIR, 'index.wxss')

  const pageJson = JSON.parse(fs.readFileSync(pageJsonPath, 'utf8'))
  const wxml = fs.readFileSync(pageWxmlPath, 'utf8')
  const wxss = fs.readFileSync(pageWxssPath, 'utf8')

  const requiredComponents = ['spatial-hologram', 'glass-card', 'animated-number']
  const components = pageJson.usingComponents || {}
  requiredComponents.forEach((name) => {
    if (!components[name]) {
      throw new Error(`测试页缺少组件注册：${name}`)
    }
  })

  requiredComponents.forEach((name) => {
    if (!wxml.includes(`<${name}`)) {
      throw new Error(`测试页 WXML 缺少组件：${name}`)
    }
  })

  Object.keys(components).forEach((name) => {
    const target = path.resolve(PAGE_DIR, `${components[name]}.json`)
    if (!fs.existsSync(target)) {
      throw new Error(`组件注册路径不存在：${name} -> ${components[name]}`)
    }
  })

  const views = countTags(wxml, 'view')
  if (views.open !== views.close) {
    throw new Error(`测试页 view 标签不闭合：${views.open} / ${views.close}`)
  }

  if (!wxss.includes('.visual-page')) {
    throw new Error('测试页 WXSS 缺少 .visual-page')
  }

  const postcss = require('postcss')
  postcss.parse(wxss, { from: pageWxssPath })

  return {
    pageJson,
    components: requiredComponents,
    viewTags: views,
  }
}

function prepareVisualPage(asEntry) {
  if (!fs.existsSync(FIXTURE_DIR)) {
    throw new Error(`未找到视觉验收 fixture：${FIXTURE_DIR}`)
  }

  const backup = fs.readFileSync(APP_JSON, 'utf8')
  const appConfig = JSON.parse(backup)
  const pages = Array.isArray(appConfig.pages) ? appConfig.pages.slice() : []

  if (!pages.includes(PAGE_PATH)) {
    /* 连接模式下无法通过 automator 导航 Skyline 页面，改为临时作为启动页 */
    if (asEntry) {
      pages.unshift(PAGE_PATH)
    } else {
      pages.push(PAGE_PATH)
    }
  }
  appConfig.pages = pages

  if (fs.existsSync(PAGE_DIR)) {
    fs.rmSync(PAGE_DIR, { recursive: true, force: true })
  }
  fs.mkdirSync(PAGE_DIR, { recursive: true })

  const files = ['index.js', 'index.json', 'index.wxml', 'index.wxss']
  files.forEach((file) => {
    fs.copyFileSync(path.join(FIXTURE_DIR, file), path.join(PAGE_DIR, file))
  })

  fs.writeFileSync(APP_JSON, `${JSON.stringify(appConfig, null, 2)}\n`, 'utf8')

  return function restore() {
    fs.writeFileSync(APP_JSON, backup, 'utf8')
    if (fs.existsSync(PAGE_DIR)) {
      fs.rmSync(PAGE_DIR, { recursive: true, force: true })
    }
  }
}

function findCliPath() {
  const candidates = [
    process.env.WECHAT_DEVTOOLS_CLI,
    '/Applications/wechatwebdevtools.app/Contents/MacOS/cli',
    '/Applications/微信开发者工具.app/Contents/MacOS/cli',
    '/Applications/微信web开发者工具.app/Contents/MacOS/cli',
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function formatTime() {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

function ensureReportDir() {
  const dir = path.join(REPORT_ROOT, `spatial-${timestamp()}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function writeReport(options) {
  const {
    mode,
    results,
    error,
    cliPath,
    systemInfo,
    startedAt,
    reportDir,
  } = options

  const lines = []
  lines.push('# spatial-hologram 视觉验收报告')
  lines.push('')
  lines.push(`- 状态：**${mode}**`)
  lines.push(`- 开始时间：${startedAt}`)
  lines.push(`- 项目：\`${PROJECT_ROOT}\``)
  lines.push(`- 测试页：\`${PAGE_URL}\``)
  lines.push(`- 开发者工具 CLI：${cliPath ? `\`${cliPath}\`` : '未找到'}`)

  if (systemInfo) {
    lines.push(
      `- 环境：${systemInfo.brand || ''} ${systemInfo.model || ''} / ${
        systemInfo.platform || ''
      } / SDK ${systemInfo.SDKVersion || ''}`,
    )
  }

  if (error) {
    lines.push('')
    lines.push('## 阻塞 / 失败原因')
    lines.push('')
    lines.push('```text')
    lines.push(String(error.stack || error.message || error))
    lines.push('```')
  }

  lines.push('')
  lines.push('## 自动用例')
  lines.push('')
  lines.push('| # | 用例 | 主题 | 内置极光 | 自定义装饰 | 截图 | 自动断言 |')
  lines.push('| :--- | :--- | :--- | :--- | :--- | :--- | :--- |')

  results.forEach((item, index) => {
    const screenshot = item.screenshot
      ? `[${path.basename(item.screenshot)}](./${path.basename(item.screenshot)})`
      : '—'
    const assertion = item.assertion || '—'
    const status =
      item.status === 'PASS'
        ? 'PASS'
        : item.status === 'PREPARED'
          ? 'PREPARED'
          : `FAIL：${item.error || '未知原因'}`
    lines.push(
      `| ${index + 1} | \`${item.case.id}\` | ${item.case.theme} | ${
        item.case.aurora ? '开' : '关'
      } | ${item.case.decor ? '开' : '关'} | ${screenshot} | ${status}<br>${assertion} |`,
    )
  })

  lines.push('')
  lines.push('## 自动断言口径')
  lines.push('')
  lines.push('- 页面 `caseId` 与用例 id 一致；')
  lines.push('- 页面 `themeClass` 为 `theme-light` 或 `theme-dark`；')
  lines.push('- 页面 `aurora` / `showDecor` 与用例配置一致；')
  lines.push('- 截图文件存在且体积大于 0；')
  lines.push('- 测试页 `index.json` 三个组件注册齐全，WXML `view` 标签闭合，WXSS 可被 PostCSS 解析。')
  lines.push('')
  lines.push('## 人工真机验收')
  lines.push('')
  lines.push('| 场景 | 验收点 | 结果 |')
  lines.push('| :--- | :--- | :--- |')
  lines.push('| 真机转动 | 陀螺仪视差平滑、无突跳、无过冲 | 待人工确认 |')
  lines.push('| 页面切换 | 离开后停止监听，返回后基线重校准 | 待人工确认 |')
  lines.push('| 双实例 | 同页两个空间容器互不串扰 | 待人工确认 |')
  lines.push('| 弹层叠加 | 打开底部抽屉 / 命令面板时层叠稳定 | 待人工确认 |')
  lines.push('| 低端机 | 不支持 preserve-3d 时退化为平面层叠 | 待人工确认 |')
  lines.push('| 减少动效 | 关闭动效后内容仍完整可读 | 待人工确认 |')
  lines.push('')
  lines.push('## 运行说明')
  lines.push('')
  lines.push('```bash')
  lines.push('npm run test:visual:hologram:dry')
  lines.push('npm run test:visual:hologram')
  lines.push('```')
  lines.push('')
  lines.push('> 完整视觉截图需要微信开发者工具已登录，并在「设置 → 安全」中开启服务端口。')
  lines.push('> 脚本会临时注入测试页、修改 app.json，结束后在 finally 中恢复原始 app.json 并删除测试页。')

  const reportPath = path.join(reportDir, 'report.md')
  fs.writeFileSync(reportPath, `${lines.join('\n')}\n`, 'utf8')

  const summaryPath = path.join(reportDir, 'summary.json')
  fs.writeFileSync(
    summaryPath,
    `${JSON.stringify(
      {
        mode,
        startedAt,
        cliPath: cliPath || null,
        page: PAGE_URL,
        results: results.map((item) => ({
          id: item.case.id,
          status: item.status,
          screenshot: item.screenshot || null,
          assertion: item.assertion || null,
          error: item.error || null,
        })),
        error: error ? String(error.message || error) : null,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  return reportPath
}

/* 开发者工具可能在启动页就绪后继续热编译，逐用例重新取当前页面实例 */
async function getLivePage(miniProgram, fallback, attempts) {
  const max = attempts || 6
  for (let index = 0; index < max; index += 1) {
    try {
      const page = await miniProgram.currentPage()
      if (page && typeof page.path === 'string' && page.path.includes('__visual_spatial__')) {
        return page
      }
    } catch {
      /* Skyline 热编译期间页面元信息可能瞬时缺失 */
    }
    await new Promise((resolve) => setTimeout(resolve, 800))
  }
  return fallback
}

/* 截图后紧接着的逻辑层调用偶发超时，单次重试即可恢复 */
async function retryCall(action, attempts) {
  const max = attempts || 2
  let lastError = null
  for (let index = 0; index < max; index += 1) {
    try {
      return await action()
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 700))
    }
  }
  throw lastError
}

async function runCases(miniProgram, page, context) {
  const { cliPath, reportDir, startedAt, systemInfo } = context
  const results = []

  for (const item of CASES) {
    const result = {
      case: item,
      status: 'FAIL',
      screenshot: null,
      assertion: null,
      error: null,
    }

    try {
      page = await getLivePage(miniProgram, page)
      /* 截图后页面可能被开发者工具重载，setData 需要确认落到当前实例 */
      let data = null
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await retryCall(() =>
          miniProgram.evaluate((config) => {
            const pages = getCurrentPages()
            const current = pages[pages.length - 1]
            if (!current) {
              return
            }
            current.setData({
              themeClass:
                config.theme === 'dark' ? 'theme-dark' : 'theme-light',
              aurora: config.aurora !== false,
              showDecor: config.decor !== false,
              caseId: config.id,
            })
          }, item),
        )
        await new Promise((resolve) => setTimeout(resolve, 900))

        data = await retryCall(() =>
          miniProgram.evaluate(() => {
            const pages = getCurrentPages()
            const current = pages[pages.length - 1]
            return current
              ? {
                  caseId: current.data.caseId,
                  themeClass: current.data.themeClass,
                  aurora: current.data.aurora,
                  showDecor: current.data.showDecor,
                }
              : null
          }),
        )

        if (data && data.caseId === item.id) {
          break
        }
        page = await getLivePage(miniProgram, page)
      }
      if (!data) {
        throw new Error('当前页面实例不存在')
      }
      const expectedTheme = item.theme === 'dark' ? 'theme-dark' : 'theme-light'

      if (data.caseId !== item.id) {
        throw new Error(`caseId 不一致：${data.caseId} != ${item.id}`)
      }
      if (data.themeClass !== expectedTheme) {
        throw new Error(`themeClass 不一致：${data.themeClass} != ${expectedTheme}`)
      }
      if (Boolean(data.aurora) !== item.aurora) {
        throw new Error(`aurora 不一致：${data.aurora}`)
      }
      if (Boolean(data.showDecor) !== item.decor) {
        throw new Error(`showDecor 不一致：${data.showDecor}`)
      }

      const screenshotPath = path.join(reportDir, `${item.id}.png`)
      await retryCall(() => miniProgram.screenshot({ path: screenshotPath }))
      if (!fs.existsSync(screenshotPath)) {
        throw new Error('截图文件未生成')
      }
      const stat = fs.statSync(screenshotPath)
      if (stat.size <= 0) {
        throw new Error('截图文件为空')
      }

      result.screenshot = screenshotPath
      result.assertion = `theme=${data.themeClass} / aurora=${Boolean(
        data.aurora,
      )} / decor=${Boolean(data.showDecor)} / ${Math.round(
        stat.size / 1024,
      )}KB`
      result.status = 'PASS'
    } catch (caseError) {
      result.error = String(caseError.message || caseError)
    }

    results.push(result)
  }

  const reportPath = writeReport({
    mode: results.every((item) => item.status === 'PASS') ? 'PASS' : 'FAIL',
    results,
    cliPath,
    systemInfo,
    startedAt,
    reportDir,
  })

  return { reportPath, results, systemInfo }
}

async function runWithDevtools(cliPath, reportDir) {
  const automator = require('miniprogram-automator')
  const launchOptions = {
    projectPath: PROJECT_ROOT,
    cliPath,
    trustProject: true,
    timeout: 60000,
  }

  const port = Number(process.env.WECHAT_AUTOMATOR_PORT)
  if (Number.isFinite(port) && port > 0) {
    launchOptions.port = port
  }

  const miniProgram = await automator.launch(launchOptions)
  const startedAt = formatTime()

  try {
    const systemInfo = await miniProgram.systemInfo()
    const page = await miniProgram.reLaunch(PAGE_URL)
    if (!page) {
      throw new Error(`无法打开测试页：${PAGE_URL}`)
    }
    await page.waitFor(600)

    return await runCases(miniProgram, page, {
      cliPath,
      reportDir,
      startedAt,
      systemInfo,
    })
  } finally {
    try {
      await miniProgram.close()
    } catch {
      /* 关闭失败不覆盖测试结论 */
    }
  }
}

/* Skyline 下新页面可能短暂缺少 webview 元信息，轮询等待启动页就绪 */
async function waitForPage(miniProgram, timeout) {
  const deadline = Date.now() + timeout
  let lastError = null

  while (Date.now() < deadline) {
    try {
      const page = await miniProgram.currentPage()
      if (page && typeof page.path === 'string' && page.path.includes('__visual_spatial__')) {
        return page
      }
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  if (lastError) {
    throw new Error(`等待测试页超时：${lastError.message}`)
  }
  return null
}

async function runWithConnect(reportDir) {
  const automator = require('miniprogram-automator')
  const miniProgram = await automator.connect({ wsEndpoint: CONNECT_WS })
  const startedAt = formatTime()

  try {
    const systemInfo = await miniProgram.systemInfo().catch(() => null)
    const page = await waitForPage(miniProgram, 30000)
    if (!page) {
      throw new Error(`测试页未成为启动页，请确认开发者工具自动编译已开启：${PAGE_PATH}`)
    }
    await page.waitFor(1500)

    return await runCases(miniProgram, page, {
      cliPath: findCliPath(),
      reportDir,
      startedAt,
      systemInfo,
    })
  } finally {
    try {
      await miniProgram.disconnect()
    } catch {
      /* 断开失败不覆盖测试结论 */
    }
  }
}

async function main() {
  const startedAt = formatTime()
  const reportDir = ensureReportDir()
  let restore = null
  let prepared = null

  try {
    const connectMode = Boolean(CONNECT_WS)
    restore = prepareVisualPage(connectMode)
    prepared = validateFixture()

    const cliPath = findCliPath()

    if (DRY_RUN) {
      const results = CASES.map((item) => ({
        case: item,
        status: 'PREPARED',
        screenshot: null,
        assertion: 'fixture 校验通过，等待真实截图',
        error: null,
      }))
      const reportPath = writeReport({
        mode: 'DRY-RUN',
        results,
        cliPath,
        startedAt,
        reportDir,
      })
      console.log(`[visual] 预检通过：${reportPath}`)
      console.log(
        `[visual] 组件注册：${prepared.components.join(', ')}；view 标签 ${prepared.viewTags.open} 对`,
      )
      return
    }

    if (!connectMode && !cliPath) {
      const error = new Error(
        '未找到微信开发者工具 CLI。请安装开发者工具，或设置 WECHAT_DEVTOOLS_CLI 环境变量。',
      )
      const results = CASES.map((item) => ({
        case: item,
        status: 'FAIL',
        screenshot: null,
        assertion: '未启动开发者工具',
        error: 'CLI 未找到',
      }))
      const reportPath = writeReport({
        mode: 'BLOCKED',
        results,
        cliPath: null,
        error,
        startedAt,
        reportDir,
      })
      console.error(`[visual] 阻塞：${reportPath}`)
      process.exitCode = 1
      return
    }

    const outcome = connectMode
      ? await runWithConnect(reportDir)
      : await runWithDevtools(cliPath, reportDir)
    console.log(`[visual] 完成：${outcome.reportPath}`)
    outcome.results.forEach((item) => {
      console.log(
        `[visual] ${item.status} ${item.case.id}${
          item.error ? ` - ${item.error}` : ''
        }`,
      )
    })
    if (outcome.results.some((item) => item.status !== 'PASS')) {
      process.exitCode = 1
    }
  } catch (error) {
    const results = CASES.map((item) => ({
      case: item,
      status: 'FAIL',
      screenshot: null,
      assertion: '脚本执行失败',
      error: String(error.message || error),
    }))
    const reportPath = writeReport({
      mode: 'FAILED',
      results,
      error,
      cliPath: findCliPath(),
      startedAt,
      reportDir,
    })
    console.error(`[visual] 失败：${reportPath}`)
    process.exitCode = 1
  } finally {
    if (restore) {
      restore()
    }
  }
}

main()
