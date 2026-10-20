import {
  BadgeCheck, BookOpen, CalendarCheck, CalendarClock, CalendarDays, CalendarOff, ClipboardCheck,
  ClockPlus, Footprints, Megaphone, ScanFace, UtensilsCrossed, Wallet, Wrench, type LucideIcon,
} from 'lucide-react'

/**
 * 智慧校园 14 个应用模块目录（业务板块归口与主要功能由业务侧确认）。
 *
 * 安装学校数只有 7 个模块能在 data/smart-campus.source.json 的截图数据里对上
 * （moduleInstallations），其余 7 个与全部「当日使用人数」为演示值，
 * 必须逐处用 SimMark 标注；生成方式与核对口径见各字段 note。
 */

export type CampusBlockKey = 'office' | 'academic' | 'service'

export type CampusBlock = { key: CampusBlockKey; name: string; color: string }

export const CAMPUS_BLOCKS: CampusBlock[] = [
  { key: 'office', name: '校园办公', color: '#3ee6ff' },
  { key: 'academic', name: '智慧教务', color: '#a78bfa' },
  { key: 'service', name: '师生服务', color: '#ffd166' },
]

export function campusBlock(key: CampusBlockKey): CampusBlock {
  return CAMPUS_BLOCKS.find((block) => block.key === key) ?? CAMPUS_BLOCKS[0]
}

export type CampusModule = {
  key: string
  name: string
  /** 卡片等窄容器里的显示短名；不改变正式模块名。 */
  shortName?: string
  block: CampusBlockKey
  icon: LucideIcon
  /** 业务确认的主要功能原文。 */
  functions: string
  /** 安装学校/机构数；installedSimulated 为 true 时是演示值。 */
  installedSchools: number
  installedSimulated: boolean
  /** 数值口径与来源说明，进 tooltip。 */
  installedNote: string
  /** 当日使用人数；dailyUsersSimulated 为 true 时是演示值。 */
  dailyUsers: number
  dailyUsersSimulated: boolean
  /** 当日值口径说明（实测值必填）。 */
  dailyUsersNote?: string
}

/**
 * 应用使用情况大屏的入口地址。单文件打包时 scripts/build-single-html.mjs 会把
 * /app-usage 重写为「建邺区应用使用情况.html」，开发与静态导出走真实路由。
 */
export function usageBoardHref(key: string): string {
  return `/app-usage?app=${key}`
}

/** 使用情况大屏默认展示的应用（当日使用人数最高）。 */
export const DEFAULT_USAGE_APP = 'attendance'

export const MODULE_DEMO_TIP = '演示值：平台未提供该模块数值，按同平台数据量级生成'

export const CAMPUS_MODULES: CampusModule[] = [
  // 校园办公
  {
    key: 'repair', name: '报修处理', block: 'office', icon: Wrench,
    functions: '设备故障线上报修、维修进度反馈、数据统计；拍照或一句话即可报修，自动分类定级、派单，重复故障提前预警',
    installedSchools: 26, installedSimulated: false, installedNote: '截图口径「报修」26 校', dailyUsers: 312, dailyUsersSimulated: true,
  },
  {
    key: 'venue', name: '场馆预约', block: 'office', icon: CalendarClock,
    functions: '场馆资源预约、审批、时段管理；对话式预约，自动检测冲突并推荐可用时段',
    installedSchools: 23, installedSimulated: true, installedNote: '截图未展示该模块安装数', dailyUsers: 98, dailyUsersSimulated: true,
  },
  {
    key: 'salary', name: '工资条', block: 'office', icon: Wallet,
    functions: '工资导入、一对一发送、已读未读统计；导入时自动校验异常，未读自动提醒，常见疑问自动应答',
    installedSchools: 27, installedSimulated: false, installedNote: '截图口径「工资管理」27 校', dailyUsers: 268, dailyUsersSimulated: true,
  },
  {
    key: 'overtime', name: '加班申请', block: 'office', icon: ClockPlus,
    functions: '个人、部门加班申请、审批、汇总导出；对话式办理，自动校验课表与考勤冲突，台账自动生成',
    installedSchools: 15, installedSimulated: true, installedNote: '截图未展示该模块安装数', dailyUsers: 76, dailyUsersSimulated: true,
  },
  {
    key: 'escort', name: '护导', block: 'office', icon: Footprints,
    functions: '护导岗位、扫码登记、未到岗提醒；未到岗自动提醒，空岗及时提示，周报自动生成',
    installedSchools: 16, installedSimulated: false, installedNote: '截图口径「护导检查版本二」16 校', dailyUsers: 121, dailyUsersSimulated: true,
  },
  {
    key: 'noticeBoard', name: '通知公告', block: 'office', icon: Megaphone,
    functions: '通知发布、定时发送、阅读率统计；一句话成文、按人群定向发送，未读自动催办',
    installedSchools: 34, installedSimulated: false, installedNote: '截图口径「通知公告」34 校', dailyUsers: 1906, dailyUsersSimulated: true,
  },
  // 智慧教务
  {
    key: 'schoolCourse', name: '校本课程（选修课）', shortName: '校本课程', block: 'academic', icon: BookOpen,
    functions: '校本课报课、选课规则、线上选课、数据统计；选课前预测容量与热度，并给出落选调剂方案',
    installedSchools: 17, installedSimulated: false, installedNote: '截图口径「校本课程平台」17 校', dailyUsers: 43, dailyUsersSimulated: true,
  },
  {
    key: 'duty', name: '值班安排', block: 'academic', icon: CalendarCheck,
    functions: '对学校各类值班安排进行管理；支持创建值班组、设置值班岗位、对老师排班；支持值班扫码签到、值班数据统计、设置课时量并计入课时统计',
    installedSchools: 19, installedSimulated: true, installedNote: '截图未展示该模块安装数', dailyUsers: 64, dailyUsersSimulated: true,
  },
  {
    key: 'timetable', name: '课程表', block: 'academic', icon: CalendarDays,
    functions: '课程编排、任课管理、移动端查看；排课冲突自动检测，给出多套方案，调课影响自动通知',
    installedSchools: 18, installedSimulated: true, installedNote: '截图未展示该模块安装数', dailyUsers: 1764, dailyUsersSimulated: true,
  },
  {
    key: 'evaluation', name: '评教评学', block: 'academic', icon: ClipboardCheck,
    functions: '双向评价、进度查看、结果分析；开放题意见自动归纳，进度自动催办，不做教师个人排名',
    installedSchools: 14, installedSimulated: true, installedNote: '截图未展示该模块安装数', dailyUsers: 186, dailyUsersSimulated: true,
  },
  {
    key: 'teacherFile', name: '教师档案', block: 'academic', icon: BadgeCheck,
    functions: '教师基本信息、学历、职称、资格证、培训、获奖等档案线上管理；信息一次采集、全区复用，自动生成个人发展档案，缺项自动校验、更新自动提醒',
    installedSchools: 22, installedSimulated: true, installedNote: '截图未展示该模块安装数', dailyUsers: 51, dailyUsersSimulated: true,
  },
  // 师生服务
  {
    key: 'mealStop', name: '停伙', block: 'service', icon: UtensilsCrossed,
    functions: '停伙申请、配餐统计、费用结算；对话式办理，配餐数自动同步，结算清单自动生成',
    installedSchools: 12, installedSimulated: true, installedNote: '截图未展示该模块安装数', dailyUsers: 143, dailyUsersSimulated: true,
  },
  {
    key: 'leave', name: '请假', block: 'service', icon: CalendarOff,
    functions: '请假申请、审批、历史记录、数据汇总；对话式办理，自动校验课表与考勤冲突，台账自动生成',
    installedSchools: 24, installedSimulated: false,
    installedNote: '截图口径「学生请假」24 校，另有「老师请假版本三」20 校；近 30 日全区教师 455 人、学生 418 人请假',
    dailyUsers: 91, dailyUsersSimulated: false, dailyUsersNote: '截图实测：当日教师请假 38 人、学生 53 人',
  },
  {
    key: 'attendance', name: '智慧出勤', block: 'service', icon: ScanFace,
    functions: '教师、学生考勤、请假、晨检、区级总览；异常情况及时预警，周报自动生成，次日汇总到区级',
    installedSchools: 16, installedSimulated: false, installedNote: '截图口径「考勤（版本一）」16 校', dailyUsers: 2148, dailyUsersSimulated: true,
  },
]

/**
 * 关注情况三角色拆分：平台截图只展开「用户」页签，角色为演示值。
 * 取值经对平：三角色合计 45,333 人、已关注合计 28,901 人，
 * 与截图实测的总关注比例 63.75%、师生关注比例 78.71% 一致。
 */
export type RoleAttentionDemo = {
  role: 'student' | 'teacher' | 'parent'
  label: string
  color: string
  total: number
  followed: number
}

export const ROLE_ATTENTION_DEMO: RoleAttentionDemo[] = [
  { role: 'student', label: '学生', color: '#3ee6ff', total: 25900, followed: 19454 },
  { role: 'teacher', label: '教师', color: '#7c9bff', total: 6100, followed: 5734 },
  { role: 'parent', label: '家长', color: '#ffd166', total: 13333, followed: 3713 },
]

export const ATTENTION_DEMO_TIP = '角色拆分演示值；合计与实测总关注 28,901 人 / 63.75%、师生关注 78.71% 一致'
