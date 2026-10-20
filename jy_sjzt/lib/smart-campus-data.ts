/**
 * 应用运营页的格式化与数据视图工具。
 *
 * 数字来源：data/smart-campus.generated.json（智慧校园平台截图实测数据，
 * 生成脚本 scripts/build-smart-campus-data.py；补数后重跑 `npm run import:campus`）。
 * 14 个应用模块与演示值见 lib/smart-campus-modules.ts。页面只读视图，不查库。
 */

import generated from '@/data/smart-campus.generated.json'

export function formatValue(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'string') return value
  return value.toLocaleString('zh-CN')
}

export function compactValue(value: number): string {
  if (Math.abs(value) >= 10000) return `${(value / 10000).toFixed(1)}万`
  return String(value)
}

type CampusRow = Record<string, unknown>

const DATASETS = (generated as { datasets: Record<string, { rows: CampusRow[] }> }).datasets

function datasetRows(name: string): CampusRow[] {
  return DATASETS[name]?.rows ?? []
}

function rowNumber(row: CampusRow, field: string): number {
  const value = row[field]
  return typeof value === 'number' ? value : 0
}

const overviewRow = datasetRows('overview')[0] ?? {}

export const CAMPUS_OVERVIEW = {
  schoolCount: rowNumber(overviewRow, 'schoolCount'),
  userCount: rowNumber(overviewRow, 'userCount'),
  followerCount: rowNumber(overviewRow, 'followerCount'),
  unfollowedCount: rowNumber(datasetRows('overviewDerived')[0] ?? {}, 'unfollowedCount'),
  followerRatePct: rowNumber(overviewRow, 'followerRatePct'),
  teacherStudentFollowerRatePct: rowNumber(overviewRow, 'teacherStudentFollowerRatePct'),
}

export type SchoolCategoryRow = { key: string; name: string; count: number }

/** 截图「学校数据」分类口径（wxj1）：幼儿园 6 / 小学 19 / 初中 11 / 高中 1 / 大中专 0 / 局机关 1 / 特殊学校 1。 */
export const CAMPUS_SCHOOL_CATEGORIES: SchoolCategoryRow[] = datasetRows('schoolCategoriesWxj1').map((row) => ({
  key: String(row.id),
  name: String(row.rawLabel),
  count: rowNumber(row, 'count'),
}))

export type CampusVisitPoint = { date: string; pv: number; uv: number }

export const CAMPUS_VISITS_7D: CampusVisitPoint[] = datasetRows('visitsDaily').map((row) => ({
  date: String(row.date),
  pv: rowNumber(row, 'pv'),
  uv: rowNumber(row, 'uv'),
}))

const visitsSummaryRow = datasetRows('visitsSummary')[0] ?? {}

export const CAMPUS_VISITS_SUMMARY = {
  days: CAMPUS_VISITS_7D.length,
  pv7dTotal: rowNumber(visitsSummaryRow, 'pv7dTotal'),
  uvPersonDays: rowNumber(visitsSummaryRow, 'uvPersonDays'),
}

/** 日均口径：7 日合计 ÷ 7；日均人数按「人日」平均，不是 7 天去重人数。 */
export const CAMPUS_DAILY_AVG = {
  pvPerDay: CAMPUS_VISITS_SUMMARY.days ? Math.round(CAMPUS_VISITS_SUMMARY.pv7dTotal / CAMPUS_VISITS_SUMMARY.days) : 0,
  uvPerDay: CAMPUS_VISITS_SUMMARY.days ? Math.round(CAMPUS_VISITS_SUMMARY.uvPersonDays / CAMPUS_VISITS_SUMMARY.days) : 0,
}

export type SchoolActivityRow = { key: string; name: string; full: string; score: number }

/** 截图可见的学校活跃度分值；被遮挡的 2 行（score 为 null）不进图。 */
export const CAMPUS_SCHOOL_ACTIVITY: SchoolActivityRow[] = datasetRows('schoolActivity')
  .filter((row) => typeof row.score === 'number')
  .map((row) => ({
    key: String(row.id),
    name: String(row.rawLabel),
    full: typeof row.schoolName === 'string' ? row.schoolName : String(row.rawLabel),
    score: rowNumber(row, 'score'),
  }))

const leaveRow = datasetRows('leaveSummary')[0] ?? {}

export const CAMPUS_LEAVE_SUMMARY = {
  teacherPeople: rowNumber(leaveRow, 'teacherPeople'),
  studentPeople: rowNumber(leaveRow, 'studentPeople'),
}

export type LeaveDailyPoint = { date: string; teacher: number; student: number }

/** 请假模块截图实测：30 天每日点值；点值之和不是累计人次，不做汇总口径使用。 */
export const CAMPUS_LEAVE_DAILY: LeaveDailyPoint[] = datasetRows('leaveDaily').map((row) => ({
  date: String(row.date),
  teacher: rowNumber(row, 'teacher'),
  student: rowNumber(row, 'student'),
}))

export type LeaveSchoolRow = { name: string; teacherPeople: number; studentPeople: number }

/** 请假学校表格截图可见的 4 行；不是全区完整排名。 */
export const CAMPUS_LEAVE_SCHOOLS: LeaveSchoolRow[] = datasetRows('leaveSchools').map((row) => ({
  name: String(row.schoolName ?? row.rawLabel),
  teacherPeople: rowNumber(row, 'teacherPeople'),
  studentPeople: rowNumber(row, 'studentPeople'),
}))
