/* ==========================================================================
   工具箱类型宪法 · 配置驱动的前端契约
   - registry 只声明已上线工具，路由必须真实存在
   - 页面 / 搜索 / 收藏 / 最近使用全部消费同一份元数据
   ========================================================================== */

export type ToolCategory = 'calc' | 'date' | 'text' | 'media' | 'life' | 'work'

export interface ToolMeta {
  id: string
  name: string
  desc: string
  category: ToolCategory
  /** 1–2 个汉字/字母的字标，零图片资源 */
  icon: string
  route: string
  keywords: string[]
  /** 搜索排序权重，越大越靠前 */
  weight: number
}

/** 首页分区：生活与职场合并，避免单卡分区显得稀疏 */
export interface HomeSection {
  key: string
  title: string
  hint: string
  categories: ToolCategory[]
}
