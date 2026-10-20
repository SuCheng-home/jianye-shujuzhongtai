'use client'

import { useEffect, useMemo, useState } from 'react'
import { BarChart3, Boxes, Sparkles, TrendingUp, Users, type LucideIcon } from 'lucide-react'
import {
  CampusPanel, CategoryDonut, Ranking, Segmented, UsageTrendChart,
} from '@/components/dashboard/smart-campus-charts'
import { DigitalHuman } from '@/components/dashboard/digital-human'
import { ScreenFit } from '@/components/dashboard/screen-fit'
import { SimMark } from '@/components/dashboard/sim-mark'
import { formatValue } from '@/lib/smart-campus-data'
import { CAMPUS_BLOCKS, CAMPUS_MODULES, DEFAULT_USAGE_APP, campusBlock } from '@/lib/smart-campus-modules'
import { moduleUsage, slicePeriod, type UsageKpi } from '@/lib/smart-campus-usage'

/**
 * 建邺区应用使用情况：左侧切换 14 个应用，逐个展开使用详情。
 * 请假为截图实测数据；其余模块为演示值（? 悬停提示），说明见各面板注释。
 */
export function AppUsage() {
  const [activeKey, setActiveKey] = useState(DEFAULT_USAGE_APP)
  const [period, setPeriod] = useState<'7d' | '30d'>('30d')

  useEffect(() => {
    const key = new URLSearchParams(window.location.search).get('app')
    if (key && CAMPUS_MODULES.some((module) => module.key === key)) setActiveKey(key)
  }, [])

  /** 切换应用时同步地址栏（file:// 下部分浏览器禁止改 URL，失败静默忽略）。 */
  const selectApp = (key: string) => {
    setActiveKey(key)
    try {
      window.history.replaceState(null, '', `?app=${key}`)
    } catch {
      /* 单文件离线打开时忽略 */
    }
  }

  const view = useMemo(() => moduleUsage(activeKey), [activeKey])
  const points = useMemo(() => slicePeriod(view.points, period), [view, period])
  const block = campusBlock(view.module.block)
  const periodLabel = period === '7d' ? '近 7 日' : '近 30 日'

  return (
    <ScreenFit>
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-2">
          <div className="flex items-baseline gap-3">
            <h1 className="text-lg font-semibold tracking-wide">建邺区应用使用情况</h1>
            <span className="text-xs text-white/50">{view.module.name} · {block.name}</span>
            {view.real && <span className="rounded border border-cyan-400/25 bg-cyan-400/5 px-1.5 py-0.5 text-[10px] text-cyan-200/75">截图实测</span>}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Segmented<'7d' | '30d'>
              label="统计周期"
              value={period}
              onChange={setPeriod}
              options={[{ key: '30d', label: '近 30 日' }, { key: '7d', label: '近 7 日' }]}
            />
            <a href="/smart-campus?from=usage" className="rounded border border-white/15 px-2 py-1 text-xs text-white/70 transition-colors hover:border-cyan-300 hover:text-cyan-100">返回应用运营</a>
          </div>
        </header>

        <main className="grid min-h-0 flex-1 gap-3 p-3" style={{ gridTemplateColumns: '18fr minmax(0,58fr) 24fr' }}>
          <section className="grid min-h-0" style={{ gridTemplateRows: 'minmax(0,1fr)' }}>
            <CampusPanel title="应用列表" icon={Boxes} note="14 个应用 · 校园办公 6 / 智慧教务 5 / 师生服务 3">
              <nav className="campus-app-nav" aria-label="选择应用">
                {CAMPUS_BLOCKS.map((blockMeta) => (
                  <div key={blockMeta.key} className="campus-app-nav-group" style={{ ['--block-color' as string]: blockMeta.color }}>
                    <p className="campus-app-nav-head"><i aria-hidden />{blockMeta.name}</p>
                    {CAMPUS_MODULES.filter((item) => item.block === blockMeta.key).map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        aria-pressed={item.key === activeKey}
                        className={`campus-app-nav-item ${item.key === activeKey ? 'is-active' : ''}`}
                        onClick={() => selectApp(item.key)}
                      >
                        <item.icon aria-hidden />
                        <span className="campus-app-nav-name">{item.name}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </nav>
            </CampusPanel>
          </section>

          <section className="grid min-h-0 gap-3" style={{ gridTemplateRows: 'auto minmax(0,1fr) minmax(0,1fr)' }}>
            <div className="campus-kpi-row">
              {view.kpis.map((kpi, index) => <UsageKpiCard key={kpi.label} kpi={kpi} color={KPI_COLORS[index % KPI_COLORS.length]} icon={KPI_ICONS[index % KPI_ICONS.length]} />)}
            </div>
            <CampusPanel title="使用趋势" icon={TrendingUp} note={`${periodLabel} · ${view.real ? '截图实测：教师 / 学生每日请假人数' : '演示值'}`}>
              <UsageTrendChart points={points} series={view.series} periodLabel={periodLabel} />
            </CampusPanel>
            <CampusPanel title="学校使用排行" icon={BarChart3} note={view.schoolsNote}>
              <Ranking rows={view.schools.map((row) => ({ name: row.name, value: row.value, meta: row.meta, simulated: row.simulated }))} unit={view.schoolsUnit} limit={6} />
            </CampusPanel>
          </section>

          <section className="grid min-h-0 gap-3" style={{ gridTemplateRows: 'minmax(0,1fr) minmax(0,1fr) 236px' }}>
            <CampusPanel title="模块功能" icon={view.module.icon} note={view.module.installedNote}>
              <div className="flex min-h-0 flex-1 flex-col gap-2">
                <p className="text-xs leading-relaxed text-muted-foreground">{view.description}</p>
                {view.highlights.length > 0 && (
                  <ul className="flex flex-col gap-1.5">
                    {view.highlights.map((item) => (
                      <li key={item} className="flex gap-1.5 text-xs leading-relaxed text-cyan-100/90">
                        <Sparkles className="mt-0.5 size-3 shrink-0 text-cyan-300" aria-hidden />
                        {item}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CampusPanel>
            <CampusPanel title="使用构成" icon={Users} note={view.rolesNote}>
              <CategoryDonut
                counts={view.roles.map((role) => ({ key: role.key, name: role.name, color: role.color, count: role.count }))}
                unit="人"
                centerLabel={view.real ? '请假人数' : '使用人数'}
              />
            </CampusPanel>
            <div id="usage-robot-host" className="relative min-h-0 overflow-hidden rounded-md border border-dashed border-white/15">
              <DigitalHuman hostId="usage-robot-host" size={210} />
            </div>
          </section>
        </main>
      </div>
    </ScreenFit>
  )
}

const KPI_COLORS = ['#3ee6ff', '#7c9bff', '#a78bfa', '#ffd166']
const KPI_ICONS: LucideIcon[] = [Users, TrendingUp, Boxes, BarChart3]

function UsageKpiCard({ kpi, color, icon: Icon }: { kpi: UsageKpi; color: string; icon: LucideIcon }) {
  return (
    <div className="campus-kpi" style={{ ['--kpi-color' as string]: color }}>
      <div className="campus-kpi-head"><span className="campus-kpi-badge"><Icon aria-hidden /></span>{kpi.label}</div>
      <div className="campus-kpi-body">
        <strong className="font-display">{formatValue(kpi.value)}</strong>
        <small>{kpi.unit}</small>
        {kpi.simulated && <SimMark tip={kpi.tip} />}
      </div>
      <p className="campus-kpi-sub">{kpi.sub}</p>
    </div>
  )
}
