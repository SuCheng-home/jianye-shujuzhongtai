import {
  JIANYE_BASE,
  JIANYE_META,
  JIANYE_SCHOOL_OPTIONS,
  findJianyeSchool,
  type JianyeSchool,
} from './jianye-data'

export type Scope = { level: 'district' } | { level: 'school'; schoolId: string }

export type SchoolStage = 'primary' | 'junior' | 'senior' | 'vocational' | 'special'

/** 学段定义：地图点位颜色、图例和筛选按钮共用。 */
export const SCHOOL_STAGES: { key: SchoolStage; label: string; color: string }[] = [
  { key: 'primary', label: '小学', color: '#34d399' },
  { key: 'junior', label: '初中', color: '#fbbf24' },
  { key: 'senior', label: '高中', color: '#38bdf8' },
  { key: 'vocational', label: '职业学校', color: '#a78bfa' },
  { key: 'special', label: '特殊教育', color: '#f472b6' },
]

export type SchoolDirectoryEntry = Pick<
  JianyeSchool,
  'code' | 'name' | 'category' | 'orgType' | 'statusNote' | 'teacherCount' | 'studentCount' | 'stages'
> & { id: string; stage: SchoolStage | null }

const CATEGORY_STAGE: Record<string, SchoolStage> = {
  小学: 'primary',
  初中: 'junior',
  高中: 'senior',
  职业学校: 'vocational',
  特殊教育: 'special',
}

function stageOf(school: JianyeSchool): SchoolStage | null {
  return CATEGORY_STAGE[school.category] ?? CATEGORY_STAGE[school.stages[0] ?? ''] ?? null
}

/** 学校名录：建邺区教育局机构表，启用且非幼儿园。一贯制学校 stage 为 null，按 category 展示。 */
export const SCHOOL_DIRECTORY: SchoolDirectoryEntry[] = JIANYE_SCHOOL_OPTIONS.map((school) => ({
  id: school.code,
  code: school.code,
  name: school.name,
  category: school.category,
  orgType: school.orgType,
  statusNote: school.statusNote,
  teacherCount: school.teacherCount,
  studentCount: school.studentCount,
  stages: school.stages,
  stage: stageOf(school),
}))

export const DEFAULT_SCHOOL_ID = SCHOOL_DIRECTORY[0]?.id ?? ''

export const DISTRICT = {
  name: JIANYE_META.district.name,
  adcode: JIANYE_META.district.adcode,
  schools: SCHOOL_DIRECTORY.length,
  students: JIANYE_BASE.studentTotalNonKinder,
  teachers: JIANYE_BASE.teacherTotalNonKinder,
  classes: JIANYE_BASE.classTotal,
}

/** 地图上已接入点位的学校数量（按学段）；一贯制不计入单一学段。 */
export function countByStage(stage: SchoolStage) {
  return SCHOOL_DIRECTORY.filter((school) => school.stage === stage).length
}

export type MetricKey = 'schools' | 'students' | 'teachers' | 'classes' | 'ratio' | 'scopeSchools'

export type ProfileItem = { key: MetricKey; label: string; value: string; unit: string; note?: string }

const SOURCE_ROSTER = '数据来源于建邺区教育机构与师生名册（统计不含幼儿园）'

/** 地图点位悬浮卡使用的校级数据；名录里没有的学校返回 null。 */
export function getSchoolTeacherProfile(schoolName: string): ProfileItem[] | null {
  const school = findJianyeSchoolByName(schoolName)
  if (!school) return null
  const items: ProfileItem = {
    key: 'teachers',
    label: '教师总数',
    value: school.teacherCount === null ? '—' : school.teacherCount.toLocaleString('zh-CN'),
    unit: '人',
    note: SOURCE_ROSTER,
  }
  const list: ProfileItem[] = [items]
  if (school.studentCount !== null) {
    list.push({
      key: 'students',
      label: '学生总数',
      value: school.studentCount.toLocaleString('zh-CN'),
      unit: '人',
      note: SOURCE_ROSTER,
    })
    if (school.teacherCount) {
      list.push({
        key: 'ratio',
        label: '师生比',
        value: `1:${(school.studentCount / school.teacherCount).toFixed(1)}`,
        unit: '',
      })
    }
  }
  return list
}

function findJianyeSchoolByName(name: string) {
  return JIANYE_SCHOOL_OPTIONS.find((school) => school.name === name)
}
