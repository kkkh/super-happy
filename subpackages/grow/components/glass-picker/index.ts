/* ==========================================================================
   glass-picker · 液态玻璃选择抽屉
   - 复用 glass-bottom-sheet 的遮罩、拖拽与安全区，不重复造弹层
   - 单选即选即关；多选需点「确定」统一提交，避免高频落盘
   - 选项文案 / 描述 / 值全部由父级数据驱动，组件不做业务判断
   ========================================================================== */
import { tapSuccess, tapTick } from '../../../../core/utils/haptics'

export interface PickerOption {
  value: string
  label: string
  desc?: string
}

interface PickerDisplayOption extends PickerOption {
  active: boolean
}

interface PickerChangeDetail {
  value?: string
  values?: string[]
}

function normalizeOptions(raw: unknown): PickerOption[] {
  if (!Array.isArray(raw)) {
    return []
  }
  const options: PickerOption[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) {
      continue
    }
    const record = item as Record<string, unknown>
    const value =
      typeof record.value === 'string' || typeof record.value === 'number'
        ? String(record.value)
        : ''
    if (!value) {
      continue
    }
    const label = typeof record.label === 'string' && record.label ? record.label : value
    const desc = typeof record.desc === 'string' ? record.desc : ''
    options.push({ value, label, desc })
  }
  return options
}

function normalizeValues(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.filter((item): item is string => typeof item === 'string')
}

function buildDisplay(
  options: PickerOption[],
  selectedValue: string,
  selectedValues: string[],
  multiple: boolean,
): PickerDisplayOption[] {
  return options.map((option) => ({
    ...option,
    active: multiple
      ? selectedValues.includes(option.value)
      : option.value === selectedValue,
  }))
}

Component({
  options: {
    virtualHost: true,
    styleIsolation: 'isolated',
  },

  properties: {
    show: {
      type: Boolean,
      value: false,
    },
    title: {
      type: String,
      value: '选择一项',
    },
    description: {
      type: String,
      value: '',
    },
    options: {
      type: Array,
      value: [],
    },
    /** 单选值 */
    value: {
      type: String,
      value: '',
    },
    /** 多选值 */
    values: {
      type: Array,
      value: [],
    },
    multiple: {
      type: Boolean,
      value: false,
    },
    confirmText: {
      type: String,
      value: '确定',
    },
    emptyText: {
      type: String,
      value: '暂无可选项',
    },
    zIndex: {
      type: Number,
      value: 900,
    },
    ariaLabel: {
      type: String,
      value: '选项选择器',
    },
  },

  data: {
    selectedValue: '',
    selectedValues: [] as string[],
    displayOptions: [] as PickerDisplayOption[],
  },

  observers: {
    show(value: boolean) {
      if (!value) {
        return
      }
      this.syncFromProps()
    },

    'options, value, values, multiple'() {
      if (this.data.show) {
        this.syncFromProps()
      }
    },
  },

  lifetimes: {
    attached() {
      /* 显隐完全由父级 show 驱动，组件不持有额外运行时状态 */
    },
  },

  methods: {
    syncFromProps(): void {
      const options = normalizeOptions(this.data.options)
      const selectedValue = typeof this.data.value === 'string' ? this.data.value : ''
      const selectedValues = normalizeValues(this.data.values)
      this.setData({
        selectedValue,
        selectedValues,
        displayOptions: buildDisplay(
          options,
          selectedValue,
          selectedValues,
          this.data.multiple,
        ),
      })
    },

    onOptionTap(event: WechatMiniprogram.TouchEvent): void {
      const index = Number(event.currentTarget.dataset.index)
      if (!Number.isFinite(index)) {
        return
      }
      const option = this.data.displayOptions[index]
      if (!option) {
        return
      }
      tapTick()

      if (this.data.multiple) {
        const selectedValues = this.data.selectedValues.includes(option.value)
          ? this.data.selectedValues.filter((item) => item !== option.value)
          : [...this.data.selectedValues, option.value]
        this.setData({
          selectedValues,
          displayOptions: buildDisplay(
            normalizeOptions(this.data.options),
            this.data.selectedValue,
            selectedValues,
            true,
          ),
        })
        this.triggerEvent('selection', { values: selectedValues })
        return
      }

      this.setData({
        selectedValue: option.value,
        displayOptions: buildDisplay(
          normalizeOptions(this.data.options),
          option.value,
          this.data.selectedValues,
          false,
        ),
      })
      const detail: PickerChangeDetail = { value: option.value }
      this.triggerEvent('change', detail)
      this.requestClose('select')
    },

    onConfirm(): void {
      if (!this.data.multiple) {
        return
      }
      tapSuccess()
      const detail: PickerChangeDetail = { values: this.data.selectedValues.slice() }
      this.triggerEvent('change', detail)
      this.requestClose('confirm')
    },

    requestClose(source: string): void {
      this.triggerEvent('close', { source })
    },

    onSheetClose(detail: WechatMiniprogram.CustomEvent<{ source?: string }>): void {
      const source = detail && detail.detail ? detail.detail.source ?? 'mask' : 'mask'
      this.triggerEvent('close', { source })
    },

    onSheetClosed(): void {
      this.triggerEvent('closed')
    },
  },
})
