/* ==========================================================================
   尺码换算 · 鞋码 / 服装 / 戒指
   - 三模式独立缓存输入；切换模式恢复各自内容
   - 鞋码允许半码；戒指以周长 mm 为基准
   - 全部本机静态对照，结果仅供参考
   ========================================================================== */
import { tapTick } from '../../../../core/utils/haptics'
import { parseDecimal } from '../../../../core/toolbox/engines/money'
import {
  clothingSize,
  formatSize,
  isClothingLabel,
  isRingRegion,
  isShoeGender,
  isShoeRegion,
  ringSize,
  shoeSize,
  type ClothingGender,
  type ClothingLabel,
  type RingRegion,
  type ShoeGender,
  type ShoeRegion,
} from '../../lib/size'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'
import { copyText } from '../../lib/ui'

type SizeMode = 'shoe' | 'clothing' | 'ring'

interface ResultRow {
  k: string
  v: string
}

interface ModeMeta {
  label: string
  hint: string
}

interface SizeState {
  destroyed: boolean
  inputs: {
    shoe: { gender: ShoeGender; region: ShoeRegion; value: string }
    clothing: { gender: ClothingGender; label: ClothingLabel }
    ring: { region: RingRegion; value: string }
  }
}

const MODE_OPTIONS: Array<{ key: SizeMode; label: string }> = [
  { key: 'shoe', label: '鞋码' },
  { key: 'clothing', label: '服装' },
  { key: 'ring', label: '戒指' },
]

const MODE_META: Record<SizeMode, ModeMeta> = {
  shoe: {
    label: '鞋码',
    hint: 'EU 与中国码同码，允许半码；男鞋 EU 38–50，女鞋 EU 33–44。',
  },
  clothing: {
    label: '服装',
    hint: '中国码 XS–XXL 对应常见版型的身高与胸围，不同品牌版型会有差异。',
  },
  ring: {
    label: '戒指',
    hint: '周长 48–64mm；中国码 = 周长 − 40，美国码按周长换算后取 0.5 档。',
  },
}

const GENDER_OPTIONS: Array<{ key: 'male' | 'female'; label: string }> = [
  { key: 'male', label: '男' },
  { key: 'female', label: '女' },
]

interface RegionOption {
  key: ShoeRegion | RingRegion
  label: string
}

const SHOE_REGIONS: RegionOption[] = [
  { key: 'cn', label: '中国 / EU' },
  { key: 'us', label: '美国' },
  { key: 'uk', label: '英国' },
  { key: 'foot', label: '脚长 cm' },
]

const RING_REGIONS: RegionOption[] = [
  { key: 'cn', label: '中国码' },
  { key: 'us', label: '美国码' },
  { key: 'eu', label: '欧洲码' },
  { key: 'circumference', label: '周长 mm' },
]

const CLOTHING_LABELS: ClothingLabel[] = ['XS', 'S', 'M', 'L', 'XL', 'XXL']

function shoeValueMeta(region: ShoeRegion): { valueLabel: string; valuePlaceholder: string } {
  switch (region) {
    case 'us':
      return { valueLabel: '美国鞋码', valuePlaceholder: '例如 9' }
    case 'uk':
      return { valueLabel: '英国鞋码', valuePlaceholder: '例如 8' }
    case 'foot':
      return { valueLabel: '脚长（cm）', valuePlaceholder: '例如 26' }
    default:
      return { valueLabel: '鞋码（EU）', valuePlaceholder: '例如 42' }
  }
}

function ringValueMeta(region: RingRegion): { valueLabel: string; valuePlaceholder: string } {
  switch (region) {
    case 'us':
      return { valueLabel: '美国码', valuePlaceholder: '例如 7.5' }
    case 'eu':
      return { valueLabel: '欧洲码（周长 mm）', valuePlaceholder: '例如 56' }
    case 'circumference':
      return { valueLabel: '周长（mm）', valuePlaceholder: '例如 56' }
    default:
      return { valueLabel: '中国码', valuePlaceholder: '例如 16' }
  }
}

function emptyResult() {
  return {
    resultMain: '',
    resultLabel: '换算结果',
    resultRows: [] as ResultRow[],
    sizeSummary: '',
    hasResult: false,
    shellState: 'idle' as string,
    error: '',
    posterData: null as IPosterData | null,
  }
}

Page({
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: '尺码换算',
    kicker: '生活健康',
    desc: '鞋码 · 服装 · 戒指',
    mode: 'shoe' as SizeMode,
    modeOptions: MODE_OPTIONS,
    modeMeta: MODE_META.shoe,
    gender: 'male' as ShoeGender | ClothingGender,
    genderOptions: GENDER_OPTIONS,
    regionKey: 'cn' as ShoeRegion | RingRegion,
    regionOptions: SHOE_REGIONS,
    valueLabel: shoeValueMeta('cn').valueLabel,
    valuePlaceholder: shoeValueMeta('cn').valuePlaceholder,
    value: '',
    clothingLabel: 'M' as ClothingLabel,
    clothingLabels: CLOTHING_LABELS,
    canRun: false,
    ...emptyResult(),
  },

  onLoad() {
    const state = this as unknown as SizeState
    state.destroyed = false
    state.inputs = {
      shoe: { gender: 'male', region: 'cn', value: '' },
      clothing: { gender: 'female', label: 'M' },
      ring: { region: 'cn', value: '' },
    }
  },

  onUnload() {
    const state = this as unknown as SizeState
    state.destroyed = true
  },

  onMode(event: WechatMiniprogram.TouchEvent) {
    const mode = event.currentTarget.dataset.mode as SizeMode
    if (!MODE_META[mode] || mode === this.data.mode) {
      return
    }
    const state = this as unknown as SizeState
    this.cacheCurrent(state)
    tapTick()
    this.applyMode(mode, state)
  },

  onGender(event: WechatMiniprogram.TouchEvent) {
    const gender = event.currentTarget.dataset.gender
    if (!isShoeGender(gender) || gender === this.data.gender) {
      return
    }
    tapTick()
    this.setData({ gender, ...emptyResult() }, () => this.updateCanRun())
  },

  onRegion(event: WechatMiniprogram.TouchEvent) {
    const key = event.currentTarget.dataset.key
    if (this.data.mode === 'shoe') {
      if (!isShoeRegion(key) || key === this.data.regionKey) {
        return
      }
      const meta = shoeValueMeta(key)
      tapTick()
      this.setData({ regionKey: key, ...meta, ...emptyResult() }, () =>
        this.updateCanRun(),
      )
      return
    }
    if (this.data.mode === 'ring') {
      if (!isRingRegion(key) || key === this.data.regionKey) {
        return
      }
      const meta = ringValueMeta(key)
      tapTick()
      this.setData({ regionKey: key, ...meta, ...emptyResult() }, () =>
        this.updateCanRun(),
      )
    }
  },

  onClothingLabel(event: WechatMiniprogram.TouchEvent) {
    const label = event.currentTarget.dataset.label
    if (!isClothingLabel(label) || label === this.data.clothingLabel) {
      return
    }
    tapTick()
    this.setData({ clothingLabel: label, ...emptyResult() }, () =>
      this.updateCanRun(),
    )
  },

  onValueInput(event: WechatMiniprogram.Input) {
    this.setData({ value: event.detail.value, ...emptyResult() }, () =>
      this.updateCanRun(),
    )
  },

  onExample() {
    tapTick()
    if (this.data.mode === 'shoe') {
      this.setData(
        {
          gender: 'male',
          regionKey: 'cn',
          ...shoeValueMeta('cn'),
          value: '42',
          ...emptyResult(),
        },
        () => this.onRun(),
      )
      return
    }
    if (this.data.mode === 'clothing') {
      this.setData(
        { gender: 'female', clothingLabel: 'M', ...emptyResult() },
        () => this.onRun(),
      )
      return
    }
    this.setData(
      { regionKey: 'cn', ...ringValueMeta('cn'), value: '16', ...emptyResult() },
      () => this.onRun(),
    )
  },

  onReset() {
    const state = this as unknown as SizeState
    state.inputs = {
      shoe: { gender: 'male', region: 'cn', value: '' },
      clothing: { gender: 'female', label: 'M' },
      ring: { region: 'cn', value: '' },
    }
    this.setData({
      mode: 'shoe',
      modeMeta: MODE_META.shoe,
      gender: 'male',
      regionKey: 'cn',
      regionOptions: SHOE_REGIONS,
      ...shoeValueMeta('cn'),
      value: '',
      clothingLabel: 'M',
      canRun: false,
      ...emptyResult(),
    })
  },

  onRun() {
    this.compute()
  },

  onCopy() {
    if (!this.data.sizeSummary) {
      return
    }
    tapTick()
    void copyText(this.data.sizeSummary, '尺码结果已复制')
  },

  onCopyRow(event: WechatMiniprogram.TouchEvent) {
    const value = String(event.currentTarget.dataset.value || '')
    if (!value) {
      return
    }
    tapTick()
    void copyText(value, '已复制')
  },

  cacheCurrent(state: SizeState) {
    if (this.data.mode === 'shoe') {
      state.inputs.shoe = {
        gender: this.data.gender as ShoeGender,
        region: this.data.regionKey as ShoeRegion,
        value: this.data.value,
      }
      return
    }
    if (this.data.mode === 'clothing') {
      state.inputs.clothing = {
        gender: this.data.gender as ClothingGender,
        label: this.data.clothingLabel,
      }
      return
    }
    state.inputs.ring = {
      region: this.data.regionKey as RingRegion,
      value: this.data.value,
    }
  },

  applyMode(mode: SizeMode, state: SizeState) {
    if (mode === 'shoe') {
      const input = state.inputs.shoe
      this.setData(
        {
          mode,
          modeMeta: MODE_META.shoe,
          gender: input.gender,
          regionKey: input.region,
          regionOptions: SHOE_REGIONS,
          ...shoeValueMeta(input.region),
          value: input.value,
          ...emptyResult(),
        },
        () => this.updateCanRun(),
      )
      return
    }
    if (mode === 'clothing') {
      const input = state.inputs.clothing
      this.setData(
        {
          mode,
          modeMeta: MODE_META.clothing,
          gender: input.gender,
          clothingLabel: input.label,
          regionKey: 'cn',
          value: '',
          ...emptyResult(),
          canRun: true,
        },
        () => this.updateCanRun(),
      )
      return
    }
    const input = state.inputs.ring
    this.setData(
      {
        mode,
        modeMeta: MODE_META.ring,
        regionKey: input.region,
        regionOptions: RING_REGIONS,
        ...ringValueMeta(input.region),
        value: input.value,
        ...emptyResult(),
      },
      () => this.updateCanRun(),
    )
  },

  readValue(): number | null {
    return parseDecimal(this.data.value, 0, 100, 1)
  },

  updateCanRun() {
    if (this.data.mode === 'clothing') {
      this.setData({ canRun: true })
      return
    }
    this.setData({ canRun: this.readValue() !== null })
  },

  compute() {
    const state = this as unknown as SizeState
    if (state.destroyed) {
      return
    }
    if (this.data.mode === 'shoe') {
      this.computeShoe()
      return
    }
    if (this.data.mode === 'clothing') {
      this.computeClothing()
      return
    }
    this.computeRing()
  },

  computeShoe() {
    const value = this.readValue()
    if (value === null) {
      this.invalidate('请输入有效鞋码，最多一位小数')
      return
    }
    const result = shoeSize({
      gender: this.data.gender as ShoeGender,
      region: this.data.regionKey as ShoeRegion,
      value,
    })
    if (!result) {
      this.invalidate('鞋码超出支持范围：男鞋 EU 38–50，女鞋 EU 33–44，仅支持整码 / 半码')
      return
    }
    const genderLabel = result.gender === 'male' ? '男鞋' : '女鞋'
    const main = `EU ${formatSize(result.eu)}`
    const rows: ResultRow[] = [
      { k: '中国 / EU', v: `EU ${formatSize(result.eu)}` },
      { k: '美国', v: `US ${formatSize(result.us)}` },
      { k: '英国', v: `UK ${formatSize(result.uk)}` },
      { k: '脚长', v: `${formatSize(result.footCm)} cm` },
      { k: '适用', v: genderLabel },
    ]
    const summary = `${genderLabel} EU ${formatSize(result.eu)} · US ${formatSize(
      result.us,
    )} · UK ${formatSize(result.uk)} · 脚长 ${formatSize(result.footCm)}cm`
    this.commit(main, MODE_META.shoe.label, rows, summary, {
      toolName: '尺码换算',
      category: '生活健康',
      mainResult: main,
      resultLabel: '鞋码',
      params: [
        { label: '性别', value: genderLabel },
        { label: '输入', value: `${this.data.value} ${this.data.valueLabel}` },
      ],
      extras: [`US ${formatSize(result.us)}`, `UK ${formatSize(result.uk)}`],
    })
  },

  computeClothing() {
    const result = clothingSize(
      this.data.gender as ClothingGender,
      this.data.clothingLabel,
    )
    if (!result) {
      this.invalidate('请选择有效的服装尺码')
      return
    }
    const genderLabel = result.gender === 'male' ? '男装' : '女装'
    const main = `${genderLabel} ${result.label}`
    const rows: ResultRow[] = [
      { k: '中国', v: `${result.label}（${result.heightCm}/${result.chestCm}）` },
      { k: '美国', v: result.us },
      { k: '欧洲', v: `EU ${result.eu}` },
      { k: '英国', v: `UK ${result.uk}` },
      { k: '身高', v: `${result.heightCm} cm` },
      { k: '胸围', v: `${result.chestCm} cm` },
    ]
    const summary = `${genderLabel} ${result.label} · 美国 ${result.us} · 欧洲 ${
      result.eu
    } · 英国 ${result.uk} · ${result.heightCm}/${result.chestCm}`
    this.commit(main, MODE_META.clothing.label, rows, summary, {
      toolName: '尺码换算',
      category: '生活健康',
      mainResult: main,
      resultLabel: '服装尺码',
      params: [
        { label: '性别', value: genderLabel },
        { label: '中国码', value: result.label },
      ],
      extras: [`欧洲 ${result.eu}`, `英国 ${result.uk}`],
    })
  },

  computeRing() {
    const value = this.readValue()
    if (value === null) {
      this.invalidate('请输入有效戒指尺码，最多一位小数')
      return
    }
    const result = ringSize({
      region: this.data.regionKey as RingRegion,
      value,
    })
    if (!result) {
      this.invalidate('戒指周长需在 48–64mm 之间；中国码与欧洲码为整数')
      return
    }
    const main = `中国码 ${result.cn}`
    const rows: ResultRow[] = [
      { k: '中国码', v: `${result.cn} 号` },
      { k: '美国码', v: formatSize(result.us) },
      { k: '欧洲码', v: `${result.eu}` },
      { k: '周长', v: `${formatSize(result.circumferenceMm)} mm` },
      { k: '直径', v: `${formatSize(result.diameterMm)} mm` },
    ]
    const summary = `戒指 中国码 ${result.cn} · 美国 ${formatSize(
      result.us,
    )} · 欧洲 ${result.eu} · 周长 ${formatSize(result.circumferenceMm)}mm`
    this.commit(main, MODE_META.ring.label, rows, summary, {
      toolName: '尺码换算',
      category: '生活健康',
      mainResult: main,
      resultLabel: '戒指尺码',
      params: [
        { label: '中国码', value: `${result.cn} 号` },
        { label: '周长', value: `${formatSize(result.circumferenceMm)} mm` },
      ],
      extras: [`美国 ${formatSize(result.us)}`, `欧洲 ${result.eu}`],
    })
  },

  commit(
    main: string,
    label: string,
    rows: ResultRow[],
    summary: string,
    poster: IPosterData,
  ) {
    this.setData({
      resultMain: main,
      resultLabel: label,
      resultRows: rows,
      sizeSummary: summary,
      hasResult: true,
      shellState: 'done',
      error: '',
      canRun: true,
      posterData: poster,
    })
  },

  invalidate(message: string) {
    this.setData({
      ...emptyResult(),
      shellState: 'invalid',
      error: message,
    })
  },
})
