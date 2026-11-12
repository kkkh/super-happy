/* ==========================================================================
   tools-core 草稿补丁
   - 页面只保留 collect/apply 两个薄方法，避免单页超过 24KB
   - 时区恢复必须同时重建标签与夏令时，不能只 setData 索引
   ========================================================================== */
import type { TimezoneZone } from './timezone'

export interface TimezoneDraftData {
  date: string
  time: string
  sourceIndex: number
  targetIndex: number
  sourceDst: boolean
  targetDst: boolean
  worldDstIds: string[]
}

export function collectTimezoneDraft(data: TimezoneDraftData): Record<string, string> {
  return {
    date: data.date,
    time: data.time,
    sourceIndex: `${data.sourceIndex}`,
    targetIndex: `${data.targetIndex}`,
    sourceDst: data.sourceDst ? '1' : '0',
    targetDst: data.targetDst ? '1' : '0',
    worldDstIds: data.worldDstIds.join(','),
  }
}

export function timezoneDraftPatch(
  zones: TimezoneZone[],
  input: Record<string, string>,
  mode: string,
): Record<string, unknown> {
  const readIndex = (raw: string, fallback: number): number => {
    const value = Number(raw)
    return Number.isInteger(value) && value >= 0 && value < zones.length ? value : fallback
  }
  const sourceIndex = readIndex(input.sourceIndex, 0)
  const targetIndex = readIndex(input.targetIndex, 0)
  const worldDstIds = (input.worldDstIds ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => zones.some((zone) => zone.id === item))
  return {
    mode: mode === 'world' ? 'world' : 'convert',
    date: input.date || '',
    time: input.time || '',
    sourceIndex,
    targetIndex,
    sourceZoneLabel: zones[sourceIndex]?.label ?? '本机',
    targetZoneLabel: zones[targetIndex]?.label ?? '伦敦',
    sourceDst: input.sourceDst === '1',
    targetDst: input.targetDst === '1',
    worldDstIds,
  }
}
