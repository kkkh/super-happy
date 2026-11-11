/* ==========================================================================
   批 1 · 随机决定（random-pick）
   - 引擎黄金值：固定 RNG 可复现、去重、数量不足、上限
   - 契约：页面 / 注册 / 帮助 / silent 工作流
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { registerHooks } = require('node:module')

const ROOT = path.resolve(__dirname, '..')
const URL_ROOT = `${require('node:url').pathToFileURL(ROOT).href}/`
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !path.extname(specifier)) {
      return nextResolve(`${specifier}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})

async function loadEngine() {
  return import(`${URL_ROOT}core/toolbox/engines/random.ts`)
}

test('随机：固定 RNG 可复现 Fisher-Yates 结果', async () => {
  const random = await loadEngine()
  const first = random.pickUnique(['A', 'B', 'C'], 2, () => 0)
  assert.deepEqual(first.picked, ['B', 'C'])
  assert.deepEqual(first.remaining, ['A'])

  const stable = random.pickUnique(['A', 'B', 'C'], 2, () => 0.999)
  assert.deepEqual(stable.picked, ['A', 'B'])

  assert.deepEqual(
    random.pickUnique(['A', 'B', 'C', 'D'], 3, () => 0).picked,
    random.pickUnique(['A', 'B', 'C', 'D'], 3, () => 0).picked,
  )
})

test('随机：重复行先去重并保留首次出现顺序', async () => {
  const random = await loadEngine()
  assert.deepEqual(random.splitOptions('A\nB\nA\n\n B \nC'), ['A', 'B', 'C'])
  const result = random.pickUnique(random.splitOptions('A\nB\nA\nC'), 3, () => 0)
  assert.equal(result.ok, true)
  assert.equal(result.picked.length, 3)
})

test('随机：逗号 / 斜杠 / 分号 / 竖线分隔与去重', async () => {
  const random = await loadEngine()
  assert.deepEqual(random.splitOptionsBy('A, B，C、A', 'comma'), ['A', 'B', 'C'])
  assert.deepEqual(random.splitOptionsBy('A/B／C/A', 'slash'), ['A', 'B', 'C'])
  assert.deepEqual(random.splitOptionsBy('A;B；C', 'semicolon'), ['A', 'B', 'C'])
  assert.deepEqual(random.splitOptionsBy('A|B｜C', 'pipe'), ['A', 'B', 'C'])
  assert.deepEqual(random.splitOptionsBy('A\nB', 'comma'), ['A\nB'])
})

test('随机：数量不足、数量越界与允许重复', async () => {
  const random = await loadEngine()
  assert.equal(random.pickUnique(['A', 'B'], 3).code, 'insufficient')
  assert.equal(random.pickUnique(['A'], 0).code, 'count')
  assert.equal(random.pickUnique(['A'], 11).code, 'count')
  assert.equal(random.pickUnique([], 1).code, 'empty')

  const repeated = random.pickOptions(['A', 'B'], 3, true, () => 0)
  assert.equal(repeated.ok, true)
  assert.deepEqual(repeated.picked, ['A', 'A', 'A'])
  assert.deepEqual(repeated.remaining, ['A', 'B'])
})

test('随机数：闭区间、固定 RNG 与边界', async () => {
  const random = await loadEngine()
  assert.deepEqual(random.randomInt(1, 100, () => 0), {
    value: 1,
    min: 1,
    max: 100,
    range: 100,
  })
  assert.equal(random.randomInt(1, 100, () => 0.999999).value, 100)
  assert.equal(random.randomInt(-5, 5, () => 0.6).value, 1)
  assert.equal(random.randomInt(10, 10, () => 0.7).value, 10)
  assert.equal(random.randomInt(10, 1), null)
  assert.equal(random.randomInt(1.5, 10), null)
  assert.equal(random.randomInt(-1000000001, 1), null)
  assert.match(random.randomNumberSummary(random.randomInt(1, 6, () => 0)), /随机数：1/)
})

test('骰子：颗数 / 面数边界、固定 RNG 与合计', async () => {
  const random = await loadEngine()
  const sequence = [0, 0.999]
  const dice = random.rollDice(2, 6, () => sequence.shift() ?? 0)
  assert.ok(dice)
  assert.deepEqual(dice.values, [1, 6])
  assert.equal(dice.total, 7)
  assert.equal(dice.sides, 6)
  assert.equal(dice.count, 2)

  assert.equal(random.rollDice(0, 6), null)
  assert.equal(random.rollDice(7, 6), null)
  assert.equal(random.rollDice(1, 7), null)
  assert.deepEqual(random.DICE_SIDES, [4, 6, 8, 10, 12, 20])
  assert.match(random.diceSummary(dice), /掷骰子：1 \+ 6 = 7/)
})

test('硬币：正反计数、固定 RNG 与边界', async () => {
  const random = await loadEngine()
  const sequence = [0, 0.4, 0.9]
  const coins = random.flipCoins(3, () => sequence.shift() ?? 0)
  assert.ok(coins)
  assert.deepEqual(coins.values, ['正', '正', '反'])
  assert.equal(coins.heads, 2)
  assert.equal(coins.tails, 1)
  assert.equal(coins.count, 3)

  assert.equal(random.flipCoins(0), null)
  assert.equal(random.flipCoins(11), null)
  assert.match(random.coinSummary(coins), /正 2 \/ 反 1/)
})

test('随机：100 项上限与 silent / 页面契约', async () => {
  const random = await loadEngine()
  const hundred = Array.from({ length: 100 }, (_, index) => `选项${index + 1}`)
  const picked = random.pickUnique(hundred, 10, () => 0)
  assert.equal(picked.ok, true)
  assert.equal(picked.picked.length, 10)
  assert.equal(random.splitOptions(Array.from({ length: 101 }, (_, i) => `O${i}`).join('\n')).length, 100)

  const app = JSON.parse(read('app.json'))
  const daily = app.subpackages.find((item) => item.root === 'subpackages/tools-daily')
  assert.ok(daily.pages.includes('pages/random-pick/index'), 'app.json 未注册页面')

  for (const ext of ['.ts', '.json', '.wxml', '.wxss']) {
    assert.ok(
      fs.existsSync(path.join(ROOT, `subpackages/tools-daily/pages/random-pick/index${ext}`)),
      `缺少页面文件 ${ext}`,
    )
  }

  const wxml = read('subpackages/tools-daily/pages/random-pick/index.wxml')
  assert.match(wxml, /tool-id="random-pick"/)
  assert.match(wxml, /bind:run="onRun"/)
  assert.match(wxml, /poster-data="\{\{posterData\}\}"/)
  assert.match(wxml, /data-mode="\{\{item.key\}\}"/)
  assert.match(wxml, /mode === 'number'/)
  assert.match(wxml, /mode === 'dice'/)
  assert.match(wxml, /coinCount/)
  assert.match(wxml, /onSides/)
  assert.match(wxml, /diceSideOptions/)

  const ts = read('subpackages/tools-daily/pages/random-pick/index.ts')
  assert.match(ts, /onShareAppMessage\s*\(/)
  assert.match(ts, /onShareTimeline\s*\(/)
  assert.match(ts, /runNumber/)
  assert.match(ts, /runDice/)
  assert.match(ts, /runCoin/)
  assert.equal(/onReceiveWorkflow/.test(ts), false, 'silent 卡不得声明注入接口')
  assert.equal(/wx\.request|uploadFile|downloadFile/.test(ts), false)

  const registry = read('core/toolbox/registry.ts')
  assert.match(registry, /id: 'random-pick'/)
  assert.match(registry, /weight: 70/)
  assert.match(read('subpackages/grow/lib/help.ts'), /'random-pick': \{/)

  const config = await import(`${URL_ROOT}core/workflow/workflowConfig.ts`)
  assert.equal(config.WORKFLOW_ROUTING['random-pick'], 'silent')
  assert.deepEqual(config.WORKFLOW_ACCEPTS['random-pick'], ['text'])

  const source = await import(`${URL_ROOT}core/workflow/workflowSource.ts`)
  assert.deepEqual(source.WORKFLOW_SOURCE_KEYS['random-pick'].text, ['pickSummary'])

  const silent = await import(`${URL_ROOT}core/workflow/workflowSilent.ts`)
  const output = silent.executeSilentTool('random-pick', {
    type: 'text',
    payload: 'A\nB',
    context: { pickCount: 1 },
  })
  assert.match(output.payload, /^抽中：/)
  assert.throws(
    () =>
      silent.executeSilentTool('random-pick', {
        type: 'text',
        payload: 'A\nB',
        context: { pickCount: 5 },
      }),
    /选项数量不足/,
  )
})
