/* ==========================================================================
   简历域原子接口 · 领域能力的唯一出口（AI SKILL 直接复用此层）
   - 每个 API 即一个原子能力：粒度对齐 SKILL 封装
   - 全部返回 Result<T>，错误已在传输层归一化
   ========================================================================== */
import {
  aboutBlocks,
  categoryMetas,
  contactLinks,
  greetingCards,
  profile,
  projects,
  skillGroups,
  statItems,
  timelineEras,
} from '../data/resume-data'
import type {
  AboutBlock,
  CategoryMeta,
  ContactLink,
  GalleryGroup,
  GreetingCard,
  HomeEntry,
  Profile,
  Project,
  ProjectCategory,
  Result,
  SkillGroup,
  StatItem,
  TimelineEra,
} from '../types/index'
import { ROUTES } from '../constants/index'
import { asArray } from '../utils/guards'
import { send } from './request'

/* ---- 档案 ---- */
export function fetchProfile(): Promise<Result<Profile>> {
  return send({ domain: 'resume.profile', fetcher: () => profile })
}

/* ---- 社交坐标 ---- */
export function fetchContactLinks(): Promise<Result<ContactLink[]>> {
  return send({ domain: 'resume.contacts', fetcher: () => asArray<ContactLink>(contactLinks) })
}

/* ---- 问候卡 ---- */
export function fetchGreetingCards(): Promise<Result<GreetingCard[]>> {
  return send({ domain: 'resume.greeting', fetcher: () => asArray<GreetingCard>(greetingCards) })
}

/* ---- 关于叙事 ---- */
export function fetchAboutBlocks(): Promise<Result<AboutBlock[]>> {
  return send({ domain: 'resume.about', fetcher: () => asArray<AboutBlock>(aboutBlocks) })
}

/* ---- 成长时间线 ---- */
export function fetchTimeline(): Promise<Result<TimelineEra[]>> {
  return send({ domain: 'resume.timeline', fetcher: () => asArray<TimelineEra>(timelineEras) })
}

/* ---- 技能矩阵 ---- */
export function fetchSkills(): Promise<Result<SkillGroup[]>> {
  return send({ domain: 'resume.skills', fetcher: () => asArray<SkillGroup>(skillGroups) })
}

/* ---- 数字速览 ---- */
export function fetchStats(): Promise<Result<StatItem[]>> {
  return send({ domain: 'resume.stats', fetcher: () => asArray<StatItem>(statItems) })
}

/* ---- 分类元信息 ---- */
export function fetchCategories(): Promise<Result<CategoryMeta[]>> {
  return send({ domain: 'resume.categories', fetcher: () => asArray<CategoryMeta>(categoryMetas) })
}

/* ---- 作品列表（可按分类过滤） ---- */
export function fetchProjects(category?: ProjectCategory): Promise<Result<Project[]>> {
  return send({
    domain: 'resume.projects',
    fetcher: () => {
      const list = asArray<Project>(projects)
      return category ? list.filter((p) => p?.category === category) : list
    },
  })
}

/* ---- 作品详情 ---- */
export function fetchProjectById(id: string): Promise<Result<Project>> {
  return send({
    domain: 'resume.project.detail',
    fetcher: () => {
      const hit = asArray<Project>(projects).find((p) => p?.id === id)
      if (!hit) {
        throw new Error('NOT_FOUND: 作品不存在或已下线')
      }
      return hit
    },
  })
}

/* ---- 作品搜索（标题 / 副题 / 角色 / 技术栈全文匹配） ---- */
export function searchProjects(keyword: string): Promise<Result<Project[]>> {
  const kw = keyword.trim().toLowerCase()
  return send({
    domain: 'resume.projects.search',
    fetcher: () => {
      const list = asArray<Project>(projects)
      if (!kw) {
        return list
      }
      return list.filter((p) => {
        if (!p) {
          return false
        }
        const stack = asArray<{ items?: string[] }>(p.stack)
        const haystack = [
          p?.title,
          p?.subtitle,
          p?.role,
          ...stack.flatMap((s) => asArray<string>(s?.items)),
        ]
          .join(' ')
          .toLowerCase()
        return haystack.includes(kw)
      })
    },
  })
}

/* ---- 图集统计（详情页指标） ---- */
export function galleryCount(gallery: GalleryGroup[]): number {
  return asArray<GalleryGroup>(gallery).reduce(
    (sum, group) => sum + asArray<unknown>(group?.shots).length,
    0,
  )
}

/* ---- 主页入口星表（路由 + 飞跃键的编排层） ---- */
export function fetchHomeEntries(): Promise<Result<HomeEntry[]>> {
  return send({
    domain: 'resume.home.entries',
    fetcher: () => [
      {
        id: 'greeting',
        index: '01',
        icon: 'orbit',
        title: '您好',
        sub: '步入序厅，听一段开场白',
        route: ROUTES.greeting,
        tone: 'iris',
        flyKey: 'fly-entry-greeting',
      },
      {
        id: 'profile',
        index: '02',
        icon: 'user',
        title: '个人简介',
        sub: '身份 · 坐标 · 信条',
        route: ROUTES.profile,
        tone: 'aurora',
        flyKey: 'fly-entry-profile',
      },
      {
        id: 'about',
        index: '03',
        icon: 'compass',
        title: '关于我',
        sub: '成长纪元时间线',
        route: ROUTES.about,
        tone: 'iris',
        flyKey: 'fly-entry-about',
      },
      {
        id: 'skills',
        index: '04',
        icon: 'sliders',
        title: '我的技能',
        sub: '前端 · 后端 · 工具链',
        route: ROUTES.skills,
        tone: 'amber',
        flyKey: 'fly-entry-skills',
      },
      {
        id: 'works',
        index: '05',
        icon: 'grid',
        title: '我的项目',
        sub: '实际工程与个人作品',
        route: ROUTES.worksHub,
        tone: 'aurora',
        flyKey: 'fly-entry-works',
      },
    ],
  })
}
