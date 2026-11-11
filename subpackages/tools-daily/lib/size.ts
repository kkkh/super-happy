/* ==========================================================================
   尺码换算 · 鞋码 / 服装 / 戒指
   - 纯本地静态对照 + 线性换算；不联网、不读设备
   - 鞋码：EU 与中国码同码，US / UK / 脚长按性别换算，允许半码
   - 服装：XS–XXL 常见版型参考，给出身高与胸围
   - 戒指：以周长 mm 为唯一基准，中国码 = 周长 − 40
   ========================================================================== */

export type ShoeGender = 'male' | 'female'
export type ShoeRegion = 'cn' | 'us' | 'uk' | 'foot'

export interface ShoeInput {
  gender: ShoeGender
  region: ShoeRegion
  value: number
}

export interface ShoeSizeResult {
  kind: 'shoe'
  gender: ShoeGender
  eu: number
  us: number
  uk: number
  footCm: number
}

export type ClothingGender = 'male' | 'female'
export type ClothingLabel = 'XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL'

export interface ClothingSizeResult {
  kind: 'clothing'
  gender: ClothingGender
  label: ClothingLabel
  us: string
  eu: number
  uk: number
  heightCm: number
  chestCm: number
}

export type RingRegion = 'cn' | 'us' | 'eu' | 'circumference'

export interface RingInput {
  region: RingRegion
  value: number
}

export interface RingSizeResult {
  kind: 'ring'
  cn: number
  us: number
  eu: number
  circumferenceMm: number
  diameterMm: number
}

const SHOE_EU_RANGE: Record<ShoeGender, { min: number; max: number }> = {
  male: { min: 38, max: 50 },
  female: { min: 33, max: 44 },
}

const RING_MIN_MM = 48
const RING_MAX_MM = 64

const CLOTHING_LABELS: ClothingLabel[] = ['XS', 'S', 'M', 'L', 'XL', 'XXL']

interface ClothingRow {
  label: ClothingLabel
  us: string
  eu: number
  uk: number
  heightCm: number
  chestCm: number
}

/* 常见版型参考：女装 155–180，男装 165–190 */
const CLOTHING_TABLE: Record<ClothingGender, ClothingRow[]> = {
  female: [
    { label: 'XS', us: 'XS', eu: 34, uk: 6, heightCm: 155, chestCm: 80 },
    { label: 'S', us: 'S', eu: 36, uk: 8, heightCm: 160, chestCm: 84 },
    { label: 'M', us: 'M', eu: 38, uk: 10, heightCm: 165, chestCm: 88 },
    { label: 'L', us: 'L', eu: 40, uk: 12, heightCm: 170, chestCm: 92 },
    { label: 'XL', us: 'XL', eu: 42, uk: 14, heightCm: 175, chestCm: 96 },
    { label: 'XXL', us: 'XXL', eu: 44, uk: 16, heightCm: 180, chestCm: 100 },
  ],
  male: [
    { label: 'XS', us: 'XS', eu: 44, uk: 34, heightCm: 165, chestCm: 88 },
    { label: 'S', us: 'S', eu: 46, uk: 36, heightCm: 170, chestCm: 92 },
    { label: 'M', us: 'M', eu: 48, uk: 38, heightCm: 175, chestCm: 96 },
    { label: 'L', us: 'L', eu: 50, uk: 40, heightCm: 180, chestCm: 100 },
    { label: 'XL', us: 'XL', eu: 52, uk: 42, heightCm: 185, chestCm: 104 },
    { label: 'XXL', us: 'XXL', eu: 54, uk: 44, heightCm: 190, chestCm: 108 },
  ],
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/** 尺寸展示：整数不带小数，半码保留一位 */
export function formatSize(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

export function isShoeGender(value: unknown): value is ShoeGender {
  return value === 'male' || value === 'female'
}

export function isShoeRegion(value: unknown): value is ShoeRegion {
  return value === 'cn' || value === 'us' || value === 'uk' || value === 'foot'
}

export function isClothingGender(value: unknown): value is ClothingGender {
  return value === 'male' || value === 'female'
}

export function isClothingLabel(value: unknown): value is ClothingLabel {
  return typeof value === 'string' && (CLOTHING_LABELS as string[]).includes(value)
}

export function isRingRegion(value: unknown): value is RingRegion {
  return (
    value === 'cn' || value === 'us' || value === 'eu' || value === 'circumference'
  )
}

function shoeEuOf(gender: ShoeGender, region: ShoeRegion, value: number): number {
  switch (region) {
    case 'cn':
      return value
    case 'us':
      return value + (gender === 'male' ? 33 : 30.5)
    case 'uk':
      return value + (gender === 'male' ? 34 : 33)
    case 'foot':
      return value * 2 - 10
    default:
      return Number.NaN
  }
}

/** 鞋码换算：输入任一区域，输出 EU / US / UK / 脚长 */
export function shoeSize(input: ShoeInput): ShoeSizeResult | null {
  if (!input || !isShoeGender(input.gender) || !isShoeRegion(input.region)) {
    return null
  }
  const { gender, region } = input
  const value = input.value
  if (!Number.isFinite(value) || value <= 0) {
    return null
  }
  const eu = shoeEuOf(gender, region, value)
  const range = SHOE_EU_RANGE[gender]
  if (!Number.isFinite(eu) || eu < range.min || eu > range.max) {
    return null
  }
  /* 只接受整码与半码 */
  if (Math.abs(eu * 2 - Math.round(eu * 2)) > 1e-9) {
    return null
  }
  const us = eu - (gender === 'male' ? 33 : 30.5)
  const uk = us - (gender === 'male' ? 1 : 2.5)
  return {
    kind: 'shoe',
    gender,
    eu: round1(eu),
    us: round1(us),
    uk: round1(uk),
    footCm: round1((eu + 10) / 2),
  }
}

/** 服装换算：中国码 XS–XXL → 美国 / 欧洲 / 英国 + 身高胸围 */
export function clothingSize(
  gender: ClothingGender,
  label: ClothingLabel,
): ClothingSizeResult | null {
  if (!isClothingGender(gender) || !isClothingLabel(label)) {
    return null
  }
  const row = CLOTHING_TABLE[gender].find((item) => item.label === label)
  if (!row) {
    return null
  }
  return {
    kind: 'clothing',
    gender,
    label,
    us: row.us,
    eu: row.eu,
    uk: row.uk,
    heightCm: row.heightCm,
    chestCm: row.chestCm,
  }
}

function ringCircumferenceOf(region: RingRegion, value: number): number {
  switch (region) {
    case 'cn':
      return value + 40
    case 'us':
      return 36.5 + 2.55 * value
    case 'eu':
    case 'circumference':
      return value
    default:
      return Number.NaN
  }
}

/** 戒指换算：以周长 mm 为基准，输出中国码 / 美国码 / 欧洲码 / 直径 */
export function ringSize(input: RingInput): RingSizeResult | null {
  if (!input || !isRingRegion(input.region)) {
    return null
  }
  const { region } = input
  const value = input.value
  if (!Number.isFinite(value) || value <= 0) {
    return null
  }
  if ((region === 'cn' || region === 'eu') && !Number.isInteger(value)) {
    return null
  }
  if (Math.abs(value * 2 - Math.round(value * 2)) > 1e-9) {
    return null
  }
  const circumference = ringCircumferenceOf(region, value)
  if (
    !Number.isFinite(circumference) ||
    circumference < RING_MIN_MM ||
    circumference > RING_MAX_MM
  ) {
    return null
  }
  const us = Math.round(((circumference - 36.5) / 2.55) * 2) / 2
  return {
    kind: 'ring',
    cn: Math.round(circumference - 40),
    us: round1(us),
    eu: Math.round(circumference),
    circumferenceMm: round1(circumference),
    diameterMm: round1(circumference / Math.PI),
  }
}
