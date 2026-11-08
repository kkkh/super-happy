/* ==========================================================================
   AI SKILL 原子接口注册表
   - 将领域 Service 封装为 SKILL 单元：每个能力 = name + description + invoke
   - 供微信 AI 开发模式 / Agent 直接调用（ai-skills/resume/mcp.json 与之一一对应）
   - 数据链路与页面完全同源（Service → Transport → Result），无旁路
   ========================================================================== */
import type { Project, ProjectCategory, Result, SkillEndpoint } from '../types/index'
import {
  fetchAboutBlocks,
  fetchCategories,
  fetchContactLinks,
  fetchProfile,
  fetchProjectById,
  fetchProjects,
  fetchSkills,
  fetchStats,
  fetchTimeline,
  searchProjects,
} from '../services/resume'
import { resumeStore } from '../stores/resume'
import { logger } from '../utils/logger'

type SkillPayload = Record<string, unknown>
type SkillTool = SkillEndpoint<SkillPayload, unknown>

/** 外部入参一律不可信：只接受协议内枚举与短字符串 */
function asCategory(value: unknown): ProjectCategory | undefined {
  return value === 'actual' || value === 'personal' ? value : undefined
}

function stringArg(payload: SkillPayload, key: string): string {
  const value = payload[key]
  return typeof value === 'string' ? value.trim() : ''
}

/* ---- 查询类原子接口 ---- */

export const getProfile: SkillTool = {
  name: 'get_profile',
  description: '获取个人档案：姓名、别名、座右铭、坐标、邮箱、简介',
  async invoke() {
    return fetchProfile()
  },
}

export const getContactLinks: SkillTool = {
  name: 'get_contact_links',
  description: '获取社交坐标：Gitee / GitHub / 网站 / 掘金',
  async invoke() {
    return fetchContactLinks()
  },
}

export const getSkills: SkillTool = {
  name: 'get_skills',
  description: '获取技能矩阵：前端 / 后端 / 工具链三组，含掌握度（1-5）',
  async invoke() {
    return fetchSkills()
  },
}

export const getTimeline: SkillTool = {
  name: 'get_timeline',
  description: '获取成长时间线：校园 / 工程 / 创作三纪元里程碑',
  async invoke() {
    return fetchTimeline()
  },
}

export const getAbout: SkillTool = {
  name: 'get_about',
  description: '获取关于我叙事块：成长与爱好',
  async invoke() {
    return fetchAboutBlocks()
  },
}

export const getStats: SkillTool = {
  name: 'get_stats',
  description: '获取数字速览：作品数 / 技能数 / 公司级交付数',
  async invoke() {
    return fetchStats()
  },
}

export const getCategories: SkillTool = {
  name: 'get_categories',
  description: '获取作品分类：实际工程 / 个人作品',
  async invoke() {
    return fetchCategories()
  },
}

export const getProjects: SkillTool = {
  name: 'get_projects',
  description: '获取作品列表；可选 category 过滤',
  async invoke(payload) {
    return fetchProjects(asCategory(payload.category))
  },
}

export const getProjectDetail: SkillTool = {
  name: 'get_project_detail',
  description: '按 id 获取作品详情：摘要、技术栈、量化指标、亮点、图集、经验',
  async invoke(payload) {
    return fetchProjectById(stringArg(payload, 'id'))
  },
}

export const searchWorks: SkillTool = {
  name: 'search_projects',
  description: '按关键词搜索作品（标题 / 副题 / 角色 / 技术栈全文匹配）',
  async invoke(payload) {
    return searchProjects(stringArg(payload, 'keyword'))
  },
}

export const listFavorites: SkillTool = {
  name: 'list_favorites',
  description: '获取已收藏的作品列表（持久化于本地）',
  async invoke() {
    await resumeStore.bootstrap()
    const items: Pick<Project, 'id' | 'title' | 'category' | 'role'>[] = resumeStore.favorites
      .map((id) => resumeStore.projectById(id))
      .filter((project): project is Project => Boolean(project))
      .map((project) => ({
        id: project.id,
        title: project.title,
        category: project.category,
        role: project.role,
      }))
    return { ok: true, data: items }
  },
}

/* ---- 写操作：幂等可逆，仅切换收藏，无破坏性 ---- */
const toggleFavorite: SkillTool = {
  name: 'toggle_favorite',
  description: '切换作品收藏态（幂等可逆）',
  async invoke(payload) {
    await resumeStore.bootstrap()
    const id = stringArg(payload, 'id')
    if (!id) {
      return { ok: false, error: { code: 'UNKNOWN', message: '缺少作品 id', retryable: false } }
    }
    if (!resumeStore.projectById(id)) {
      return { ok: false, error: { code: 'NOT_FOUND', message: '作品不存在或已下线', retryable: false } }
    }
    const favorite = resumeStore.toggleFavorite(id)
    if (favorite === null) {
      return { ok: false, error: { code: 'UNKNOWN', message: '收藏写入失败，请稍后再试', retryable: true } }
    }
    return { ok: true, data: { id, favorite } }
  },
}

/** 注册表：顺序与 ai-skills/resume/mcp.json 的 tools 完全一致 */
export const skillRegistry: SkillTool[] = [
  getProfile,
  getContactLinks,
  getSkills,
  getTimeline,
  getAbout,
  getStats,
  getCategories,
  getProjects,
  getProjectDetail,
  searchWorks,
  listFavorites,
  toggleFavorite,
]

/** 统一入口：未知 SKILL 与执行异常都归一化为 Result，不向调用方抛栈 */
export async function invokeSkill(
  name: string,
  payload: SkillPayload = {},
): Promise<Result<unknown>> {
  const tool = skillRegistry.find((item) => item.name === name)
  if (!tool) {
    return {
      ok: false,
      error: { code: 'UNKNOWN', message: `未注册的 SKILL：${name}`, retryable: false },
    }
  }
  try {
    return await tool.invoke(payload)
  } catch (error) {
    logger.error('skill', `${name} 执行失败`, error)
    return {
      ok: false,
      error: {
        code: 'UNKNOWN',
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
      },
    }
  }
}
