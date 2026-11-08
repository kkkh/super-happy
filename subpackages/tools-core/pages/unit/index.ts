/* ==========================================================================
   单位换算 · 长度 / 质量 / 面积 / 体积 / 温度 / 速度
   - 统一基准因子换算；温度走独立公式
   - 输入实时计算，无需按钮
   ========================================================================== */
import { formatNumber } from '../../lib/money'
import { copyText } from '../../lib/ui'
import { tapTick } from '../../../../core/utils/haptics'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'
import type { IWorkflowData } from '../../../../core/workflow/types'

interface UnitDef {
  key: string
  name: string
  factor: number
}

interface UnitCategory {
  key: string
  name: string
  units: UnitDef[]
}

interface UnitValueRow {
  key: string
  name: string
  value: string
  active: boolean
}

const CATEGORIES: UnitCategory[] = [
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
]

const CATEGORY_NAMES = CATEGORIES.map((item) => item.name)

/** 输入允许负号（仅温度），最多 6 位小数 */
function parseUnitInput(raw: string, allowNegative: boolean): number | null {
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

function convertValue(category: UnitCategory, from: UnitDef, to: UnitDef, value: number): number {
  if (category.key === 'temperature') {
    let celsius = value
    if (from.key === 'f') {
      celsius = (value - 32) * 5 / 9
    } else if (from.key === 'k') {
      celsius = value - 273.15
    }
    if (to.key === 'f') {
      return celsius * 9 / 5 + 32
    }
    if (to.key === 'k') {
      return celsius + 273.15
    }
    return celsius
  }
  return value * from.factor / to.factor
}

function formatUnitValue(value: number): string {
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

Page({
  /* 此处是处理工具页分享与深链参数校验的边界 */
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: '单位换算',
    kicker: '计算换算',
    desc: '长度 · 质量 · 面积 · 体积 · 温度 · 速度',
    categories: CATEGORY_NAMES,
    activeCategory: 0,
    units: CATEGORIES[0].units,
    unitNames: CATEGORIES[0].units.map((item) => item.name),
    fromIndex: 2,
    toIndex: 1,
    fromName: '米',
    toName: '厘米',
    inputType: 'digit',
    value: '',
    result: '',
    formula: '',
    values: [] as UnitValueRow[],
    hasResult: false,
    error: '',
    posterData: null as IPosterData | null,
  },

  onCategory(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index)
    const category = CATEGORIES[index]
    if (!category) {
      return
    }
    tapTick()
    const units = category.units
    const fromIndex = 0
    const toIndex = units.length > 1 ? 1 : 0
    this.setData({
      activeCategory: index,
      units,
      unitNames: units.map((item) => item.name),
      fromIndex,
      toIndex,
      fromName: units[fromIndex].name,
      toName: units[toIndex].name,
      inputType: category.key === 'temperature' ? 'text' : 'digit',
    })
    this.recalculate()
  },

  onFromChange(event: WechatMiniprogram.PickerChange) {
    const fromIndex = Number(event.detail.value)
    const units = this.data.units as UnitDef[]
    this.setData({ fromIndex, fromName: units[fromIndex]?.name ?? '' })
    this.recalculate()
  },

  onToChange(event: WechatMiniprogram.PickerChange) {
    const toIndex = Number(event.detail.value)
    const units = this.data.units as UnitDef[]
    this.setData({ toIndex, toName: units[toIndex]?.name ?? '' })
    this.recalculate()
  },

  onSwap() {
    tapTick()
    const units = this.data.units as UnitDef[]
    const fromIndex = this.data.toIndex
    const toIndex = this.data.fromIndex
    this.setData({
      fromIndex,
      toIndex,
      fromName: units[fromIndex]?.name ?? '',
      toName: units[toIndex]?.name ?? '',
    })
    this.recalculate()
  },

  onInput(event: WechatMiniprogram.Input) {
    const value = event.detail.value
    this.setData({ value })
    this.recalculate()
  },

  recalculate() {
    const raw = this.data.value
    if (!raw.trim()) {
      this.setData({ result: '', formula: '', values: [], hasResult: false, error: '' })
      return
    }
    const category = CATEGORIES[this.data.activeCategory]
    const units = this.data.units as UnitDef[]
    const from = units[this.data.fromIndex]
    const to = units[this.data.toIndex]
    if (!category || !from || !to) {
      return
    }
    const input = parseUnitInput(raw, category.key === 'temperature')
    if (input === null) {
      this.setData({
        result: '',
        formula: '',
        values: [],
        hasResult: false,
        error: category.key === 'temperature' ? '请输入有效数字，可带负号' : '请输入有效的非负数字',
      })
      return
    }
    const target = convertValue(category, from, to, input)
    const targetText = formatUnitValue(target)
    const values: UnitValueRow[] = units.map((unit) => ({
      key: unit.key,
      name: unit.name,
      value: formatUnitValue(convertValue(category, from, unit, input)),
      active: unit.key === to.key,
    }))
    const extraRows = values
      .filter((row) => row.key !== to.key && row.key !== from.key)
      .slice(0, 2)
    const extras: string[] = extraRows.map((row) => `${row.name} ${row.value}`)
    if (category.key === 'length') {
      const meters = target * to.factor
      if (Number.isFinite(meters) && meters > 0) {
        const a4 = meters / 0.297
        if (a4 >= 0.5 && a4 <= 1000) {
          extras.push(`约 ${a4 >= 10 ? a4.toFixed(0) : a4.toFixed(1)} 张 A4 纸长边`)
        }
      }
    }
    const poster: IPosterData = {
      toolName: '单位换算',
      category: '单位换算',
      mainResult: `${targetText} ${to.name}`,
      resultLabel: `${from.name} → ${to.name}`,
      params: [
        { label: '输入数值', value: `${raw.trim()} ${from.name}` },
        { label: '从单位', value: from.name },
        { label: '到单位', value: to.name },
        { label: '换算类别', value: category.name },
      ],
      extras,
    }

    this.setData({
      result: targetText,
      formula: `${raw.trim()} ${from.name} = ${targetText} ${to.name}`,
      values,
      hasResult: true,
      error: '',
      posterData: poster,
    })
  },

  onExample() {
    tapTick()
    const category = CATEGORIES[0]
    const units = category.units
    const fromIndex = units.findIndex((item) => item.key === 'm')
    const toIndex = units.findIndex((item) => item.key === 'cm')
    this.setData({
      activeCategory: 0,
      units,
      unitNames: units.map((item) => item.name),
      fromIndex,
      toIndex,
      fromName: units[fromIndex].name,
      toName: units[toIndex].name,
      value: '1',
      inputType: 'digit',
    })
    this.recalculate()
  },

  onReset() {
    this.setData({
      value: '',
      result: '',
      formula: '',
      values: [],
      hasResult: false,
      error: '',
    })
  },

  /**
   * Workflow 接收接口：按上下文切换分类 / 源单位 / 目标单位
   * - 只做字段落位，换算仍由原有 recalculate 完成，零业务改写
   * - 任一非法上下文都回退当前页面值，绝不让页面进入异常状态
   */
  onReceiveWorkflow(data: IWorkflowData): boolean {
    try {
      if (!data || data.type === 'image' || typeof data.payload !== 'string') {
        return false
      }
      if (!data.payload.trim()) {
        return false
      }
      const context = data.context ?? {}
      const categoryKey =
        typeof context.unitCategory === 'string' ? context.unitCategory : ''
      const fromKey = typeof context.unitFrom === 'string' ? context.unitFrom : ''
      const toKey = typeof context.unitTo === 'string' ? context.unitTo : ''

      let categoryIndex = CATEGORIES.findIndex((item) => item.key === categoryKey)
      if (categoryIndex < 0) {
        categoryIndex = this.data.activeCategory
      }
      const category = CATEGORIES[categoryIndex]
      if (!category) {
        return false
      }
      const units = category.units
      let fromIndex = units.findIndex((item) => item.key === fromKey)
      if (fromIndex < 0) {
        fromIndex = 0
      }
      let toIndex = units.findIndex((item) => item.key === toKey)
      if (toIndex < 0 || toIndex === fromIndex) {
        toIndex = units.length > 1 ? (fromIndex === 0 ? 1 : 0) : 0
      }

      this.setData(
        {
          activeCategory: categoryIndex,
          units,
          unitNames: units.map((item) => item.name),
          fromIndex,
          toIndex,
          fromName: units[fromIndex].name,
          toName: units[toIndex].name,
          inputType: category.key === 'temperature' ? 'text' : 'digit',
          value: data.payload,
        },
        () => {
          this.recalculate()
        },
      )
      return true
    } catch {
      return false
    }
  },

  onCopy() {
    copyText(this.data.formula || this.data.result, '换算结果已复制')
  },
})
