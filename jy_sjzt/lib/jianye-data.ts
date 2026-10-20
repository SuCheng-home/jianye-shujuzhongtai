import overview from '@/data/jianye-overview.generated.json'

/**
 * 建邺主数据入口。数值全部来自 scripts/build-jianye-data.py 生成的快照，
 * 页面不直接查库；补数后重跑 `npm run import:jianye` 即可，页面无需改动。
 */

export type JianyeSchool = {
  code: string
  name: string
  shortName: string | null
  category: string
  orgType: string | null
  statusNote: string | null
  teacherCount: number | null
  studentCount: number | null
  kindergarten: boolean
  stages: string[]
}

export type JianyeScope = { level: 'district' } | { level: 'school'; schoolId: string }

export type TrainingKpi = {
  activities: number
  activitiesWithSignData: number
  expectedPersonTimes: number | null
  attendedPersonTimes: number | null
  attendanceRate: number | null
  uniqueSignedTeachers: number | null
  teacherBase: number | null
  participationRate: number | null
  totalHours: number | null
  hoursUnknownActivities: number
  organizers: number
}

export type TrainingTerm = {
  key: string
  name: string
  prevKey: string | null
  hasSignData: boolean
  kpi: TrainingKpi
}

export type SupervisionGroup = {
  records: number
  teachers: number | null
  schools: number | null
  ratings: Record<string, number>
  unrated: number
  byType: Record<string, number>
}

export type SupervisionTerm = {
  key: string
  name: string
  groups: Record<string, SupervisionGroup>
  schoolCount: number
}

export const JIANYE_META = overview.meta
export const JIANYE_SCHOOLS = overview.schools as JianyeSchool[]
export const JIANYE_BASE = overview.base as {
  studentTotal: number
  teacherTotal: number
  classTotal: number
  studentByCategory: Record<string, number>
  teacherByCategory: Record<string, number>
  teacherTotalNonKinder: number
  studentTotalNonKinder: number
}
export const JIANYE_TRAINING = overview.training as {
  defaultTerm: string | null
  dict: { stages: { code: number; name: string }[]; levels: string[]; subjects: string[] }
  terms: TrainingTerm[]
}
export const JIANYE_SUPERVISION = overview.supervision as {
  defaultTerm: string | null
  dict: { ratings: string[]; groups: string[] }
  terms: SupervisionTerm[]
  modulesWithoutData: string[]
}
export const JIANYE_GAPS = overview.gaps as string[]

/** 下拉与地图共用的非幼儿园学校；幼儿园不进大屏名录。 */
export const JIANYE_SCHOOL_OPTIONS = JIANYE_SCHOOLS.filter((school) => !school.kindergarten)

export const DEFAULT_JIANYE_SCHOOL_CODE = JIANYE_SCHOOL_OPTIONS[0]?.code ?? ''

export function findJianyeSchool(code: string): JianyeSchool | undefined {
  return JIANYE_SCHOOLS.find((school) => school.code === code)
}

export function schoolScopeLabel(scope: JianyeScope): string {
  if (scope.level === 'district') return JIANYE_META.district.name
  return findJianyeSchool(scope.schoolId)?.name ?? scope.schoolId
}

/** 缺数统一显示「—」；真实 0 照实显示 0。 */
export function dash(value: number | string | null | undefined, suffix = ''): string {
  if (value === null || value === undefined || value === '') return '—'
  return `${value}${suffix}`
}

export function percent(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${value.toFixed(2)}%`
}

export function thousands(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : value.toLocaleString('zh-CN')
}

export function trainingTerm(key: string | null): TrainingTerm | undefined {
  const target = key ?? JIANYE_TRAINING.defaultTerm
  return JIANYE_TRAINING.terms.find((term) => term.key === target)
}

export function supervisionTerm(key: string | null): SupervisionTerm | undefined {
  const target = key ?? JIANYE_SUPERVISION.defaultTerm
  return JIANYE_SUPERVISION.terms.find((term) => term.key === target)
}
