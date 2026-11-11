/* ==========================================================================
   weather/weatherCode · 官方天气现象 → 图标族严格映射
   - 覆盖高德《天气对照表》全部 60+ 现象
   - 未知现象保留原始汉字作为 label，图标族回退 unknown
   ========================================================================== */
import type { AmbientScene, WeatherFamily } from './types'

/** 官方天气现象全表；键必须与接口返回汉字完全一致 */
export const WEATHER_PHENOMENA: Record<string, WeatherFamily> = {
  晴: 'clear',
  少云: 'partly',
  晴间多云: 'partly',
  多云: 'cloudy',
  阴: 'overcast',

  有风: 'wind',
  平静: 'wind',
  微风: 'wind',
  和风: 'wind',
  清风: 'wind',
  '强风/劲风': 'wind',
  疾风: 'wind',
  大风: 'wind',
  烈风: 'wind',
  风暴: 'wind',
  狂爆风: 'wind',
  飓风: 'wind',
  热带风暴: 'wind',

  霾: 'haze',
  中度霾: 'haze',
  重度霾: 'haze',
  严重霾: 'haze',

  阵雨: 'rain',
  小雨: 'rain',
  中雨: 'rain',
  '毛毛雨/细雨': 'rain',
  雨: 'rain',
  '小雨-中雨': 'rain',
  '中雨-大雨': 'rain',

  大雨: 'heavyRain',
  暴雨: 'heavyRain',
  大暴雨: 'heavyRain',
  特大暴雨: 'heavyRain',
  强阵雨: 'heavyRain',
  极端降雨: 'heavyRain',
  '大雨-暴雨': 'heavyRain',
  '暴雨-大暴雨': 'heavyRain',
  '大暴雨-特大暴雨': 'heavyRain',

  雷阵雨: 'thunder',
  雷阵雨并伴有冰雹: 'thunder',
  强雷阵雨: 'thunder',

  雨雪天气: 'sleet',
  雨夹雪: 'sleet',
  阵雨夹雪: 'sleet',
  冻雨: 'sleet',

  雪: 'snow',
  阵雪: 'snow',
  小雪: 'snow',
  中雪: 'snow',
  大雪: 'snow',
  暴雪: 'snow',
  '小雪-中雪': 'snow',
  '中雪-大雪': 'snow',
  '大雪-暴雪': 'snow',

  浮尘: 'dust',
  扬沙: 'dust',
  沙尘暴: 'dust',
  强沙尘暴: 'dust',

  龙卷风: 'tornado',

  雾: 'fog',
  浓雾: 'fog',
  强浓雾: 'fog',
  轻雾: 'fog',
  大雾: 'fog',
  特强浓雾: 'fog',

  热: 'hot',
  冷: 'cold',
  未知: 'unknown',
}

const FAMILY_LABELS: Record<WeatherFamily, string> = {
  clear: '晴',
  partly: '晴间多云',
  cloudy: '多云',
  overcast: '阴',
  wind: '大风',
  haze: '霾',
  rain: '降雨',
  heavyRain: '强降雨',
  thunder: '雷雨',
  snow: '降雪',
  sleet: '雨夹雪',
  dust: '沙尘',
  fog: '雾',
  tornado: '龙卷风',
  hot: '高温',
  cold: '低温',
  unknown: '天气',
}

export interface ResolvedWeather {
  /** 官方原始汉字；未知时也保留原文 */
  label: string
  family: WeatherFamily
}

/** 严格映射；未收录时按语义关键词兜底，仍无法识别则 unknown */
export function resolveWeather(raw: string): ResolvedWeather {
  const label = String(raw || '').trim()
  if (!label) {
    return { label: '未知', family: 'unknown' }
  }
  const exact = WEATHER_PHENOMENA[label]
  if (exact) {
    return { label, family: exact }
  }
  if (label.includes('雷')) {
    return { label, family: 'thunder' }
  }
  if (label.includes('雪') && label.includes('雨')) {
    return { label, family: 'sleet' }
  }
  if (label.includes('雪')) {
    return { label, family: 'snow' }
  }
  if (label.includes('雨')) {
    return { label, family: label.includes('暴') || label.includes('大') ? 'heavyRain' : 'rain' }
  }
  if (label.includes('霾')) {
    return { label, family: 'haze' }
  }
  if (label.includes('雾')) {
    return { label, family: 'fog' }
  }
  if (label.includes('沙') || label.includes('尘')) {
    return { label, family: 'dust' }
  }
  if (label.includes('风')) {
    return { label, family: 'wind' }
  }
  if (label.includes('云')) {
    return { label, family: 'cloudy' }
  }
  return { label, family: 'unknown' }
}

export function weatherFamilyLabel(family: WeatherFamily): string {
  return FAMILY_LABELS[family] || FAMILY_LABELS.unknown
}

/** 环境音场景：只有降水与风沙类才提供合成白噪音 */
export function ambientSceneFor(family: WeatherFamily): AmbientScene {
  if (family === 'rain' || family === 'heavyRain' || family === 'thunder') {
    return 'rain'
  }
  if (family === 'wind' || family === 'haze' || family === 'dust' || family === 'fog' || family === 'tornado') {
    return 'wind'
  }
  return null
}
