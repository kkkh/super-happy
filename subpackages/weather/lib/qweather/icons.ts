/* ==========================================================================
   和风天气 · 官方图标映射
   - 图标文件来自 QWeather-Icons 1.8.0，文件名与 API icon 字段一致
   - 缺码 / 破图由组件回退 9999.svg
   ========================================================================== */

const ICON_ROOT = '/subpackages/weather/assets/icons'

const NIGHT_MAP: Record<string, string> = {
  '100': '150',
  '101': '151',
  '102': '152',
  '103': '153',
}

const COMPASS_TEXT: Record<string, string> = {
  n: '北风',
  nne: '东北偏北风',
  ne: '东北风',
  ene: '东北偏东风',
  e: '东风',
  ese: '东南偏东风',
  se: '东南风',
  sse: '东南偏南风',
  s: '南风',
  ssw: '西南偏南风',
  sw: '西南风',
  wsw: '西南偏西风',
  w: '西风',
  wnw: '西北偏西风',
  nw: '西北风',
  nnw: '西北偏北风',
  none: '无持续风向',
  vrb: '风向变化不定',
}

export type QwIconFamily =
  | 'clear'
  | 'cloudy'
  | 'rain'
  | 'snow'
  | 'fog'
  | 'storm'
  | 'dust'
  | 'hot'
  | 'cold'
  | 'unknown'

export function normalizeIconCode(code: string | number | undefined, night = false): string {
  const raw = String(code || '').trim()
  if (!/^\d{1,4}$/.test(raw)) {
    return '9999'
  }
  if (night && NIGHT_MAP[raw]) {
    return NIGHT_MAP[raw]
  }
  return raw
}

export function iconPath(code: string | number | undefined, options: { fill?: boolean; night?: boolean } = {}): string {
  const safe = normalizeIconCode(code, options.night)
  /* 官方没有 9999-fill.svg，兜底图始终使用线框版，避免一次无效请求 */
  const fill = options.fill && safe !== '9999' ? '-fill' : ''
  return `${ICON_ROOT}/${safe}${fill}.svg`
}

export function fallbackIconPath(fill = false): string {
  /* 官方没有 9999-fill.svg，兜底图始终使用线框版 */
  return `${ICON_ROOT}/9999.svg`
}

export function warningIconPath(code: string | number | undefined): string {
  const raw = String(code || '').trim()
  const safe = /^\d{4}$/.test(raw) && Number(raw) >= 1001 ? raw : '9999'
  return `${ICON_ROOT}/${safe}.svg`
}

export function moonIconPath(code: string | number | undefined): string {
  const raw = String(code || '').trim()
  const safe = /^\d{3}$/.test(raw) && Number(raw) >= 800 && Number(raw) <= 807 ? raw : '9999'
  return `${ICON_ROOT}/${safe}.svg`
}

export function compassText(compass: string, fallback = '风向'): string {
  const key = String(compass || '').toLowerCase()
  return COMPASS_TEXT[key] || fallback
}

export function iconFamily(code: string | number | undefined): QwIconFamily {
  const value = Number(code)
  if (!Number.isFinite(value)) {
    return 'unknown'
  }
  if (value === 100 || value === 150 || value === 900) {
    return value === 900 ? 'hot' : 'clear'
  }
  if (value >= 101 && value <= 104) {
    return 'cloudy'
  }
  if (value >= 151 && value <= 153) {
    return 'cloudy'
  }
  if (value >= 300 && value <= 399) {
    return 'rain'
  }
  if (value >= 400 && value <= 499) {
    return 'snow'
  }
  if (value === 507 || value === 508) {
    return 'dust'
  }
  if (value >= 500 && value <= 515) {
    return 'fog'
  }
  if (value === 901) {
    return 'cold'
  }
  if (value === 999) {
    return 'unknown'
  }
  return 'unknown'
}

export function windScaleText(scale: number | null): string {
  if (scale === null || !Number.isFinite(scale)) {
    return '—'
  }
  return `${Math.round(scale)} 级`
}

export function uvText(value: number): string {
  if (!Number.isFinite(value)) {
    return '—'
  }
  const level =
    value <= 2
      ? '最弱'
      : value <= 4
        ? '弱'
        : value <= 6
          ? '中等'
          : value <= 9
            ? '强'
            : '很强'
  return `${Math.round(value)} · ${level}`
}
