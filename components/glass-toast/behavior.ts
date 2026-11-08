/**
 * glassToastBehavior · 为自定义组件注入 this.$toast()
 * - 仅用于 Component / 支持 behaviors 的宿主
 * - 页面可直接使用 mountGlassToast 或 showGlassToast
 */
import {
  clearGlassToasts,
  hideGlassToast,
  showGlassToast,
  type GlassToastOptions,
} from './toast'

export const glassToastBehavior = Behavior({
  methods: {
    $toast(options: string | GlassToastOptions): string {
      return showGlassToast(options)
    },

    $hideToast(id?: string): void {
      hideGlassToast(id)
    },

    $clearToast(): void {
      clearGlassToasts()
    },
  },
})
