/* ==========================================================================
   随机决定 · tools-daily 兼容出口
   实现已下沉到 core/toolbox/engines/random.ts
   禁止在此新增实现，避免页面与 silent 执行器出现两份逻辑
   ========================================================================== */
export {
  DICE_SIDES,
  MAX_COIN_COUNT,
  MAX_DICE_COUNT,
  MAX_OPTIONS,
  MAX_PICK,
  MAX_RANDOM_INT,
  coinSummary,
  diceSummary,
  flipCoins,
  pickOptions,
  pickUnique,
  randomInt,
  randomNumberSummary,
  rollDice,
  shuffle,
  splitOptions,
  splitOptionsBy,
  type CoinFace,
  type CoinResult,
  type DiceResult,
  type DiceSide,
  type OptionSeparator,
  type PickResult,
  type RandomNumberResult,
} from '../../../core/toolbox/engines/random'
