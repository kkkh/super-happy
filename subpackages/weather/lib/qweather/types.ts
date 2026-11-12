/* ==========================================================================
   和风天气 · 严格类型
   - 归一化视图模型：页面只消费这里的数据，不直接依赖接口原始字段
   - 所有接口字段按「可能缺失 / 可能新增」处理，解析层负责兜底
   ========================================================================== */

export type QWeatherTabKey =
  | 'overview'
  | 'hourly'
  | 'daily'
  | 'air'
  | 'indices'
  | 'astronomy'
  | 'history'

export type QwHourlyRange = 24 | 72 | 168 | 240
export type QwDailyRange = 3 | 7 | 10 | 15 | 30

export type QwCitySource = 'fuzzy' | 'manual' | 'top' | 'poi'

export interface QwCity {
  id: string
  parentId?: string
  name: string
  adm1: string
  adm2: string
  country: string
  lat: number
  lon: number
  tz: string
  utcOffset: string
  source: QwCitySource
}

export interface QwGeoItem {
  id: string
  name: string
  adm1: string
  adm2: string
  country: string
  lat: number
  lon: number
  tz: string
  utcOffset: string
  type: string
  rank: number
  fxLink: string
  source: QwCitySource
}

export interface QwRainPoint {
  time: string
  timeText: string
  precip: number
  type: string
  typeText: string
}

export interface QwMinutelyView {
  summary: string
  updateTimeText: string
  points: QwRainPoint[]
  maxPrecip: number
  totalPrecip: number
  maxPrecipText: string
  totalPrecipText: string
  hasRain: boolean
  peakText: string
  typeText: string
  peakTimeText: string
}

export interface QwWindView {
  degree: number | null
  compass: string
  speed: number
  speedText: string
  scale: number | null
  text: string
}

export interface QwCurrentView {
  validTime: string
  validTimeText: string
  icon: string
  condition: string
  temp: number
  tempText: string
  feelsLike: number
  feelsLikeText: string
  humidity: number
  humidityText: string
  wind: QwWindView
  gust: number
  gustText: string
  precip: number
  precipText: string
  precipType: string
  precipTypeText: string
  precipIntensityText: string
  pressure: number
  pressureText: string
  visibility: number
  visibilityText: string
  dewPoint: number
  dewPointText: string
  cloud: number
  cloudText: string
  uv: number
  uvText: string
  source: string
}

export interface QwHourlyView {
  time: string
  timeText: string
  hourText: string
  icon: string
  condition: string
  temp: number
  tempText: string
  feelsLikeText: string
  humidityText: string
  windText: string
  gustText: string
  precip: number
  precipText: string
  precipTypeText: string
  precipIntensityText: string
  pop: number
  popText: string
  pressureText: string
  visibilityText: string
  dewPointText: string
  cloudText: string
  uvText: string
  range: QwHourlyRange
}

export interface QwDailyPartView {
  icon: string
  condition: string
  periodText: string
  tempMaxText: string
  tempMinText: string
  windText: string
  gustText: string
  precipText: string
  precipTypeText: string
  popText: string
  humidityText: string
  cloudText: string
}

export interface QwAstroView {
  sunrise: string
  sunset: string
  astronomicalDawn: string
  nauticalDawn: string
  dawn: string
  astronomicalDusk: string
  nauticalDusk: string
  dusk: string
  solarNoon: string
  solarMidnight: string
  moonrise: string
  moonset: string
  moonTransit: string
  moonUnderfoot: string
  moonPhase: string
}

export interface QwDailyView {
  date: string
  dateText: string
  weekText: string
  iconDay: string
  iconNight: string
  textDay: string
  textNight: string
  tempMax: number
  tempMin: number
  tempAvg: number
  tempMaxText: string
  tempMinText: string
  tempAvgText: string
  humidityText: string
  precip: number
  precipText: string
  popText: string
  pressureText: string
  visibilityText: string
  cloudText: string
  uvText: string
  windDayText: string
  windNightText: string
  sunriseText: string
  sunsetText: string
  moonriseText: string
  moonsetText: string
  moonPhase: string
  moonIcon: string
  astro: QwAstroView
  daytime: QwDailyPartView
  nighttime: QwDailyPartView
  range: QwDailyRange
}

export interface QwAirHealthView {
  effect: string
  general: string
  sensitive: string
}

export interface QwAirIndexView {
  code: string
  name: string
  aqi: number
  aqiDisplay: string
  level: string
  category: string
  color: string
  primaryPollutant: string
  health: QwAirHealthView
}

export interface QwPollutantView {
  code: string
  name: string
  fullName: string
  value: number
  valueText: string
  unit: string
  subIndexText: string
}

export interface QwAirHourView {
  timeText: string
  hourText: string
  aqi: number
  aqiDisplay: string
  category: string
  color: string
  primaryPollutant: string
  indexes: QwAirIndexView[]
  pollutants: QwPollutantView[]
}

export interface QwAirDayView {
  dateText: string
  weekText: string
  aqi: number
  aqiDisplay: string
  category: string
  color: string
  primaryPollutant: string
  indexes: QwAirIndexView[]
  pollutants: QwPollutantView[]
}

export interface QwAirView {
  updatedText: string
  indexes: QwAirIndexView[]
  primary: QwAirIndexView | null
  pollutants: QwPollutantView[]
  stations: string[]
  stationsText: string
  hourly: QwAirHourView[]
  daily: QwAirDayView[]
  generalAdvice: string
  sensitiveAdvice: string
}

export interface QwAlertView {
  id: string
  event: string
  severity: string
  severityText: string
  color: string
  headline: string
  description: string
  instruction: string
  sender: string
  issuedText: string
  effectiveText: string
  expireText: string
  icon: string
  urgency: string
  certainty: string
  eventCode: string
  messageTypeText: string
  onsetText: string
  criteria: string
  responseTypesText: string
}

export interface QwIndicesView {
  date: string
  dateText: string
  weekText: string
  items: Array<{
    type: string
    name: string
    level: string
    category: string
    text: string
  }>
}

export interface QwSunView {
  date: string
  sunrise: string
  sunset: string
  sunriseText: string
  sunsetText: string
  dayLengthText: string
}

export interface QwMoonPhasePoint {
  timeText: string
  name: string
  icon: string
  illumination: number
  illuminationText: string
}

export interface QwMoonView {
  date: string
  moonriseText: string
  moonsetText: string
  phases: QwMoonPhasePoint[]
  current: QwMoonPhasePoint | null
}

export interface QwSolarView {
  elevation: number
  azimuth: number
  elevationText: string
  azimuthText: string
  solarHourText: string
  hourAngleText: string
}

export interface QwHistoryView {
  date: string
  dateText: string
  daily: QwDailyView | null
  hourly: QwHourlyView[]
}

export interface QwEndpointView {
  key: string
  label: string
  group: string
  description: string
  status: 'idle' | 'loading' | 'ok' | 'error'
  latency: number
  count: number
  error: string
}

export interface QwOverviewView {
  current: QwCurrentView
  today: QwDailyView | null
  minutely: QwMinutelyView | null
  alerts: QwAlertView[]
  indices: QwIndicesView | null
  sun: QwSunView | null
  moon: QwMoonView | null
  air: QwAirView | null
}
