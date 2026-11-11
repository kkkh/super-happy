/* ==========================================================================
   单位换算 · 13 类
   - 长度 / 质量 / 面积 / 体积 / 温度 / 速度 + 数据 / 时间 / 压力 / 能量 / 功率 / 角度 / 频率
   - 统一基准因子换算；温度走独立公式；数据按 1024 进制
   - 输入实时计算，无需按钮
   ========================================================================== */
import { copyText } from '../../lib/ui'
import { tapTick } from '../../../../core/utils/haptics'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'
import type { IWorkflowData } from '../../../../core/workflow/types'

import {
  UNIT_CATEGORIES,
  UNIT_CATEGORY_NAMES,
  convertUnit,
  formatUnitValue,
  parseUnitInput,
  type UnitDef,
} from '../../lib/units'

interface UnitValueRow {
  key: string
  name: string
  value: string
  active: boolean
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
    desc: '13 类单位 · 实时换算',
    categories: UNIT_CATEGORY_NAMES,
    activeCategory: 0,
    units: UNIT_CATEGORIES[0].units,
    unitNames: UNIT_CATEGORIES[0].units.map((item) => item.name),
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
    const category = UNIT_CATEGORIES[index]
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
    const category = UNIT_CATEGORIES[this.data.activeCategory]
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
    const target = convertUnit(category, from, to, input)
    const targetText = formatUnitValue(target)
    const values: UnitValueRow[] = units.map((unit) => ({
      key: unit.key,
      name: unit.name,
      value: formatUnitValue(convertUnit(category, from, unit, input)),
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
    const category = UNIT_CATEGORIES[0]
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

      let categoryIndex = UNIT_CATEGORIES.findIndex((item) => item.key === categoryKey)
      if (categoryIndex < 0) {
        categoryIndex = this.data.activeCategory
      }
      const category = UNIT_CATEGORIES[categoryIndex]
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
