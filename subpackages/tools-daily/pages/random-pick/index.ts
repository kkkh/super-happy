/* ==========================================================================
   随机决定 · 抽签 / 随机数 / 骰子 / 硬币
   - 四种模式共用同一 RNG 与安全边界；抽签保持 Fisher-Yates
   - 所有模式只在点击运行按钮后生成；输入变化清空旧结果
   ========================================================================== */
import { tapTick } from '../../../../core/utils/haptics'
import {
  DICE_SIDES,
  MAX_COIN_COUNT,
  MAX_DICE_COUNT,
  MAX_PICK,
  MAX_RANDOM_INT,
  coinSummary,
  diceSummary,
  flipCoins,
  pickOptions,
  randomInt,
  randomNumberSummary,
  rollDice,
  splitOptionsBy,
  type DiceSide,
  type OptionSeparator,
} from '../../lib/random'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'
import { copyText } from '../../lib/ui'

interface ResultRow {
  k: string
  v: string
}

type RandomMode = 'pick' | 'number' | 'dice' | 'coin'

const MODES: Array<{ key: RandomMode; label: string }> = [
  { key: 'pick', label: '抽签' },
  { key: 'number', label: '随机数' },
  { key: 'dice', label: '骰子' },
  { key: 'coin', label: '硬币' },
]

const MODE_COPY: Record<
  RandomMode,
  { runLabel: string; emptyTitle: string; emptySub: string }
> = {
  pick: {
    runLabel: '开始抽取',
    emptyTitle: '每行一个选项，交给随机',
    emptySub: '最多 100 项、一次抽 1–10 个；重复行自动去重',
  },
  number: {
    runLabel: '生成随机数',
    emptyTitle: '设置范围，生成随机整数',
    emptySub: '包含最小值和最大值；绝对值不超过 10 亿',
  },
  dice: {
    runLabel: '掷骰子',
    emptyTitle: '选择骰子数量与面数',
    emptySub: '支持 D4 / D6 / D8 / D10 / D12 / D20',
  },
  coin: {
    runLabel: '抛硬币',
    emptyTitle: '选择硬币数量',
    emptySub: '每枚硬币独立 50% 正反',
  },
}

const SEPARATORS: Array<{ key: OptionSeparator; label: string }> = [
  { key: 'newline', label: '换行' },
  { key: 'comma', label: '逗号' },
  { key: 'slash', label: '斜杠' },
  { key: 'semicolon', label: '分号' },
  { key: 'pipe', label: '竖线' },
]

function emptyResult() {
  return {
    resultLabel: '抽中',
    resultMain: '',
    resultRows: [] as ResultRow[],
    pickedRows: [] as string[],
    remainingRows: [] as string[],
    resultText: '',
    pickSummary: '',
    stale: false,
    hasResult: false,
    shellState: 'idle',
    error: '',
    posterData: null as IPosterData | null,
  }
}

function parseIntText(text: string): number | null {
  const value = String(text).trim()
  if (!value) {
    return null
  }
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

Page({
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: '随机决定',
    kicker: '生活健康',
    desc: '抽签 · 随机数 · 骰子 · 硬币',
    mode: 'pick' as RandomMode,
    modes: MODES,
    runLabel: MODE_COPY.pick.runLabel,
    emptyTitle: MODE_COPY.pick.emptyTitle,
    emptySub: MODE_COPY.pick.emptySub,
    optionsText: '',
    separators: SEPARATORS,
    separator: 'newline' as OptionSeparator,
    pickCount: '1',
    allowRepeat: false,
    numberMin: '1',
    numberMax: '100',
    diceCount: '2',
    diceSides: 6 as DiceSide,
    diceSideOptions: DICE_SIDES,
    coinCount: '3',
    canRun: false,
    ...emptyResult(),
  },

  onLoad() {
    this.refreshCanRun()
  },

  onMode(event: WechatMiniprogram.TouchEvent) {
    const mode = event.currentTarget.dataset.mode as RandomMode
    if (!MODES.some((item) => item.key === mode) || mode === this.data.mode) {
      return
    }
    tapTick()
    const copy = MODE_COPY[mode]
    this.setData(
      {
        ...emptyResult(),
        mode,
        runLabel: copy.runLabel,
        emptyTitle: copy.emptyTitle,
        emptySub: copy.emptySub,
      },
      () => this.refreshCanRun(),
    )
  },

  onFieldInput(event: WechatMiniprogram.Input) {
    const field = String(event.currentTarget.dataset.field || '')
    if (!field) {
      return
    }
    this.setData({ [field]: String(event.detail.value || ''), error: '' }, () => {
      this.invalidate()
      this.refreshCanRun()
    })
  },

  onRepeat(event: { detail: { value: boolean } }) {
    this.setData({ allowRepeat: Boolean(event.detail.value), error: '' }, () => {
      this.invalidate()
      this.refreshCanRun()
    })
  },

  onSeparator(event: WechatMiniprogram.TouchEvent) {
    const separator = event.currentTarget.dataset.key as OptionSeparator
    if (
      !SEPARATORS.some((item) => item.key === separator) ||
      separator === this.data.separator
    ) {
      return
    }
    tapTick()
    this.setData({ separator, error: '' }, () => {
      this.invalidate()
      this.refreshCanRun()
    })
  },

  onSides(event: WechatMiniprogram.TouchEvent) {
    const sides = Number(event.currentTarget.dataset.sides) as DiceSide
    if (!DICE_SIDES.includes(sides) || sides === this.data.diceSides) {
      return
    }
    tapTick()
    this.setData({ diceSides: sides, error: '' }, () => {
      this.invalidate()
      this.refreshCanRun()
    })
  },

  onExample() {
    tapTick()
    if (this.data.mode === 'number') {
      this.setData({ numberMin: '1', numberMax: '100', error: '' }, () => {
        this.refreshCanRun()
        this.onRun()
      })
      return
    }
    if (this.data.mode === 'dice') {
      this.setData({ diceCount: '2', diceSides: 6, error: '' }, () => {
        this.refreshCanRun()
        this.onRun()
      })
      return
    }
    if (this.data.mode === 'coin') {
      this.setData({ coinCount: '3', error: '' }, () => {
        this.refreshCanRun()
        this.onRun()
      })
      return
    }
    this.setData(
      {
        optionsText: ['牛肉面', '麻辣烫', '沙拉', '寿司', '盖饭'].join('\n'),
        separator: 'newline',
        pickCount: '1',
        allowRepeat: false,
        error: '',
      },
      () => {
        this.refreshCanRun()
        this.onRun()
      },
    )
  },

  onReset() {
    const copy = MODE_COPY[this.data.mode]
    this.setData(
      {
        ...emptyResult(),
        optionsText: '',
        separator: 'newline',
        pickCount: '1',
        allowRepeat: false,
        numberMin: '1',
        numberMax: '100',
        diceCount: '2',
        diceSides: 6,
        coinCount: '3',
        runLabel: copy.runLabel,
        emptyTitle: copy.emptyTitle,
        emptySub: copy.emptySub,
      },
      () => this.refreshCanRun(),
    )
  },

  /* ---- 草稿：模式与选项；恢复后不自动生成随机结果 ---- */
  draftMode(): string {
    return this.data.mode
  },

  collectDraftInput(): Record<string, string> {
    return {
      optionsText: this.data.optionsText,
      separator: this.data.separator,
      pickCount: this.data.pickCount,
      allowRepeat: this.data.allowRepeat ? '1' : '0',
      numberMin: this.data.numberMin,
      numberMax: this.data.numberMax,
      diceCount: this.data.diceCount,
      diceSides: `${this.data.diceSides}`,
      coinCount: this.data.coinCount,
    }
  },

  applyDraftInput(input: Record<string, string>, mode: string): void {
    const nextMode: RandomMode =
      mode === 'number' || mode === 'dice' || mode === 'coin' ? mode : 'pick'
    const copy = MODE_COPY[nextMode]
    const sides = Number(input.diceSides) as DiceSide
    this.setData(
      {
        ...emptyResult(),
        mode: nextMode,
        runLabel: copy.runLabel,
        emptyTitle: copy.emptyTitle,
        emptySub: copy.emptySub,
        optionsText: input.optionsText ?? '',
        separator: SEPARATORS.some((item) => item.key === input.separator)
          ? (input.separator as OptionSeparator)
          : 'newline',
        pickCount: input.pickCount ?? '1',
        allowRepeat: input.allowRepeat === '1',
        numberMin: input.numberMin ?? '1',
        numberMax: input.numberMax ?? '100',
        diceCount: input.diceCount ?? '2',
        diceSides: DICE_SIDES.includes(sides) ? sides : 6,
        coinCount: input.coinCount ?? '3',
      },
      () => this.refreshCanRun(),
    )
  },

  onCopy() {
    if (!this.data.resultText) {
      return
    }
    tapTick()
    copyText(this.data.resultText, '结果已复制')
  },

  onRun() {
    if (this.data.mode === 'number') {
      this.runNumber()
      return
    }
    if (this.data.mode === 'dice') {
      this.runDice()
      return
    }
    if (this.data.mode === 'coin') {
      this.runCoin()
      return
    }
    this.runPick()
  },

  runPick() {
    const options = splitOptionsBy(this.data.optionsText, this.data.separator)
    const count = Number(this.data.pickCount)
    const result = pickOptions(options, count, this.data.allowRepeat)
    if (!result.ok) {
      const message =
        result.code === 'empty'
          ? '请至少输入一个选项'
          : result.code === 'count'
            ? `抽取数量需在 1–${MAX_PICK} 之间`
            : '选项数量不足，请减少抽取数量或开启可重复'
      this.fail(message)
      return
    }
    const modeText = this.data.allowRepeat ? '可重复' : '不重复'
    const summary = `抽中：${result.picked.join('、')}（从 ${options.length} 项中抽取，${modeText}）`
    const poster: IPosterData = {
      toolName: '随机决定',
      category: '生活健康',
      mainResult: result.picked.length === 1 ? result.picked[0] : `${result.picked.length} 项`,
      resultLabel: '抽中',
      params: [
        { label: '选项数', value: `${options.length}` },
        { label: '模式', value: modeText },
      ],
      extras: result.picked.slice(0, 4),
    }
    this.applyResult(
      '抽中',
      result.picked.length === 1 ? result.picked[0] : `抽中 ${result.picked.length} 项`,
      [
        { k: '抽取数量', v: `${result.picked.length}` },
        { k: '选项数', v: `${options.length}` },
        { k: '模式', v: modeText },
        { k: '剩余', v: `${result.remaining.length}` },
      ],
      summary,
      poster,
      result.picked.map((item, index) => `${index + 1}. ${item}`),
      result.remaining.slice(0, 20).map((item, index) => `${index + 1}. ${item}`),
    )
  },

  runNumber() {
    const min = parseIntText(this.data.numberMin)
    const max = parseIntText(this.data.numberMax)
    const result =
      min === null || max === null ? null : randomInt(min, max)
    if (!result) {
      this.fail(`请输入 -${MAX_RANDOM_INT} 至 ${MAX_RANDOM_INT} 之间的整数，且最小值不大于最大值`)
      return
    }
    const summary = randomNumberSummary(result)
    const poster: IPosterData = {
      toolName: '随机决定',
      category: '生活健康',
      mainResult: `${result.value}`,
      resultLabel: '随机数',
      params: [
        { label: '范围', value: `${result.min} ~ ${result.max}` },
        { label: '可取值', value: `${result.range}` },
      ],
      extras: [summary],
    }
    this.applyResult('随机数', `${result.value}`, [
      { k: '最小值', v: `${result.min}` },
      { k: '最大值', v: `${result.max}` },
      { k: '可取值数量', v: `${result.range}` },
    ], summary, poster)
  },

  runDice() {
    const count = parseIntText(this.data.diceCount)
    const result = count === null ? null : rollDice(count, this.data.diceSides)
    if (!result) {
      this.fail(`骰子数量需为 1–${MAX_DICE_COUNT} 的整数`)
      return
    }
    const summary = diceSummary(result)
    const poster: IPosterData = {
      toolName: '随机决定',
      category: '生活健康',
      mainResult: `${result.total}`,
      resultLabel: '骰子合计',
      params: [
        { label: '骰子', value: `D${result.sides} × ${result.count}` },
        { label: '点数', value: result.values.join(' + ') },
      ],
      extras: [summary],
    }
    this.applyResult('骰子合计', `${result.total}`, [
      { k: '点数', v: result.values.join(' + ') },
      { k: '合计', v: `${result.total}` },
      { k: '骰子', v: `D${result.sides} × ${result.count}` },
      { k: '理论范围', v: `${result.count}–${result.count * result.sides}` },
    ], summary, poster)
  },

  runCoin() {
    const count = parseIntText(this.data.coinCount)
    const result = count === null ? null : flipCoins(count)
    if (!result) {
      this.fail(`硬币数量需为 1–${MAX_COIN_COUNT} 的整数`)
      return
    }
    const summary = coinSummary(result)
    const poster: IPosterData = {
      toolName: '随机决定',
      category: '生活健康',
      mainResult: `${result.heads} 正 · ${result.tails} 反`,
      resultLabel: '抛硬币',
      params: [
        { label: '硬币数', value: `${result.count}` },
        { label: '结果', value: result.values.join(' ') },
      ],
      extras: [summary],
    }
    this.applyResult('抛硬币', `${result.heads} 正 · ${result.tails} 反`, [
      { k: '结果', v: result.values.join(' ') },
      { k: '正面', v: `${result.heads}` },
      { k: '反面', v: `${result.tails}` },
      { k: '硬币数', v: `${result.count}` },
    ], summary, poster)
  },

  applyResult(
    label: string,
    main: string,
    rows: ResultRow[],
    summary: string,
    poster: IPosterData,
    pickedRows: string[] = [],
    remainingRows: string[] = [],
  ) {
    this.setData({
      shellState: 'done',
      hasResult: true,
      stale: false,
      error: '',
      resultLabel: label,
      resultMain: main,
      resultRows: rows,
      pickedRows,
      remainingRows,
      resultText: summary,
      pickSummary: summary,
      posterData: poster,
    })
  },

  fail(message: string) {
    this.setData({ ...emptyResult(), shellState: 'invalid', error: message })
  },

  refreshCanRun() {
    let canRun = false
    if (this.data.mode === 'pick') {
      const options = splitOptionsBy(this.data.optionsText, this.data.separator)
      const count = Number(this.data.pickCount)
      canRun =
        options.length > 0 &&
        Number.isInteger(count) &&
        count >= 1 &&
        count <= MAX_PICK &&
        (this.data.allowRepeat || count <= options.length)
    } else if (this.data.mode === 'number') {
      const min = parseIntText(this.data.numberMin)
      const max = parseIntText(this.data.numberMax)
      canRun =
        min !== null &&
        max !== null &&
        min <= max &&
        Math.abs(min) <= MAX_RANDOM_INT &&
        Math.abs(max) <= MAX_RANDOM_INT
    } else if (this.data.mode === 'dice') {
      const count = parseIntText(this.data.diceCount)
      canRun = count !== null && count >= 1 && count <= MAX_DICE_COUNT
    } else {
      const count = parseIntText(this.data.coinCount)
      canRun = count !== null && count >= 1 && count <= MAX_COIN_COUNT
    }
    this.setData({ canRun })
  },

  invalidate() {
    if (!this.data.hasResult) {
      return
    }
    this.setData({ ...emptyResult(), stale: true })
  },
})
