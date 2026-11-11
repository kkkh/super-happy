/* ==========================================================================
   魔法棒 + 指令面板 · E2E
   - 真机自动化：微信开发者工具 + miniprogram-automator
   - 覆盖：魔法棒尺寸/位置、打开面板、面板安全区、搜索状态隔离、关闭复位、命令跳转
   - 默认 launch；也可通过 --connect 或 WECHAT_AUTOMATOR_WS 连接已开启的自动化端口
   - 运行：npm run test:e2e:palette
   - 连接：npm run test:e2e:palette:connect
   ========================================================================== */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const PROJECT_ROOT = path.resolve(__dirname, '../..')
const CLI_CANDIDATES = [
  process.env.WECHAT_DEVTOOLS_CLI,
  '/Applications/wechatwebdevtools.app/Contents/MacOS/cli',
  '/Applications/微信开发者工具.app/Contents/MacOS/cli',
].filter(Boolean)

const CONNECT_FLAG = process.argv.includes('--connect')
const WS_ENDPOINT =
  process.env.WECHAT_AUTOMATOR_WS || (CONNECT_FLAG ? 'ws://127.0.0.1:9420' : '')

const results = []

function findCliPath() {
  return CLI_CANDIDATES.find((candidate) => fs.existsSync(candidate)) || ''
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runStep(name, handler) {
  try {
    await handler()
    results.push({ name, status: 'PASS' })
    console.log(`✔ ${name}`)
  } catch (error) {
    results.push({ name, status: 'FAIL', error: error.message })
    console.error(`✖ ${name}\n  ${error.message}`)
  }
}

async function waitForHomePage(miniProgram, timeout = 30000) {
  const deadline = Date.now() + timeout
  let lastError = null

  while (Date.now() < deadline) {
    try {
      const page = await miniProgram.currentPage()
      if (page && typeof page.path === 'string' && page.path.includes('pages/index/index')) {
        return page
      }
    } catch (error) {
      lastError = error
    }
    await sleep(500)
  }

  if (lastError) {
    throw new Error(`等待首页超时：${lastError.message}`)
  }
  throw new Error('等待首页超时：当前页面不是 pages/index/index')
}

async function findFirst(page, selectors) {
  for (const selector of selectors) {
    const element = await page.$(selector)
    if (element) {
      return element
    }
  }
  return null
}

async function runE2E(miniProgram) {
  const page = await waitForHomePage(miniProgram)
  await page.waitFor(1200)

  await runStep('魔法棒存在且位于安全区下方', async () => {
    const wand = await page.$('.magic-wand')
    assert.ok(wand, '未找到 .magic-wand')

    const glass = await page.$('.magic-wand__glass')
    assert.ok(glass, '未找到 .magic-wand__glass')
    const size = await glass.size()
    const width = Number(size.width)
    const height = Number(size.height)
    assert.ok(width >= 42 && width <= 46, `玻璃宽度应约为 44px，实际 ${width}`)
    assert.ok(height >= 42 && height <= 46, `玻璃高度应约为 44px，实际 ${height}`)

    const icon = await page.$('.magic-wand__icon')
    assert.ok(icon, '未找到魔法棒图标')
    const iconSize = await icon.size()
    assert.ok(Number(iconSize.width) >= 24, '魔法棒图标尺寸过小')

    const offset = await wand.offset()
    const top = Number(offset && offset.top)
    assert.ok(Number.isFinite(top), '无法读取魔法棒 top')
    assert.ok(top >= 44, `魔法棒 top 应 >= 44px，实际 ${top}`)

    const info = await miniProgram.systemInfo()
    const statusBarHeight = Number(info && info.statusBarHeight) || 20
    assert.ok(top >= statusBarHeight + 16, `魔法棒应与状态栏保持距离，top=${top}`)
  })

  await runStep('首页原地搜索仍可用', async () => {
    const input = await page.$('.home-search__input')
    assert.ok(input, '未找到首页搜索框')
    await input.input('二维码')
    await page.waitFor(350)

    const names = await page.$$('.tool-name')
    const texts = []
    for (const item of names) {
      texts.push(await item.text())
    }
    assert.ok(texts.some((text) => text.includes('二维码')), '首页搜索结果未命中二维码')
    assert.equal(await input.value(), '二维码')
  })

  await runStep('点击魔法棒打开面板且不改变首页搜索', async () => {
    const wand = await page.$('.magic-wand')
    assert.ok(wand, '未找到魔法棒')
    await wand.tap()
    await page.waitFor(500)

    assert.equal(await page.data('showPalette'), true)
    const homeInput = await page.$('.home-search__input')
    assert.equal(await homeInput.value(), '二维码')
  })

  await runStep('面板已渲染并完成入场', async () => {
    const palette = await findFirst(page, [
      'command-palette >>> .glass-palette',
      'command-palette >>> .glass-palette__panel',
    ])
    assert.ok(palette, '面板未渲染')

    const component = await page.$('command-palette')
    assert.ok(component, '未找到 command-palette 组件')
    const data = await component.data()
    assert.equal(data.visible, true)
    assert.equal(data.active, true)
    assert.equal(data.query, '')
    assert.ok(Array.isArray(data.searchResults) && data.searchResults.length > 0)

    const closeText = await page.$('command-palette >>> .glass-palette__close_text')
    assert.ok(closeText, '关闭按钮文案缺失')
  })

  await runStep('面板输入“图片”命中媒体工具且首页搜索隔离', async () => {
    const component = await page.$('command-palette')
    /* 自动化无法穿透自定义组件调用原生 input，直接调用组件真实 onInput */
    await component.callMethod('onInput', { detail: { value: '图片' } })
    await page.waitFor(350)

    const data = await component.data()
    assert.equal(data.query, '图片', '面板查询未生效')
    assert.ok(
      Array.isArray(data.searchResults) && data.searchResults.length > 0,
      '面板查询结果为空',
    )
    const ids = data.searchResults.map((item) => item.id)
    assert.ok(ids.includes('tool:compress'), '图片应命中图片压缩')
    assert.ok(ids.includes('tool:palette'), '图片应命中图片取色')
    assert.ok(ids.includes('tool:nine-grid'), '图片应命中九宫格切图')
    assert.ok(
      ids.filter((id) => id.startsWith('tool:')).length >= 6,
      '图片分类别名应命中多个媒体工具',
    )

    const homeInput = await page.$('.home-search__input')
    assert.equal(await homeInput.value(), '二维码', '首页搜索值被面板污染')
  })

  await runStep('空结果展示空状态，清空后恢复结果列表', async () => {
    const component = await page.$('command-palette')
    await component.callMethod('onInput', { detail: { value: '绝不存在的关键词' } })
    await page.waitFor(300)
    let data = await component.data()
    assert.equal(data.searchResults.length, 0, '无结果时 searchResults 应为空')
    const empty = await page.$('command-palette >>> .glass-palette__empty')
    assert.ok(empty, '空状态 UI 未渲染')

    await component.callMethod('onClear')
    await page.waitFor(300)
    data = await component.data()
    assert.equal(data.query, '')
    assert.ok(data.searchResults.length > 0, '清空后未恢复默认结果')
  })

  await runStep('关闭面板后首页搜索状态原样保留', async () => {
    await page.callMethod('closePalette')
    await page.waitFor(500)

    const homeInput = await page.$('.home-search__input')
    assert.equal(await homeInput.value(), '二维码')
    assert.equal(await page.data('showPalette'), false)

    const names = await page.$$('.tool-name')
    const texts = []
    for (const item of names) {
      texts.push(await item.text())
    }
    assert.ok(texts.some((text) => text.includes('二维码')))
  })

  await runStep('再次打开面板时查询重置', async () => {
    const wand = await page.$('.magic-wand')
    await wand.tap()
    await page.waitFor(500)

    const component = await page.$('command-palette')
    assert.ok(component, '重新打开后未找到面板组件')
    const data = await component.data()
    assert.equal(data.query, '')
    assert.equal(data.visible, true)
    assert.equal(await page.data('showPalette'), true)
  })

  await runStep('执行二维码命令进入对应工具页', async () => {
    const component = await page.$('command-palette')
    await component.callMethod('onInput', { detail: { value: '二维码' } })
    await page.waitFor(350)

    const data = await component.data()
    assert.ok(
      Array.isArray(data.searchResults) && data.searchResults.length > 0,
      '没有可执行的命令',
    )
    assert.equal(data.searchResults[0].id, 'tool:qr')

    await component.callMethod('selectAt', 0)
    await page.waitFor(1200)

    const current = await miniProgram.currentPage()
    assert.ok(current, '命令执行后无法读取当前页面')
    assert.ok(
      current.path.includes('subpackages/tools-media/pages/qr/index'),
      `应进入二维码工具页，实际 ${current.path}`,
    )
  })
}

async function main() {
  const automator = require('miniprogram-automator')
  let miniProgram = null
  let mode = ''

  try {
    if (WS_ENDPOINT) {
      mode = `connect ${WS_ENDPOINT}`
      miniProgram = await automator.connect({ wsEndpoint: WS_ENDPOINT })
    } else {
      const cliPath = findCliPath()
      if (!cliPath) {
        throw new Error(
          '未找到微信开发者工具 CLI，请设置 WECHAT_DEVTOOLS_CLI 或使用 --connect',
        )
      }
      mode = `launch ${cliPath}`
      miniProgram = await automator.launch({
        projectPath: PROJECT_ROOT,
        cliPath,
        trustProject: true,
        timeout: 60000,
      })
    }

    console.log(`[E2E] mode: ${mode}`)
    await runE2E(miniProgram)
  } catch (error) {
    console.error(`[BLOCKED] ${error.message}`)
    if (miniProgram) {
      try {
        if (WS_ENDPOINT) {
          await miniProgram.disconnect()
        } else {
          await miniProgram.close()
        }
      } catch {
        /* 清理失败不覆盖 BLOCKED 结论 */
      }
    }
    process.exitCode = 2
    return
  }

  try {
    if (WS_ENDPOINT) {
      await miniProgram.disconnect()
    } else {
      await miniProgram.close()
    }
  } catch {
    /* 清理失败不覆盖测试结论 */
  }

  const failed = results.filter((item) => item.status === 'FAIL')
  if (failed.length > 0) {
    console.error(`\n[E2E] FAIL ${failed.length}/${results.length}`)
    process.exitCode = 1
    return
  }

  console.log(`\n[E2E] PASS ${results.length}/${results.length}`)
}

main().catch((error) => {
  console.error(`[E2E] FATAL ${error.stack || error.message}`)
  process.exitCode = 1
})
