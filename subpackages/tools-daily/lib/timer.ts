/* ==========================================================================
   tools-daily 薄 re-export · 会议倒计时引擎
   - 唯一实现在 core/toolbox/engines/timer.ts
   - 页面、全局倒计时服务与测试共用同一套时间戳逻辑
   ========================================================================== */
export {
  TIMER_MIN_MINUTES,
  TIMER_MAX_MINUTES,
  TIMER_TICK_MS,
  planDuration,
  planDeadline,
  remainingMs,
  formatRemaining,
  formatDuration,
  timerProgress,
  type TimerMode,
  type TimerPlan,
} from '../../../core/toolbox/engines/timer'
