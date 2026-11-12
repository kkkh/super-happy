#!/usr/bin/env node
/* ==========================================================================
   miniprogram-ci 自动上传
   - 版本号默认读取 core/constants/index.ts 的 APP_VERSION
   - 上传密钥只从 --key / MP_CI_PRIVATE_KEY_PATH 读取，默认 private/private.key
   - 上传前自动构建根包与 tools-core 的 miniprogram_npm
   - 密钥、private 目录、scripts 目录不会进入小程序包
   ========================================================================== */

const fs = require('node:fs')
const path = require('node:path')
const ci = require('miniprogram-ci')

const ROOT = path.resolve(__dirname, '..')
const DEFAULT_KEY_PATH = path.join(ROOT, 'private', 'private.key')
const PROJECT_CONFIG_PATH = path.join(ROOT, 'project.config.json')
const CONSTANTS_PATH = path.join(ROOT, 'core', 'constants', 'index.ts')

/** 编译期排除规则；与 project.config.json 的 packOptions.ignore 叠加生效 */
const IGNORES = [
  '**/node_modules/**/*',
  'tests/**/*',
  'docs/**/*',
  'scripts/**/*',
  'private/**/*',
  '补充文档/**/*',
  '.legacy/**/*',
  '.screenshots/**/*',
  '.icon-src/**/*',
  '.icon-dist/**/*',
  '视觉提案/**/*',
  '视觉提案-v2/**/*',
  '视觉提案-v3/**/*',
  '山西晋中理工学院-园枢/**/*',
  'ai-skills/**/*',
  '**/*.md',
  '**/*.key',
  '.gitignore',
  '.github/**/*',
  'chaohuan-ci-guide/**/*',
  'preview-qr.png',
  'preview-*.png',
  'preview-*.json',
  '全息专注引擎-真机预览二维码.png',
  '未命名.png',
  'package-lock.json',
  'project.private.config.json',
  '*.pem',
]

const HELP = `
超欢 · miniprogram-ci 自动上传

用法：
  npm run ci:upload
  npm run ci:upload -- --version 1.1.1 --desc "修复 xxx"

选项：
  --version <v>     上传版本号，默认读取 core/constants/index.ts 的 APP_VERSION
  --desc <text>     项目备注，默认带时间戳
  --key <path>      上传密钥路径，默认 private/private.key
  --robot <1-30>    CI 机器人编号（需在小程序后台配置）
  --threads <n>     编译线程数
  --skip-npm        跳过根包与 tools-core 的 miniprogram_npm 构建
  -h, --help        显示帮助

环境变量：
  MP_CI_PRIVATE_KEY_PATH / MP_CI_VERSION / MP_CI_DESC / MP_CI_ROBOT / MP_CI_THREADS / MP_CI_SKIP_NPM=1

密钥获取：
  小程序后台 → 开发管理 → 开发设置 → 小程序代码上传 → 生成上传密钥
  若后台开启 IP 白名单，需把当前机器 / CI 出口 IP 加入白名单。
`

function printHelp() {
  console.log(HELP.trim())
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

/** 从 TS 常量读取版本号，避免和页面展示版本漂移 */
function readAppVersion() {
  if (!fs.existsSync(CONSTANTS_PATH)) {
    throw new Error(`未找到版本常量文件：${CONSTANTS_PATH}`)
  }
  const source = fs.readFileSync(CONSTANTS_PATH, 'utf8')
  const match = source.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/)
  if (!match || !match[1]) {
    throw new Error('未在 core/constants/index.ts 中找到 APP_VERSION')
  }
  return match[1]
}

function formatBytes(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) {
    return '未知'
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  }
  return `${(bytes / 1024).toFixed(1)} KB`
}

function applyOption(options, name, value) {
  switch (name) {
    case 'version':
      options.version = value
      break
    case 'desc':
      options.desc = value
      break
    case 'key':
      options.key = value
      break
    case 'robot':
      options.robot = Number(value)
      break
    case 'threads':
      options.threads = Number(value)
      break
    default:
      throw new Error(`未知参数：--${name}`)
  }
}

function parseArgs(argv) {
  const options = {
    help: false,
    skipNpm: false,
    version: '',
    desc: '',
    key: '',
    robot: 0,
    threads: 0,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }
    if (arg === '--skip-npm') {
      options.skipNpm = true
      continue
    }

    if (arg.startsWith('--')) {
      const equalIndex = arg.indexOf('=')
      if (equalIndex !== -1) {
        applyOption(options, arg.slice(2, equalIndex), arg.slice(equalIndex + 1))
        continue
      }

      const name = arg.slice(2)
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) {
        throw new Error(`参数 --${name} 缺少值`)
      }
      applyOption(options, name, value)
      index += 1
      continue
    }

    throw new Error(`未知参数：${arg}`)
  }

  return options
}

function validateIntegerOption(value, name, min, max) {
  if (value === 0 || value === undefined || value === null || value === '') {
    return
  }
  const number = Number(value)
  if (!Number.isInteger(number) || number < min || (max !== undefined && number > max)) {
    throw new Error(`${name} 必须是 ${min}${max === undefined ? ' 以上' : `–${max}`} 的整数`)
  }
}

function validateOptions(options) {
  validateIntegerOption(options.robot, '--robot', 1, 30)
  validateIntegerOption(options.threads, '--threads', 1)
}

/** 与 project.config.json 的 packNpmRelationList 保持一致 */
async function buildNpm() {
  const tasks = [
    {
      name: '根包',
      packageJsonPath: path.join(ROOT, 'package.json'),
      miniprogramNpmDistDir: ROOT,
    },
    {
      name: 'tools-core',
      packageJsonPath: path.join(ROOT, 'subpackages', 'tools-core', 'package.json'),
      miniprogramNpmDistDir: path.join(ROOT, 'subpackages', 'tools-core'),
    },
  ]

  for (const task of tasks) {
    if (!fs.existsSync(task.packageJsonPath)) {
      console.warn(`[ci] 跳过 ${task.name}：未找到 ${task.packageJsonPath}`)
      continue
    }

    const nodeModulesPath = path.join(path.dirname(task.packageJsonPath), 'node_modules')
    if (!fs.existsSync(nodeModulesPath)) {
      throw new Error(
        `${task.name} 依赖未安装，请先执行 npm ci` +
          (task.name === '根包' ? '' : ' --prefix subpackages/tools-core'),
      )
    }

    const result = await ci.packNpmManually(task)
    console.log(
      `[ci] npm 构建 ${task.name}：miniprogram 包 ${result.miniProgramPackNum} 个，其他 ${result.otherNpmPackNum} 个`,
    )
    if (result.miniProgramPackNum + result.otherNpmPackNum === 0) {
      throw new Error(`${task.name} 的 npm 构建没有产出任何 miniprogram_npm 包`)
    }
    for (const warning of result.warnList || []) {
      console.warn(
        `[ci] npm 警告：${warning.msg || warning.tips || '未知问题'}` +
          (warning.jsPath ? `（${warning.jsPath}）` : ''),
      )
    }
  }
}

function printPackageInfo(subPackageInfo) {
  if (!Array.isArray(subPackageInfo) || subPackageInfo.length === 0) {
    return
  }
  for (const item of subPackageInfo) {
    const label = item.name === '__FULL__' ? '整包' : item.name === '__APP__' ? '主包' : item.name
    console.log(`[ci] ${label}：${formatBytes(item.size)}`)
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return 0
  }

  validateOptions(options)

  const version = options.version || process.env.MP_CI_VERSION || readAppVersion()
  if (!version || version.length > 64 || /\s/.test(version)) {
    throw new Error(`版本号不合法：${version}`)
  }

  const keyPath = path.resolve(
    options.key || process.env.MP_CI_PRIVATE_KEY_PATH || DEFAULT_KEY_PATH,
  )
  if (!fs.existsSync(keyPath)) {
    console.error(`[ci] 未找到上传密钥：${keyPath}`)
    console.error(
      '[ci] 请在小程序后台「开发管理 → 开发设置 → 小程序代码上传」生成密钥，' +
        '放到 private/private.key，或通过 --key / MP_CI_PRIVATE_KEY_PATH 指定。',
    )
    return 1
  }
  if (!fs.statSync(keyPath).isFile()) {
    throw new Error(`上传密钥不是文件：${keyPath}`)
  }

  if (!fs.existsSync(PROJECT_CONFIG_PATH)) {
    throw new Error(`未找到 project.config.json：${PROJECT_CONFIG_PATH}`)
  }
  const projectConfig = readJson(PROJECT_CONFIG_PATH)
  if (!projectConfig.appid) {
    throw new Error('project.config.json 缺少 appid')
  }

  const appVersion = readAppVersion()
  if (version !== appVersion) {
    console.warn(
      `[ci] 版本号 ${version} 与 APP_VERSION ${appVersion} 不一致；请确认这是有意覆盖。`,
    )
  }

  const desc =
    options.desc ||
    process.env.MP_CI_DESC ||
    `CI 自动上传 v${version} · ${new Date().toLocaleString('zh-CN', {
      hour12: false,
      timeZone: 'Asia/Shanghai',
    })}`

  const robot = options.robot || Number(process.env.MP_CI_ROBOT || 0)
  const threads = options.threads || Number(process.env.MP_CI_THREADS || 0)
  validateOptions({ robot, threads })

  const tailwindOutput = path.join(ROOT, 'styles', 'generated', 'tailwind.wxss')
  if (!fs.existsSync(tailwindOutput)) {
    throw new Error(`缺少 ${tailwindOutput}，请先执行 npm run build:style`)
  }

  const skipNpm = options.skipNpm || process.env.MP_CI_SKIP_NPM === '1'
  if (!skipNpm) {
    await buildNpm()
  } else {
    console.log('[ci] 已跳过 npm 构建')
  }

  const project = new ci.Project({
    appid: projectConfig.appid,
    type: 'miniProgram',
    projectPath: ROOT,
    privateKeyPath: keyPath,
    ignores: IGNORES,
  })

  console.log(`[ci] 开始上传：appid=${projectConfig.appid} version=${version}`)
  console.log(`[ci] 备注：${desc}`)

  const result = await ci.upload({
    project,
    version,
    desc,
    setting: {
      useProjectConfig: true,
    },
    ...(robot ? { robot } : {}),
    ...(threads ? { threads } : {}),
    onProgressUpdate: (task) => {
      if (typeof task === 'string') {
        console.log(`[ci] ${task}`)
        return
      }
      if (task && typeof task.message === 'string') {
        console.log(`[ci] ${task.status || 'info'}：${task.message}`)
      }
    },
  })

  console.log('[ci] 上传完成')
  printPackageInfo(result.subPackageInfo)
  return 0
}

/**
 * miniprogram-ci 的编译器会留下子进程 / 定时器句柄，
 * 仅设置 process.exitCode 不能保证进程退出；这里在日志刷新后强制收口，
 * 避免 CI 步骤一直挂到 timeout。
 */
function finish(code) {
  process.exitCode = code
  setTimeout(() => process.exit(code), 200)
}

main()
  .then(finish)
  .catch((error) => {
    const message = error && error.message ? error.message : String(error)
    console.error(`[ci] 上传失败：${message}`)
    if (/private.?key|密钥/i.test(message)) {
      console.error('[ci] 请检查上传密钥是否有效，并确认小程序后台已配置当前 IP 白名单。')
    }
    finish(1)
  })
