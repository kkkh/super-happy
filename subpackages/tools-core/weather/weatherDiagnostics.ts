/* ==========================================================================
   weather/weatherDiagnostics · 官方错误码全表 + 请求环形日志
   - 覆盖高德 Web服务错误码说明中的关键条目；未知码统一兜底
   - 诊断文本永不包含完整 Key、经纬度或原始响应
   ========================================================================== */
import type { RequestLogEntry } from './types'

export type InfoSeverity = 'ok' | 'warn' | 'error'

export interface InfoCodeInfo {
  code: string
  label: string
  advice: string
  severity: InfoSeverity
}

const INFO_CODE_TABLE: Record<string, Omit<InfoCodeInfo, 'code'>> = {
  '10000': { label: 'OK', advice: '请求正常', severity: 'ok' },
  '10001': { label: 'INVALID_USER_KEY', advice: 'Key 不正确或过期，请检查 Web服务 Key', severity: 'error' },
  '10002': { label: 'SERVICE_NOT_AVAILABLE', advice: '没有权限使用该服务，或接口路径拼写错误', severity: 'error' },
  '10003': { label: 'DAILY_QUERY_OVER_LIMIT', advice: '日访问量超限，次日 0:00 自动解封', severity: 'error' },
  '10004': { label: 'ACCESS_TOO_FREQUENT', advice: '单位时间访问过频，下一分钟自动解封', severity: 'warn' },
  '10005': { label: 'INVALID_USER_IP', advice: 'IP 白名单不匹配，客户端场景请清空白名单', severity: 'error' },
  '10006': { label: 'INVALID_USER_DOMAIN', advice: '绑定域名无效，请在高德控制台重新设置', severity: 'error' },
  '10007': { label: 'INVALID_USER_SIGNATURE', advice: '数字签名未通过，客户端不要开启签名或不要传 sk', severity: 'error' },
  '10008': { label: 'INVALID_USER_SCODE', advice: 'MD5 安全码未通过，检查 Key 与平台绑定', severity: 'error' },
  '10009': {
    label: 'USERKEY_PLAT_NOMATCH',
    advice: 'Key 与平台不符：请创建「Web服务」Key，不要用微信小程序/JS API Key',
    severity: 'error',
  },
  '10010': { label: 'IP_QUERY_OVER_LIMIT', advice: '单 IP 访问超限且不能自动恢复，需提交工单', severity: 'error' },
  '10011': { label: 'NOT_SUPPORT_HTTPS', advice: '服务不支持 HTTPS，需提交工单', severity: 'error' },
  '10012': { label: 'INSUFFICIENT_PRIVILEGES', advice: '权限不足，服务请求被拒绝', severity: 'error' },
  '10013': { label: 'USER_KEY_RECYCLED', advice: 'Key 已被删除，请重新创建', severity: 'error' },
  '10014': { label: 'QPS_HAS_EXCEEDED_THE_LIMIT', advice: '云图服务 QPS 超限，降低请求频率', severity: 'warn' },
  '10015': { label: 'GATEWAY_TIMEOUT', advice: '受单机 QPS 限流，稍后重试', severity: 'warn' },
  '10016': { label: 'SERVER_IS_BUSY', advice: '服务器负载过高，稍后重试', severity: 'warn' },
  '10017': { label: 'RESOURCE_UNAVAILABLE', advice: '请求的资源不可用', severity: 'warn' },
  '10019': { label: 'CQPS_HAS_EXCEEDED_THE_LIMIT', advice: '服务总 QPS 超限', severity: 'warn' },
  '10020': { label: 'CKQPS_HAS_EXCEEDED_THE_LIMIT', advice: '该 Key 的服务接口 QPS 超限', severity: 'warn' },
  '10021': { label: 'CUQPS_HAS_EXCEEDED_THE_LIMIT', advice: '账号使用该接口 QPS 超限', severity: 'warn' },
  '10026': { label: 'INVALID_REQUEST', advice: '账号被封禁，需提交工单申诉', severity: 'error' },
  '10029': { label: 'ABROAD_DAILY_QUERY_OVER_LIMIT', advice: '该 Key QPS 超限', severity: 'warn' },
  '10041': { label: 'NO_EFFECTIVE_INTERFACE', advice: '接口权限过期，需提交工单', severity: 'error' },
  '10044': { label: 'USER_DAILY_QUERY_OVER_LIMIT', advice: '账号维度日调用量超限', severity: 'error' },
  '10045': { label: 'USER_ABROAD_DAILY_QUERY_OVER_LIMIT', advice: '账号维度海外服务日调用量超限', severity: 'error' },
  '20000': { label: 'INVALID_PARAMS', advice: '请求参数非法，检查 adcode / location', severity: 'error' },
  '20001': { label: 'MISSING_REQUIRED_PARAMS', advice: '缺少必填参数', severity: 'error' },
  '20002': { label: 'ILLEGAL_REQUEST', advice: '请求协议非法', severity: 'error' },
  '20003': { label: 'UNKNOWN_ERROR', advice: '高德未知错误，稍后重试', severity: 'warn' },
  '20011': { label: 'INSUFFICIENT_ABROAD_PRIVILEGES', advice: '坐标在海外但没有海外地图权限', severity: 'error' },
  '20012': { label: 'ILLEGAL_CONTENT', advice: '查询内容非法', severity: 'error' },
  '20800': { label: 'OUT_OF_SERVICE', advice: '坐标不在中国大陆陆地范围内', severity: 'error' },
  '20801': { label: 'NO_ROADS_NEARBY', advice: '附近搜不到路', severity: 'error' },
  '20802': { label: 'ROUTE_FAIL', advice: '路线计算失败', severity: 'error' },
  '20803': { label: 'OVER_DIRECTION_RANGE', advice: '起点终点距离过长', severity: 'error' },
  '40000': { label: 'QUOTA_PLAN_RUN_OUT', advice: '购买的配额余额耗尽', severity: 'error' },
  '40001': { label: 'GEOFENCE_MAX_COUNT_REACHED', advice: '地理围栏数量达到上限', severity: 'error' },
  '40002': { label: 'SERVICE_EXPIRED', advice: '购买的服务已到期', severity: 'error' },
  '40003': { label: 'ABROAD_QUOTA_PLAN_RUN_OUT', advice: '海外服务余额耗尽', severity: 'error' },
}

export function describeInfoCode(code: string): InfoCodeInfo {
  const key = String(code || '').trim()
  const entry = INFO_CODE_TABLE[key]
  if (entry) {
    return { code: key, ...entry }
  }
  if (/^3\d{4}$/.test(key)) {
    return {
      code: key,
      label: 'ENGINE_RESPONSE_DATA_ERROR',
      advice: '服务响应失败：检查参数，必要时提交工单',
      severity: 'error',
    }
  }
  return {
    code: key || '—',
    label: 'UNKNOWN_INFOCODE',
    advice: '未知错误码，请在高德控制台查看配额与 Key 状态',
    severity: 'warn',
  }
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return '0 ms'
  }
  if (ms < 1000) {
    return `${Math.round(ms)} ms`
  }
  return `${(ms / 1000).toFixed(1)} s`
}

export function formatAge(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return '刚刚'
  }
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) {
    return '不到 1 分钟'
  }
  if (minutes < 60) {
    return `${minutes} 分钟`
  }
  const hours = Math.floor(minutes / 60)
  return `${hours} 小时 ${minutes % 60} 分`
}

/** 请求环形日志：最多 12 条，旧记录自动淘汰 */
export class WeatherRequestLog {
  private entries: RequestLogEntry[] = []

  record(entry: RequestLogEntry): void {
    this.entries = [...this.entries, entry].slice(-12)
  }

  list(): RequestLogEntry[] {
    return this.entries.slice()
  }

  clear(): void {
    this.entries = []
  }
}

export interface DiagnosticSnapshot {
  keyMasked: string
  cityName: string
  province: string
  adcode: string
  reporttime: string
  liveAgeMs: number
  liveStale: boolean
  forecastAgeMs: number
  forecastStale: boolean
  offline: boolean
  highLevelLab: boolean
  ambientEnabled: boolean
}

function line(label: string, value: string): string {
  return `${label}：${value}`
}

/** 生成人可读诊断文本；刻意不含 Key 完整值、经纬度与原始响应 */
export function buildDiagnosticText(
  snapshot: DiagnosticSnapshot,
  logs: RequestLogEntry[],
): string {
  const lines = [
    '全息气象站 · 极客诊断',
    line('Key', snapshot.keyMasked),
    line('城市', `${snapshot.province} ${snapshot.cityName}`.trim()),
    line('adcode', snapshot.adcode || '—'),
    line('数据发布', snapshot.reporttime || '—'),
    line('实况缓存', snapshot.liveAgeMs > 0 ? `${formatAge(snapshot.liveAgeMs)}${snapshot.liveStale ? ' · 已过期' : ' · 新鲜'}` : '无'),
    line('预报缓存', snapshot.forecastAgeMs > 0 ? `${formatAge(snapshot.forecastAgeMs)}${snapshot.forecastStale ? ' · 已过期' : ' · 新鲜'}` : '无'),
    line('网络', snapshot.offline ? '离线' : '在线'),
    line('实验能力', snapshot.highLevelLab ? '已开启' : '未开启'),
    line('环境音', snapshot.ambientEnabled ? '已开启' : '已关闭'),
  ]
  if (logs.length === 0) {
    lines.push('', '暂无请求记录')
  } else {
    lines.push('', '最近请求（新 → 旧）：')
    logs
      .slice()
      .reverse()
      .forEach((entry) => {
        const info = describeInfoCode(entry.infocode)
        lines.push(
          `· ${entry.label} | ${entry.ok ? 'OK' : 'FAIL'} | ${entry.infocode || '—'} ${info.label} | ${formatDuration(entry.durationMs)} | ${entry.cacheHit ? '缓存' : '网络'} | ${entry.adcode}`,
        )
      })
  }
  return lines.join('\n')
}
