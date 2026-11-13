/* ==========================================================================
   关键页视觉回归 · 本地 baseline 像素 diff
   - 通过 miniprogram-automator 启动微信开发者工具，截取 4 个稳定页面
   - Skyline 下截图只跟随启动入口页：Tab 页按入口分组各启动一次，工具页从首页 navigateTo
   - 首次用 --update 生成 tests/visual/baseline/*.png 与 meta-<theme>.json
   - 之后默认与 baseline 做 ImageMagick 像素 diff，超过阈值以退出码 1 失败
   - 首次启动写入固定本机 fixture（主题、省电动效、清空收藏/最近/搜索历史），
     结束后写回原值并恢复 app.json，避免污染开发者本地数据
   - 运行：npm run test:visual:pages
   - 首次：npm run test:visual:pages:update
   ========================================================================== */
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')

const PROJECT_ROOT = path.resolve(__dirname, '../..')
const APP_JSON = path.join(PROJECT_ROOT, 'app.json')
const BASELINE_DIR = path.join(__dirname, 'baseline')
const REPORT_ROOT = path.join(__dirname, 'reports')

const HOME_ENTRY = '/pages/index/index'

const CASES = [
  {
    id: '01-home',
    group: 'home',
    route: HOME_ENTRY,
    nav: 'tab',
    entry: HOME_ENTRY,
    note: '工具箱首页',
  },
  {
    id: '02-favorites-empty',
    group: 'favorites',
    route: '/pages/favorites/index',
    nav: 'tab',
    entry: '/pages/favorites/index',
    note: '收藏页空态',
  },
  {
    id: '03-mine',
    group: 'mine',
    route: '/pages/mine/index',
    nav: 'tab',
    entry: '/pages/mine/index',
    note: '我的',
  },
  {
    id: '04-tool-unit',
    group: 'unit',
    route: '/subpackages/tools-core/pages/unit/index',
    nav: 'page',
    entry: HOME_ENTRY,
    note: '工具页初始态',
  },
]

const FIXTURE_KEYS = [
  'gallery.theme.mode',
  'app:prefs.v1',
  'tbx:favorites',
  'tbx:recent',
  'tbx:usage',
  'tbx:searchHistory',
  'tbx:helpBannerDismissed',
]

const DEFAULT_PREFS = {
  version: 1,
  haptics: 'off',
  sound: false,
  lightEffects: false,
  motion: 'saver',
  autoCleanDays: 30,
  isPrivacyMasked: true,
  isHistoryTrackingEnabled: true,
  fontScale: 'standard',
  favoriteSort: 'recent',
  flags: { enable_ai_assist: false },
}

function parseArgs(argv) {
  const options = {
    update: false,
    dryRun: false,
    theme: 'light',
    threshold: 0.005,
    only: '',
  }

  argv.forEach((arg) => {
    if (arg === '--update') {
      options.update = true
    } else if (arg === '--dry-run') {
      options.dryRun = true
    } else if (arg.startsWith('--theme=')) {
      options.theme = arg.slice('--theme='.length) === 'dark' ? 'dark' : 'light'
    } else if (arg.startsWith('--threshold=')) {
      const value = Number(arg.slice('--threshold='.length))
      if (Number.isFinite(value) && value >= 0) {
        options.threshold = value
      }
    } else if (arg.startsWith('--only=')) {
      options.only = arg.slice('--only='.length)
    }
  })

  return options
}

const OPTIONS = parseArgs(process.argv.slice(2))
const THEME = OPTIONS.theme
const THRESHOLD = OPTIONS.threshold
const ACTIVE_CASES = OPTIONS.only
  ? CASES.filter((item) => item.id === OPTIONS.only)
  : CASES

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function formatTime() {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

function normalizeRoute(route) {
  return String(route || '').replace(/^\//, '')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function retryCall(action, attempts) {
  const max = attempts || 3
  let lastError = null
  for (let index = 0; index < max; index += 1) {
    try {
      return await action()
    } catch (error) {
      lastError = error
      await sleep(900)
    }
  }
  throw lastError
}

function findCliPath() {
  const candidates = [
    process.env.WECHAT_DEVTOOLS_CLI,
    '/Applications/wechatwebdevtools.app/Contents/MacOS/cli',
    '/Applications/微信开发者工具.app/Contents/MacOS/cli',
    '/Applications/微信web开发者工具.app/Contents/MacOS/cli',
  ].filter(Boolean)

  return candidates.find((candidate) => fs.existsSync(candidate)) || null
}

function findMagickPath() {
  const candidates = [
    process.env.IMAGEMAGICK_BIN,
    '/opt/homebrew/bin/magick',
    '/usr/local/bin/magick',
    'magick',
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (candidate === 'magick') {
      const probe = spawnSync(candidate, ['-version'], { encoding: 'utf8' })
      if (probe.status === 0) {
        return candidate
      }
      continue
    }
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

function imageSize(magick, file) {
  const output = execFileSync(magick, ['identify', '-format', '%w %h', file], {
    encoding: 'utf8',
  })
  const [width, height] = output.trim().split(/\s+/).map(Number)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`无法读取图片尺寸：${file}`)
  }
  return { width, height }
}

function compareImages(magick, current, baseline, diffPath) {
  const result = spawnSync(
    magick,
    ['compare', '-metric', 'AE', '-fuzz', '4%', baseline, current, diffPath],
    { encoding: 'utf8' },
  )
  const output = `${result.stderr || ''}\n${result.stdout || ''}`.trim()
  const match = output.match(/(\d+(?:\.\d+)?)/)
  if (!match) {
    throw new Error(`ImageMagick 未返回差异像素数：${output || '空输出'}`)
  }
  return Number(match[1])
}

/* app.json 入口页：Skyline 截图只跟随启动入口，Tab 页必须作为首个页面启动
   同时重排 tabBar.list：首个 tab 必须与入口页一致，否则开发者工具会断开自动化连接。
   页面视觉使用 custom-tab-bar 自己的 ITEMS，不受 app.json 顺序影响。 */
function setEntry(route) {
  const source = fs.readFileSync(APP_JSON, 'utf8')
  const appConfig = JSON.parse(source)
  const pages = Array.isArray(appConfig.pages) ? appConfig.pages.slice() : []
  const target = normalizeRoute(route)
  const index = pages.indexOf(target)
  if (index < 0) {
    throw new Error(`app.json 未注册入口页：${target}`)
  }
  if (index > 0) {
    pages.splice(index, 1)
    pages.unshift(target)
  }
  appConfig.pages = pages

  if (appConfig.tabBar && Array.isArray(appConfig.tabBar.list)) {
    const list = appConfig.tabBar.list.slice()
    const tabIndex = list.findIndex((item) => item.pagePath === target)
    if (tabIndex > 0) {
      const [tab] = list.splice(tabIndex, 1)
      list.unshift(tab)
    }
    appConfig.tabBar.list = list
  }

  fs.writeFileSync(APP_JSON, `${JSON.stringify(appConfig, null, 2)}\n`, 'utf8')
}

async function getCurrentRoute(miniProgram) {
  return miniProgram.evaluate(() => {
    const pages = getCurrentPages()
    const page = pages[pages.length - 1]
    return page ? page.route || page.__route__ || '' : ''
  })
}

async function waitForAppReady(miniProgram, timeout) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      /* 启动阶段 currentPage 比 evaluate 更早可用 */
      const page = await miniProgram.currentPage()
      if (page && page.path) {
        return
      }
    } catch (error) {
      /* 启动 / 重启期间连接或页面元信息可能短暂不可用 */
    }
    await sleep(500)
  }
  throw new Error('等待小程序启动超时')
}

async function waitForRoute(miniProgram, route, timeout) {
  const expected = normalizeRoute(route)
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      const current = await getCurrentRoute(miniProgram)
      if (normalizeRoute(current) === expected) {
        return
      }
    } catch (error) {
      /* 热编译期间页面元信息可能瞬时缺失 */
    }
    await sleep(300)
  }
  throw new Error(`等待页面超时：${route}`)
}

async function launchProject(automator, cliPath) {
  const launchOptions = {
    projectPath: PROJECT_ROOT,
    cliPath,
    trustProject: true,
    timeout: 90000,
  }

  let lastError = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const miniProgram = await automator.launch(launchOptions)
      /* 冷启动时逻辑层尚未就绪，立即 evaluate 会阻塞到默认超时 */
      await sleep(6000)
      await waitForAppReady(miniProgram, 60000)
      return miniProgram
    } catch (error) {
      lastError = error
      await sleep(2500)
    }
  }
  throw lastError
}

async function readStorage(miniProgram, key) {
  try {
    const value = await miniProgram.callWxMethod('getStorageSync', key)
    return value === '' ? undefined : value
  } catch (error) {
    return undefined
  }
}

async function writeStorage(miniProgram, key, value) {
  if (value === undefined) {
    await miniProgram.callWxMethod('removeStorageSync', key)
  } else {
    await miniProgram.callWxMethod('setStorageSync', key, value)
  }
}

function fixtureValues() {
  return {
    'gallery.theme.mode': THEME,
    'app:prefs.v1': { ...DEFAULT_PREFS, flags: { ...DEFAULT_PREFS.flags } },
    'tbx:favorites': [],
    'tbx:recent': [],
    'tbx:usage': 0,
    'tbx:searchHistory': [],
    'tbx:helpBannerDismissed': true,
  }
}

async function readBackups(miniProgram) {
  const backups = {}
  for (const key of FIXTURE_KEYS) {
    backups[key] = await readStorage(miniProgram, key)
  }
  return backups
}

async function writeFixtures(miniProgram) {
  const fixtures = fixtureValues()
  for (const key of FIXTURE_KEYS) {
    await writeStorage(miniProgram, key, fixtures[key])
  }
}

async function restoreStorage(miniProgram, backups) {
  if (!backups) {
    return
  }
  for (const key of FIXTURE_KEYS) {
    try {
      await writeStorage(miniProgram, key, backups[key])
    } catch (error) {
      /* 单个 key 恢复失败不影响其余数据 */
    }
  }
}

async function navigateToTool(miniProgram, route) {
  await miniProgram.evaluate(
    (target) =>
      new Promise((resolve, reject) => {
        wx.navigateTo({
          url: target,
          success: () => resolve(true),
          fail: (error) => reject(new Error(JSON.stringify(error || {}))),
        })
      }),
    route,
  )
}

async function navigateBack(miniProgram) {
  await miniProgram.evaluate(
    () =>
      new Promise((resolve) => {
        wx.navigateBack({
          success: () => resolve(true),
          fail: () => resolve(false),
        })
      }),
  )
}

async function detectNetworkType(miniProgram) {
  try {
    const value = await miniProgram.evaluate(
      () =>
        new Promise((resolve) => {
          try {
            wx.getNetworkType({
              success: (result) => resolve(result.networkType || 'unknown'),
              fail: () => resolve('unknown'),
            })
          } catch (error) {
            resolve('unknown')
          }
        }),
    )
    return typeof value === 'string' ? value : 'unknown'
  } catch (error) {
    return 'unknown'
  }
}

async function captureCase(miniProgram, item, reportDir, magick) {
  const result = {
    case: item,
    status: 'FAIL',
    screenshot: null,
    baseline: null,
    diffPath: null,
    ratio: null,
    error: null,
  }

  try {
    const current = await retryCall(() => getCurrentRoute(miniProgram), 2)
    if (normalizeRoute(current) !== normalizeRoute(item.route)) {
      if (item.nav !== 'page') {
        throw new Error(`入口页未生效：${current} != ${item.route}`)
      }
      await retryCall(() => navigateToTool(miniProgram, item.route), 3)
      await waitForRoute(miniProgram, item.route, 25000)
    }

    await sleep(1200)
    const screenshotPath = path.join(reportDir, `${item.id}-${THEME}.png`)
    await retryCall(() => miniProgram.screenshot({ path: screenshotPath }), 3)
    if (!fs.existsSync(screenshotPath) || fs.statSync(screenshotPath).size <= 0) {
      throw new Error('截图文件未生成或为空')
    }
    result.screenshot = screenshotPath

    const baselinePath = path.join(BASELINE_DIR, `${item.id}-${THEME}.png`)
    result.baseline = baselinePath

    if (OPTIONS.update || !fs.existsSync(baselinePath)) {
      if (!OPTIONS.update) {
        throw new Error(`缺少 baseline：${baselinePath}，请先运行 npm run test:visual:pages:update`)
      }
      fs.mkdirSync(BASELINE_DIR, { recursive: true })
      fs.copyFileSync(screenshotPath, baselinePath)
      result.status = 'CREATED'
      result.ratio = 0
    } else {
      const currentSize = imageSize(magick, screenshotPath)
      const baselineSize = imageSize(magick, baselinePath)
      if (
        currentSize.width !== baselineSize.width ||
        currentSize.height !== baselineSize.height
      ) {
        throw new Error(
          `截图尺寸与 baseline 不一致：current ${currentSize.width}x${currentSize.height} / baseline ${baselineSize.width}x${baselineSize.height}`,
        )
      }
      const diffPath = path.join(reportDir, `${item.id}-${THEME}-diff.png`)
      const changedPixels = compareImages(magick, screenshotPath, baselinePath, diffPath)
      const ratio = changedPixels / (currentSize.width * currentSize.height)
      result.ratio = ratio
      result.diffPath = fs.existsSync(diffPath) ? diffPath : null
      result.status = ratio <= THRESHOLD ? 'PASS' : 'FAIL'
      if (result.status === 'FAIL') {
        result.error = `像素差异 ${(ratio * 100).toFixed(3)}% 超过阈值 ${(
          THRESHOLD * 100
        ).toFixed(3)}%`
      }
    }
  } catch (error) {
    result.error = String(error.message || error)
    result.status = /尺寸与 baseline 不一致|缺少 baseline/.test(result.error)
      ? 'BLOCKED'
      : 'FAIL'
  }

  if (item.nav === 'page') {
    try {
      await retryCall(() => navigateBack(miniProgram), 2)
      await sleep(600)
    } catch (error) {
      /* 返回失败不影响已完成的截图结论 */
    }
  }

  return result
}

function writeReport(context) {
  const {
    mode,
    results,
    reportDir,
    startedAt,
    meta,
    cliPath,
    magick,
    warning,
    error,
  } = context

  const lines = []
  lines.push('# 关键页视觉回归报告')
  lines.push('')
  lines.push(`- 状态：**${mode}**`)
  lines.push(`- 开始时间：${startedAt}`)
  lines.push(`- 项目：\`${PROJECT_ROOT}\``)
  lines.push(`- 主题：${THEME}`)
  lines.push(`- 阈值：${(THRESHOLD * 100).toFixed(3)}%`)
  lines.push(`- 开发者工具 CLI：${cliPath ? `\`${cliPath}\`` : '未找到'}`)
  lines.push(`- ImageMagick：${magick ? `\`${magick}\`` : '未找到'}`)
  if (meta) {
    lines.push(
      `- 视口：${meta.windowWidth}×${meta.windowHeight} @${meta.pixelRatio}x / ${
        meta.model || '未知机型'
      } / SDK ${meta.SDKVersion || ''}`,
    )
  }
  if (warning) {
    lines.push(`- 提示：${warning}`)
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
  lines.push('## 用例')
  lines.push('')
  lines.push('| # | 页面 | 状态 | 差异 | 截图 | 说明 |')
  lines.push('| :--- | :--- | :--- | :--- | :--- | :--- |')

  results.forEach((item, index) => {
    const screenshot = item.screenshot
      ? `[${path.basename(item.screenshot)}](./${path.basename(item.screenshot)})`
      : '—'
    const ratio =
      typeof item.ratio === 'number' ? `${(item.ratio * 100).toFixed(3)}%` : '—'
    lines.push(
      `| ${index + 1} | \`${item.case.id}\` ${item.case.note} | ${item.status} | ${ratio} | ${screenshot} | ${
        item.error || '—'
      } |`,
    )
  })

  lines.push('')
  lines.push('## 运行说明')
  lines.push('')
  lines.push('```bash')
  lines.push('npm run test:visual:pages:update   # 首次生成 baseline')
  lines.push('npm run test:visual:pages          # 与 baseline 比对')
  lines.push('```')
  lines.push('')
  lines.push('> 截图需要微信开发者工具已登录；脚本会临时写入本机 fixture、调整 app.json 入口页，')
  lines.push('> 结束后还原本机数据与 app.json。baseline 与视口尺寸绑定，更换模拟器机型后请重新 --update。')

  const reportPath = path.join(reportDir, 'report.md')
  fs.writeFileSync(reportPath, `${lines.join('\n')}\n`, 'utf8')

  const summaryPath = path.join(reportDir, 'summary.json')
  fs.writeFileSync(
    summaryPath,
    `${JSON.stringify(
      {
        mode,
        startedAt,
        theme: THEME,
        threshold: THRESHOLD,
        cliPath: cliPath || null,
        magick: magick || null,
        meta: meta || null,
        warning: warning || null,
        results: results.map((item) => ({
          id: item.case.id,
          route: item.case.route,
          status: item.status,
          ratio: item.ratio,
          screenshot: item.screenshot,
          baseline: item.baseline,
          error: item.error,
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

function ensureReportDir() {
  const dir = path.join(REPORT_ROOT, `pages-${timestamp()}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function buildGroups() {
  const groups = []
  const groupMap = new Map()

  ACTIVE_CASES.forEach((item) => {
    if (!groupMap.has(item.group)) {
      const group = { key: item.group, entry: item.entry, cases: [] }
      groupMap.set(item.group, group)
      groups.push(group)
    }
    groupMap.get(item.group).cases.push(item)
  })

  return groups
}

async function run() {
  const startedAt = formatTime()
  const reportDir = ensureReportDir()
  const cliPath = findCliPath()
  const magick = findMagickPath()
  const groups = buildGroups()

  if (OPTIONS.dryRun) {
    const results = ACTIVE_CASES.map((item) => ({
      case: item,
      status: 'PREPARED',
      screenshot: null,
      baseline: null,
      diffPath: null,
      ratio: null,
      error: null,
    }))
    const reportPath = writeReport({
      mode: 'DRY-RUN',
      results,
      reportDir,
      startedAt,
      cliPath,
      magick,
      warning: `分组入口：${groups.map((group) => group.entry).join(' / ')}`,
    })
    console.log(`[visual] 预检通过：${reportPath}`)
    console.log(`[visual] 用例：${ACTIVE_CASES.map((item) => item.id).join(', ')}`)
    return
  }

  if (!magick) {
    throw new Error('未找到 ImageMagick，请安装后重试：brew install imagemagick')
  }
  if (!cliPath) {
    throw new Error('未找到微信开发者工具 CLI，请安装开发者工具或设置 WECHAT_DEVTOOLS_CLI')
  }

  const automator = require('miniprogram-automator')
  const appJsonBackup = fs.readFileSync(APP_JSON, 'utf8')
  const resultsById = new Map()
  let miniProgram = null
  let backups = null
  let meta = null
  let warning = ''
  let storageRestored = false

  try {
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      const group = groups[groupIndex]
      setEntry(group.entry)

      try {
        miniProgram = await launchProject(automator, cliPath)
      } catch (launchError) {
        throw new Error(`入口页 ${group.entry} 启动失败：${launchError.message}`)
      }

      if (groupIndex === 0) {
        backups = await readBackups(miniProgram)
        await writeFixtures(miniProgram)

        /* 原生重启：让 onLaunch 读取 fixture，同时保留当前自动化会话 */
        try {
          await miniProgram.callWxMethod('restartMiniProgram', { path: group.entry })
          await sleep(3000)
          await waitForAppReady(miniProgram, 60000)
        } catch (restartError) {
          try {
            await miniProgram.close()
          } catch (error) {
            /* 连接已关闭时忽略 */
          }
          await sleep(2500)
          miniProgram = await launchProject(automator, cliPath)
        }

        const networkType = await detectNetworkType(miniProgram)
        if (networkType === 'none') {
          throw new Error('截图环境处于离线状态，请恢复网络后重试')
        }

        const systemInfo = await retryCall(() => miniProgram.systemInfo(), 4)
        meta = {
          theme: THEME,
          windowWidth: systemInfo.windowWidth,
          windowHeight: systemInfo.windowHeight,
          pixelRatio: systemInfo.pixelRatio,
          model: systemInfo.model,
          SDKVersion: systemInfo.SDKVersion,
          createdAt: new Date().toISOString(),
        }
        /* 首屏稳定，降低自动化超时概率 */
        await sleep(1200)
      }

      for (const item of group.cases) {
        resultsById.set(item.id, await captureCase(miniProgram, item, reportDir, magick))
      }

      const isLastGroup = groupIndex === groups.length - 1
      if (isLastGroup) {
        await restoreStorage(miniProgram, backups)
        storageRestored = true
      }

      try {
        await miniProgram.close()
      } catch (error) {
        /* 关闭失败不覆盖测试结论 */
      }
      miniProgram = null

      /* 给开发者工具留出关停缓冲，避免下一入口冷启动抢跑 */
      if (!isLastGroup) {
        await sleep(4000)
      }
    }

    const results = ACTIVE_CASES.map(
      (item) =>
        resultsById.get(item.id) || {
          case: item,
          status: 'BLOCKED',
          screenshot: null,
          baseline: null,
          diffPath: null,
          ratio: null,
          error: '用例未执行',
        },
    )

    if (OPTIONS.update) {
      fs.mkdirSync(BASELINE_DIR, { recursive: true })
      fs.writeFileSync(
        path.join(BASELINE_DIR, `meta-${THEME}.json`),
        `${JSON.stringify(meta, null, 2)}\n`,
        'utf8',
      )
    }

    const mode = results.every((item) => item.status === 'PASS' || item.status === 'CREATED')
      ? OPTIONS.update
        ? 'PASS / BASELINE'
        : 'PASS'
      : results.some((item) => item.status === 'BLOCKED')
        ? 'BLOCKED'
        : 'FAIL'

    const reportPath = writeReport({
      mode,
      results,
      reportDir,
      startedAt,
      meta,
      cliPath,
      magick,
      warning,
    })
    console.log(`[visual] 完成：${reportPath}`)
    results.forEach((item) => {
      console.log(
        `[visual] ${item.status} ${item.case.id}${
          typeof item.ratio === 'number' ? ` (${(item.ratio * 100).toFixed(3)}%)` : ''
        }${item.error ? ` - ${item.error}` : ''}`,
      )
    })

    if (results.some((item) => item.status === 'BLOCKED')) {
      process.exitCode = 2
    } else if (results.some((item) => item.status !== 'PASS' && item.status !== 'CREATED')) {
      process.exitCode = 1
    }
  } catch (error) {
    const results = ACTIVE_CASES.map(
      (item) =>
        resultsById.get(item.id) || {
          case: item,
          status: 'BLOCKED',
          screenshot: null,
          baseline: null,
          diffPath: null,
          ratio: null,
          error: String(error.message || error),
        },
    )
    const reportPath = writeReport({
      mode: 'BLOCKED',
      results,
      reportDir,
      startedAt,
      cliPath,
      magick,
      warning,
      error,
    })
    console.error(`[visual] 阻塞：${reportPath}`)
    process.exitCode = 2
  } finally {
    if (miniProgram && !storageRestored) {
      try {
        await restoreStorage(miniProgram, backups)
      } catch (error) {
        /* 还原失败不覆盖测试结论 */
      }
    }
    if (miniProgram) {
      try {
        await miniProgram.close()
      } catch (error) {
        /* 关闭失败不覆盖测试结论 */
      }
    }
    fs.writeFileSync(APP_JSON, appJsonBackup, 'utf8')
  }
}

run()
