/* ==========================================================================
   随机抽签引擎 · Fisher-Yates + 可注入 RNG
   - 页面与 silent 执行器共用；默认 Math.random，测试注入固定序列
   - 重复行先去重（保留首次出现顺序）；数量不足按去重后判断
   ========================================================================== */

export const MAX_OPTIONS = 100
export const MAX_PICK = 10
export const MAX_RANDOM_INT = 1_000_000_000
export const MAX_DICE_COUNT = 6
export const MAX_COIN_COUNT = 10
export const DICE_SIDES = [4, 6, 8, 10, 12, 20] as const

export type DiceSide = (typeof DICE_SIDES)[number]
export type CoinFace = '正' | '反'

export type OptionSeparator = 'newline' | 'comma' | 'slash' | 'semicolon' | 'pipe'

const SEPARATOR_PATTERNS: Record<OptionSeparator, RegExp> = {
  newline: /\r\n|\r|\n/,
  comma: /[,，、]/,
  slash: /[/／]/,
  semicolon: /[;；]/,
  pipe: /[|｜]/,
}

export type PickResult =
  | { ok: true; picked: string[]; remaining: string[] }
  | { ok: false; code: 'empty' | 'count' | 'insufficient' }

function clampRandom(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.min(0.999999, Math.max(0, value))
}

/** 按行拆分、去首尾空格、去重并保留首次出现顺序 */
export function splitOptions(text: string, limit = MAX_OPTIONS): string[] {
  return splitOptionsBy(text, 'newline', limit)
}

/** 按指定分隔符拆分；支持换行 / 中英文逗号顿号 / 斜杠 / 分号 / 竖线 */
export function splitOptionsBy(
  text: string,
  separator: OptionSeparator = 'newline',
  limit = MAX_OPTIONS,
): string[] {
  const pattern = SEPARATOR_PATTERNS[separator] ?? SEPARATOR_PATTERNS.newline
  const seen = new Set<string>()
  const options: string[] = []
  for (const part of text.split(pattern)) {
    const value = part.trim()
    if (!value || seen.has(value)) {
      continue
    }
    seen.add(value)
    options.push(value)
    if (options.length >= limit) {
      break
    }
  }
  return options
}

/** Fisher-Yates 洗牌，返回新数组，不修改入参 */
export function shuffle<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(clampRandom(rng()) * (index + 1))
    const current = result[index]
    result[index] = result[swap]
    result[swap] = current
  }
  return result
}

/** 抽取选项：默认不重复；允许重复时选项不消耗 */
export function pickOptions(
  options: readonly string[],
  count: number,
  allowRepeat = false,
  rng: () => number = Math.random,
): PickResult {
  if (options.length === 0) {
    return { ok: false, code: 'empty' }
  }
  if (!Number.isInteger(count) || count < 1 || count > MAX_PICK) {
    return { ok: false, code: 'count' }
  }
  if (!allowRepeat && count > options.length) {
    return { ok: false, code: 'insufficient' }
  }
  if (allowRepeat) {
    const picked: string[] = []
    for (let index = 0; index < count; index += 1) {
      const target = Math.floor(clampRandom(rng()) * options.length)
      picked.push(options[target])
    }
    return { ok: true, picked, remaining: [...options] }
  }
  const picked = shuffle(options, rng).slice(0, count)
  const pickedSet = new Set(picked)
  return {
    ok: true,
    picked,
    remaining: options.filter((option) => !pickedSet.has(option)),
  }
}

export function pickUnique(
  options: readonly string[],
  count: number,
  rng: () => number = Math.random,
): PickResult {
  return pickOptions(options, count, false, rng)
}

/* ---- 随机数 / 骰子 / 硬币 ---- */

export interface RandomNumberResult {
  value: number
  min: number
  max: number
  /** 可取值的数量，含两端 */
  range: number
}

export interface DiceResult {
  values: number[]
  sides: DiceSide
  count: number
  total: number
}

export interface CoinResult {
  values: CoinFace[]
  heads: number
  tails: number
  count: number
}

/** 闭区间随机整数；范围与绝对值均限制在 10 亿内 */
export function randomInt(
  min: number,
  max: number,
  rng: () => number = Math.random,
): RandomNumberResult | null {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max) {
    return null
  }
  if (Math.abs(min) > MAX_RANDOM_INT || Math.abs(max) > MAX_RANDOM_INT) {
    return null
  }
  const range = max - min + 1
  return {
    value: min + Math.floor(clampRandom(rng()) * range),
    min,
    max,
    range,
  }
}

/** 掷骰子：1–6 颗，面数仅支持 D4 / D6 / D8 / D10 / D12 / D20 */
export function rollDice(
  count: number,
  sides: DiceSide,
  rng: () => number = Math.random,
): DiceResult | null {
  if (!Number.isInteger(count) || count < 1 || count > MAX_DICE_COUNT) {
    return null
  }
  if (!DICE_SIDES.includes(sides)) {
    return null
  }
  const values: number[] = []
  for (let index = 0; index < count; index += 1) {
    values.push(1 + Math.floor(clampRandom(rng()) * sides))
  }
  return {
    values,
    sides,
    count,
    total: values.reduce((sum, value) => sum + value, 0),
  }
}

/** 抛硬币：1–10 枚，每枚独立 50% 正反 */
export function flipCoins(count: number, rng: () => number = Math.random): CoinResult | null {
  if (!Number.isInteger(count) || count < 1 || count > MAX_COIN_COUNT) {
    return null
  }
  const values: CoinFace[] = []
  let heads = 0
  for (let index = 0; index < count; index += 1) {
    if (clampRandom(rng()) < 0.5) {
      values.push('正')
      heads += 1
    } else {
      values.push('反')
    }
  }
  return { values, heads, tails: count - heads, count }
}

export function randomNumberSummary(result: RandomNumberResult): string {
  return `随机数：${result.value}（${result.min}–${result.max}）`
}

export function diceSummary(result: DiceResult): string {
  return `掷骰子：${result.values.join(' + ')} = ${result.total}（D${result.sides} × ${result.count}）`
}

export function coinSummary(result: CoinResult): string {
  return `抛硬币：${result.values.join(' ')}（正 ${result.heads} / 反 ${result.tails}）`
}
