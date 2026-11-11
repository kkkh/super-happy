/* ==========================================================================
   tools-daily 草稿补丁
   - 页面只保留 collect/apply 两个薄方法，避免单页超过 24KB
   - 只处理页面 data 中的输入字段，不包含任何结果
   ========================================================================== */

export type PowerMode = 'electric' | 'water' | 'gas'

export interface PowerDraftData {
  powerText: string
  hoursText: string
  daysText: string
  usageText: string
  baseFeeText: string
  priceText: string
  tier1Limit: string
  tier1Price: string
  tier2Limit: string
  tier2Price: string
  tier3Limit: string
  tier3Price: string
}

const POWER_FIELDS: Array<keyof PowerDraftData> = [
  'powerText',
  'hoursText',
  'daysText',
  'usageText',
  'baseFeeText',
  'priceText',
  'tier1Limit',
  'tier1Price',
  'tier2Limit',
  'tier2Price',
  'tier3Limit',
  'tier3Price',
]

export interface PowerDraftPatch {
  mode: PowerMode
  fields: Record<string, string>
}

export function collectPowerDraft(data: PowerDraftData): Record<string, string> {
  const out: Record<string, string> = {}
  POWER_FIELDS.forEach((key) => {
    out[key] = String(data[key] ?? '')
  })
  return out
}

export function powerDraftPatch(input: Record<string, string>, mode: string): PowerDraftPatch {
  const nextMode: PowerMode = mode === 'water' || mode === 'gas' ? mode : 'electric'
  const fields: Record<string, string> = {}
  POWER_FIELDS.forEach((key) => {
    fields[key] = input[key] ?? ''
  })
  return { mode: nextMode, fields }
}
