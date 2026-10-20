import { CAMPUS_LEAVE_DAILY, CAMPUS_LEAVE_SCHOOLS, CAMPUS_LEAVE_SUMMARY, CAMPUS_OVERVIEW } from './smart-campus-data'
import { CAMPUS_MODULES, DEFAULT_USAGE_APP, type CampusBlockKey, type CampusModule } from './smart-campus-modules'

/**
 * 应用使用情况大屏的数据视图（14 个应用逐个展开）。
 *
 * - 请假：全部为截图实测（30 天教师/学生曲线、455/418 人数、学校表格 4 行）；
 * - 其余模块：平台截图没有分模块使用数据，趋势/排行/角色构成为确定性演示值
 *   （固定生成，不用随机数），页面逐处加「?」标记。
 */

export type UsageSeriesDef = { key: string; name: string; color: string }
export type UsagePoint = { date: string; [seriesKey: string]: number | string }

export type UsageKpi = { label: string; value: number; unit: string; sub: string; simulated: boolean; tip?: string }
export type UsageSchoolRow = { name: string; value: number; meta?: string; simulated: boolean }
export type UsageRoleSlice = { key: string; name: string; color: string; count: number }

export type ModuleUsageView = {
  module: CampusModule
  real: boolean
  series: UsageSeriesDef[]
  points: UsagePoint[]
  kpis: UsageKpi[]
  schools: UsageSchoolRow[]
  schoolsUnit: string
  schoolsNote: string
  roles: UsageRoleSlice[]
  rolesNote: string
  description: string
  highlights: string[]
}

export const DEMO_USAGE_TIP = '演示值：平台未提供分模块数据，按同平台量级固定生成'

const DEMO_DATES = CAMPUS_LEAVE_DAILY.map((row) => row.date)

function hashSeed(text: string): number {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function mulberry32(seed: number): () => number {
  let value = seed
  return () => {
    value = (value + 0x6d2b79f5) | 0
    let t = Math.imul(value ^ (value >>> 15), 1 | value)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 周末与国庆假期为低值日，与真实请假曲线的节奏保持一致。 */
function isQuietDay(date: string): boolean {
  const day = new Date(`${date}T00:00:00`).getDay()
  if (day === 0 || day === 6) return true
  return date >= '2026-10-01' && date <= '2026-10-07'
}

/** 确定性演示序列：同一天永远得到同一个数，最后一天锚定为当日使用人数。 */
function demoPointSeries(module: CampusModule): { date: string; users: number }[] {
  const random = mulberry32(hashSeed(`campus-usage:${module.key}`))
  const lastIndex = DEMO_DATES.length - 1
  return DEMO_DATES.map((date, index) => {
    if (index === lastIndex) return { date, users: module.dailyUsers }
    const factor = isQuietDay(date) ? 0.05 + random() * 0.06 : 0.78 + random() * 0.52
    return { date, users: Math.max(0, Math.round(module.dailyUsers * factor)) }
  })
}

const DEMO_SCHOOLS = [
  '南京致远外国语小学',
  '南京师大附中新城初级中学',
  '新城小学',
  '南京外国语学校青奥村小学',
  '新城南校安心驿站',
  '南师附中栋梁学校',
]

const DEMO_SCHOOL_SHARES = [0.13, 0.115, 0.1, 0.085, 0.075, 0.065]

const BLOCK_ROLE_SHARES: Record<CampusBlockKey, Record<string, number>> = {
  office: { teacher: 62, student: 6, parent: 8, other: 24 },
  academic: { teacher: 34, student: 46, parent: 12, other: 8 },
  service: { teacher: 12, student: 44, parent: 32, other: 12 },
}

const ROLE_META = [
  { key: 'teacher', name: '教师', color: '#7c9bff' },
  { key: 'student', name: '学生', color: '#3ee6ff' },
  { key: 'parent', name: '家长', color: '#ffd166' },
  { key: 'other', name: '其他', color: '#94a3b8' },
]

/** 按权重把总数拆成整数份额（最大余额法），各项之和恒等于总数。 */
function splitCounts(total: number, weights: number[]): number[] {
  const sum = weights.reduce((acc, weight) => acc + weight, 0)
  const raw = weights.map((weight) => (total * weight) / sum)
  const counts = raw.map((value) => Math.floor(value))
  let remainder = total - counts.reduce((acc, value) => acc + value, 0)
  const order = raw.map((value, index) => ({ index, fraction: value - counts[index] })).sort((a, b) => b.fraction - a.fraction)
  for (const item of order) {
    if (remainder <= 0) break
    counts[item.index] += 1
    remainder -= 1
  }
  return counts
}

function demoRoles(module: CampusModule): UsageRoleSlice[] {
  const random = mulberry32(hashSeed(`roles:${module.key}`))
  const base = BLOCK_ROLE_SHARES[module.block]
  const weights = ROLE_META.map((role) => Math.max(2, base[role.key] + (random() * 12 - 6)))
  const counts = splitCounts(module.dailyUsers, weights)
  return ROLE_META.map((role, index) => ({ key: role.key, name: role.name, color: role.color, count: counts[index] }))
}

function coverageSub(module: CampusModule): string {
  const denominator = CAMPUS_OVERVIEW.schoolCount
  const percent = denominator ? Math.round((module.installedSchools / denominator) * 100) : 0
  return `覆盖 ${percent}% · 平台 ${denominator} 个机构`
}

function demoSchools(module: CampusModule, monthTotal: number): UsageSchoolRow[] {
  const random = mulberry32(hashSeed(`schools:${module.key}`))
  const rows = DEMO_SCHOOLS.map((name, index) => ({
    name,
    value: Math.max(1, Math.round(monthTotal * DEMO_SCHOOL_SHARES[index] * (0.9 + random() * 0.2))),
    simulated: true,
  }))
  return rows.sort((a, b) => b.value - a.value)
}

function buildModuleUsage(module: CampusModule): ModuleUsageView {
  const segments = module.functions.split('；')
  const description = segments[0]
  const highlights = segments.slice(1)

  if (module.key === 'leave') {
    const points: UsagePoint[] = CAMPUS_LEAVE_DAILY.map((row) => ({ date: row.date, teacher: row.teacher, student: row.student }))
    const peak = points.reduce((max, row) => Math.max(max, (row.teacher as number) + (row.student as number)), 0)
    const daily = CAMPUS_LEAVE_SUMMARY.teacherPeople + CAMPUS_LEAVE_SUMMARY.studentPeople
    return {
      module,
      real: true,
      series: [
        { key: 'teacher', name: '教师', color: '#ff8a8a' },
        { key: 'student', name: '学生', color: '#3ee6ff' },
      ],
      points,
      kpis: [
        { label: '当日请假人数', value: module.dailyUsers, unit: '人', sub: module.dailyUsersNote ?? '', simulated: false },
        { label: '近 30 日请假人数', value: daily, unit: '人', sub: `教师 ${CAMPUS_LEAVE_SUMMARY.teacherPeople} · 学生 ${CAMPUS_LEAVE_SUMMARY.studentPeople}`, simulated: false },
        { label: '覆盖学校', value: module.installedSchools, unit: '所', sub: coverageSub(module), simulated: false },
        { label: '单日峰值', value: peak, unit: '人', sub: '教师 + 学生 · 近 30 日', simulated: false },
      ],
      schools: CAMPUS_LEAVE_SCHOOLS.map((row) => ({
        name: row.name,
        value: row.teacherPeople,
        meta: `学生请假 ${row.studentPeople} 人`,
        simulated: false,
      })),
      schoolsUnit: ' 人',
      schoolsNote: '近 30 日学校教师请假人数 · 截图可见 4 所',
      roles: [
        { key: 'teacher', name: '教师', color: '#7c9bff', count: CAMPUS_LEAVE_SUMMARY.teacherPeople },
        { key: 'student', name: '学生', color: '#3ee6ff', count: CAMPUS_LEAVE_SUMMARY.studentPeople },
      ],
      rolesNote: '近 30 日请假人数构成 · 截图实测',
      description,
      highlights,
    }
  }

  const series = demoPointSeries(module)
  const monthTotal = series.reduce((acc, point) => acc + point.users, 0)
  const peak = series.reduce((max, point) => Math.max(max, point.users), 0)
  return {
    module,
    real: false,
    series: [{ key: 'users', name: '使用人数', color: '#3ee6ff' }],
    points: series.map((point) => ({ date: point.date, users: point.users })),
    kpis: [
      { label: '当日使用人数', value: module.dailyUsers, unit: '人', sub: '演示值', simulated: module.dailyUsersSimulated, tip: DEMO_USAGE_TIP },
      { label: '近 30 日使用人次', value: monthTotal, unit: '人次', sub: '按日合计 · 演示值', simulated: true, tip: DEMO_USAGE_TIP },
      { label: '覆盖学校', value: module.installedSchools, unit: '所', sub: coverageSub(module), simulated: module.installedSimulated },
      { label: '单日峰值', value: peak, unit: '人', sub: '近 30 日 · 演示值', simulated: true, tip: DEMO_USAGE_TIP },
    ],
    schools: demoSchools(module, monthTotal),
    schoolsUnit: ' 人',
    schoolsNote: '近 30 日学校使用人数 · 演示值',
    roles: demoRoles(module),
    rolesNote: '当日使用人数构成 · 演示值',
    description,
    highlights,
  }
}

const USAGE_VIEWS: Record<string, ModuleUsageView> = Object.fromEntries(
  CAMPUS_MODULES.map((module) => [module.key, buildModuleUsage(module)]),
)

export function moduleUsage(key: string | null | undefined): ModuleUsageView {
  return (key && USAGE_VIEWS[key]) || USAGE_VIEWS[DEFAULT_USAGE_APP] || USAGE_VIEWS[CAMPUS_MODULES[0].key]
}

/** 近 7 日切片（末 7 个点）；周期切换共用。 */
export function slicePeriod(points: UsagePoint[], period: '7d' | '30d'): UsagePoint[] {
  return period === '7d' ? points.slice(-7) : points
}
