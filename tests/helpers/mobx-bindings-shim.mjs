/* ==========================================================================
   测试专用 ESM 垫片 · mobx-miniprogram-bindings
   - 该包是 CommonJS，Node ESM 无法直接做具名导入
   - 用 createRequire 读取真实实现，再以 ESM 具名导出，行为与小程序一致
   ========================================================================== */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const bindings = require('mobx-miniprogram-bindings')

export const createStoreBindings = bindings.createStoreBindings
export const initStoreBindings = bindings.initStoreBindings
export const storeBindingsBehavior = bindings.storeBindingsBehavior
export const BehaviorWithStore = bindings.BehaviorWithStore
export const ComponentWithStore = bindings.ComponentWithStore

export default bindings
