'use client'

import { useState } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { BarChart3, LayoutGrid, School, TrendingUp, UserCheck, Users, type LucideIcon } from 'lucide-react'
import { dash, thousands, type JianyeScope } from '@/lib/jianye-data'
import { DISTRICT, SCHOOL_DIRECTORY } from '@/lib/dashboard-data'
import { CAMPUS_VISITS_7D, compactValue, formatValue } from '@/lib/smart-campus-data'
import { ATTENTION_DEMO_TIP, CAMPUS_MODULES, ROLE_ATTENTION_DEMO } from '@/lib/smart-campus-modules'
import { Panel } from './panel'
import { MissingData, Ranking, Segmented } from './smart-campus-charts'
import { SimMark } from './sim-mark'

const DISTRICT_SCHOOL_BY_CODE = new Map(SCHOOL_DIRECTORY.map((school) => [school.id, school]))

const VISITS_RANGE = CAMPUS_VISITS_7D.length
  ? `${CAMPUS_VISITS_7D[0].date} ~ ${CAMPUS_VISITS_7D[CAMPUS_VISITS_7D.length - 1].date}`
  : ''

function BaseStat({ icon: Icon, label, value, unit, tip }: { icon: LucideIcon; label: string; value: string; unit: string; tip?: string }) {
  return (
    <li className="relative flex flex-col gap-1.5 rounded-lg border border-primary/30 bg-linear-to-br from-card/85 to-secondary/35 px-3 py-2">
      <div className="flex items-center gap-1.5">
        <Icon className="size-4 shrink-0 text-primary" aria-hidden />
        <p className="text-sm font-bold whitespace-nowrap text-muted-foreground">{label}</p>
      </div>
      <p className="font-display flex items-baseline gap-1 leading-none whitespace-nowrap">
        <span className="text-[1.65rem] leading-none font-bold tabular-nums text-foreground">{value}</span>
        <span className="text-sm font-bold text-primary">{unit}</span>
        {tip && <SimMark className="ml-0.5 self-center" tip={tip} />}
      </p>
    </li>
  )
}

/** 左上：教育与接入概况。 */
export function DistrictBasePanel({ scope }: { scope: JianyeScope }) {
  const isDistrict = scope.level === 'district'
  return (
    <Panel title="教育与接入概况" icon={School}>
      <ul className="grid grid-cols-2 gap-2.5">
        {isDistrict ? (
          <>
            <BaseStat icon={School} label="学校" value={thousands(DISTRICT.schools)} unit="所" tip="启用且非幼儿园的区属学校" />
            <BaseStat icon={Users} label="教职工" value={thousands(DISTRICT.teachers)} unit="人" tip="未删除教职工，不含幼儿园" />
            <BaseStat icon={UserCheck} label="学生" value={thousands(DISTRICT.students)} unit="人" tip="未删除学生档案，不含幼儿园" />
            <BaseStat icon={LayoutGrid} label="接入应用" value={String(CAMPUS_MODULES.length)} unit="个" tip="智慧校园平台 14 个应用模块：校园办公 6 · 智慧教务 5 · 师生服务 3" />
          </>
        ) : (
          <SchoolBase scope={scope} />
        )}
      </ul>
    </Panel>
  )
}

function SchoolBase({ scope }: { scope: JianyeScope }) {
  const school = scope.level === 'school' ? DISTRICT_SCHOOL_BY_CODE.get(scope.schoolId) : undefined
  return (
    <>
      <BaseStat icon={Users} label="教职工" value={thousands(school?.teacherCount ?? null)} unit="人" tip="该校未删除教职工" />
      <BaseStat icon={UserCheck} label="学生" value={thousands(school?.studentCount ?? null)} unit="人" tip="该校未删除学生档案" />
      <BaseStat
        icon={BarChart3}
        label="师生比"
        value={school?.teacherCount && school?.studentCount ? `1:${(school.studentCount / school.teacherCount).toFixed(1)}` : '—'}
        unit=""
      />
      <BaseStat icon={LayoutGrid} label="本校应用" value={dash(null)} unit="个" tip="校级应用开通数据未提供" />
    </>
  )
}

/** 左中：每日访问趋势。平台截图仅含近 7 日「访问次数 / 访问人数」。 */
export function UsageTrendPanel({ scope }: { scope: JianyeScope }) {
  const [metric, setMetric] = useState<'uv' | 'pv'>('uv')
  const label = metric === 'uv' ? '访问人数' : '访问次数'
  return (
    <Panel
      title="每日访问趋势"
      icon={TrendingUp}
      className="h-full min-h-0"
      action={<Segmented label="访问统计口径" value={metric} onChange={setMetric} options={[{ key: 'uv', label: '访问人数' }, { key: 'pv', label: '访问次数' }]} />}
    >
      {scope.level === 'district' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1" aria-label={`${label}，近 7 日`}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={CAMPUS_VISITS_7D} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
                <defs><linearGradient id="main-visit-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22d3ee" stopOpacity={0.32} /><stop offset="100%" stopColor="#22d3ee" stopOpacity={0.02} /></linearGradient></defs>
                <CartesianGrid stroke="#173a63" strokeDasharray="3 6" vertical={false} />
                <XAxis dataKey="date" tickFormatter={(date: string) => date.slice(5)} tick={{ fill: '#8fb0cf', fontSize: 10 }} axisLine={false} tickLine={false} interval={0} />
                <YAxis width={44} tickFormatter={compactValue} tick={{ fill: '#86a3cf', fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: '#071b42', border: '1px solid #1b4284', borderRadius: 6, color: '#e3efff', fontSize: 12 }} formatter={(value) => [formatValue(value as number), label]} />
                <Area type="monotone" dataKey={metric} name={label} fill="url(#main-visit-fill)" stroke="#3ee6ff" strokeWidth={2.4} dot={{ r: 3, fill: '#e8fcff', stroke: '#22d3ee', strokeWidth: 1.4 }} activeDot={{ r: 4.5 }} connectNulls={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 shrink-0 text-[10px] text-muted-foreground">近 7 日 · {VISITS_RANGE} · 平台整体</p>
        </div>
      ) : <MissingData text="平台访问数据为全区口径，未按学校拆分。" />}
    </Panel>
  )
}

/** 左下：当日应用使用排行。平台未提供分模块使用人数，数值为演示值。 */
export function UsageRankingPanel({ scope }: { scope: JianyeScope }) {
  const rows = CAMPUS_MODULES.map((item) => ({ name: item.name, value: item.dailyUsers, key: item.key, simulated: item.dailyUsersSimulated }))
  return (
    <Panel title="当日应用使用排行" icon={BarChart3} className="h-full min-h-0">
      {scope.level === 'district' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <Ranking rows={rows} unit=" 人" limit={7} />
          <p className="mt-1 shrink-0 text-[10px] text-muted-foreground">当日使用人数 · 演示值</p>
        </div>
      ) : <MissingData text="分模块使用人数为全区演示口径，未按学校拆分。" />}
    </Panel>
  )
}

/** 右上：学生 / 教师 / 家长三行关注卡。 */
export function AttentionCards({ scope }: { scope: JianyeScope }) {
  const roles = scope.level === 'district'
    ? ROLE_ATTENTION_DEMO.map((role) => ({
        key: role.role,
        label: role.label === '学生' ? '学生关注情况' : role.label === '教师' ? '教师关注情况' : '家长关注情况',
        rate: role.total ? (role.followed / role.total) * 100 : null,
        followed: role.followed,
        total: role.total,
      }))
    : []
  return (
    <Panel title="关注情况" icon={UserCheck} className="h-full min-h-0">
      <ul className="grid min-h-0 flex-1 grid-rows-3 gap-2.5">
        {roles.map((role) => {
          const unfollowed = Math.max(0, role.total - role.followed)
          return (
            <li key={role.key} className="flex min-h-0 flex-col justify-center gap-1 rounded-lg border border-primary/30 bg-linear-to-br from-card/85 to-secondary/35 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-bold whitespace-nowrap text-muted-foreground">{role.label}</p>
                <span className="font-display flex items-center gap-1 text-lg leading-none font-bold tabular-nums text-cyan-300">
                  {role.rate === null ? '—' : `${role.rate.toFixed(2)}%`}
                  <SimMark tip={ATTENTION_DEMO_TIP} />
                </span>
              </div>
              <p className="text-xs whitespace-nowrap text-muted-foreground/85">
                已关注 {thousands(role.followed)} / 总 {thousands(role.total)} · 未关注 {thousands(unfollowed)}
              </p>
            </li>
          )
        })}
        {!roles.length && <li className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">单校拆分未提供，切回「全区」查看。</li>}
      </ul>
    </Panel>
  )
}
