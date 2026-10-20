'use client'

import { useState, type ReactNode } from 'react'
import { Activity, BarChart3, UserCheck, type LucideIcon } from 'lucide-react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { compactValue, formatValue } from '@/lib/smart-campus-data'
import { MODULE_DEMO_TIP, campusBlock, usageBoardHref, type CampusModule } from '@/lib/smart-campus-modules'
import type { UsagePoint, UsageSeriesDef } from '@/lib/smart-campus-usage'
import { Panel } from './panel'
import { SimMark } from './sim-mark'

const TOOLTIP_STYLE = { background: '#071b42', border: '1px solid #1b4284', borderRadius: 6, color: '#e3efff', fontSize: 12 }

export function CampusPanel({ title, icon, note, action, children, className }: {
  title: string; icon: LucideIcon; note?: string; action?: ReactNode; children: ReactNode; className?: string
}) {
  return <Panel title={title} icon={icon} className={className} action={action}>
    {children}
    {note && <p className="mt-1.5 shrink-0 text-[10px] leading-snug text-muted-foreground">{note}</p>}
  </Panel>
}

export function MissingData({ text, title = '数据未提供' }: { text: string; title?: string }) {
  return <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded border border-dashed border-primary/15 bg-secondary/10 px-5 py-5 text-center">
    <span className="size-7 rounded-full border border-primary/30 text-lg text-primary/60" aria-hidden>—</span>
    <p className="text-sm font-semibold text-muted-foreground">{title}</p><p className="max-w-sm text-xs leading-relaxed text-muted-foreground/80">{text}</p>
  </div>
}

export function Segmented<T extends string>({ options, value, onChange, label }: {
  options: { key: T; label: string }[]; value: T; onChange: (key: T) => void; label?: string
}) {
  return <div className="campus-seg" role="group" aria-label={label}>
    {options.map((option) => <button key={option.key} type="button" aria-pressed={value === option.key} className={value === option.key ? 'is-active' : ''} onClick={() => onChange(option.key)}>{option.label}</button>)}
  </div>
}

export function Ranking({ rows, unit = '', limit = 5, selected, onSelect }: {
  rows: { name: string; value: number | null; key?: string | number; color?: string; simulated?: boolean; simTip?: string; href?: string; meta?: string }[]
  unit?: string; limit?: number; selected?: number; onSelect?: (key: string | number) => void
}) {
  const sorted = [...rows].sort((a, b) => (b.value ?? -1) - (a.value ?? -1))
  const displayed = sorted.slice(0, limit)
  if (selected !== undefined && !displayed.some((row) => row.key === selected)) {
    const current = sorted.find((row) => row.key === selected)
    if (current) displayed[displayed.length - 1] = current
  }
  const maximum = Math.max(1, ...sorted.map((row) => row.value ?? 0))
  if (!rows.length) return <MissingData text="当前没有可展示的记录" />
  return <ol className="campus-rank-list">
    {displayed.map((row) => {
      const index = sorted.indexOf(row)
      const content = <>
        <div className="campus-rank-head"><span className={`campus-rank-index font-display ${index < 3 ? 'is-top' : ''}`}>{String(index + 1).padStart(2, '0')}</span><span className="campus-rank-name">{row.name}</span><span className="campus-rank-value font-display">{formatValue(row.value)}<small>{unit}</small></span>{row.simulated && <SimMark className="size-3.5" tip={row.simTip ?? MODULE_DEMO_TIP} />}</div>
        <div className="campus-rank-track"><i style={{ width: `${row.value === null ? 0 : row.value / maximum * 100}%`, ...(row.color ? { background: `linear-gradient(90deg, ${row.color}55, ${row.color})` } : {}) }} /></div>
      </>
      const title = `${row.name}：${formatValue(row.value)}${unit}${row.meta ? ` · ${row.meta}` : ''}`
      return <li key={row.key ?? row.name}>
        {row.href ? (
          <a href={row.href} className="group block w-full rounded text-left transition-colors hover:bg-primary/10" title={title}>{content}</a>
        ) : (
          <button type="button" disabled={!onSelect || row.key === undefined} onClick={() => row.key !== undefined && onSelect?.(row.key)} className={`group block w-full text-left disabled:cursor-default ${selected === row.key ? 'rounded bg-primary/10 ring-1 ring-primary/35' : ''}`} title={title}>{content}</button>
        )}
      </li>
    })}
  </ol>
}

export type AttentionSlice = { key: string; name: string; color: string; attended: number | null; total: number | null; percent: number | null; simulated?: boolean; simTip?: string }

/** 关注情况：学生 / 教师 / 家长各自的已关注/未关注饼图。数据驱动，缺数显示「—」。 */
export function AttentionPanel({ roles, note, emptyText }: { roles: AttentionSlice[]; note?: string; emptyText?: string }) {
  const hasData = roles.some((role) => role.total !== null)
  return <CampusPanel title="关注情况" icon={UserCheck} note={note}>
    {hasData ? <div className="campus-pie-row">
      {roles.map((role) => {
        const attended = role.attended ?? 0
        const unfollowed = role.total === null ? 0 : Math.max(0, role.total - attended)
        const slices = [{ name: '已关注', value: attended, color: role.color }, { name: '未关注', value: unfollowed, color: '#2c4d70' }]
        return <div key={role.key} className="campus-pie-cell">
          <div className="campus-pie">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={slices} dataKey="value" nameKey="name" outerRadius="96%" stroke="none" startAngle={90} endAngle={-270} isAnimationActive={false}>
                  {slices.map((slice) => <Cell key={slice.name} fill={slice.color} />)}
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value, name) => [`${formatValue(value as number)} 人`, name as string]} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <strong className="inline-flex items-center gap-0.5" style={{ color: role.color }}>{role.percent === null ? '—' : `${role.percent.toFixed(2)}%`}{role.simulated && <SimMark className="size-3.5" tip={role.simTip ?? MODULE_DEMO_TIP} />}</strong>
          <span>{role.name}</span>
        </div>
      })}
    </div> : <MissingData text={emptyText ?? '学生/教师/家长关注数据未提供；全区比例需源端按统一用户标识独立去重，不由各校平均。'} />}
  </CampusPanel>
}

/** 应用情况：分类环形图 + 图例（中心显示应用总数）。 */
export function CategoryDonut({ counts, unit = '个', centerLabel = '应用总数' }: {
  counts: { key: string; name: string; color: string; count: number }[]
  unit?: string
  centerLabel?: string
}) {
  if (!counts.length) return <MissingData text="应用安装数据未提供" />
  const total = counts.reduce((sum, item) => sum + item.count, 0)
  return <div className="campus-donut-wrap">
    <div className="campus-donut">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={counts} dataKey="count" nameKey="name" innerRadius="64%" outerRadius="94%" paddingAngle={2.5} stroke="none" startAngle={90} endAngle={-270} isAnimationActive={false}>
            {counts.map((item) => <Cell key={item.key} fill={item.color} />)}
          </Pie>
          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value, name) => [`${formatValue(value as number)} ${unit}`, name as string]} />
        </PieChart>
      </ResponsiveContainer>
      <div className="campus-donut-center"><strong className="font-display">{formatValue(total)}</strong><span>{centerLabel}</span></div>
    </div>
    <ul className="campus-legend">
      {counts.map((item) => <li key={item.key}><i style={{ background: item.color }} /><span>{item.name}</span><b className="font-display">{formatValue(item.count)}</b></li>)}
    </ul>
  </div>
}

/**
 * 应用清单：14 个应用模块，按业务板块三列排布。
 * 名称与功能为业务确认口径；「安装学校数」标 ? 的为演示值。
 */
export function ModuleCatalog({ modules }: { modules: CampusModule[] }) {
  const blocks = [...new Set(modules.map((item) => item.block))]
  return <div className="campus-mod-cols">
    {blocks.map((blockKey) => {
      const block = campusBlock(blockKey)
      const items = modules.filter((item) => item.block === blockKey)
      return <section key={blockKey} className="campus-mod-col" style={{ ['--block-color' as string]: block.color }}>
        <header className="campus-mod-col-head"><i aria-hidden /><span>{block.name}</span><b className="font-display">{items.length}</b></header>
        <ul className="campus-mod-list">
          {items.map((item) => <li key={item.key}>
            <a className="campus-mod-item campus-mod-link" href={usageBoardHref(item.key)} title={`${item.name}：${item.functions}\n安装：${item.installedNote}`}>
              <item.icon aria-hidden />
              <span className="campus-mod-name">{item.name}</span>
              <span className="campus-mod-installed">{item.installedSchools} 校{item.installedSimulated && <SimMark className="ml-1 inline-flex size-3.5 align-middle" tip={MODULE_DEMO_TIP} />}</span>
            </a>
            <p className="campus-mod-fn">{item.functions}</p>
          </li>)}
        </ul>
      </section>
    })}
  </div>
}

/** 旋转刻度：学校名较长，interval=0 平排会互相压字。 */
function BarTick({ x, y, payload }: { x?: number; y?: number; payload?: { value?: string } }) {
  return <text x={x} y={y} dy={4} transform={`rotate(-30 ${x} ${y})`} fill="#8fb0cf" fontSize={9.5} textAnchor="end">{payload?.value}</text>
}

/** 学校活跃度：按分值取前 7 所学校的柱状图。 */
export function ActivityPanel({ title = '学校活跃度', rows, unit, note, emptyText }: {
  title?: string
  rows: { key?: string; name: string; full: string; value: number | null }[]
  unit?: string
  note?: string
  emptyText?: string
}) {
  const chart = [...rows]
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1))
    .slice(0, 7)
    .map((row) => ({ name: row.name, full: row.full, value: row.value ?? 0 }))
  return <CampusPanel title={title} icon={BarChart3} note={note}>
    {chart.length ? <div className="campus-bars">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chart} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
          <defs><linearGradient id="campus-bar-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7de9ff" /><stop offset="55%" stopColor="#38a8ff" /><stop offset="100%" stopColor="#1d5ecf" /></linearGradient></defs>
          <CartesianGrid stroke="#173a63" strokeDasharray="3 6" vertical={false} />
          <XAxis dataKey="name" tick={<BarTick />} axisLine={false} tickLine={false} interval={0} height={38} />
          <YAxis width={44} tickFormatter={compactValue} tick={{ fill: '#86a3cf', fontSize: 10 }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: '#22d3ee10' }} formatter={(value) => [`${formatValue(value as number)}${unit ?? ''}`, '活跃度']} labelFormatter={(_, payload) => payload?.[0]?.payload?.full ?? ''} />
          <Bar dataKey="value" fill="url(#campus-bar-fill)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div> : <MissingData text={emptyText ?? '学校活跃度记录未提供'} />}
  </CampusPanel>
}

/** 多序列使用趋势（请假：教师/学生实测双线；其余：单线演示）。 */
export function UsageTrendChart({ points, series, periodLabel }: {
  points: UsagePoint[]
  series: UsageSeriesDef[]
  periodLabel: string
}) {
  const label = series.map((item) => item.name).join(' / ')
  return <div className="flex min-h-0 flex-1 flex-col gap-1.5">
    {series.length > 1 && (
      <div className="flex shrink-0 items-center gap-3 text-[10px] text-white/60">
        {series.map((item) => <span key={item.key} className="inline-flex items-center gap-1"><i className="size-1.5 rounded-full" style={{ background: item.color }} aria-hidden />{item.name}</span>)}
      </div>
    )}
    <div className="min-h-0 flex-1" aria-label={`${label}，${periodLabel}`}>
      {points.length ? <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 26, left: 0, bottom: 0 }}>
          <defs>
            {series.map((item) => (
              <linearGradient key={item.key} id={`usage-fill-${item.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={item.color} stopOpacity={0.3} />
                <stop offset="100%" stopColor={item.color} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke="#173a63" strokeDasharray="3 6" vertical={false} />
          <XAxis dataKey="date" tickFormatter={(date: string) => date.slice(5)} tick={{ fill: '#8fb0cf', fontSize: 10 }} axisLine={false} tickLine={false} interval={0} />
          <YAxis width={46} tickFormatter={compactValue} tick={{ fill: '#86a3cf', fontSize: 10 }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value, name) => [`${formatValue(value as number)} 人`, name as string]} />
          {series.map((item) => (
            <Area key={item.key} type="monotone" dataKey={item.key} name={item.name} fill={series.length === 1 ? `url(#usage-fill-${item.key})` : 'transparent'} stroke={item.color} strokeWidth={2.2} dot={{ r: 2.6, fill: '#e8fcff', stroke: item.color, strokeWidth: 1.3 }} activeDot={{ r: 4.5 }} connectNulls={false} isAnimationActive={false} />
          ))}
        </AreaChart>
      </ResponsiveContainer> : <MissingData text="该周期没有可展示的记录" />}
    </div>
  </div>
}

export type VisitRow = { date: string; pv: number; uv: number }

/** 用户访问趋势：访问次数/访问人数切换；缺日保留断点不补 0。 */
export function VisitTrendPanel({ rows, periodLabel, metric, onMetricChange, emptyText }: {
  rows: VisitRow[]
  periodLabel: string
  metric: 'pv' | 'uv'
  onMetricChange: (metric: 'pv' | 'uv') => void
  emptyText?: string
}) {
  const label = metric === 'pv' ? '访问次数' : '访问人数'
  return <CampusPanel title="用户访问趋势" icon={Activity} note={periodLabel} action={
    <Segmented label="访问统计口径" value={metric} onChange={onMetricChange} options={[{ key: 'pv', label: '访问次数' }, { key: 'uv', label: '访问人数' }]} />
  }>
    <div className="min-h-0 flex-1" aria-label={`${label}，${periodLabel}`}>
      {rows.length ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={rows} margin={{ top: 8, right: 26, left: 0, bottom: 0 }}>
        <defs><linearGradient id="campus-visit-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22d3ee" stopOpacity={0.34} /><stop offset="100%" stopColor="#22d3ee" stopOpacity={0.02} /></linearGradient></defs>
        <CartesianGrid stroke="#173a63" strokeDasharray="3 6" vertical={false} /><XAxis dataKey="date" tickFormatter={(date: string) => date.slice(5)} tick={{ fill: '#8fb0cf', fontSize: 10 }} axisLine={false} tickLine={false} interval={0} /><YAxis width={46} tickFormatter={compactValue} tick={{ fill: '#86a3cf', fontSize: 10 }} axisLine={false} tickLine={false} /><Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value) => [formatValue(value as number), label]} />
        <Area type="monotone" dataKey={metric} name={label} fill="url(#campus-visit-fill)" stroke="#3ee6ff" strokeWidth={2.4} dot={{ r: 3, fill: '#e8fcff', stroke: '#22d3ee', strokeWidth: 1.4 }} activeDot={{ r: 4.5 }} connectNulls={false} isAnimationActive={false} />
      </AreaChart></ResponsiveContainer> : <MissingData text={emptyText ?? '访问量源文件未提供逐日记录；多日每日人数相加是累计人次，不是期间去重人数。'} />}
    </div>
  </CampusPanel>
}
