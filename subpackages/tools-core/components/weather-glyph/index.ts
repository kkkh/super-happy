/* ==========================================================================
   weather-glyph · 标准 SVG 天气图标
   - 原生 WXML 不能直接内联 <svg>，因此使用 image + 分包内 SVG 资产
   - 每个图标均以 64 × 64 viewBox、圆角线条绘制，无 <style>、无百分比单位
   - 夜航 / 白昼各一套色值，避免外部 SVG 无法继承页面 currentColor 的问题
   ========================================================================== */

const FAMILIES = new Set([
  'clear',
  'partly',
  'cloudy',
  'overcast',
  'wind',
  'haze',
  'rain',
  'heavyRain',
  'thunder',
  'snow',
  'sleet',
  'dust',
  'fog',
  'tornado',
  'hot',
  'cold',
  'unknown',
])

const ICON_ROOT = '/subpackages/tools-core/components/weather-glyph/icons'

function iconPath(family: string, tone: string, night: boolean): string {
  const safeTone = tone === 'light' ? 'light' : 'dark'
  let safeFamily = FAMILIES.has(family) ? family : 'unknown'
  if (night && family === 'clear') {
    safeFamily = 'clearNight'
  } else if (night && family === 'partly') {
    safeFamily = 'partlyNight'
  }
  return `${ICON_ROOT}/${safeTone}/${safeFamily}.svg`
}

Component({
  options: {
    virtualHost: true,
    styleIsolation: 'isolated',
    addGlobalClass: false,
  },

  properties: {
    family: {
      type: String,
      value: 'unknown',
    },
    size: {
      type: String,
      value: 'md',
    },
    tone: {
      type: String,
      value: 'dark',
    },
    /** 夜间晴天 / 夜间多云使用月亮版本 */
    night: {
      type: Boolean,
      value: false,
    },
  },

  data: {
    iconSrc: iconPath('unknown', 'dark', false),
  },

  observers: {
    'family, tone, night'(family: string, tone: string, night: boolean) {
      this.setData({ iconSrc: iconPath(family, tone, night) })
    },
  },

  lifetimes: {
    attached() {
      const data = this.data as unknown as { family?: string; tone?: string; night?: boolean }
      this.setData({
        iconSrc: iconPath(data.family || 'unknown', data.tone || 'dark', Boolean(data.night)),
      })
    },
  },
})
