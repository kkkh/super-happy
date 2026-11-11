/* ==========================================================================
   文本转换 · tools-core 兼容出口
   实现已下沉到 core/toolbox/engines/text.ts
   禁止在此新增实现，避免页面与 silent 执行器出现两份逻辑
   ========================================================================== */
export {
  CONVERT_MODES,
  TEXT_CONVERT_LIMIT,
  changedCharCount,
  cleanText,
  convertText,
  decodeHtml,
  encodeHtml,
  escapeUnicode,
  isConvertMode,
  toCase,
  toNaming,
  type CaseMode,
  type CleanOptions,
  type ConvertMode,
  type ConvertOptions,
  type ConvertResult,
  type NamingMode,
} from '../../../core/toolbox/engines/text'
