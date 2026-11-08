/**
 * g-icon · 专业矢量图标（Remix Icon line 系列子集字体，29 枚）
 * 字体由 fantasticon 从 remixicon（Apache-2.0）编译，base64 内嵌于 font.wxss。
 * 用法示例：
 *   <g-icon name="orbit" size="{{36}}" tone="iris" />
 *   <g-icon name="chevron" size="{{28}}" tone="ink4" flip />
 * 图标字典：user / sun / moon / spark / sliders / save / qr / pin / orbit /
 *           mail / grid / copy / compass / close / chevron / back / check /
 *           arrow / heart / heart-fill / search / share / card / history /
 *           stack / clock / image / eye / star
 */

/** 码位表：与字体构建产物一一对应（fantasticon codepoints） */
const GLYPH_CODEPOINTS: Record<string, number> = {
  user: 61697,
  sun: 61698,
  star: 61699,
  stack: 61700,
  spark: 61701,
  sliders: 61702,
  share: 61703,
  search: 61704,
  save: 61705,
  qr: 61706,
  pin: 61707,
  orbit: 61708,
  moon: 61709,
  mail: 61710,
  image: 61711,
  history: 61712,
  heart: 61713,
  'heart-fill': 61714,
  grid: 61715,
  eye: 61716,
  copy: 61717,
  compass: 61718,
  close: 61719,
  clock: 61720,
  chevron: 61721,
  check: 61722,
  card: 61723,
  back: 61724,
  arrow: 61725,
}

function glyphFor(name: string): string {
  const codepoint = GLYPH_CODEPOINTS[name] ?? GLYPH_CODEPOINTS.spark
  return String.fromCodePoint(codepoint)
}

Component({
  properties: {
    name: { type: String, value: 'spark' },
    size: { type: Number, value: 40 },
    tone: { type: String, value: 'ink' },
    /** 可选：直接指定图标颜色，用于主题色选中态 */
    color: { type: String, value: '' },
    /** 水平镜像：返回箭头等方向翻转场景 */
    flip: { type: Boolean, value: false },
  },

  data: {
    glyph: glyphFor('spark'),
  },

  observers: {
    name(value: string) {
      this.setData({ glyph: glyphFor(value) })
    },
  },

  lifetimes: {
    attached() {
      this.setData({ glyph: glyphFor(this.data.name) })
    },
  },
})
