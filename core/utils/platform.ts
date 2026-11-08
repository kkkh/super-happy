/* ==========================================================================
   平台能力探测 · 唯一入口
   - 开发者工具不支持 Skyline Canvas，需要页面显式降级
   - 探测失败一律按真机处理，避免误伤线上能力
   ========================================================================== */

export function isDevtools(): boolean {
  try {
    const info = typeof wx.getDeviceInfo === 'function' ? wx.getDeviceInfo() : wx.getSystemInfoSync()
    return info.platform === 'devtools'
  } catch {
    return false
  }
}
