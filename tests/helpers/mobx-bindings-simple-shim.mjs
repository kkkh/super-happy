/* ==========================================================================
   测试专用 ESM 轻量垫片 · mobx-miniprogram-bindings
   - 只把 fields 初始值写入 page.data，不建立响应式 Reaction
   - 用于页面生命周期集成测试，避免测试结束后 Reaction 仍访问已销毁页面
   ========================================================================== */
export function createStoreBindings(target, options) {
  if (target && options && options.fields) {
    const patch = {}
    for (const [key, getter] of Object.entries(options.fields)) {
      patch[key] = typeof getter === 'function' ? getter() : getter
    }
    target.setData(patch)
  }
  return { destroyStoreBindings() {} }
}

export const initStoreBindings = () => undefined
export const storeBindingsBehavior = {}
export const BehaviorWithStore = () => ({})
export const ComponentWithStore = () => ({})
export default { createStoreBindings, initStoreBindings }
