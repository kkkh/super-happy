/* ==========================================================================
   tools-core 薄 re-export · 时区换算
   - 唯一实现在本分包 lib/timezone-engine.ts
   ========================================================================== */
export {
  DST_OFFSET_MINUTES,
  MAX_OFFSET_MINUTES,
  WORLD_CLOCK_CITY_IDS,
  WORLD_CLOCK_MAX_CITIES,
  ZONE_PRESETS,
  convertZone,
  diffLabel,
  findZone,
  localZone,
  offsetLabel,
  timezoneSummaryText,
  worldClock,
  worldClockSummaryText,
} from './timezone-engine'
export type {
  TimezoneInput,
  TimezoneResult,
  TimezoneZone,
  WorldClockInput,
  WorldClockRow,
} from './timezone-engine'
