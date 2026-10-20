'use client'

import { useCallback, useMemo, useState } from 'react'
import { Activity, AppWindow, Building2, Users, type LucideIcon } from 'lucide-react'
import {
  ActivityPanel, AttentionPanel, CampusPanel, CategoryDonut, MissingData, ModuleCatalog, Ranking,
  Segmented, VisitTrendPanel, type AttentionSlice, type VisitRow,
} from '@/components/dashboard/smart-campus-charts'
import { DigitalHuman } from '@/components/dashboard/digital-human'
import { ScreenFit } from '@/components/dashboard/screen-fit'
import { JIANYE_SCHOOLS, schoolScopeLabel, type JianyeScope } from '@/lib/jianye-data'
import {
  CAMPUS_DAILY_AVG, CAMPUS_OVERVIEW, CAMPUS_SCHOOL_ACTIVITY, CAMPUS_SCHOOL_CATEGORIES,
  CAMPUS_VISITS_7D, CAMPUS_VISITS_SUMMARY, formatValue,
} from '@/lib/smart-campus-data'
import {
  ATTENTION_DEMO_TIP, CAMPUS_BLOCKS, CAMPUS_MODULES, MODULE_DEMO_TIP, ROLE_ATTENTION_DEMO, usageBoardHref,
} from '@/lib/smart-campus-modules'

const SCOPE_EMPTY = '平台运营数据为全区口径，单校拆分未提供；切回「全区」查看完整数据。'

/**
 * 建邺区应用运营：平台用户与访问、14 个应用模块、学校活跃度。
 * 实测值为平台截图口径（见 data/smart-campus.generated.json），演示值逐处带 ? 标记。
 */
export function SmartCampus() {
  const [scope, setScope] = useState<JianyeScope>({ level: 'district' })
  const [statDate, setStatDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [period, setPeriod] = useState<'7d' | '30d'>('7d')
  const [visitMetric, setVisitMetric] = useState<'pv' | 'uv'>('pv')

  const onScopeChange = useCallback((next: JianyeScope) => setScope(next), [])
  const onStatDateChange = useCallback((next: string) => setStatDate(next), [])

  const district = scope.level === 'district'
  const label = schoolScopeLabel(scope)
  const periodLabel = period === '7d' ? '近 7 日' : '近 30 日'

  const roles = useMemo<AttentionSlice[]>(() => ROLE_ATTENTION_DEMO.map((role) => ({
    key: role.role,
    name: role.label,
    color: role.color,
    attended: role.followed,
    total: role.total,
    percent: role.total ? (role.followed / role.total) * 100 : null,
    simulated: true,
    simTip: ATTENTION_DEMO_TIP,
  })), [])

  const visitRows = useMemo<VisitRow[]>(() => (district && period === '7d' ? CAMPUS_VISITS_7D : []), [district, period])

  const usageRows = useMemo(() => CAMPUS_MODULES.map((item) => ({
    name: item.name, value: item.dailyUsers, key: item.key,
    simulated: item.dailyUsersSimulated, simTip: MODULE_DEMO_TIP, href: usageBoardHref(item.key),
  })), [])

  const blockCounts = useMemo(() => CAMPUS_BLOCKS.map((block) => ({
    key: block.key, name: block.name, color: block.color,
    count: CAMPUS_MODULES.filter((item) => item.block === block.key).length,
  })), [])

  const visitsRange = CAMPUS_VISITS_7D.length
    ? `${CAMPUS_VISITS_7D[0].date} ~ ${CAMPUS_VISITS_7D[CAMPUS_VISITS_7D.length - 1].date}`
    : ''

  return (
    <ScreenFit>
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-2">
          <div className="flex items-baseline gap-3">
            <h1 className="text-lg font-semibold tracking-wide">建邺区应用运营</h1>
            <span className="text-xs text-white/50">{label}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Segmented<JianyeScope['level']>
              label="应用运营范围"
              value={scope.level}
              onChange={(level) => onScopeChange(level === 'district' ? { level: 'district' } : { level: 'school', schoolId: scope.level === 'school' ? scope.schoolId : JIANYE_SCHOOLS[0]?.code ?? '' })}
              options={[{ key: 'district', label: '全区' }, { key: 'school', label: '单校' }]}
            />
            {scope.level === 'school' && (
              <select
                aria-label="选择学校"
                className="rounded border border-white/15 bg-transparent px-2 py-1 text-xs"
                value={scope.schoolId}
                onChange={(event) => onScopeChange({ level: 'school', schoolId: event.target.value })}
              >
                {JIANYE_SCHOOLS.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
              </select>
            )}
            <Segmented<'7d' | '30d'>
              label="统计周期"
              value={period}
              onChange={setPeriod}
              options={[{ key: '7d', label: '近 7 日' }, { key: '30d', label: '近 30 日' }]}
            />
            <label className="flex items-center gap-2 text-xs text-white/60">
              统计日期
              <input type="date" value={statDate} onChange={(event) => onStatDateChange(event.target.value)} className="rounded border border-white/15 bg-transparent px-2 py-1 text-xs" />
            </label>
          </div>
        </header>

        <main className="grid min-h-0 flex-1 gap-3 p-3" style={{ gridTemplateColumns: '24fr minmax(0,52fr) 24fr' }}>
          <section className="grid min-h-0 gap-3" style={{ gridTemplateRows: 'auto minmax(0,1fr) minmax(0,1fr)' }}>
            <CampusPanel title="用户总览" icon={Users} note="平台基础数据 · 学校/机构与用户关注截图口径">
              {district ? (
                <div className="flex flex-col gap-2">
                  <ul className="grid grid-cols-2 gap-2">
                    <OverviewTile label="用户总数" value={formatValue(CAMPUS_OVERVIEW.userCount)} unit="人" />
                    <OverviewTile label="关注用户" value={formatValue(CAMPUS_OVERVIEW.followerCount)} unit="人" />
                    <OverviewTile label="总关注比例" value={`${CAMPUS_OVERVIEW.followerRatePct}%`} />
                    <OverviewTile label="师生关注比例" value={`${CAMPUS_OVERVIEW.teacherStudentFollowerRatePct}%`} />
                  </ul>
                  <div className="campus-school-cats">
                    <span>机构构成</span>
                    <ul>
                      {CAMPUS_SCHOOL_CATEGORIES.map((category) => (
                        <li key={category.key}><span>{category.name}</span><b className="font-display">{category.count}</b></li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : <MissingData text={SCOPE_EMPTY} />}
            </CampusPanel>
            <AttentionPanel roles={district ? roles : []} emptyText={SCOPE_EMPTY} note={district ? '总关注/师生关注为实测；角色拆分为演示值' : undefined} />
            <VisitTrendPanel
              rows={visitRows}
              periodLabel={period === '7d' ? `近 7 日 · ${visitsRange}` : periodLabel}
              metric={visitMetric}
              onMetricChange={setVisitMetric}
              emptyText={district ? '平台截图仅含近 7 日访问数据，近 30 日未提供。' : SCOPE_EMPTY}
            />
          </section>

          <section className="grid min-h-0 gap-3" style={{ gridTemplateRows: 'auto minmax(0,1fr) minmax(0,1fr)' }}>
            {district ? (
              <div className="campus-kpi-row">
                <Kpi color="#3ee6ff" icon={Building2} label="接入机构" value={formatValue(CAMPUS_OVERVIEW.schoolCount)} unit="个" sub="含幼儿园 6、局机关 1、特殊学校 1" />
                <Kpi color="#7c9bff" icon={Activity} label="日均访问次数" value={formatValue(CAMPUS_DAILY_AVG.pvPerDay)} unit="次" sub={`近 7 日合计 ${formatValue(CAMPUS_VISITS_SUMMARY.pv7dTotal)} 次`} />
                <Kpi color="#a78bfa" icon={Users} label="日均访问人数" value={formatValue(CAMPUS_DAILY_AVG.uvPerDay)} unit="人" sub={`7 日人日合计 ${formatValue(CAMPUS_VISITS_SUMMARY.uvPersonDays)}`} />
                <Kpi color="#ffd166" icon={AppWindow} label="应用模块" value={formatValue(CAMPUS_MODULES.length)} unit="个" sub="校园办公 6 · 智慧教务 5 · 师生服务 3" />
              </div>
            ) : <MissingData text={SCOPE_EMPTY} />}
            <CampusPanel title="应用清单" icon={AppWindow} note={`${CAMPUS_MODULES.length} 个应用模块 · 安装学校/机构数（带 ? 为演示值）`}>
              {district ? <ModuleCatalog modules={CAMPUS_MODULES} /> : <MissingData text={SCOPE_EMPTY} />}
            </CampusPanel>
            <CampusPanel title="应用使用情况" icon={Building2} note="当日使用人数 · 演示值">
              {district ? <Ranking rows={usageRows} unit=" 人" limit={8} /> : <MissingData text={SCOPE_EMPTY} />}
            </CampusPanel>
          </section>

          <section className="grid min-h-0 gap-3" style={{ gridTemplateRows: 'minmax(0,1fr) minmax(0,1fr) 236px' }}>
            <CampusPanel title="应用情况" icon={AppWindow}>
              {district ? <CategoryDonut counts={blockCounts} /> : <MissingData text={SCOPE_EMPTY} />}
            </CampusPanel>
            <ActivityPanel
              rows={district ? CAMPUS_SCHOOL_ACTIVITY.map((row) => ({ key: row.key, name: row.name, full: row.full, value: row.score })) : []}
              note="截图可见分值 · 前 7 所（分值单位未说明）"
              emptyText={SCOPE_EMPTY}
            />
            <div id="campus-robot-host" className="relative min-h-0 overflow-hidden rounded-md border border-dashed border-white/15">
              <DigitalHuman hostId="campus-robot-host" size={210} />
            </div>
          </section>
        </main>
      </div>
    </ScreenFit>
  )
}

function OverviewTile({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <li className="rounded border border-white/10 bg-secondary/20 px-2 py-1.5">
      <span className="text-[10px] text-white/50">{label}</span>
      <strong className="font-display block text-base text-cyan-200">{value}{unit && <small className="ml-1 text-[10px] font-normal text-white/50">{unit}</small>}</strong>
    </li>
  )
}

function Kpi({ color, icon: Icon, label, value, unit, sub }: {
  color: string; icon: LucideIcon; label: string; value: string; unit: string; sub: string
}) {
  return (
    <div className="campus-kpi" style={{ ['--kpi-color' as string]: color }}>
      <div className="campus-kpi-head"><span className="campus-kpi-badge"><Icon aria-hidden /></span>{label}</div>
      <div className="campus-kpi-body"><strong className="font-display">{value}</strong><small>{unit}</small></div>
      <p className="campus-kpi-sub">{sub}</p>
    </div>
  )
}
