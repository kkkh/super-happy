/* ==========================================================================
   工具箱类型宪法 · 配置驱动的前端契约
   - registry 只声明已上线工具，路由必须真实存在
   - 页面 / 搜索 / 收藏 / 最近使用全部消费同一份元数据
   ========================================================================== */

export type ToolCategory = 'calc' | 'date' | 'text' | 'media' | 'life' | 'work'

/** 收藏页排序：最近收藏 / 名称 / 分类 */
export type FavoriteSort = 'recent' | 'name' | 'category'

/** 隐私 / 金融 / 健康提示类型，由外壳统一渲染 */
export type ToolSensitivity = '' | 'privacy' | 'personal' | 'finance' | 'health'

export interface ToolMeta {
  id: string
  name: string
  desc: string
  category: ToolCategory
  /** 1–2 个汉字/字母的字标，零图片资源 */
  icon: string
  route: string
  keywords: string[]
  /** 搜索别名：拼音全拼、首字母、英文与俗称 */
  aliases: string[]
  /** 敏感提示类型；空串表示无额外提示 */
  sensitive: ToolSensitivity
  /** 可选：覆盖 sensitive 默认提示，用于同类别不同文案 */
  privacyNote?: string
  /** 可选：即使 sensitive 为空也不写草稿（如带时薪的工时工具） */
  draftExcluded?: boolean
  /** 搜索排序权重 0–100，越大越靠前 */
  weight: number
}

/** 收藏切换结果：满额不挤出旧项，失败回滚 */
export type FavoriteToggleResult = 'added' | 'removed' | 'full' | 'invalid' | 'failed'

/** 首页分区：生活与职场合并，避免单卡分区显得稀疏 */
export interface HomeSection {
  key: string
  title: string
  hint: string
  categories: ToolCategory[]
}
