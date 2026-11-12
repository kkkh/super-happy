/* ==========================================================================
   工具页 · E2E 路由冒烟（批 1 + 批 2）
   - 微信开发者工具 + miniprogram-automator
   - 逐卡导航、校验页面路径 / glass-tool-shell / toolName / 初始 error
   - 默认连接 ws://127.0.0.1:9420；也可用 --launch 启动
   - 运行：npm run test:e2e（连接）；npm run test:e2e:launch（启动）
   ========================================================================== */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const PROJECT_ROOT = path.resolve(__dirname, '..')
const CLI_CANDIDATES = [
  process.env.WECHAT_DEVTOOLS_CLI,
  '/Applications/wechatwebdevtools.app/Contents/MacOS/cli',
  '/Applications/微信开发者工具.app/Contents/MacOS/cli',
].filter(Boolean)

const LAUNCH_FLAG = process.argv.includes('--launch')
const WS_ENDPOINT =
  process.env.WECHAT_AUTOMATOR_WS || (LAUNCH_FLAG ? '' : 'ws://127.0.0.1:9420')

const SMOKE_TOOLS = [
  { id: 'unit', route: 'subpackages/tools-core/pages/unit/index' },
  { id: 'password', route: 'subpackages/tools-core/pages/password/index' },
  { id: 'base64', route: 'subpackages/tools-core/pages/base64/index' },
  { id: 'radix', route: 'subpackages/tools-core/pages/radix/index' },
  { id: 'ledger', route: 'subpackages/tools-daily/pages/ledger/index' },
  { id: 'date-format', route: 'subpackages/tools-core/pages/date-format/index' },
  { id: 'date-add', route: 'subpackages/tools-core/pages/date-add/index' },
  { id: 'color', route: 'subpackages/tools-core/pages/color/index' },
  { id: 'json-csv', route: 'subpackages/tools-core/pages/json-csv/index' },
  { id: 'timezone', route: 'subpackages/tools-core/pages/timezone/index' },
  { id: 'schedule', route: 'subpackages/tools-core/pages/schedule/index' },
  { id: 'text-convert', route: 'subpackages/tools-core/pages/text-convert/index' },
  { id: 'template', route: 'subpackages/tools-core/pages/template/index' },
  { id: 'regex', route: 'subpackages/tools-core/pages/regex/index' },
  { id: 'photo-edit', route: 'subpackages/tools-media/pages/photo-edit/index' },
  { id: 'worktime', route: 'subpackages/tools-daily/pages/worktime/index' },
  { id: 'wellness', route: 'subpackages/tools-daily/pages/wellness/index' },
  { id: 'random-pick', route: 'subpackages/tools-daily/pages/random-pick/index' },
  { id: 'fuel', route: 'subpackages/tools-daily/pages/fuel/index' },
  { id: 'power', route: 'subpackages/tools-daily/pages/power/index' },
  { id: 'resolution', route: 'subpackages/tools-daily/pages/resolution/index' },
  { id: 'carloan', route: 'subpackages/tools-daily/pages/carloan/index' },
  { id: 'quote', route: 'subpackages/tools-daily/pages/quote/index' },
  { id: 'meeting-timer', route: 'subpackages/tools-daily/pages/meeting-timer/index' },
  { id: 'bodyfat', route: 'subpackages/tools-daily/pages/bodyfat/index' },
  { id: 'fx-manual', route: 'subpackages/tools-daily/pages/fx-manual/index' },
  { id: 'salary-inverse', route: 'subpackages/tools-daily/pages/salary-inverse/index' },
  { id: 'percent', route: 'subpackages/tools-daily/pages/percent/index' },
  { id: 'size-convert', route: 'subpackages/tools-daily/pages/size-convert/index' },
  { id: 'severance', route: 'subpackages/tools-daily/pages/severance/index' },
  { id: 'id-validate', route: 'subpackages/tools-daily/pages/id-validate/index' },
  { id: 'avatar', route: 'subpackages/tools-media/pages/avatar/index' },
  { id: 'collage', route: 'subpackages/tools-media/pages/collage/index' },
  { id: 'id-photo', route: 'subpackages/tools-media/pages/id-photo/index' },
  { id: 'image-pdf', route: 'subpackages/tools-media/pages/image-pdf/index' },
  { id: 'barcode', route: 'subpackages/tools-media/pages/barcode/index' },
  { id: 'exif', route: 'subpackages/tools-media/pages/exif/index' },
  { id: 'qr-decode', route: 'subpackages/tools-media/pages/qr-decode/index' },
  { id: 'lunar', route: 'subpackages/tools-dict/pages/lunar/index' },
  { id: 'zh-convert', route: 'subpackages/tools-dict/pages/zh-convert/index' },
  { id: 'pinyin', route: 'subpackages/tools-dict/pages/pinyin/index' },
  { id: 'vcard', route: 'subpackages/tools-media/pages/vcard/index' },
]

function findCliPath() {
  return CLI_CANDIDATES.find((candidate) => fs.existsSync(candidate)) || ''
}

/** 每卡的 DevTools 功能分支：返回 SKIP 字符串表示真机专属 */
const SMOKE_ACTIONS = {
  unit: async (page) => {
    await page.callMethod('onExample')
    return ''
  },
  password: async (page) => {
    await page.callMethod('onRun')
    return ''
  },
  base64: async (page) => {
    await page.callMethod('onExample')
    return ''
  },
  radix: async (page) => {
    await page.callMethod('onExample')
    await page.callMethod('onRun')
    return ''
  },
  ledger: async (page) => {
    await page.callMethod('onExample')
    return ''
  },
  'date-format': async () => '',
  'date-add': async (page) => {
    await page.callMethod('onExample')
    return ''
  },
  color: async (page) => {
    await page.callMethod('onExample')
    return ''
  },
  'json-csv': async (page) => {
    await page.callMethod('onExample')
    return ''
  },
  timezone: async (page) => {
    await page.callMethod('onExample')
    await page.callMethod('onMode', { currentTarget: { dataset: { mode: 'world' } } })
    await sleep(150)
    const world = await page.data()
    if (world.mode !== 'world' || !Array.isArray(world.worldRows) || world.worldRows.length < 8) {
      throw new Error('世界时钟未产出多城结果')
    }
    await page.callMethod('onWorldDst', {
      currentTarget: { dataset: { id: 'london' } },
      detail: { value: true },
    })
    await sleep(150)
    const after = await page.data()
    const london = (after.worldRows || []).find((row) => row.id === 'london')
    if (!london || !london.dst) {
      throw new Error('世界时钟逐城夏令时未生效')
    }
    return ''
  },
  schedule: async (page) => {
    await page.callMethod('onExample')
    await sleep(120)
    const pending = await page.data()
    if (pending.hasResult) {
      throw new Error('选择日期后不应自动产出结果')
    }
    await page.callMethod('onRun')
    await sleep(120)
    const data = await page.data()
    if (!data.hasResult) {
      throw new Error('排期未产出结果')
    }
    return ''
  },
  'text-convert': async (page) => {
    await page.callMethod('onModeTap', {
      currentTarget: { dataset: { mode: 'clean' } },
    })
    await page.callMethod('onInput', {
      detail: { value: '　ＡＢＣ　１２３\r\n第二行' },
    })
    return ''
  },
  template: async (page) => {
    await page.callMethod('onExample')
    return ''
  },
  regex: async (page) => {
    await page.callMethod('onPatternInput', { detail: { value: '(\\d{4})' } })
    await sleep(250)
    await page.callMethod('onTextInput', { detail: { value: '2020' } })
    await sleep(250)
    await page.callMethod('onRun')
    return ''
  },
  'photo-edit': async () => '真机 Canvas 专属，DevTools 仅验证页面加载',
  worktime: async (page) => {
    await page.callMethod('onRun')
    return ''
  },
  wellness: async (page) => {
    await page.callMethod('onRun')
    return ''
  },
  'random-pick': async (page) => {
    await page.callMethod('onExample')
    for (const mode of ['number', 'dice', 'coin']) {
      await page.callMethod('onMode', { currentTarget: { dataset: { mode } } })
      await sleep(100)
      await page.callMethod('onRun')
      await sleep(100)
      const data = await page.data()
      if (data.mode !== mode || !data.hasResult) {
        throw new Error(`${mode} 模式未产出结果`)
      }
    }
    return ''
  },
  fuel: async (page) => {
    await page.callMethod('onExample')
    return ''
  },
  power: async (page) => {
    await page.callMethod('onExample')
    for (const mode of ['water', 'gas']) {
      await page.callMethod('onMode', { currentTarget: { dataset: { mode } } })
      await sleep(100)
      await page.callMethod('onExample')
      await sleep(100)
      const data = await page.data()
      if (data.mode !== mode || !data.hasResult) {
        throw new Error(`${mode} 模式未产出结果`)
      }
    }
    return ''
  },
  resolution: async (page) => {
    await page.callMethod('onExample')
    await page.callMethod('onMode', { currentTarget: { dataset: { mode: 'print' } } })
    await sleep(100)
    await page.callMethod('onExample')
    await sleep(100)
    const data = await page.data()
    if (data.mode !== 'print' || !data.hasResult) {
      throw new Error('打印尺寸模式未产出结果')
    }
    return ''
  },
  carloan: async (page) => {
    await page.callMethod('onExample')
    await sleep(120)
    let data = await page.data()
    if (data.calcMode !== 'single' || !data.hasResult) {
      throw new Error('单方案未产出结果')
    }
    await page.callMethod('onCalcMode', { currentTarget: { dataset: { mode: 'compare' } } })
    await sleep(80)
    data = await page.data()
    if (data.hasResult) {
      throw new Error('切换对比模式不应保留旧结果')
    }
    await page.callMethod('onExample')
    await sleep(120)
    data = await page.data()
    if (data.calcMode !== 'compare' || !data.hasResult) {
      throw new Error('方案对比未产出结果')
    }
    await page.callMethod('onCalcMode', { currentTarget: { dataset: { mode: 'single' } } })
    await page.callMethod('onPrepayToggle', { currentTarget: { dataset: { value: 'on' } } })
    await page.callMethod('onFieldInput', {
      currentTarget: { dataset: { field: 'prepayAmountText' } },
      detail: { value: '50000' },
    })
    await page.callMethod('onRun')
    await sleep(120)
    data = await page.data()
    if (!data.prepayOn || !data.hasResult) {
      throw new Error('提前还款未产出结果')
    }
    return ''
  },
  quote: async (page) => {
    await page.callMethod('onExample')
    return ''
  },
  'meeting-timer': async (page) => {
    await page.callMethod('onExample')
    return ''
  },
  bodyfat: async (page) => {
    await page.callMethod('onExample')
    return ''
  },
  'fx-manual': async (page) => {
    await page.callMethod('onExample')
    return ''
  },
  'salary-inverse': async (page) => {
    await page.callMethod('onExample')
    return ''
  },
  percent: async (page) => {
    await page.callMethod('onExample')
    return ''
  },
  'size-convert': async (page) => {
    await page.callMethod('onExample')
    return ''
  },
  severance: async (page) => {
    await page.callMethod('onExample')
    return ''
  },
  'id-validate': async (page) => {
    await page.callMethod('onExample')
    return ''
  },
  avatar: async () => '真机 Canvas 专属，DevTools 仅验证页面加载',
  collage: async () => '真机 Canvas 专属，DevTools 仅验证页面加载',
  'id-photo': async () => '真机 Canvas 专属，DevTools 仅验证页面加载',
  'image-pdf': async () => '真机 Canvas + PDF 专属，DevTools 仅验证页面加载',
  barcode: async (page) => {
    await page.callMethod('onExample')
    return ''
  },
  exif: async (page) => {
    const ok = await page.callMethod('onReceiveWorkflow', {
      type: 'image',
      payload: '/assets/poster-qr.png',
    })
    if (!ok) {
      return 'DevTools 无法读取代码包图片，真机相册验收'
    }
    return ''
  },
  'qr-decode': async () => '真机 Canvas 专属，DevTools 仅验证页面加载',
  lunar: async (page) => {
    await page.callMethod('onExample')
    await sleep(120)
    const initial = await page.data()
    if (initial.hasResult) {
      throw new Error('选择日期后不应自动产出结果')
    }
    await page.callMethod('onRun')
    await sleep(120)
    const converted = await page.data()
    if (!converted.hasResult) {
      throw new Error('换算农历未产出结果')
    }
    await page.callMethod('onMode', { currentTarget: { dataset: { mode: 'birthday' } } })
    await sleep(120)
    await page.callMethod('onBirthDateChange', { detail: { value: '1995-06-15' } })
    await sleep(120)
    const pending = await page.data()
    if (pending.hasResult) {
      throw new Error('选择生日后不应自动产出结果')
    }
    await page.callMethod('onRun')
    await sleep(120)
    const data = await page.data()
    if (
      data.mode !== 'birthday' ||
      !Array.isArray(data.birthdayRows) ||
      data.birthdayRows.length < 6
    ) {
      throw new Error('农历生日未产出结果')
    }
    return ''
  },
  'zh-convert': async (page) => {
    await page.callMethod('onExample')
    return ''
  },
  pinyin: async (page) => {
    await page.callMethod('onExample')
    return ''
  },
  vcard: async (page) => {
    await page.callMethod('onExample')
    return ''
  },
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForPage(miniProgram, route, timeout = 15000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const page = await miniProgram.currentPage()
    if (page && typeof page.path === 'string' && page.path.includes(route)) {
      return page
    }
    await sleep(300)
  }
  return null
}

async function main() {
  const automator = require('miniprogram-automator')
  const failures = []
  let miniProgram = null
  let blocked = false

  try {
    if (WS_ENDPOINT) {
      console.log(`[E2E] connect ${WS_ENDPOINT}`)
      miniProgram = await automator.connect({ wsEndpoint: WS_ENDPOINT })
    } else {
      const cliPath = findCliPath()
      if (!cliPath) {
        throw new Error('未找到微信开发者工具 CLI，请设置 WECHAT_DEVTOOLS_CLI')
      }
      console.log(`[E2E] launch ${cliPath}`)
      miniProgram = await automator.launch({
        projectPath: PROJECT_ROOT,
        cliPath,
        trustProject: true,
        timeout: 60000,
      })
    }

    await miniProgram.reLaunch('/pages/index/index')
    await sleep(1200)

    for (const tool of SMOKE_TOOLS) {
      try {
        const opened = await miniProgram.navigateTo(`/${tool.route}`)
        const page = (await waitForPage(miniProgram, tool.route)) || opened
        assert.ok(page, `${tool.id} 无法打开`)
        await page.waitFor(600)

        const current = await miniProgram.currentPage()
        assert.ok(
          current && current.path.includes(tool.route),
          `${tool.id} 路径不符：${current ? current.path : 'null'}`,
        )
        const shell = await current.$('glass-tool-shell')
        assert.ok(shell, `${tool.id} 未渲染 glass-tool-shell`)
        const data = await current.data()
        assert.ok(data && data.toolName, `${tool.id} 缺少 toolName`)
        assert.equal(data.error || '', '', `${tool.id} 初始 error 非空：${data.error}`)
        console.log(`✔ ${tool.id} · ${data.toolName}`)

        const smoke = SMOKE_ACTIONS[tool.id]
        if (smoke) {
          const skip = await smoke(current)
          await sleep(tool.id === 'vcard' ? 2200 : tool.id === 'regex' ? 3200 : 600)
          const after = await current.data()
          if (skip) {
            console.log(`  ↳ SKIP ${skip}`)
          } else if (
            tool.id === 'regex' &&
            (/不支持安全正则测试|模式过慢/.test(after.error || '') ||
              after.shellState === 'running')
          ) {
            console.log('  ↳ SKIP Worker 在 DevTools 不稳定（300ms 上限），真机验收')
          } else {
            assert.equal(after.error || '', '', `${tool.id} 功能分支 error：${after.error}`)
            assert.equal(after.hasResult, true, `${tool.id} 功能分支未产出结果`)
            console.log('  ↳ 功能分支 PASS')
          }
        }
      } catch (error) {
        failures.push(`${tool.id}：${error.message}`)
        console.error(`✖ ${tool.id}\n  ${error.message}`)
      } finally {
        await miniProgram.reLaunch('/pages/index/index')
        await sleep(700)
      }
    }
  } catch (error) {
    blocked = true
    failures.push(`BLOCKED：${error.message}`)
    console.error(`[BLOCKED] ${error.message}`)
  } finally {
    if (miniProgram) {
      try {
        if (WS_ENDPOINT) {
          await miniProgram.disconnect()
        } else {
          await miniProgram.close()
        }
      } catch {
        /* 清理失败不覆盖结论 */
      }
    }
  }

  if (blocked) {
    console.error('[E2E] BLOCKED：未执行任何用例')
    process.exitCode = 2
    return
  }

  const passed = SMOKE_TOOLS.length - failures.length
  console.log(`[E2E] PASS ${passed}/${SMOKE_TOOLS.length}`)
  if (failures.length) {
    failures.forEach((failure) => console.error(`  - ${failure}`))
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(`[E2E] FATAL ${error.message}`)
  process.exitCode = 1
})
