/* ==========================================================================
   tools-daily 水电燃气费 UI 常量
   - 模式文案与空输入模板下沉到 lib，控制单页 24KB 体积
   ========================================================================== */
import type { PowerDraftData } from './draft'

export type PowerMode = 'electric' | 'water' | 'gas'

export interface PowerModeCopy {
  runLabel: string
  emptyTitle: string
  emptySub: string
  priceLabel: string
  tierTitle: string
  tierUnit: string
  usageLabel: string
}

export const MODE_COPY: Record<PowerMode, PowerModeCopy> = {
  electric: {
    runLabel: '估算电费',
    emptyTitle: '填写功率与时长，估算用电与电费',
    emptySub: '支持平价电价与最多 3 档阶梯；结果只在本机计算',
    priceLabel: '平价电价（元/度）',
    tierTitle: '阶梯电价（可选，最多 3 档）',
    tierUnit: '度',
    usageLabel: '用电量',
  },
  water: {
    runLabel: '估算水费',
    emptyTitle: '填写用水量与单价，估算水费',
    emptySub: '支持平价水价与最多 3 档阶梯水价；可加基础费',
    priceLabel: '平价水价（元/吨）',
    tierTitle: '阶梯水价（可选，最多 3 档）',
    tierUnit: '吨',
    usageLabel: '用水量（吨）',
  },
  gas: {
    runLabel: '估算燃气费',
    emptyTitle: '填写用气量与单价，估算燃气费',
    emptySub: '支持平价气价与最多 3 档阶梯气价；可加基础费',
    priceLabel: '平价气价（元/m³）',
    tierTitle: '阶梯气价（可选，最多 3 档）',
    tierUnit: 'm³',
    usageLabel: '用气量（m³）',
  },
}

export function emptyInputs(): PowerDraftData {
  return {
    powerText: '',
    hoursText: '',
    daysText: '',
    usageText: '',
    baseFeeText: '',
    priceText: '',
    tier1Limit: '',
    tier1Price: '',
    tier2Limit: '',
    tier2Price: '',
    tier3Limit: '',
    tier3Price: '',
  }
}
