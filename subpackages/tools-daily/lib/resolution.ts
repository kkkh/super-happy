/* ==========================================================================
   tools-daily 薄 re-export · 分辨率与比例
   - 唯一实现在 core/toolbox/engines/resolution.ts
   ========================================================================== */
export {
  DPI_OPTIONS,
  HD_MIN_WIDTH,
  PAPER_PRESETS,
  analyzeResolution,
  fitWidth,
  planResolution,
  printPixelSize,
  printSummaryText,
  resolutionSummary,
  simplifyRatio,
} from '../../../core/toolbox/engines/resolution'
export type {
  PaperPreset,
  PrintOrientation,
  PrintSizeInput,
  PrintSizeResult,
  RatioParts,
  ResolutionBase,
  ResolutionInput,
  ResolutionPlan,
} from '../../../core/toolbox/engines/resolution'
