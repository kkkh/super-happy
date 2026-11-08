/* ==========================================================================
   自定义 TabBar 选中态同步
   - 页面 onShow 调用：getTabBar().setData({ selected })
   - 主题由 custom-tab-bar 组件直接订阅 uiStore，无需运行时改原生样式
   ========================================================================== */

interface TabBarLike {
  setData(data: { selected: number }): void
}

interface TabBarPage {
  getTabBar?: () => TabBarLike | undefined
}

export function selectTabBar(page: unknown, index: number): void {
  const holder = page as TabBarPage
  if (typeof holder.getTabBar !== 'function') {
    return
  }
  try {
    const bar = holder.getTabBar()
    if (bar) {
      bar.setData({ selected: index })
    }
  } catch {
    // TabBar 尚未创建时静默
  }
}
