/* ==========================================================================
   单位换算 · 13 类
   - 统一基准因子换算；温度走独立公式
   - 数据按 1024 进制；时间不含月 / 年，避免口径歧义
   - 纯函数，不依赖 wx，页面与单测共用
   ========================================================================== */
import { formatNumber } from './money'

export interface UnitDef {
  key: string
  name: string
  factor: number
}

export interface UnitCategory {
  key: string
  name: string
  units: UnitDef[]
}

export const UNIT_CATEGORIES: UnitCategory[] = [
  {
    key: 'length',
    name: '长度',
    units: [
      { key: 'mm', name: '毫米', factor: 0.001 },
      { key: 'cm', name: '厘米', factor: 0.01 },
      { key: 'm', name: '米', factor: 1 },
      { key: 'km', name: '千米', factor: 1000 },
      { key: 'cun', name: '市寸', factor: 1 / 30 },
      { key: 'chi', name: '市尺', factor: 1 / 3 },
      { key: 'in', name: '英寸', factor: 0.0254 },
      { key: 'ft', name: '英尺', factor: 0.3048 },
      { key: 'yd', name: '码', factor: 0.9144 },
      { key: 'mi', name: '英里', factor: 1609.344 },
    ],
  },
  {
    key: 'mass',
    name: '质量',
    units: [
      { key: 'mg', name: '毫克', factor: 0.000001 },
      { key: 'g', name: '克', factor: 0.001 },
      { key: 'kg', name: '千克', factor: 1 },
      { key: 'jin', name: '斤', factor: 0.5 },
      { key: 'liang', name: '两', factor: 0.05 },
      { key: 't', name: '吨', factor: 1000 },
      { key: 'lb', name: '磅', factor: 0.45359237 },
      { key: 'oz', name: '盎司', factor: 0.028349523125 },
    ],
  },
  {
    key: 'area',
    name: '面积',
    units: [
      { key: 'cm2', name: '平方厘米', factor: 0.0001 },
      { key: 'm2', name: '平方米', factor: 1 },
      { key: 'mu', name: '亩', factor: 2000 / 3 },
      { key: 'ha', name: '公顷', factor: 10000 },
      { key: 'km2', name: '平方千米', factor: 1000000 },
      { key: 'ft2', name: '平方英尺', factor: 0.09290304 },
    ],
  },
  {
    key: 'volume',
    name: '体积',
    units: [
      { key: 'ml', name: '毫升', factor: 0.001 },
      { key: 'l', name: '升', factor: 1 },
      { key: 'm3', name: '立方米', factor: 1000 },
      { key: 'gal', name: '美制加仑', factor: 3.785411784 },
      { key: 'pint', name: '美制品脱', factor: 0.473176473 },
    ],
  },
  {
    key: 'temperature',
    name: '温度',
    units: [
      { key: 'c', name: '摄氏度', factor: 1 },
      { key: 'f', name: '华氏度', factor: 1 },
      { key: 'k', name: '开尔文', factor: 1 },
    ],
  },
  {
    key: 'speed',
    name: '速度',
    units: [
      { key: 'kmh', name: '千米/时', factor: 1 },
      { key: 'ms', name: '米/秒', factor: 3.6 },
      { key: 'mph', name: '英里/时', factor: 1.609344 },
      { key: 'knot', name: '节', factor: 1.852 },
    ],
  },
  {
    key: 'data',
    name: '数据',
    units: [
      { key: 'bit', name: '比特', factor: 1 / 8 },
      { key: 'b', name: '字节', factor: 1 },
      { key: 'kb', name: 'KB', factor: 1024 },
      { key: 'mb', name: 'MB', factor: 1024 ** 2 },
      { key: 'gb', name: 'GB', factor: 1024 ** 3 },
      { key: 'tb', name: 'TB', factor: 1024 ** 4 },
    ],
  },
  {
    key: 'time',
    name: '时间',
    units: [
      { key: 'ms', name: '毫秒', factor: 0.001 },
      { key: 's', name: '秒', factor: 1 },
      { key: 'min', name: '分钟', factor: 60 },
      { key: 'h', name: '小时', factor: 3600 },
      { key: 'day', name: '天', factor: 86400 },
      { key: 'week', name: '周', factor: 604800 },
    ],
  },
  {
    key: 'pressure',
    name: '压力',
    units: [
      { key: 'pa', name: '帕', factor: 1 },
      { key: 'kpa', name: '千帕', factor: 1000 },
      { key: 'mpa', name: '兆帕', factor: 1000000 },
      { key: 'bar', name: '巴', factor: 100000 },
      { key: 'atm', name: '标准大气压', factor: 101325 },
      { key: 'psi', name: '磅/平方英寸', factor: 6894.757293168361 },
      { key: 'mmhg', name: '毫米汞柱', factor: 133.322387415 },
    ],
  },
  {
    key: 'energy',
    name: '能量',
    units: [
      { key: 'j', name: '焦', factor: 1 },
      { key: 'kj', name: '千焦', factor: 1000 },
      { key: 'cal', name: '卡', factor: 4.184 },
      { key: 'kcal', name: '千卡', factor: 4184 },
      { key: 'wh', name: '瓦时', factor: 3600 },
      { key: 'kwh', name: '千瓦时', factor: 3600000 },
    ],
  },
  {
    key: 'power',
    name: '功率',
    units: [
      { key: 'w', name: '瓦', factor: 1 },
      { key: 'kw', name: '千瓦', factor: 1000 },
      { key: 'mw', name: '兆瓦', factor: 1000000 },
      { key: 'hp', name: '马力', factor: 735.49875 },
    ],
  },
  {
    key: 'angle',
    name: '角度',
    units: [
      { key: 'deg', name: '度', factor: 1 },
      { key: 'rad', name: '弧度', factor: 180 / Math.PI },
      { key: 'arcmin', name: '角分', factor: 1 / 60 },
      { key: 'arcsec', name: '角秒', factor: 1 / 3600 },
      { key: 'grad', name: '百分度', factor: 0.9 },
      { key: 'turn', name: '圈', factor: 360 },
    ],
  },
  {
    key: 'frequency',
    name: '频率',
    units: [
      { key: 'hz', name: '赫兹', factor: 1 },
      { key: 'khz', name: '千赫兹', factor: 1000 },
      { key: 'mhz', name: '兆赫兹', factor: 1000000 },
      { key: 'ghz', name: '吉赫兹', factor: 1000000000 },
      { key: 'rpm', name: '转/分', factor: 1 / 60 },
    ],
  },
]

export const UNIT_CATEGORY_NAMES = UNIT_CATEGORIES.map((item) => item.name)

/** 输入允许负号（仅温度），最多 6 位小数 */
export function parseUnitInput(raw: string, allowNegative: boolean): number | null {
  const s = raw.trim()
  if (!/^-?\d{1,9}(\.\d{1,6})?$/.test(s)) {
    return null
  }
  if (!allowNegative && s.startsWith('-')) {
    return null
  }
  const value = Number(s)
  return Number.isFinite(value) ? value : null
}

/** 基准因子换算；温度按摄氏 / 华氏 / 开尔文独立公式 */
export function convertUnit(
  category: UnitCategory,
  from: UnitDef,
  to: UnitDef,
  value: number,
): number {
  if (category.key === 'temperature') {
    let celsius = value
    if (from.key === 'f') {
      celsius = ((value - 32) * 5) / 9
    } else if (from.key === 'k') {
      celsius = value - 273.15
    }
    if (to.key === 'f') {
      return (celsius * 9) / 5 + 32
    }
    if (to.key === 'k') {
      return celsius + 273.15
    }
    return celsius
  }
  return (value * from.factor) / to.factor
}

export function formatUnitValue(value: number): string {
  if (!Number.isFinite(value)) {
    return '—'
  }
  const abs = Math.abs(value)
  if (abs !== 0 && (abs >= 1e10 || abs < 1e-6)) {
    return value.toExponential(4)
  }
  let text = formatNumber(value, 6)
  if (text.includes('.')) {
    text = text.replace(/0+$/, '').replace(/\.$/, '')
  }
  return text
}
